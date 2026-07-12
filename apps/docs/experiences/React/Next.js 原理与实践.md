---
createdAt: '2026-07-12 11:08'
draft: true
---

# Next.js 原理与实践

Next.js 解决的不是「让 React 跑在 Node.js」这么简单，而是让同一棵组件树在服务端和客户端各执行一次，并且两次执行能相互衔接：服务端生成首屏 HTML 与 RSC payload，浏览器用同一棵组件树接管 DOM、恢复事件与响应式状态。

这条双端协作的链路在 App Router 下被进一步收紧：

1. 默认所有页面都是 React Server Component，HTML 在构建期或请求期生成；
2. 需要交互的部分通过 `'use client'` 显式划入客户端；
3. 服务端与客户端的边界由打包器在编译期确定，RSC payload 描述服务端树，客户端 bundle 描述需要 hydrate 的部分；
4. Streaming 把 HTML 按 Suspense 边界分段写出，浏览器边收边渲染；
5. Cache Components 默认开启 Partial Prerendering，静态壳与动态片段在同一文档中合成。

本文以 Next.js 16 与 React 19 为基础，重点讲这条链路如何实现，以及路由 × 组件两维度如何选择渲染模式与组件边界。

## RSC 与 SSR 基础链路

### 从组件到 HTML

服务端没有 DOM，Next.js 通过 `react-dom/server` 把组件树转换成 HTML 字符串或流：

```ts
import { renderToString, renderToReadableStream } from 'react-dom/server'

const html = await renderToString(<App />)

const stream = await renderToReadableStream(<App />, {
  bootstrapScripts: ['/assets/main.js'],
})
```

`renderToString` 只产出应用内容；真正返回给浏览器的响应还要补上 `<html>`、`<head>`、`<script>`、样式以及 RSC payload：

```d2 maxHeight=480
shape: sequence_diagram

browser -> server: 请求 URL
server -> server: 匹配路由与 params
server -> server: 渲染 Server Component 树
server -> server: 生成 RSC payload
server -> server: 按 Suspense 边界流式输出 HTML
server -> browser: HTML + RSC payload
```

浏览器收到响应后会看到两个独立但配对的部分：

- 一份首屏 HTML，可以立刻画出非交互内容；
- 一份 RSC payload，描述服务端组件树以及 Client Component 在树中的位置。

两者配合后，React 才能把 HTML「升级」为可交互的应用。

### HTML 与 RSC payload 对照

服务端渲染一棵组件树时，会同时产出两份互补的产物：

```d2
direction: right

tree: 同一棵 React 树 {
  class: group
}

html: HTML 流
rsc: RSC payload

tree -> html: 序列化到响应体
tree -> rsc: 编码成 Flight 格式
```

- HTML 流：浏览器用来立刻渲染成 DOM，是首屏可见内容的来源；
- RSC payload（Flight 协议）：浏览器用来对齐 React 树，是后续 Hydration 与客户端导航的依据。它含三类信息——Server Component 渲染结果、Client Component 位置及 JS 引用、传给 Client Component 的 props——让客户端无需重跑 Server Component 也能重建与服务端一致的树结构。

考虑一棵典型组件树：

```tsx
// app/article/[id]/page.tsx — Server Component
import { LikeButton } from './like-button'

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
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

```tsx
// app/article/[id]/like-button.tsx — Client Component
'use client'

import { useState } from 'react'

export function LikeButton({ count }: { count: number }) {
  const [likes, setLikes] = useState(count)
  return (
    <button onClick={() => setLikes(likes + 1)}>{likes} likes</button>
  )
}
```

服务端处理这棵树时，会把每个节点映射成两种描述：

```text
# HTML 流（写入响应体的 <body> 区域）
<article>
  <h1>Hello RSC</h1>
  <p>这篇文章介绍了 RSC 的工作机制。</p>
  <button>0 likes</button>
</article>

# RSC payload（Flight 格式，写入响应体另一段）
[
  { tag: 'article', children: [
    { tag: 'h1', text: 'Hello RSC' },
    { tag: 'p', text: '这篇文章介绍了 RSC 的工作机制。' },
    { tag: '$', ref: 'LikeButton', props: { count: 0 } }
  ]}
]
```

HTML 是给浏览器看的视觉结果；RSC payload 是给 React 看的结构描述。两者中 `LikeButton` 对应的内容（这里都是 `0 likes`）必须一致，否则浏览器比对时会判定 mismatch。

### 嵌套布局与 RSC payload 合并

每次请求到达时，Next.js 从根 layout 向下逐段渲染。每一段都贡献自己的 Server Component 树，最终整棵树被合并进同一份 RSC payload：

```d2
direction: down

root: RootLayout {
  app: AppLayout
  layout: BlogLayout
  page: BlogPage
}

app -> layout -> page
```

请求 `/blog/hello` 时，RSC payload 实际包含的是 `RootLayout > AppLayout > BlogLayout > BlogPage` 这条路径上所有 Server Component 的渲染结果，Client Component 在树中以「位置 + 引用」的形式占位。

## Hydration

Hydration 是把服务端渲染的 HTML 升级为可交互应用的过程。浏览器收到 HTML 后，React 用组件树与之对齐，绑定事件、恢复响应式状态，让原本静态的标记变成可点击、可响应的应用。

Next.js 客户端入口仍然会创建 React 应用并调用 `hydrateRoot`：

```ts
import { hydrateRoot } from 'react-dom/client'
import { startTransition } from 'react'

startTransition(() => {
  hydrateRoot(document, initialTree)
})
```

`hydrateRoot` 告诉 React：容器里已经有服务端输出，不要重新创建 DOM。React 在客户端执行首次 render，与服务端输出对齐后绑定事件、恢复响应式依赖。

### 客户端如何消费 RSC payload

App Router 下的 Hydration 比标准 React 多一步：除了 HTML，还需要吃进 RSC payload 来重建 Server Component 树。浏览器拿到响应后并不会重新执行任何 Server Component。它手上有三样东西：

- 初始 HTML（已经在 DOM 里）；
- RSC payload（描述这棵树的最终形态）；
- Client Component 的 JS bundle（按需加载）。

`hydrateRoot` 启动后，React 按以下顺序把它们拼起来：

```d2
direction: down

parse: 解析 RSC payload
tree: 构造 fiber 树
align: 把 Server Component 输出对齐到 DOM
load: 为 Client Component 加载 JS
hydrate: 绑定事件与副作用

parse -> tree -> align
parse -> load -> hydrate
align -> hydrate
```

具体每一步：

1. **解析 payload**：React 把 RSC payload 反序列化成内存结构。Server Component 节点已经带有渲染结果（HTML 字符串），Client Component 节点只有引用 `ref` 与 props。

2. **加载 Client Component JS**：根据 payload 里的引用，浏览器按需请求对应的 chunk。Next.js 在编译期给每个 Client Component 入口打上 `__next_internal_client_reference__` 标记，React 用它定位 JS 模块。

3. **构造 fiber 树**：React 在内存里构造一棵 fiber 树。Server Component 节点的 DOM 直接来自 payload，不执行任何 JS；Client Component 节点用 props 实例化，运行 `useState`、`useEffect` 等 Hook。

4. **对齐到 DOM**：React 把已有 HTML 与 fiber 树逐节点对比。Server Component 的 DOM 复用，Client Component 占位 DOM 与其实例绑定。

5. **绑定事件**：React 给 Client Component 节点挂上事件委托、ref、副作用，让页面真正可交互。

RSC payload 的核心价值是让客户端无需重新执行 Server Component：payload 已经携带了渲染结果，React 只需要按结构填回去。这就是 Server Component 能被排除在 client bundle 之外、却仍能在客户端重建出同一棵树的关键。

后续客户端导航（点击 `<Link>`）时，浏览器只拿新的 RSC payload，不重新下载 HTML。React 拿到 payload 后做差异化更新（类似 reconcile），只刷新变化的子树。

### Streaming 与 Suspense

Next.js 默认按 Suspense 边界分段写出 HTML。每个 Suspense 边界内的子树可以独立完成、独立流出，浏览器不需要等整页 HTML：

```tsx
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
direction: right

ssr: 服务端 {
  class: group

  shell: 输出 HTML 壳
  resolve: 解决 PostList 数据
  stream: 流式写入 PostList HTML
}

client: 浏览器 {
  class: group

  paint: 立即画出 HTML 壳
  hydrate_shell: Hydration 壳
  patch: 补丁式插入 PostList HTML
  ready: PostList 可交互 {
    class: ok
  }
}

ssr.shell -> client.paint
client.paint -> client.hydrate_shell
ssr.resolve -> ssr.stream -> client.patch -> client.ready
```

`loading.tsx` 在 App Router 中会被自动包成 page 的 Suspense 边界。但这条边界**只覆盖 `page.tsx`，不覆盖同段的 `layout.tsx`**——如果 layout 直接读 runtime 数据（`cookies()` / `headers()` / 未缓存的 fetch），layout 会阻塞整段渲染，期间 `loading.tsx` 不会作为它的 fallback 展示，用户看到的是空白页：

```tsx
// app/dashboard/layout.tsx
import { cookies } from 'next/headers'

export default async function Layout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get('theme')?.value
  return <div data-theme={theme}>{children}</div>
}
```

正确做法是 layout 内部用 `<Suspense>` 隔离 runtime 数据读取，或者把读取下移到 `page.tsx`，让 `loading.tsx` 自然兜底。

### 选择性 Hydration

React 18+ 在 Streaming SSR 下提供选择性 Hydration：

- HTML 流式到达时，Suspense 边界可以独立 hydrate；
- 用户在某个 Suspense 边界内交互时，React 优先 hydrate 该边界；
- 更高优先级更新可以打断尚未完成 hydrate 的子树。

这意味着首屏不必等所有 JS 加载完，用户点击已经流到的区域即可触发响应。

### Hydration mismatch

服务端输出与客户端首次 render 不一致时，会出现 Hydration mismatch。React 会尝试恢复，但需要丢弃或修正节点，既影响性能，也可能造成闪烁。

常见原因：

- 服务端渲染时直接读取 `window`、`document`、`localStorage`；
- 模板中使用 `Math.random()`、当前时间等非确定值；
- 服务端和浏览器的时区、语言环境不同；
- HTML 标签嵌套非法，被浏览器解析器自动修正；
- 服务端与客户端拿到不同的数据或初始状态；
- 根据视口宽度直接决定首次渲染结构。

需要浏览器环境的逻辑应放进 `useEffect`：

```tsx
'use client'

import { useEffect, useState } from 'react'

export function ViewportWidth() {
  const [width, setWidth] = useState<number>()

  useEffect(() => {
    setWidth(window.innerWidth)
  }, [])

  return <p>{width ? `视口宽度：${width}` : '正在读取视口信息'}</p>
}
```

对于明确且不可避免的差异（如时间戳），可以使用 `suppressHydrationWarning`：

```tsx
<time dateTime={post.publishedAt} suppressHydrationWarning>
  {new Date(post.publishedAt).toLocaleString()}
</time>
```

`suppressHydrationWarning` 只能压制警告，不能替代正确的数据和环境设计。

### SSR 期间的 hooks 与浏览器 API 边界

Server Component 没有生命周期：它只在请求期间执行一次，不挂载 DOM、不重新渲染，所有 React Hook 不可用：

- 不能 `useState` / `useReducer`：服务端没有响应式状态；
- 不能 `useEffect` / `useLayoutEffect`：服务端没有挂载与副作用执行时机；
- 不能 `useRef` / `useContext`：Server Component 不支持 context；
- 没有事件处理器；
- 不能访问浏览器 API（`window`、`document`、`localStorage`、`Canvas`、`WebSocket` 等）。

Client Component 在 SSR 期间会执行 render 函数，但 hooks 行为与纯客户端不同：

- `useState` 的初始值在服务端和客户端各求值一次，两次结果不一致会触发 Hydration mismatch；
- `useEffect` / `useLayoutEffect` 在服务端不执行，只在客户端 Hydration 后才运行；
- 浏览器 API 在服务端 render 时不可用，应放进 `useEffect` 或事件处理器。

服务端渲染期间 React 默认跳过不必要的订阅追踪——当前请求只需要输出一次结果，没有重新订阅的场景。

## Server Component 与 Client Component 边界

### 两份构建产物

Next.js 一次构建会产出两类 bundle：

- Server bundle：路由处理、Server Component 渲染、Server Actions、`route.ts` API；
- Client bundle：Client Component、Hydration 入口、Client manifest。

服务端运行时只会加载 Server bundle；浏览器只会加载 Client bundle。两者通过 RSC payload 与 manifest 在请求期间协商哪些组件在客户端执行。

### 三类边界

App Router 下组件分三类：

| 类型 | 服务端生成 HTML | 进入客户端 bundle | Hydration | 典型用途 |
|---|---|---|---|---|
| Server Component（默认） | 是 | 否 | 否 | 数据获取、静态结构、SEO 内容 |
| Client Component（`'use client'`） | 是 | 是 | 是 | 交互、状态、浏览器 API |
| 共享组件（仅 props 透传） | 是 | 是 | 否 | 跨边界复用 |

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

| 渲染时机 | 何时执行 | 数据来源 | 失效方式 |
|---|---|---|---|
| 静态（Static） | 构建期 | 编译时已确定的输入 | 重新构建部署 |
| 缓存（Cached） | 构建期或首次请求，缓存到 `cacheLife` 过期 | 任意 async 工作 | 时间过期 / `revalidateTag` 主动失效 |
| 动态（Dynamic） | 每次请求 | `cookies()` / `headers()` / `searchParams` / 未缓存的 `fetch` | 不缓存 |

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

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const post = await getPost(slug)
  return <article>{post.title}</article>
}
```

`generateStaticParams` 返回的样本走构建期；运行时收到未在样本中的参数时按动态路径处理。

### 路由段配置

`page.tsx` / `layout.tsx` 等文件里可以导出的少量路由级配置。这些选项主要与部署和动态参数控制相关，不影响渲染时机：

| 配置 | 用途 |
|---|---|
| `dynamicParams` | 控制 `generateStaticParams` 未覆盖的动态参数是否允许运行时渲染 |
| `runtime` | 选择 `'nodejs'` 或 `'edge'` 运行时 |
| `preferredRegion` | 提示首选部署区域 |
| `maxDuration` | Server Action / Route Handler 的最长执行时间 |

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

| 场景 | 渲染模式 |
|---|---|
| 内容构建期确定且可枚举 | Static（`generateStaticParams` 列出全部样本） |
| 内容公共但会定期更新 | Cached（`use cache` + `cacheLife`） |
| 内容依赖请求身份或实时数据 | Dynamic（runtime API 或未缓存 fetch） |
| 公共壳 + 个性化片段 | PPR 默认（静态壳 + Suspense 隔离动态） |
| 不要求 SEO 的重交互后台 | 局部 CSR（`'use client'` 或 `dynamic({ ssr: false })`） |

### 组件维度

| 场景 | 组件类型 |
|---|---|
| 数据获取、静态结构、SEO 内容 | Server Component（默认） |
| 状态、事件处理、浏览器 API | Client Component（`'use client'`） |
| 强依赖 `window` / `document`，无服务端降级 | 隔离为 Client Component，必要时 `dynamic({ ssr: false })` |
| 表单与服务端变更 | Server Action + `<form action>` |
| Provider、Context | 包成 Client Component 后在 Server Component 中透传 |

### 组合实践

常见页面：

- 营销页：Static（公开内容）+ 少量 Client 交互；
- 文章详情：Static 壳 + `use cache` 缓存文章内容；
- 商品列表：Cached（`cacheLife('hours')`）+ 用户态 Suspense 隔离；
- 个人中心：Dynamic（读 cookie / session）+ 表单用 Server Action；
- 后台：Client Component 为主 + Server Action 触发变更；
- 实时仪表盘：Dynamic + WebSocket 在 Client Component 中订阅。

最终选型分两步：先决定路由按什么时机生成 HTML，再决定组件在哪一侧执行。两者交叉后才是项目的实际表现。
