---
createdAt: '2026-07-25 15:00'
order: 4
---

# LLM 应用中的缓存设计

LLM 应用里的许多输入并不会频繁变化。系统指令、工具定义和部分上下文常被反复发送，相同或等价的请求也可能多次触发模型调用，带来额外的 token 消耗和响应延迟。提示词缓存（Prompt Caching）通过复用稳定前缀降低输入成本；如果完整结果可以复用，应用层结果缓存还能直接返回已有输出，避免再次调用模型。下文会围绕这两层缓存展开。

## 提示词缓存

本节分别说明 Anthropic 与 OpenAI 两种提示词缓存实现规范，并以 Claude Sonnet 4.5 和 GPT-4o 展示各自的使用方式与计费规则。不同模型、部署平台和 API 版本支持的缓存方式、最小长度、TTL 与价格可能不同，落地时应以当前官方文档为准。

### 规范概览

| 维度         | Anthropic（Claude Sonnet 4.5）                  | OpenAI（GPT-4o）                                               |
| ------------ | ----------------------------------------------- | -------------------------------------------------------------- |
| 触发方式     | 显式 `cache_control` 断点，也支持请求级自动缓存 | 自动匹配相同前缀                                               |
| 最小缓存长度 | 1024 token                                      | 1024 token；命中长度从 1024 token 起按 128 token 一档递增      |
| 断点         | 最多 4 个断点；自动缓存占用 1 个                | 无需配置显式断点                                               |
| 首次处理费用 | 5 分钟缓存按标准输入价格的 1.25 倍              | 标准输入价格                                                   |
| 命中费用     | 标准输入价格的 10%                              | 标准输入价格的 50%                                             |
| TTL          | 默认 5 分钟，命中后刷新；可付费延长到 1 小时    | 通常在空闲 5～10 分钟后清除，最迟在最后一次使用后 1 小时内清除 |

两种规范都复用相同提示词前缀的计算，但控制方式和计费字段不同。Anthropic 允许应用设置断点和 TTL，并分别返回缓存写入与命中 token；GPT-4o 由模型服务自动管理缓存，只返回命中的缓存 token。

:::info 提示词缓存的两个核心动作

- **写入**：首次处理可缓存前缀时，模型服务保存处理该前缀产生的内部状态；
- **命中**：后续请求匹配该前缀时，模型服务复用这些状态，只处理未命中的输入并生成输出。

:::

### Anthropic 规范

Anthropic 支持请求级自动缓存和内容块级显式断点。自动缓存只需在请求顶层添加 `cache_control`，模型服务会把断点放在最后一个可缓存的内容块；显式方式则把 `cache_control` 放在指定内容块上，缓存从请求开头到该内容块的前缀。一个请求最多使用 4 个断点，自动缓存与显式断点同时启用时，自动缓存会占用一个名额。

Claude Sonnet 4.5 要求缓存前缀至少达到 1024 token，长度不足时会正常处理请求，但不会创建缓存。默认 5 分钟缓存的写入和命中价格分别是标准输入价格的 1.25 倍和 10%；配置 `ttl: '1h'` 后，写入价格提高到 2 倍。响应中的 `cache_creation_input_tokens` 和 `cache_read_input_tokens` 分别表示写入量与命中量。

下面同时启用请求级自动缓存和两个显式断点。示例假设 `SYSTEM_PROMPT` 本身已经超过 1024 token。

```ts fold
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const ANTHROPIC_MODEL = 'claude-sonnet-4-5'

/** 调用 Anthropic，同时启用自动缓存和两个显式断点。 */
async function callAnthropic(question: string) {
  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 2048,
    // 请求级自动缓存：断点自动移动到最后一个可缓存内容块。
    cache_control: { type: 'ephemeral' },
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        // 第一个断点：系统提示词末尾。
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '参考资料：订单创建后 30 分钟内可以取消，已发货订单不能取消。',
            // 第二个断点：参考资料末尾。
            cache_control: { type: 'ephemeral' },
          },
          {
            type: 'text',
            text: question,
            // 请求级自动缓存会把断点放在这个内容块末尾。
          },
        ],
      },
    ],
  })

  // 从 usage 读取本次写入和命中的缓存 token 数。
  const cacheCreatedTokens = response.usage.cache_creation_input_tokens ?? 0
  const cacheReadTokens = response.usage.cache_read_input_tokens ?? 0
  const answer = response.content.find((block) => block.type === 'text')?.text
  return { answer, cacheCreatedTokens, cacheReadTokens }
}
```

这段代码会在系统提示词、参考资料和用户问题末尾设置三个断点。缓存仍在 TTL 内时，模型服务优先复用最长的匹配前缀：参考资料不变可以命中第二个显式断点；参考资料发生变化时，第一个显式断点仍可复用系统提示词。自动断点位于用户问题末尾，会缓存本次请求的完整前缀。

在追加式多轮对话中，自动断点会随新消息向后移动。为简化示意，下面按 `system` 和每条消息各包含一个内容块计算：

```text
第 1 轮：[system + user1] ← 写入缓存（共 2 个内容块）

第 2 轮：[system + user1] + assistant1 + user2（共 4 个内容块）
          ↑ 复用此前缓存                 ↑ 写入新缓存

第 3 轮：[system + user1 + assistant1 + user2] + assistant2 + user3（共 6 个内容块）
          ↑ 复用此前缓存                               ↑ 写入新缓存

单轮新增 20 个或更多内容块：
[上一轮自动断点] + block1 + ... + block20 + [当前自动断点]
 ↑ 已超出查找范围                              ↑ 从这里向前最多查找 20 个内容块
```

Anthropic 对每个断点最多向前检查 20 个内容块，当前断点本身算作第一个。图中的最后一种情况里，模型服务从当前断点依次检查 block20 至 block1，而上一轮自动断点位于 block1 之前，因此无法命中。模型服务随后会检查请求中的显式断点；如果也未命中，则重新处理全部提示词，并在响应开始生成时写入新的自动缓存。

工具调用可能在一次请求内产生大量内容块，使相邻两个自动断点相隔 20 个或更多内容块。此时可以提前在稳定前缀末尾设置显式断点。

### OpenAI 规范

下面以 GPT-4o 为例。模型服务会自动匹配请求中的相同前缀，无需配置缓存断点。提示词达到 1024 token 后才会参与缓存，命中长度从 1024 token 起按 128 token 一档递增。例如相同前缀有 1200 token，最多按 1152 token 计入命中。

GPT-4o 的缓存写入不额外收费，命中的输入 token 按标准输入价格的 50% 计费。响应中的 `usage.prompt_tokens_details.cached_tokens` 表示本次命中的输入 token 数，不提供单独的缓存写入字段。GPT-5.6 及后续模型还支持显式断点，缓存写入按标准输入价格的 1.25 倍计费，并通过 `cache_write_tokens` 返回写入量。

下面的示例假设 `SYSTEM_PROMPT` 与参考资料组成的稳定前缀已经超过 1024 token。

```ts fold
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const OPENAI_MODEL = 'gpt-4o'

/** 调用 OpenAI，把稳定内容放在消息序列前部。 */
async function callOpenAI(question: string) {
  const completion = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      // 稳定的前缀：放在 messages 前面，命中率最高。
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '参考资料：订单创建后 30 分钟内可以取消，已发货订单不能取消。',
          },
          { type: 'text', text: question },
        ],
      },
    ],
  })

  // 读取本次命中的缓存 token 数。
  const cachedTokens = completion.usage?.prompt_tokens_details?.cached_tokens ?? 0
  return { answer: completion.choices[0]?.message.content, cachedTokens }
}
```

### 提示词结构设计

两种规范都按请求前缀匹配缓存，因此提示词应按变化频率排列：

```d2
direction: right

A: 长期稳定 {
  class: group
  content: 角色、规则、工具定义、输出 schema {
    shape: text
  }
}
B: 会话级稳定 {
  class: group
  content: 用户配置、记忆摘要 {
    shape: text
  }
}
C: 阶段性稳定 {
  class: group
  content: 检索结果、上下文快照 {
    shape: text
  }
}
D: 随请求变化 {
  class: group
  content: 用户问题、最新工具结果 {
    shape: text
  }
}

A -> B -> C -> D
```

从左到右，内容变化越来越频繁。Anthropic 可以在需要独立复用的稳定前缀末尾设置 `cache_control`；GPT-4o 自动匹配前缀，无需设置断点；GPT-5.6 及后续模型也可以设置显式断点。无论采用哪种方式，前缀中的内容和顺序都必须保持一致。

## 应用层结果缓存

提示词缓存命中后仍会生成输出。如果多个请求可以共享结果，并且缓存的响应仍然有效，应用层结果缓存可以直接返回已有结果，无需再次调用模型。

### 缓存 key 设计原则

缓存 key 决定哪些请求可以共享同一结果。所有影响输出、数据范围或访问权限的因素都应参与计算，与结果无关的请求字段则应排除。常见输入包括：

- 租户或用户隔离范围，以及权限信息的哈希；
- 模板、模型、工具和输出 schema 的版本；
- 用户问题，以及上下文的哈希；
- 采样参数及其它影响输出的模型配置。

与响应无关的 `traceId`、`requestId` 和请求时间戳不参与计算。`hash` 需要使用确定性序列化，确保相同输入生成相同的 key。

```js fold
/** 根据一次模型调用的有效输入生成缓存 key。 */
function getCacheKey(input) {
  return hash({
    cacheScope: input.cacheScope,
    permissionHash: input.permissionHash,
    templateVersion: input.templateVersion,
    modelVersion: input.modelVersion,
    schemaVersion: input.schemaVersion,
    toolVersions: input.toolVersions,
    question: input.question.trim(),
    contextHash: hash(input.context),
    generationConfigHash: hash(input.generationConfig),
  })
}
```

### 失效与并发控制

除了设计 key，还需要处理缓存失效和并发请求：

- TTL 不应超过所有依赖中最短的有效期；
- 上下文数据、权限、模板或工具变化时，更新 key 中对应的哈希或版本字段，旧条目由 TTL 清理；
- 错误响应、未通过审核的结果和包含一次性凭证的结果不进入缓存；
- 同一个 key 失效时，多个等价请求可能同时调用模型，造成重复计算。应用可以合并这些请求，只发起一次模型调用；多实例部署时，可以使用分布式锁协调各实例。

## 两层缓存的协同

请求先查应用层结果缓存。命中后直接返回；未命中时调用模型，由提示词缓存尝试复用前缀；模型返回可缓存结果后，再写入应用层缓存。

```d2
direction: right

A: 请求进入
B: 应用层\n结果缓存命中? {
  shape: diamond
  class: decision
}
C: 直接返回
D: 调用模型\n提示词缓存命中? {
  shape: diamond
  class: decision
}
E: 复用前缀\n处理剩余输入
F: 处理全部输入
G: 生成输出
H: 结果适合缓存? {
  shape: diamond
  class: decision
}
I: 写入应用层\n结果缓存
J: 返回结果

A -> B
B -> C: 是
B -> D: 否
D -> E: 是
D -> F: 否
E -> G
F -> G
G -> H
H -> I: 是
H -> J: 否
I -> J
```

## 成本计算与监控

### 成本计算示例

以 Claude Sonnet 4.5 的 5 分钟缓存为例：一次请求包含 7k token 的可缓存前缀和 0.5k token 的动态输入。连续发送两次相同前缀时，以基础输入单价为 1，成本为：

```text
未优化（两次都全量）：
  2 × 7.5k = 15k

使用提示词缓存：
  第一次请求：写入 7k 前缀 + 处理 0.5k 动态输入
             = 7k × 1.25 + 0.5k
             = 9.25k

  第二次请求：命中 7k 前缀 + 处理 0.5k 动态输入
             = 7k × 0.1 + 0.5k
             = 1.2k

  两次合计：9.25k + 1.2k = 10.45k
```

这里假设两种方案的输出 token 数相同，因此不计入差值。示例中的输入成本约节省 30%；实际收益取决于前缀的复用次数、缓存有效期和模型价格。

### 监控指标

应用需要记录模型服务返回的 `usage`：Anthropic 关注 `cache_creation_input_tokens` 和 `cache_read_input_tokens`；OpenAI 关注 `prompt_tokens_details.cached_tokens`，GPT-5.6 及后续模型还需记录 `cache_write_tokens`。按模型、提示词版本和时间窗口汇总后，重点观察：

- 提示词缓存 token 命中率：命中 token 占全部输入 token（缓存命中、缓存写入和未缓存输入之和）的比例；
- 缓存净收益：未使用缓存时的估算输入成本减去实际输入成本；
- 应用层结果缓存命中率：命中次数占查询缓存次数的比例；
- 请求成本与延迟：统计平均成本和 P95 延迟（95% 的请求不超过该耗时），观察缓存带来的整体收益。

## 两层缓存的边界

提示词缓存关注前缀能否复用，应用层结果缓存还要满足业务有效性和权限要求：

**提示词缓存**

- 可复用前缀短于最小缓存长度时，无法写入或命中缓存；
- 易变内容位于可复用前缀内时，从变化位置开始无法命中，应将易变内容放在最后；
- 对收取写入费用的模型，若相同前缀在 TTL 内很少再次出现，使用缓存反而可能增加成本。

**应用层结果缓存**

- 依赖实时数据、包含外部副作用或要求每次重新生成的请求，不应缓存完整结果；
- 无法通过 key 准确区分权限范围时，不应跨租户或用户共享结果；
- key 缺少内容版本或未设置 TTL 时，依赖更新后仍可能返回旧结果。

提示词缓存命中率持续下降时，优先检查提示词版本、断点位置和请求间隔；结果缓存出现旧数据或越权命中时，检查 key 的隔离范围和失效条件。
