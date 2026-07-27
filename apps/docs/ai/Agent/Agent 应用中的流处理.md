---
createdAt: '2026-06-12 00:00'
order: 7
---

# Agent 应用中的流处理

做 Agent 应用时，流处理几乎绕不开。普通接口通常是“请求发出去，服务端处理完，一次性返回结果”。但 Agent 不太一样：它可能要先理解问题，再调用模型，再决定要不要查资料、调用工具、执行任务，最后才组织回答。如果整个过程结束后才返回，用户看到的就是一段长时间空白。

流式处理解决的是这个体验问题：结果还没有完全生成完，前端就可以先拿到一部分内容，边接收边展示。

不过在 Agent 应用里，流不只是“模型 token 一个个返回”。再展开看，它还包括：

- 模型正在生成的文本；
- Agent 当前执行到哪一步；
- 工具调用什么时候开始；
- 工具参数是否已经生成；
- 工具执行结果什么时候回来；
- 什么时候出错；
- 什么时候结束。

SSE 协议本身这里不再展开，[《SSE 和 NDJSON 指南》](<./SSE 和 NDJSON 指南.md>)已经讲过 SSE、NDJSON、WebSocket 的格式和区别。本文关心的是工程链路：Agent 应用里的流从哪里产生、谁来中转、前端最后怎么消费。

## 什么是流

在这里，“流”可以先理解成一种返回方式。普通响应像是一次性把整杯水倒给你：

```text
request -> wait -> full response
```

流式响应像是水一边产生，一边流出来：

```text
request -> chunk -> chunk -> chunk -> done
```

对大模型应用来说，模型生成第一个 token 后，服务端就可以把它返回给前端，不必等整段回答全部生成完。前端拿到片段后立刻渲染，用户就会看到答案逐步出现。

这件事对 Agent 更重要。Agent 的等待时间不只来自模型生成，还来自检索、工具调用、权限判断、代码执行、外部接口请求。即使最终答案还没准备好，前端也可以先展示“正在检索资料”“正在调用工具”“正在生成总结”。所以流处理的核心不是“每次返回多少字”，而是把一个长过程拆成连续事件，让消费端可以一边接收、一边处理。

## 关键 API 速览

流处理会同时出现在浏览器和服务端。为了避免混在一起，先按运行位置拆开看。

### 浏览器端

浏览器端关心的是：请求怎么发出去，响应体怎么一段段读出来，用户取消时怎么停掉。`fetch` 是发起请求的入口。普通请求里，我们经常这样用：

```ts fold
const response = await fetch('/api/chat')
const data = await response.json()
```

这表示等响应体完整回来后，再一次性解析 JSON。流式请求不能这样处理，因为响应体可能会持续返回，甚至很久都不会结束。这时要读取 `response.body`：

```ts fold
const response = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ message: '介绍一下 RAG' }),
})

const stream = response.body
```

`response.body` 才是后续流式读取的入口。它通常是一个 `ReadableStream<Uint8Array>`，表示这里有一段数据可以持续读取，但不保证一次读完。你可以把它想成一个异步的数据源：每次读，可能拿到一个 chunk；等服务端写入更多内容后，又能继续读到新的 chunk。

`getReader()` 用来从 `ReadableStream` 上拿到读取器，常见写法是：

```ts fold
const reader = response.body?.getReader()

while (reader) {
  const { value, done } = await reader.read()
  if (done) break
  // value 是本次读到的 Uint8Array
}
```

这里的 `value` 不是字符串，而是二进制数据。浏览器不知道这些字节应该按什么编码解释，所以还需要用 `TextDecoder` 把 `Uint8Array` 解码成字符串。

```ts fold
const decoder = new TextDecoder()
const text = decoder.decode(value, { stream: true })
```

`{ stream: true }` 很重要。因为一个中文字符可能被拆在两个 chunk 里，如果每次都当成独立文本解码，可能出现乱码。开启 stream 模式后，`TextDecoder` 会保留未完成的字节，等下一个 chunk 到来后再拼起来解码。

`TextDecoderStream` 是流式版本，可以直接把二进制流转换成文本流：

```ts fold
const textStream = response.body?.pipeThrough(new TextDecoderStream())
```

实际项目里，两种都能用。手动 `TextDecoder` 更容易控制解析细节，`TextDecoderStream` 写起来更简洁。

`AbortController` 用来取消请求。Agent 应用里这个能力很常见：用户可能点了"停止生成"，也可能切换页面，不再需要当前结果。

```ts fold
const controller = new AbortController()

document.querySelector('#stop')?.addEventListener('click', () => {
  controller.abort()
})

await fetch('/api/chat', {
  method: 'POST',
  signal: controller.signal,
})
```

前端取消后，服务端也应该感知连接关闭，并尽量取消上游模型请求。否则浏览器已经不要结果了，服务端还在继续消耗 token。

### Next.js 服务端

Next.js App Router 里，流式接口通常写在 Route Handler 中：

```ts fold title="app/api/chat/route.ts"
export async function POST(request: Request) {
  return new Response('...')
}
```

这里的 `request` 是 Web 标准的 `Request`。读取请求体可以用：

```ts fold
const body = await request.json()
```

如果要返回流，Route Handler 可以直接返回 `Response`，响应体放一个 `ReadableStream`。Next.js 里很常见的写法是直接创建 `ReadableStream`，在 `start` 里通过 `controller.enqueue()` 持续写入数据：

```ts fold
const encoder = new TextEncoder()

const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(encoder.encode('event: message\ndata: {"content":"hi"}\n\n'))
    controller.close()
  },
})

return new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream',
  },
})
```

服务端调用上游模型接口时，也会遇到 Web Stream。现代 `fetch` 返回的 `response.body` 同样可以用 `getReader()` 读取：

```ts fold
const response = await fetch(modelUrl)
const reader = response.body?.getReader()
```

如果通过 LangChain 调模型，通常会拿到可以直接 `for await` 的事件流：

```ts fold
for await (const event of stream) {
  // event 是 LangChain 暴露的流式事件
}
```

这种方式对业务代码更友好，不需要直接处理底层字节。Next.js 中转层只需要把 LangChain 事件转换成自己的统一事件格式，再返回给浏览器。有些 Node.js 生态库仍然会返回 Node.js `Readable`，这属于兼容问题，不是本文主线。真遇到时，重点也是一样的：先把库返回的流消费掉，再转换成前端稳定可理解的业务事件。

## 链路里的 SSE

SSE 在这里只是一层"事件外壳"。大模型接口通常用它返回增量，Next.js 中转层也会把响应包装成 SSE 让浏览器按事件消费。但真正决定行为的不是 SSE 字段本身，而是事件里的业务含义：文本增量、工具调用、状态变化、结束信号。

本文关心的也不是 SSE 每个字段怎么写，而是这条链路：

```text
模型流 -> Next.js 适配 -> 业务事件 -> 浏览器消费 -> UI 更新
```

只要这条链路稳定，底层用 SSE、NDJSON 或其他流式文本格式，都只是传输细节。

## 一条流的代码旅程

前面是从传输和协议视角看流，真正写代码时还得分清几个层次：

```text
网络 chunk -> 文本片段 -> 协议事件 -> 业务事件 -> UI 状态
```

这几个层次不能混在一起。

**网络 chunk** 是浏览器或服务端每次从 `reader.read()` 里读到的 `Uint8Array`，它只代表网络这次给了多少字节，不代表一条完整消息。

**文本片段** 是 `TextDecoder` 解码后的字符串，它解决了"字节怎么变成文字"，但仍然不保证刚好是一条完整事件。

**协议事件** 是按 SSE、NDJSON 或其他格式切出来的完整事件，比如 SSE 通常要等到 `\n\n` 才能认为一条事件结束。

业务事件是应用真正关心的结构，比如：

```ts fold
type AgentStreamEvent = { type: 'message'; content: string } | { type: 'tool_call'; name: string; args?: unknown } | { type: 'tool_result'; name: string; result: unknown } | { type: 'status'; message: string } | { type: 'error'; message: string } | { type: 'done' }
```

UI 状态才是最后一层。不同业务事件会映射到不同界面区域，比如追加回答、更新状态、展示错误或完成收尾。所以一个稳定的流处理流程通常是：

```text
读取 chunk -> 解码文本 -> 放入 buffer -> 切完整事件 -> 转业务事件 -> 推给消费端
```

这里最容易混淆的是两次转换：chunk 不等于完整协议事件，协议事件也不等于业务事件。前一步要按协议边界拼装，后一步要做字段映射。

## 抽出复用的流工具

后面的示例会反复出现同一组重复模板：

- 用 `getReader()` + `TextDecoder` 把字节流转成文本；
- 按 `\n\n` 切出完整 SSE 事件，再从 `event:` / `data:` 行里取字段；
- 服务端往 `controller.enqueue()` 写 SSE，外面包一层 `ReadableStream`、`AbortController`、`try/catch/finally`、SSE 响应头。

把这些重复部分抽到 `lib/sse.ts`，后续的浏览器和服务端代码都直接复用：

```ts fold title="lib/sse.ts"
/**
 * 把 ReadableStream 解析成 SSE 事件流，调用方用 for await 消费。
 */
export async function* parseSSE(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      const lines = block.split('\n')
      const event =
        lines
          .find((line) => line.startsWith('event:'))
          ?.slice('event:'.length)
          .trim() || 'message'
      const data = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
        .join('\n')

      if (data) {
        yield { event, data }
      }
    }
  }
}

const encoder = new TextEncoder()

/**
 * 服务端往 controller 写一条 SSE 事件。
 */
export function writeSSE(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
}

/**
 * 包装一个标准的 SSE Response，自动处理取消、错误和结束信号。
 */
export function createSSEResponse(request: Request, produce: (controller: ReadableStreamDefaultController<Uint8Array>, signal: AbortSignal) => Promise<void>) {
  const abortController = new AbortController()
  request.signal.addEventListener('abort', () => abortController.abort())

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await produce(controller, abortController.signal)
        writeSSE(controller, 'done', {})
      } catch (error) {
        if (!abortController.signal.aborted) {
          const message = error instanceof Error ? error.message : '执行失败'
          writeSSE(controller, 'error', { message })
        }
      } finally {
        controller.close()
      }
    },
    cancel() {
      abortController.abort()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  })
}
```

三个函数各管一段：

- `parseSSE` 是异步生成器，把字节循环、`buffer` 管理、SSE 字段解析都封装好。调用方只用 `for await` 一行就拿到 `{ event, data }`。
- `writeSSE` 把 `event:` + `data:` + `JSON.stringify` + 编码合并成一行调用。
- `createSSEResponse` 处理 Response 生命周期：把浏览器的取消信号透传给上游、`produce` 正常返回时自动写 `done`、抛错时自动写 `error`，最后关闭 controller。

后面章节里的示例代码都会直接使用这三个函数。

## 浏览器使用 API 接入模型

第一种链路，是浏览器直接调用大模型接口。

```d2 padX=200
direction: right

A: 浏览器
B: 大模型接口
C: 文本流
D: 渲染

A -> B
B -> C
C -> D
```

这种方式最直接。浏览器发起请求，用 `parseSSE` 直接迭代上游 SSE 事件：

```ts fold
import { parseSSE } from '@/lib/sse'

const response = await fetch('https://model-provider.example.com/v1/chat', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ messages, stream: true }),
})

if (!response.body) return

for await (const { data } of parseSSE(response.body)) {
  if (data === '[DONE]') break

  const payload = JSON.parse(data)
  const content = payload.choices?.[0]?.delta?.content
  if (content) appendAssistantText(content)
}
```

它的优点是链路短，适合 demo、本地验证、内部临时工具。你可以很快看到模型流式返回的效果。但真实业务里通常不建议这样做，主要有两个问题：

- **API Key 难隐藏**。浏览器里的代码和请求都在用户环境中，密钥很难真正藏住。
- **协议耦合**。前端会直接依赖供应商的字段结构，将来更换模型、切换供应商、加审计和限流都比较被动。

所以浏览器直连更像是理解流处理的起点，不是生产环境里的常规架构。

## Next.js 使用 API 接入模型

更常见的方式，是浏览器只调用自己的 Next.js 接口，由 Route Handler 再去请求大模型接口。

```d2
direction: right

A: 浏览器
B: Next.js
C: 大模型接口
D: 文本流
E: 业务事件流
F: 渲染

A -> B
B -> C
C -> D
D -> E
E -> F
```

这时 Next.js 做了几件事：

- 保存 API Key，不让它出现在浏览器里；
- 统一处理用户鉴权、额度、日志、审计；
- 调用上游大模型的 streaming API；
- 读取上游流；
- 把供应商格式转换成前端约定的事件；
- 边读边写回浏览器。

简化后的 Route Handler 可以写成这样：

```ts fold title="app/api/chat/route.ts"
import { createSSEResponse, parseSSE, writeSSE } from '@/lib/sse'

export async function POST(request: Request) {
  const { messages } = await request.json()

  return createSSEResponse(request, async (controller, signal) => {
    const response = await fetch('https://model-provider.example.com/v1/chat', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.MODEL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages, stream: true }),
      signal,
    })

    if (!response.body) {
      writeSSE(controller, 'error', { message: '响应体为空' })
      return
    }

    for await (const { data } of parseSSE(response.body)) {
      if (data === '[DONE]') break

      const payload = JSON.parse(data)
      const content = payload.choices?.[0]?.delta?.content
      if (content) writeSSE(controller, 'message', { content })
    }
  })
}
```

整段代码只剩三步：用 `parseSSE` 拿到上游事件、按上游字段（OpenAI 风格把文本增量放在 `choices[0].delta.content`，真实项目按供应商字段调整）取内容、用 `writeSSE` 写成前端约定的事件。生命周期相关的逻辑全部在 `createSSEResponse` 内部：浏览器断开会把 `signal` 传给上游 fetch、`produce` 正常返回会自动写 `done`、抛错会自动写 `error`。

要留意的是中转层并不是在转发原始 chunk，而是在做协议适配。上游返回 `delta`/`content`/`choices` 这些字段是供应商私有的，前端不应该依赖；中转层只把"模型说了一句话"翻译成业务事件 `event: message`，前端就和上游解耦了。`[DONE]` 是 OpenAI 风格上游用来标记"流到此为止"，遇到就 `break`，剩下的收尾交给 `createSSEResponse`。

这类架构适合大多数业务里的基础版本：既保留流式体验，又把安全和协议适配放在服务端。但如果后面要接入多步 Agent、工具调用、检索结果回传，直接拼 HTTP 会让 Route Handler 越长越乱，这时换成 SDK 或 LangChain 这类框架更合适。

## Next.js 使用 SDK 接入模型

如果不想手写请求体、鉴权头和分块解析，可以直接用 OpenAI 官方 Node SDK。它返回的仍然是 OpenAI 风格的流式响应，但这些细节都封装好了，业务代码只剩 `for await` 文本片段。

```d2
direction: right

A: 浏览器
B: Next.js
C: OpenAI SDK
D: 业务事件流
E: 渲染

A -> B
B -> C
C -> D
D -> E
```

```ts fold title="app/api/chat/route.ts"
import OpenAI from 'openai'
import { createSSEResponse, writeSSE } from '@/lib/sse'

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(request: Request) {
  const { systemPrompt, userPrompt } = await request.json()

  return createSSEResponse(request, async (controller, signal) => {
    const stream = await client.chat.completions.create(
      {
        model: process.env.OPENAI_MODEL,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      },
      { signal }
    )

    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content
      if (content) writeSSE(controller, 'message', { content })
    }
  })
}
```

跟直接 fetch 相比，少了手写请求体、手写鉴权头、手写 `data:` 行解析；跟 LangChain 相比，少了 messages 类（`HumanMessage`、`SystemMessage`）的封装层。SDK 把流式响应包成 `AsyncIterable`，每个 chunk 仍然是 OpenAI 风格的 `choices[0].delta.content`，从中转层往下的"翻译成业务事件"逻辑完全保持不变。

## Next.js 使用 LangChain 接入模型

上面两种写法都跟单一供应商绑死。如果要换模型、加工具调用、接多步 Agent，LangChain 这类框架更合适。这里先不用这些，只用 `ChatOpenAI` 演示最核心的模型文本流。

```d2
direction: right

A: 浏览器
B: Next.js
C: ChatOpenAI
D: 业务事件流
E: 渲染

A -> B
B -> C
C -> D
D -> E
```

LangChain 负责屏蔽模型供应商的调用细节，Next.js 负责把 LangChain 返回的文本 chunk 包装成浏览器能消费的 SSE。

```ts fold title="app/api/chat/route.ts"
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { createSSEResponse, writeSSE } from '@/lib/sse'

const model = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL,
})

export async function POST(request: Request) {
  const { systemPrompt, userPrompt } = await request.json()

  return createSSEResponse(request, async (controller, signal) => {
    const modelStream = await model.stream([new SystemMessage(systemPrompt), new HumanMessage(userPrompt)], { signal })

    for await (const chunk of modelStream) {
      if (chunk.text) {
        writeSSE(controller, 'message', { content: chunk.text })
      }
    }
  })
}
```

用 LangChain 后业务代码非常薄：`model.stream()` 返回模型增量输出，每个 `chunk.text`（LangChain 暴露的字符串快捷字段）直接 `writeSSE` 成 `message`。结束信号、错误处理、取消透传，全都由 `createSSEResponse` 兜底。和上一节相比，只是把"自己 fetch + 按供应商字段解析"替换成了"调一行 `model.stream()` 拿到统一事件流"，外壳没变。

## 浏览器消费中转层 API

当有了 Next.js 中转层，浏览器就不应该再关心后端到底是直接调用大模型接口，还是通过 SDK 或 LangChain 调用模型。前端只需要关心自己的业务接口返回哪些事件。

Agent 流里常见的事件约定通常这样设计：

| 事件类型      | 含义               | 前端行为               |
| ------------- | ------------------ | ---------------------- |
| `message`     | 模型文本增量       | 追加到回答区域         |
| `tool_call`   | 工具调用开始或更新 | 展示工具调用状态       |
| `tool_result` | 工具执行结果       | 展示结果或折叠详情     |
| `status`      | Agent 当前执行状态 | 更新状态文案           |
| `error`       | 生成或执行失败     | 展示错误并结束 loading |
| `done`        | 流结束             | 收尾并允许继续输入     |

前端消费时，不要把所有事件都当成文本拼接。以文本流接口为例，这里只处理 `message`、`error`、`done` 三类事件：

```ts fold
function handleAgentEvent(event: AgentStreamEvent) {
  switch (event.type) {
    case 'message':
      appendAssistantText(event.content)
      break

    case 'error':
      showError(event.message)
      finishStreaming()
      break

    case 'done':
      finishStreaming()
      break
  }
}
```

### 用 EventSource 消费 SSE

如果后端返回的是 SSE，浏览器可以用 `EventSource`，也可以用 `fetch` 读取流。`EventSource` 写起来很轻，浏览器会按 `event:` 名称自动分发事件：

```ts fold
const source = new EventSource(`/api/agent?message=${encodeURIComponent(message)}`)

source.addEventListener('message', (e) => {
  handleAgentEvent({ type: 'message', ...JSON.parse(e.data) })
})

source.addEventListener('done', () => {
  handleAgentEvent({ type: 'done' })
  source.close()
})

source.addEventListener('error', (e) => {
  if (e instanceof MessageEvent && e.data) {
    handleAgentEvent({ type: 'error', ...JSON.parse(e.data) })
    source.close()
    return
  }

  handleAgentEvent({ type: 'error', message: '连接异常' })
  // 普通连接异常不主动 close，让 EventSource 按浏览器策略自动重连。
})
```

`EventSource` 有几个容易忽略的点：

- 默认事件名是 `message`，自定义事件（如 `done`、`tool_call`）必须显式 `addEventListener` 才能收到；
- `error` 既包含服务端写的业务错误（`MessageEvent`，带 `data`），也包含连接断开（普通 `Event`，没有 `data`），需要分开处理；
- 普通连接异常后浏览器会自动重连；只有流正常结束，或者服务端已经返回业务错误时，才需要手动 `close()`。

### 用 fetch 消费 SSE

`EventSource` 只支持 GET，Chat 或 Agent 接口通常需要 POST body、复杂鉴权和请求上下文，这时换成 `fetch` + `parseSSE` 更灵活：

```ts fold
import { parseSSE } from '@/lib/sse'

const response = await fetch('/api/agent', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message }),
  method: 'POST',
})

if (!response.body) {
  handleAgentEvent({ type: 'error', message: '响应体为空' })
  return
}

for await (const { event, data } of parseSSE(response.body)) {
  const payload = JSON.parse(data)
  handleAgentEvent({ type: event, ...payload } as AgentStreamEvent)
}
```

`parseSSE` 把字节读取、`buffer` 拼接和 `event:`/`data:` 字段解析全包好了，浏览器只剩两件事：解析 `data` 里的 JSON，把 `event` 当成业务事件类型分发给 `handleAgentEvent`。

### 用 XMLHttpRequest 消费 SSE

如果老项目只能用 `XMLHttpRequest`，也可以在 `onprogress` 里读取新增的 `responseText`，再按 SSE 的空行边界切事件：

```ts fold
const xhr = new XMLHttpRequest()
let readOffset = 0
let buffer = ''

function handleSSEBlock(block: string) {
  const lines = block.split('\n')
  const event =
    lines
      .find((line) => line.startsWith('event:'))
      ?.slice('event:'.length)
      .trim() || 'message'
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .join('\n')

  if (!data) return

  const payload = JSON.parse(data)
  handleAgentEvent({ type: event, ...payload } as AgentStreamEvent)
}

xhr.open('POST', '/api/agent')
xhr.setRequestHeader('Content-Type', 'application/json')

xhr.onprogress = () => {
  // responseText 是从请求开始累计到现在的完整文本。
  // 每次只截取上次未消费的新内容，避免重复解析。
  const chunk = xhr.responseText.slice(readOffset)
  readOffset = xhr.responseText.length

  buffer += chunk
  const blocks = buffer.split('\n\n')
  buffer = blocks.pop() ?? ''

  for (const block of blocks) {
    if (!block.trim()) continue
    handleSSEBlock(block)
  }
}

xhr.onerror = () => {
  handleAgentEvent({ type: 'error', message: '连接异常' })
}

xhr.send(JSON.stringify({ message }))
```

这里不需要再用 `TextDecoder`，因为 `xhr.responseText` 已经是浏览器按响应编码解码后的字符串；`fetch` 读取 `ReadableStream` 时拿到的是 `Uint8Array`，才需要手动解码。服务端最好明确返回 `Content-Type: text/event-stream; charset=utf-8`，避免字符集判断不一致。

这种写法能兼容一些历史 Ajax 封装，但它没有 `EventSource` 的自动重连，也没有 `fetch` 的流式读取 API，解析和取消逻辑都要自己补齐。新代码还是优先用前面的 `fetch` + `parseSSE`。

### EventSource 的自动重连机制

`EventSource` 建立连接后，浏览器会保持一个到 SSE 地址的 GET 请求。如果连接因为网络抖动、代理断开或服务端临时异常而中断，浏览器会触发 `error` 事件；只要代码没有调用 `source.close()`，浏览器就会等待一段时间后重新请求同一个地址。

服务端可以用 `retry:` 字段建议浏览器的重连间隔：

```text
retry: 3000

event: message
data: {"content":"hi"}
```

这里的空行是 SSE 的事件分隔符，不是 `retry:` 后面必须跟空行。上面的写法表示先单独设置重连间隔，再发送下一条 `message` 事件。`retry:` 也可以和 `event:`、`data:` 写在同一个事件块里。

这表示连接断开后，浏览器大约 3000ms 后再重连。服务端不写 `retry:` 时，浏览器会使用自己的默认重试间隔；标准没有规定固定值，Chrome/Chromium 通常大约是 3 秒。

如果服务端给事件写了 `id:`，浏览器会记住最后一次收到的事件 ID：

```text
id: 42
event: message
data: {"content":"hi"}
```

下次自动重连时，浏览器会把这个值放进 `Last-Event-ID` 请求头。服务端可以根据它从断点之后继续推送，避免重复或丢事件。不过这需要服务端自己保存事件历史或进度；浏览器只负责把最后收到的 `id` 带回去。

所以前面的 `EventSource` 示例里，只有两种情况主动 `close()`：收到 `done`，说明业务流已经正常结束；收到带 `data` 的业务错误，说明服务端已经明确失败。普通连接异常不主动关闭，是为了保留浏览器的自动重连能力。

## 流处理的工程注意点

前面用 `parseSSE` / `writeSSE` / `createSSEResponse` 把通用的字节、协议、生命周期问题包好了，但真实项目里容易出问题的地方往往在边界上，看清楚这些场景才能放心使用或扩展这套工具。

### chunk 不等于消息

chunk 是网络传输层的片段，不是业务层的消息。比如服务端写了一条完整事件：

```json
{ "type": "message", "content": "你好" }
```

浏览器实际读到时，可能被拆成：

```text
{"type":"message","con
tent":"你好"}
```

也可能多条事件粘在一起返回。`parseSSE` 之所以维护 `buffer`、按 `\n\n` 切事件，就是为了避免这种情况；如果以后要接 NDJSON 或其他协议，也得按各自的边界拼装。

### 要处理用户取消和连接关闭

用户点击停止生成时，前端应该通过 `AbortController` 取消请求。Next.js Route Handler 也要感知浏览器连接关闭，否则会出现两类浪费：

- 用户已经不看了，模型还在继续生成；
- 服务端继续写入一个已经关闭的连接，引发异常或无效计算。

`createSSEResponse` 已经把浏览器的 `request.signal` 桥接到一个内部 `AbortController`，并在 `cancel()` 时调用 `abort()`；业务代码只要把 `signal` 透传给上游 fetch 或 `model.stream(..., { signal })` 就够了。

### 错误也应该作为事件返回

流式接口里，错误不一定只发生在请求开始阶段。上游模型可能生成到一半断开，外部接口也可能超时。这些错误最好也转换成前端可理解的事件：

```json
{ "type": "error", "message": "模型连接中断" }
```

这样前端可以正常收尾：停止 loading、展示错误、允许用户重试。`createSSEResponse` 在 `produce` 抛错时会自动写一条 `event: error`，业务里只用关心"什么场景该抛"。

## 总结

Agent 应用里的流处理，重点是端到端的事件传递。上游用什么协议、什么库并不是关键，前后端对”业务事件类型”有共同约定才是关键。

浏览器直接调用大模型接口是理解链路最直接的方式，但 API Key 暴露、协议耦合等问题让它只适合 demo 和内部工具。生产环境的多数选择是在 Next.js 这一层中转：统一鉴权、日志和审计，把供应商私有字段翻译成稳定的事件流。这一层既可以直接 fetch 模型，也可以通过 LangChain 这类框架，对上层业务代码是透明的。

前端要按事件类型分发到不同 UI 状态，而不是把 stream 当成一条文本流。错误、取消、状态变化都要作为事件传回来——这样后端能感知用户的中断，前端能及时展示失败，用户能看清 Agent 当前在做什么。
