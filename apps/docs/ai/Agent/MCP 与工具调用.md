---
createdAt: '2026-08-06 22:06'
order: 10
draft: true
---

# MCP 与工具调用

想让大模型调用外部能力，主流有两条路：模型原生的 function calling（也叫 tool use），以及后来出现的标准化协议 MCP（Model Context Protocol，模型上下文协议）。两者常被混为一谈，但抽象层级和适用场景并不一样。要把工具接进 Agent，先弄清它们各自是什么、怎么写，才知道什么时候该用哪一个。

## MCP 是什么

MCP 把「工具长什么样、怎么发现、怎么调用」从应用里抽出来，做成一层独立于模型的协议层，夹在模型与应用之间。它定义的是接口契约，不绑定任何具体模型。

MCP 的运行涉及三个角色：

- `Host`：AI 应用或 Agent 宿主，例如 Claude Desktop、Cursor 以及自研 Agent 程序，负责和模型对话并加载管理 Client；
- `Client`：跑在 Host 内部的连接器，与每个 Server 一一对应，负责把 Host 的请求翻译为协议调用、把结果翻译回来；
- `Server`：独立进程，向外暴露能力，可访问本地文件系统、远程 API 或任意后端，凭证只留在 Server 这一侧。

```d2
direction: down

Host: AI 应用 / Agent 宿主 {
  class: group
  Client: MCP Client {
    class: subgroup
  }
}

Server: MCP Server {
  class: group
  Tools: 工具（可执行、有副作用）
  Resources: 资源（只读上下文）
  Prompts: 提示模板（可复用）
}

Host.Client -> Server.Tools: tools/call
Host.Client -> Server.Resources: resources/read
Host.Client -> Server.Prompts: prompts/get
```

只要 Host 支持 MCP，换个模型就不需要改 Server；只要 Server 实现协议，就能被任意兼容的 Host 加载。

MCP 的消息格式基于 JSON-RPC 2.0，传输层（Transport）负责把消息送到对端。常见两种：

- `stdio`：Server 作为本地子进程启动，通过标准输入输出收发消息，零网络、凭证不出本机，是本地工具的首选；
- `Streamable HTTP`：Server 跑在远端，通过 HTTP 通信，适合多用户、集中部署的场景（旧版用 SSE，新版已被 Streamable HTTP 取代）。

一次典型的会话生命周期如下：

```d2
direction: right

Client -> Server: initialize（协议版本 + capabilities 协商）
Server -> Client: serverInfo + capabilities
Client -> Server: tools/list
Server -> Client: 工具 schema 列表
Client -> Server: tools/call（name + arguments）
Server -> Client: content blocks（结构化结果）
```

握手阶段 `initialize` 完成协议版本与能力（capabilities）协商，之后 Host 才知道这个 Server 能提供哪些工具、资源和提示。调用 `tools/call` 时传入工具名和参数，Server 执行后返回 `content blocks`，可以是文本、图片或结构化数据。

能力三件套的职责边界：

- `Tools`：模型可主动调用、通常有副作用（查库、发请求、执行命令）；
- `Resources`：只读上下文，类似带 URI 的文件或数据片段，用来给模型补充背景；
- `Prompts`：可复用的提示模板，由用户触发而非模型自动调用。

## MCP Server 示例

下面用官方 `@modelcontextprotocol/sdk` 写一个本地 stdio Server，暴露两个工具：一个调外部天气 API，一个读本地文件。先看清这条路的写法，再和后面的 function calling 示例对照。

```ts fold title="server.ts"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const server = new McpServer({
  name: "local-toolkit",
  version: "1.0.0",
});

// 工具一：调用外部 API（有副作用、走网络）
server.tool(
  "get_weather",
  "获取指定城市的当前天气",
  { city: z.string().describe("城市名，如 上海") },
  async ({ city }) => {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    if (!res.ok) {
      return { content: [{ type: "text", text: `天气服务返回 ${res.status}` }], isError: true };
    }
    const data = await res.json();
    const current = data.current_condition?.[0];
    if (!current) {
      return { content: [{ type: "text", text: "未获取到天气数据" }], isError: true };
    }
    return {
      content: [
        {
          type: "text",
          text: `${city} 当前 ${current.temp_C}°C，${current.lang_zh[0].value}`,
        },
      ],
    };
  },
);

// 工具二：读取本地文件（资源接入）
server.tool(
  "read_local_note",
  "读取本地笔记文件内容",
  { path: z.string().describe("文件绝对路径") },
  async ({ path }) => {
    if (!existsSync(path)) {
      return { content: [{ type: "text", text: "文件不存在" }], isError: true };
    }
    const text = await readFile(path, "utf-8");
    return { content: [{ type: "text", text }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

`wttr.in` 只是示意用的免费天气接口，生产环境换成你自己的服务即可。注意 `read_local_note` 能读任意绝对路径：stdio 本地 Server 以当前用户权限运行，可以读到该用户有权限的全部文件。暴露文件类工具时，应当自行限定可访问的目录范围。

对比原始 function calling，schema 现在跟着工具走、由 Server 声明，执行逻辑和凭证也都封在 Server 里。Host 不需要预先知道这两个工具长什么样，启动后通过 `tools/list` 就能拿到。

要在本地把这段跑起来，先装依赖：

```bash
npm install @modelcontextprotocol/sdk zod
npx tsc server.ts
node server.js
```

本例用了顶层 `await` 和带 `.js` 后缀的 ESM 导入，需要项目 `package.json` 设置 `"type": "module"`（或把启动逻辑包进 `async main()` 函数）。

真正接入时，通常不必手写 Client。支持 MCP 的 Host（Claude Desktop、Cursor 等）通过配置文件加载 Server。比如 Claude Desktop 的 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "local-toolkit": {
      "command": "node",
      "args": ["/absolute/path/to/server.js"]
    }
  }
}
```

如果你想在代码里连，最小 Client 长这样：

```ts fold title="client.ts"
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["server.js"],
});
const client = new Client({ name: "demo-client", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
// 真实 Host 会把 tools 的 schema 交给 LLM，由模型决定调用哪个、传什么参数
// 这里硬编码参数，只为聚焦协议层的调用流程
const result = await client.callTool({
  name: "get_weather",
  arguments: { city: "上海" },
});
console.log(result);
```

## 工具调用是什么

日常语境下，「工具调用」和 function call 基本是一回事，严格说有三个层次的差别：

- 模型层面：两者是同一机制，模型本身不执行任何东西，只输出「调哪个、参数是什么」的调用意图，真正执行在应用侧。OpenAI 称 `function calling`/`tools`，Anthropic 称 `tool use`，Google 称 `function declarations`，中文「工具调用」即 `tool calling`/`tool use` 的译名，这一层两者等同；
- 抽象层面：tool 比 function calling 更宽。早期 OpenAI 把 `functions` 和 `tools` 分作两个参数，`functions` 是单一调用声明，`tools` 后来统一收编二者，现在主流 API 都用 `tools` 承载；
- 协议层面（MCP）：tool 是一等公民。在 MCP 里「工具」被标准化为可发现、统一调用的执行单元，`tools/list` 发现能力、`tools/call` 负责调用、结果统一为 `content blocks`，并和只读的「资源 `resources`」、可复用的「提示模板 `prompts`」区分开。

一句话概括：function calling 是「模型输出一段调用描述、应用自己接」的原始能力，MCP 的「工具」是「带标准发现与调用协议、且与资源/提示区分」的标准化能力。它们指向同一件事的不同抽象层级，谈不上替代。

回到原始 function calling 本身，它只给了「模型输出调用意图、应用自己执行」这一个原始机制，却把下面这些事都推给了应用侧：

- schema 由每个应用各自定义，对接同一个数据源要重写一遍，格式随模型 API 字段走；
- 凭证（数据库、GitHub、内部 API 的密钥）都留在应用进程里，难以统一收口和轮换；
- 适配成本随数据源线性增长，连数据库、文件系统、GitHub 就要写三套胶水，换模型还可能要改字段映射；
- 缺少标准发现机制，工具能力与参数只能靠文档约定或硬编码，运行期无法自描述。

单独看每一条都不致命。但当「多源接入、凭证隔离、跨模型复用」同时出现时，重复劳动和散落的凭证就成了负担，这正是 MCP 要解决的问题。下一节用一段可直接运行的示例，把原始 function calling 写成代码。

## 工具调用示例

下面这段用 OpenAI Node SDK 演示 function calling 的原始机制。三件事要留意：schema 由应用声明、模型只返回调用意图、真正的执行与结果回灌都在应用侧。

```ts fold title="function-calling-baseline.ts"
import OpenAI from "openai";

const client = new OpenAI();

// 1. schema 由应用侧定义，每次对接都要写一遍
const tools = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "获取指定城市的当前天气",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    },
  },
];

// getWeather 是应用侧自己的执行逻辑，真实场景里调用天气服务
async function getWeather(city: string): Promise<string> {
  // 此处省略网络请求，仅示意执行环节
  return `${city} 晴，25°C`;
}

// 2. 模型只返回「调哪个函数、填什么参数」，不执行
const resp = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "上海天气怎么样" }],
  tools,
});
const call = resp.choices[0].message.tool_calls?.[0];

// 模型可能判断无需调用工具，这时直接给出自然语言答复
if (!call) {
  console.log(resp.choices[0].message.content);
  process.exit(0);
}

// 3. 应用在本地真正执行，再把结果喂回模型
const result = await getWeather(JSON.parse(call.function.arguments).city);
const finalResp = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [
    { role: "user", content: "上海天气怎么样" },
    resp.choices[0].message,
    { role: "tool", tool_call_id: call.id, content: result },
  ],
  tools,
});
console.log(finalResp.choices[0].message.content);
```

这段代码的接缝很明显：`get_weather` 的 schema 写死在应用里，执行逻辑 `getWeather` 也在这里，凭证（API Key）由应用持有。再接一个 GitHub 工具，就要重复一遍同样的胶水代码。对比前面 MCP Server 的写法，差异一目了然。

## 工具调用与 MCP 的对比

本节把「工具调用」理解为未标准化的 function calling 基线方式，与 MCP 对照：

| 维度 | function calling | MCP |
| --- | --- | --- |
| schema 由谁定义 | 应用侧，每次对接都重写 | Server 暴露，Host 自动发现 |
| 谁负责执行 | 应用侧代码 | Server 进程 |
| 多源扩展成本 | N 个数据源要写 N 套适配 | 接 N 个 Server 即可 |
| 凭证管理 | 散落在各个应用 | 收口在 Server，Host 不直接持凭证 |
| 可发现性 | 无标准，靠文档约定 | `tools/list` 运行时自描述 |
| 状态保持 | 每轮请求内完成，历史由应用自行维护 | Server 常驻，可持有跨调用的连接与缓存 |
| 模型耦合 | 与具体 API 字段绑定 | 协议层与模型 API 字段解耦（Host 仍需一个支持工具调用的模型） |

function calling 不是不好，它轻、直接，适合单一应用里的少量简单调用。MCP 的价值在「多源、复用、隔离凭证」这三件事同时出现时才会凸显。

## 生态与选型

官方和社区已经有一批开箱即用的 Server：`filesystem`（本地文件）、`github`、`postgres`、`slack` 等，覆盖常见数据源。接它们不需要自己写胶水，配一个命令就能用。

什么时候该上 MCP：

- 要接多个异构数据源或能力，且希望跨应用复用；
- 想把凭证和执行收口到独立进程，Host 不直接持有敏感信息；
- 团队需要一套统一的工具标准，避免每个项目重复造适配。

什么时候不该上 MCP：

- 只是单个应用里的少量简单调用，直接 function calling 更轻，引入 MCP 反而是额外负担；
- 工具逻辑高度定制、只在某一个应用内使用，没有复用需求。

传输方式怎么选：本地优先 `stdio`，零网络、凭证不出本机；需要远程、多用户或集中部署时，用 `Streamable HTTP`。

## 小结

MCP 把「工具怎么描述、怎么发现、怎么调用」标准化成一层独立于模型的协议，让能力收进独立进程、被任意 Host 加载复用。function calling 是更轻的原始机制，适合单一应用里的少量简单调用，代价是描述、发现、凭证都要应用自己扛。两者不是二选一：场景落在「多源 + 复用 + 凭证隔离」区间就用 MCP，否则直接 function calling 更省事。
