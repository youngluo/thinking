---
createdAt: '2026-08-09 20:49'
order: 9
draft: true
---

# coding-agent 如何把运行时变成编码 Agent

`pi-agent-core` 只知道模型、消息、工具和运行事件，并不知道项目目录、终端命令、认证配置或用户如何选择 Session。`pi-coding-agent` 把这些产品能力组合起来，才形成一个可以直接使用的编码 Agent。

本文以 Pi commit `936aff00918de1187f085f123c2812d8f2d67745` 为基准，说明产品层如何连接运行时和编码场景。具体工具实现、Session 树和 TUI 渲染分别由对应专题负责，这里只看它们如何被组合。

## 从运行时到产品层

编码 Agent 产品需要在通用循环之外补充一组环境能力：

| 产品能力 | 作用 |
| --- | --- |
| 工作目录 | 确定文件工具和命令执行的边界 |
| 编码工具 | 提供读取、搜索、编辑、写入和命令执行能力 |
| 模型与认证 | 让用户选择模型，并为 Provider 提供凭证 |
| Session 管理 | 创建、恢复、分支和保存任务历史 |
| 资源加载 | 读取上下文文件、Skills、Prompt Templates 和 Extensions |
| 交互入口 | 接收用户输入，呈现事件，处理命令和确认 |

这些能力在产品层汇合，再以 `Agent` 所需的模型、工具、上下文和事件订阅方式接入运行时：

```d2 fold
direction: down

product: pi-coding-agent {
  class: group
  config: "设置与认证"
  resources: "上下文与扩展"
  tools: 编码工具
  session: "Session 管理"
}
runtime: pi-agent-core {
  class: group
  agent: Agent
  loop: "Agent Loop"
}
model: pi-ai
surface: "CLI / TUI / RPC / SDK"

product.config -> product.session: 创建运行环境
product.resources -> product.agent: 组装上下文
product.tools -> product.agent: 注入工具
product.session -> runtime.agent: 恢复消息和状态
runtime.agent -> runtime.loop
runtime.loop -> model: 请求模型
runtime.loop -> product.tools: 调度执行
runtime.agent -> surface: 发布事件
```

产品层负责组合，Agent Runtime 负责推进。两者的边界清楚后，同一个 Runtime 才能被 CLI、RPC 或其它宿主复用。

## Session 如何编排一次编码任务

产品层通常由 Session 管理器负责打开或创建 JSONL 文件，再把当前分支恢复成 Agent 可以使用的消息上下文。一次编码任务的高层流程是：

1. 根据工作目录和启动参数选择 Session；
2. 从当前 leaf 恢复消息、模型选择和相关设置；
3. 创建或配置 `Agent`，注入编码工具和产品级 Hook；
4. 调用 `prompt()`，把运行事件转给 CLI、TUI 或其它宿主；
5. 在事件或 `agent_end` 边界保存消息、工具结果和产品状态。

Session Manager 负责持久化结构，Agent 负责当前运行，产品层负责把两者连接起来。Session 不应该被当作 Agent state 的简单别名，产品也不应该把 UI 临时状态全部写进模型上下文。

## 核心工具如何接入

编码 Agent 的工具集合通常围绕工作目录组织：

- 读取和搜索工具负责观察项目；
- 编辑和写入工具负责产生代码变更；
- Bash 或其它命令工具负责运行检查、测试和构建；
- 输出截断、路径限制和错误转换负责控制结果进入上下文的大小与形状。

产品层创建这些工具并将它们放入 `Agent.state.tools`，Agent Runtime 只负责统一描述、校验、调度和回注。工具的实际权限、超时、沙箱和确认策略则由 `coding-agent` 或部署环境提供。

工具不是编码 Agent 的全部。真正的产品体验还需要把工具调用转换成可读的状态，例如显示正在读取哪个文件、命令是否完成、编辑是否成功，以及错误是否需要用户介入。

## 模型、认证与设置

`coding-agent` 需要把「用户想用哪个模型」转换成 Agent Runtime 可以使用的 `Model`，并在请求模型时提供认证信息。典型职责包括：

| 组件 | 职责 |
| --- | --- |
| Model Registry | 汇总内置和自定义模型，处理选择与切换 |
| Auth Storage | 保存 API Key、OAuth 凭证或其它认证信息 |
| Settings | 合并全局、项目和命令行配置 |
| Provider 适配 | 将选中的模型和认证传给 `pi-ai` |

这些组件将易变的用户配置隔离在产品层。Agent Loop 只接收已经解析好的模型和 `streamFn`，不需要读取配置文件或决定凭证从哪里来。

## CLI 与 TUI 的交互边界

CLI 和 TUI 都是产品宿主，但职责不同：

- CLI 负责解析启动参数、模式选择、Session 选项和显式命令；
- TUI 负责输入编辑、消息展示、工具状态、确认和滚动；
- Agent Runtime 通过事件向它们报告消息增量、工具执行和运行结束；
- 用户干预通过 `prompt()`、Steering、Follow-up 或产品命令重新进入运行时。

同一套事件可以被不同宿主消费。交互式 TUI 需要实时渲染，JSON 或 RPC 模式则可以把事件作为机器可读协议输出，但它们不应该各自重新实现 Agent Loop。

这也解释了为什么 `pi-coding-agent` 不是一个「加了终端 UI 的 Agent 类」。它还负责资源发现、认证、Session、工具和运行模式，是把通用 Runtime 组织成编码产品的 Harness。

## 小结

`pi-coding-agent` 通过工作目录、编码工具、Session、模型认证、资源加载和 CLI/TUI，把通用 Agent Runtime 放入真实的软件开发场景。Runtime 负责循环和事件，产品层负责组合环境与交互；这条边界既支持直接使用，也为构建新宿主和新产品留下空间。
