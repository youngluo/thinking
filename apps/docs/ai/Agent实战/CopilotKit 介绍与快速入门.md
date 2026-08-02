---
createdAt: '2026-08-03 16:26'
order: 10
draft: true
---

# CopilotKit 介绍与快速入门

CopilotKit 是一套面向 React 的开源框架，用来把 AI Agent 接进现有应用，而不是另做一个独立的聊天产品。它的定位是“agent 的前端栈”（the frontend stack for agents），聊天界面、生成式 UI、应用状态共享、人在回路（human-in-the-loop）都能在 React 里直接落地。

## 为什么不用裸 API

直接 `fetch` 调一次 LLM，你只拿到一段文本。要做一个能“操作你应用”的 copilot，剩下的大部分工作都得自己写：

- 聊天 UI 与流式渲染；
- 把应用当前状态（比如当前选中的订单、表单字段）喂给模型；
- 让模型反过来调用你的函数（改状态、发请求、跳转页面）；
- 把模型返回的结构渲染成真实组件，而不是一段 Markdown；
- 遇到需要用户确认的步骤，让 Agent 暂停等待。

CopilotKit 把这些通用件打包好，你只要声明“应用有哪些状态、有哪些可调用的动作”，剩下的交互、流式、协议细节交给它。

## 核心能力

- 聊天组件开箱即用：`CopilotChat` / `CopilotPopup` / `CopilotSidebar` 分别对应内嵌聊天、弹窗、侧边栏。
- 生成式 UI：用 `useCopilotReadable` 把应用状态共享给 Agent，用 `useCopilotAction` 注册 Agent 可调用的方法，Agent 的回复能直接渲染成 React 组件。
- 后端 tool：支持 Server Tools、MCP Server，让 Agent 拥有查库、写数据等后端能力。
- 人在回路：Agent 执行到需要确认的步骤时暂停，等用户决策后再继续。
- 后端可插拔：默认提供 Built-in Agent 快速起步，也能接 LangGraph、Mastra、CrewAI、Claude Agent SDK 等任意 AG-UI 兼容后端。

## 架构与数据流

CopilotKit 拆成前端和后端两段：前端负责 UI 与会话状态，后端是一个 runtime endpoint，负责和 LLM / Agent 通信、转发 tool 调用、做流式传输。

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

一次对话的完整链路：用户在聊天界面输入 → Provider 带着应用状态发到 runtime → runtime 调用 LLM 并转发 tool 执行 → 响应以 SSE 流式回传 → Provider 渲染成文本或组件。

## 关键概念

- `CopilotKit` Provider：用 `runtimeUrl` 指向后端 runtime，包裹整个应用并管理会话。
- `Copilot Runtime`：后端的一个 endpoint，对接 LLM / Agent、转发 tool、做流式传输。
- 三个 UI 原语：`CopilotChat`（内嵌）、`CopilotPopup`（弹窗）、`CopilotSidebar`（侧边栏）。
- 两个 Hook：`useCopilotReadable`（声明 Agent 能读到的状态）、`useCopilotAction`（声明 Agent 能调用的函数）。

> 示例基于 CopilotKit v2（import 路径带 `/v2`）。旧版本里 `CopilotChat` 等 UI 组件在 `@copilotkit/react-ui` 包，迁移时按项目实际版本对照官方说明。

## 快速入门

下面用 Next.js（App Router）搭一个最小可用的 agent。任意 React 前端都适用，已存在项目可跳过创建步骤。

### 1. 前置条件

- OpenAI API Key（也支持 Anthropic / Google，见官方 Model Selection）
- Node.js 20+
- 一个 React 或 Next.js 项目

### 2. 安装依赖

```bash
npm install @copilotkit/react-core @copilotkit/react-ui @copilotkit/runtime
```

### 3. 配置环境变量

```bash title=".env"
OPENAI_API_KEY=your_openai_api_key
```

### 4. 配置 Copilot Runtime

新建一个 API 路由，用 `BuiltInAgent` + `CopilotRuntime` 起一个后端 endpoint：

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

`model` 的格式是 `<provider>:<model>`（这里只是示例，按官方 Model Selection 选你想要的模型）。

### 5. 包裹 CopilotKit Provider

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

### 6. 添加聊天界面

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

### 7. 启动

```bash
npm run dev
```

打开页面，侧边栏里直接对话即可。如果连不上，优先检查 `.env` 里的 key 是否生效、`runtimeUrl` 是否与路由路径一致，必要时把 `localhost` 换成 `127.0.0.1`。

## 让 Agent 真正认识你的应用

基础聊天只用了模型本身的能力。要让 Agent 操作你的应用，靠两个 Hook。

`useCopilotReadable` 把状态共享给 Agent，让它知道“现在页面上有什么”：

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

`useCopilotAction` 注册 Agent 可调用的函数，比如“加一条待办”：

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

声明之后，用户说“加一条：买牛奶”，Agent 会自己调用 `addTodo` 并更新界面。后端能力（查库、写接口）同理，用 Server Tools / MCP 在 runtime 一侧注册即可。

## 下一步

- Server Tools：把后端能力做成 Agent 可调用的 tool。
- MCP Servers：接入 MCP server 扩展工具生态。
- Model Selection：切到 Anthropic、Google 或自定义模型。
- Frontend Tools：让 Agent 更细粒度地驱动你的 UI。
