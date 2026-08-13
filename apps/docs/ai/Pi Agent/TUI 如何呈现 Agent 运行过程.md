---
createdAt: '2026-08-09 22:15'
order: 13
draft: true
---

# TUI 如何呈现 Agent 运行过程

终端里的 Pi 会持续更新消息、工具状态和用户输入。`pi-tui` 把这些组件状态渲染为终端行，再由 main-screen 或 alternate-screen 渲染器提交变化区域。Agent 事件如何转换为组件状态属于 `pi-coding-agent`，布局、输入与终端输出属于 `pi-tui`。

本文以 Pi `v0.84.1` 为基准，关注「运行事件 → 界面状态 → 组件树 → 终端帧」这条呈现链路。

## Agent 事件如何进入界面

TUI 不轮询 Agent，也不从 Session 文件推断每一次变化。产品层订阅 Agent Runtime 的事件，把事件转换为界面状态，再请求一次渲染。常见的事件与界面变化如下：

| 运行事件 | 界面反应 |
| --- | --- |
| `message_start`、`message_update` | 创建或增量更新 assistant 消息 |
| `tool_execution_start` | 显示工具名称和执行中状态 |
| 工具进度更新 | 更新工具区域，而不是追加重复日志 |
| `tool_execution_end` | 显示结果、错误或终止状态 |
| `agent_end` | 更新本轮完成状态 |
| `agent_settled` | 在重试、压缩和 Follow-up 都结束后恢复完整空闲状态 |

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

## TUI 的布局模型

`pi-tui` 暴露统一的 `TUI` 接口，并提供两种渲染器：

| 渲染器 | 屏幕模型 | 滚动归属 |
| --- | --- | --- |
| `TuiMainScreen` | 在主终端缓冲区渲染文档，保留 scrollback | 终端负责 |
| `TuiAltScreen` | 占用固定高度的 alternate screen viewport | 应用负责 |

组件通过 `render(width)` 生成终端行，渲染器再决定如何把这些行放到屏幕上。`TuiMainScreen` 适合保留终端原生历史；`TuiAltScreen` 适合固定区域、独立滚动和更完整的应用式交互。

```d2 fold
direction: down

state: "coding-agent 界面状态"
components: "pi-tui 组件树"
renderer: TUI {
  class: group
  main: TuiMainScreen
  alt: TuiAltScreen
}
terminal: Terminal

state -> components
components -> renderer.main
components -> renderer.alt
renderer -> terminal
```

## VStack、HStack 与 ScrollView

`VStack`、`HStack` 和 `ScrollView` 是终端布局中三个容易混淆但职责清晰的组件：

| 组件 | 布局职责 | 适合放置的内容 |
| --- | --- | --- |
| `VStack` | 沿垂直方向排列子组件 | 标题、消息、工具区、输入区 |
| `HStack` | 沿水平方向排列子组件 | 状态标签、快捷键提示、工具摘要 |
| `ScrollView` | 在有限视口中显示可滚动内容 | 长对话、长工具结果、代码输出 |

这些约束式布局主要服务于 `TuiAltScreen`。`VStack` 和 `HStack` 分配固定 viewport 中的纵向与横向区域，`ScrollView` 管理某个区域的滚动；`TuiMainScreen` 则让终端管理 scrollback，不使用这套 viewport 语义。

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

如果每个事件都重绘整个终端，长对话和流式输出会带来闪烁，也会重复写入大量未变化内容。两种渲染器采用不同的差分策略：

- `TuiMainScreen` 在普通更新时定位到首个变化行，清理其后区域并重绘；宽度变化或 viewport 上方内容变化时才完整重绘；
- `TuiAltScreen` 拥有固定 viewport，直接更新变化的屏幕行，并在用户停留底部时跟随流式输出。

可以把一次更新抽象成四步：

1. Agent 事件改变界面状态；
2. 组件树根据新状态计算当前帧；
3. 渲染器将当前帧与上一帧比较，找出需要更新的行；
4. 终端只接收必要的光标移动、清理和文本写入。

组件保留自身渲染缓存，layout geometry 则在每个请求帧中重新计算。渲染器还使用 CSI 2026 synchronized output 包裹一次提交，使多个光标移动和文本写入原子呈现。缓存和差分都只减少终端写入，不能改变事件顺序。

## 输入、滚动与交互模式

输入处理通常分为三类：

- 编辑器输入改变当前草稿，并触发输入区重绘；
- 在 alternate-screen 模式中，上下键、分页键或鼠标滚轮改变 `ScrollView` 的视口位置；
- 提交、取消和快捷键被转换为产品层动作，再由产品层决定如何调用 Agent。

因此，用户按下提交键时，TUI 只负责采集和呈现输入，不能直接把字符拼接进模型上下文。用户干预、继续任务或取消运行，都应沿产品层的控制接口进入 Agent Runtime。非交互模式也可以复用同一套运行逻辑，只是不创建终端布局和输入焦点。

## 界面与 Agent Runtime 的边界

两层的边界可以用职责表概括：

| 层次 | 负责什么 | 不应该负责什么 |
| --- | --- | --- |
| Agent Runtime | 推进循环、调用模型、执行工具、产生事件 | 终端尺寸、光标位置、组件布局 |
| `coding-agent` | 把运行事件和用户动作编排成产品行为 | 把终端渲染细节塞进 Agent Core |
| `pi-tui` | 组件布局、输入处理、差分渲染和终端输出 | 解释 Agent 事件的业务含义 |

这个边界带来两个实际好处。第一，终端 UI 可以替换而不改变 Agent Loop。第二，同一套运行事件可以被日志、Web UI 或测试消费者复用。TUI 的价值不是拥有更多 Agent 决策，而是把已经发生的运行过程稳定、低成本地呈现出来。

## 小结

TUI 的主线是「事件更新状态，状态驱动组件树，组件树生成终端行，渲染器提交屏幕差异」。`TuiMainScreen` 保留终端 scrollback，`TuiAltScreen` 提供应用管理的 viewport；`VStack`、`HStack` 与 `ScrollView` 为后者组织受限布局。Agent Runtime 不感知这些终端细节。
