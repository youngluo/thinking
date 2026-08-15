---
title: DeepSeek Harness 的工具执行与安全边界
createdAt: '2026-08-15 15:04'
draft: true
order: 4
---

模型产生 `tool/call` 只表示它希望执行某个动作，并不意味着动作已经获得许可。DeepSeek Harness 把工具注册、权限判断、人工审批、沙箱执行和结果记录放进一条统一管线，所有工具都要经过相同边界后才能把结果返回给模型。

这种设计把“模型想做什么”和“系统允许做什么”分开。工具实现只负责业务动作，安全策略可以在不修改工具代码的情况下拒绝、包装或修正执行结果。

## Tool Registry 负责什么

Tool Registry 汇总当前 Agent 作用域内可用的工具，并在每个 Step 向模型提供名称、说明和输入 Schema。模型返回调用后，Registry 再解析名称与参数，定位实际工具实现。

工具是否对模型可见、能否被执行是两个不同问题。Preset 决定工具集合，运行时安全管线对每次具体调用重新判断。即使工具已经出现在 Schema 中，当前路径、命令或参数仍可能被 Guard 拒绝或要求审批。

一个 Step 可以包含多个工具调用。Harness 会保留模型给出的调用顺序，完成前置检查后按工具声明的执行模式调度；允许并行的调用可以并发执行，后置处理和日志写入仍保持稳定次序，使下一步模型历史能够正确配对每个 call 与 result。

## 工具调用如何通过安全管线

下面的图从 `tool/call` 已写入会话开始，展示结果返回模型前所经过的阶段。

```d2 fold
direction: down

call: "记录 tool/call"
pre: "pre-execute\n解析策略与执行上下文"
guard: "Guard 允许？" {
  class: decision
}
approval: "需要审批？" {
  class: decision
}
ask: "请求用户审批"
approved: "审批通过？" {
  class: decision
}
execute: "execute\n超时与执行包装"
body: "工具实现\n文件、Shell、PTY 或子进程"
fs_guard: "文件系统守卫"
post: "post-execute\n接受、阻断或替换结果"
freeze: "规范化并冻结结果"
result: "记录 tool/result"
deny: "返回拒绝结果" {
  class: fail
}

call -> pre -> guard
guard -> approval: "允许或无意见"
guard -> deny: "拒绝"
approval -> execute: "不需要"
approval -> ask: "需要"
ask -> approved
approved -> execute: "通过"
approved -> deny: "拒绝或无法审批"
execute -> body -> fs_guard -> post -> freeze -> result
deny -> freeze
```

各阶段的职责并不重复。

1. `pre-execute` 收集权限策略、沙箱选项和调用上下文；
2. Guard 对具体调用给出允许、拒绝或不表态的意见；
3. 策略要求时进入 Approval，审批能力不可用时按拒绝处理；
4. `execute` 以瀑布式包装加入超时、遥测等执行控制，再调用工具本体；
5. 文件系统守卫限制实际读写范围，`post-execute` 可以接受、阻断或替换返回内容；
6. 结果经过规范化和 `finalizeContent` 后冻结，写入不可变的 `tool/result`。

Guard 采用单调约束。只要已有 Guard 明确拒绝，后续插件不能重新放行。这避免插件加载顺序把严格策略覆盖成宽松策略。

## 权限、审批与沙箱各管什么

这三层经常同时出现，但解决的问题不同。

| 边界 | 判断对象 | 作用时机 | 典型结果 |
| --- | --- | --- | --- |
| 权限预设 | 一类工具与资源的默认策略 | Agent 或会话配置时 | 选择沙箱模式和审批规则 |
| Guard | 当前这一次工具调用 | 执行前 | 允许、拒绝或不表态 |
| Approval | 需要用户确认的高风险动作 | Guard 之后、执行之前 | 用户批准或拒绝 |
| Sandbox | 工具实际能访问的系统资源 | 执行期间 | 限制文件、网络和进程能力 |
| 文件系统守卫 | 具体文件操作及其路径 | 文件访问时 | 阻止越界读写 |

例如 `workspace-write` 可以让进程在工作区内写文件，`danger-full-access` 则扩大执行边界。权限预设并不替代审批，一条命令即使运行在沙箱中，也可以因策略要求而等待用户确认。反过来，用户批准动作也不会解除沙箱本身的资源限制。

## 文件与进程为何要共享执行世界

文件系统、Shell、子进程、PTY 和代码运行时不能各自连接互不一致的环境。Shell 创建的文件需要立即能被编辑工具读取，PTY 中启动的进程也应看到同一工作目录和沙箱视图。

DeepSeek Harness 通过 Capability Seam 把这些实现放在同一个执行世界中。工具面向文件系统和子进程接口编程，本地 Provider、沙箱 Provider 或其它远程实现负责提供一致的底层环境。替换 Provider 时，相关能力应整体迁移，而不是只替换其中一个入口。

这也说明沙箱不是 Tool Registry 中的一组条件判断。它位于工具实现下面，约束真实文件和进程操作；Registry 与 Guard 则位于上层，决定一次调用是否可以进入这个执行环境。

## 结果为什么要冻结

工具完成后，`post-execute` 仍可阻断敏感输出、替换结果或附加模型上下文。管线随后把最终内容规范化并冻结，再创建 `tools/result` 和持久 `tool/result` 事件。

冻结之后，监听器不能继续修改模型即将看到的结果。这样，Session Log 中记录的内容与下一次模型请求使用的内容保持一致。额外上下文也会以可追踪方式进入会话，而不是由某个监听器在日志之外偷偷修改请求。

## PTC Code Mode 为什么不能绕过管线

PTC 模式允许模型编写 TypeScript 程序，通过 Code Mode SDK 组合多个工具调用。表面上看，它比逐个输出工具调用更接近直接执行代码，但安全边界没有改变。

外层 `run_code` 本身会经过标准工具管线，程序发起的每个子调用也会被序列化并重新分发到同一 Registry。每个子调用仍接受 Guard、审批、沙箱和结果规范化，并记录 `tool/code-dispatch` 等来源信息。任何拒绝都是最终约束，代码不能通过捕获错误重新放行被拒绝的动作。

Code Mode 的特殊之处是组织调用的方式，不是获得额外权限。为了保持工具 call 与 result 的消息邻接关系，子调用不会任意插入额外上下文，但这不影响其安全检查。

## 标准模式与极简模式改变了什么

安全管线与工具集合是两个独立层次。标准模式和极简模式都复用同一执行管线，只是向模型暴露的工具不同。

| 对比项 | 标准模式 | 极简模式 |
| --- | --- | --- |
| 工具范围 | 文件、Shell、搜索及其它通用能力 | 持久 Bash 与 `str_replace_editor` |
| 组合目标 | 覆盖复杂编码与任务委派 | 用少量原语完成任务 |
| 安全边界 | 统一 Guard、Approval 与 Sandbox | 同一条安全管线 |

具体工具集合由 Agent Preset 选择，下一篇再比较四种模式。无论 Preset 如何组合，工具实现都不能跳过这条执行管线。

## 小结

DeepSeek Harness 先记录模型提出的 `tool/call`，再依次经过前置策略、单调 Guard、可选审批、沙箱执行、后置处理和结果冻结，最终追加 `tool/result`。文件、Shell、PTY、Code Mode 子调用都收敛到同一边界，因此更换工具集合不会改变安全语义。

下一篇[《DeepSeek Harness 如何用 Preset 组合 Agent》](<./DeepSeek Harness 如何用 Preset 组合 Agent.md>)将从这条统一管线向上看，分析标准、PTC、极简和创造模式如何选择模型、工具与其它插件能力。

## 参考资料

- [Tool Execution Pipeline](https://deepseek-harness.github.io/deepseek-harness/reference/tool-execution-pipeline)
- [Agent Lifecycle](https://deepseek-harness.github.io/deepseek-harness/reference/agent-lifecycle)
- [Capability Seams](https://deepseek-harness.github.io/deepseek-harness/reference/capability-seams)
- [DeepSeek Harness 官网](https://deepseek.com/harness/)
