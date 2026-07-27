---
createdAt: '2026-07-25 17:09'
draft: true
order: 9
---

# OpenAI 与 Anthropic 接口字段速查表

本文对照 OpenAI Chat Completions 与 Anthropic Messages 的常用字段，并给出请求、响应、流式数据及 TypeScript SDK 示例。字段支持取决于模型和 API 版本，beta 字段还需要对应的 beta header。

## OpenAI Chat Completions

### 请求字段

请求字段先按用途列出，复杂联合类型在后文展开。标为“必填”的字段没有默认值；其余字段省略时使用表中的默认行为。

#### 基础与生成控制

| 字段                    | 类型或范围            | 默认值 | 说明                                         |
| ----------------------- | --------------------- | ------ | -------------------------------------------- |
| `model`                 | `string`              | 必填   | 生成响应所用的模型 ID；可用字段取决于模型    |
| `messages`              | [`Message[]`](#openai-message) | 必填   | 对话消息列表，至少 1 条 |
| `stream`                | `boolean`             | `false` | 是否通过 SSE 流式返回响应                   |
| `max_completion_tokens` | 正整数                | 无     | 单个候选的 token 上限，包含可见输出和推理 token |
| `max_tokens`            | 正整数                | 无     | 已弃用的输出 token 上限；改用 `max_completion_tokens`；o 系列模型不支持 |
| `n`                     | `1～128`              | `1`    | 生成候选数，结果位于 `choices[]`；候选越多，输出 token 费用越高 |
| `stop`                  | `string \| string[]` | 无     | 遇到指定文本时停止；最多 4 项；返回内容不含停止文本；`o3` 和 `o4-mini` 不支持 |
| `temperature`           | `0～2`                | `1`    | 控制随机性：越低越稳定，越高越多样，但不保证结果可复现。通常只调整 `temperature` 或 `top_p` 其中一个 |
| `top_p`                 | `0～1`                | `1`    | 按概率从高到低累加，只在累计概率达到该值的候选集合中采样；越低候选越少，`1` 表示不缩小范围 |

#### 工具与结构化输出

| 字段                  | 类型                                             | 默认值                     | 说明                                      |
| --------------------- | ------------------------------------------------ | -------------------------- | ----------------------------------------- |
| `tools`               | [`Tool[]`](#openai-tool)                         | 无                         | 模型可调用的函数或自定义工具列表            |
| `tool_choice`         | [`ToolChoice`](#openai-tool-choice)               | 有工具为 `auto`，否则 `none` | 控制是否调用工具以及可调用的工具范围        |
| `parallel_tool_calls` | `boolean`                                        | `true`                     | 是否允许一轮返回多个工具调用              |
| `response_format`     | `{ type: text \| json_object \| json_schema }`  | `{ type: text }`           | `text`：普通文本；`json_object`：有效 JSON；`json_schema`：符合指定 Schema 的 JSON |

:::details 高级配置

| 字段                     | 类型或可选值                                                        | 默认值     | 说明                                      |
| ------------------------ | ------------------------------------------------------------------- | ---------- | ----------------------------------------- |
| `presence_penalty`       | `-2～2`                                                             | `0`        | 按 token 是否出现过调整概率：正值鼓励新内容，负值延续已有内容 |
| `frequency_penalty`      | `-2～2`                                                             | `0`        | 按 token 出现次数调整概率：正值减少重复，负值增加重复 |
| `logit_bias`             | `Record<tokenId, -100～100>`                                        | 无         | 按 token ID 调整概率：负值降低，正值提高；接近 `-100` 时近似禁止，接近 `100` 时近似强制 |
| `logprobs`               | `boolean`                                                           | `false`    | 是否返回每个输出 token 的对数概率         |
| `top_logprobs`           | `0～20`                                                             | 无         | 返回每个位置概率最高的前 k 个候选；必须同时设置 `logprobs: true` |
| `store`                  | `boolean`                                                           | `false`    | 是否保存响应，供后续查询、评估或蒸馏使用   |
| `metadata`               | `Record<string, string>`                                            | 无         | 附加可查询的元数据，最多 16 对；键最长 64 字符，值最长 512 字符 |
| `prompt_cache_key`       | `string`                                                            | 无         | 为相似请求提供稳定的缓存分组键，提高命中率 |
| `prompt_cache_options`   | `{ mode: implicit \| explicit, ttl: 30m }`                          | `{ mode: implicit, ttl: 30m }` | GPT-5.6 及更新模型的缓存断点配置；`implicit`：自动选择断点；`explicit`：仅使用显式断点；`ttl` 当前仅支持 `30m` |
| `service_tier`           | `auto \| default \| flex \| scale \| priority`                    | `auto`     | `auto`：按项目配置；`default`：标准处理；`flex`：延迟较高且容量可能不可用；`scale`：Scale Tier；`priority`：优先处理 |
| `stream_options`         | `{ include_usage, include_obfuscation }`                            | 无         | 仅用于 `stream: true`；`include_usage` 默认为 `false`，启用后返回总用量；`include_obfuscation` 默认为 `true`，用于添加流式填充 |
| `prediction`             | `{ type: content, content }`                                        | 无         | 提供大部分已知的预期输出；内容匹配时可降低延迟，结构见下文 |
| `web_search_options`     | `{ search_context_size?, user_location? }`                          | 无         | 启用内置联网搜索；搜索范围和位置结构见下文 |
| `reasoning_effort`       | `none \| minimal \| low \| medium \| high \| xhigh \| max`          | `medium`   | `none`：不额外推理；其余值从最少到最大逐级增加推理量。并非所有模型都支持全部取值 |
| `verbosity`              | `low \| medium \| high`                                             | `medium`   | `low`：简短；`medium`：适中；`high`：更详细 |
| `modalities`             | `['text'] \| ['text', 'audio']`                                    | `['text']` | 仅返回文本，或同时返回文本和音频；包含 `audio` 时必须设置 `audio` |
| `audio`                  | `{ format, voice }`                                                 | 无         | 配置输出音频的格式和音色；仅在输出音频时使用，结构见下文 |
| `moderation`             | `{ model, policy? }`                                                | 无         | 对请求输入和生成输出执行内容审核，结构见下文 |
| `safety_identifier`      | 最长 64 字符的 `string`                                             | 无         | 标识稳定的终端用户，建议传入用户名或邮箱的哈希值，避免发送个人信息 |

:::

#### 复杂字段用法

<span id="openai-message"></span>

`messages` 的类型是 `Message[]`，每种 `role` 对应一种对象结构：

```ts fold title="Message 对象定义"
type Message =
  | {
      // 应用级指令：旧模型使用 system，o1 及更新模型使用 developer
      role: 'system' | 'developer';
      content: string | TextContentPart[];
      name?: string;
    }
  | {
      // 终端用户的提示和上下文
      role: 'user';
      content: string | UserContentPart[];
      name?: string;
    }
  | {
      // 模型此前的回复或工具调用
      role: 'assistant';
      // 存在 tool_calls 时可以为空；text 和 refusal 不能混用
      content?: string | TextContentPart[] | [{ type: 'refusal'; refusal: string }] | null;
      name?: string;
      refusal?: string | null;
      audio?: { id: string } | null;
      tool_calls?: ToolCall[];
    }
  | {
      // 工具执行结果
      role: 'tool';
      content: string | TextContentPart[];
      // 对应上一条 assistant.tool_calls[].id
      tool_call_id: string;
    };

type UserContentPart =
  | TextContentPart
  | ImageContentPart
  | AudioContentPart
  | FileContentPart;

type PromptCacheBreakpoint = { mode: 'explicit' };

type TextContentPart = {
  type: 'text';
  text: string;
  prompt_cache_breakpoint?: PromptCacheBreakpoint;
};

type ImageContentPart = {
  type: 'image_url';
  image_url: {
    // 图片 URL 或 data URL
    url: string;
    // 默认为 auto
    detail?: 'auto' | 'low' | 'high';
  };
  prompt_cache_breakpoint?: PromptCacheBreakpoint;
};

type AudioContentPart = {
  type: 'input_audio';
  input_audio: {
    // Base64 编码的音频
    data: string;
    format: 'wav' | 'mp3';
  };
  prompt_cache_breakpoint?: PromptCacheBreakpoint;
};

type FileContentPart = {
  type: 'file';
  file:
    | { file_id: string }
    | { file_data: string; filename?: string };
  prompt_cache_breakpoint?: PromptCacheBreakpoint;
};

type ToolCall =
  | {
      id: string;
      type: 'function';
      function: {
        name: string;
        // JSON 参数字符串，执行前需要校验
        arguments: string;
      };
    }
  | {
      id: string;
      type: 'custom';
      custom: {
        name: string;
        input: string;
      };
    };
```

<span id="openai-tool"></span>

`tools` 的类型是 `Tool[]`，支持函数工具和自定义工具：

```ts fold title="Tool 对象定义"
type Tool =
  | {
      type: 'function';
      function: {
        // 工具名，最长 64 字符，只能包含字母、数字、下划线和连字符
        name: string;
        // 帮助模型判断何时调用工具
        description?: string;
        // 参数的 JSON Schema；省略表示无参数
        parameters?: Record<string, unknown>;
        // 是否严格遵循 Schema，默认为 false
        strict?: boolean | null;
      };
    }
  | {
      type: 'custom';
      custom: {
        name: string;
        description?: string;
        // 省略或 text 表示自由文本；grammar 用语法约束输入
        format?:
          | { type: 'text' }
          | {
              type: 'grammar';
              grammar: {
                syntax: 'lark' | 'regex';
                definition: string;
              };
            };
      };
    };
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
      type: 'allowed_tools';
      allowed_tools: {
        // auto：也可直接回答；required：必须调用至少一个工具
        mode: 'auto' | 'required';
        tools: Array<
          | { type: 'function'; function: { name: string } }
          | { type: 'custom'; custom: { name: string } }
        >;
      };
    };
```

高级与多模态对象字段的结构如下：

| 字段                              | 类型或可选值                                                              | 含义                                      |
| --------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| `prediction.type`                 | `content`                                                                 | 当前仅支持静态内容预测                    |
| `prediction.content`              | 字符串或文本内容块数组                                                    | 模型生成时要匹配的预期内容                |
| `web_search_options.search_context_size` | `low \| medium \| high`                                            | 搜索上下文较少、适中或较多；默认为 `medium` |
| `web_search_options.user_location` | `{ type: approximate, approximate }`                                     | 可选的大致位置，用于优化本地化搜索结果    |
| `audio.format`                    | `wav \| aac \| mp3 \| flac \| opus \| pcm16`                             | 输出音频格式                              |
| `audio.voice`                     | 内置音色或 `{ id: string }`                                               | 选择内置音色，或引用已创建的自定义音色    |
| `moderation.model`                | `string`                                                                  | 必填的审核模型 ID                         |
| `moderation.policy.input.mode`    | `score \| block`                                                          | `score`：仅返回评分；`block`：命中时阻断输入 |
| `moderation.policy.output.mode`   | `score \| block`                                                          | `score`：仅返回评分；`block`：命中时阻断输出 |

以下字段是联合类型，完整结构可在后面的请求示例中直接查找：

| 字段                 | 常用选择                                                     |
| -------------------- | ------------------------------------------------------------ |
| `response_format`    | 普通文本、旧版 JSON 模式、按 JSON Schema 严格输出            |
| `prediction.content` | 字符串或文本内容块数组                                       |
| `stop`               | 单个停止字符串或最多 4 个字符串                              |
| `modalities`         | 仅文本，或同时返回文本和音频                                 |

#### 完整请求示例

下面的对象用于展示字段结构，其中包含互斥或依赖特定模型的配置，不能整体原样提交。

```ts fold title="完整请求字段示例"
/**
 * 字段示意，不能原样作为完整请求提交；具体支持情况取决于模型。
 */
{
  // 必填
  model: 'openai-model-id',
  // 对话历史
  messages: [
    // system 和 developer 的 content 支持字符串或文本内容块数组
    // 旧模型使用 system 传递应用级指令
    { role: 'system', content: '你是助手' },
    // o1 及更新模型使用 developer 替代 system；二者按模型选择
    {
      role: 'developer',
      content: [
        {
          type: 'text',
          text: '你是助手',
          // 可选的显式缓存断点
          prompt_cache_breakpoint: { mode: 'explicit' },
        },
      ],
    },
    // user 是终端用户发送的提示或上下文；content 支持字符串或内容块数组
    // 数组可包含文本、图片、音频或文件，具体支持情况取决于模型
    { role: 'user', content: '查询流式响应的说明' },
    {
      role: 'user',
      // 可选名称，用于区分相同 role 的参与者
      name: 'end_user',
      content: [
        { type: 'text', text: '分析以下图片、音频和文件' },
        {
          type: 'image_url',
          image_url: {
            // 支持图片 URL 或 data URL
            url: 'https://example.com/image.png',
            // 图片细节级别：'auto'、'low'、'high'
            detail: 'auto',
          },
        },
        {
          type: 'input_audio',
          input_audio: {
            // Base64 编码的音频数据
            data: 'base64-encoded-audio',
            // 输入音频格式：'wav' 或 'mp3'
            format: 'wav',
          },
        },
        {
          type: 'file',
          file: {
            // 引用已上传文件
            file_id: 'file-xxx',
          },
        },
        {
          type: 'file',
          file: {
            // 也可直接传 Base64 文件数据，并用 filename 标注文件名
            file_data: 'base64-encoded-file',
            filename: 'document.pdf',
          },
        },
      ],
    },
    // assistant.content 支持字符串、文本或拒绝内容块数组，也可为 null
    {
      role: 'assistant',
      name: 'assistant_1',
      content: '我需要先查询文档。',
      // 模型拒绝生成时的说明；未拒绝时为 null
      refusal: null,
      // 重放模型此前返回的音频时传入其 ID
      audio: { id: 'audio_xxx' },
    },
    {
      role: 'assistant',
      // 文本数组可以包含一个或多个 text 内容块
      content: [{ type: 'text', text: '我需要先查询文档。' }],
    },
    {
      role: 'assistant',
      // 拒绝数组只能包含一个 refusal，不能与 text 混用
      content: [{ type: 'refusal', refusal: '不能处理其中的受限内容。' }],
      refusal: '不能处理其中的受限内容。',
    },
    // assistant 是模型此前的输出；工具调用也要作为 assistant 消息保留
    {
      role: 'assistant',
      // content 支持字符串、文本或拒绝内容块数组；仅返回工具调用等场景下可以为 null
      content: null,
      // 模型请求执行的工具调用
      tool_calls: [
        {
          // 本次工具调用的唯一 ID
          id: 'call_xxx',
          // 工具调用类型；函数工具为 function
          type: 'function',
          // 函数工具的调用信息
          function: {
            // 要调用的工具名
            name: 'search',
            // 模型生成的 JSON 参数字符串
            arguments: '{"query":"流式响应"}',
          },
        },
        {
          id: 'call_yyy',
          // 自定义工具调用使用字符串输入
          type: 'custom',
          custom: {
            name: 'code_exec',
            input: 'rg "tool_calls" apps/docs',
          },
        },
      ],
    },
    // tool 是工具执行结果；content 支持字符串或文本内容块数组
    // tool_call_id 必须对应前一条 assistant 消息中的调用
    {
      role: 'tool',
      tool_call_id: 'call_xxx',
      content: '{"result":"..."}',
    },
    {
      role: 'tool',
      tool_call_id: 'call_yyy',
      content: [{ type: 'text', text: '{"result":"..."}' }],
    },
  ],

  // temperature 和 top_p 通常只调整其中一个
  // 控制采样随机性，取值范围为 0～2，默认为 1；值越高输出越多样，值越低输出越稳定
  temperature: 1,
  // 控制候选 token 范围，取值为 0～1，默认为 1；值越低候选越少，输出越集中
  // 模型按概率从高到低累加到 top_p，只在这组候选中采样；1 表示不缩小范围
  top_p: 1,
  // 输出 token 上限，默认不设置；max_completion_tokens 包含可见输出与推理 token
  // 旧模型可能使用已弃用的 max_tokens，但它与 o 系列模型不兼容
  max_completion_tokens: 1024,
  max_tokens: 1024,
  // 一次请求返回的候选数，取值为 1～128，默认为 1；n > 1 会生成多份回答 choices[]
  // 计费时会把各候选消耗的输出 token 相加
  n: 1,
  // 命中即停止生成的字符串或字符串数组，最多 4 项；默认不设置，o3 和 o4-mini 不支持
  stop: ['\n'],

  // 工具调用
  tools: [
    {
      type: 'function',
      function: {
        // 工具名，[a-zA-Z0-9_-]{1,64}
        name: 'search',
        // 工具说明，模型据此判断何时调用
        description: '查询文档',
        // 工具参数的 JSON Schema；省略时表示不约束参数
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: '要查询的关键词',
            },
          },
          required: ['query'],
          additionalProperties: false,
        },
        // 开启后只接受 schema 严格匹配，默认为 false
        strict: false,
      },
    },
  ],
  // 可传 'none'、'auto'、'required'，也可用对象指定具体函数
  // 有 tools 时默认为 'auto'，否则默认为 'none'
  tool_choice: {
    type: 'function',
    function: { name: 'search' },
  },
  // 一轮是否允许多个 tool call，默认为 true
  parallel_tool_calls: true,

  // 结构化输出
  response_format: {
    // 可选值为 'text'、'json_schema'、'json_object'，默认为 'text'
    // 支持结构化输出的模型优先使用 'json_schema'；'json_object' 是旧版 JSON 模式
    type: 'json_schema',
    json_schema: {
      // 结构化输出的名称，只能包含字母、数字、下划线和连字符，最长 64 个字符
      name: 'answer',
      // 结构化输出的用途，帮助模型理解应如何生成结果；默认不设置
      description: '回答用户问题',
      // 输出必须遵循的 JSON Schema
      schema: {
        type: 'object',
        properties: {
          answer: { type: 'string' },
        },
        required: ['answer'],
        additionalProperties: false,
      },
      // 是否严格遵循 schema，默认为 false；true 仅支持 JSON Schema 的子集
      strict: true,
    },
  },

  // 重复与多样性
  // 按 token 是否已出现施加惩罚；取值为 -2～2，默认为 0
  // 正值降低已出现 token 的概率，鼓励谈论新话题；负值提高其概率，0 表示不调整
  presence_penalty: 0,
  // 按 token 已出现的次数累加惩罚；取值为 -2～2，默认为 0
  // 正值越大越抑制重复用词，负值越大越鼓励重复，0 表示不调整
  frequency_penalty: 0,
  // 按 token ID 微调生成概率，偏置值为 -100～100；默认不调整
  // 负值降低命中概率，正值提高命中概率，接近 ±100 时可近似禁止或强制选择
  logit_bias: { '50256': -100 },
  // 是否在响应里返回每个 token 的对数概率，默认为 false
  logprobs: true,
  // 配合 logprobs 返回概率最高的前 k 个候选，取值为 0～20；默认不返回候选列表
  // 设置该字段时必须同时设置 logprobs: true
  top_logprobs: 5,

  // 缓存与成本
  // 是否保存本次响应，便于后续查询及平台支持的评估、蒸馏等用途，默认为 false
  store: false,
  // 帮助相似请求稳定路由，提高 prompt cache 命中率；默认不设置
  prompt_cache_key: 'session-42',
  // GPT-5.6 及更新模型的 prompt cache 配置；默认为 implicit 和 30m
  prompt_cache_options: {
    // implicit 自动选择缓存断点；explicit 仅使用内容块中声明的显式断点
    mode: 'implicit',
    // 当前仅支持 30m
    ttl: '30m',
  },
  // 服务层级可为 'auto'、'default'、'flex'、'scale'、'priority'，默认为 'auto'
  // 实际可用值和计费行为取决于项目配置
  service_tier: 'auto',
  // 是否使用 SSE 流式返回，默认为 false
  stream: true,
  // 仅在 stream: true 时设置；include_usage 默认为 false，设为 true 会在结束前额外返回 usage chunk
  stream_options: {
    include_usage: true,
    // 是否为流式 delta 添加随机填充以降低长度推断风险，默认为 true
    include_obfuscation: true,
  },

  // 高级
  // 已知大部分预期输出时提供预测内容，匹配时可降低响应延迟；默认不启用
  prediction: {
    // 当前仅支持静态内容预测
    type: 'content',
    // 支持字符串或文本内容块数组
    content: [{ type: 'text', text: '预期输出内容' }],
  },
  // 启用 OpenAI 自带联网搜索；默认不启用，search_context_size 默认为 'medium'
  web_search_options: {
    // 搜索上下文规模：'low'、'medium'、'high'
    search_context_size: 'medium',
    // 可选的用户大致位置，用于优化本地化搜索结果
    user_location: {
      type: 'approximate',
      approximate: {
        country: 'CN',
        city: 'Shanghai',
        region: 'Shanghai',
        timezone: 'Asia/Shanghai',
      },
    },
  },
  // 推理强度可为 'none'、'minimal'、'low'、'medium'、'high'、'xhigh'、'max'
  // 默认为 'medium'；并非所有模型都支持全部取值
  reasoning_effort: 'medium',
  // 输出详略程度可为 'low'、'medium'、'high'，默认为 'medium'；仅部分模型支持
  verbosity: 'medium',
  // 输出模态，默认为 ['text']；音频输出使用 ['text', 'audio']
  modalities: ['text', 'audio'],
  // 输出包含 audio 模态时设置
  audio: {
    // 输出格式：'wav'、'aac'、'mp3'、'flac'、'opus'、'pcm16'
    format: 'wav',
    // 内置音色：'alloy'、'ash'、'ballad'、'coral'、'echo'、'fable'
    // 还可使用 'nova'、'onyx'、'sage'、'shimmer'、'marin'、'cedar'
    // 自定义音色使用 { id: 'voice_xxx' }
    voice: 'alloy',
  },
  // 对请求输入和生成输出执行内容审核；默认不设置
  moderation: {
    // 审核模型，必填
    model: 'omni-moderation-latest',
    policy: {
      // 'score' 仅返回评分；'block' 在命中时阻断
      input: { mode: 'block' },
      output: { mode: 'score' },
    },
  },
  // 自定义元信息，最多 16 对；键最长 64 字符，值最长 512 字符；默认不设置
  metadata: { trace_id: 'xxx' },
  // 终端用户的稳定标识，最长 64 字符；建议使用用户名或邮箱的哈希值，默认不设置
  safety_identifier: 'hashed-end-user-id',
}
```

### 响应字段

```ts fold title="响应体"
/**
 * Chat Completions 常用响应字段。
 */
{
  id: 'chatcmpl-xxx',
  object: 'chat.completion',
  created: 1700000000,
  model: 'openai-model-id',
  // 后端推理栈指纹；变动代表底层运行配置发生变化
  system_fingerprint: 'fp_xxx',
  service_tier: 'default',

  // 候选回答数组，数量由请求字段 n 决定
  choices: [
    {
      // 候选回答的序号，从 0 开始
      index: 0,
      message: {
        role: 'assistant',
        // 拒绝或仅返回工具调用等场景下可能为 null
        content: '好笑的笑话',
        refusal: null,
        tool_calls: [
          {
            // 回传结果时用作 tool_call_id
            id: 'call_xxx',
            type: 'function',
            function: {
              name: 'search',
              // 参数是模型生成的 JSON 字符串，需解析并按工具 schema 校验
              arguments: '{"query":"..."}',
            },
          },
        ],
      },
      // stop：自然结束；tool_calls：等待工具执行；length：达到输出上限；content_filter：内容审核拦截
      finish_reason: 'stop',
      // 启用 logprobs 时返回
      logprobs: null,
    },
  ],

  usage: {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    prompt_tokens_details: {
      // 命中 prompt cache 复用的输入 token
      cached_tokens: 0,
      audio_tokens: 0,
    },
    completion_tokens_details: {
      // 推理模型消耗的推理 token；非推理模型通常为 0
      reasoning_tokens: 30,
      audio_tokens: 0,
      // speculative decoding：被接受 / 拒绝的预测 token
      accepted_prediction_tokens: 0,
      rejected_prediction_tokens: 0,
    },
  },
}
```

`finish_reason` 说明模型为什么停止当前候选：

| 枚举值           | 具体含义                                             |
| ---------------- | ---------------------------------------------------- |
| `stop`           | 自然结束，或命中了请求中的停止序列                   |
| `length`         | 达到请求的输出上限或模型上下文上限                   |
| `tool_calls`     | 模型返回了工具调用，等待调用方执行                   |
| `content_filter` | 输出被内容安全系统截断                               |

### 流式响应

设置 `stream: true` 后，OpenAI 返回一系列 `chat.completion.chunk`。每个 chunk 是顶层响应的一个增量视图；文本在 `choices[].delta.content` 中累积，工具调用则通过 `delta.tool_calls[]` 拼装。

```ts fold title="chunk 字段"
/**
 * OpenAI 流式 chunk 的常用字段。
 */
{
  id: 'chatcmpl-xxx',
  object: 'chat.completion.chunk',
  created: 1700000000,
  model: 'gpt-4o-mini-2024-07-18',
  system_fingerprint: 'fp_xxx',
  service_tier: 'default',

  choices: [
    {
      index: 0,
      // delta 等价于响应 message 的差量
      delta: {
        // 仅首 chunk 出现
        role: 'assistant',
        content: '好笑的',
        refusal: null,
        tool_calls: [
          {
            // 同时返回的多个工具调用按 index 区分
            index: 0,
            // id 只在该 id 首个 chunk 出现
            id: 'call_xxx',
            type: 'function',
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
      logprobs: null,
    },
  ],

  // include_usage=true 时，在结束前的额外 chunk 中返回；该 chunk 的 choices 为空
  // 流被中断时可能收不到 usage
  usage: { /* 与非流式响应一致 */ },
}
```

```ts fold title="openai SDK"
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

请求字段沿用与 OpenAI 相同的组织方式，先列顶层字段，再说明内容块和条件用法。

#### 基础与生成控制

| 字段             | 类型或范围                 | 默认值     | 说明                                             |
| ---------------- | -------------------------- | ---------- | ------------------------------------------------ |
| `model`          | `string`                   | 必填       | Claude 模型 ID                                   |
| `messages`       | `Message[]`                | 必填       | 仅包含 `user` 和 `assistant`，相邻同角色会合并   |
| `max_tokens`     | 非负整数                   | 必填       | `0`：只预热 prompt cache，不生成响应；较小值：可能截断回答；较大值：允许更长输出，仍受模型上限和自然停止条件约束 |
| `system`         | `string \| TextBlock[]`   | 无         | 顶层 system prompt，不放入 `messages`            |
| `stream`         | `boolean`                  | `false`    | 是否返回 SSE 事件流                              |
| `temperature`    | `0～1`                     | `1`        | 接近 `0`：更集中、稳定，但不保证完全一致；`1`：默认随机性。仅适用于支持手动采样控制的旧模型 |
| `top_p`          | `0～1`                     | 模型默认值 | 接近 `0`：只保留累计概率最高的一小组候选；`1`：不通过 nucleus sampling 缩小范围。仅适用于旧模型 |
| `top_k`          | 非负整数                   | 模型默认值 | 较小值：只允许少量高概率 token；较大值：允许更多 token 参与采样。仅适用于旧模型 |
| `stop_sequences` | `string[]`                 | `[]`       | 自定义停止序列                                   |

#### 工具、输出与推理

| 字段            | 类型或可选值                         | 默认值                     | 说明                                           |
| --------------- | ------------------------------------ | -------------------------- | ---------------------------------------------- |
| `tools`         | `Tool[]`                             | 无                         | 声明客户端工具及其输入 schema；`cache_control.type` 仅为 `ephemeral`，`ttl` 的 `5m` 表示缓存 5 分钟且为默认值，`1h` 表示缓存 1 小时 |
| `tool_choice`   | `auto \| any \| tool \| none`    | 有工具为 `auto`，否则 `none` | `auto`：模型自决；`any`：必须调用至少一个工具；`tool`：强制调用 `name` 指定的工具；`none`：禁止调用。`disable_parallel_tool_use: true` 会限制为一个调用 |
| `output_config` | `{ effort, format }`                 | 取决于模型                 | `effort`：`low`、`medium`、`high`、`xhigh`、`max` 依次提高推理投入；`format.type: json_schema` 表示按 schema 输出结构化 JSON |
| `thinking`      | `adaptive \| enabled \| disabled` | 取决于模型                 | `adaptive`：模型自动决定推理投入；`enabled`：旧版显式启用并设置 `budget_tokens`；`disabled`：禁用。`display` 的 `summarized` 返回思考摘要，`omitted` 只保留连续性签名 |

#### 服务、缓存与 Beta 字段

| 字段                 | 类型或可选值                       | 默认值       | 说明                                       |
| -------------------- | ---------------------------------- | ------------ | ------------------------------------------ |
| `service_tier`       | `auto \| standard_only`           | `auto`       | `auto`：自动使用账户可用层级；`standard_only`：只使用标准层级 |
| `metadata`           | `{ user_id }`                      | 无           | 提供稳定、非个人身份的终端用户标识         |
| `container`          | `string`                           | 无           | 复用上一轮代码执行容器                     |
| `inference_geo`      | `global` 或区域代码                | 工作区配置   | `global`：允许全球区域；具体区域代码：将推理限制到对应区域，实际可用值取决于账户和模型 |
| `mcp_servers`        | `MCPServer[]`                      | 无           | Beta；`type: url` 表示通过远程 URL 连接 MCP 服务器 |
| `context_management` | 上下文管理配置                     | 无           | Beta，配置长会话的自动上下文编辑           |

#### 复杂字段用法

Anthropic 把 system prompt 放在顶层，`messages` 只接受 `user` 和 `assistant`：

| 位置或角色  | 常见内容块                                                | 用途                              |
| ----------- | --------------------------------------------------------- | --------------------------------- |
| `system`    | 字符串、带缓存控制的文本块                                | 设置全局行为                      |
| `user`      | 文本、图片、文档、搜索结果、`tool_result` 等内容块        | 提交输入或回传工具结果            |
| `assistant` | 文本、`tool_use`、`thinking`、`redacted_thinking` 等内容块 | 重放模型输出与工具调用            |

:::details 模型与 Beta 限制
Claude 4.7 及更新模型和 Claude Mythos Preview 不支持手动调整 `temperature`、`top_p`、`top_k`。`mcp_servers` 和 `context_management` 还需要对应的 beta header；`thinking`、结构化输出和服务层级的实际支持情况取决于模型与账户配置。
:::

#### 完整请求示例

下面的对象同样用于展示字段结构，其中包含模型相关和 Beta 配置，不能整体原样提交。

```ts fold title="完整请求字段示例"
/**
 * 字段示意，不能原样作为完整请求提交；具体支持情况取决于模型和 beta header。
 */
{
  // 必填
  model: 'claude-model-id',
  // 对话历史只允许 user/assistant；相邻同角色消息会被合并
  messages: [
    { role: 'user', content: '讲个笑话' },
    // assistant 的 tool_use 要重放进 messages，模型才能看到自己曾发过
    {
      role: 'assistant',
      content: [
        { type: 'text', text: '好笑的笑话' },
        { type: 'tool_use', id: 'toolu_xxx', name: 'search', input: { query: '...' } },
      ],
    },
    // 工具结果用 user 角色包一个 tool_result 块传给下一轮
    {
      role: 'user',
      content: [
        // is_error 表示工具是否执行失败，默认为 false
        { type: 'tool_result', tool_use_id: 'toolu_xxx', content: '{}', is_error: false },
      ],
    },
  ],
  // 必填；不同模型的最大值不同，没有统一默认值
  max_tokens: 1024,
  // 是否使用 SSE 流式返回，默认为 false
  stream: false,

  // System（顶层，与消息分开）
  // 全局 system prompt；可传字符串或 text 块数组
  system: '你是助手',
  // 或 system: [{ type: 'text', text, cache_control: { type: 'ephemeral', ttl: '1h' } }]

  // Claude 4.7 及更新模型和 Claude Mythos Preview 不支持调整以下采样参数
  // 旧模型的采样温度取值为 0～1，默认为 1；值越高输出越多样
  temperature: 1,
  // 旧模型的 nucleus 采样参数，取值为 0～1；未设置时使用模型默认值
  top_p: 1,
  // 旧模型仅从概率最高的 k 个 token 中采样，取值不小于 0；未设置时使用模型默认值
  top_k: 40,
  // 命中即停止生成的自定义字符串；默认无自定义停止序列
  stop_sequences: [],

  // 工具调用
  tools: [
    {
      // 工具名，^[a-zA-Z0-9_-]{1,64}$
      name: 'search',
      // 工具说明，模型据此判断何时调用
      description: '查询文档',
      input_schema: { /* JSONSchema */ },
      // 支持该能力的模型可启用严格 schema 校验，默认不启用
      strict: true,
      // 工具描述是否进入 prompt cache；ttl 可为 '5m' 或 '1h'，默认为 '5m'
      cache_control: { type: 'ephemeral' },
    },
  ],
  // 'auto' 模型自决；'any' 至少调一个；{ type: 'tool', name } 强制指定；'none' 禁止调用
  // 有 tools 时默认为 'auto'，否则默认为 'none'
  tool_choice: { type: 'auto' },

  // 结构化输出；仅受支持的模型可用
  output_config: {
    // 支持自适应推理的模型可通过 effort 调整投入程度；默认值取决于模型
    effort: 'medium',
    format: { type: 'json_schema', schema: { /* JSONSchema */ } },
  },

  // 推理、缓存
  // 新模型通常使用 adaptive；旧模型可能使用 enabled + budget_tokens
  // 省略时是否启用取决于模型，Claude 5 默认启用；启用后可能返回 thinking 块
  thinking: { type: 'adaptive' },
  // 'auto' 自动选择可用层级；'standard_only' 仅使用标准层级；默认为 'auto'
  service_tier: 'auto',
  // 关联终端用户的稳定、非个人身份标识，用于滥用检测
  metadata: { user_id: 'user-stable-id' },
  // 复用代码执行容器时传入上一轮返回的容器 ID
  container: 'container-id',
  // 'global' 或具体区域代码；默认使用工作区配置，实际可用值取决于账户和模型
  inference_geo: 'global',

  // beta；还需在请求头中启用对应 beta 版本
  // 远程 MCP 服务器，其工具自动合入本轮 tools
  mcp_servers: [
    {
      type: 'url',
      url: 'https://mcp.example.com/sse',
      name: 'docs',
      // 是否启用与白名单
      tool_configuration: { enabled: true, allowed_tools: ['search'] },
      authorization_token: 'xxx',
    },
  ],
  // 自动编辑上下文的策略，用于压缩长会话
  context_management: { /* BetaContextManagementConfig */ },
}
```

### 响应字段

```ts fold title="响应体"
/**
 * Messages 响应。
 */
{
  id: 'msg_xxx',
  type: 'message',
  role: 'assistant',
  model: 'claude-model-id',

  // end_turn 表示自然结束；还可能为 tool_use、max_tokens、stop_sequence、pause_turn、refusal、model_context_window_exceeded
  stop_reason: 'end_turn',
  stop_sequence: null,
  // 使用代码执行工具时返回容器信息，否则通常为 null
  container: null,
  // 拒绝响应时提供结构化停止详情，否则通常为 null
  stop_details: null,

  // 模型输出块；常见类型有 text、tool_use、thinking 和 redacted_thinking
  content: [
    {
      type: 'text',
      text: '好笑的笑话',
    },
    {
      type: 'tool_use',
      // 回传结果时用作 tool_use_id
      id: 'toolu_xxx',
      name: 'search',
      // 参数已是 JSON 对象，无需 parse
      input: { query: '...' },
    },
    // 其他输出块类型示例：
    // { type: 'thinking', thinking, signature }
    // { type: 'redacted_thinking', data }
    // 使用服务端工具时还会出现 server_tool_use 和具体工具对应的结果块
  ],

  usage: {
    input_tokens: 100,
    output_tokens: 50,
    // 写入 prompt cache 的 token
    cache_creation_input_tokens: 0,
    // 命中 prompt cache 读取的 token
    cache_read_input_tokens: 0,
    cache_creation: {
      // 1 小时缓存 / 5 分钟缓存分别写入的 token
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
    service_tier: 'standard',
    inference_geo: 'us',
    output_tokens_details: {
      thinking_tokens: 30,
    },
    // 服务端工具调用次数；字段会随受支持的服务端工具扩展
    server_tool_use: {
      web_search_requests: 0,
      web_fetch_requests: 0,
    },
  },
}
```

`stop_reason` 说明整条 Anthropic 消息为什么结束：

| 枚举值                         | 具体含义                                                   |
| ------------------------------ | ---------------------------------------------------------- |
| `end_turn`                     | 模型自然完成当前轮次                                       |
| `max_tokens`                   | 达到请求的 `max_tokens` 或模型输出上限                     |
| `stop_sequence`                | 命中自定义停止序列，匹配值同时写入 `stop_sequence`          |
| `tool_use`                     | 模型返回一个或多个工具调用，等待调用方执行                 |
| `pause_turn`                   | 长时间运行的轮次被暂停，可把响应传回 API 继续               |
| `refusal`                      | 模型拒绝处理该请求                                         |
| `model_context_window_exceeded` | 达到模型上下文窗口限制                                    |

响应中的 `usage.service_tier` 可能为 `standard`（标准层级）、`priority`（优先层级）、`batch`（批处理层级）或 `null`（未提供层级信息）。

### 流式响应

设置 `stream: true` 后，Anthropic 通过多类型事件推送响应。每个事件顶层都有 `type`，文本和工具调用按内容块逐段返回。事件顺序为：`message_start` → 每个内容块对应的 `content_block_start`、多次 `content_block_delta`、`content_block_stop` → 一个或多个 `message_delta` → `message_stop`，中途可能插入 `ping`。

```ts fold title="事件联合类型"
/**
 * 生命周期事件。
 */
type LifecycleEvent =
  // 响应开始，message 是完整 message 的初始快照（id / model / stop_reason=null 等）
  | { type: 'message_start'; message: Message }
  // 内容块开始，content_block 是该块的首个子集
  | { type: 'content_block_start'; index: number; content_block: ContentBlock }
  // 内容块差量，具体形态由 delta.type 决定
  | { type: 'content_block_delta'; index: number; delta: ContentBlockDelta }
  // 心跳事件
  | { type: 'ping' }
  // 内容块结束
  | { type: 'content_block_stop'; index: number }
  // 整个 message 的差量，含 stop_reason 与累计 usage；可能出现多次
  | { type: 'message_delta'; delta: { stop_reason: StopReason; stop_sequence: string | null }; usage: PartialUsage }
  // 响应结束
  | { type: 'message_stop' }
  // 错误事件
  | { type: 'error'; error: { type: string; message: string } }

/**
 * content_block_delta 的子类型。
 */
type ContentBlockDelta =
  // 文本增量
  | { type: 'text_delta'; text: string }
  // 工具参数增量，是参数对象 JSON 的片段，累积再 parse
  | { type: 'input_json_delta'; partial_json: string }
  // 推理块增量
  | { type: 'thinking_delta'; thinking: string }
  // 推理签名增量
  | { type: 'signature_delta'; signature: string }
```

```ts fold title="@anthropic-ai/sdk"
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// stream: true 返回 MessageStream（AsyncIterable<MessageStreamEvent>）
const stream = client.messages.stream(
  { model: 'claude-sonnet-5', max_tokens: 1024, messages },
  // 取消信号
  { signal: abortSignal }
)

for await (const event of stream) {
  switch (event.type) {
    case 'content_block_delta':
      // 文本 / 工具参数 / 推理按 event.delta.type 分发
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
      // 这里可以拿到 stop_reason 与累计 usage
      logStopReason(event.delta.stop_reason)
      break
    case 'error':
      handleError(event.error)
      break
  }
}

// 等所有事件处理完
const finalMessage = await stream.finalMessage()
logUsage(finalMessage.usage)
```

## 差异对照

| 概念         | OpenAI                                                  | Anthropic                                                   |
| ------------ | ------------------------------------------------------- | ----------------------------------------------------------- |
| 顶层指令     | `messages[]` 中的 `developer` 或 `system`               | 顶层 `system`                                               |
| 工具声明     | `tools[].function`                                      | `tools[].input_schema`                                      |
| 工具调用返回 | `choices[].message.tool_calls[]`                        | `content[].type: 'tool_use'`                                |
| 工具调用 ID  | `tool_calls[].id`                                       | `content[].id`（tool_use 块）                               |
| 工具参数     | `function.arguments`（JSON 字符串）                     | `input`（已是对象）                                         |
| 工具结果回传 | `messages[]` 中的 `role: 'tool'`                        | `messages[]` 中的 `role: 'user'` + `type: 'tool_result'` 块 |
| 强制指定工具 | `tool_choice: { type: 'function', function: { name } }` | `tool_choice: { type: 'tool', name }`                       |
| 输入 token   | `usage.prompt_tokens`                                   | `usage.input_tokens`                                        |
| 输出 token   | `usage.completion_tokens`                               | `usage.output_tokens`                                       |
| prompt cache | `usage.prompt_tokens_details.cached_tokens`             | `usage.cache_read_input_tokens` / `cache_creation.*`        |
| 推理         | `reasoning_effort`                                      | `thinking` / `output_config.effort`                         |
| 结构化输出   | `response_format`                                       | `output_config.format` / 工具的 `strict: true`              |
| 流式数据     | `chat.completion.chunk`，内容位于 `choices[].delta`     | SSE 事件，内容位于 `content_block_delta`                    |
