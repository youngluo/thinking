---
createdAt: '2026-07-12 11:08'
draft: true
---

# Next.js 渲染机制

本文从一次 App Router 页面请求出发，说明 HTML 与 RSC payload 的生成、传输和 Hydration，以及 Suspense 和组件边界在其中的作用。

## RSC 与 SSR 基础链路

先看服务端如何把一次页面请求转换为两类产物：浏览器直接显示的 HTML，以及 React 客户端运行时消费的 RSC payload。

### 从请求到服务端产物

App Router 的首次渲染在服务端分两步完成：

1. React 执行匹配路由的 Server Component，将渲染结果编码为 RSC payload；
2. Next.js 使用 RSC payload 和 Client Component 的模块信息预渲染 HTML，供浏览器直接显示首屏。

Client Component 也会参与 HTML 预渲染，因此交互元素可以出现在首屏 HTML 中。它在浏览器中的状态、事件和 Effect 要等到 Hydration 后才会生效。

```d2 maxHeight=400
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
- Client Component 的模块引用和所在位置；
- 传给 Client Component 的可序列化 props；
- Suspense、异步数据和错误等信息。

它描述的是组件树和边界信息，不是浏览器直接显示的 HTML，也不是让浏览器重新执行 Server Component 的源码。

### 首次响应中的 HTML 与 RSC payload

以一个文章页面为例，`Page` 是 Server Component，`LikeButton` 是 Client Component：

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

`Page` 在服务端执行并获取文章数据。RSC payload 保存 `Page` 的渲染结果，以及 `LikeButton` 的模块引用和 `count: 0`。SSR 再将同一份组件结果预渲染为 HTML，其中既有文章内容，也有按钮。

首次访问时，两份产物通常通过同一个 `text/html` 响应返回。HTML 以普通标签写入响应，RSC payload 被拆成 chunk，通过内联脚本写入 Next.js 的客户端数据队列：

```html
<article>
  <h1>文章标题</h1>
  <p>文章内容</p>
  <button>0 likes</button>
</article>

<script>
  self.__next_f.push([1, '...RSC chunk...'])
</script>
```

这个响应同时携带可见内容和后续 Hydration 所需的数据。`self.__next_f` 是 Next.js 当前使用的传输实现，不属于 RSC 协议本身，因此理解机制时不需要把它当作稳定 API。

### 嵌套布局如何进入 RSC payload

一个 URL 通常会同时匹配页面和多层布局。以 `/blog/hello` 为例，`RootLayout`、`AppLayout`、`BlogLayout` 和 `BlogPage` 依次嵌套，它们的 Server Component 渲染结果都会进入当前路由的 RSC payload。

后续客户端导航只需请求目标路由的 RSC payload。Next.js 复用已加载的共享布局，再将新的路由段合并到现有组件树中。

## Hydration

上一节得到的是服务端产物，这一节看浏览器如何接手。服务端响应到达后，浏览器一边解析 HTML，一边收集 RSC chunk 并加载 Client Component JavaScript。Next.js 客户端运行时随后启动 Hydration，React 复用已有 DOM，并建立客户端状态和交互。下图按依赖关系展示这些交错进行的工作：

```d2 maxHeight=520
shape: sequence_diagram

browser: 浏览器
runtime: Next.js 客户端运行时
flight: React Flight
reconciler: React Reconciler
dom: DOM

browser -> dom: 解析 HTML，生成并显示 DOM
browser -> runtime: 执行内联脚本，写入 RSC chunk
runtime -> flight: 交给 React Flight 解析 RSC chunk
flight -> runtime: 返回 React 元素、数据与模块引用
runtime -> reconciler: 调用 hydrateRoot，传入 Flight 返回结果
reconciler -> reconciler: 为 Server Component 渲染结果创建 Host Fiber
reconciler -> runtime: 根据引用加载 Client Component 模块
runtime -> reconciler: 返回 Client Component 模块
reconciler -> reconciler: 执行 Client Component，创建组件与 Host Fiber
reconciler -> dom: Host Fiber 按顺序匹配已有 DOM
reconciler -> dom: 关联 Fiber 与 DOM，保存事件 props
reconciler -> browser: 关联 ref、执行 Effect，进入客户端更新
```

下面继续以 `LikeButton` 为例，把时序图中的流程对应到具体节点。

### 从 RSC payload 到可交互页面

Hydration 开始时，浏览器需要组合三类内容：

- HTML 已经生成 `article`、`h1`、`p` 和 `button` DOM 元素；
- RSC payload 包含 `Page` 的渲染结果、`LikeButton` 的模块引用和 `count: 0`；
- Client Component JavaScript 包含 `LikeButton` 的组件逻辑。

页面此时已经可见，但浏览器中还没有 `LikeButton` 的 Hook 状态和点击处理逻辑。接下来，React 按以下过程把这三类内容连接起来：

1. React Flight 解析 RSC chunk，还原 React 元素、数据和 Client Component 模块引用。RSC payload 不包含 Fiber，也不包含 `Page` 的组件函数，因此浏览器不会重新执行 `Page`。
2. Next.js 根据模块引用加载 `LikeButton` 的客户端 JavaScript。
3. Next.js 客户端运行时调用 `hydrateRoot`，Reconciler 开始 Hydrate。它遍历 `Page` 返回的 React 元素树：遇到 `article`、`h1`、`p` 等原生元素时创建对应的 Host Fiber；遇到 `LikeButton` 时先创建组件 Fiber，用 `count: 0` 调用组件函数，再为返回的 `button` 创建 Host Fiber。
4. Reconciler 创建 Host Fiber 时尝试匹配已有 DOM。`article`、`h1`、`p` 和 `button` 的 Host Fiber 都与对应 DOM 节点建立关联。
5. 提交阶段保存事件 props、关联 ref 并执行 Effect。`LikeButton` 组件 Fiber 保存 Hook 状态，`button` Host Fiber 保存 `onClick` 事件 props。此后点击按钮，`setLikes` 会更新状态并修改已复用 DOM 中的文本。

Server Component 渲染结果和 Client Component 返回结果中的 Host Fiber，都使用同一套 DOM 复用逻辑；组件状态和交互能力来自 Client Component 在浏览器中的执行。

也就是说，Hydration 不是把服务端 HTML 丢掉重来，而是在已有 DOM 上补齐 React 运行时需要的 Fiber、状态和事件信息。

### Fiber 与 DOM 如何匹配

React 按深度优先顺序遍历 Fiber 树，同时维护当前 DOM 位置。遍历到 Host Fiber 时，React 将它与下一个 DOM 节点进行匹配。

组件 Fiber 和 Fragment 没有自己的 DOM，因此不会让 DOM 的遍历位置前进。以 `Page + LikeButton` 为例，React 处理完 `article`、`h1` 和 `p` Host Fiber 后，遍历到 `LikeButton` 组件 Fiber，此时不移动 DOM 位置。继续处理它返回的 `button` Host Fiber 时，下一个 DOM 节点正好也是 `button`。

匹配时，React 先检查 DOM 节点的类型。Host Fiber 对应元素时，下一个 DOM 节点需要是相同标签的元素；Host Fiber 对应文本时，下一个 DOM 节点需要是文本节点。类型匹配后，React 建立 Fiber 与 DOM 的关联，再校验文本和属性是否一致。

因此，遍历顺序决定当前与哪个 DOM 节点匹配，节点类型决定能否匹配成功，文本和属性用于校验内容是否一致。

### Hydration mismatch

客户端首次渲染的结构或文本与现有 DOM 不一致时，React 会报告 hydration mismatch，并尝试恢复受影响的部分。开发环境的控制台会显示差异；页面可能出现内容切换，DOM 重建时还可能丢失焦点或未提交的输入。属性不一致时，React 通常只在开发环境给出警告，DOM 可能继续保留服务端生成的属性值。

常见原因：

- **浏览器专属数据**：首次渲染读取 `localStorage`、视口宽度等数据，服务端无法获得相同结果。
- **非稳定值**：在渲染过程中调用 `Date.now()`、`Math.random()`，两次渲染得到不同内容。
- **环境差异**：日期、数字等内容依赖时区或语言环境，服务端与浏览器的格式化结果不同。
- **条件渲染不同**：使用 `typeof window !== 'undefined'` 等条件，让服务端与浏览器返回不同的 JSX。
- **HTML 结构变化**：非法嵌套被浏览器自动调整，或第三方脚本、浏览器扩展在 Hydration 前修改了 DOM。

修复的核心是保证服务端与客户端的首次渲染结果一致。对于 `localStorage` 等浏览器专属数据，可以先渲染稳定的默认内容，再在 `useEffect` 中读取并更新：

```tsx fold title="components/theme-label.tsx"
'use client'

import { useEffect, useState } from 'react'

export function ThemeLabel() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    if (localStorage.getItem('theme') === 'dark') {
      setTheme('dark')
    }
  }, [])

  return <p>当前主题：{theme === 'dark' ? '深色' : '浅色'}</p>
}
```

服务端预渲染和浏览器首次渲染都会输出「浅色」，Hydration 完成后再根据 `localStorage` 更新。

对于时间戳等无法避免的单个元素差异，可以使用 `suppressHydrationWarning`。它只关闭当前元素的 Hydration 警告，不会递归作用于后代节点，也不会修正不一致的文本：

```tsx fold
<time dateTime={post.publishedAt} suppressHydrationWarning>
  {new Date(post.publishedAt).toLocaleString()}
</time>
```

## Suspense 边界

Suspense 边界把组件树划分为可以独立等待和恢复的区域。服务端以它为单位分批输出 HTML，客户端以它为单位调度 Hydration。

### Streaming HTML

前面讲述的 Hydration 流程是从浏览器收到完整响应开始的。实际渲染中，组件可能因等待数据而挂起；如果等整棵组件树渲染完成后才响应，那么其它内容就会被阻塞。为避免这种情况，React 以 Suspense 边界划分渲染任务，先输出已完成部分的 HTML 和 fallback，待 Suspense 边界内的内容完成后再继续输出。这一过程称为 Streaming HTML。整体时序如下：

```d2 maxHeight=560
shape: sequence_diagram

server: 服务端
browser: 浏览器
runtime: Next.js 客户端运行时
react: React
dom: DOM

server -> server: 组件等待数据，Suspense 边界挂起
server -> browser: 发送首批 HTML、fallback 与 RSC chunk
browser -> dom: 解析 HTML，显示已有内容
browser -> runtime: 执行内联脚本，提交 RSC chunk
runtime -> react: 解析 RSC chunk，Hydrate 已就绪内容
server -> server: 数据就绪，继续渲染 Suspense 边界内容
server -> browser: 发送 Suspense 边界内的 HTML 与 RSC chunk
browser -> runtime: 执行流中的插入指令
runtime -> dom: 根据 Suspense 边界标记替换 fallback
runtime -> react: 解析新增数据，Hydrate Suspense 边界
```

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

以这个 `Page` 为例，首次请求的处理过程如下：

1. 服务端先完成 `<h1>`，渲染到 `PostList` 时因等待数据而挂起，React 记录这个尚未完成的 Suspense 边界。
2. Suspense 输出 `<p>正在加载...</p>`，服务端继续处理 Suspense 边界外的内容。浏览器收到首批结果后，先显示「博客」和「正在加载...」。
3. 数据就绪后，服务端继续渲染 `PostList`，将 Suspense 边界内的 HTML、RSC chunk 和插入指令写入同一个响应。
4. 客户端运行时根据 Suspense 边界标记，用 `PostList` 的 HTML 替换加载提示。若其中包含 Client Component，这段 HTML 也包含其服务端预渲染结果。
5. React Flight 解析新增的 RSC chunk。客户端代码就绪后，React 继续 Hydrate 这个 Suspense 边界，让 Host Fiber 匹配刚插入的 DOM；若其中包含 Client Component，再执行其客户端代码并恢复交互。

整个过程仍发生在同一次 HTTP 响应中，也只调用一次 `hydrateRoot`。

### Selective Hydration

Suspense 边界也是客户端 Hydration 的调度单元。React 可以跳过尚未就绪的 Suspense 边界，先 Hydrate 其它内容。

多个 Suspense 边界同时就绪时，React 会按优先级调度。如果用户在尚未 Hydrate 的 Suspense 边界内交互（如点击、聚焦），React 会强制 hydrate 该边界及其父级 Suspense 边界。

Streaming HTML 让页面不必等全部 HTML 才能显示，Selective Hydration 让页面不必等整棵树 Hydrate 才能交互。两者都以 Suspense 边界为工作单元，前者控制服务端输出，后者调度客户端 Hydration。

### loading.tsx

`loading.tsx` 是 Next.js 提供的路由级 Suspense 边界，会自动包裹同一路由段的页面及其子级。手写 `<Suspense>` 用于继续拆分页面内的异步区域。两者同时存在时，组件挂起后由离它最近的 Suspense 边界显示 fallback。

## 组件边界

前文讲 Hydration 和 Suspense 时已经触及两类组件。本节回到代码层面，看哪些模块进入客户端，两端组件如何在树中组合。

### 边界如何形成

App Router 中的组件默认是 Server Component。文件顶部使用 `'use client'` 会声明一个客户端入口，该文件及其依赖会进入客户端模块图。只有需要状态、事件、Effect 或浏览器 API 的入口才需要添加这个指令。

优先把边界贴近交互发生的位置。例如，布局中的 Logo 和导航结构可以保留为 Server Component，只有搜索框标记为 Client Component。边界越靠上，需要发送和执行的客户端 JavaScript 通常越多。

### 组件如何跨越边界

Server Component 可以直接渲染 Client Component，并通过 props 传递数据。这些 props 需要能被 React 序列化；函数等普通 JavaScript 引用不能直接跨越边界，Server Function 除外。

Client Component 不能把依赖服务端能力的模块作为普通依赖引入。需要在 Client Component 内展示 Server Component 时，应由上层 Server Component 完成组合，再通过 `children` 等 props 传入：

```tsx fold title="app/page.tsx"
import { Cart } from './cart'
import { Modal } from './modal'

export default function Page() {
  return (
    <Modal>
      <Cart />
    </Modal>
  )
}
```

这里 `Modal` 是 Client Component，`Cart` 仍由服务端渲染。`Modal` 只负责交互和展示 `children`，不会把 `Cart` 变成 Client Component。

### 特殊边界

`server-only` 和 `client-only` 用于限制模块的运行环境。例如，数据库模块只能被服务端模块引用：

```ts fold title="lib/db.ts"
import 'server-only'

import { db } from './database'

export const getPosts = () => db.post.findMany()
```

浏览器存储模块则只能被客户端模块引用：

```ts fold title="lib/theme-storage.ts"
import 'client-only'

export const readTheme = () => localStorage.getItem('theme')
```

模块被错误环境引用时，Next.js 会在构建阶段报错。

依赖状态、Effect 或浏览器 API，但没有声明 `'use client'` 的第三方组件，可以用 Client Component 包装：

```tsx fold title="components/carousel.tsx"
'use client'

export { Carousel as default } from 'acme-carousel'
```

组件强依赖 `window`、`document`，无法参与服务端预渲染时，可以在 Client Component 中使用 `next/dynamic` 并配置 `ssr: false`，让它只在浏览器加载后渲染：

```tsx fold title="components/article-editor.tsx"
'use client'

import dynamic from 'next/dynamic'

export const ArticleEditor = dynamic(() => import('./editor'), { ssr: false })
```

## 总结

Next.js App Router 的首次渲染依赖三类信息：HTML 提供首屏可见内容，RSC payload 记录 Server Component 的渲染结果和 Client Component 的模块引用与位置，Client Component JavaScript 在 Hydration 后恢复状态、事件和 Effect。Suspense 把这条链路拆成可独立推进的段落：服务端通过 Streaming HTML 先发送已完成内容，客户端通过 Selective Hydration 优先恢复就绪或正在交互的区域。组件边界决定代码运行在哪一侧，默认保持 Server Component，只把真正需要交互和浏览器能力的部分放进客户端，渲染链路因此更清晰，客户端 JavaScript 也会更少。

## 参考资料

- [React Suspense 官方文档](https://react.dev/reference/react/Suspense#caveats)；
- [React 18 Suspense SSR 架构](https://github.com/reactwg/react-18/discussions/37#react-18-streaming-html-and-selective-hydration)；
- [React 源码：DOM 节点匹配入口](https://github.com/facebook/react/blob/172742b419bad2a79ac375c0d5ee15c7ac66bff2/packages/react-reconciler/src/ReactFiberHydrationContext.js#L461-L503)；
- [React 源码：DOM 类型检查](https://github.com/facebook/react/blob/172742b419bad2a79ac375c0d5ee15c7ac66bff2/packages/react-dom-bindings/src/client/ReactFiberConfigDOM.js#L3781-L3956)。
