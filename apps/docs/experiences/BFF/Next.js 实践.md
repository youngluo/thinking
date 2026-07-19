---
createdAt: '2026-07-19 22:07'
draft: true
---

# Next.js 实践

Next.js 16 拿到一个需求后，先定路由时机，再定数据缓存，最后定交互通道。本文按这个顺序展开。

所有内容以 `cacheComponents: true` 为前提。

## 目标画面

把六类常见页面先摆出来。后面每一节的判断，都回到这张表的某个格子。

| 场景       | 渲染时机              | 数据策略                       | 交互通道                              |
| ---------- | --------------------- | ------------------------------ | ------------------------------------- |
| 营销页     | Static                | 编译期可确定的纯输入           | 少量 Client Component（导航折叠、表单） |
| 文章详情   | Static 壳 + Cached    | `use cache` 缓存文章内容       | `generateStaticParams` 枚举 slug      |
| 商品列表   | PPR（静态壳 + 动态）  | `cacheLife('hours')` 缓存商品  | 用户态用 `<Suspense>` 隔离            |
| 个人中心   | Dynamic               | 读 `cookies()` / session       | 表单走 Server Action + `<form action>` |
| 后台管理   | 局部 CSR              | 客户端请求，必要时 `ssr: false`| Server Action 触发变更                |
| 实时仪表盘 | Dynamic               | 客户端订阅                     | Client Component 中 WebSocket         |

这张表不要求背。

## 渲染时机

看一段代码在服务端什么时刻被调用——构建期、缓存期、请求期——就决定了它的渲染模式。组件实际用了什么 API，就归入哪个时机，不用额外声明。

### API 决定时机

```ts
// 静态：只 await 编译期可确定的输入（同步 I/O、模块导入、纯计算）
import config from './config.json'
export default async function Page() {
  return <h1>{config.title}</h1>
}

// 缓存：用 use cache 标记，结果按 cacheLife 缓存
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

混合模式是常态：静态和动态片段共存，靠 Suspense 隔离。

### 三类渲染时机

| 渲染时机        | 何时执行                                  | 数据来源                                                      | 失效方式                            |
| --------------- | ----------------------------------------- | ------------------------------------------------------------- | ----------------------------------- |
| 静态（Static）  | 构建期                                    | 编译时已确定的输入                                            | 重新构建部署                        |
| 缓存（Cached）  | 构建期或首次请求，缓存到 cacheLife 过期   | 任意 async 工作                                               | 时间过期 / `revalidateTag` 主动失效 |
| 动态（Dynamic） | 每次请求                                  | `cookies()` / `headers()` / `searchParams` / 未缓存的 `fetch` | 不缓存                              |

PPR（Partial Prerendering）是 Cache Components 的默认行为：构建期生成静态壳，请求期把动态片段按 Suspense 边界流式拼到同一份响应里。

行为与传统术语的对应：

- **静态 → SSG**：构建期生成 HTML，失效靠重新构建部署
- **缓存 → ISR**：构建期或首次请求生成，按 `cacheLife` 时间过期或 `revalidateTag` 主动失效
- **动态 → SSR**：每次请求服务端渲染，不缓存
- **CSR**：服务端不输出 HTML 内容，纯浏览器渲染。在 App Router 中由 `'use client'` 组件 + `dynamic({ ssr: false })` 实现；它不在服务端执行，所以也不在三类渲染时机里

### 在静态页面中嵌入动态片段

要把用户态嵌进本来静态的路由，用 Suspense 把动态部分包起来：

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

`ThemeDisplay` 是动态片段，按 Suspense 边界流式到达。静态壳先发出，浏览器先画出 header，主题等用户态后补。这条机制落在目标画面的「商品列表」上。

### 强制推迟到请求期

某段代码无法在构建期完成，又不希望走 `use cache` 缓存（例如每次请求都要重新生成的非确定值），用 `connection()` 显式推迟：

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

`connection()` 让 React 推迟到请求期再执行这段组件，但不缓存结果——等价于强制走 Dynamic。和直接读 `cookies()` 的区别是：`connection()` 不依赖 request context。适合每次必须新生成、但不读用户态的场景，例如 A/B 测试桶、请求级 nonce。

### generateStaticParams 预渲染动态路由

构建期可枚举的动态路由，用 `generateStaticParams` 列出样本参数，让它们走构建期 prerender：

```tsx
// generateStaticParams 在构建期执行
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

`generateStaticParams` 返回的样本走构建期；运行时收到未在样本中的参数按动态路径处理。如果业务上不希望兜底，加 `export const dynamicParams = false`。这条机制落在目标画面的「文章详情」上（Static 壳 + Cached 内容）。

### 路由段配置

`page.tsx` / `layout.tsx` 等文件里可以导出的少量路由级配置，主要与部署和动态参数控制相关，不影响渲染时机：

| 配置              | 用途                                                           |
| ----------------- | -------------------------------------------------------------- |
| `dynamicParams`   | 控制 `generateStaticParams` 未覆盖的动态参数是否允许运行时渲染 |
| `runtime`         | 选择 `nodejs` 或 `edge` 运行时                                 |
| `preferredRegion` | 提示首选部署区域                                               |
| `maxDuration`     | Server Action / Route Handler 的最长执行时间                   |

**本节判断**：读到 `cookies()` / `headers()` / `searchParams` / `connection()` → Dynamic；读到 `use cache` → Cached；可枚举的纯输入 → Static + `generateStaticParams`。

## 数据获取与缓存

数据策略要分清两件事：作用域（请求内还是跨请求）和持久性（进程内存还是平台持久）。同一份数据在不同作用域应该走不同 API，否则要么每次都查，要么把不该共享的用户态数据意外共享出去。

### 三类作用域

| API                  | 作用域                   | 持久性                | 适用场景                                |
| -------------------- | ------------------------ | --------------------- | --------------------------------------- |
| React `cache()`      | 单次请求内               | 进程内存              | 多组件请求内共享一份数据                |
| `use cache`          | 跨请求，按入参生成缓存键 | 进程内存（默认）      | 跨请求复用、入参稳定的新代码            |
| `use cache: remote`  | 跨请求，按入参生成缓存键 | 平台提供（如 Redis）  | 跨请求复用、必须跨实例持久              |
| `unstable_cache`     | 跨请求，按入参生成缓存键 | 进程内存              | 维护老代码、无法立刻迁移                |

四者的边界：

- React `cache()` 是**请求内去重**，多个组件在同一棵 RSC 树内调用同一份逻辑时用：

  ```ts
  import { cache } from 'react'

  export const getUser = cache(async () => {
    const res = await fetch('https://api.example.com/user')
    return res.json()
  })
  ```

- `use cache` 是**新版跨请求缓存**，需要 `cacheComponents: true`。同一段逻辑、不同入参分别缓存。默认 in-memory，serverless 不会跨实例持久。
- `use cache: remote` 是 `use cache` 的持久版本，由平台提供 Redis 之类的后端；通常意味着额外的网络往返与平台费用，适合高价值缓存。
- `unstable_cache` 是**旧版跨请求缓存 API**，新项目应该用 `use cache` 替代；只有维护老代码、没法立刻迁移时才继续使用。

> 新项目的默认选择：请求内用 `cache()`，跨请求用 `use cache`；只有明确需要跨实例持久且能接受平台开销时升级到 `use cache: remote`。

### fetch 在 Next.js 16 的默认行为

Server Component 可以直接 await 数据源：

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

注意：Next.js 16 中 `fetch` 默认不再缓存，每个请求都会重新发起——这是和 Next.js 14 的关键差异，迁移老代码时最容易踩坑。需要缓存时显式用 `use cache` 包裹。

请求内自动去重仍然生效：同一棵 RSC 树内对相同 URL 与相同 fetch options 的多次调用只会发一次请求。跨请求共享需要显式使用 `use cache`。

### use cache 指令

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

`cacheLife('hours')` 使用内置的 `hours` 档位（具体值随版本变化，使用前查官方文档）；`cacheTag('products')` 给该缓存打上标签，便于按标签失效。

启用方式：

```ts
// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  cacheComponents: true,
}

export default nextConfig
```

### cacheLife 与内置档位

```ts
import { cacheLife } from 'next/cache'

export async function getProducts() {
  'use cache'
  cacheLife('hours')
  // ...
}
```

`cacheLife` 接受字符串档位或自定义对象。Next.js 默认提供 `default`、`minutes`、`hours`、`days`、`weeks`、`max` 等档位。每个档位包含三个时间维度：

- `stale`：浏览器缓存视为新鲜的最长时间
- `revalidate`：服务器缓存过期时长
- `expire`：缓存彻底失效的时长

### cacheTag 与失效

```ts
import { cacheTag } from 'next/cache'

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
  const name = formData.get('name') as string
  await db.products.create({ data: { name } })
  updateTag('products')
}
```

`updateTag` 让当前请求立刻看到最新数据，并使所有持有 `products` 标签的缓存失效。`revalidateTag` 类似但不会立即重渲染当前路由。失效策略落在目标画面的「商品列表」上。

### 运行时数据与 use cache 的边界

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

### 请求隔离

浏览器应用只服务当前用户，可以用模块级单例；Next.js 服务端会连续处理多个用户请求，但模块只初始化一次。

```ts
let requestCount = 0

export async function GET() {
  requestCount += 1
  return Response.json({ requestCount })
}
```

请求 A 写入 `requestCount = 1`，请求 B 会读到 `requestCount = 2`。写用户相关可变数据的模块级变量会跨请求污染——需要跨请求共享时用上面的缓存 API，不要用模块级变量。

**本节判断**：同一请求内多组件共享一份数据 → `cache()`；跨请求复用、入参稳定 → `use cache` + `cacheLife`；明确要跨实例持久且能承担平台开销 → `use cache: remote`；老项目无法迁移 → `unstable_cache`。

## Server Actions

Server Action 是带 `'use server'` 指令的 async 函数。它最契合的场景是表单驱动的服务端变更。

### 定义与调用

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

表单提交走单次服务端往返：服务端执行 action、返回新的 RSC payload、客户端更新视图。即使 JavaScript 加载失败，表单仍然可以提交——这是渐进增强的核心。这条机制落在目标画面的「个人中心」上。

### useActionState 与 pending 态

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

`useActionState` 返回 `[state, action, pending]`。`pending` 在 action 执行期间为 true——按钮 `disabled` 应该绑在 `pending` 上，避免用户重复提交。

### 缓存失效

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

四个失效 API 的差异：

- `revalidatePath(path)`：按路径失效路径下的缓存。粗粒度，但语义直接。
- `revalidateTag(tag)`：按 tag 失效所有持该 tag 的缓存。细粒度，跨路径生效。
- `updateTag(tag)`：`revalidateTag` 的升级版，失效并让当前路由立即重渲染。
- `refresh()`：仅刷新 router cache（客户端 RSC 缓存），服务器缓存不动。

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
- 客户端派发与等待是串行的，不适合并行触发多个互不依赖的变更；
- 不直接返回非可序列化值（函数、Symbol、循环引用等），需要通过 `useActionState` 把状态序列化进响应；
- 与 `<form>` 原生配合最好；事件处理器中调用应该用 `useTransition` 或 `useActionState` 处理 pending。

### 替代方案

不是所有变更都该走 Server Action。出现下面任意一种信号时，考虑用 Route Handler + Client Component 替代：

- 同一变更需要并行触发多个独立请求；
- 客户端需要轮询进度或长连接（SSE、文件上传进度）；
- 端点需要被非表单来源调用（外部 webhook、第三方 SDK、移动端原生壳）。

## 实践中的常见问题

按问题所属阶段分三组：渲染阶段、数据阶段、交互阶段。

### 渲染阶段

**'use client' 写在顶层**：整棵应用退化为 Client Component。首屏 HTML 仍然会渲染，但不再有意义——因为内容依赖客户端 JS。解决：把 `'use client'` 下移到具体叶子组件，让 layout、page、数据获取保持 Server Component。

**RSC payload 过大**：RSC payload 是响应体的一部分，浏览器需要下载、解析、保留。Server Component 中如果把整张表传给页面，payload 会迅速膨胀：

```tsx
export default async function Page() {
  const all = await db.query('SELECT * FROM large_table')
  return <Table rows={all} />
}
```

常见做法：

- 服务端做聚合、分页后只传渲染需要的字段；
- 列表通过分页或滚动加载按需取；
- 大对象作为 Server Component 内部状态而非 props 透传。

**把 SSR 当成性能保证**：Cache Components 默认走 PPR，静态壳构建期生成，动态片段请求期到达：

- 静态壳足够快时，TTFB 主要由动态片段决定；
- 动态片段串行调用多个慢接口会让用户更晚看到完整内容；
- `<Suspense>` 只能解耦渲染时机，不能让数据本身变快；
- 监控 TTFB、LCP、INP、服务端错误率，再决定是否上 `use cache` 或调整缓存档位。

### 数据阶段

**缓存了不该共享的内容**：

```tsx
// 错误：在 Server Component 中读 cookie 但被 use cache 标记
export async function Page() {
  'use cache'
  const theme = (await cookies()).get('theme')?.value
  return <p>{theme}</p>
}
```

`use cache` 内不能直接读 `cookies()`，即使能编译通过也会把所有用户的 `theme` 当成同一份缓存。正确做法是把运行时数据作为参数传入缓存函数，或放在 `<Suspense>` 边界内按请求动态生成。

**fetch 默认不再缓存**：Next.js 14 中 `fetch` 默认会被框架缓存；Next.js 16 默认不再缓存，每次请求都会重新发起。需要缓存时显式使用 `use cache`。

**第三方库忘记包 Client 边界**：未自带 `'use client'` 的库（例如老的图表、富文本）在 Server Component 中直接使用会在编译期或运行期报错。解决办法是在项目里写一个 `'use client'` 的包装文件，让目标模块进入客户端模块图。

### 交互阶段

**Server Action 重复提交**：按钮没有禁用态时，用户可能多次点击导致 action 重复执行：

```tsx
'use client'

import { useActionState } from 'react'
import { createPost } from './actions'

export function NewPostForm() {
  const [state, action, pending] = useActionState(createPost, { ok: false })
  return (
    <form action={action}>
      <button type="submit" disabled={pending}>
        {pending ? '提交中...' : '提交'}
      </button>
    </form>
  )
}
```

`pending` 是判断按钮 `disabled` 的标准信号。

**`useEffect` 中调用 Server Action**：

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

回到目标画面那张表，这里把判断维度拆开成四张子表。

### 路由维度：渲染时机

| 场景                       | 渲染模式                                                  |
| -------------------------- | --------------------------------------------------------- |
| 内容构建期确定且可枚举     | Static（`generateStaticParams` 列出全部样本）             |
| 内容公共但会定期更新       | Cached（`use cache` + `cacheLife`）                       |
| 内容依赖请求身份或实时数据 | Dynamic（runtime API 或未缓存 fetch）                     |
| 公共壳 + 个性化片段        | PPR 默认（静态壳 + Suspense 隔离动态）                    |
| 不要求 SEO 的重交互后台    | 局部 CSR（`'use client'` 或 `dynamic({ ssr: false })`）   |

### 组件维度：执行位置

| 场景                                       | 组件类型                                                  |
| ------------------------------------------ | --------------------------------------------------------- |
| 数据获取、静态结构、SEO 内容               | Server Component（默认）                                  |
| 状态、事件处理、浏览器 API                 | Client Component（`'use client'`）                        |
| 强依赖 `window` / `document`，无服务端降级 | 隔离为 Client Component，必要时 `dynamic({ ssr: false })` |
| 表单与服务端变更                           | Server Action + `<form action>`                           |
| Provider、Context                          | 包成 Client Component 后在 Server Component 中透传        |

### 数据维度：缓存 API 选择

| 场景                                       | API                              |
| ------------------------------------------ | -------------------------------- |
| 同一请求内多组件共享一份数据               | React `cache()`                  |
| 跨请求复用、入参稳定、in-memory 即可       | `use cache` + `cacheLife`        |
| 跨请求复用、必须跨实例持久                 | `use cache: remote`              |
| 老项目无法立刻迁移                         | `unstable_cache`                 |

### 交互维度：Server Action 适用性

| 场景                                       | 通道                                  |
| ------------------------------------------ | ------------------------------------- |
| 表单驱动的服务端变更、单一请求             | Server Action + `<form action>`       |
| 需要并行触发多个互不依赖的变更             | Route Handler + 客户端并行请求        |
| 需要轮询、进度、长连接（SSE、上传进度）    | Route Handler + Client Component      |
| 端点需要被非表单来源调用                   | Route Handler                         |

选型分三步：先决定路由按什么时机生成 HTML，再决定组件在哪一侧执行，最后决定数据走哪一层缓存 API。三者交叉后才是项目的实际表现。Server Action 是叠加在交互层的可选通道，按表单场景决定是否启用。

## 总结

1. 渲染时机由 API 决定：`cookies()` / `headers()` / `searchParams` / `connection()` 落 Dynamic，`use cache` 落 Cached，其余纯输入落 Static；混合模式用 `<Suspense>` 隔离。
2. 数据按作用域缓存：请求内用 `cache()`，跨请求用 `use cache`，跨实例持久用 `use cache: remote`；运行时数据必须穿透缓存边界，不能进入 cache key。
3. Server Action 是表单优先的服务端变更通道：配合 `<form action>` 和 `useActionState` 处理 pending；并行、轮询、外部端点等场景用 Route Handler 替代。