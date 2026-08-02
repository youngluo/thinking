---
createdAt: '2026-06-23 00:00'
order: 6
---

# 如何使用 LangChain 构建 RAG

[《RAG 是什么》](<./RAG 是什么.md>)介绍了 RAG 的基本流程。本文使用 LangChain.js 将这套流程落地：读取并切分 PDF，通过 Embedding 模型生成向量并写入 Qdrant，再根据用户问题检索相关文档块，交给聊天模型生成答案。

## 准备工作

### 安装依赖

```bash fold
pnpm add langchain @langchain/core @langchain/openai @langchain/ollama @langchain/qdrant @langchain/textsplitters pdf-parse zod
```

### 启动本地服务

示例依赖两个本地服务：Ollama 负责运行 Embedding 模型，Qdrant 负责存储和检索向量。安装方式可以参考[《Ollama 下载》](https://ollama.com/download)和[《Qdrant 安装文档》](https://qdrant.tech/documentation/installation/)。

安装并启动 Ollama 后，下载支持中文的多语言 Embedding 模型：

```bash fold
ollama pull bge-m3
```

接着通过 Docker 启动 Qdrant：

```bash fold
docker volume create rag-qdrant-data
docker run -d --name rag-qdrant -p 127.0.0.1:6333:6333 \
  -v rag-qdrant-data:/qdrant/storage qdrant/qdrant
```

端口映射只允许本机访问 Qdrant，命名卷 `rag-qdrant-data` 用于持久化数据。服务启动后，可以通过 `http://localhost:6333` 访问 REST API，通过 `http://localhost:6333/dashboard` 打开管理界面。

## 配置模型与向量存储

RAG 使用两类模型：聊天模型根据上下文生成答案，Embedding 模型将文档块和查询转换为向量。两者职责不同，可以来自不同的模型服务。

### 配置聊天模型

`ChatOpenAI` 可以连接实现了 OpenAI 兼容接口的模型服务：

```typescript fold title="src/rag/model.ts"
import { ChatOpenAI } from '@langchain/openai'

export const model = new ChatOpenAI({
  // 模型名称
  model: 'deepseek-v4-flash',
  // 控制生成内容的随机性
  temperature: 0,
  // 模型服务的 API Key
  apiKey: process.env.DEEPSEEK_API_KEY,
  // OpenAI 客户端的连接配置
  configuration: {
    // OpenAI 兼容接口地址
    baseURL: 'https://api.deepseek.com',
  },
})
```

### Embedding 与向量存储

Embedding 模型将文本转换为固定维度的数值向量。含义相近的文本，其向量通常也更接近。建立索引时，它负责转换文档块；检索时，它负责转换用户问题。两处必须使用同一个模型和配置，才能在同一向量空间中比较。

向量存储负责保存向量，并根据查询向量寻找相近的数据。本文使用 Qdrant，通过 LangChain 的 `QdrantVectorStore` 统一完成写入和检索。

Qdrant 使用 Collection 组织数据，可以近似理解为关系型数据库中的表。每个文档块会保存为一个 Point，其中包含：

- `id`：Point 的唯一标识，用于定位、更新或删除数据；
- `vector`：由 Embedding 模型生成的向量，用于计算文档块与查询的相似度；
- `payload`：与向量关联的附加数据，本文用它保存文档正文和来源信息。

检索时，Qdrant 先计算查询向量与各 Point 的 `vector` 之间的相似度，再返回最相近 Point 的 `payload`。同一 Collection 中的向量需要使用相同的维度和距离计算方式，因此更换 Embedding 模型后通常需要重建 Collection。

### 配置向量存储

```typescript fold title="src/rag/vector-store.ts"
import { OllamaEmbeddings } from '@langchain/ollama'
import { QdrantVectorStore } from '@langchain/qdrant'

const embeddings = new OllamaEmbeddings({
  // 用于生成文本向量的本地模型
  model: 'bge-m3',
  // Ollama 服务地址
  baseUrl: 'http://localhost:11434',
})

export const vectorStore = new QdrantVectorStore(
  // 用于生成文档向量和查询向量的 Embedding 模型
  embeddings,
  // Qdrant 连接和 Collection 配置
  {
    // Qdrant REST API 地址
    url: process.env.QDRANT_URL ?? 'http://localhost:6333',
    // 存放文档块的 Collection 名称
    collectionName: 'rag_documents',
  }
)
```

`QdrantVectorStore` 的第一个参数是 Embedding 模型，第二个参数是 Qdrant 连接配置。首次写入时，如果 Qdrant 中不存在名为 `rag_documents` 的 Collection，`QdrantVectorStore` 会自动创建。

## 构建文档索引

索引脚本负责读取文档、切块并写入向量存储。这属于离线流程，通常只在文档新增或更新时运行。

### 加载文档

示例使用 `pdf-parse` 按页读取本地 PDF，再将每一页转换为 LangChain 的 `Document`。`Document` 使用 `pageContent` 保存正文，使用 `metadata` 保存文件路径和页码。

```typescript fold title="src/rag/indexing.ts"
import { readFile } from 'node:fs/promises'
import { Document } from '@langchain/core/documents'
import { PDFParse } from 'pdf-parse'

/**
 * 读取本地 PDF 并转换为 LangChain 文档。
 * @param filePath PDF 文件路径。
 */
async function loadPdf(filePath: string) {
  const parser = new PDFParse({
    // 从本地 PDF 读取的二进制数据
    data: await readFile(filePath),
  })

  try {
    // 不传参数时提取全部页面的文本
    const result = await parser.getText()
    return result.pages
      .filter((page) => page.text.trim())
      .map(
        (page) =>
          new Document({
            // 参与切块和检索的当前页正文
            pageContent: page.text,
            // 随文档块保留的文件路径和页码
            metadata: { source: filePath, pageNumber: page.num },
          })
      )
  } finally {
    // 释放解析器占用的资源
    await parser.destroy()
  }
}
```

### 切分文档

`RecursiveCharacterTextSplitter` 按默认分隔符依次尝试切分，并用长度限制兜底：

```typescript fold title="src/rag/indexing.ts"
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

const splitter = new RecursiveCharacterTextSplitter({
  // 每个文档块的最大字符数
  chunkSize: 500,
  // 相邻文档块重叠的字符数
  chunkOverlap: 50,
})
```

`chunkSize` 和 `chunkOverlap` 只是示例参数，实际取值应根据文档结构和评测结果调整。

### 写入向量存储

将加载和切分串起来，再调用 `addDocuments` 写入文档块。`vectorStore` 会使用自身配置的 Embedding 模型生成向量：

```typescript fold title="src/rag/indexing.ts"
import { vectorStore } from './vector-store'

/**
 * 为指定 PDF 建立索引。
 * @param filePath 要建立索引的 PDF 文件路径。
 */
export async function indexDocument(filePath: string) {
  // loadPdf 接收文件路径，返回要切分的 PDF 文档
  const documents = await loadPdf(filePath)

  // splitDocuments 接收文档列表，返回切分后的文档块
  const chunks = await splitter.splitDocuments(documents)

  // addDocuments 接收文档块，并生成向量后写入 Qdrant
  await vectorStore.addDocuments(chunks)
}
```

`addDocuments` 会通过 `embeddings` 生成向量，并将向量、正文和元数据写入 `rag_documents`。

### 运行索引

索引入口放在单独的文件中，避免其它模块导入 `indexing.ts` 时触发写入：

```typescript fold title="src/rag/index.ts"
import { indexDocument } from './indexing'

// 要建立索引的 PDF 文件路径
await indexDocument('docs/handbook.pdf')
```

## 构建 RAG 链

文档写入索引后，在线流程依次完成检索、提示词组装、模型调用和输出解析。LangChain 将每个步骤表示为 Runnable，再通过 `RunnableSequence` 串成一条可调用的 RAG 链。

### 创建检索器

检索器（Retriever）将向量存储的搜索能力封装为统一接口：输入问题字符串，返回相关的 `Document[]`。`asRetriever` 用于从 `vectorStore` 创建检索器：

```typescript fold title="src/rag/chain.ts"
import { vectorStore } from './vector-store'

export const retriever = vectorStore.asRetriever({
  // 每次检索返回的文档块数量
  k: 4,
})
```

### 组装检索上下文

检索器输出 `Document[]`，而提示词需要文本形式的上下文，因此要先将文档块中的正文和来源整理成字符串：

```typescript fold title="src/rag/chain.ts"
import type { Document } from '@langchain/core/documents'

/**
 * 将检索到的文档块整理为带来源编号的上下文。
 * @param documents 检索器返回的文档块。
 */
export function formatDocuments(documents: Document[]) {
  return documents
    .map((document, index) => {
      const source = String(document.metadata.source ?? '未知来源')
      const pageNumber = document.metadata.pageNumber
      const citation = pageNumber ? `${source}，第 ${pageNumber} 页` : source
      return `[${index + 1}] 来源：${citation}\n${document.pageContent}`
    })
    .join('\n\n')
}
```

编号用于建立答案与检索内容的对应关系。当前示例会显示 PDF 文件路径和页码，需要时还可以在 `metadata` 中补充标题或章节信息。

### 配置提示词

`ChatPromptTemplate` 将检索内容和用户问题放入固定位置，并约束模型只根据提供的资料回答：

```typescript fold title="src/rag/chain.ts"
import { ChatPromptTemplate } from '@langchain/core/prompts'

// 参数为按顺序发送给模型的消息模板
const prompt = ChatPromptTemplate.fromMessages([
  // system 消息用于约束回答范围和引用格式
  [
    'system',
    `你是一个问答助手。请严格根据提供的资料回答问题。
如果资料中没有答案，直接回答“我不知道”，不要编造。
回答时使用 [1][2] 这样的编号标注引用来源。`,
  ],
  // human 消息通过占位符接收检索上下文和用户问题
  ['human', '资料：\n{context}\n\n问题：{question}'],
])
```

### 串联并调用 RAG 链

`RunnableSequence.from` 接收 Runnable 数组，并将前一步的输出传给后一步。用户问题首先进入两条分支：一条检索相关文档并生成上下文，另一条保留原始问题。随后再依次构造消息、调用模型并解析输出：

```typescript fold title="src/rag/chain.ts"
import { StringOutputParser } from '@langchain/core/output_parsers'
import { RunnablePassthrough, RunnableSequence } from '@langchain/core/runnables'
import { model } from './model'

export const ragChain = RunnableSequence.from([
  // 第一项接收用户问题，并生成提示词需要的两个字段
  {
    // 检索相关文档，再将 Document[] 整理为上下文字符串
    context: retriever.pipe(formatDocuments),
    // 原样保留用户问题
    question: new RunnablePassthrough(),
  },
  // 使用 context 和 question 生成消息列表
  prompt,
  // 使用消息列表调用聊天模型
  model,
  // 将模型返回的消息转换为字符串
  new StringOutputParser(),
])
```

调用时只需向 RAG 链传入用户问题：

```typescript fold title="src/rag/query.ts"
import { ragChain } from './chain'

// 参数为 RAG 链接收的用户问题
const answer = await ragChain.invoke('退款被驳回后怎么处理？')
console.log(answer)
```

整条链中的数据形态如下：

```d2
direction: right

question: 问题字符串
fields: "{ context, question }"
messages: 消息列表
response: 模型响应
answer: 答案字符串

question -> fields: 检索并保留问题
fields -> messages: prompt
messages -> response: model
response -> answer: StringOutputParser
```

需要流式读取模型输出时，将 `invoke` 改为 `stream`：

```typescript fold title="src/rag/query.ts"
// 参数与 invoke 相同，均为用户问题字符串
const stream = await ragChain.stream('退款被驳回后怎么处理？')

for await (const chunk of stream) {
  process.stdout.write(chunk)
}
```

到这里，一条最小 RAG 链已经完成。固定的知识问答直接调用这条链即可，不需要引入 Agent。

## 将检索器封装为 Agent 工具

固定 RAG 链会在每次调用时执行检索。如果应用需要由模型判断是否检索，或者还要调用其它工具，可以将检索器接入 Agent。对于始终需要查询知识库的问答场景，继续使用前面的 RAG 链即可。

### 创建检索工具

`tool` 将检索函数封装为 Agent 可调用的工具。`name` 用于标识工具，`description` 帮助模型判断何时调用，`schema` 负责描述和校验输入参数：

```typescript fold title="src/rag/agent.ts"
import { tool } from 'langchain'
import * as z from 'zod'
import { formatDocuments, retriever } from './chain'

const searchDocuments = tool(
  // 接收通过 schema 校验的 query 并执行检索
  async ({ query }) => {
    const documents = await retriever.invoke(query)
    return formatDocuments(documents)
  },
  // 提供给模型的工具定义
  {
    // 工具名称
    name: 'search_documents',
    // 帮助模型判断何时调用该工具
    description: '从知识库检索业务规则、流程和错误码等资料。',
    // 约束工具参数的名称和类型
    schema: z.object({
      // 用于召回文档的问题或关键词
      query: z.string().describe('用于检索的问题或关键词'),
    }),
  }
)
```

工具执行后返回格式化的检索内容。Agent 会将该结果加入消息列表，再让模型继续生成答案。

### 创建并调用 Agent

`createAgent` 会在模型和工具之间循环：模型先根据消息判断是否调用工具；如果调用，Agent 执行工具并将结果返回模型；当模型不再发起工具调用时，循环结束。本示例的调用过程如下：

```d2
direction: right

question: 用户问题
model: 模型判断
decision: 是否检索 {
  shape: diamond
  class: decision
}
tool: 执行检索工具
result: 追加检索结果
answer: 生成最终答案

question -> model -> decision
decision -> tool: 是
tool -> result -> model
decision -> answer: 否
```

对应代码如下：

```typescript fold title="src/rag/agent.ts"
import { createAgent } from 'langchain'
import { model } from './model'

const agent = createAgent({
  // 负责选择工具和生成答案的聊天模型
  model,
  // Agent 可以调用的工具列表
  tools: [searchDocuments],
  // 约束 Agent 何时检索以及如何回答
  systemPrompt: `你是问答助手。涉及业务规则、流程或错误码时，先调用 search_documents。
严格根据检索结果回答；资料中没有答案时，直接回答“我不知道”，不要编造。`,
})

const result = await agent.invoke({
  // 本次调用的对话消息
  messages: [
    {
      // 消息发送者
      role: 'user',
      // 用户输入的内容
      content: '退款被驳回后怎么处理？',
    },
  ],
})

// messages 的最后一项是 Agent 的最终回复
console.log(result.messages.at(-1)?.text)
```

返回结果中的 `messages` 保留了本次运行的用户消息、工具调用、工具结果和最终回复。需要流式读取 Agent 的运行过程时，调用 `agent.stream`：

```typescript fold title="src/rag/agent.ts"
const stream = await agent.stream(
  {
    // 本次调用的对话消息
    messages: [
      {
        // 消息发送者
        role: 'user',
        // 用户输入的内容
        content: '退款被驳回后怎么处理？',
      },
    ],
  },
  {
    // 每一步都返回当前完整的 Agent 状态
    streamMode: 'values',
  }
)

for await (const state of stream) {
  // 输出当前步骤新增的最后一条消息
  console.log(state.messages.at(-1))
}
```

`values` 模式会在每个 Agent 步骤完成后返回当前完整状态，因此可以依次看到模型的工具调用、工具结果和最终回复。

## 工程实践

生产环境还需要关注索引更新、模型切换和调用观测：

- **维护文档索引**：`addDocuments` 每次运行都会新增 Point。生产环境应为文档块分配稳定的 `id`，并记录来源和版本。文档更新时，先删除旧 Point，再写入新文档块；
- **切换 Embedding 模型**：更换模型或版本后，应新建 Collection，并使用新模型重新生成全部文档向量。即使向量维度相同，也不要混用新旧模型生成的向量；
- **观测调用链路**：使用 LangSmith trace 查看检索结果、模型输入、调用耗时和 token 消耗。
