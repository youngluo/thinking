---
createdAt: '2026-08-12 21:37'
order: 10
draft: true
---

# SDK 与 RPC 如何接入应用

`pi-coding-agent` 不只提供终端产品，也提供进程内 SDK 和基于子进程的 RPC。两者复用同一套 `AgentSession` 能力，但运行边界、事件传递和生命周期管理方式不同。

本文以 Pi `v0.84.1` 为基准，说明应用如何创建 Session、发送 prompt、订阅事件，并在 SDK 与 RPC 之间做选择。

## 两种接入方式解决什么

| 接入方式 | 运行边界 | 适合的场景 |
| --- | --- | --- |
| SDK | 与宿主运行在同一个 JavaScript 进程 | Node.js 应用、自定义 CLI、测试与深度定制 |
| RPC | Pi 作为独立子进程，通过 stdin/stdout 通信 | IDE、其它语言应用、进程隔离与独立升级 |

SDK 直接调用 TypeScript API，可以注入自定义工具、模型运行时和资源加载器。RPC 将 coding-agent 保留在独立进程中，宿主只依赖 JSONL 协议，不需要理解内部对象。

```d2 fold
direction: right

host: 宿主应用

sdk: SDK {
  class: group
  session: AgentSession
  runtime: AgentSessionRuntime
}

rpc: RPC {
  class: group
  process: "Pi 子进程"
  protocol: "stdin / stdout JSONL"
}

core: "同一套 coding-agent 能力"

host -> sdk: "进程内调用"
host -> rpc.protocol: "命令与响应"
rpc.protocol -> rpc.process
sdk -> core
rpc.process -> core
```

## SDK 如何创建和管理 Session

最小接入通过 `createAgentSession()` 创建一个 `AgentSession`。`ModelRuntime` 管理模型与认证，`SessionManager` 决定会话是否持久化：

```ts fold title="create-session.ts"
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create();
const { session } = await createAgentSession({
  modelRuntime,
  sessionManager: SessionManager.inMemory(),
});

await session.prompt("检查当前目录中的 TypeScript 错误");
```

`AgentSession` 管理 prompt、消息队列、模型状态、Compaction、Session Tree 导航和事件。`prompt()` 在请求被接受后持续等待，直到本次运行及其重试完成；运行中的失败通过事件和消息呈现。

需要执行 new、resume、fork、clone 或 import 时，应使用 `AgentSessionRuntime`。这些操作可能改变 cwd、资源和 Session Manager，因此会替换整个 `AgentSession`。替换后，旧 Session 上的事件订阅和 Extension 绑定不会自动迁移。

## 如何订阅运行事件

SDK 通过 `session.subscribe()` 直接接收 `AgentSessionEvent`：

```ts fold title="subscribe-events.ts"
const unsubscribe = session.subscribe((event) => {
  if (
    event.type === "message_update" &&
    event.assistantMessageEvent.type === "text_delta"
  ) {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await session.prompt("解释 package.json 中的脚本");
unsubscribe();
```

宿主可以用 `message_update` 更新流式文本，用工具事件更新执行状态，也可以监听 Compaction、Session 和队列事件。订阅者只消费事实，不应在渲染层重新实现 Agent Loop。

## RPC 如何交换请求与事件

RPC 模式通过 `pi --mode rpc` 启动。宿主向 stdin 写入一行一个 JSON 命令，再从 stdout 读取三类记录：

- `response` 表示命令是否被接受或执行成功；
- Agent 事件持续描述消息、工具和 Session 状态；
- Extension UI 请求要求宿主完成确认、选择或输入等交互。

```json fold title="rpc.jsonl"
{"id":"req-1","type":"prompt","message":"检查当前目录中的 TypeScript 错误"}
{"id":"req-1","type":"response","command":"prompt","success":true}
{"type":"agent_start"}
{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"我先检查项目配置。"}}
{"type":"agent_end"}
```

`response.success: true` 只表示 prompt 已被接受、排队或立即处理，不表示整次 Agent run 已经完成。宿主需要继续消费事件，并根据 `agent_end`、错误消息或自己的任务状态判断运行结果。

RPC 使用严格 JSONL framing，只以 LF 分隔记录。客户端需要自行处理 UTF-8 分块和残缺行，不能把 JSON 字符串中的 Unicode 行分隔符误判为协议边界。命令的可选 `id` 用于关联 response，不应拿它替代工具事件中的 `toolCallId`。

## 生命周期与错误处理

SDK 和 RPC 对错误的暴露方式不同：

| 场景 | SDK | RPC |
| --- | --- | --- |
| prompt 预检失败 | `preflightResult(false)`，调用正常结束 | `response.success: false` |
| 接受后的模型或工具失败 | 通过事件和最终消息报告 | 通过后续事件和消息报告 |
| Session 替换失败 | 方法抛出，由宿主决定恢复方式 | 对应命令返回失败 response |
| 主动取消 | `session.abort()` | 发送 `abort` 命令 |
| 资源释放 | 取消订阅并调用 `session.dispose()` | 关闭 stdin，并管理子进程退出 |

应用需要区分「命令是否被接受」和「任务最终是否成功」。前者属于调用边界，后者由 Agent 运行事件与最终消息决定。自动重试、Compaction 和 Follow-up 也可能让两者相隔较长时间。

## 如何选择接入方式

Node.js 或 TypeScript 应用通常优先使用 SDK。它没有序列化和子进程通信成本，可以直接注入工具、Resources 与 ModelRuntime，也能获得完整类型信息。

以下情况更适合 RPC：

- 宿主不是 JavaScript 运行时；
- 希望 Pi 独立安装、升级或重启；
- 需要把 Agent 的进程权限和资源占用与宿主隔离；
- 产品已经具备可靠的子进程与 JSONL 协议管理能力。

RPC 提供的是进程边界，不是安全沙箱。Pi 子进程仍然拥有启动它的用户权限；需要更强隔离时，还要结合容器、受限账户或远程执行环境。

## 小结

SDK 通过 `AgentSession` 和 `AgentSessionRuntime` 在进程内嵌入 coding-agent，RPC 则把相同能力包装成子进程 JSONL 协议。选择的关键是运行边界：需要深度定制和类型安全时使用 SDK，需要跨语言、独立生命周期或进程隔离时使用 RPC。
