---
createdAt: '2026-07-19 22:07'
draft: true
---

# Next.js 实践

在 Next.js 应用中，服务端读到的数据未必会被后续请求复用，数据库写入成功后，页面也可能继续显示旧结果。做好应用，需要把读取、缓存、界面更新和组件交互一起设计。

本文以 Next.js 16.4 App Router 和已启用的 Cache Components 为前提，讨论数据读写与交互实践。默认行为负责组织页面，配置和 API 则用于控制数据新鲜度、请求依赖与运行成本。

## 默认行为

App Router 中的组件默认按 Server Component 处理。启用 Cache Components 后，构建时能确定的结构和缓存结果组成页面的预渲染部分，未缓存的异步读取与请求期内容通过等待边界接入。已有内容可以先呈现，避免整个页面等待最慢的读取。

新项目推荐开启这一模型；现有项目应核对 next.config.ts，显式设置 Cache Components 与导航的部分预取：

```ts fold title="next.config.ts"
export default {
  cacheComponents: true,
  partialPrefetching: true,
}
```

`partialPrefetching` 控制 `<Link>` 的默认预取范围。开启后，Next.js 会提前获取目标路由中不依赖具体 URL 的可复用页面部分；依赖路径参数或查询参数的内容，通常等导航时再获取。多个链接指向同一路由时可以共用这份预取结果；需要额外预取已缓存的 URL 相关内容时，可对单个链接设置 `prefetch={true}`。

### 页面与数据

Server Component 可以直接调用数据库、服务端 SDK 或 `fetch` 获取数据。通常不必先创建 Route Handler 再通过 HTTP 调用自己，这样减少一次内部往返，也让凭证和数据访问逻辑留在服务端。

服务器端 `fetch` 默认不会跨请求缓存结果。外部 HTTP 数据可封装为异步函数，在其中检查响应状态并解析结果：

```ts fold title="lib/data.ts"
export async function loadData() {
  const response = await fetch('https://api.example.com/data')
  if (!response.ok) throw new Error('数据读取失败')
  return response.json()
}
```

需要跨请求复用结果时，再显式设置缓存。数据库或 SDK 查询也应按共享范围判断，服务端执行本身不会为它们添加持久缓存。

### 加载与失败

未缓存的异步读取需要 `<Suspense>` 边界。`AsyncContent` 代表调用 `loadData` 的异步服务端组件，父组件的渲染片段用 fallback 提供等待界面：

```tsx fold
<Suspense fallback={<p>加载中...</p>}>
  <AsyncContent />
</Suspense>
```

页面级等待界面可用 `loading.tsx`，局部慢内容用靠近读取位置的 `<Suspense>`。等待界面应保留结构，标明尚未完成的部分。

未处理的渲染异常由最近的 `error.tsx` 边界处理。Next.js 要求错误边界是 Client Component，因此文件开头需要声明 `'use client'`。资源不存在时，用 `notFound()` 终止路由段渲染并显示不存在界面。分别处理空结果、不存在和读取失败，避免把上游故障显示成正常空列表。

### 客户端交互

需要状态、事件或浏览器 API 时，使用 `'use client'` 建立客户端边界。入口导入的依赖也会进入客户端模块图，因此边界应靠近交互，静态结构和读取留在服务端。

Client Component 仍参与首屏预渲染，浏览器 API 应在事件处理或 Effect 中访问。首屏数据优先由 Server Component 读取并传入；轮询、订阅或随交互请求时，再使用客户端数据层。

### 表单提交

表单可直接绑定 Server Action，提交的字段会作为 `FormData` 传入。由 Server Component 渲染的表单即使 JavaScript 尚未加载也能提交。需要把校验结果显示在页面上，并提示提交进度时，用 `useActionState` 包装 Action。它会把上次返回的状态和本次提交的 `FormData` 依次传给 Action，并返回当前状态、供表单绑定的 `action` 和表示是否正在提交的 `pending`。

下面的 Server Action 检查权限、校验 `value` 并写入数据。这里不需要上次状态，因此第一个参数 `_previousState` 不会使用；校验提示和保存结果作为新状态返回：

```ts fold title="app/actions.ts"
'use server'

import { requireWritePermission, writeValue } from '@/lib/data'

type State = { message: string }

export async function submitWithState(
  _previousState: State,
  formData: FormData,
): Promise<State> {
  await requireWritePermission()
  const value = formData.get('value')
  if (typeof value !== 'string' || !value.trim()) {
    return { message: '内容不能为空' }
  }

  await writeValue(value.trim())
  return { message: '已保存' }
}
```

客户端表单把返回的 `action` 绑定到 `<form>`，用 `pending` 控制按钮，用 `state.message` 显示 Action 返回的结果：

```tsx fold title="app/form.tsx"
'use client'

import { useActionState } from 'react'
import { submitWithState } from './actions'

export function Form() {
  const [state, action, pending] = useActionState(submitWithState, { message: '' })
  return (
    <form action={action}>
      <input name="value" required />
      <button type="submit" disabled={pending}>
        {pending ? '提交中...' : '提交'}
      </button>
      <p aria-live="polite">{state.message}</p>
    </form>
  )
}
```

校验错误作为状态返回，未预期异常交给错误边界。传给 Server Action 的参数和返回状态需要可序列化。把 `action` 直接绑定到表单时不需要额外处理；若从普通事件处理器手动调用，则用 `startTransition` 包裹调用。页面若展示缓存数据，写入成功后还需更新缓存，避免继续显示旧内容。

### 提交安全

用户可以绕过表单直接请求 Action，每次执行都要在服务端检查会话、权限和输入。隐藏按钮、`required` 和禁用按钮不能替代授权与校验，也不能保证写入只执行一次。不能重复执行的操作需要幂等键或唯一约束。

需要外部服务调用、客户端并行读取、轮询、上传进度或长连接时，优先采用 Route Handler 等独立接口。Server Action 面向变更，不适合作为通用读取接口；通过 `useEffect` 在挂载时写入，还要处理重复执行的问题。

## 按需配置

配置由共享范围、新鲜度和请求依赖决定。可共享的数据减少重复读取，写入后的结果及时更新，用户相关内容保留请求期检查，才能在复用结果时维持正确的可见范围。

### 缓存与更新

多个请求读取同一份未缓存数据时，会重复访问数据源。用 `'use cache'` 标记可复用的函数或组件，用 `cacheLife` 声明时效。缓存数据函数后，界面仍按请求组合；缓存组件则连同输出一起复用。

下面按 `key` 区分结果，用 `hours` 档位设置时效，`data` 标签用于写入后统一更新这组结果：

```ts fold title="lib/cached-data.ts"
import { cacheLife, cacheTag } from 'next/cache'

export async function readCachedValue(key: string) {
  'use cache'
  cacheLife('hours')
  cacheTag('data')

  const response = await fetch(`https://api.example.com/data/${encodeURIComponent(key)}`)
  if (!response.ok) throw new Error('数据读取失败')
  return response.json()
}
```

参数和捕获的值参与缓存键，输入与输出需满足序列化要求。不同输入对应不同条目，标签用于关联条目。时效不能保证用户立即看到刚写入的数据。

数据库写入成功而缓存仍有效时，页面会继续读取旧值。先完成写入，再按更新范围和时效选择 API：

| 更新需求 | API | 行为与边界 |
| --- | --- | --- |
| 更新指定页面或布局 | `revalidatePath(path)` | 重新验证指定路径；在 Server Action 中可更新正在访问的目标页面 |
| 写入后立即读取新值 | `updateTag(tag)` | 立即过期标签缓存，下一次读取等待新结果；仅用于 Server Action |
| 允许先展示旧值再更新 | `revalidateTag(tag, 'max')` | 后续读取触发后台更新；可用于 Server Action 或 Route Handler |
| 重新读取当前页面 | `refresh()` | 仅用于 Server Action；刷新客户端路由，服务端缓存仍可能命中 |

标签必须先通过 `cacheTag` 绑定。同一份数据被多个页面复用时，按标签更新相关条目；按路径更新不会替代跨页面的标签更新，刷新路由也不等于使数据缓存失效。

### 请求期内容

`cookies()`、`headers()` 和页面的 `searchParams` 依赖当前请求。把读取位置放进局部 `<Suspense>`，公共结构和共享数据仍能预渲染或缓存，用户相关内容则在请求期生成。

普通缓存边界内不能直接读请求数据。缓存用户相关结果时，先在缓存外验证会话，再传入用户标识。`verifySession` 验证会话，`getProfile` 读取该身份可见的信息，父组件为 `RequestContent` 提供 `<Suspense>` 边界：

```tsx fold title="app/request-content.tsx"
import { cookies } from 'next/headers'
import { cacheLife } from 'next/cache'
import { verifySession } from '@/lib/auth'
import { getProfile } from '@/lib/data'

export async function RequestContent() {
  const token = (await cookies()).get('session')?.value
  const session = await verifySession(token)
  if (!session) return <p>未登录</p>

  const profile = await cachedProfile(session.userId)
  return <p>{profile.displayName}</p>
}

async function cachedProfile(userId: string) {
  'use cache'
  cacheLife('minutes')
  return getProfile(userId)
}
```

会话和可能变化的权限应在每次请求中检查，命中缓存不能代替授权。决定结果可见范围的输入必须进入缓存键，用户 ID 也不能直接取自未经验证的客户端参数。

用户状态保存在请求上下文或局部变量中。若请求 A 把用户写入模块级变量后等待异步读取，B 可能覆盖它，A 恢复时就会读到 B 的用户。模块级可变状态不能承担请求隔离，跨请求状态交给数据库等存储。

### 路由预生成

导出 `generateStaticParams`，可让已知路径在构建时预渲染。路径多时只提供常用参数，控制构建成本；其它参数在请求时处理，读取放进 `<Suspense>` 或 `loading.tsx` 边界。

下面为两个 `slug` 提供构建参数，页面通过异步 `params` 读取当前值：

```tsx fold title="app/[slug]/page.tsx"
export function generateStaticParams() {
  return [{ slug: 'intro' }, { slug: 'api' }]
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <h1>{slug}</h1>
}
```

在当前 Cache Components 模型中，该函数至少返回一组参数，空数组会导致构建报错；`dynamicParams` 配置不可用。业务只接受固定路径集合时，在运行时校验参数并用 `notFound()` 处理无效值。提前生成参数不代表对应的数据读取也已缓存，数据时效仍需独立设计。

## 高阶 API

基本缓存与请求边界确定后，可进一步控制缓存时效、同步值的生成时机和存储位置，分别满足新鲜度、预渲染与跨实例复用的要求。

### 缓存时效

`cacheLife` 放在声明缓存的函数或组件中，接受内置档位或自定义对象。未显式设置时使用 `default` 档位；其它内置档位包括 `seconds`、`minutes`、`hours`、`days`、`weeks` 和 `max`。项目可以覆盖档位，因此不能仅凭名称推断精确时长。

自定义时效用于分别控制客户端复用、服务端后台更新和等待新结果的期限，参数单位为秒：

| 参数 | 控制范围 | 未覆盖的 default 档位 |
| --- | --- | --- |
| `stale` | 客户端可直接复用结果而不检查服务端的时间 | 300 秒 |
| `revalidate` | 超过该时间后，后续请求触发服务端后台更新 | 900 秒 |
| `expire` | 缓存过期且尚未更新时，后续读取要等待新结果 | 不因时间过期 |

在已有缓存函数中替换档位调用。结果生成或更新后，超过 15 分钟的读取触发后台更新；若 1 小时仍未更新，读取要等待新结果：

```ts fold
cacheLife({ stale: 300, revalidate: 900, expire: 3600 })
```

同时配置时，`expire` 必须大于 `revalidate`，Next.js 会拒绝无效组合。时间重新验证由后续请求触发，不是固定时刻运行的定时任务。`revalidate` 为 0 或 `expire` 小于 5 分钟时，缓存内容不进入预渲染输出，需要 `<Suspense>` 等待边界。

### 渲染控制

同步读取时间、随机数或同步数据库时，需要决定结果是在预渲染时生成并复用，还是在运行时生成。允许复用的结果放进 `'use cache'`；需要排除预渲染时，在未缓存的服务端组件中先调用 `io()`：

```tsx fold
import { io } from 'next/cache'

async function GeneratedAt() {
  await io()
  return <p>{new Date().toISOString()}</p>
}
```

父组件用 `<Suspense>` 包裹 `GeneratedAt`。`io()` 允许内容参与运行时预取；必须等到真实用户请求才生成时，使用 `next/server` 中的 `connection()`，代价是这部分内容不能提前预取。普通异步取数或已读取请求 API 的组件通常不需要额外调用它们。

依赖在模块初始化时访问 `window` 或 `document`、无法服务端执行时，在 Client Component 中用 `next/dynamic` 配置 `ssr: false`。对应内容会等待客户端 JavaScript，适合受浏览器环境限制的依赖。控制调用应靠近实际需要的位置，避免把无关内容一起推迟。

### 多实例缓存

请求期才生成的普通 `'use cache'` 结果默认保存在实例内存中。请求从实例 A 切到实例 B 时可能重新读取，serverless 实例销毁后也不保证缓存仍在；本地命中不能证明生产环境能跨实例复用。

共享高成本结果时，使用 `'use cache: remote'`。未配置处理器时仍使用内存缓存，指令本身不会接入共享存储。平台需提供兼容处理器；自行部署时，在 next.config.ts 的 `cacheHandlers.remote` 指定模块，再修改缓存指令。重启或部署后生效，处理器需支持存储、过期和跨实例标签更新。

缓存键包含已配置的 `deploymentId`，否则使用 `buildId`。新的部署或构建标识产生新键，旧版本条目不再命中，发布后的首次读取仍可能访问上游。

远程缓存增加网络与存储成本，输入几乎每次都不同、或数据源足够快时，可能没有收益。上线前检查命中率、上游耗时和跨实例更新；改回 `'use cache'` 可退回实例内缓存，也会恢复实例切换造成的重复读取。

## 性能优化

缓存减少上游读取，页面仍可能等待大包下载或主线程执行。先分别测量服务端、客户端与资源加载的耗时，再选择优化措施，才能判断改动是否有效。

### 性能定位

在生产构建产物上测量，固定路由、设备、网络和数据规模。服务端追踪查看查询与接口耗时，浏览器 Performance 和 Network 面板观察资源与长任务；指标提示排查方向：

| 观察信号 | 优先检查 |
| --- | --- |
| TTFB 偏高 | 网络往返、服务端排队、渲染与上游读取耗时 |
| LCP 偏慢 | 关键内容的数据等待、图片发现与下载、渲染阻塞 |
| INP 偏高 | 交互期间的长任务、事件处理与渲染工作 |
| CLS 偏高 | 图片、字体和异步内容是否改变已有布局 |

实验室测试用于复现和比较，真实用户数据用于确认设备与网络差异。可通过 `useReportWebVitals` 上报浏览器指标，并按路由和设备类型观察分布。优化后同时比较耗时、传输量和服务端负载，避免把成本转移到另一端。

### 读取性能

互不依赖的读取若连续 `await`，后一项会等待前一项完成。先同时发起，再一起等待，可以减少这段串行等待；确实依赖前一项输出的读取仍要串行：

```ts fold
const [settings, summary] = await Promise.all([
  loadSettings(),
  loadSummary(),
])
```

同一查询被多个 Server Component 调用时，用 React `cache()` 在一次服务端渲染中去重。假设 `queryById` 是数据库查询，导出同一个包装函数供组件调用：

```ts fold title="lib/query.ts"
import { cache } from 'react'
import { queryById } from './db'

export const readById = cache(async (id: string) => queryById(id))
```

这不跨请求复用结果，相同参数才能命中，对象参数按引用比较。不要在每个组件内重新创建包装函数，否则调用无法共享同一缓存。

批量读取限制并发，避免超过连接数或限流约束；查询优先分页、筛选或聚合，只向客户端传必要字段。慢读取用局部 `<Suspense>` 避免阻塞其它内容，但等待界面不会缩短数据源耗时。

### 客户端开销

Turbopack 项目用 `next analyze`，Webpack 项目用 `@next/bundle-analyzer`，按路由追踪大模块的导入链，再决定移到服务端、缩小导入范围或按需加载。

静态 Markdown 解析或代码高亮放在 Client Component 中，会让浏览器下载并执行对应依赖。不需要交互或浏览器 API 的工作，可移到 Server Component，让客户端接收呈现结果。

交互后才使用的大组件或依赖可动态导入，减少首屏下载与执行量，但首次使用要提供等待反馈。包体积降低后若 INP 仍高，继续检查事件处理与渲染长任务。

### 导航与资源

内部跳转使用 `<Link>`，保留客户端导航与预取能力。大量链接同时出现、目的页面读取成本又高时，可按访问概率设置 `prefetch={false}`，减少后台请求；代价是点击后等待更多内容。预取范围应同时观察导航延迟和服务端负载。

图片优先使用 `next/image`，通过尺寸或有明确尺寸的 `fill` 容器预留空间，响应式图片补充准确的 `sizes`，避免下载过大的资源。关键首屏图不要机械地懒加载，非首屏图片再延后获取。

字体用 `next/font` 自托管，避免浏览器访问外部字体服务。第三方脚本用 `next/script` 按用途选择时机，不参与首屏的脚本可用 `lazyOnload` 延后到浏览器空闲时加载。

## 参考资料

- [数据获取](https://nextjs.org/docs/app/getting-started/fetching-data)；
- [数据变更与表单](https://nextjs.org/docs/app/getting-started/mutating-data)；
- [缓存与预渲染](https://nextjs.org/docs/app/getting-started/caching)；
- [缓存更新](https://nextjs.org/docs/app/getting-started/revalidating)；
- [API 参考](https://nextjs.org/docs/app/api-reference)；
- [生产优化实践](https://nextjs.org/docs/app/guides/production-checklist)。
