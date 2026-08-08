---
createdAt: '2026-06-12 00:00'
order: 8
---

# Agent 应用中的流处理

Agent 请求通常会串联模型生成、检索、工具调用和结果整理。如果等整个过程结束后再返回，用户只能面对一段没有反馈的等待时间。流式处理允许服务端在任务进行过程中持续发送结果，前端则边接收边展示。

Agent 应用中的流不只有模型生成的 token，还会承载整个执行过程中的事件，包括：

- 模型正在生成的文本；
- Agent 当前执行到哪一步；
- 工具调用什么时候开始；
- 工具参数是否已经生成；
- 工具执行结果什么时候回来；
- 什么时候出错；
- 什么时候结束。

SSE 协议本身不在这里展开。[《SSE 和 NDJSON 指南》](<./SSE 和 NDJSON 指南.md>)已经介绍了 SSE、NDJSON、WebSocket 的格式和区别。本文关注 Agent 应用中的工程链路，即流从哪里产生、谁负责中转，以及前端如何消费。

## 什么是流

流是一种渐进返回数据的方式。普通响应需要等待完整结果，流式响应则会在请求开始后持续返回数据片段，直到发送结束信号。

对大模型应用来说，模型产生首个可用增量后，服务端就可以把它返回给前端，不必等整段回答全部生成完。前端拿到片段后立刻渲染，用户就会看到答案逐步出现。

Agent 的等待时间不只来自模型生成，还来自检索、工具调用、权限判断、代码执行和外部接口请求。即使最终答案还没准备好，前端也可以先展示“正在检索资料”“正在调用工具”“正在生成总结”。因此，流处理需要把长过程转换成连续事件，让消费端在接收数据的同时更新状态。

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
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: '介绍一下 RAG' }),
})

const stream = response.body
```

`response.body` 是后续流式读取的入口，类型通常是 `ReadableStream<Uint8Array>`。每次读取只能拿到当前可用的 chunk，不保证对应一条完整消息；服务端写入更多数据后，读取器才能继续取得新的 chunk。

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

`{ stream: true }` 很重要。一个字符的字节可能被拆到两个 chunk 中，如果每次都作为独立文本解码，可能出现乱码。开启流式解码后，`TextDecoder` 会保留未完成的字节，等下一个 chunk 到来后再继续解码。

`TextDecoderStream` 是流式版本，可以直接把二进制流转换成文本流：

```ts fold
const textStream = response.body?.pipeThrough(new TextDecoderStream())
```

实际项目里，两种都能用。手动 `TextDecoder` 更容易控制解析细节，`TextDecoderStream` 写起来更简洁。

`AbortController` 用来取消请求。用户点击“停止生成”或切换页面后，前端可以停止接收不再需要的结果。

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
    'Content-Type': 'text/event-stream; charset=utf-8',
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

SSE 是承载事件的传输格式。大模型接口通常用它返回增量，Next.js 中转层也会把响应包装成 SSE 供浏览器消费。应用行为由事件的业务含义决定，包括文本增量、工具调用、状态变化和结束信号。

本文关注的是 SSE 在整条业务链路中的位置：

```d2
direction: right

A: 模型流
B: Next.js 适配
C: 业务事件
D: 浏览器消费
E: UI 更新

A -> B -> C -> D -> E
```

只要这条链路稳定，底层使用 SSE、NDJSON 或其它流式文本格式都只是传输细节。

## 一条流的代码旅程

实现流处理时，需要区分五个层次：

```d2
direction: right

A: 网络 chunk
B: 文本片段
C: 协议事件
D: 业务事件
E: UI 状态

A -> B -> C -> D -> E
```

这几个层次不能混在一起。

**网络 chunk**是浏览器或服务端每次从 `reader.read()` 里读到的 `Uint8Array`，它只代表网络这次给了多少字节，不代表一条完整消息。

**文本片段**是 `TextDecoder` 解码后的字符串，它解决了“字节怎么变成文字”，但仍然不保证刚好是一条完整事件。

**协议事件**是按 SSE、NDJSON 或其它格式切出来的完整事件。SSE 使用空行分隔事件，只有读到完整边界后才能继续解析。

**业务事件**是应用真正关心的结构，例如：

```ts fold
type AgentStreamEvent =
  | { type: 'message'; content: string }
  | { type: 'tool_call'; name: string; args?: unknown }
  | { type: 'tool_result'; name: string; result: unknown }
  | { type: 'status'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' }
```

**UI 状态**是最后一层。不同业务事件会映射到不同界面区域，例如追加回答、更新状态、展示错误或完成收尾。完整的处理流程如下：

```d2
direction: right

A: 读取 chunk
B: 解码文本
C: 写入 buffer
D: 切分完整事件
E: 转换业务事件
F: 推给消费端

A -> B -> C -> D -> E -> F
```

这里最容易混淆的是两次转换：chunk 不等于完整协议事件，协议事件也不等于业务事件。前一步要按协议边界拼装，后一步要做字段映射。

## 抽出复用的流工具

后面的示例会反复出现同一组重复模板：

- 用 `getReader()` + `TextDecoder` 把字节流转成文本；
- 按空行切出完整 SSE 事件，再从 `event` 和 `data` 行中取出字段；
- 服务端往 `controller.enqueue()` 写 SSE，外面包一层 `ReadableStream`、`AbortController`、`try/catch/finally`、SSE 响应头。

把这些重复部分抽到 `lib/sse.ts`，后续的浏览器和服务端代码都可以直接复用。这组工具只处理本文约定的 `event` 和 JSON `data` 字段，不是覆盖 SSE 全部字段的通用解析器。

```ts fold title="lib/sse.ts"
/**
 * 把 ReadableStream 解析成 SSE 事件流，调用方用 for await 消费。
 */
export async function* parseSSE(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()

      if (done) {
        buffer += decoder.decode()
        break
      }

      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() ?? ''

      for (const block of blocks) {
        const lines = block.split(/\r?\n/)
        const event =
          lines
            .find((line) => line.startsWith('event:'))
            ?.slice('event:'.length)
            .trim() || 'message'
        const data = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice('data:'.length).replace(/^ /, ''))
          .join('\n')

        if (data) {
          yield { event, data }
        }
      }
    }
  } finally {
    reader.releaseLock()
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
  const handleAbort = () => abortController.abort()

  if (request.signal.aborted) {
    handleAbort()
  } else {
    request.signal.addEventListener('abort', handleAbort, { once: true })
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await produce(controller, abortController.signal)
        if (!abortController.signal.aborted) {
          writeSSE(controller, 'done', {})
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          const message = error instanceof Error ? error.message : '执行失败'
          writeSSE(controller, 'error', { message })
        }
      } finally {
        request.signal.removeEventListener('abort', handleAbort)
        if (!abortController.signal.aborted) {
          controller.close()
        }
      }
    },
    cancel() {
      abortController.abort()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  })
}
```

三个函数各管一段：

- `parseSSE` 是异步生成器，负责字节读取、`buffer` 管理和 SSE 字段解析，调用方通过 `for await` 取得 `{ event, data }`；
- `writeSSE` 负责序列化业务数据并写入一条 SSE 事件；
- `createSSEResponse` 管理 Response 生命周期，透传取消信号，并统一写入 `done` 或 `error` 事件。

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

if (!response.ok) {
  throw new Error(`模型请求失败：${response.status}`)
}

if (!response.body) {
  throw new Error('模型响应体为空')
}

for await (const { data } of parseSSE(response.body)) {
  if (data === '[DONE]') break

  const payload = JSON.parse(data)
  const content = payload.choices?.[0]?.delta?.content
  if (content) appendAssistantText(content)
}
```

它的链路短，适合 demo 和本地验证。真实业务通常不采用这种方式，主要有两个问题：

- **API Key 难隐藏**。浏览器里的代码和请求都在用户环境中，密钥很难真正藏住；
- **协议耦合**。前端会直接依赖供应商的字段结构，将来更换模型、切换供应商、加审计和限流都比较被动。

因此，浏览器直连适合用来理解流处理，不适合作为生产环境的常规架构。

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

    if (!response.ok) {
      throw new Error(`模型请求失败：${response.status}`)
    }

    if (!response.body) {
      throw new Error('模型响应体为空')
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

Route Handler 只保留三步。先用 `parseSSE` 读取上游事件，再按供应商字段提取内容，最后用 `writeSSE` 写成前端约定的事件。示例采用 Chat Completions 风格的 `choices[0].delta.content`，真实项目需要按供应商协议调整。浏览器断开、结束和错误等生命周期逻辑由 `createSSEResponse` 统一处理。

中转层并不转发原始 chunk，而是把供应商事件转换成应用自己的业务事件。前端无需依赖 `delta`、`content`、`choices` 等上游字段，只消费稳定的 `message` 事件。示例中的 `[DONE]` 是 Chat Completions 风格的结束标记，遇到后结束上游读取，剩余收尾交给 `createSSEResponse`。

这类架构适合大多数业务的基础版本，既保留流式体验，也把安全控制和协议适配放在服务端。接入多步 Agent、工具调用和检索结果后，可以再用 SDK 或 LangChain 收敛供应商调用与事件解析代码。

## Next.js 使用 SDK 接入模型

如果不想手写请求体、鉴权头和分块解析，可以使用 OpenAI 官方 Node SDK。新项目优先使用 Responses API，它会把 SSE 解析成带类型的语义事件，业务代码只需要处理关心的事件类型。

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
    const stream = await client.responses.create(
      {
        model: process.env.OPENAI_MODEL,
        instructions: systemPrompt,
        input: userPrompt,
        stream: true,
      },
      { signal }
    )

    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        writeSSE(controller, 'message', { content: event.delta })
      }

      if (event.type === 'response.failed') {
        throw new Error(event.response.error?.message ?? '模型生成失败')
      }

      if (event.type === 'error') {
        throw new Error(event.message)
      }
    }
  })
}
```

SDK 把流式响应包装成 `AsyncIterable`，并通过 `response.output_text.delta` 等事件类型区分文本、工具参数和生命周期变化。这个示例把文本增量转换成应用的 `message` 事件，并将失败事件交给统一错误处理；如果需要工具调用，可以继续映射相应的 Responses 流事件。中转层以下仍然使用相同的业务事件协议。

## Next.js 使用 LangChain 接入模型

前两种写法都直接依赖供应商 API。如果应用需要统一模型调用方式，或继续接入工具与多步 Agent，可以引入 LangChain。这里先用 `ChatOpenAI` 演示最基础的模型文本流。

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

LangChain 提供统一的模型调用接口，Next.js 负责把模型返回的文本 chunk 包装成浏览器可以消费的 SSE。切换供应商时仍需更换对应的集成类和配置，但业务层的流式消费方式可以保持一致。

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

`model.stream()` 返回模型的增量输出，`chunk.text` 是 LangChain 提供的文本快捷字段。示例把非空文本直接转换成 `message` 事件，结束、错误和取消仍由 `createSSEResponse` 统一处理。与上一节相比，变化只发生在上游模型调用层，中转层的业务事件协议保持不变。

## 浏览器消费中转层 API

有了 Next.js 中转层后，浏览器无需关心后端通过原始 API、SDK 还是 LangChain 调用模型，只需要处理业务接口约定的事件。

Agent 流通常约定以下事件：

| 事件类型      | 含义               | 前端行为               |
| ------------- | ------------------ | ---------------------- |
| `message`     | 模型文本增量       | 追加到回答区域         |
| `tool_call`   | 工具调用开始或更新 | 展示工具调用状态       |
| `tool_result` | 工具执行结果       | 展示结果或折叠详情     |
| `status`      | Agent 当前执行状态 | 更新状态文案           |
| `error`       | 生成或执行失败     | 展示错误并结束加载状态 |
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

如果后端返回 SSE，浏览器可以用 `EventSource`，也可以用 `fetch` 读取流。`EventSource` 的接口较简单，浏览器会按 `event:` 名称自动分发事件。由于它只能发起 GET 请求，示例只在 URL 中传递服务端保存的会话 ID，避免把用户输入直接暴露在 URL 和访问日志中：

```ts fold
const source = new EventSource(`/api/agent?sessionId=${encodeURIComponent(sessionId)}`)

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
- 这里把业务错误也命名为 `error`，因此监听器既会收到服务端发送的 `MessageEvent`，也会收到连接异常产生的普通 `Event`，需要根据 `data` 区分；
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

if (!response.ok) {
  handleAgentEvent({ type: 'error', message: `请求失败：${response.status}` })
  return
}

if (!response.body) {
  handleAgentEvent({ type: 'error', message: '响应体为空' })
  return
}

for await (const { event, data } of parseSSE(response.body)) {
  const payload = JSON.parse(data)
  handleAgentEvent({ type: event, ...payload } as AgentStreamEvent)
}
```

`parseSSE` 封装了字节读取、`buffer` 拼接和 `event`、`data` 字段解析。浏览器只需要解析 JSON 数据，再按事件类型分发给 `handleAgentEvent`。

示例中的类型断言只用于突出流处理主线。真实项目还需要在边界处校验 `event` 和 JSON 数据，不能让未知事件直接进入 UI 状态更新逻辑。

### 用 XMLHttpRequest 消费 SSE

如果老项目只能用 `XMLHttpRequest`，也可以在 `onprogress` 里读取新增的 `responseText`，再按 SSE 的空行边界切事件：

```ts fold
const xhr = new XMLHttpRequest()
let readOffset = 0
let buffer = ''

function handleSSEBlock(block: string) {
  const lines = block.split(/\r?\n/)
  const event =
    lines
      .find((line) => line.startsWith('event:'))
      ?.slice('event:'.length)
      .trim() || 'message'
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).replace(/^ /, ''))
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
  const blocks = buffer.split(/\r?\n\r?\n/)
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

这种写法可以兼容部分历史 Ajax 封装，但没有 `EventSource` 的自动重连，也无法使用 `fetch` 的流式读取 API，解析和取消逻辑都要自行补齐。新代码优先使用前面的 `fetch` 和 `parseSSE`。

### EventSource 的自动重连机制

`EventSource` 建立连接后，浏览器会保持一个到 SSE 地址的 GET 请求。如果连接因为网络抖动、代理断开或服务端临时异常而中断，浏览器会触发 `error` 事件；只要代码没有调用 `source.close()`，浏览器就会等待一段时间后重新请求同一个地址。

服务端可以用 `retry:` 字段建议浏览器的重连间隔：

```text
retry: 3000

event: message
data: {"content":"hi"}
```

这里的空行是 SSE 的事件分隔符。上面的写法先单独设置重连间隔，再发送下一条 `message` 事件。`retry:` 也可以和 `event:`、`data:` 写在同一个事件块里。

这表示连接断开后，浏览器大约等待 3000ms 再重连。服务端不写 `retry:` 时，浏览器会使用自己的默认重试间隔，标准没有规定统一值。

如果服务端给事件写了 `id:`，浏览器会记住最后一次收到的事件 ID：

```text
id: 42
event: message
data: {"content":"hi"}
```

下次自动重连时，浏览器会把这个值放进 `Last-Event-ID` 请求头。服务端可以根据它从断点之后继续推送，避免重复或丢事件。不过这需要服务端自己保存事件历史或进度；浏览器只负责把最后收到的 `id` 带回去。

前面的 `EventSource` 示例只在两种情况下主动调用 `close()`。收到 `done` 表示业务流已经正常结束；收到带 `data` 的业务错误表示服务端已经明确失败。普通连接异常不主动关闭，以保留浏览器的自动重连能力。

## 流处理的工程注意点

`parseSSE`、`writeSSE` 和 `createSSEResponse` 封装了字节、协议与生命周期处理，业务代码仍需处理部署和异常边界。反向代理、负载均衡器或托管平台可能缓冲响应，导致服务端持续写入，浏览器却迟迟收不到事件。部署时需要确认整条链路支持流式传输，并关闭代理缓冲。以 Nginx 为例，可以配置 `X-Accel-Buffering: no`。如果工具调用期间长时间没有事件，还需要发送心跳并检查各层的空闲超时设置。

### chunk 不等于消息

chunk 是网络传输层的片段，不是业务层的消息。例如服务端写了一条完整事件：

```json
{ "type": "message", "content": "你好" }
```

浏览器实际读到时，可能被拆成：

```text
{"type":"message","con
tent":"你好"}
```

也可能多条事件粘在一起返回。`parseSSE` 通过维护 `buffer` 并按 SSE 空行切分事件来处理这两种情况。接入 NDJSON 或其它协议时，也要按对应的协议边界重新拼装。

### 要处理用户取消和连接关闭

用户点击停止生成时，前端应该通过 `AbortController` 取消请求。Next.js Route Handler 也要感知浏览器连接关闭，否则会出现两类浪费：

- 用户已经不看了，模型还在继续生成；
- 服务端继续写入一个已经关闭的连接，引发异常或无效计算。

`createSSEResponse` 已经把浏览器的 `request.signal` 桥接到一个内部 `AbortController`，并在 `cancel()` 时调用 `abort()`；业务代码只要把 `signal` 透传给上游 fetch 或 `model.stream(..., { signal })` 就够了。

### 错误也应该作为事件返回

流式接口的错误不一定只发生在请求开始阶段。请求校验或鉴权失败等已知错误应在流开始前通过 HTTP 状态码返回；开始传输后，上游模型断开或工具超时等错误则要转换成前端可理解的事件：

```json
{ "type": "error", "message": "模型连接中断" }
```

前端收到错误事件后，可以停止加载状态、展示原因并允许用户重试。`createSSEResponse` 会在 `produce` 抛错时写入一条 `error` 事件，业务代码只需保留具体的错误上下文。

## 总结

Agent 应用中的流处理依赖端到端的事件传递。Next.js 中转层负责鉴权、取消和协议适配，把供应商或框架返回的内容转换成稳定的业务事件；前端再按事件类型更新文本、工具状态、错误和完成状态。

这条链路既要正确区分网络 chunk、协议事件和业务事件，也要覆盖取消、错误、代理缓冲与连接超时。底层 API 或框架可以替换，只要前后端之间的业务事件约定保持稳定，上层 UI 就无需跟随供应商协议变化。
