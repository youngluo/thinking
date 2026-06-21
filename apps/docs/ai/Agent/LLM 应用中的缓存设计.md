---
createdAt: '2026-06-21 21:50'
draft: true
---

# LLM 应用中的缓存设计

LLM 应用很容易把缓存想简单：用户问过一次，下次直接复用答案。这个方向有价值，但也很危险。

因为 LLM 的一次结果通常不只由“用户问题”决定。它还依赖知识库版本、权限范围、检索参数、prompt 模板、模型版本、上下文、输出 schema，甚至工具返回的数据版本。只按问题做缓存，轻则命中过期答案，重则把别人的权限内结果返回给当前用户。

所以缓存设计的核心不是“把结果存起来”，而是先分清：

- 缓存的是什么；
- 这个结果由哪些输入决定；
- 哪些变化必须让缓存失效；
- 哪些结果根本不应该缓存。

## 为什么 LLM 应用需要缓存

LLM 应用里的成本不是单次模型调用决定的，而是一条链路叠出来的。一次看似普通的问答，可能包含 query 改写、embedding、检索、rerank、上下文组装、模型生成、结构化校验和失败重试。

```d2
direction: right

A: 用户请求
B: Query 改写
C: Embedding
D: Retrieval
E: Rerank
F: Prompt 组装
G: Model
H: Parser
I: 返回结果 {
  class: ok
}

A -> B -> C -> D -> E -> F -> G -> H -> I
```

每一层都有成本和延迟。缓存的价值就在这里：

- 减少重复 embedding 和检索；
- 降低 rerank、分类、路由这类中间模型调用成本；
- 避免重复调用慢工具；
- 让高频问题更快返回；
- 降低失败重试带来的额外消耗。

但缓存不是越多越好。缓存错了，比不缓存更糟。

## 先分清缓存对象

不同对象的缓存风险不一样，key 的设计也不一样。

| 缓存对象         | 是否常见 | 适合场景                       | 风险                                    |
| ---------------- | -------- | ------------------------------ | --------------------------------------- |
| Query rewrite    | 常见     | 用户问题重复、改写成本高       | 改写策略变更后要失效                    |
| Embedding        | 很常见   | 同一句 query 或文档重复向量化  | embedding 模型变更后要失效              |
| Retrieval        | 常见     | 知识库更新不频繁、权限过滤明确 | 知识库版本和权限必须进 key              |
| Rerank           | 常见     | rerank 模型成本高              | topK、rerank 模型、候选集变化会影响结果 |
| Tool result      | 视情况   | 慢接口、稳定数据、低风险查询   | 实时数据和高风险动作不应缓存            |
| Final answer     | 谨慎     | FAQ、制度问答、上下文稳定      | 最容易串权限、串版本、串上下文          |
| Memory selection | 可选     | 长期记忆较多、检索成本高       | 记忆索引更新后要失效                    |

RAG 知识库通常需要缓存，但优先缓存 embedding、retrieval 和 rerank。最终回答缓存要谨慎，因为它已经混合了 prompt、上下文、模型输出和权限。

## 缓存 key 的本质

缓存 key 是**结果依赖项的指纹**。

如果某个输入变化会影响结果，它就必须进入 key。如果某个字段不会影响结果，就不要进入 key。key 太少会命中错误缓存，key 太多会几乎没有命中率。

先看一个错误写法：

```ts
function getBadCacheKey(question: string) {
  return hash(question)
}
```

它的问题是：同一个问题在不同知识库版本、不同用户权限、不同过滤条件、不同 prompt 模板下，答案可能完全不同。

更好的做法是为不同缓存对象设计不同 key。

```ts
function stableStringify(value: unknown) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  }

  return JSON.stringify(value)
}

function hashObject(value: unknown) {
  return hash(stableStringify(value))
}
```

`stableStringify` 的作用是让对象字段顺序稳定。否则 `{ a: 1, b: 2 }` 和 `{ b: 2, a: 1 }` 语义一样，却可能生成不同 key。

## RAG 缓存怎么做

RAG 里最常见的是检索缓存。它缓存的是“这个 query 在当前知识库、当前权限、当前检索策略下召回了哪些文档”。

检索缓存 key 通常要包含：

- 规范化后的 query；
- 知识库版本；
- 过滤条件；
- 权限范围；
- `topK`；
- embedding 模型版本；
- 检索策略版本。

```ts
type RetrievalCacheInput = {
  query: string
  knowledgeBaseVersion: string
  filters: Record<string, string | string[]>
  permissionScope: string
  topK: number
  embeddingModelVersion: string
  retrievalStrategyVersion: string
}

function normalizeQuery(query: string) {
  return query.trim().replace(/\s+/g, ' ').toLowerCase()
}

function getRetrievalCacheKey(input: RetrievalCacheInput) {
  return hashObject({
    query: normalizeQuery(input.query),
    knowledgeBaseVersion: input.knowledgeBaseVersion,
    filters: input.filters,
    permissionScope: input.permissionScope,
    topK: input.topK,
    embeddingModelVersion: input.embeddingModelVersion,
    retrievalStrategyVersion: input.retrievalStrategyVersion,
  })
}
```

这里最容易漏的是 `knowledgeBaseVersion` 和 `permissionScope`。

知识库更新后，旧检索结果可能已经不对。权限范围变了，同一个 query 能看到的文档也不同。没有这两个字段，缓存就可能返回过期或越权结果。

如果你的知识库更新很频繁，可以把版本设计得更细：

- 全量索引版本：适合定期重建的知识库；
- collection 版本：适合多知识库隔离；
- 文档更新时间水位：适合增量更新；
- 权限策略版本：适合权限规则经常变化的系统。

## 最终回答缓存为什么要谨慎

最终回答缓存的是模型已经生成好的答案。它命中后最快，但风险也最高。

因为最终回答依赖的不只是检索结果，还依赖 prompt、模型、输出 schema、记忆、权限和上下文裁剪策略。

```ts
type AnswerCacheInput = {
  question: string
  promptTemplateVersion: string
  modelVersion: string
  outputSchemaVersion: string
  permissionScope: string
  contextHash: string
}

function getAnswerCacheKey(input: AnswerCacheInput) {
  return hashObject({
    question: normalizeQuery(input.question),
    promptTemplateVersion: input.promptTemplateVersion,
    modelVersion: input.modelVersion,
    outputSchemaVersion: input.outputSchemaVersion,
    permissionScope: input.permissionScope,
    contextHash: input.contextHash,
  })
}
```

这里的 `contextHash` 不建议直接 hash 完整 prompt。完整 prompt 可以 hash，但排查问题会很痛苦。更可维护的方式是 hash 进入 prompt 的关键上下文片段：

```ts
type ContextForHash = {
  retrievedSourceIds: string[]
  retrievedSourceVersions: string[]
  shortTermMemoryVersion?: string
  longTermMemoryIds: string[]
  toolResultVersions: string[]
}

function getContextHash(context: ContextForHash) {
  return hashObject(context)
}
```

这样缓存不命中时，你能知道是文档变了、记忆变了，还是工具结果变了。

最终回答缓存适合这些场景：

- FAQ 类问题；
- 制度说明；
- 产品文档问答；
- 上下文稳定、权限简单、答案变化不频繁的场景。

不适合这些场景：

- 实时价格、库存、状态、日志；
- 用户私有数据混杂的问答；
- 高风险操作建议；
- 依赖当前工具结果的 Agent 任务；
- 强个性化、强上下文相关的回答。

## 工具调用缓存怎么做

工具调用缓存要先分清工具类型。

只读、低风险、结果相对稳定的工具可以缓存。写操作、审批、支付、删除、发送消息这类工具不能缓存成“已经执行过所以跳过”。

```ts
type CachePolicy = {
  enabled: boolean
  ttlSeconds: number
  cacheErrors: boolean
}

type ToolDefinition = {
  name: string
  version: string
  sideEffect: 'read' | 'write'
  realtime: boolean
  cachePolicy?: CachePolicy
}

function shouldCacheToolResult(tool: ToolDefinition) {
  if (tool.sideEffect === 'write') return false
  if (tool.realtime) return false
  return tool.cachePolicy?.enabled === true
}
```

工具结果 key 通常包含：

- 工具名；
- 工具版本；
- 参数；
- 权限范围；
- 外部数据版本或 TTL。

```ts
function getToolCacheKey(input: { toolName: string; toolVersion: string; args: Record<string, unknown>; permissionScope: string }) {
  return hashObject({
    toolName: input.toolName,
    toolVersion: input.toolVersion,
    args: input.args,
    permissionScope: input.permissionScope,
  })
}
```

临时失败不要随便缓存。比如网络超时、上游 500，这类失败通常应该短 TTL 或不缓存。明确的业务结果可以缓存，比如“当前上下文不足”“该文档不存在”“没有权限”。

## TTL、版本号和失效策略

缓存不是只有 key，还要有失效策略。

```d2
direction: down

A: 生成缓存 key
B: 查询缓存
C: 命中? {
  shape: diamond
  class: decision
}
D: 返回缓存结果 {
  class: ok
}
E: 执行真实调用
F: 可以缓存? {
  shape: diamond
  class: decision
}
G: 不写缓存 {
  class: fail
}
H: 写入缓存
I: 版本或 TTL 变化后失效 {
  class: ok
}

A -> B -> C
C -> D: 是
C -> E: 否
E -> F
F -> G: 否
F -> H: 是
H -> I
```

常见失效规则：

| 变化                | 应该失效什么                              |
| ------------------- | ----------------------------------------- |
| prompt 模板版本变化 | 最终回答缓存                              |
| 输出 schema 变化    | 最终回答缓存                              |
| 模型版本变化        | 最终回答缓存、分类缓存                    |
| embedding 模型变化  | embedding 缓存、retrieval 缓存            |
| 知识库版本变化      | retrieval 缓存、rerank 缓存、最终回答缓存 |
| 权限策略变化        | retrieval 缓存、tool 缓存、最终回答缓存   |
| 工具版本变化        | tool 缓存                                 |
| 长期记忆索引变化    | memory selection 缓存、最终回答缓存       |

TTL 可以按数据变化速度设置：

- embedding：长 TTL，模型版本变化时失效；
- retrieval：中等 TTL，知识库更新时失效；
- rerank：中等 TTL，候选集或模型变化时失效；
- tool result：按业务数据时效性设置；
- final answer：短 TTL 或只对稳定 FAQ 开启；
- realtime data：默认不缓存。

## 观测缓存是否有效

缓存上线后要看指标，否则不知道它是在省钱，还是在制造错误。

至少要记录：

- cache hit rate；
- 命中后节省的延迟；
- 命中后节省的 token；
- 不同缓存层的命中率；
- 因版本变化导致的失效次数；
- 缓存命中后的用户纠错率；
- 权限相关缓存拒绝次数。

如果命中率很低，通常是 key 过细，或者缓存对象本身不稳定。如果命中率很高但错误多，通常是 key 过粗，或者失效策略不完整。

## 常见误区

### 1. 只按用户问题缓存

同一个问题在不同知识库版本、权限、上下文下，答案可能不同。只按问题缓存，很容易串数据。

### 2. 把所有字段都放进 key

请求时间、随机 requestId、traceId 这类字段如果进 key，会导致几乎永远不命中。

### 3. 忘记权限范围

RAG 和工具调用都可能受权限影响。权限不进 key，就可能把 A 用户能看到的内容返回给 B 用户。

### 4. 缓存最终回答过早

最终回答是整条链路的产物。链路里任何关键因素变化，都可能让答案变化。除非上下文稳定、权限清楚、版本可控，否则优先缓存中间层。

### 5. 缓存不可重复的工具动作

写操作不是查询结果。发送消息、扣款、删除文件这类操作不能用缓存跳过，也不能把“上次执行成功”当作这次执行成功。

## 最后

LLM 应用里的缓存要按层设计。

RAG 场景一般需要缓存，但优先缓存 embedding、retrieval、rerank 这些中间结果。最终回答缓存收益最大，风险也最大，只适合知识、权限、上下文都稳定的场景。

缓存 key 的原则很简单：**把会影响结果的依赖放进去，把不会影响结果的噪声排除掉。**

做到这一点，缓存才是在降低成本和延迟，而不是把错误答案保存得更久。
