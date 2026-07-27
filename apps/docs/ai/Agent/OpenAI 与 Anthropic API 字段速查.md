---
createdAt: '2026-07-27 21:09'
---

# OpenAI 与 Anthropic API 字段速查

本文整理 OpenAI Chat Completions 与 Anthropic Messages 的常用请求字段、响应结构、流式数据和 TypeScript SDK 示例。具体支持情况以所用模型和 API 版本为准。

## OpenAI Chat Completions

### 请求字段

请求字段按用途分类，复杂类型在后文展开。标为“必填”的字段必须显式传入；其余字段省略时采用表中的默认行为。

#### 基础与生成控制

| 字段                    | 类型或范围                     | 默认值  | 说明                                                                                                 |
| ----------------------- | ------------------------------ | ------- | ---------------------------------------------------------------------------------------------------- |
| `model`                 | `string`                       | 必填    | 生成响应所用的模型 ID；可用字段取决于模型                                                            |
| `messages`              | [`Message[]`](#openai-message) | 必填    | 对话消息列表，至少 1 条                                                                              |
| `stream`                | `boolean`                      | `false` | 是否通过 SSE 流式返回响应                                                                            |
| `max_completion_tokens` | 正整数                         | 无      | 单个候选的 token 上限，包含可见输出和推理 token                                                      |
| `max_tokens`            | 正整数                         | 无      | 已弃用的输出 token 上限；改用 `max_completion_tokens`；o 系列模型不支持                              |
| `n`                     | `1～128`                       | `1`     | 生成候选数，结果位于 `choices[]`；候选越多，输出 token 费用越高                                      |
| `stop`                  | `string \| string[]`           | 无      | 遇到指定文本时停止；最多 4 项；返回内容不含停止文本；`o3` 和 `o4-mini` 不支持                        |
| `temperature`           | `0～2`                         | `1`     | 控制随机性：越低越稳定，越高越多样，但不保证结果可复现。通常只调整 `temperature` 或 `top_p` 其中一个 |
| `top_p`                 | `0～1`                         | `1`     | 按概率从高到低累加，只在累计概率达到该值的候选集合中采样；越低候选越少，`1` 表示不缩小范围           |

#### 工具与结构化输出

| 字段                  | 类型                                        | 默认值                       | 说明                                                                               |
| --------------------- | ------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| `tools`               | [`Tool[]`](#openai-tool)                    | 无                           | 模型可调用的函数或自定义工具列表                                                   |
| `tool_choice`         | [`ToolChoice`](#openai-tool-choice)         | 有工具为 `auto`，否则 `none` | 控制是否调用工具以及可调用的工具范围                                               |
| `parallel_tool_calls` | `boolean`                                   | `true`                       | 是否允许一轮返回多个工具调用                                                       |
| `response_format`     | [`ResponseFormat`](#openai-response-format) | `{ type: text }`             | `text`：普通文本；`json_object`：有效 JSON；`json_schema`：符合指定 Schema 的 JSON |

#### 复合类型定义

<span id="openai-message"></span>

`messages` 的类型是 `Message[]`，每种 `role` 对应一种对象结构：

```ts fold title="Message 对象定义"
type Message =
  | {
      // 应用级指令：旧模型使用 system，o1 及更新模型使用 developer
      role: 'system' | 'developer'
      content: string | TextContentPart[]
      name?: string
    }
  | {
      // 终端用户的提示和上下文
      role: 'user'
      content: string | UserContentPart[]
      name?: string
    }
  | {
      // 模型此前的回复或工具调用
      role: 'assistant'
      // 存在 tool_calls 时可以为空；text 和 refusal 不能混用
      content?: string | TextContentPart[] | [{ type: 'refusal'; refusal: string }] | null
      name?: string
      refusal?: string | null
      audio?: { id: string } | null
      tool_calls?: ToolCall[]
    }
  | {
      // 工具执行结果
      role: 'tool'
      content: string | TextContentPart[]
      // 对应上一条 assistant.tool_calls[].id
      tool_call_id: string
    }

type UserContentPart = TextContentPart | ImageContentPart | AudioContentPart | FileContentPart

type PromptCacheBreakpoint = { mode: 'explicit' }

type TextContentPart = {
  type: 'text'
  text: string
  prompt_cache_breakpoint?: PromptCacheBreakpoint
}

type ImageContentPart = {
  type: 'image_url'
  image_url: {
    // 图片 URL 或 data URL
    url: string
    // 默认为 auto
    detail?: 'auto' | 'low' | 'high'
  }
  prompt_cache_breakpoint?: PromptCacheBreakpoint
}

type AudioContentPart = {
  type: 'input_audio'
  input_audio: {
    // Base64 编码的音频
    data: string
    format: 'wav' | 'mp3'
  }
  prompt_cache_breakpoint?: PromptCacheBreakpoint
}

type FileContentPart = {
  type: 'file'
  file: {
    // 使用已上传文件的 ID，或直接传入 Base64 文件数据
    file_id?: string
    file_data?: string
    // 直接传入 file_data 时可提供文件名
    filename?: string
  }
  prompt_cache_breakpoint?: PromptCacheBreakpoint
}

type ToolCall =
  | {
      id: string
      type: 'function'
      function: {
        name: string
        // JSON 参数字符串，执行前需要校验
        arguments: string
      }
    }
  | {
      id: string
      type: 'custom'
      custom: {
        name: string
        input: string
      }
    }
```

<span id="openai-tool"></span>

`tools` 的类型是 `Tool[]`，支持函数工具和自定义工具：

```ts fold title="Tool 对象定义"
type Tool =
  | {
      type: 'function'
      function: {
        // 工具名，最长 64 字符，只能包含字母、数字、下划线和连字符
        name: string
        // 帮助模型判断何时调用工具
        description?: string
        // 参数的 JSON Schema；省略表示无参数
        parameters?: Record<string, unknown>
        // 是否严格遵循 Schema，默认为 false
        strict?: boolean | null
      }
    }
  | {
      type: 'custom'
      custom: {
        name: string
        description?: string
        // 省略或 text 表示自由文本；grammar 用语法约束输入
        format?:
          | { type: 'text' }
          | {
              type: 'grammar'
              grammar: {
                syntax: 'lark' | 'regex'
                definition: string
              }
            }
      }
    }
```

<span id="openai-tool-choice"></span>

`tool_choice` 的类型是 `ToolChoice`：

```ts fold title="ToolChoice 对象定义"
type ToolChoice =
  // none：不调用；auto：模型决定；required：至少调用一个
  | 'none'
  | 'auto'
  | 'required'
  // 强制调用指定函数工具
  | { type: 'function'; function: { name: string } }
  // 强制调用指定自定义工具
  | { type: 'custom'; custom: { name: string } }
  // 将可调用工具限制在指定集合内
  | {
      type: 'allowed_tools'
      allowed_tools: {
        // auto：可从指定集合中选择，也可不调用工具直接回答
        // required：必须调用指定集合中的至少一个工具
        mode: 'auto' | 'required'
        tools: Array<{ type: 'function'; function: { name: string } } | { type: 'custom'; custom: { name: string } }>
      }
    }
```

<span id="openai-response-format"></span>

`response_format` 的类型是 `ResponseFormat`：

```ts fold title="ResponseFormat 对象定义"
type ResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | {
      type: 'json_schema'
      json_schema: {
        name: string
        description?: string
        schema?: Record<string, unknown>
        strict?: boolean | null
      }
    }
```

#### 高级配置

:::details 字段与类型定义

| 字段                   | 类型或可选值                                               | 默认值                         | 说明                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `presence_penalty`     | `-2～2`                                                    | `0`                            | 按 token 是否出现过调整概率：正值鼓励新内容，负值延续已有内容                                                                                         |
| `frequency_penalty`    | `-2～2`                                                    | `0`                            | 按 token 出现次数调整概率：正值减少重复，负值增加重复                                                                                                 |
| `logit_bias`           | `Record<tokenId, -100～100>`                               | 无                             | 按 token ID 调整概率：负值降低，正值提高；接近 `-100` 时近似禁止，接近 `100` 时近似强制                                                               |
| `logprobs`             | `boolean`                                                  | `false`                        | 是否返回每个输出 token 的对数概率                                                                                                                     |
| `top_logprobs`         | `0～20`                                                    | 无                             | 返回每个位置概率最高的前 k 个候选；必须同时设置 `logprobs: true`                                                                                      |
| `store`                | `boolean`                                                  | `false`                        | 是否保存响应，供后续查询、评估或蒸馏使用                                                                                                              |
| `metadata`             | `Record<string, string>`                                   | 无                             | 附加可查询的元数据，最多 16 对；键最长 64 字符，值最长 512 字符                                                                                       |
| `prompt_cache_key`     | `string`                                                   | 无                             | 为相似请求提供稳定的缓存分组键，提高命中率                                                                                                            |
| `prompt_cache_options` | `{ mode: implicit \| explicit, ttl: 30m }`                 | `{ mode: implicit, ttl: 30m }` | GPT-5.6 及更新模型的缓存断点配置，取代已弃用的 `prompt_cache_retention`；`implicit`：自动选择断点；`explicit`：仅使用显式断点；`ttl` 当前仅支持 `30m` |
| `service_tier`         | `auto \| default \| flex \| scale \| priority`             | `auto`                         | `auto`：按项目配置；`default`：标准处理；`flex`：延迟较高且容量可能不可用；`scale`：Scale Tier；`priority`：优先处理                                  |
| `stream_options`       | `{ include_usage, include_obfuscation }`                   | 无                             | 仅用于 `stream: true`；`include_usage` 默认为 `false`，启用后返回总用量；`include_obfuscation` 默认为 `true`，用于添加流式填充                        |
| `prediction`           | [`Prediction`](#openai-other-types)                        | 无                             | 提供大部分已知的预期输出；内容匹配时可降低延迟                                                                                                        |
| `web_search_options`   | [`WebSearchOptions`](#openai-other-types)                  | 无                             | 启用内置联网搜索，并配置搜索范围和大致位置                                                                                                            |
| `reasoning_effort`     | `none \| minimal \| low \| medium \| high \| xhigh \| max` | `medium`                       | `none`：不额外推理；其余值从最少到最大逐级增加推理量。并非所有模型都支持全部取值                                                                      |
| `verbosity`            | `low \| medium \| high`                                    | `medium`                       | `low`：简短；`medium`：适中；`high`：更详细                                                                                                           |
| `modalities`           | `['text'] \| ['text', 'audio']`                            | `['text']`                     | 仅返回文本，或同时返回文本和音频；包含 `audio` 时必须设置 `audio`                                                                                     |
| `audio`                | [`AudioOutput`](#openai-other-types)                       | 无                             | 配置输出音频的格式和音色；仅在输出音频时使用                                                                                                          |
| `moderation`           | [`Moderation`](#openai-other-types)                        | 无                             | 对请求输入和生成输出执行内容审核                                                                                                                      |
| `safety_identifier`    | 最长 64 字符的 `string`                                    | 无                             | 标识稳定的终端用户，建议传入用户名或邮箱的哈希值，避免发送个人信息                                                                                    |

<span id="openai-other-types"></span>

```ts fold title="复合类型定义"
type Prediction = {
  type: 'content'
  content: string | TextContentPart[]
}

type WebSearchOptions = {
  // 默认为 medium
  search_context_size?: 'low' | 'medium' | 'high'
  user_location?: {
    type: 'approximate'
    approximate: {
      country?: string
      city?: string
      region?: string
      timezone?: string
    }
  } | null
}

type AudioOutput = {
  format: 'wav' | 'aac' | 'mp3' | 'flac' | 'opus' | 'pcm16'
  voice: string | { id: string }
}

type Moderation = {
  model: string
  policy?: {
    input?: { mode: 'score' | 'block' } | null
    output?: { mode: 'score' | 'block' } | null
  } | null
}
```

:::

#### 请求示例

下面展示一个包含函数工具和结构化输出的请求对象：

```ts fold title="请求示例"
{
  model: 'openai-model-id',
  messages: [
    { role: 'developer', content: '你是助手' },
    { role: 'user', content: '查询流式响应的说明' },
    // 将上一轮响应中的 assistant.tool_calls 原样加入对话历史
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_xxx',
          type: 'function',
          function: {
            name: 'search',
            arguments: '{"query":"流式响应"}',
          },
        },
      ],
    },
    // 执行工具后，用 tool_call_id 回传对应调用的结果
    {
      role: 'tool',
      tool_call_id: 'call_xxx',
      // 对象结果需序列化为字符串，也可以使用文本内容数组
      content: 'search 工具返回的查询结果',
    },
  ],
  stream: false,
  temperature: 0.7,
  max_completion_tokens: 1024,
  tools: [
    {
      type: 'function',
      function: {
        name: 'search',
        description: '查询文档',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
          additionalProperties: false,
        },
        strict: true,
      },
    },
  ],
  tool_choice: 'auto',
  parallel_tool_calls: true,
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'answer',
      schema: {
        type: 'object',
        properties: {
          answer: { type: 'string' },
        },
        required: ['answer'],
        additionalProperties: false,
      },
      strict: true,
    },
  },
}
```

### 响应字段

```ts fold title="响应体"
{
  // 本次响应的唯一 ID
  id: 'chatcmpl-xxx',
  // 固定为 chat.completion
  object: 'chat.completion',
  // 响应创建时间，Unix 秒级时间戳
  created: 1700000000,
  // 实际生成响应的模型 ID
  model: 'openai-model-id',
  // 已弃用；后端推理栈指纹，变动代表底层运行配置发生变化
  system_fingerprint: 'fp_xxx',
  // 实际使用的服务层级，可能与请求值不同
  service_tier: 'default',

  // 候选回答数组，数量由请求字段 n 决定
  choices: [
    {
      // 候选回答的序号，从 0 开始
      index: 0,
      // 模型生成的消息
      message: {
        // 固定为 assistant
        role: 'assistant',
        // 工具调用前也可能先返回一段说明；仅返回工具调用时为 null
        content: '我来查询相关文档。',
        // 模型的拒绝说明；未拒绝时为 null
        refusal: null,
        // 使用内置网页搜索时返回 URL 引用；元素包含 type 和 url_citation
        annotations: [],
        // 请求音频输出时返回 { id, data, expires_at, transcript }；否则为 null
        audio: null,
        // 模型请求执行的工具调用；未调用时省略
        tool_calls: [
          {
            // 回传结果时用作 tool_call_id
            id: 'call_xxx',
            // 工具调用类型
            type: 'function',
            // 函数工具的调用信息
            function: {
              // 要调用的函数工具名
              name: 'search',
              // 参数是模型生成的 JSON 字符串，需解析并按工具 schema 校验
              arguments: '{"query":"..."}',
            },
          },
        ],
      },
      // stop：自然结束；tool_calls：等待工具执行；length：达到输出上限；content_filter：内容审核拦截
      finish_reason: 'tool_calls',
      // 启用 logprobs 时返回
      logprobs: null,
    },
  ],

  // 本次请求的 token 用量
  usage: {
    // 输入消息消耗的 token
    prompt_tokens: 100,
    // 模型输出消耗的 token
    completion_tokens: 50,
    // 输入与输出 token 总数
    total_tokens: 150,
    // 输入 token 的分类明细
    prompt_tokens_details: {
      // 命中 prompt cache 复用的输入 token
      cached_tokens: 0,
      // 写入 prompt cache 的原始输入 token
      cache_write_tokens: 0,
      // 输入音频消耗的 token
      audio_tokens: 0,
    },
    // 输出 token 的分类明细
    completion_tokens_details: {
      // 推理模型消耗的推理 token；非推理模型通常为 0
      reasoning_tokens: 30,
      // 输出音频消耗的 token
      audio_tokens: 0,
      // speculative decoding 接受的预测 token
      accepted_prediction_tokens: 0,
      // speculative decoding 拒绝的预测 token
      rejected_prediction_tokens: 0,
    },
  },
}
```

`finish_reason` 说明模型为什么停止当前候选：

| 枚举值           | 具体含义                           |
| ---------------- | ---------------------------------- |
| `stop`           | 自然结束，或命中了请求中的停止序列 |
| `length`         | 达到请求的输出上限或模型上下文上限 |
| `tool_calls`     | 模型返回了工具调用，等待调用方执行 |
| `content_filter` | 输出被内容安全系统截断             |

### 流式响应

设置 `stream: true` 后，OpenAI 返回一系列 `chat.completion.chunk`。每个 chunk 是顶层响应的一个增量视图；文本在 `choices[].delta.content` 中累积，工具调用则通过 `delta.tool_calls[]` 拼装。

```ts fold title="chunk 字段"
{
  // 本次流式响应的唯一 ID，同一响应的所有 chunk 相同
  id: 'chatcmpl-xxx',
  // 固定为 chat.completion.chunk
  object: 'chat.completion.chunk',
  // 响应创建时间，Unix 秒级时间戳
  created: 1700000000,
  // 实际生成响应的模型 ID
  model: 'gpt-4o-mini-2024-07-18',
  // 已弃用；后端推理栈指纹
  system_fingerprint: 'fp_xxx',
  // 实际使用的服务层级
  service_tier: 'default',

  // 候选回答的增量；仅包含 usage 的 chunk 中为空数组
  choices: [
    {
      // 候选回答的序号，与非流式响应对应
      index: 0,
      // delta 等价于响应 message 的差量
      delta: {
        // 仅首 chunk 出现
        role: 'assistant',
        // 本次返回的文本增量，按顺序拼接
        content: '我来查询',
        // 本次返回的拒绝内容增量；没有时为 null
        refusal: null,
        // 工具调用的增量片段，按 index 分组拼接
        tool_calls: [
          {
            // 同时返回的多个工具调用按 index 区分
            index: 0,
            // id 只在该 id 首个 chunk 出现
            id: 'call_xxx',
            // 工具调用类型，通常只在首个相关 chunk 出现
            type: 'function',
            // 函数工具的调用信息增量
            function: {
              // name 仅首次出现
              name: 'search',
              // 参数 JSON 字符串的增量片段，多个 chunk 拼起来再 parse
              arguments: '{"query',
            },
          },
        ],
      },
      // 仅最后一个 chunk 给出；其他为 null
      finish_reason: null,
      // 启用 logprobs 时返回当前增量的对数概率
      logprobs: null,
    },
  ],

  // include_usage=true 时，在结束前的额外 chunk 中返回；该 chunk 的 choices 为空
  // 流被中断时可能收不到 usage
  usage: { /* 与非流式响应一致 */ },
  // 默认用于平衡流式负载大小的随机填充；include_obfuscation=false 时省略
  obfuscation: 'random-padding',
}
```

```ts fold title="OpenAI SDK 接入示例"
import OpenAI from 'openai'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// stream: true 返回 AsyncIterable<ChatCompletionChunk>
const stream = await client.chat.completions.create(
  {
    model: 'gpt-4o-mini',
    messages,
    stream: true,
    stream_options: { include_usage: true },
  },
  // 把浏览器取消信号透传上游 fetch
  { signal: abortSignal }
)

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta
  // 文本增量
  if (delta?.content) appendText(delta.content)
  // 工具调用增量：要累积 arguments 再 parse
  for (const call of delta?.tool_calls ?? []) {
    accumulateToolCall(call)
  }
  // usage 位于结束前的额外 chunk 中
  if (chunk.usage) logUsage(chunk.usage)
}
```

## Anthropic Messages

### 请求字段

请求字段按用途分类，复杂类型在后文展开。标为“必填”的字段必须显式传入；其余字段省略时采用表中的默认行为。

#### 基础与生成控制

| 字段             | 类型或范围                                             | 默认值     | 说明                                                                                         |
| ---------------- | ------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------- |
| `model`          | `string`                                               | 必填       | 生成响应所用的 Claude 模型 ID                                                                |
| `messages`       | [`Message[]`](#anthropic-message)                      | 必填       | 对话消息列表，仅支持 `user` 和 `assistant` 角色                                              |
| `max_tokens`     | 非负整数                                               | 必填       | 输出 token 上限；`0` 只写入 prompt cache，不生成内容                                         |
| `system`         | `string` \| [`TextContentBlock[]`](#anthropic-message) | 无         | 顶层系统提示词，不属于 `messages`                                                            |
| `stream`         | `boolean`                                              | `false`    | 是否通过 SSE 流式返回响应                                                                    |
| `stop_sequences` | `string[]`                                             | `[]`       | 遇到指定文本时停止生成，匹配值写入 `stop_sequence`                                           |
| `temperature`    | `0～1`                                                 | `1`        | 已弃用；越低越稳定，越高越多样；Claude Opus 4.6 之后发布的模型仅兼容值 `1`                   |
| `top_p`          | `0～1`                                                 | 模型默认值 | 已弃用；越低参与采样的高概率候选越少；Claude Opus 4.6 之后发布的模型仅兼容不小于 `0.99` 的值 |
| `top_k`          | 非负整数                                               | 模型默认值 | 已弃用；仅从概率最高的 k 个 token 中采样；Claude Opus 4.6 之后发布的模型不接受该字段         |

#### 工具与结构化输出

| 字段            | 类型                                       | 默认值                       | 说明                                   |
| --------------- | ------------------------------------------ | ---------------------------- | -------------------------------------- |
| `tools`         | [`Tool[]`](#anthropic-tool)                | 无                           | 模型可调用的客户端工具列表             |
| `tool_choice`   | [`ToolChoice`](#anthropic-tool-choice)     | 有工具为 `auto`，否则 `none` | 控制是否调用工具、指定工具和并行调用   |
| `output_config` | [`OutputConfig`](#anthropic-output-config) | 取决于模型                   | 配置推理投入和结构化 JSON 输出         |
| `thinking`      | [`ThinkingConfig`](#anthropic-thinking)    | 取决于模型                   | 配置自适应推理、固定推理预算或关闭推理 |

#### 复合类型定义

<span id="anthropic-message"></span>

`messages` 的类型是 `Message[]`。相邻的同角色消息会被合并，最后一条 `assistant` 消息可用于预填响应开头：

```ts fold title="Message 对象定义"
type Message =
  | {
      // 用户输入或工具执行结果
      role: 'user'
      content: string | UserContentBlock[]
    }
  | {
      // 模型此前的回复或工具调用
      role: 'assistant'
      content: string | AssistantContentBlock[]
    }

type UserContentBlock =
  | TextContentBlock
  | ImageContentBlock
  | DocumentContentBlock
  | SearchResultContentBlock
  | {
      type: 'tool_result'
      // 对应上一条 assistant.tool_use.id
      tool_use_id: string
      content?: string | Array<TextContentBlock | ImageContentBlock | DocumentContentBlock | SearchResultContentBlock>
      // 默认为 false
      is_error?: boolean
      cache_control?: CacheControl
    }

type AssistantContentBlock =
  | {
      type: 'text'
      text: string
      citations?: Array<Record<string, unknown>>
    }
  | {
      type: 'tool_use'
      id: string
      name: string
      input: Record<string, unknown>
    }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | {
      // 上下文压缩生成的摘要
      type: 'compaction'
      content: string | null
      cache_control?: CacheControl
    }
  | {
      // 内置服务端工具调用
      type: 'server_tool_use'
      id: string
      name: string
      input: Record<string, unknown>
    }

type TextContentBlock = {
  type: 'text'
  text: string
  citations?: Array<Record<string, unknown>>
  cache_control?: CacheControl
}

type ImageContentBlock = {
  type: 'image'
  source:
    | {
        type: 'base64'
        media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
        data: string
      }
    | { type: 'url'; url: string }
    | { type: 'file'; file_id: string }
  cache_control?: CacheControl
}

type DocumentContentBlock = {
  type: 'document'
  source: { type: 'base64'; media_type: 'application/pdf'; data: string } | { type: 'text'; media_type: 'text/plain'; data: string } | { type: 'content'; content: string | TextContentBlock[] } | { type: 'url'; url: string } | { type: 'file'; file_id: string }
  title?: string
  context?: string
  citations?: { enabled: boolean }
  cache_control?: CacheControl
}

type SearchResultContentBlock = {
  type: 'search_result'
  source: string
  title: string
  content: TextContentBlock[]
  citations?: { enabled: boolean }
  cache_control?: CacheControl
}

type CacheControl = {
  type: 'ephemeral'
  // 默认为 5m
  ttl?: '5m' | '1h'
}
```

<span id="anthropic-tool"></span>

`tools` 的类型是 `Tool[]`：

```ts fold title="Tool 对象定义"
type Tool = {
  // 客户端工具可以省略；显式设置时固定为 custom
  type?: 'custom'
  // 1～128 个字符，只能包含字母、数字、下划线和连字符
  name: string
  // 帮助模型判断何时调用工具
  description?: string
  // 工具参数的 JSON Schema
  input_schema: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean | Record<string, unknown>
  }
  // 是否延迟加载工具定义，默认为 false
  defer_loading?: boolean
  // 帮助模型理解参数格式的输入示例
  input_examples?: Array<Record<string, unknown>>
  // 是否严格校验工具名和参数，默认为 false
  strict?: boolean
  // 是否尽早流式返回工具参数；省略时由相关 Beta 请求头决定
  eager_input_streaming?: boolean | null
  cache_control?: CacheControl
}
```

<span id="anthropic-tool-choice"></span>

`tool_choice` 的类型是 `ToolChoice`。设置 `disable_parallel_tool_use: true` 后，`auto` 可以不调用工具，但最多调用一个；`any` 必须从 `tools` 中调用一个；`tool` 必须调用 `name` 指定的工具一次。启用 `thinking` 时，`tool_choice` 仅支持 `auto` 或 `none`。具体结构如下：

```ts fold title="ToolChoice 对象定义"
type ToolChoice =
  // auto：模型决定是否调用
  | { type: 'auto'; disable_parallel_tool_use?: boolean }
  // none：不调用
  | { type: 'none' }
  // any：至少调用一个工具
  | { type: 'any'; disable_parallel_tool_use?: boolean }
  // tool：强制调用 name 指定的工具
  | { type: 'tool'; name: string; disable_parallel_tool_use?: boolean }
```

<span id="anthropic-output-config"></span>

`output_config` 的类型是 `OutputConfig`：

```ts fold title="OutputConfig 对象定义"
type OutputConfig = {
  // 推理投入从低到高；具体支持值取决于模型
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  format?: {
    type: 'json_schema'
    schema: Record<string, unknown>
  }
  // 跨上下文共享的 token 总预算
  task_budget?: {
    type: 'tokens'
    total: number
    // 省略时等于 total；客户端压缩上下文时用于续传剩余预算
    remaining?: number
  }
}
```

<span id="anthropic-thinking"></span>

`thinking` 的类型是 `ThinkingConfig`：

```ts fold title="ThinkingConfig 对象定义"
type ThinkingConfig =
  | {
      // 模型自动决定推理投入
      type: 'adaptive'
      // 默认为 summarized；omitted 只返回签名，不返回推理内容
      display?: 'summarized' | 'omitted'
    }
  | {
      // 固定推理预算，至少 1024 且小于 max_tokens
      type: 'enabled'
      budget_tokens: number
      // 默认为 summarized；omitted 只返回签名，不返回推理内容
      display?: 'summarized' | 'omitted'
    }
  | { type: 'disabled' }
```

#### 高级配置

:::details 字段与类型定义

| 字段                 | 类型或可选值                                       | 默认值     | 说明                                                          |
| -------------------- | -------------------------------------------------- | ---------- | ------------------------------------------------------------- |
| `service_tier`       | `auto \| standard_only`                            | `auto`     | `auto`：可使用账户的优先容量；`standard_only`：仅使用标准容量 |
| `speed`              | `standard \| fast`                                 | `standard` | 选择标准或低延迟推理；`fast` 仅受部分模型支持且费用更高       |
| `metadata`           | `{ user_id }`                                      | 无         | 提供稳定且不含个人信息的终端用户标识                          |
| `container`          | [`string \| Container`](#anthropic-advanced-types) | 无         | 传入容器 ID 复用环境，或同时配置容器技能                      |
| `inference_geo`      | `global` 或区域代码                                | 工作区配置 | 指定推理区域；可用值取决于账户和模型                          |
| `mcp_servers`        | [`MCPServer[]`](#anthropic-advanced-types)         | 无         | 连接本轮请求使用的远程 MCP 服务器                             |
| `context_management` | [`ContextManagement`](#anthropic-advanced-types)   | 无         | 配置长会话的自动上下文编辑                                    |

<span id="anthropic-advanced-types"></span>

```ts fold title="复合类型定义"
type MCPServer = {
  type: 'url'
  name: string
  url: string
  authorization_token?: string
  tool_configuration?: {
    enabled?: boolean
    allowed_tools?: string[]
  }
}

type ContextManagement = {
  edits?: Array<Record<string, unknown>>
}

type Container = {
  // 复用已有容器时传入
  id?: string
  skills?: Array<{
    skill_id: string
    type: 'anthropic' | 'custom'
    version?: string
  }>
}
```

:::

#### 请求示例

下面展示一个包含客户端工具和结构化输出的请求对象：

```ts fold title="请求示例"
{
  model: 'claude-model-id',
  messages: [
    { role: 'user', content: '查询流式响应的说明' },
    // 将上一轮响应中的 assistant.tool_use 原样加入对话历史
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_xxx',
          name: 'search',
          input: { query: '流式响应' },
        },
      ],
    },
    // 下一条 user 消息用 tool_result 回传结果，tool_use_id 必须匹配上一条 tool_use.id
    {
      role: 'user',
      content: [
        // 多个 tool_result 均需放在普通文本之前
        {
          type: 'tool_result',
          tool_use_id: 'toolu_xxx',
          content: 'search 工具返回的查询结果',
        },
        { type: 'text', text: '请整理为简短说明' },
      ],
    },
  ],
  max_tokens: 1024,
  stream: false,
  system: '你是助手',
  tools: [
    {
      name: 'search',
      description: '查询文档',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
      strict: true,
    },
  ],
  tool_choice: { type: 'auto' },
  output_config: {
    effort: 'medium',
    format: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          answer: { type: 'string' },
        },
        required: ['answer'],
        additionalProperties: false,
      },
    },
  },
}
```

### 响应字段

```ts fold title="响应体"
{
  // 本次响应的唯一 ID
  id: 'msg_xxx',
  // 固定为 message
  type: 'message',
  // 固定为 assistant
  role: 'assistant',
  // 实际生成响应的模型 ID
  model: 'claude-model-id',

  // 返回工具调用，等待调用方执行
  stop_reason: 'tool_use',
  // 命中的自定义停止序列，否则为 null
  stop_sequence: null,
  // 代码执行容器的信息，否则为 null
  container: null,
  // 本轮应用的上下文编辑及其结果；未配置时为 null
  context_management: null,
  // 拒绝等特殊停止原因的结构化详情，否则为 null
  stop_details: null,

  // 模型输出块，按生成顺序排列
  content: [
    {
      type: 'text',
      // 工具调用前生成的说明
      text: '我来查询相关文档。',
    },
    {
      type: 'tool_use',
      // 本次工具调用的唯一 ID；回传结果时写入 tool_use_id
      id: 'toolu_xxx',
      // 对应请求 tools[].name
      name: 'search',
      // 符合工具 input_schema 的参数对象
      input: { query: '...' },
    },
    // 其他常见输出块：
    // { type: 'thinking', thinking, signature }
    // { type: 'redacted_thinking', data }
    // 内置工具还会返回 server_tool_use 和对应的结果块
  ],

  // 本次请求的 token 用量
  usage: {
    // 未命中缓存的输入 token
    input_tokens: 100,
    // 生成的输出 token
    output_tokens: 50,
    // 新写入 prompt cache 的输入 token
    cache_creation_input_tokens: 0,
    // 从 prompt cache 读取的输入 token
    cache_read_input_tokens: 0,
    cache_creation: {
      // 分别写入 1 小时和 5 分钟缓存的 token
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
    // 实际使用的服务层级：standard 标准、priority 优先、batch 批处理；未提供时为 null
    service_tier: 'standard',
    // 实际使用的推理速度：standard 标准、fast 低延迟；未提供时为 null
    speed: 'standard',
    // 实际执行推理的区域
    inference_geo: 'us',
    output_tokens_details: {
      // 用于推理的输出 token
      thinking_tokens: 30,
    },
    // 内置服务端工具的调用次数
    server_tool_use: {
      web_search_requests: 0,
      web_fetch_requests: 0,
    },
  },
}
```

`stop_reason` 说明整条 Anthropic 消息为什么结束：

| 枚举值                          | 具体含义                                             |
| ------------------------------- | ---------------------------------------------------- |
| `end_turn`                      | 模型自然完成当前轮次                                 |
| `max_tokens`                    | 达到请求的 `max_tokens` 或模型输出上限               |
| `stop_sequence`                 | 命中自定义停止序列，匹配值同时写入 `stop_sequence`   |
| `tool_use`                      | 模型返回一个或多个工具调用，等待调用方执行           |
| `pause_turn`                    | 长时间运行的轮次被暂停，可把响应传回 API 继续        |
| `compaction`                    | 生成上下文压缩摘要后暂停；需回传 `compaction` 块继续 |
| `refusal`                       | 模型拒绝处理该请求                                   |
| `model_context_window_exceeded` | 达到模型上下文窗口限制                               |

### 流式响应

设置 `stream: true` 后，Anthropic 通过 SSE 推送响应。每个事件的数据都包含 `type`，具体结构见下方类型定义。

```ts fold title="事件联合类型"
type StreamEvent =
  // 响应开始；content 为空，stop_reason 为 null
  | { type: 'message_start'; message: Record<string, unknown> }
  // 内容块开始；index 对应最终 content[] 的下标
  | { type: 'content_block_start'; index: number; content_block: AssistantContentBlock }
  // 内容块增量；具体结构由 delta.type 决定
  | { type: 'content_block_delta'; index: number; delta: ContentBlockDelta }
  // 内容块结束
  | { type: 'content_block_stop'; index: number }
  // 顶层字段增量；usage 中的 token 数为累计值
  | {
      type: 'message_delta'
      delta: {
        // 代码执行容器的增量信息；未使用时省略
        container?: Container | null
        // 拒绝等特殊停止原因的结构化详情；无详情时省略
        stop_details?: Record<string, unknown> | null
        stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'pause_turn' | 'compaction' | 'refusal' | 'model_context_window_exceeded' | null
        stop_sequence: string | null
      }
      usage: { output_tokens: number; [key: string]: unknown }
      // 本轮应用的上下文编辑；未配置时为 null
      context_management?: { applied_edits: Array<Record<string, unknown>> } | null
    }
  // 响应结束
  | { type: 'message_stop' }
  // 心跳事件
  | { type: 'ping' }
  // 错误事件
  | { type: 'error'; error: { type: string; message: string } }

type ContentBlockDelta =
  // 文本增量
  | { type: 'text_delta'; text: string }
  // 工具参数的 JSON 字符串片段；累积完成后再解析
  | { type: 'input_json_delta'; partial_json: string }
  // 推理块增量
  | { type: 'thinking_delta'; thinking: string }
  // 推理签名增量
  | { type: 'signature_delta'; signature: string }
  // 上下文压缩摘要；一次返回完整内容
  | { type: 'compaction_delta'; content: string | null }
  // 文本引用信息增量
  | { type: 'citations_delta'; citation: Record<string, unknown> }
```

```ts fold title="Anthropic SDK 接入示例"
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const stream = client.messages.stream({ model: 'claude-sonnet-5', max_tokens: 1024, messages }, { signal: abortSignal })

for await (const event of stream) {
  switch (event.type) {
    case 'content_block_delta':
      switch (event.delta.type) {
        case 'text_delta':
          appendText(event.delta.text)
          break
        case 'input_json_delta':
          accumulateToolInput(event.delta.partial_json)
          break
        case 'thinking_delta':
          accumulateThinking(event.delta.thinking)
          break
      }
      break
    case 'message_delta':
      logStopReason(event.delta.stop_reason)
      break
    case 'error':
      handleError(event.error)
      break
  }
}

const finalMessage = await stream.finalMessage()
logUsage(finalMessage.usage)
```
