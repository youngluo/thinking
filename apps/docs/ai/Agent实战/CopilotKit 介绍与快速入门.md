---
createdAt: '2026-08-03 16:26'
order: 10
draft: true
---

# CopilotKit 介绍与快速入门

## CopilotKit 是什么

CopilotKit 是一套面向 React 应用的开源框架，用于把 AI Agent 接入应用界面。官方将它定位为 Agent 的前端栈（the frontend stack for agents），提供聊天界面、生成式 UI、应用上下文、工具调用和人在回路等通用能力。

### 要解决的问题

直接调用 LLM API 只解决模型推理与输出，不会自动提供应用内的交互层。要做出能操作应用的助手，还需要补齐以下部分：

- **聊天界面**：输入框、消息列表、生成状态和错误提示；
- **流式渲染**：持续接收模型输出并更新界面；
- **应用上下文**：让 Agent 知道当前页面、用户和业务数据；
- **工具调用**：让 Agent 修改前端状态或调用后端服务；
- **生成式 UI**：把结构化结果渲染成 React 组件；
- **人在回路**：在关键操作前暂停，等待用户确认。

这些能力与具体业务关系不大，却是应用内 Agent 的共同基础。CopilotKit 负责连接界面、运行时和 Agent，你只需要声明应用提供的上下文与工具。

### 工作方式

CopilotKit 的主要链路分为三部分：

- **React 前端**：展示聊天界面，提供应用上下文和前端工具；
- **Copilot Runtime**：部署在服务端，负责认证、路由和事件转发；
- **Agent**：可以使用 Runtime 内置的 `BuiltInAgent`，也可以接入兼容 AG-UI 协议的外部 Agent。

使用 `BuiltInAgent` 时，Agent 由 Runtime 承载并直接调用模型。使用外部 Agent 时，Runtime 通过 AG-UI 协议转发消息、上下文、工具定义和流式事件。整体链路如下：

```d2
reactApp: React 应用
provider: CopilotKit Provider
runtime: Copilot Runtime
agent: Built-in Agent / AG-UI Agent
model: 模型服务

reactApp -> provider: 1. 消息 + 应用上下文 + 前端工具
provider -> runtime: 2. 发起请求
runtime -> agent: 3. 路由到 Agent
agent -> model: 4. 调用模型
model -> agent: 5. 返回文本或工具调用
agent -> runtime: 6. 输出 AG-UI 事件流
runtime -> provider: 7. 转发事件流
provider -> reactApp: 8. 更新界面或执行前端工具
```

工具的执行位置取决于注册方式。前端工具在浏览器中执行，Server Tool 和 MCP Tool 则由服务端 Agent 调用。

### 核心能力

- **预置聊天界面**：提供聊天、弹窗和侧边栏组件，并支持样式定制；
- **应用上下文**：把页面状态、用户信息等数据提供给 Agent；
- **工具与生成式 UI**：允许 Agent 调用前端或后端工具，并用 React 组件展示结构化结果；
- **人在回路**：执行关键操作前暂停，由用户确认后继续；
- **可插拔后端**：既能使用 Built-in Agent，也能接入 LangGraph、Mastra、CrewAI 等兼容 AG-UI 的 Agent 后端。

### 核心概念

- **CopilotKit Provider**：包裹 React 应用，通过 `runtimeUrl` 连接 Runtime，并向组件树提供会话能力；
- **Copilot Runtime**：部署在服务端的运行时，负责认证、Agent 路由和流式事件转发；
- **Built-in Agent**：CopilotKit 内置的 Agent，适合直接连接模型并快速搭建聊天与工具调用；
- **UI 组件**：`CopilotChat`、`CopilotPopup` 和 `CopilotSidebar` 分别提供聊天、弹窗和侧边栏形态；
- **前端 Hooks**：`useAgentContext` 向 Agent 提供只读上下文，`useFrontendTool` 注册可在浏览器中执行的工具。

:::tip 示例版本
CopilotKit v2 目前还不是包的默认入口。安装时使用不带版本后缀的包名，代码则需要显式从 `/v2` 子路径导入。本文的前端 API 来自 `@copilotkit/react-core/v2`，Runtime API 来自 `@copilotkit/runtime/v2`。旧版本的 UI 组件位于 `@copilotkit/react-ui`，迁移时需要对照官方说明调整导入路径和 Hooks。
:::

### 主要优势

与自行实现整套 Agent 交互相比，CopilotKit 的主要价值在于减少通用基础设施：

- **降低接入成本**：聊天 UI、流式事件、上下文和工具协议可以直接复用；
- **保留定制空间**：预置组件可以直接使用，也能按应用的设计语言调整；
- **统一前后端通信**：前端通过同一套 API 对接不同 Agent，降低更换后端实现的成本；
- **接入 AG-UI 生态**：兼容 AG-UI 协议的 Agent 后端可以复用同一套前端能力。

## 快速入门

下面使用 Next.js App Router 搭建一个侧边栏助手。完成基础对话后，再逐步让 Agent 读取页面状态并调用前端工具。

### 准备工作

- **OpenAI API Key**：用于调用模型，也可以改用 Anthropic 或 Google；
- **Node.js 20+**；
- **一个 Next.js 项目**。

### 安装依赖

```bash fold
npm install @copilotkit/react-core @copilotkit/react-ui @copilotkit/runtime zod
```

本文仍按官方 Quickstart 安装三个 CopilotKit 包。v2 的 Provider、Hooks 和 UI 组件从 `@copilotkit/react-core/v2` 导入，Zod 用于定义前端和后端工具的参数结构。

### 配置环境变量

```bash title=".env" fold
OPENAI_API_KEY=your_openai_api_key
```

API Key 只保存在服务端环境变量中，不要写入前端代码或提交到仓库。

### 配置 Copilot Runtime

新建一个全路径捕获 API 路由，用 `BuiltInAgent` 和 `CopilotRuntime` 创建后端 Runtime。`BuiltInAgent` 可以直接连接模型，不需要额外启动 Agent 服务：

```ts title="app/api/copilotkit/[...path]/route.ts" fold
import {
  BuiltInAgent,
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";

const runtime = new CopilotRuntime({
  agents: {
    default: new BuiltInAgent({
      model: "openai:gpt-5.4-mini",
    }),
  },
});

const handler = createCopilotRuntimeHandler({
  runtime,
  basePath: "/api/copilotkit",
});

export { handler as GET, handler as POST };
```

这里把 Agent 注册为 `default`，预置聊天组件会自动使用它。`model` 采用 `<provider>:<model>` 格式，可以替换成当前账号可用的模型。

### 包裹 CopilotKit Provider

在根布局中用 `CopilotKit` 包裹应用，并通过 `runtimeUrl` 指向上一步创建的 Runtime：

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
    <html lang="zh-CN">
      <body>
        <CopilotKit runtimeUrl="/api/copilotkit">{children}</CopilotKit>
      </body>
    </html>
  );
}
```

### 添加聊天界面

在页面中添加 `CopilotSidebar`，即可得到一个带开关按钮的侧边栏聊天界面：

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

如果需要常驻聊天区域或弹窗，可以分别改用 `CopilotChat` 或 `CopilotPopup`。

### 启动项目

```bash fold
npm run dev
```

打开页面后即可在侧边栏中对话，模型回复会通过 Runtime 以事件流返回。如果连接失败，优先检查 API Key 是否生效，以及 `runtimeUrl`、`basePath` 和 API 路由路径是否一致。

### 共享应用状态

基础对话跑通后，可以使用 `useAgentContext` 把页面状态作为只读上下文提供给 Agent。上下文会随 React 状态更新，但 Agent 不能直接修改它：

```tsx title="app/page.tsx" fold
"use client";

import { useAgentContext } from "@copilotkit/react-core/v2";
import { useState } from "react";

export default function Page() {
  const [todos] = useState<string[]>([]);

  useAgentContext({
    description: "当前待办列表",
    value: todos,
  });

  return <main>{todos.join("、")}</main>;
}
```

传入的 `value` 必须是可序列化数据。适合共享当前用户、页面信息、筛选条件和业务数据等上下文。

### 注册前端 Tool

如果需要让 Agent 修改页面状态，可以使用 `useFrontendTool` 注册在浏览器中执行的工具。下面的 `addTodo` 接收一段文本并更新待办列表：

```tsx title="app/page.tsx" fold
"use client";

import { useFrontendTool } from "@copilotkit/react-core/v2";
import { useState } from "react";
import { z } from "zod";

export default function Page() {
  const [todos, setTodos] = useState<string[]>([]);

  useFrontendTool({
    name: "addTodo",
    description: "新增一条待办",
    parameters: z.object({
      text: z.string().describe("待办内容"),
    }),
    handler: async ({ text }) => {
      setTodos((prev) => [...prev, text]);
      return "待办已添加";
    },
  });

  return <main>{todos.join("、")}</main>;
}
```

注册后，用户说“添加一条买牛奶”，Agent 就可以调用 `addTodo`。至此，对话、读取上下文和修改前端状态三条链路都已跑通。

## 注册后端工具

前端 Tool 在浏览器中执行，适合操作 React 状态和浏览器 API。查询数据库、调用内部服务或执行鉴权逻辑时，应把 Tool 注册在后端。

本文使用 Built-in Agent，因此 Server Tool 和 MCP Server 都配置在 `BuiltInAgent` 上，前端代码不需要改动。

### 注册 Server Tool

`defineTool` 使用 Zod 描述参数，并通过 `execute` 实现服务端逻辑。下面的示例注册了一个天气查询工具：

```ts title="app/api/copilotkit/[...path]/route.ts" fold
import { BuiltInAgent, defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";

const getWeather = defineTool({
  name: "getWeather",
  description: "查询某城市的当前天气",
  parameters: z.object({
    city: z.string().describe("城市名"),
  }),
  execute: async ({ city }) => {
    const url = `https://api.weather.example?city=${encodeURIComponent(city)}`;
    const response = await fetch(url);

    return response.json();
  },
});

const builtInAgent = new BuiltInAgent({
  model: "openai:gpt-5.4-mini",
  tools: [getWeather],
});
```

把 `getWeather` 和 `tools` 配置合并到前面的 Runtime 路由中，Agent 就能调用该工具。示例中的天气地址仅用于展示调用方式，实际项目需要替换为真实接口，并在服务端处理鉴权与异常响应。

### 接入 MCP Server

如果已有 MCP Server，可以通过 `mcpServers` 直接向 Built-in Agent 提供工具。CopilotKit 支持 SSE 和 Streamable HTTP 传输：

```ts title="app/api/copilotkit/[...path]/route.ts" fold
const builtInAgent = new BuiltInAgent({
  model: "openai:gpt-5.4-mini",
  mcpServers: [
    { type: "sse", url: "https://my-mcp-server.example.com/sse" },
    { type: "http", url: "https://my-mcp-server.example.com/mcp" },
  ],
});
```

`tools` 和 `mcpServers` 可以同时使用，Agent 会同时获得两类工具。MCP Server 需要鉴权时，可以在对应配置中添加 `headers`，敏感凭证仍应从服务端环境变量读取。
