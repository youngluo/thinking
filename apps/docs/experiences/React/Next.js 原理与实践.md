---
createdAt: '2026-07-12 11:08'
draft: true
---

# Next.js 原理与实践

Next.js 解决的不是「让 React 跑在 Node.js」这么简单，而是协调服务端渲染与客户端接管：服务端生成首屏 HTML 和 RSC payload，浏览器解析这些结果，再让 Client Component 接管已有 DOM、恢复事件与响应式状态。

这条双端协作的链路在 App Router 下被进一步收紧：

1. 默认所有页面都是 React Server Component，HTML 在构建期或请求期生成；
2. 需要交互的部分通过 `'use client'` 显式划入客户端；
3. 服务端与客户端的边界由打包器在编译期确定，RSC payload 描述服务端树，客户端 bundle 描述需要 hydrate 的部分；
4. Streaming 把 HTML 按 Suspense 边界分段写出，浏览器边收边渲染；
5. Cache Components 默认开启 Partial Prerendering，静态壳与动态片段在同一文档中合成。

本文以 Next.js 16 与 React 19 为基础，重点讲这条链路如何实现，以及路由 × 组件两维度如何选择渲染模式与组件边界。

## RSC 与 SSR 基础链路

### RSC 渲染与 HTML 预渲染

App Router 的服务端渲染包含两个相互衔接的阶段：

1. React 执行匹配路由的 Server Component，将渲染结果编码为 RSC payload；
2. Next.js 使用 RSC payload 和 Client Component 代码预渲染 HTML，供浏览器直接显示首屏。

RSC 渲染负责描述组件结构、数据和客户端模块边界，HTML 预渲染负责生成浏览器可直接展示的内容。Client Component 会参与 HTML 预渲染，但其中的事件、状态和 Effect 要等浏览器完成 hydration 后才会生效。

```d2 maxHeight=480
shape: sequence_diagram

browser: 浏览器
next: Next.js
rsc: React Server
ssr: React DOM Server

browser -> next: 请求 URL
next -> rsc: 执行 Server Component
rsc -> next: 生成 RSC payload
next -> ssr: 结合 Client Component 预渲染
ssr -> next: 生成 HTML
next -> browser: 返回包含 HTML 与 RSC chunk 的响应
```

RSC payload 是供 React 消费的数据格式，主要包含：

- Server Component 的渲染结果；
- Client Component 的模块引用和渲染位置；
- 传给 Client Component 的可序列化 props；
- Suspense、异步数据和错误等信息。

### 首次响应如何携带两份产物

首次访问时，HTML 和 RSC payload 通常通过同一个 `text/html` 响应返回。HTML 作为普通标签写入响应，RSC payload 则被拆成 chunk，通过内联脚本写入 Next.js 的客户端数据队列。它们可以随着服务端渲染进度交错到达。

```html
<article>
  <h1>Next.js 渲染原理</h1>
  <button>0 likes</button>
</article>

<script>
  self.__next_f.push([1, '...RSC chunk...'])
</script>
```

浏览器的 HTML Parser 会把普通标签解析成 DOM，同时执行这些内联脚本，将 RSC chunk 交给 Next.js 客户端运行时。`self.__next_f` 是 Next.js 当前使用的传输实现，不属于 RSC 协议本身。

后续客户端导航不需要重新获取完整 HTML 文档。Next.js 请求目标路由的 RSC payload，再把新的路由段合并到已有组件树中。

### HTML 与 RSC payload 如何对应

考虑一棵典型组件树：

```tsx fold title="app/article/[id]/page.tsx"
import { LikeButton } from './like-button'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const article = await getArticle(id)

  return (
    <article>
      <h1>{article.title}</h1>
      <p>{article.body}</p>
      <LikeButton count={article.likes} />
    </article>
  )
}
```

```tsx fold title="app/article/[id]/like-button.tsx"
'use client'

import { useState } from 'react'

export function LikeButton({ count }: { count: number }) {
  const [likes, setLikes] = useState(count)
  return <button onClick={() => setLikes(likes + 1)}>{likes} likes</button>
}
```

`Page` 在服务端执行并获取文章数据。RSC payload 记录它的渲染结果，同时保存 `LikeButton` 的模块引用和 `count`。HTML 中则包含文章内容和预渲染后的按钮，浏览器收到后可以立即显示。

两份产物描述的是同一份界面，因此内容存在对应关系，但用途和格式不同：HTML 面向浏览器渲染，RSC payload 面向 React。浏览器不会重新执行 `Page`，而是使用它已经返回的渲染结果；`LikeButton` 的客户端 JavaScript 加载后，才会执行组件函数并接管已有按钮。

### 嵌套布局如何进入 RSC payload

一个 URL 通常会同时匹配页面和多层布局。以 `/blog/hello` 为例，`RootLayout`、`AppLayout`、`BlogLayout` 和 `BlogPage` 会依次嵌套。初始渲染时，这些路由段的 Server Component 结果会编码进当前路由的 RSC payload。

后续客户端导航会复用已经加载的共享布局，再将新获取的路由段数据合并到现有组件树中。

## Hydration

Hydration 是 React 复用服务端 HTML，并为 Client Component 恢复交互能力的过程。RSC payload 本身只是数据，不具备交互能力；React 事件、客户端状态、Effect 和浏览器 API 都来自 Client Component 的 JavaScript。链接、表单和 `<details>` 等原生 HTML 行为不依赖 hydration。

### 初始 Hydration 过程

初次加载时，HTML 解析与 RSC 数据解析可以并行推进，最终在 React Reconciler 中汇合：

```d2
direction: down

response: 接收 HTML 响应
html: HTML Parser 解析标签
dom: 生成 DOM 并显示页面
flight: React Flight 解析 RSC chunk
elements: 得到 React element、数据与模块引用
modules: 加载 Client Component JavaScript
fiber: Reconciler 创建 Fiber 树
hydrate: Host Fiber 认领已有 DOM
commit: 绑定事件与 ref，执行 Effect

response -> html -> dom
response -> flight -> elements
elements -> modules -> fiber
elements -> fiber
dom -> hydrate
fiber -> hydrate -> commit
```

1. **显示 HTML**。浏览器解析已经到达的 HTML，生成 DOM 并显示页面。这一步不需要等待 Client Component JavaScript。
2. **解析 RSC payload**。React Flight 按 ID 登记并反序列化 RSC chunk，得到 React element、普通数据和 Client Component 模块引用。引用的 chunk 尚未到达时，React 会保留待处理依赖，并由 Suspense 显示 fallback。
3. **加载客户端模块**。Next.js 根据模块引用加载 Client Component JavaScript。模块就绪后，组件类型与 payload 中的 props 组成 Client Component element。
4. **创建 Fiber**。Next.js 调用 React 的 hydration 入口后，Reconciler 根据这些 element 创建 Fiber。RSC payload 不直接包含 Fiber，Fiber 是 React 在协调阶段生成的运行时数据结构。
5. **复用 DOM**。Reconciler 遍历 Fiber 时，只有 Host Component 和文本对应实际 DOM。React 维护下一个可复用 DOM 节点的位置，并按 Fiber 顺序检查节点类型及相关内容；匹配成功后，将 Fiber 关联到已有节点，而不是重新创建节点。
6. **提交交互**。Client Component 首次渲染结果与已有 DOM 对齐后，React 绑定事件和 ref，并按时机执行 Effect。此后状态更新进入正常的客户端渲染流程。

底层 hydration 由 React 的 `hydrateRoot` 完成，Next.js 会自动创建客户端入口，应用代码通常不需要直接调用它。

### Fiber 如何复用 DOM 并恢复交互

Reconciler 会统一创建客户端 Fiber 树，但不同节点的来源并不相同。Server Component 函数已经在服务端执行，不会出现在客户端 Fiber 树中；它返回的 React element 会生成 Host Component、文本等 Fiber。Client Component 的模块引用解析完成后会生成组件 Fiber，浏览器执行组件函数，再为其返回结果继续创建 Fiber。

只有 Host Component 和文本 Fiber 对应实际 DOM。React 不使用节点 ID 建立对应关系，而是让 Fiber 的深度优先遍历顺序与 DOM 的文档顺序同步推进。[内部通过两个游标维护当前位置](https://github.com/react/react/blob/main/packages/react-reconciler/src/ReactFiberHydrationContext.js#L78-L82)：`hydrationParentFiber` 记录当前父 Fiber，`nextHydratableInstance` 指向下一个可以认领的 DOM 节点。

1. 进入 hydration 时，`nextHydratableInstance` 指向根容器中的第一个可复用节点；
2. 遇到 Host Component 时，React 检查候选 DOM 的节点类型、标签名和相关内容。匹配成功后执行类似 `fiber.stateNode = instance` 的关联，再进入该 DOM 的第一个子节点；
3. 遇到组件 Fiber 或 Fragment 时，由于它们没有自己的 DOM，游标不会移动。React 继续处理其返回的 Host Fiber；
4. 一个 Host Fiber 的子树完成后，游标移到下一个可复用兄弟节点。节点类型、文本或树结构无法对应时，React 会报告 hydration mismatch，并在相应边界改用客户端渲染。

以 `LikeButton` 为例，RSC payload 只提供客户端模块引用和可序列化的 `count`。浏览器加载并执行组件后，才会重新建立交互所需的信息：

| 信息            | 来源                                | Hydration 时的处理                |
| --------------- | ----------------------------------- | --------------------------------- |
| `useState`      | 执行 Client Component 时调用 Hook   | 保存到组件 Fiber 的 Hook 链表     |
| `useEffect`     | 执行 Client Component 时注册 Effect | 保存到组件 Fiber，提交后执行      |
| `ref`           | Client Component 返回的 element     | 提交阶段关联到对应 DOM            |
| `onClick` 等事件 | Host element 的 props                | 保存为 Host Fiber 对应的当前 props |

React 通常在根容器统一监听浏览器事件。事件触发后，React 根据目标 DOM 找到对应 Fiber，再从当前 props 中读取并调用处理函数。因此，交互能力不是从 HTML 中推断出来的，也不是由 RSC payload 直接恢复的，而是浏览器执行 Client Component 后重新建立的。Server Component 返回的 Host element 同样会认领 DOM，但没有客户端 Hook、Effect 和事件函数时，只需完成结构对齐。

### Streaming 与 Suspense

没有 Streaming 时，服务端需要等整棵页面树渲染完成，再一次性发送结果。只要其中一处数据较慢，浏览器就无法提前看到其他已经完成的内容。

Streaming 允许服务端边渲染边发送结果。Suspense 边界负责划分流式输出的范围：边界内的内容尚未完成时，Next.js 先发送边界外的 HTML 和 fallback，这部分构成可立即显示的 HTML 壳；内容完成后，再把对应的 HTML 与 RSC 数据发送给浏览器。

```tsx fold title="app/page.tsx"
import { Suspense } from 'react'

export default function Page() {
  return (
    <>
      <h1>博客</h1>
      <Suspense fallback={<p>正在加载...</p>}>
        <PostList />
      </Suspense>
    </>
  )
}
```

```d2
shape: sequence_diagram

server: 服务端
browser: 浏览器
react: React

server -> browser: 发送 HTML 壳与 fallback
browser -> browser: 显示已到达的内容
server -> browser: 发送已完成边界的 HTML 与 RSC 数据
browser -> react: 解析新到达的边界数据
react -> browser: 用完整内容替换 fallback
```

Streaming 决定内容何时到达浏览器，hydration 决定 Client Component 何时具备交互能力。某个 Suspense 边界可以已经显示，但仍在等待对应的客户端 JavaScript 完成 hydration。

`loading.tsx` 会成为自动 Suspense 边界的 fallback。该边界覆盖同段的 `page.tsx` 及其子级，但不覆盖同段的 `layout.tsx`。如果 `layout.tsx` 读取 `cookies()`、`headers()` 或未缓存数据，导航会等到布局完成。可以把读取下移到 `page.tsx`，或拆到由 `<Suspense>` 包裹的子组件中。

### 选择性 Hydration

Streaming 让 Suspense 边界可以独立完成 hydration。用户与尚未 hydrate 的边界交互时，React 会提高该边界的优先级，使相关 Client Component 尽快可用。页面不必等待所有客户端 JavaScript 就绪后再开始 hydration。

### Hydration mismatch

Hydration 期间，React 预期的 Host Component 和文本必须与服务端 HTML 生成的 DOM 一致，否则会出现 hydration mismatch。React 可以从部分错误中恢复，但修复过程可能增加开销并造成界面闪烁。

常见原因：

- 根据 `window`、`document` 或 `localStorage` 条件渲染不同内容；
- 模板中使用 `Math.random()`、当前时间等非确定值；
- 服务端和浏览器的时区、语言环境不同；
- HTML 标签嵌套非法，被浏览器解析器自动修正；
- 服务端与客户端拿到不同的数据或初始状态；
- 根据视口宽度直接决定首次渲染结构。

需要浏览器环境的逻辑应放进 `useEffect`：

```tsx fold title="components/viewport-width.tsx"
'use client'

import { useEffect, useState } from 'react'

export function ViewportWidth() {
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    setWidth(window.innerWidth)
  }, [])

  return <p>{width === null ? '正在读取视口信息' : `视口宽度：${width}`}</p>
}
```

对于明确且不可避免的差异（如时间戳），可以使用 `suppressHydrationWarning`：

```tsx fold
<time dateTime={post.publishedAt} suppressHydrationWarning>
  {new Date(post.publishedAt).toLocaleString()}
</time>
```

`suppressHydrationWarning` 只作用于当前元素的一层内容，也不会修正不一致的文本。它适合处理少量无法避免的差异，不能替代一致的初始数据和渲染逻辑。

## Server Component 与 Client Component 边界

### 执行环境

Server Component 可以在构建期或请求期执行，但不会进入浏览器。它可以使用 `async` / `await` 获取数据，不能使用客户端状态、副作用、事件处理器或浏览器 API。

Client Component 会参与初始 HTML 的服务端预渲染，再在浏览器中完成 hydration。`useEffect`、`useLayoutEffect` 和浏览器 API 只能在客户端使用；首次渲染依赖的数据必须在服务端与浏览器之间保持一致。

### 两份构建产物

Next.js 一次构建会产出两类 bundle：

- Server bundle：路由处理、Server Component 渲染、Server Actions、`route.ts` API；
- Client bundle：Client Component、Hydration 入口、Client manifest。

服务端运行时只会加载 Server bundle；浏览器只会加载 Client bundle。两者通过 RSC payload 与 manifest 在请求期间协商哪些组件在客户端执行。

### 三类边界

App Router 下组件分三类：

| 类型                               | 服务端生成 HTML | 进入客户端 bundle | Hydration | 典型用途                     |
| ---------------------------------- | --------------- | ----------------- | --------- | ---------------------------- |
| Server Component（默认）           | 是              | 否                | 否        | 数据获取、静态结构、SEO 内容 |
| Client Component（`'use client'`） | 是              | 是                | 是        | 交互、状态、浏览器 API       |
| 共享组件（仅 props 透传）          | 是              | 是                | 否        | 跨边界复用                   |

`'use client'` 是模块图边界。一旦某个文件标记了 `'use client'`，它和它直接 import 的所有模块都会进入客户端 bundle；它接收的 props 可以来自 Server Component，但这些 props 会被序列化进 RSC payload。

### 划定原则

把 `'use client'` 写在尽量靠近叶子的位置：

```tsx
// app/layout.tsx — Server Component
import { SearchBar } from './search-bar'

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <nav>
          <Logo />
          <SearchBar />
        </nav>
        {children}
      </body>
    </html>
  )
}
```

```tsx
// app/search-bar.tsx — Client Component
'use client'

import { useState } from 'react'

export function SearchBar() {
  const [keyword, setKeyword] = useState('')
  return <input value={keyword} onChange={(e) => setKeyword(e.target.value)} />
}
```

`Layout` 保持为 Server Component；只有交互需要的 `SearchBar` 单独包成 Client Component。如果整棵 layout 都标了 `'use client'`，整页都将走客户端 bundle，首屏 HTML 不再立即可读。

### Client Component 的能力限制

Client Component 不能：

- `await`（不能直接做异步数据获取）；
- 直接读 `cookies()` / `headers()` / `searchParams`；
- import Server-only 模块；
- 在服务端执行浏览器 API。

当 Server Component 需要给 Client Component 提供来自请求上下文的数据，应该在 Server Component 读取后再通过 props 传入：

```tsx
import { cookies } from 'next/headers'
import { ThemeIndicator } from './theme-indicator'

export default async function Page() {
  const theme = (await cookies()).get('theme')?.value ?? 'light'
  return <ThemeIndicator theme={theme} />
}
```

```tsx
'use client'

export function ThemeIndicator({ theme }: { theme: string }) {
  return <p>当前主题：{theme}</p>
}
```

### Server-only / Client-only 模块

`server-only` 与 `client-only` 是编译期保护：

```ts
// lib/db.ts
import 'server-only'

import { Pool } from 'pg'

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
})
```

如果 Client Component 不小心 import 了 `lib/db.ts`，构建会失败并提示明确的错误信息。

### 第三方客户端库

未自带 `'use client'` 的第三方组件（如老的富文本、图表）需要在你的项目里包一层：

```tsx
'use client'

import { Carousel } from 'acme-carousel'

export default Carousel
```

包好之后就可以在 Server Component 中正常 import 使用。

### 客户端独占组件

强依赖 `window`、`document` 等环境且无法服务端降级的组件，应该通过 `next/dynamic` 的 `ssr: false` 隔离：

```tsx
'use client'

import dynamic from 'next/dynamic'

const Editor = dynamic(() => import('./editor'), { ssr: false })

export function ArticleEditor() {
  return <Editor />
}
```

注意 `next/dynamic` 的 `ssr: false` 只能用在 Client Component 中；`ssr: false` 表示该组件不参与 SSR，浏览器需要 JS 加载完成后才能渲染它。强依赖浏览器环境的部分应当尽量隔离，而不是把整页都关闭 SSR。

## 渲染模式

Next.js 16 默认开启 Cache Components，覆盖 **SSG / ISR / SSR / CSR** 四类渲染行为。理解渲染模式的关键是看一段代码在服务端**什么时刻**被调用——构建期、缓存期还是请求期，组件按其使用的 API 自动归到对应类别。

### 三类渲染时机

| 渲染时机        | 何时执行                                  | 数据来源                                                      | 失效方式                            |
| --------------- | ----------------------------------------- | ------------------------------------------------------------- | ----------------------------------- |
| 静态（Static）  | 构建期                                    | 编译时已确定的输入                                            | 重新构建部署                        |
| 缓存（Cached）  | 构建期或首次请求，缓存到 `cacheLife` 过期 | 任意 async 工作                                               | 时间过期 / `revalidateTag` 主动失效 |
| 动态（Dynamic） | 每次请求                                  | `cookies()` / `headers()` / `searchParams` / 未缓存的 `fetch` | 不缓存                              |

PPR（Partial Prerendering）是 Cache Components 的默认行为：构建期生成静态壳，请求期把动态片段按 Suspense 边界流式拼到同一份响应里。「PPR 模式」不是一个独立选项，而是这套机制的默认运行方式。

行为与传统术语的对应：

- **静态 → SSG**（Static Site Generation）：构建期生成 HTML，失效靠重新构建部署
- **缓存 → ISR**（Incremental Static Regeneration）：构建期或首次请求生成，按 `cacheLife` 时间过期或 `revalidateTag` 主动失效
- **动态 → SSR**（Server-Side Rendering）：每次请求服务端渲染，不缓存
- **CSR**（Client-Side Rendering）：服务端不输出 HTML 内容，纯浏览器渲染，由 `'use client'` + `dynamic({ ssr: false })` 或 `ssr: false` 配置开启，不在服务端执行所以也不在这三类里

### 渲染时机由 API 决定

不需要任何配置声明，组件实际使用的 API 决定它落在哪类时机：

```ts
// 静态：只 await 编译期可确定的输入（同步 I/O、模块导入、纯计算）
import config from './config.json'
export default async function Page() {
  return <h1>{config.title}</h1>
}

// 缓存：使用 use cache 标记，结果按 cacheLife 缓存
import { cacheLife } from 'next/cache'
export async function getProducts() {
  'use cache'
  cacheLife('hours')
  return db.products.findAll()
}

// 动态：使用 runtime API
import { cookies } from 'next/headers'
export default async function Page() {
  const theme = (await cookies()).get('theme')?.value ?? 'light'
  return <p>主题：{theme}</p>
}
```

混合模式在同一个路由下是常态：静态与动态片段共存，靠 `<Suspense>` 隔离。

### 在静态页面中嵌入动态片段

要把用户态嵌进本来静态的路由，用 `<Suspense>` 把动态部分包起来：

```tsx
import { Suspense } from 'react'
import { cookies } from 'next/headers'

export default function Page() {
  return (
    <>
      <h1>博客</h1>
      <Suspense fallback={<p>正在读取主题...</p>}>
        <ThemeDisplay />
      </Suspense>
    </>
  )
}

async function ThemeDisplay() {
  const theme = (await cookies()).get('theme')?.value ?? 'light'
  return <p>当前主题：{theme}</p>
}
```

`<ThemeDisplay>` 是动态片段，按 Suspense 边界流式到达。静态壳先发出，浏览器立即画出 header 等结构，主题等用户态后补。

### 强制推迟到请求期

如果某段代码无法在构建期完成，但又不希望走 `use cache` 缓存（如每次请求都要重新生成的非确定值），用 `connection()` 显式推迟：

```tsx
import { connection } from 'next/server'
import { Suspense } from 'react'

async function RandomId() {
  await connection()
  return <p>{crypto.randomUUID()}</p>
}

export default function Page() {
  return (
    <Suspense fallback={<p>...</p>}>
      <RandomId />
    </Suspense>
  )
}
```

`connection()` 让 React 推迟到请求期再执行这段组件，但不缓存结果——等价于强制走「Dynamic」但与直接读 `cookies()` 不同的是它不依赖 request context。

### `generateStaticParams` 预渲染动态路由

构建期可枚举的动态路由用 `generateStaticParams` 列出样本参数，让它们走构建期 prerender：

```tsx
export async function generateStaticParams() {
  const posts = await fetch('https://api.example.com/posts').then((r) => r.json())
  return posts.map((post) => ({ slug: post.slug }))
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getPost(slug)
  return <article>{post.title}</article>
}
```

`generateStaticParams` 返回的样本走构建期；运行时收到未在样本中的参数时按动态路径处理。

### 路由段配置

`page.tsx` / `layout.tsx` 等文件里可以导出的少量路由级配置。这些选项主要与部署和动态参数控制相关，不影响渲染时机：

| 配置              | 用途                                                           |
| ----------------- | -------------------------------------------------------------- |
| `dynamicParams`   | 控制 `generateStaticParams` 未覆盖的动态参数是否允许运行时渲染 |
| `runtime`         | 选择 `'nodejs'` 或 `'edge'` 运行时                             |
| `preferredRegion` | 提示首选部署区域                                               |
| `maxDuration`     | Server Action / Route Handler 的最长执行时间                   |

渲染时机本身不再需要额外声明，由组件使用的 API 决定。

## 数据获取与缓存

### Server Component 原生 `await`

Server Component 是 async 函数，可以直接 await 数据源：

```tsx
export default async function Page() {
  const res = await fetch('https://api.example.com/posts')
  const posts = await res.json()
  return (
    <ul>
      {posts.map((p) => (
        <li key={p.id}>{p.title}</li>
      ))}
    </ul>
  )
}
```

需要注意：Next.js 16 中 `fetch` 默认不再缓存。每个请求都会重新发起，除非使用 `use cache` 或其他缓存 API。

请求内自动去重仍然生效：同一棵 RSC 树内对相同 URL 与相同 fetch options 的多次调用只会发一次请求。跨请求共享需要显式使用 `use cache`。

### `use cache` 指令

`use cache` 标记函数或组件的输出可缓存。它可以放在文件、组件或函数顶部：

```tsx
import { cacheLife, cacheTag } from 'next/cache'

export async function getProducts() {
  'use cache'
  cacheLife('hours')
  cacheTag('products')

  const res = await fetch('https://api.example.com/products')
  return res.json()
}
```

`cacheLife('hours')` 使用内置的 `hours` 缓存档位（client stale 5min、server revalidate 15min）。`cacheTag('products')` 给该缓存打上标签，便于按标签失效。

启用方式：

```ts
// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  cacheComponents: true,
}

export default nextConfig
```

### `cacheLife` 与内置档位

```ts
import { cacheLife } from 'next/cache'

export async function getProducts() {
  'use cache'
  cacheLife('hours')
  // ...
}
```

`cacheLife` 接受字符串档位或自定义对象。Next.js 默认提供 `default`、`minutes`、`hours`、`days`、`weeks`、`max` 等档位，每个档位对应 client `stale`、server `revalidate`、`expire` 三个时间。

### `cacheTag` 与失效

```ts
import { cacheTag, updateTag } from 'next/cache'

export async function getProducts() {
  'use cache'
  cacheTag('products')
  return fetch('https://api.example.com/products').then((r) => r.json())
}
```

```ts
'use server'

import { updateTag } from 'next/cache'

export async function createProduct(formData: FormData) {
  await db.products.create({ data: parseFormData(formData) })
  updateTag('products')
}
```

`updateTag` 让当前请求立刻看到最新数据，并使所有持有 `products` 标签的缓存失效。`revalidateTag` 类似但不会立即重渲染当前路由。

### 运行时数据与 `use cache` 的边界

`use cache` 函数内不能直接调用 `cookies()` / `headers()` / `searchParams`。需要这些值时，在缓存边界外读取并作为参数传入：

```tsx
import { cookies } from 'next/headers'
import { Suspense } from 'react'

export default function Page() {
  return (
    <Suspense fallback={<p>...</p>}>
      <Profile />
    </Suspense>
  )
}

async function Profile() {
  const sessionId = (await cookies()).get('session')?.value
  return <CachedProfile sessionId={sessionId} />
}

async function CachedProfile({ sessionId }: { sessionId: string }) {
  'use cache'
  return fetchUser(sessionId)
}
```

`sessionId` 进入 cache key，不同 session 各自缓存一份。`cookies()` 的调用位于缓存边界外，由 `<Suspense>` 隔离其请求期执行。

### `use cache: remote`

服务端默认 in-memory cache 在 serverless 下不会跨请求持久。`use cache: remote` 让平台提供持久缓存（如 Redis）：

```ts
export async function getProducts() {
  'use cache: remote'
  cacheLife('hours')
  return fetch('https://api.example.com/products').then((r) => r.json())
}
```

这通常意味着额外的网络往返与平台费用，适合高价值缓存。

### 请求隔离与作用域

浏览器应用只服务当前用户，可以使用模块级单例状态；Next.js 服务端会连续处理多个用户请求，但模块只初始化一次。

下面的状态会被所有请求共享：

```ts
let requestCount = 0

export async function GET() {
  requestCount += 1
  return Response.json({ requestCount })
}
```

请求 A 写入 `requestCount = 1`，请求 B 会读到 `requestCount = 2`。任何写用户相关可变数据的模块级变量都会跨请求污染。

Next.js 提供了三层显式作用域：

- React `cache()`：同一次请求内对同一函数调用的结果去重；
- `use cache` 指令：跨请求缓存函数或组件的输出（需要 `cacheComponents: true`）；
- `unstable_cache`：跨请求缓存任意异步逻辑（兼容旧版项目）。

请求内多个组件需要同一份数据时，使用 React `cache`：

```ts
import { cache } from 'react'

export const getUser = cache(async () => {
  const res = await fetch('https://api.example.com/user')
  return res.json()
})
```

`cache` 是请求作用域：同一次请求多次调用复用结果；不同请求之间不共享。

## Server Actions

### 定义与调用

Server Action 是带 `'use server'` 指令的 async 函数，可以在服务端执行并通过 RPC 从客户端调用：

```ts
// app/actions.ts
'use server'

import { revalidatePath } from 'next/cache'

export async function createPost(formData: FormData) {
  const title = formData.get('title') as string
  const content = formData.get('content') as string

  await db.posts.create({ data: { title, content } })
  revalidatePath('/posts')
}
```

在表单中调用：

```tsx
import { createPost } from './actions'

export default function Page() {
  return (
    <form action={createPost}>
      <input name="title" />
      <textarea name="content" />
      <button type="submit">发布</button>
    </form>
  )
}
```

表单提交会走单次服务端往返：服务端执行 action、返回新的 RSC payload、客户端更新视图。Server Component 中的表单支持渐进增强，即使 JavaScript 还没加载，表单仍然可以提交。

### `useActionState` 与 pending 态

```tsx
'use client'

import { useActionState } from 'react'
import { createPost } from './actions'

export function NewPostForm() {
  const [state, action, pending] = useActionState(createPost, { ok: false })

  return (
    <form action={action}>
      <input name="title" required />
      <textarea name="content" required />
      <button type="submit" disabled={pending}>
        {pending ? '发布中...' : '发布'}
      </button>
      {state.ok && <p>已发布</p>}
    </form>
  )
}
```

`useActionState` 返回 `[state, action, pending]`，pending 在 action 执行期间为 true。

### 缓存与刷新

```d2
direction: right

form: 表单提交
sa: Server Action
db: 数据库
revalidate: revalidateTag / revalidatePath / updateTag
client: 客户端重渲染

form -> sa -> db
db -> revalidate -> client
```

Server Action 完成后调用 `revalidatePath` 或 `revalidateTag` 让相关缓存失效；`updateTag` 还能让当前路由立刻重渲染。`refresh` 仅刷新客户端路由缓存，不影响服务器缓存。

### 鉴权

Server Action 暴露为 HTTP POST，不能依赖 UI 隐藏来保护资源：

```ts
'use server'

import { auth } from '@/lib/auth'

export async function deletePost(formData: FormData) {
  const session = await auth()
  if (!session?.user) throw new Error('Unauthorized')

  const id = formData.get('id') as string
  await db.posts.delete({ where: { id } })
  revalidatePath('/posts')
}
```

每个 Server Action 都需要自行检查会话与权限。

### 局限性

- 只能通过 POST 调用，不能 GET；
- 客户端派发与等待是串行的，不适合并行触发；
- 不直接返回非可序列化值；
- 与 `<form>` 原生配合最好；事件处理器中调用应该用 `useTransition` 或 `useActionState` 处理 pending。

## 实践中的常见问题

### `'use client'` 写在顶层

整棵应用退化为 Client Component，服务端产出的 HTML 与客户端首次 render 的一致性靠 React 兜底，但首屏已经无法在 JavaScript 加载前完成有意义的展示。

解决：把 `'use client'` 下移到具体叶子组件，让 layout、page、数据获取保持 Server Component。

### 缓存了不该共享的内容

```tsx
// 错误：在 Server Component 中读 cookie 但被 use cache 标记
export async function Page() {
  'use cache'
  const theme = (await cookies()).get('theme')?.value
  return <p>{theme}</p>
}
```

`use cache` 内不能直接读 `cookies()`，即使能编译通过也会把所有用户的 `theme` 当成同一份缓存。

正确做法是把运行时数据作为参数传入缓存函数，或放在 `<Suspense>` 边界内按请求动态生成。

### `fetch` 默认不再缓存

Next.js 14 中 `fetch` 默认会被框架缓存；Next.js 16 默认不再缓存，每次请求都会重新发起。需要缓存时显式使用 `use cache`，否则可能忽略意图导致不必要的网络流量。

### 第三方库忘记包 Client 边界

未自带 `'use client'` 的库（如老的图表、富文本）在 Server Component 中直接使用会在编译期或运行期报错。解决办法是在项目里写一个 `'use client'` 的包装文件。

### RSC payload 过大

RSC payload 是响应体的一部分，浏览器需要下载、解析、保留。Server Component 中：

```tsx
export default async function Page() {
  const all = await db.query('SELECT * FROM large_table')
  return <Table rows={all} />
}
```

把整张表传给页面，payload 会迅速膨胀。常见做法：

- 服务端做聚合、分页后只传渲染需要的字段；
- 列表通过分页或滚动加载按需取；
- 大对象作为 Server Component 内部状态而非 props 透传。

### 把 SSR 当成性能保证

Cache Components 默认走 PPR，静态壳构建期生成，动态片段请求期到达：

- 静态壳足够快时，TTFB 主要由动态片段决定；
- 动态片段串行调用多个慢接口会让用户更晚看到完整内容；
- `<Suspense>` 只能解耦渲染时机，不能让数据本身变快；
- 监控 TTFB、LCP、INP、服务端错误率，再决定是否上 `use cache` 或调整缓存档位。

### Server Action 重复提交

按钮没有禁用态时，用户可能多次点击导致 action 重复执行：

```tsx
'use client'

import { useActionState } from 'react'

export function Form() {
  const [state, action, pending] = useActionState(action, null)
  return (
    <form action={action}>
      <button type="submit" disabled={pending}>
        {pending ? '提交中...' : '提交'}
      </button>
    </form>
  )
}
```

`pending` 是判断按钮 disabled 的标准信号。

### useEffect 中调用 Server Action

```tsx
'use client'

import { useEffect } from 'react'
import { recordView } from './actions'

export function ViewCount({ id }: { id: string }) {
  useEffect(() => {
    recordView(id)
  }, [id])
  return <span>{id}</span>
}
```

`useEffect` 在浏览器执行，会向服务端发起请求。如果只是记录浏览次数，建议用 Server Component 在服务端直接记录，避免客户端请求往返。

## 如何选择

### 路由维度

| 场景                       | 渲染模式                                                |
| -------------------------- | ------------------------------------------------------- |
| 内容构建期确定且可枚举     | Static（`generateStaticParams` 列出全部样本）           |
| 内容公共但会定期更新       | Cached（`use cache` + `cacheLife`）                     |
| 内容依赖请求身份或实时数据 | Dynamic（runtime API 或未缓存 fetch）                   |
| 公共壳 + 个性化片段        | PPR 默认（静态壳 + Suspense 隔离动态）                  |
| 不要求 SEO 的重交互后台    | 局部 CSR（`'use client'` 或 `dynamic({ ssr: false })`） |

### 组件维度

| 场景                                       | 组件类型                                                  |
| ------------------------------------------ | --------------------------------------------------------- |
| 数据获取、静态结构、SEO 内容               | Server Component（默认）                                  |
| 状态、事件处理、浏览器 API                 | Client Component（`'use client'`）                        |
| 强依赖 `window` / `document`，无服务端降级 | 隔离为 Client Component，必要时 `dynamic({ ssr: false })` |
| 表单与服务端变更                           | Server Action + `<form action>`                           |
| Provider、Context                          | 包成 Client Component 后在 Server Component 中透传        |

### 组合实践

常见页面：

- 营销页：Static（公开内容）+ 少量 Client 交互；
- 文章详情：Static 壳 + `use cache` 缓存文章内容；
- 商品列表：Cached（`cacheLife('hours')`）+ 用户态 Suspense 隔离；
- 个人中心：Dynamic（读 cookie / session）+ 表单用 Server Action；
- 后台：Client Component 为主 + Server Action 触发变更；
- 实时仪表盘：Dynamic + WebSocket 在 Client Component 中订阅。

最终选型分两步：先决定路由按什么时机生成 HTML，再决定组件在哪一侧执行。两者交叉后才是项目的实际表现。
