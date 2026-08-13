---
createdAt: '2026-08-03 18:00'
---

# Next.js 渲染机制

Next.js 是基于 React 的全栈 Web 框架，提供文件路由和服务端渲染等能力。本文以 App Router 的一次页面请求为线索，说明页面如何从服务端生成内容，并在浏览器中呈现和恢复交互。

## RSC 与 SSR 基础链路

一次页面请求会在服务端生成两类产物：浏览器直接显示的 HTML，以及 React 客户端运行时消费的 RSC payload。

### 从请求到服务端产物

首次请求的服务端渲染主要包含两个阶段：

1. React 执行匹配路由的 Server Component，将渲染结果编码为 RSC payload；
2. Next.js 使用 RSC payload 和 Client Component 的模块信息预渲染 HTML，供浏览器直接显示首屏。

Client Component 也会参与 HTML 预渲染，因此交互元素可以出现在首屏 HTML 中。它在浏览器中的状态、事件和 Effect 要等到 Hydration 后才会生效。

```d2 maxHeight=400
shape: sequence_diagram

browser: 浏览器
next: Next.js
rsc: React Server Components
ssr: React DOM Server

browser -> next: 请求 URL
next -> rsc: 执行 Server Component
rsc -> next: 生成 RSC payload
next -> ssr: 结合 RSC payload 与 Client Component 模块信息预渲染 HTML
ssr -> next: 生成 HTML
next -> browser: 返回包含 HTML 与内嵌 RSC chunk 的响应
```

RSC payload 是由 Server Components 生成的、供客户端 React 消费的数据格式，主要包含：

- Server Component 的渲染结果；
- Client Component 的模块引用和所在位置；
- 传给 Client Component 的可序列化 props；
- Suspense 边界、异步数据和错误处理所需的信息。

它描述的是组件树和边界信息，不是浏览器直接显示的 HTML，也不是让浏览器重新执行 Server Component 的源码。

### 首次响应中的 HTML 与 RSC payload

以一个文章页面为例，观察首次响应中 HTML 与 RSC payload 分别承载什么。`Page` 是 Server Component，`LikeButton` 是 Client Component：

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

假设文章当前有 0 个赞，`Page` 在服务端执行并获取文章数据。RSC payload 记录 `Page` 的渲染结果，并为 `LikeButton` 保留模块引用和 `count: 0` 这个 prop。Next.js 再结合这份 RSC payload 和 Client Component 的模块信息预渲染 HTML，其中既有文章内容，也有按钮。

首次访问通常返回一个 `text/html` 响应，其中同时包含 HTML 和以 chunk 形式内嵌的 RSC payload：HTML 以普通标签写入响应，RSC chunk 则通过内联脚本写入 Next.js 的客户端数据队列。下面只截取与当前示例相关的片段：

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

这个响应同时携带首屏可见内容和后续 Hydration 所需的信息。`self.__next_f` 是 Next.js 当前使用的传输实现，不属于 RSC 协议本身，因此理解机制时不需要把它当作稳定 API。

### 嵌套布局如何进入 RSC payload

RSC payload 不只包含页面内容，也包含当前路由上各级布局的渲染结果。假设访问 `/blog/hello` 时，路由依次经过 `RootLayout`、`AppLayout` 和 `BlogLayout`，最终渲染 `BlogPage`。App Router 会按路由层级将这些布局和页面组合成一棵组件树，并把它们的服务端渲染结果写入当前路由的 RSC payload。

后续客户端导航时，Next.js 获取目标路由的 RSC payload，客户端复用已加载的共享布局，再将新的路由段合并到现有组件树中。

## Hydration

服务端返回 HTML 和 RSC payload 后，浏览器开始接手这次渲染。浏览器先解析 HTML，内联脚本将 RSC chunk 交给 Next.js 客户端运行时，同时加载所需的 Client Component JavaScript。数据和模块准备完成后，Next.js 调用 `hydrateRoot`，React 复用已有 DOM，并建立客户端状态和交互。下图按依赖关系展示这段过程：

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
runtime -> reconciler: 调用 hydrateRoot，传入 RSC 还原的 React 元素
reconciler -> reconciler: 开始遍历 React 元素树
reconciler -> runtime: 根据引用加载 Client Component 模块
runtime -> reconciler: 返回 Client Component 模块
reconciler -> reconciler: 执行 Client Component，创建组件与 Host Fiber
reconciler -> dom: 按顺序匹配并关联已有 DOM
reconciler -> browser: 关联 ref、执行 Effect，恢复客户端交互
```

下面仍以前面的 `Page` 和 `LikeButton` 为例，将时序图中的抽象流程对应到具体节点。

### 从 RSC payload 到可交互页面

Hydration 要把服务端已经生成的 DOM 与 React 运行时所需的数据和组件逻辑连接起来。当前示例包含三类信息：

- 浏览器已经根据 HTML 生成 `article`、`h1`、`p` 和 `button` DOM 元素；
- RSC payload 记录 `Page` 的渲染结果、`LikeButton` 的模块引用和 `count: 0`；
- Client Component JavaScript 包含 `LikeButton` 的组件逻辑。

页面此时已经可见，但浏览器中还没有 `LikeButton` 的 Hook 状态和点击处理逻辑。接下来，React 按以下过程把这三类内容连接起来：

1. React Flight 解析 RSC chunk，还原 React 元素、数据和 Client Component 模块引用。RSC payload 不包含 Fiber，也不包含 `Page` 的组件函数，因此浏览器不会重新执行 `Page`；
2. Next.js 根据模块引用加载 `LikeButton` 的客户端 JavaScript；
3. Next.js 客户端运行时调用 `hydrateRoot`，Reconciler 开始 Hydrate。它遍历 RSC payload 还原出的 React 元素树：遇到 `article`、`h1`、`p` 等原生元素时创建对应的 Host Fiber；遇到 `LikeButton` 时先创建组件 Fiber，用 `count: 0` 调用组件函数，再为返回的 `button` 创建 Host Fiber；
4. Reconciler 创建 Host Fiber 时尝试匹配已有 DOM。`article`、`h1`、`p` 和 `button` 的 Host Fiber 都与对应 DOM 节点建立关联；
5. Render 阶段，`LikeButton` 的组件 Fiber 创建 Hook 状态，`button` Host Fiber 记录 `onClick` 等 props；Commit 阶段，React 关联 ref、完成事件处理所需的信息并执行 Effect。此后点击按钮，`setLikes` 会更新状态并修改已复用 DOM 中的文本。

Server Component 生成的元素和 Client Component 返回的元素，都会参与同一套 DOM 匹配过程。Hook 状态和交互逻辑则来自 Client Component 在浏览器中的执行。

### Fiber 与 DOM 如何匹配

Hydration 时，React 按深度优先顺序遍历 Fiber 树，并按相同顺序查找可以复用的 DOM 节点。只有 Host Fiber 对应实际的 DOM 节点，组件 Fiber 和 Fragment 不会单独消耗一个 DOM 节点。

以 `Page + LikeButton` 为例，React 处理完 `article`、`h1` 和 `p` Host Fiber 后，遍历到 `LikeButton` 组件 Fiber。这个组件 Fiber 不对应 DOM 节点，继续处理它返回的 `button` Host Fiber 时，React 才会匹配下一个 `button` DOM 节点。

找到候选节点后，React 先检查 DOM 节点的类型。Host Fiber 对应元素时，候选节点需要是相同标签的元素；Host Fiber 对应文本时，候选节点需要是文本节点。类型匹配后，React 建立 Fiber 与 DOM 的关联，再校验文本和属性是否一致。

整个匹配过程有三个关键点。遍历顺序决定匹配位置，节点类型决定能否复用，文本和属性用于校验内容。如果节点结构或内容无法与服务端结果对齐，就会出现 Hydration mismatch。

### Hydration mismatch

Hydration mismatch 表示客户端首次渲染的结构或文本无法与服务端生成的 DOM 对齐。React 会报告差异，并尝试恢复受影响的部分。开发环境的控制台会显示具体差异；如果受影响的 DOM 被替换，页面内容可能切换，输入焦点或尚未提交的内容也可能丢失。属性不一致时，React 通常只在开发环境给出警告，服务端生成的属性值可能继续保留。

常见原因：

- **浏览器专属数据**：首次渲染读取 `localStorage`、视口宽度等数据，服务端无法获得相同结果；
- **非稳定值**：在渲染过程中调用 `Date.now()`、`Math.random()`，两次渲染得到不同内容；
- **环境差异**：日期、数字等内容依赖时区或语言环境，服务端与浏览器的格式化结果不同；
- **条件渲染不同**：使用 `typeof window !== 'undefined'` 等条件，让服务端与浏览器返回不同的 JSX；
- **HTML 结构变化**：非法嵌套被浏览器自动调整，或第三方脚本、浏览器扩展在 Hydration 前修改了 DOM。

要避免 Hydration mismatch，服务端与客户端的首次渲染结果必须保持一致。对于 `localStorage` 等浏览器专属数据，可以先渲染稳定的默认内容，再在 `useEffect` 中读取并更新。

如果某个元素的差异无法避免，可以使用 `suppressHydrationWarning`。它只对当前元素生效，不会递归作用于后代节点，也不会修正不一致的文本：

```tsx fold
<time dateTime={post.publishedAt} suppressHydrationWarning>
  {/* 服务端与浏览器的时区、语言环境可能不同，导致文本不一致 */}
  {new Date(post.publishedAt).toLocaleString()}
</time>
```

### Hydration 与客户端渲染的差异

Hydration 与普通客户端渲染都要经历入口、Render 和 Commit 阶段，但处理 DOM 的方式不同。`createRoot` 接收一个 DOM 容器并为其创建 React 根，随后由 `root.render` 将 React 元素渲染到这个容器中；`hydrateRoot` 则接收服务端已经生成的 HTML 和对应的 React 元素，启动 Hydration。

Render 阶段，两者都会执行组件函数、构建 Fiber 树，并沿用同一套 Reconciliation 逻辑。区别在于 Host Fiber 的 DOM 处理：`createRoot` 创建新的 DOM 节点，Hydration 则在 Hydration 状态下查找、校验并认领已有 DOM。因此，Hydration 并没有跳过 Render，而是将服务端 DOM 作为匹配目标。

Commit 阶段，两者都会提交 Render 阶段计算出的结果，完成 DOM 处理和 ref 挂载，让客户端接管交互；相关 Effect 则按 React 的调度规则执行。`createRoot` 将新建的 DOM 节点插入容器，Hydration 则在已认领的 DOM 上完成必要更新。两者共用同一套 Commit 流程，DOM 处理会根据是否处于 Hydration 状态采用不同路径。

在 Next.js App Router 中，框架通常在应用根节点调用一次 `hydrateRoot`。后续到达的 Streaming HTML 和 Selective Hydration 对 Suspense 边界的调度，都会在这个根节点下继续处理，无需再次调用 `hydrateRoot`。

## Suspense 边界

前面介绍的是响应完整到达后，React 如何复用 HTML 并完成 Hydration。这里进一步说明响应分批到达时，Suspense 边界如何组织异步内容，以及它对 HTML 输出和 Hydration 的影响。

### Streaming HTML

当某个组件因等待数据而挂起时，如果服务端等到整棵组件树完成后才发送响应，已经完成的内容也会被一起延后。Suspense 边界允许服务端先发送已完成部分的 HTML 和 fallback，待边界内的数据就绪后，再发送边界 HTML 和替换 fallback 所需的指令。这种逐步发送 HTML 的过程称为 Streaming HTML。时序图展示了首批响应、边界内容到达以及 fallback 被替换的过程：

```d2 maxHeight=500
shape: sequence_diagram

server: 服务端
browser: 浏览器
runtime: Next.js 客户端运行时
flight: React Flight
react: React
dom: DOM

server -> server: 组件等待数据，Suspense 边界挂起
server -> browser: 发送已渲染 HTML、fallback 与首批 RSC chunk
browser -> dom: 解析 HTML，显示已有内容
browser -> runtime: 执行内联脚本，提交首批 RSC chunk
runtime -> flight: 解析首批 RSC chunk
flight -> react: 提供已还原的 React 元素
react -> dom: Hydrate 已就绪的 Client Component
server -> server: 数据就绪，继续渲染 Suspense 边界内容
server -> browser: 发送边界 HTML、RSC chunk 与插入指令
browser -> runtime: 执行流中的插入指令
runtime -> dom: 用边界 HTML 替换 fallback
runtime -> flight: 解析新增 RSC chunk
flight -> react: 提供边界内的 React 元素
react -> dom: Hydrate 边界内的 Client Component
```

下面通过一个页面示例具体说明这个过程。假设 `PostList` 是一个渲染时需要等待数据的 Server Component。

```tsx fold title="app/page.tsx"
import { Suspense } from 'react'

export default function Page() {
  return (
    <>
      <h1>博客</h1>
      <p>最新文章</p>
      <Suspense fallback={<p>正在加载文章...</p>}>
        <PostList />
      </Suspense>
    </>
  )
}
```

以这个 `Page` 为例，首次请求的处理过程如下：

1. 服务端先完成 Suspense 边界外的 `<h1>` 和 `<p>`，渲染到 `PostList` 时因等待数据而挂起，React 记录这个尚未完成的 Suspense 边界；
2. Suspense 输出 `<p>正在加载文章...</p>` 作为首批 HTML 的一部分。浏览器收到首批结果后，先显示「博客」「最新文章」和「正在加载文章...」；
3. 数据就绪后，服务端继续渲染 `PostList`，将 Suspense 边界内的 HTML、RSC chunk 和插入指令写入同一个响应；
4. 浏览器执行响应中附带的内联指令，用 `PostList` 的 HTML 替换加载提示。这一步不必等待 React 客户端代码加载，页面可以先显示完整内容；
5. Next.js 客户端运行时将新增的 RSC chunk 交给 React Flight 解析。若边界内包含 Client Component，待其客户端代码加载后，React 才会继续 Hydrate 这个边界，让 Host Fiber 匹配刚插入的 DOM，并恢复交互。

这个过程仍发生在同一次 HTTP 响应中，Next.js 只需在应用根节点调用一次 `hydrateRoot`。

### Selective Hydration

Streaming HTML 负责让边界内容分批到达浏览器，Selective Hydration 则负责安排这些内容何时变得可交互。当某个 Suspense 边界的 HTML、RSC 数据或 Client Component 代码尚未准备好时，React 可以暂缓这个边界，先 Hydrate 其它已经具备条件的内容。

多个 Suspense 边界同时具备 Hydration 条件时，React 会按优先级调度。如果用户在尚未 Hydrate 的边界内点击，React 会提高包含交互目标的边界优先级，优先完成该边界的 Hydration，再处理这次交互。

因此，页面可以在全部 HTML 到达前开始显示，也可以在整棵树 Hydrate 完成前响应用户交互。

### loading.tsx

`loading.tsx` 是 Next.js 提供的路由级加载约定。框架会在对应路由段自动创建 Suspense 边界，并将 `loading.tsx` 返回的 UI 作为 fallback，用来包裹页面及其子级。手写 `<Suspense>` 可以继续拆分页面内部的异步区域，提供更细粒度的 fallback。两者同时存在时，组件挂起后由离它最近的 Suspense 边界显示 fallback。

## 组件边界

前文已经从渲染流程中看到 Server Component 和 Client Component 的分工。下面回到代码层面，看看客户端边界如何形成，以及两类组件如何组合。

### 边界如何形成

App Router 中的组件默认是 Server Component。如果组件需要状态、事件处理、Effect 或浏览器 API 等客户端能力，就需要在文件顶部添加 `'use client'`。这个指令会将该文件标记为 Client Component 入口，并将该文件及其依赖纳入客户端模块图，客户端边界也由此形成。

因此，应尽量把边界贴近交互发生的位置。例如，布局中的 Logo 和导航结构可以保留为 Server Component，只把搜索框标记为 Client Component。边界放得越靠上，纳入客户端模块图的代码通常越多，需要发送和执行的客户端 JavaScript 也越多。

### 组件如何跨越边界

Server Component 可以渲染 Client Component。跨边界传递的数据会通过 props 进入 Client Component，因此这些 props 必须能被 React 序列化。普通函数不能直接跨越边界，Server Function 除外。

Client Component 不能直接导入 Server Component，也不能把依赖服务端能力的模块作为普通依赖引入。如果 Client Component 需要包含 Server Component 的内容，应由上层 Server Component 负责组合，再通过 `children` 等 props 传入：

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

在这个例子中，`Page` 是 Server Component，负责组合 `Modal` 和 `Cart`。`Modal` 只负责交互和展示 `children`，`Cart` 仍由服务端渲染，不会因为作为 `children` 传入而变成 Client Component。

### 特殊边界

除了通过 `'use client'` 建立组件边界，还可以通过模块标记限制运行环境，或通过动态导入跳过服务端预渲染。

`server-only` 和 `client-only` 用于限制模块的运行环境。数据库模块只能被服务端模块引用：

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

依赖状态、Effect 或浏览器 API，但没有声明 `'use client'` 的第三方组件，可以通过一个 Client Component 包装后再引入：

```tsx fold title="components/carousel.tsx"
'use client'

export { Carousel as default } from 'acme-carousel'
```

如果组件强依赖 `window`、`document`，只能在浏览器中运行，可以在 Client Component 中使用 `next/dynamic` 并配置 `ssr: false`，让它跳过服务端预渲染，在浏览器加载后再渲染：

```tsx fold title="components/article-editor.tsx"
'use client'

import dynamic from 'next/dynamic'

export const ArticleEditor = dynamic(() => import('./editor'), { ssr: false })
```

## 总结

Next.js App Router 的渲染由服务端和客户端共同完成。服务端生成 HTML 和 RSC payload，让浏览器先显示页面；Client Component JavaScript 加载后，React 通过 Hydration 恢复状态和交互。Suspense 边界让 HTML 输出和 Hydration 可以分段推进，组件边界则控制客户端模块图的范围。这几部分共同构成了 App Router 从请求到可交互页面的基本渲染过程。

## 参考资料

- [React Suspense 官方文档](https://react.dev/reference/react/Suspense#caveats)；
- [React 18 Suspense SSR 架构](https://github.com/reactwg/react-18/discussions/37#react-18-streaming-html-and-selective-hydration)；
- [React 源码：DOM 节点匹配入口](https://github.com/facebook/react/blob/172742b419bad2a79ac375c0d5ee15c7ac66bff2/packages/react-reconciler/src/ReactFiberHydrationContext.js#L461-L503)；
- [React 源码：DOM 类型检查](https://github.com/facebook/react/blob/172742b419bad2a79ac375c0d5ee15c7ac66bff2/packages/react-dom-bindings/src/client/ReactFiberConfigDOM.js#L3781-L3956)。
