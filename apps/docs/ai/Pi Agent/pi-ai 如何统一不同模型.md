---
createdAt: '2026-08-09 20:49'
order: 7
draft: true
---

# pi-ai 如何统一不同模型

不同模型提供商的请求格式、认证方式、流式协议和能力字段并不一致。`pi-ai` 的作用不是把所有差异抹平，而是把它们收敛到 Agent Runtime 可以稳定调用的模型、上下文和事件接口。

本文以 Pi commit `936aff00918de1187f085f123c2812d8f2d67745` 为基准，结合 `packages/agent/docs/models.md`，从运行时集合、Provider、API 实现和事件流四个角度理解这层抽象。

## LLM 通信层解决什么

如果 Agent Runtime 直接依赖 Anthropic、OpenAI 或 Google 的 SDK，模型切换就会把提供商差异扩散到循环、工具和 UI。`pi-ai` 把这些差异集中在模型通信层，让上层主要处理三类稳定对象：

- `Model` 描述要调用的模型及其能力元数据；
- `Context` 描述系统提示词、消息和工具；
- `AssistantMessageEventStream` 描述模型响应的流式事件。

上层只需要选择模型并提供上下文，不需要为每家提供商分别处理请求体和增量响应。

## Models 运行时解决什么

`Models` 是一个运行时集合，负责保存已注册的 Provider 和模型，并提供查找与调用入口。它不应该承载某家厂商的认证、模型目录或请求格式，这些职责属于具体 Provider。

```ts fold title="models.ts"
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";

const models = createModels();
models.setProvider(anthropicProvider());

const model = models.getModel("anthropic", "claude-sonnet-4-6");
if (!model) throw new Error("Model not found");
```

这段代码中，`createModels()` 创建的是运行时集合，`setProvider()` 把一个具体 Provider 放进去，`getModel()` 返回带有统一类型的模型描述。Agent Runtime 可以继续使用这个 `model`，而不必知道它来自哪一家 SDK。

## Provider 如何承担元数据和认证

Provider 是「某个模型提供商如何接入 pi-ai」的边界，通常负责：

| 职责 | 说明 |
| --- | --- |
| 模型元数据 | 模型 ID、上下文窗口、输出限制、输入类型和能力标记 |
| 认证 | API Key、OAuth 或动态凭证的解析方式 |
| 模型列表 | 内置模型目录以及可选的动态刷新 |
| 流式实现 | 选择 API 实现，把厂商响应转换为统一事件 |
| 兼容配置 | 处理厂商或代理服务的特殊请求要求 |

Provider 只对自己的差异负责。这样，添加一个新提供商主要是增加 Provider 和必要的 API 实现，不需要修改 Agent Loop。

## API 与 Provider 如何分层

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

Provider 工厂决定「使用哪个模型和哪个 API」，`api/` 下的实现负责「如何发送请求和解析响应」。同一个 API 实现可以被多个兼容的 Provider 复用，Provider 也可以通过配置覆盖 endpoint、headers 或能力映射。

## Provider Registry 如何组织提供商

注册表的价值在于让提供商按需加入，而不是让导入 `pi-ai` 就加载所有厂商 SDK。典型的加载过程是：

1. 创建 `Models` 运行时集合；
2. 显式注册内置或自定义 Provider；
3. Provider 暴露自己的模型目录和认证方式；
4. 上层通过 `getModel()` 选择具体模型，并用统一的 `streamSimple()` 发起请求。

这种组织方式也支持按需导入。只使用某个 Provider 时，不必因为集合入口而提前加载其它重型 SDK；Provider 的动态模型列表也可以通过显式的异步刷新更新，而不是在每次读取时隐式联网。

## 消息模型与请求转换

Agent Runtime 使用的消息类型可以包含 UI 通知、扩展消息或其它自定义结构，但 LLM 通常只理解 user、assistant 和 tool result 等标准消息。请求前需要经过两层转换：

1. Agent 的 `transformContext` 在 `AgentMessage` 层裁剪或补充上下文；
2. `convertToLlm` 把消息转换成 `pi-ai` 的标准 `Message[]`；
3. `pi-ai` 再根据 `Model` 的 API 和 Provider 配置，把标准消息转换成厂商请求格式。

这让消息转换的责任保持分层：Agent 决定本轮带哪些消息，`pi-ai` 决定这些消息如何适配具体 API。

## EventStream 与 streamSimple 如何传递响应

Provider 不把完整响应一次性返回，而是返回统一的事件流。文本增量、思考内容、工具调用增量、完成状态和错误都可以在流中按顺序传递。

```ts fold title="stream-model.ts"
const stream = models.streamSimple(model, context, options);

for await (const event of stream) {
  if (event.type === "text_delta") {
    process.stdout.write(event.delta);
  }
}
```

`streamSimple()` 是面向 Agent Runtime 的便捷入口，调用者不需要先拼出某一家 API 的请求对象。Agent Loop 消费这条流，把它进一步转换成 `message_update`、`message_end` 等 Agent 事件；UI 因此只处理统一的运行事件，不直接处理 Provider 响应。

## 模型列表与延迟加载

模型目录同时承担「让用户选择模型」和「告诉运行时模型能力」两项职责。一个可扩展的设计需要区分已知目录和刷新动作：

- 同步读取返回最近一次已知的模型列表，让启动和模型选择不必等待网络；
- 显式调用异步刷新，获取动态目录并更新运行时集合；
- Provider 和 API 实现按需加载，避免为未使用的厂商引入启动成本；
- 选择模型时保留上下文窗口、输入类型、推理级别和成本等元数据，供 Compaction 和产品界面使用。

模型列表不是静态常量，而是 Provider 能力的一部分；但刷新失败不应该破坏已经可用的本地目录。

## 厂商特有能力如何保留

统一接口不等于只保留最低公分母。`Model` 元数据和 Provider 兼容配置可以继续表达推理级别、图片输入、缓存、工具协议或请求头等差异。

上层的原则是「按能力判断，不按厂商名称判断」。例如产品需要展示推理级别时读取模型能力，Provider 再把这个能力映射到具体 API 的参数。这样既能保留厂商特性，也不会让 Agent Loop 到处出现 `if provider === ...`。

## 错误与重试的边界

请求失败可能来自认证、网络、限流、响应解析或模型能力不兼容。`pi-ai` 负责把 Provider 层的失败转换为统一的流式错误和完成状态，并在适合的请求层处理重试或退避；Agent Runtime 则决定这次 turn 是否继续、结束或把错误暴露给产品。

这条边界很重要：Provider 不应该擅自重放包含工具副作用的 Agent turn，Agent 也不应该假设所有网络错误都可以安全重试。是否重试需要结合请求是否已经产生副作用、模型返回的停止原因和产品的任务策略。

## AgentHarness 如何发起模型调用

在最小接入中，Agent 只需要拿到一个满足 `StreamFn` 形状的函数：

```ts fold title="agent-stream.ts"
const agent = new Agent({
  initialState: { systemPrompt, model, tools },
  streamFn: models.streamSimple.bind(models),
});
```

每次 turn，Agent Runtime 准备上下文并调用这个函数；`pi-ai` 根据 `model` 找到对应 Provider，发起请求并返回统一事件。模型替换发生在 Provider 和 Model 选择层，Agent Loop 的状态、工具和事件协议不需要跟着改变。

## 小结

`pi-ai` 通过 `Models` 管理运行时集合，用 Provider 承担模型目录、认证和差异适配，用 API 实现连接具体协议，再用 `streamSimple()` 输出统一事件。它屏蔽的是通信差异，不是模型能力差异；Agent Runtime 因此可以专注于循环、工具和状态。
