---
createdAt: '2026-08-09 22:15'
order: 12
draft: true
---

# TUI 如何呈现 Agent 运行过程

终端里的 Pi 不只是把日志逐行打印出来。`pi-tui` 把 Agent 运行事件转换成组件状态，再把组件布局成终端行，最后只更新发生变化的区域。本篇只关注这条呈现链路，以及 TUI 与 Agent Runtime 之间的边界。

## TUI 的布局模型

终端界面可以看成一个由字符单元组成的二维画布。每次渲染时，组件根据可用宽度计算自己的高度，并把内容转换成带有样式信息的终端行。父组件负责分配空间和排列子组件，子组件只关心自己的内容与尺寸。

这使 TUI 的布局和 Agent 状态相互独立：Agent 只产生消息、工具状态和运行结果，界面决定这些信息应该出现在标题区、对话区、工具区还是输入区。

```d2 fold
direction: down

screen: "Terminal screen" {
  class: group
  header: Header
  body: "Conversation area"
  footer: "Input and status"
}

state: "Agent view state" {
  class: group
  messages: Messages
  tools: "Tool states"
  input: "User input"
}

state.messages -> screen.body
state.tools -> screen.body
state.input -> screen.footer
```

## Agent 事件如何进入界面

TUI 不轮询 Agent，也不从 Session 文件推断每一次变化。产品层订阅 Agent Runtime 的事件，把事件转换为界面状态，再请求一次渲染。常见的事件与界面变化如下：

| 运行事件 | 界面反应 |
| --- | --- |
| `message_start`、`message_update` | 创建或增量更新 assistant 消息 |
| `tool_execution_start` | 显示工具名称和执行中状态 |
| 工具进度更新 | 更新工具区域，而不是追加重复日志 |
| `tool_execution_end` | 显示结果、错误或终止状态 |
| `agent_end` | 更新本轮完成状态，恢复输入焦点 |

事件适配层的职责是维护可渲染状态。它不负责决定下一次模型调用，也不应该在渲染组件里执行文件读写。这样，即使同一套 Agent Runtime 被接入 Web UI、RPC 或其它宿主，Agent 的执行语义仍然不会依赖终端。

```d2 fold
direction: right

runtime: "Agent Runtime" {
  class: group
  events: "Event stream"
}
adapter: "TUI event adapter"
state: "Render state"
tree: "Component tree"
frame: "Terminal frame"

runtime.events -> adapter
adapter -> state
state -> tree
tree -> frame
```

## VStack、HStack 与 ScrollView

`VStack`、`HStack` 和 `ScrollView` 是终端布局中三个容易混淆但职责清晰的组件：

| 组件 | 布局职责 | 适合放置的内容 |
| --- | --- | --- |
| `VStack` | 沿垂直方向排列子组件 | 标题、消息、工具区、输入区 |
| `HStack` | 沿水平方向排列子组件 | 状态标签、快捷键提示、工具摘要 |
| `ScrollView` | 在有限视口中显示可滚动内容 | 长对话、长工具结果、代码输出 |

一个编码 Agent 的界面通常会把消息列表放在 `ScrollView` 中，再用 `VStack` 组织标题、正文和底部输入区；消息中的状态行或元信息，则可以用 `HStack` 并排放置。布局树表达的是空间关系，不表达 Agent 的执行顺序。

```d2 fold
direction: down

root: Screen {
  class: group
  header: Header
  content: VStack {
    class: subgroup
    transcript: ScrollView {
      class: subgroup
      messages: Messages
      toolDetails: "Tool details"
    }
    input: "Input area"
  }
}

root.header -> root.content
root.content.transcript -> root.content.input
```

## 差分渲染与缓存

如果每个事件都重绘整个终端，长对话和流式输出会带来明显闪烁，也会重复写入大量没有变化的内容。差分渲染会保留上一帧和当前帧，把两者按终端行比较，只向终端发送发生变化的区域。

可以把一次更新抽象成四步：

1. Agent 事件改变界面状态；
2. 组件树根据新状态计算当前帧；
3. 渲染器将当前帧与上一帧比较，找出需要更新的行；
4. 终端只接收必要的光标移动、清理和文本写入。

组件缓存服务于同一个目标。没有变化的组件可以复用已经计算出的行，消息流入、工具状态变化或滚动位置改变时，只让受影响的区域失效。缓存不能改变事件顺序，也不能把尚未到达的工具结果提前显示出来。

## 输入、滚动与交互模式

输入处理通常分为三类：

- 编辑器输入改变当前草稿，并触发输入区重绘；
- 上下键、分页键或鼠标滚轮改变 `ScrollView` 的视口位置；
- 提交、取消和快捷键被转换为产品层动作，再由产品层决定如何调用 Agent。

因此，用户按下提交键时，TUI 只负责采集和呈现输入，不能直接把字符拼接进模型上下文。用户干预、继续任务或取消运行，都应沿产品层的控制接口进入 Agent Runtime。非交互模式也可以复用同一套运行逻辑，只是不创建终端布局和输入焦点。

## 界面与 Agent Runtime 的边界

两层的边界可以用职责表概括：

| 层次 | 负责什么 | 不应该负责什么 |
| --- | --- | --- |
| Agent Runtime | 推进循环、调用模型、执行工具、产生事件 | 终端尺寸、光标位置、组件布局 |
| `coding-agent` | 把运行事件和用户动作编排成产品行为 | 把终端渲染细节塞进 Agent Core |
| `pi-tui` | 组件布局、输入处理、差分渲染和终端输出 | 决定任务是否继续或工具是否执行 |

这个边界带来两个实际好处。第一，终端 UI 可以替换而不改变 Agent Loop。第二，同一套运行事件可以被日志、Web UI 或测试消费者复用。TUI 的价值不是拥有更多 Agent 决策，而是把已经发生的运行过程稳定、低成本地呈现出来。

## 小结

TUI 的主线是「事件更新状态，状态驱动组件树，组件树生成终端帧，渲染器只提交差异」。`VStack`、`HStack` 和 `ScrollView` 解决空间组织，缓存和差分渲染解决更新成本，输入层则把用户动作交回产品层。只要守住这个边界，界面就能随着 Agent Runtime 演进而独立变化。
