---
createdAt: '2026-07-19 22:07'
draft: true
---

# Next.js 实践

Next.js 把组件渲染、数据缓存和服务端变更交给不同的机制处理。数据可以在服务端读取，却未必能跨请求复用；数据库写入已经成功，页面也可能继续显示旧结果。做好应用，需要把组件边界、数据新鲜度和变更后的更新方式一起设计。

本文以 Next.js 16.4 App Router 为基准，从默认行为开始，说明如何组织数据与交互、定制缓存和渲染，再处理请求隔离与部署约束。新项目推荐开启 Cache Components，手动创建或升级的项目应先核对配置。

## 默认行为

App Router 中的组件默认按 Server Component 处理。数据读取和静态结构优先留在服务端；需要状态、事件或浏览器 API 时，使用 `'use client'` 为相应组件建立客户端边界。

### 页面与数据

Server Component 可以直接调用数据库或服务端 SDK 获取数据。在同一应用中读取服务端数据时，通常不必先创建 Route Handler 再通过 HTTP 调用自己；这样可以减少一次内部往返，也能让凭证和数据访问逻辑留在服务端。

启用 Cache Components 后，服务器端 `fetch` 默认不会跨请求复用结果。外部 HTTP 数据可以封装为异步函数，并在其中检查响应状态、解析结果：

```ts fold title="lib/data.ts"
export async function loadData() {
  const response = await fetch('https://api.example.com/data')
  if (!response.ok) throw new Error('数据读取失败')
  return response.json()
}
```

需要跨请求复用 `loadData` 的结果时，可在函数中添加 `'use cache'`，并用 `cacheLife` 设置缓存时效。

### 加载与失败

启用 Cache Components 时，未缓存的异步读取需要 `<Suspense>` 边界。假设 `AsyncContent` 是调用 `loadData` 的服务端组件，父组件用 fallback 提供等待界面：

```tsx fold
<Suspense fallback={<p>加载中...</p>}>
  <AsyncContent />
</Suspense>
```

页面级等待界面可以使用 `loading.tsx`，局部慢内容使用更靠近读取位置的 `<Suspense>`。未处理的渲染异常由最近的 `error.tsx` 边界提供异常界面，该文件需要声明 `'use client'`；确认资源不存在时用 `notFound()` 终止当前路由段的渲染，显示不存在界面。等待、空结果和异常分别处理，避免把所有失败都显示成空列表。

### 客户端交互

在需要交互的组件入口添加 `'use client'`，避免把无关依赖纳入客户端模块图。Client Component 仍会参与首屏预渲染，访问浏览器 API 的时机也要放在事件处理或 Effect 中；组件必须完全依赖浏览器环境时，再考虑跳过服务端预渲染。

首屏数据优先在 Server Component 中读取。客户端需要轮询、订阅或跟随交互重新请求时，再使用客户端数据层；不要为了读取首屏数据，把整个页面搬到客户端。

### Server Action

Server Action 适合表单驱动的服务端变更。普通 `<form action>` 会直接传入 `FormData`；服务端组件中的表单在 JavaScript 尚未加载时也能提交。

需要向表单返回校验状态时，Server Action 可与 `useActionState` 配合。下面先定义服务端 Action，后文再将它接入表单；`requireWritePermission` 和 `writeValue` 分别代表项目中的权限检查和数据写入：

```ts fold title="app/actions.ts"
'use server'

import { revalidatePath } from 'next/cache'
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
  revalidatePath('/editor')
  return { message: '已保存' }
}
```

### 表单状态

需要提交状态和校验反馈时，使用 `useActionState`。它会把上一次状态作为 Action 的第一个参数，把表单数据作为第二个参数。客户端表单使用返回的 action，并根据状态展示反馈：

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

输入错误等可预期失败通过状态返回，未预期异常交给异常处理机制。`useActionState` 不会转换不可序列化数据，参数和返回值仍需符合 React Server Functions 的序列化要求。从普通事件处理器派发 action 时，还要用 Action 或 Transition 管理提交上下文。

### 提交安全

Action 可被直接请求，每次执行都要在服务端检查会话、权限和输入。前端隐藏按钮或设置 `required` 不能代替这些检查。`pending` 禁用按钮只能减少重复点击，不能保证写入只执行一次；不能重复执行的操作需要服务端幂等键或唯一约束。

需要外部服务调用、客户端并行请求、轮询、上传进度或长连接时，优先使用 Route Handler。Server Action 面向服务端变更，不适合作为通用读取接口；挂载时通过 `useEffect` 触发写入，还要处理重复执行的问题。

## 按需定制

默认的数据读取与提交方式确定后，再按读取开销、共享范围、新鲜度和请求依赖定制行为。可复用的数据、当前用户的数据以及必须实时生成的内容，需要分别确定边界。

### 读取性能

互不依赖的读取优先同时发起，再等待结果；后一项依赖前一项的输出时，需要串行执行：

```ts fold
const [settings, summary] = await Promise.all([
  loadSettings(),
  loadSummary(),
])
```

批量读取要限制并发，避免超过数据源的连接数或限流约束。查询时优先分页、筛选或聚合，并只向客户端返回必要字段，以减少下载和解析开销。

排查性能问题时，结合服务端耗时、核心内容出现时机和交互长任务定位瓶颈。`<Suspense>` 只决定等待界面的呈现，不会缩短数据源耗时。

### 缓存与更新

缓存应放在结果允许复用、且能明确输入的读取或计算上。先确认它是一次渲染内的重复调用，还是需要跨请求复用；再确定缓存键、生命周期，以及写入后的更新方式。

Cache Components 模型下，用 `'use cache'` 标记可复用的函数或组件。下面按 `key` 缓存读取结果，并为这类结果添加更新标签：

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

不同 `key` 对应不同缓存条目。`hours` 使用项目配置的档位，规定后台重新验证和最终过期的时机，不能当作精确的新鲜度保证。读写要求一致时，才能选择适合的档位；需要立即看到刚写入的数据时，还应主动更新缓存。

更新 API 按范围和时效选择，标签必须先绑定到缓存：

| 更新需求 | API | 行为与边界 |
| --- | --- | --- |
| 更新指定页面或布局 | `revalidatePath(path)` | 重新验证指定路径；在 Server Action 中可同步更新正在访问的目标页面 |
| 用户写入后立即读取新值 | `updateTag(tag)` | 立即过期标签缓存，下一次读取等待新结果；仅用于 Server Action |
| 内容更新允许短暂延迟 | `revalidateTag(tag, 'max')` | 后续读取可先返回旧值，再在后台更新；可用于 Server Action 或 Route Handler |
| 重新读取当前页面 | `refresh()` | 仅用于 Server Action；刷新客户端路由，服务端标签缓存仍可命中 |

先完成写入，再执行对应的更新操作。同一份数据被多个页面复用时，按标签更新覆盖所有相关条目；按路径更新不会替代跨页面的标签更新，刷新路由也不等于使数据缓存失效。

### 请求期内容

`cookies()`、`headers()` 和页面的 `searchParams` 依赖当前请求。读取它们的组件放在局部 `<Suspense>` 内，公共数据仍可独立缓存；不要把整条路由的所有数据都当成同一种共享内容。

普通缓存边界内不能直接读取请求数据。需要缓存与用户身份相关的结果时，先验证会话，再把决定结果的用户标识传入缓存函数。这里的 `verifySession` 负责验证会话，`getProfile` 负责读取该身份可见的信息，调用 `RequestContent` 的父组件提供 `<Suspense>` 边界：

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

验证会话发生在缓存外，每次请求仍要执行；缓存输入来自验证后的身份。可能随时变化的权限检查也应放在缓存外，不能把命中缓存当作授权。不要直接信任客户端传来的用户 ID，也不要让个性化结果缺少决定其可见范围的缓存输入。

### 动态路由

参数能在构建期确定、且值得提前生成时，导出 `generateStaticParams`；路径数量大时只提供必要样本，控制构建阶段的读取和生成成本。启用 Cache Components 后，样本参数在构建时预渲染，其余参数在请求时处理；读取请求期参数时，将内容放在 `<Suspense>` 或 `loading.tsx` 提供的边界内。

下面展示动态段与参数的对应关系，页面通过异步 `params` 读取当前值：

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

启用 Cache Components 后，路由段配置 `dynamicParams` 不可用。业务只接受固定路径集合时，应在运行时校验参数，并用 `notFound()` 处理无效值。`generateStaticParams` 至少返回一组参数，空数组会导致构建报错。构建时能获取这些参数，也不代表请求期读取的内容就不需要缓存或等待边界。

## 高级 API

高级能力主要用于细调缓存生命周期、控制同步代码的生成时机，以及解决多实例部署中的复用问题。采用前应明确要解决的限制，并核对版本与平台支持。

### Cache Components

Cache Components 支持缓存异步函数或组件的输出，并让可预渲染与请求期内容共存。现有项目需要启用时，在 Next.js 配置中设置 `cacheComponents`；当前版本还应显式设置 `partialPrefetching`，用于客户端导航的部分预取：

```ts fold title="next.config.ts"
export default {
  cacheComponents: true,
  partialPrefetching: true,
}
```

缓存粒度按数据边界选择。只缓存数据函数，界面可以继续按请求组合；缓存整个组件时，组件输出也会复用，必须确认其中没有未区分的请求数据。函数参数和捕获的值会参与缓存键，输入与输出也需要满足框架的序列化要求。

`cacheLife` 放在声明缓存的函数或组件中，接受内置档位或自定义对象。未显式设置时使用 `default` 档位，建议在缓存边界内明确声明。其它内置档位包括 `seconds`、`minutes`、`hours`、`days`、`weeks` 和 `max`；需要更精确的策略时，分别控制三个时间参数：

| 参数 | 控制范围 |
| --- | --- |
| `stale` | 客户端可以复用结果而不检查服务端的时间 |
| `revalidate` | 超过该时间后，后续请求触发服务端后台更新 |
| `expire` | 超过该时间后，后续请求需要等待新结果 |

例如在已有缓存函数内，用自定义对象替换档位调用：

```ts fold
cacheLife({ stale: 300, revalidate: 900, expire: 3600 })
```

单位为秒。自定义时，`expire` 必须大于 `revalidate`，否则 Next.js 会拒绝该配置。时间重新验证由后续请求触发，不是固定时刻运行的后台定时任务；短生命周期缓存可能无法进入预渲染结果，使用时仍需 `<Suspense>` 等待界面。

启用前确认部署使用 Node.js 运行时，并迁移旧式 `dynamic`、`revalidate`、`fetchCache` 路由配置。尚未启用 Cache Components 的项目继续使用 `fetch` 的 `cache`、`next.revalidate` 等旧模型选项；迁移时逐项对应缓存与请求期策略，切回旧模型时也要撤销缓存指令并恢复对应实现。

### 渲染控制

同步读取当前时间、随机数或同步数据库时，需要决定生成的值是否随缓存复用。需要复用时，在 `'use cache'` 边界内读取；需要运行时生成时，在未缓存的服务端组件中用 `io()` 排除同步读取的预渲染执行：

```tsx fold
import { io } from 'next/cache'

async function GeneratedAt() {
  await io()
  return <p>{new Date().toISOString()}</p>
}
```

父组件用 `<Suspense>` 包裹 `GeneratedAt`。`io()` 允许这段内容参与运行时预取；必须等待真实用户请求时，才使用 `connection()`。普通异步取数或已经读取请求 API 的组件通常不需要额外调用它们，也不要把调用放到过高的位置，使无关内容一起推迟。

组件在模块初始化时访问 `window` 或 `document`、无法在服务端运行时，可以在 Client Component 中通过 `next/dynamic` 配置 `ssr: false`。这一选择会让对应内容等待客户端 JavaScript，适合无法服务端执行的依赖；普通状态和事件交互使用 `'use client'` 即可。

### 缓存扩展

一次渲染中的重复查询，与多个实例之间的缓存共享，需要区分复用范围和存储位置：

| 需求 | API | 使用边界 |
| --- | --- | --- |
| 多个 Server Component 重复调用同一查询 | React `cache()` | 一次服务端渲染内去重，不跨请求复用 |
| 复用函数或组件的结果 | `'use cache'` | 按输入缓存；请求期结果默认保存在实例内存中 |
| 请求期的高成本结果需要跨实例共享 | `'use cache: remote'` | 使用远程缓存处理器，增加网络往返与存储成本 |

React `cache()` 包装查询后，导出同一个包装函数供组件调用，不在每个组件内部重新创建。假设 `queryById` 是数据库查询，下面让同一次渲染中的调用复用结果：

```ts fold title="lib/query.ts"
import { cache } from 'react'
import { queryById } from './db'

export const readById = cache(async (id: string) => queryById(id))
```

相同参数才能命中，对象参数按引用比较。相同 URL 和选项的 GET `fetch` 已有渲染内去重能力，数据库或 SDK 查询再按需使用 `cache()`。

普通 `'use cache'` 的请求期缓存不保证在 serverless 请求之间存活。远程缓存需要部署平台提供处理器，或通过 `cacheHandlers` 配置；确认多实例共享可以提高命中率、降低上游负载后，再把相应函数改为 `'use cache: remote'`。输入几乎每次都不同的查询，即使改成远程缓存也可能持续未命中。

维护旧缓存模型时可继续使用 `unstable_cache`，迁移到 Cache Components 后改用缓存指令。部署时同时检查实例生命周期、共享缓存配置和缓存更新能否覆盖所有实例；开发环境的缓存命中不能证明多实例环境行为相同。

模块级变量也不能替代请求隔离。请求 A 把当前用户写入模块后等待异步结果，请求 B 可能在此期间覆盖它，A 恢复执行时就会读到 B 的用户。用户状态应保存在请求上下文或局部变量中，共享可变数据交给数据库等存储；缓存只复用查询或计算结果。

## 参考资料

- [官方缓存说明](https://nextjs.org/docs/app/getting-started/caching)；
- [错误处理文档](https://nextjs.org/docs/app/getting-started/error-handling)；
- [数据获取文档](https://nextjs.org/docs/app/getting-started/fetching-data)；
- [useActionState 文档](https://react.dev/reference/react/useActionState)；
- [缓存更新文档](https://nextjs.org/docs/app/getting-started/revalidating)；
- [动态参数读取](https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes)；
- [动态参数文档](https://nextjs.org/docs/app/api-reference/functions/generate-static-params)；
- [use cache 文档](https://nextjs.org/docs/app/api-reference/directives/use-cache)；
- [cacheLife 文档](https://nextjs.org/docs/app/api-reference/functions/cacheLife)；
- [迁移文档](https://nextjs.org/docs/app/guides/migrating-to-cache-components)；
- [io 文档](https://nextjs.org/docs/app/api-reference/functions/io)；
- [connection 文档](https://nextjs.org/docs/app/api-reference/functions/connection)；
- [React cache 文档](https://react.dev/reference/react/cache)；
- [远程缓存文档](https://nextjs.org/docs/app/api-reference/directives/use-cache-remote)；
- [部署文档](https://nextjs.org/docs/app/guides/self-hosting)。
