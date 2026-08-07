---
createdAt: '2026-08-03 16:26'
order: 10
draft: true
---

# CopilotKit 介绍与快速入门

## 先说清楚 CopilotKit 是什么

CopilotKit 是一套面向 React 的开源框架，把 AI Agent 作为一层织进应用的界面和状态。官方的定位是 agent 的前端栈（the frontend stack for agents）：聊天界面、生成式 UI、应用状态共享、人在回路这些做助手必需的通用件，框架直接做好。具体要补齐哪些、为什么裸调 API 很麻烦，下一节拆开讲。

### 要解决的问题

直接调一次 LLM 接口，你拿到的只是一段文本。要做出能用的助手，还得自己补齐这些部分：

- **聊天界面**：输入框、消息列表、打字态、错误提示；
- **流式渲染**：把模型逐字输出实时画到界面上；
- **状态共享**：把“当前页面有什么”告诉模型，让它的回答基于真实上下文；
- **函数调用**：让模型反过来改你的状态、发请求、跳转页面；
- **生成式 UI**：把模型返回的结构渲染成真实组件，而不是一段 Markdown；
- **人在回路**：遇到需要确认的步骤，让 Agent 暂停等用户拍板。

这些活儿和你的业务无关，却是每个 copilot 都绕不开的。CopilotKit 把它们打包好，你只声明“应用有哪些状态、有哪些可调用动作”，其余的交给框架。

### 心智模型

CopilotKit 分三段，各管一摊：

- **前端**：React 组件负责聊天 UI 和会话状态；
- **Runtime**：后端的一个 endpoint，负责和 LLM / Agent 通信、转发 tool 调用、做流式传输；
- **LLM / Agent 后端**：真正跑模型的引擎，OpenAI 或任意 AG-UI 兼容后端都行。

三段各自负责一块，协作关系如下：

```d2
reactApp: 你的 React 应用
provider: CopilotKit Provider
runtime: Copilot Runtime (API 路由)
backend: LLM / Agent 后端

reactApp -> provider: 1. 消息 + 应用状态
provider -> runtime: 2. HTTP 请求
runtime -> backend: 3. 模型调用 / 执行 tool
backend -> runtime: 4. 流式响应 (SSE)
runtime -> provider: 5. 转发流
provider -> reactApp: 6. 渲染回复 / 生成式 UI
```

一次对话的链路：用户在聊天界面输入 → Provider 带着应用状态发到 runtime → runtime 调用 LLM 并转发 tool 执行 → 响应以 SSE 流式回传 → Provider 渲染成文本或组件。

## 核心能力

- **聊天界面**：自带聊天、弹窗、侧边栏三种形态，样式能直接覆盖；
- **生成式 UI**：把应用状态共享给 Agent、让 Agent 能调用你的函数，回复直接渲染成真实组件；
- **后端 tool**：支持 Server Tools、MCP Server，让 Agent 能查库、写数据；
- **人在回路**：Agent 执行到需要确认的步骤时暂停，等用户决策后再继续；
- **后端可插拔**：默认就有 Built-in Agent 起步，也能接 LangGraph、Mastra、CrewAI、Claude Agent SDK 等任意 AG-UI 兼容后端。

## 核心概念

- **CopilotKit Provider**：用 `runtimeUrl` 指向后端 runtime，包裹整个应用并管理会话；
- **Copilot Runtime**：后端的 endpoint，把前端请求转给模型、转发 tool 并执行流式传输；
- **三个 UI 原语**：`CopilotChat`（聊天）、`CopilotPopup`（弹窗）、`CopilotSidebar`（侧边栏）；
- **两个 Hook**：`useCopilotReadable`（声明 Agent 能读到的状态）、`useCopilotAction`（声明 Agent 能调用的函数）。

:::tip 示例版本
示例基于 CopilotKit v2（import 路径带 `/v2`）。旧版本里 `CopilotChat` 等 UI 组件在 `@copilotkit/react-ui` 包，迁移时按项目实际版本对照官方说明。
:::

## 优势

和“自己从零写”或“裸调 API”相比，CopilotKit 的价值在这几处：

- **省掉通用件**：聊天 UI、流式渲染、状态同步、工具调用协议都不用自己造；
- **组件默认就能用**：样式和交互都齐了，要改也能按你的设计语言来；
- **生成式 UI 是原生支持**：模型返回的结构直接渲染成组件，不用自己拼 Markdown；
- **前端与后端解耦**：同一套前端能接不同 Agent 后端，换引擎不必动 UI；
- **AG-UI 标准化**：agent 与前端的通信走 AG-UI 协议，便于接社区生态（MCP、各类框架）。

## 快速入门

下面用 Next.js（App Router）走一遍，任意 React 前端都适用，已有项目可跳过创建步骤。完成后你会得到一个侧边栏聊天，能直接和模型对话。

### 准备工作

- **OpenAI API Key**：用于调用模型（也支持 Anthropic / Google，见官方 Model Selection）；
- **Node.js 20+**；
- **一个 React 或 Next.js 项目**。

### 安装依赖

```bash fold
npm install @copilotkit/react-core @copilotkit/react-ui @copilotkit/runtime
```

### 配置环境变量

```bash title=".env" fold
OPENAI_API_KEY=your_openai_api_key
```

### 配置 Copilot Runtime

新建一个 API 路由，用 `BuiltInAgent` + `CopilotRuntime` 起一个后端 endpoint。`BuiltInAgent` 是 CopilotKit 内置的 agent，不需要你再单独起一个 agent 服务，所以这一步就能直接跑通模型对话：

```ts title="app/api/copilotkit/route.ts" fold
import {
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { BuiltInAgent } from "@copilotkit/runtime/v2";
import { NextRequest } from "next/server";

const builtInAgent = new BuiltInAgent({
  model: "openai:gpt-5.4-mini",
});

const runtime = new CopilotRuntime({
  agents: { default: builtInAgent },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
```

`model` 写成 `<provider>:<model>`，换成你账号里可用的模型即可（见官方 Model Selection）。

### 包裹 CopilotKit Provider

在根布局里用 `CopilotKit` 包裹应用，并通过 `runtimeUrl` 指向上一步的 endpoint：

```tsx title="app/layout.tsx" fold
import { CopilotKit } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <CopilotKit runtimeUrl="/api/copilotkit">{children}</CopilotKit>
      </body>
    </html>
  );
}
```

### 添加聊天界面

在页面里放一个 `CopilotSidebar`，聊天 UI 就出现了：

```tsx title="app/page.tsx" fold
import { CopilotSidebar } from "@copilotkit/react-core/v2";

export default function Page() {
  return (
    <main>
      <h1>Your App</h1>
      <CopilotSidebar />
    </main>
  );
}
```

想要聊天而不是侧边栏，把 `CopilotSidebar` 换成 `CopilotChat` 即可。

### 启动

```bash fold
npm run dev
```

打开页面，在侧边栏里直接对话，模型会流式回复。到这一步，你已经有一个能用的对话 MVP。

如果连不上，优先检查 `.env` 里的 key 是否生效、`runtimeUrl` 是否与路由路径一致，必要时把 `localhost` 换成 `127.0.0.1`。

### 让 Agent 看到应用状态

光有对话，Agent 还不知道你的页面上有什么。用 `useCopilotReadable` 把状态共享给它，回答才能基于真实上下文：

```tsx title="app/page.tsx" fold
import { useCopilotReadable } from "@copilotkit/react-core/v2";
import { useState } from "react";

export default function Page() {
  const [todos, setTodos] = useState<string[]>([]);

  useCopilotReadable({
    description: "当前待办列表",
    value: todos,
  });

  return <main>{/* ... */}</main>;
}
```

### 让 Agent 调用你的函数

用 `useCopilotAction` 注册 Agent 可调用的方法，比如“加一条待办”：

```tsx title="app/page.tsx" fold
import { useCopilotAction } from "@copilotkit/react-core/v2";

export default function Page() {
  const [todos, setTodos] = useState<string[]>([]);

  useCopilotAction({
    name: "addTodo",
    description: "新增一条待办",
    parameters: [
      { name: "text", type: "string", description: "待办内容", required: true },
    ],
    handler: ({ text }) => {
      setTodos((prev) => [...prev, text]);
    },
  });

  return <main>{/* ... */}</main>;
}
```

声明之后，用户说“加一条：买牛奶”，Agent 会自己调用 `addTodo` 并更新界面。到这一步，对话、读状态、改应用三件事都跑通了。后端工具怎么注册，见下一节「在后端注册工具」。

## 在后端注册工具

前端 action 跑在浏览器里，适合直接改 UI 状态。需要查数据库、调内部接口、做服务端鉴权时，把 tool 注册在后端更合适。对 Agent 来说，后端 tool 和前端 action 没有区别，都是可调用函数，只差执行位置。

文章用的是 Built-in Agent，后端 tool 直接挂在 `BuiltInAgent` 上，前端代码不用动。

### 用 defineTool 注册 Server Tool

`defineTool` 来自 `@copilotkit/runtime/v2`，用 zod 描述参数，逻辑写在 `execute`：

```ts title="app/api/copilotkit/route.ts" fold
import { BuiltInAgent, defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";

const getWeather = defineTool({
  name: "getWeather",
  description: "查询某城市的当前天气",
  parameters: z.object({
    city: z.string().describe("城市名"),
  }),
  execute: async ({ city }) => {
    const res = await fetch(`https://api.weather.example?city=${city}`);
    return res.json();
  },
});

const builtInAgent = new BuiltInAgent({
  model: "openai:gpt-5.4-mini",
  tools: [getWeather],
});
```

`defineTool` 需要 zod，先装好：`npm install zod`。把这段合并进「配置 Copilot Runtime」的 route 文件后，用户问“北京天气怎么样”，Agent 会调用 `getWeather`，代码在服务端执行，结果回传前端渲染。

### 接入 MCP Server

不想自己写 tool，可以复用现成的 MCP server。在 `BuiltInAgent` 上配 `mcpServers`，支持 `sse` 和 `http` 两种传输：

```ts title="app/api/copilotkit/route.ts" fold
const builtInAgent = new BuiltInAgent({
  model: "openai:gpt-5.4-mini",
  mcpServers: [
    { type: "sse", url: "https://my-mcp-server.example.com/sse" },
  ],
});
```

`tools` 和 `mcpServers` 能一起用，Agent 同时看到两类 tool。需要鉴权时，给对应 server 加 `headers` 字段即可。

## 总结

到这，你已经从零搭出一个能对话、能读状态、能调函数、还能伸到后端的 Copilot MVP。Agent 能读你的应用状态、调用你的函数、复用后端的 tool 与 MCP，把它接进实际业务，就能从陪聊走向真正操作应用。
