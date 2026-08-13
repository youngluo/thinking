---
createdAt: '2026-08-09 20:49'
order: 7
draft: true
---

# pi-ai 如何统一不同模型

不同模型提供商的请求格式、认证方式、流式协议和能力字段并不一致。`pi-ai` 把这些差异收敛到 Agent Runtime 可以稳定调用的模型、上下文和事件接口，同时保留各模型特有的能力。

本文以 Pi `v0.84.1` 为基准，从 `Models`、Provider、API 实现和事件流四个角度理解这层抽象。

## pi-ai 解决什么

如果 Agent Runtime 直接依赖 Anthropic、OpenAI 或 Google 的 SDK，模型切换就会把提供商差异扩散到循环、工具和 UI。`pi-ai` 把这些差异集中在模型通信层，让上层主要处理三类稳定对象：

- `Model` 描述要调用的模型及其能力元数据；
- `Context` 保存系统提示词、消息和工具；
- `AssistantMessageEventStream` 统一模型响应的流式事件。

上层选择模型并提供上下文，不必为每家提供商分别处理请求体和增量响应。`pi-ai` 只收录支持工具调用的对话模型，因为工具协议是 Agent 工作流的基础。

## Models 与 Provider 的职责

`Models` 是 Provider 的运行时集合，负责注册、查询、刷新和路由。Provider 则拥有自己的模型目录、认证方式和流式实现。`Models` 根据 `model.provider` 找到归属 Provider，再把请求交给它。

```ts fold title="models.ts"
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";

const models = createModels();
models.setProvider(anthropicProvider());

const model = models.getModel("anthropic", "claude-sonnet-4-6");
if (!model) throw new Error("Model not found");
```

`createModels()` 创建空集合，`setProvider()` 注册 Anthropic Provider，`getModel()` 同步读取最近一次已知的模型目录。Provider 主要承担以下职责：

| 职责 | 说明 |
| --- | --- |
| 模型元数据 | 模型 ID、上下文窗口、输出限制、输入类型和能力标记 |
| 认证 | API Key、OAuth 或动态凭证的解析方式 |
| 模型列表 | 内置模型目录以及可选的动态刷新 |
| 流式实现 | 选择 API 实现，把厂商响应转换为统一事件 |
| 兼容配置 | 处理厂商或代理服务的特殊请求要求 |

Provider 只处理自己的差异。增加新提供商时，通常只需组合模型目录、认证和 API 实现，不必修改 Agent Loop。

## API 实现与 Provider 的分层

`pi-ai` 把可复用的协议实现和具体提供商目录分开：

```d2 fold
direction: down

provider: "Provider 工厂" {
  class: group
  catalog: "模型目录与元数据"
  auth: 认证配置
  select: "选择 API 实现"
}

api: "API 实现" {
  class: group
  anthropic: "Anthropic Messages"
  openai: "OpenAI Responses / Completions"
  google: "Google Generative AI"
}

stream: "统一 AssistantMessageEventStream"

provider -> api: 根据模型和配置选择
api -> stream: 转换厂商响应
```

Provider 工厂决定「有哪些模型、如何认证、使用哪种 API」，`api/` 下的实现负责「如何发送请求和解析响应」。多个兼容 Provider 可以复用同一个 API 实现，例如不同网关共同使用 OpenAI Completions 协议；混合型 Provider 也可以按模型选择不同 API。

## 消息如何转换

Agent Runtime 使用的消息类型可以包含 UI 通知、扩展消息或其它自定义结构，但 LLM 通常只理解 user、assistant 和 tool result 等标准消息。请求前需要经过两层转换：

1. Agent 的 `transformContext` 在 `AgentMessage` 层裁剪或补充上下文；
2. `convertToLlm` 把消息转换成 `pi-ai` 的标准 `Message[]`；
3. API 实现根据 `Model` 和 Provider 配置生成厂商请求。

Agent 决定本轮带哪些消息，`pi-ai` 决定这些消息如何适配具体 API。跨 Provider 切换模型时，user 消息、工具调用和工具结果可以继续沿用；来源不同的 thinking block 会转换为普通文本，避免把某家协议的内部表示直接发给另一家。

## 流式事件如何统一

Provider 不把完整响应一次性返回，而是返回统一的事件流。文本增量、思考内容、工具调用增量、完成状态和错误都可以在流中按顺序传递。

```ts fold title="stream-model.ts"
const stream = models.streamSimple(model, context, options);

for await (const event of stream) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }
}
```

`streamSimple()` 用统一的 reasoning level 屏蔽不同模型的推理参数；需要厂商特有选项时，也可以改用 `stream()`。两者都返回 `AssistantMessageEventStream`，并通过 `stream.result()` 取得最终 `AssistantMessage`。

Agent Loop 消费这条流，再生成 `message_update`、`message_end` 等 Agent 事件。Provider 事件描述一次模型响应，Agent 事件描述一次运行过程，两层不要混用。

## 模型发现与延迟加载

模型目录同时承担「让用户选择模型」和「告诉运行时模型能力」两项职责。一个可扩展的设计需要区分已知目录和刷新动作：

- 同步读取返回最近一次已知的模型列表，让启动和模型选择不必等待网络；
- `models.refresh()` 显式刷新动态 Provider，并发执行且尽力返回可用结果；
- Provider 子路径只导入自己的目录和延迟 API wrapper；
- 厂商 SDK 在第一次请求对应 API 时加载，未使用的 Provider 不进入启动路径。

需要全部内置 Provider 时可以使用 `builtinModels()`；关注包体积的应用应显式注册所需 Provider。模型目录还携带上下文窗口、输入类型、推理能力和成本等元数据，供 Compaction 与产品界面使用。

## 厂商差异与错误边界

`Model` 元数据和 Provider 配置继续表达推理级别、图片输入、缓存、工具协议与请求头等差异。产品应优先按能力判断，再由 Provider 映射到具体 API 参数；确实需要某种 API 的特有选项时，可以用 `hasApi()` 缩窄模型类型。

请求失败可能来自认证、网络、限流、响应解析或模型能力不兼容。流式 API 不会把这些失败直接抛出迭代器，而是发出 `error` 事件，并让最终消息带上 `error` 或 `aborted` 的 `stopReason`。Agent Runtime 再决定重试、继续还是把错误交给产品；Provider 不应擅自重放可能包含工具副作用的整个 Agent turn。

## Agent Runtime 如何调用 pi-ai

在最小接入中，Agent 只需要拿到一个满足 `StreamFn` 形状的函数：

```ts fold title="agent-stream.ts"
const agent = new Agent({
  initialState: { systemPrompt, model, tools },
  streamFn: models.streamSimple.bind(models),
});
```

每次 turn，Agent Runtime 准备上下文并调用这个函数；`Models` 根据 `model` 路由到对应 Provider，再返回统一事件流。切换模型只改变 Model 与 Provider 的选择，Agent Loop 的状态、工具和事件协议保持不变。

## 小结

`pi-ai` 用 `Models` 管理 Provider 集合，由 Provider 承担模型目录、认证和路由，再由 API 实现连接具体协议。统一消息与事件流隔离了通信差异，能力元数据和 API 特有选项则保留模型差异，让 Agent Runtime 专注于循环、工具和状态。
