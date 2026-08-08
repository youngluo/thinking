---
createdAt: '2026-06-09 00:00'
order: 7
---

# SSE 和 NDJSON 指南

在 AI 应用中，模型通常需要一段时间才能生成完整答案。如果服务端等完整答案生成后再返回，会让用户等待较长时间，影响使用体验。流式输出可以让服务端边生成边返回，前端页面则可以同步展示已生成的内容，让用户更早获得反馈。本文介绍两种常见方案：SSE 和基于 HTTP 响应的 NDJSON 流，并说明它们在数据格式、浏览器 API 和事件语义上的区别。

## SSE 是什么

SSE 全称是 Server-Sent Events，中文一般叫服务端推送事件。它是一种基于 HTTP 的标准事件流格式。客户端发起请求后，服务端保持响应不结束，并持续向响应体写入事件。浏览器可以通过 `EventSource` 接收和分发这些事件。

### 数据格式

SSE 响应必须使用 `text/event-stream`，通常还会通过 `Cache-Control` 避免直接复用旧响应：

```http
Content-Type: text/event-stream
Cache-Control: no-cache
```

响应体由 UTF-8 文本事件组成。每个事件由若干行字段组成，并以空行结束：

```text
event: message
id: 1
data: {"content":"你"}

event: message
id: 2
data: {"content":"好"}

event: done
data: {}
```

SSE 支持以下字段和注释形式：

| 写法    | 是否必须         | 含义                                              |
| ------- | ---------------- | ------------------------------------------------- |
| `data`  | 业务事件通常必须 | 事件内容，通常放字符串或 JSON 字符串              |
| `event` | 可选             | 事件类型；不写时默认是 `message`                  |
| `id`    | 可选             | 事件标识，浏览器重连时可通过 `Last-Event-ID` 带回 |
| `retry` | 可选             | 设置浏览器断线后的重连间隔，单位是毫秒            |
| `:`     | 可选             | 注释行，常用于心跳包，比如 `: ping`               |

`event:` 后面的事件名不是固定枚举。`message`、`done` 等名称都属于应用层约定，客户端和服务端保持一致即可。解析 SSE 时还需要注意三个边界：

- 一个事件可以有多行 `data:`，浏览器会合并成一个字符串，中间用换行符连接；
- 事件边界是空行，网络层返回的分块不一定对应事件边界；
- `data:` 本质上仍然是文本。

在 Agent 场景中，通常会用不同的 `event` 区分文本增量、工具调用和执行结束等事件：

```text
event: message
data: {"content":"RAG"}

event: tool_call
data: {"name":"search_docs","args":{"query":"RAG"}}

event: tool_result
data: {"name":"search_docs","content":"..."}

event: message
data: {"content":" 是检索增强生成"}

event: done
data: {"usage":{"outputTokens":42}}
```

### 请求方式

浏览器端可以直接用 `EventSource` 发起请求并接收事件：

```ts
const source = new EventSource('/api/chat/stream')

source.addEventListener('message', (event) => {
  const data = JSON.parse(event.data)
  renderDelta(data.content)
})

source.addEventListener('done', () => {
  source.close()
})
```

原生 `EventSource` 只能发起 `GET`，并且只提供 URL 和 `withCredentials` 选项，不能设置请求体或自定义请求头。AI 应用里常见的输入可能包括：

```json
{
  "messages": [],
  "model": "xxx",
  "tools": [],
  "temperature": 0.7,
  "response_format": {
    "type": "json_schema"
  }
}
```

这些内容如果都塞进查询字符串，会很难维护，也不适合承载敏感信息。工程里常见的做法有两种：

第一种是读写分离，先用 `POST` 创建任务，再用 `GET` 订阅 SSE：

```text
POST /api/chat
-> {"taskId":"abc"}

GET /api/chat/abc/events
-> text/event-stream
```

这种方式能继续使用原生 `EventSource`，但接口被拆成了两步。

第二种是用 `fetch` 发 `POST`，服务端仍然返回 `text/event-stream`：

```ts
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
})
```

这种方式的请求输入更自由，但浏览器端不能直接使用原生 `EventSource`，需要借助兼容 SSE 规则的解析器处理多行 `data:`、换行格式、注释以及跨网络分块的事件数据。

### 适用场景

SSE 适合浏览器持续接收服务端文本事件的场景。典型场景包括：

- LLM 聊天和 Agent 执行事件；
- 构建、部署、爬虫日志和长任务进度；
- 订单、告警和监控状态更新。

## NDJSON 是什么

NDJSON 全称是 Newline Delimited JSON，也就是「换行分隔的 JSON」。它把每条记录写成一个独立 JSON 值，并在末尾添加换行符。NDJSON 不是浏览器专属协议，也没有 SSE 的事件字段和重连语义。它是一种通用数据编码格式，只要通信通道支持流式读取，就可以由服务端逐行写入、客户端逐行读取。

### 数据格式

NDJSON 响应通常使用 `application/x-ndjson`，也会通过 `Cache-Control` 避免直接复用旧响应：

```http
Content-Type: application/x-ndjson
Cache-Control: no-cache
```

响应体由多条 JSON 记录组成。每条记录都是一个完整的 JSON 值，写入时以 `\n` 分隔。数据使用 UTF-8 编码：

```text
{"type":"message","content":"你"}
{"type":"message","content":"好"}
{"type":"done"}
```

NDJSON 只规定记录如何分隔，不规定字段结构。应用层可以自行约定 `type` 字段及其取值，例如 `message` 和 `done`。在 AI 应用中，可以通过 `type` 的取值区分文本增量、工具调用和执行结束等事件：

```text
{"type":"message","content":"RAG"}
{"type":"tool_call","name":"search_docs","args":{"query":"RAG"}}
{"type":"tool_result","name":"search_docs","content":"..."}
{"type":"message","content":" 是检索增强生成"}
{"type":"done","usage":{"outputTokens":42}}
```

错误也可以作为一条 JSON 记录返回：

```text
{"type":"error","code":"MODEL_TIMEOUT","message":"模型响应超时"}
```

### 请求方式

浏览器端可以用 `fetch` 发起请求并接收 NDJSON：

```ts fold
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    messages: [],
    model: 'xxx',
    tools: [],
    temperature: 0.7,
    response_format: {
      type: 'json_schema',
    },
  }),
})
```

服务端可以边处理边返回记录：

```text
{"type":"message","content":"RAG"}
{"type":"tool_call","name":"search_docs","args":{"query":"RAG"}}
{"type":"done"}
```

解析时，换行符才是记录边界。网络层返回的 `chunk` 不一定对应完整记录，可能只有半行，也可能包含多行。客户端需要缓存未完成的部分，拼成完整记录后再解析。

```ts fold
if (!response.ok) {
  throw new Error(`请求失败：${response.status}`)
}

if (!response.body) {
  throw new Error('响应体不可读')
}

const reader = response.body.getReader()
const decoder = new TextDecoder()

let buffer = ''

while (true) {
  const { value, done } = await reader.read()
  if (done) break

  buffer += decoder.decode(value, { stream: true })
  const lines = buffer.split('\n')
  buffer = lines.pop() ?? ''

  for (const line of lines) {
    if (!line.trim()) continue
    const data = JSON.parse(line)
    renderEvent(data)
  }
}

// 容错处理缺少末尾换行符的最后一条记录。
buffer += decoder.decode()

if (buffer.trim()) {
  renderEvent(JSON.parse(buffer))
}
```

### 适用场景

NDJSON 适合持续输出结构化记录，且客户端不局限于浏览器的场景。典型场景包括：

- CLI、Node.js、Python 服务之间的流式数据交换；
- 数据导入、数据清洗、爬虫采集的过程输出；
- LLM 或 Agent 的结构化事件流；
- 批处理任务逐条返回处理结果；
- 服务端日志或审计事件导出。

## 流式输出结构化 JSON

流式输出可以让客户端持续收到数据，但模型按 token 生成结构化 JSON 时，中间片段通常还不是合法 JSON。实际设计时，可以按服务端发送的内容分为两种情况。

### 每条消息都是完整 JSON

第一种是服务端每次推送的都是一个完整 JSON 对象。SSE 可以把对象放在一个事件的 `data:` 中，NDJSON 则可以把对象写成独立的一行。例如，模型或服务端已经把结果拆分为独立事件：

```text
event: message
data: {"title":"SSE","summary":"浏览器里的单向推送方案"}

event: message
data: {"title":"NDJSON","summary":"一行一个 JSON，适合多端消费"}

event: done
data: {"count":2}
```

这种情况最简单，浏览器端收到一条解析一条即可：

```ts
const source = new EventSource('/api/items/stream')

source.addEventListener('message', (event) => {
  const data = JSON.parse(event.data)
  renderMessage(data)
})
```

这种方式中，事件边界就是业务消息边界，客户端收到一条就可以解析一条，不会遇到 JSON 被截断的问题。日志、步骤、列表项和批处理结果都适合采用这种设计。

### 多条消息拼接成完整 JSON

另一种是最终结果需要组成一个完整 JSON，而模型按 token 逐步生成，服务端只能把当前片段放进 SSE 事件。

比如最终结果是：

```json
{
  "summary": "SSE 适合浏览器里的单向流式输出。",
  "tags": ["SSE", "NDJSON"],
  "score": 0.82
}
```

流式过程中可能是：

```text
event: message
data: {"content":"{\"summary\":"}

event: message
data: {"content":"\"SSE 适合浏览器里的单向流式输出。\","}

event: message
data: {"content":"\"tags\":[\"SSE\",\"NDJSON\"],"}

event: message
data: {"content":"\"score\":0.82}"}

event: done
data: {}
```

虽然每个 SSE 事件本身都是完整 JSON，可以直接解析 `event.data`，但多个事件中的 `content` 拼接后，在流结束前仍可能不是完整 JSON。此时如果每收到一段就对拼接结果调用 `JSON.parse`，就会报错。

解决方式是维护一个 `raw` 缓冲区。每次收到 `message` 就追加文本，用支持不完整 JSON 的解析器尝试生成草稿；正常收到 `done` 后，再用严格的 `JSON.parse` 和 schema 校验确认最终结果。

```ts
const source = new EventSource('/api/summary/stream')

let raw = ''

source.addEventListener('message', (event) => {
  const data = JSON.parse(event.data) as { content: string }
  raw += data.content

  // 非内置 API，表示一个能容错解析不完整 JSON 的函数
  const draft = safeParsePartialJson(raw)
  renderDraft(draft)
})

source.addEventListener('done', () => {
  source.close()

  const result = JSON.parse(raw)
  validateResult(result)
  saveStructuredResult(result)
})
```

`safeParsePartialJson` 的结果只能用于草稿 UI，比如先展示已经生成的 `summary`、`tags`。JSON 闭合前，后续 token 仍可能改变结构，因此草稿不能作为最终业务数据。只有正常收到 `done`，并且严格解析和 schema 校验都通过后，结果才能保存、提交或传给下游系统。

## 如何选择

SSE 定义事件如何组织，NDJSON 定义 JSON 记录如何按行分隔。在本文讨论的 HTTP 响应模式中，两者都由客户端发起请求，服务端持续返回数据。

它们的核心差异可以归纳为：

| 维度       | SSE                                            | NDJSON                                   |
| ---------- | ---------------------------------------------- | ---------------------------------------- |
| 定位       | 标准事件流格式                                 | 通用数据编码格式                         |
| 通信方向   | 服务端到客户端                                 | 取决于承载通道，本文场景为服务端流式返回 |
| 浏览器 API | `EventSource`，也可以使用 `fetch`              | `fetch` + `ReadableStream`               |
| 请求方式   | `EventSource` 只支持 `GET`，`fetch` 不受此限制 | 使用 `fetch`，可用 `GET` 或 `POST`       |
| 数据边界   | 文本事件之间用空行分隔                         | 每个 JSON 值以换行符结束                 |
| 事件语义   | 内置 `data`、`event`、`id` 和 `retry` 等字段   | 字段结构完全由应用约定                   |
| 重连支持   | `EventSource` 内置自动重连和 `Last-Event-ID`   | 需要应用自己实现                         |
| 二进制支持 | 不适合                                         | 不适合，通常传输文本 JSON                |
| 典型场景   | AI 文本流、进度、通知和日志                    | 批处理结果、跨服务数据流和结构化事件     |

如果主要面向浏览器，并且需要标准事件字段、自动重连或 `Last-Event-ID`，优先使用 SSE。请求需要 `POST`、JSON 请求体或自定义请求头时，仍然可以通过 `fetch` 接收 SSE，不必因此改用 NDJSON。如果只需要一行一条 JSON 记录，或者数据还要提供给 CLI 和其它服务读取，NDJSON 通常更直接。

无论选择 SSE 还是 NDJSON，都要确认应用服务器和代理不会缓冲响应，并考虑空闲超时、客户端取消和异常中断等情况。响应开始后无法再用新的 HTTP 状态码报告错误，因此服务端通常需要发送应用层错误事件，或者直接结束连接。
