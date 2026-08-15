---
title: DeepSeek Harness 如何驱动并记录一次 Agent 运行
createdAt: '2026-08-15 15:04'
draft: true
order: 3
---

DeepSeek Harness 的 Agent Loop 不只是反复调用模型。它需要在每一步组装模型上下文、执行工具、记录事件，并判断当前 Turn 应该继续还是结束。

这条链路同时满足两个目标。一方面，模型能够根据最新结果继续推理；另一方面，模型实际看到的内容必须已经进入会话记录，之后才能恢复、分叉和回放。

## Turn 与 Step 如何划分

Harness 用 Turn 和 Step 表示两个不同粒度的运行单元。

| 概念 | 起点 | 终点 | 包含内容 |
| --- | --- | --- | --- |
| Turn | Agent 领取一批输入 | Agent 决定停止并交还控制权 | 零个或多个 Step |
| Step | 组装一次模型请求 | 模型响应及其工具调用处理完成 | 一次模型请求、零个或多个工具调用 |

用户消息进入 inbox 后不一定立即触发独立 Turn。Loop 会在 Turn 开始时领取当前输入，并在后续 Step 之间检查新消息、上下文注入和停止条件。这样，运行中的补充输入可以在明确的事件边界进入模型上下文。

## 一次运行如何推进

下面的图覆盖从领取输入到结束 Turn 的主链路。工具内部的审批和沙箱流程留到下一篇展开。

```d2 fold
direction: down

turn: "Turn" {
  class: group
  start: "turn/start"
  inbox: "领取 inbox 输入"

  step: "Step" {
    class: subgroup
    assemble: "组装系统提示词、历史与工具 Schema"
    pre_step: "agent/pre-step"
    request: "模型请求与流式响应"
    append: "写入 assistant/message 与 tool/call"
    tools: "执行工具并写入 tool/result"
  }

  stopping: "agent/turn-stopping"
  decision: "继续下一个 Step？" {
    class: decision
  }
  end: "turn/end"
}

turn.start -> turn.inbox -> turn.step.assemble -> turn.step.pre_step -> turn.step.request
turn.step.request -> turn.step.append -> turn.step.tools -> turn.stopping -> turn.decision
turn.decision -> turn.step.assemble: "继续"
turn.decision -> turn.end: "结束"
```

主链路可以拆成六步。

1. Loop 开启 Turn，从 inbox 领取当前输入；
2. 系统提示词插件收集提示词片段，工具服务提供本 Step 可见的 Schema；
3. `agent/pre-step` 允许压缩、提醒和其它插件在模型请求前注入上下文；
4. LLM Adapter 发起请求，并把流式内容转换为统一的 Agent 事件；
5. 完整回复与工具调用进入 Session Log，工具执行结果随后追加；
6. `agent/turn-stopping` 汇总停止意见，决定续跑下一个 Step 还是结束 Turn。

如果模型没有调用工具，或者停止条件已经满足，Turn 可以在当前 Step 后结束。如果模型发起工具调用，结果会成为下一个 Step 的历史输入，Loop 再次组装上下文并请求模型。

## 三类事件分别记录什么

DeepSeek Harness 没有把所有变化都写进一种事件流，而是按生命周期分成三类。

| 事件类型 | 是否持久化 | 主要用途 | 示例 |
| --- | --- | --- | --- |
| Session Event | 是 | 还原会话语义和模型历史 | `user/message`、`assistant/message`、`tool/call`、`tool/result` |
| Agent Event | 否 | 表示当前进程内的实时运行状态 | Turn、Step、流式 chunk、等待审批 |
| Capability Event | 视能力而定 | 连接工具、压缩、子 Agent 等插件扩展点 | `agent/pre-step`、工具前后置事件 |

持久会话事件是事实记录，实时 Agent 事件是运行信号。UI 可以用流式 chunk 即时渲染回复，但恢复会话时仍以完整的 `assistant/message` 为准。能力事件则让插件参与流程，不等于所有事件都会成为会话历史。

## Session Event Log 如何还原模型输入

Session 使用仅追加的 Event Log。已有事件不会原地修改，新的状态通过追加事件表达。模型历史、Trajectory 和查询视图都从同一条事件流派生。

其中最关键的不变量是：模型可见的内容必须能够从日志重建。它约束了各类输入进入模型的顺序。

- 系统提示词由各插件贡献的片段和当前工具 Schema 组装，并保留对应来源；
- 模型推理内容、最终回复和工具调用来自 LLM Adapter 产生的消息事件；
- 工具结果在执行并规范化后写入 `tool/result`，再进入下一次模型请求；
- 子 Agent 的创建、委派和返回结果通过相应会话事件保留来源；
- 压缩摘要、提醒等上下文注入先落到可追踪的日志表面，再对模型可见。

Trajectory 视图不是另一份运行记录。它把系统提示词、模型内容、工具结果和注入上下文追溯到原始事件，帮助使用者判断一段上下文为何出现，以及由哪个插件或动作产生。

## 恢复、分叉、检索与回放如何复用日志

仅追加日志把“运行过程”和“可恢复状态”统一成同一份数据。

| 能力 | 如何使用事件流 |
| --- | --- |
| 恢复 | 读取现有事件，重建会话与 Agent 状态后继续追加 |
| 分叉 | 选择父会话的历史位置作为新分支起点 |
| 检索 | 按事件类型、文本或来源查询会话内容 |
| 回放 | 用已记录的模型与工具表面重现运行轨迹 |
| 持久化 | 由 JSONL、SQLite 等 Provider 保存同一事件模型 |
| 遥测 | 关联 Turn、Step、模型请求和工具调用的时间与用量 |

Session Query 会区分当前模型可见的事件、已被摘要覆盖的事件，以及只保留在日志中的运行记录。这样，查询和审计可以看到完整历史，模型请求却只携带当前有效上下文。

## 长任务如何控制上下文

随着 Step 增加，会话日志会持续增长，但模型上下文窗口有限。Harness 将 token 计量和 Compaction 放在模型请求边界处理，而不是改写原始日志。

压缩插件可以在 `agent/pre-step` 检测上下文压力，也可以在模型 Adapter 报告上下文溢出后介入。典型过程先裁剪较早的工具结果，再为更早的对话生成摘要。原始事件仍保留在日志中，模型可见表面则由新的摘要事件替代。

Compaction 是可选能力，不属于 Agent Loop 内核。Loop 只提供重试和上下文更新的边界；具体何时压缩、采用什么摘要模型，由 Provider 和配置决定。系统只有在模型可见表面确实发生变化后才重试，避免对同一份超长上下文无限请求。

## 接入层如何消费同一运行状态

Web、Headless 和 SDK 共享同一个 Agent Loop 和 Session Log，只采用不同的驱动方式。

- Web UI 订阅实时 Agent 事件，展示流式回复、Trajectory、工具状态和审批请求；
- Headless 入口创建会话并等待 Turn 结束，适合输出最终结果；
- SDK 可以发送输入、订阅事件，并按需读取持久会话。

因此，UI 不是运行语义的唯一来源。进程重启后，持久事件仍能重建会话；实时状态只负责描述当前这一次执行正在发生什么。

## 小结

DeepSeek Harness 用 Turn 管理一次交互，用 Step 管理一次模型请求和工具批次，再用仅追加 Session Event Log 固化模型真正看到的内容。实时 Agent 事件负责驱动界面，Capability Event 负责扩展流程，恢复、分叉、检索、回放和压缩则围绕同一条日志工作。

下一篇[《DeepSeek Harness 的工具执行与安全边界》](<./DeepSeek Harness 的工具执行与安全边界.md>)继续拆解 `tool/call` 写入之后，工具如何经过 Guard、审批和沙箱才产生 `tool/result`。

## 参考资料

- [Agent Lifecycle](https://deepseek-harness.github.io/deepseek-harness/reference/agent-lifecycle)
- [DeepSeek Harness Architecture Reference](https://deepseek-harness.github.io/deepseek-harness/reference/)
- [Session Query](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/session-query)
- [Compaction](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/compaction)
