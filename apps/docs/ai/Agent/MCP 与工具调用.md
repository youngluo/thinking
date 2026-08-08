---
createdAt: '2026-08-06 22:06'
order: 10
draft: true
---

# MCP 与工具调用

让大模型使用外部能力，通常会同时遇到 function calling（也叫 tool calling 或 tool use）和 MCP（Model Context Protocol，模型上下文协议）。前者是模型 API 表达调用意图的机制，后者是 AI 应用连接外部能力的协议。两者处于不同层级，可以组合使用。

## MCP 是什么

MCP 标准化了 AI 应用发现和调用外部能力的方式。它位于 Host 与能力提供方之间，定义连接、能力协商和消息格式，不规定 Host 如何调用模型。模型通常不直接收发 MCP 消息，而是由 Host 把 MCP 能力转换成模型 API 能理解的工具定义，再把模型生成的调用意图路由给对应的 Server。

MCP 的运行涉及三个角色：

- `Host`：AI 应用或 Agent 宿主，例如 Claude Desktop、Cursor 以及自研 Agent 程序，负责模型交互、权限控制和 Client 管理；
- `Client`：由 Host 创建的协议客户端，与某个 Server 保持一对一连接，负责能力协商和消息路由；
- `Server`：提供特定能力的本地进程或远程服务，可连接文件系统、数据库和外部 API 等后端。

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
  Tools: 工具（执行操作或查询数据）
  Resources: 资源（由应用读取的上下文）
  Prompts: 提示模板（由用户选择）
}

Host.Client -> Server.Tools: tools/call
Host.Client -> Server.Resources: resources/read
Host.Client -> Server.Prompts: prompts/get
```

Server 不依赖某个模型厂商的工具字段。更换模型时，通常只需由 Host 适配新的模型 API，Server 可以保持不变。同一个 Server 也可以被多个兼容的 Host 复用。

MCP 的消息格式基于 JSON-RPC 2.0，传输层（Transport）负责把消息送到对端。常见两种：

- `stdio`：Client 启动本地 Server 子进程，通过标准输入输出收发消息，适合本机集成。传输本身不经过网络，但 Server 仍然可以访问网络；
- `Streamable HTTP`：Client 通过 HTTP 与独立运行的 Server 通信，可选用 SSE 承载流式消息，适合远程和集中部署。它取代了旧版 HTTP+SSE 传输。

一次典型的会话生命周期如下：

```d2
direction: right

Client -> Server: initialize（协议版本 + capabilities 协商）
Server -> Client: serverInfo + capabilities
Client -> Server: notifications/initialized
Client -> Server: tools/list
Server -> Client: 工具 schema 列表
Client -> Server: tools/call（name + arguments）
Server -> Client: content + 可选 structuredContent
```

握手阶段通过 `initialize` 协商协议版本和双方的 `capabilities`，Client 再发送 `notifications/initialized` 表示会话可以开始。之后，Host 可以按需调用 `tools/list`、`resources/list` 和 `prompts/list` 获取 Server 暴露的能力。

调用 `tools/call` 时，Client 传入工具名和参数。Server 返回的 `content` 可以包含文本、图片、音频或资源，结构化结果则放在可选的 `structuredContent` 中。

Server 暴露的三类核心能力有不同的控制方式：

- `Tools`：主要由模型选择调用，用于查询数据或执行操作，是否产生副作用取决于具体工具；
- `Resources`：主要由应用选择和读取，以 URI 标识文件、数据库记录等上下文；
- `Prompts`：主要由用户选择的可复用提示模板。

这里的「主要由谁控制」是交互约定，不是强制的 UI 形式。Host 仍应根据权限和副作用决定是否允许调用，必要时要求用户确认。

## MCP Server 示例

下面用官方 `@modelcontextprotocol/sdk` 写一个本地 stdio Server，并暴露一个查询天气的工具。示例只聚焦工具注册和传输连接，生产环境还需要补充超时、鉴权、限流和审计等机制。

```ts fold title="server.ts"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "local-toolkit",
  version: "1.0.0",
});

server.registerTool(
  "get_weather",
  {
    description: "获取指定城市的当前天气",
    inputSchema: { city: z.string().describe("城市名，如 上海") },
  },
  async ({ city }) => {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    if (!res.ok) {
      return { content: [{ type: "text", text: `天气服务返回 ${res.status}` }], isError: true };
    }
    const data = (await res.json()) as {
      current_condition?: Array<{
        temp_C?: string;
        lang_zh?: Array<{ value?: string }>;
      }>;
    };
    const current = data.current_condition?.[0];
    if (!current) {
      return { content: [{ type: "text", text: "未获取到天气数据" }], isError: true };
    }
    const description = current.lang_zh?.[0]?.value ?? "暂无天气描述";
    return {
      content: [
        {
          type: "text",
          text: `${city} 当前 ${current.temp_C ?? "未知"}°C，${description}`,
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

`wttr.in` 只是示意用的免费天气接口，生产环境应替换成稳定、可鉴权的服务。stdio Server 以启动它的用户权限运行；如果工具涉及文件或命令，还应限制可访问范围，不能把进程权限直接暴露给模型。

在这个实现中，schema 和执行逻辑由 Server 提供。Host 不需要在代码里预先声明工具，连接后可以通过 `tools/list` 动态获取，再转换成当前模型 API 所需的格式。

要在一个空目录中把这段跑起来，可以创建 ESM 项目并编译后启动：

```bash fold
npm init -y
npm pkg set type=module
npm install @modelcontextprotocol/sdk zod
npm install --save-dev typescript @types/node
npx tsc server.ts --outDir dist --module NodeNext --moduleResolution NodeNext --target ES2022
node dist/server.js
```

本例使用顶层 `await` 和带 `.js` 后缀的 ESM 导入，因此将 TypeScript 的模块及模块解析模式都设为 `NodeNext`。

接入支持 MCP 的 Host 时，通常不必手写 Client。Claude Desktop、Cursor 等 Host 可以通过配置文件加载 Server。以 Claude Desktop 的 `claude_desktop_config.json` 为例：

```json fold title="claude_desktop_config.json"
{
  "mcpServers": {
    "local-toolkit": {
      "command": "node",
      "args": ["/absolute/path/to/dist/server.js"]
    }
  }
}
```

需要自行实现 Host 时，可以先用最小 Client 验证协议调用：

```ts fold title="client.ts"
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["/absolute/path/to/dist/server.js"],
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

日常语境下，「工具调用」通常指模型生成工具调用意图，再由应用执行并回传结果的完整流程。function calling 和 tool calling 经常作为同义词使用，但 `function`、`tool` 和 MCP Tool 仍有范围差异：

- `tool call` 是模型输出的调用意图，通常包含工具名和参数。模型不会因此自动执行应用代码；
- `function` 是一种用 JSON Schema 描述输入的工具。部分模型平台的 `tools` 还包含平台内置工具或接受自由文本输入的自定义工具，因此 tool 的范围可以更宽；
- MCP Tool 是 Server 暴露的协议能力，通过 `tools/list` 发现、通过 `tools/call` 调用。Host 通常会把它转换成模型平台的工具定义。

function calling 解决模型与应用之间如何表达调用意图，MCP 解决 Host 与外部能力之间如何发现、连接和调用。MCP 不替代 function calling，支持两者的 Host 会把它们串在同一条调用链上。

function calling 只规定模型 API 如何接收工具定义、返回调用意图和接收执行结果。下面这些工作仍由应用负责：

- 按模型 API 的格式提交工具定义，并校验模型返回的参数；
- 把调用分发给本地函数或远程服务，再将结果回传给模型；
- 设计权限、确认、超时、重试、幂等和审计机制；
- 自行定义工具发现、连接和生命周期管理方式。

应用可以用内部抽象解决这些问题，MCP 则提供了一套跨 Host 和 Server 的公共协议。它减少的是重复的协议适配，不会自动生成数据源集成，也不会替 Host 完成权限控制和调用编排。

## 工具调用示例

下面用 OpenAI Node SDK 的 Responses API 演示 function calling。工具 schema 由应用提交，模型返回调用意图，应用执行后再把结果回传给模型。示例关闭并行工具调用，只处理一轮中的零次或一次调用，以便聚焦主流程。

```ts fold title="function-calling-baseline.ts"
import OpenAI from "openai";

const client = new OpenAI();

// 1. 应用按模型 API 的格式定义工具
const tools = [
  {
    type: "function",
    name: "get_weather",
    description: "获取指定城市的当前天气",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
      additionalProperties: false,
    },
    strict: true,
  },
] satisfies OpenAI.Responses.Tool[];

/** 应用侧的工具执行逻辑，真实场景里调用天气服务。 */
async function getWeather(city: string): Promise<string> {
  // 此处省略网络请求，仅示意执行环节
  return `${city} 晴，25°C`;
}

const input: OpenAI.Responses.ResponseInput = [
  { role: "user", content: "上海天气怎么样" },
];

// 2. 模型只返回调用意图，不执行应用代码
const response = await client.responses.create({
  model: "gpt-4o-mini",
  input,
  tools,
  parallel_tool_calls: false,
});
input.push(...response.output);
const call = response.output.find((item) => item.type === "function_call");

// 模型可能判断无需调用工具，这时直接给出自然语言答复
if (!call) {
  console.log(response.output_text);
  process.exit(0);
}

if (call.name !== "get_weather") {
  throw new Error(`未知工具：${call.name}`);
}

// 3. 应用执行工具，再把结果关联到这次调用
const { city } = JSON.parse(call.arguments) as { city: string };
const result = await getWeather(city);
input.push({
  type: "function_call_output",
  call_id: call.call_id,
  output: result,
});

const finalResponse = await client.responses.create({
  model: "gpt-4o-mini",
  input,
  tools,
  parallel_tool_calls: false,
});
console.log(finalResponse.output_text);
```

这段代码中，`get_weather` 的 schema、执行逻辑和调用编排都由应用维护。继续添加工具时，应用还要维护相应的定义、分发逻辑和权限规则。MCP 的差别在于把工具定义和执行接口放到 Server，再由 Host 通过统一协议发现和调用。

`strict: true` 会约束参数遵循 schema，但生产代码仍要处理参数解析失败、工具执行异常、连续多轮调用和调用次数上限。涉及写操作时，还需要在执行前完成授权和用户确认。

## 工具调用与 MCP 的对比

本节把「工具调用」理解为模型 API 侧的 function calling 基线方式，与 MCP 对照：

| 维度 | function calling | MCP |
| --- | --- | --- |
| 工具定义 | 应用按模型 API 的格式提交 | Server 暴露，Host 通过 `tools/list` 发现并转换 |
| 工具执行 | 应用或它调用的服务执行 | Server 执行，Host 负责授权和路由 |
| 连接方式 | 由应用自行约定 | 标准化 stdio 和 Streamable HTTP 等传输 |
| 凭证管理 | 取决于应用架构 | 可由远程 Server 持有；本地 stdio Server 仍共享当前用户的系统权限 |
| 可发现性 | 模型 API 不规定跨服务的发现协议 | Server 可在运行期返回工具列表及 schema |
| 状态管理 | 由应用自行实现 | 协议支持会话，Server 可以设计为有状态或无状态 |
| 模型耦合 | 工具字段取决于模型 API | Server 与模型 API 解耦，Host 仍需完成格式转换 |

function calling 轻量、直接，适合单一应用里的少量工具。MCP 增加了一层协议和运行时，换来跨 Host 复用、动态发现以及统一的连接方式。两者不是同一维度的替代方案，使用 MCP 的 Host 通常仍要依赖模型的工具调用能力。

## 生态与选型

MCP Registry、服务厂商和社区已经提供了一批可复用的 Server。接入前仍要检查协议版本、配置、鉴权方式、权限范围和维护状态；支持 MCP 不等于可以在任意 Host 中无配置运行，也不代表 Server 本身可信。

什么时候该上 MCP：

- 要接多个异构能力，并希望在多个 Host 中复用同一套接口；
- 需要运行时发现工具，并统一连接、能力协商和调用协议；
- 希望通过远程服务或受限进程收口执行环境和凭证，同时愿意维护对应的部署与授权机制。

什么时候不该上 MCP：

- 只是单个应用里的少量简单调用，直接 function calling 更轻，引入 MCP 反而是额外负担；
- 工具逻辑高度定制、只在某一个应用内使用，没有复用需求。

本地子进程集成通常选 `stdio`；需要远程访问、多用户或集中部署时选 `Streamable HTTP`，并补齐认证、授权和网络安全措施。

## 小结

function calling 规定模型与应用之间如何表达工具调用，MCP 规定 Host 与 Server 之间如何发现、连接和调用能力。少量应用内工具可以直接使用 function calling；需要跨 Host 复用、动态发现或统一连接协议时，再引入 MCP。无论采用哪种方式，权限控制、参数校验、错误处理和审计都不会由协议自动完成。
