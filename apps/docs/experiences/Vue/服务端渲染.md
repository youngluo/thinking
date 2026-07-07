---
createdAt: '2026-07-02 21:12'
draft: true
---

# Vue 服务端渲染

Vue 服务端渲染的核心不是“把 Vue 放到 Node.js 里运行”这么简单，而是让同一套应用经历两次相互衔接的渲染：

1. 服务端根据当前请求创建应用，把组件树渲染成 HTML；
2. 浏览器收到 HTML 后创建同一棵组件树，通过 Hydration 接管已有 DOM。

服务端返回的 HTML 解决首屏内容和 SEO，客户端 Hydration 恢复事件、响应式状态和路由能力。Nuxt 在此基础上继续处理文件路由、数据获取、状态传输、代码分割、缓存、预渲染和部署。

本文以 Vue 3 和 Nuxt 4 为基础，重点讨论这条链路如何实现，以及项目中怎样选择 SSR、SSG、SWR/ISR、客户端组件和服务端组件。

## Vue SSR 的完整链路

### 从组件到 HTML

浏览器中的 Vue renderer 最终操作 DOM，服务端没有 DOM，因此使用 `vue/server-renderer` 把组件树转换成 HTML 字符串或流。

```ts
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import App from './App.vue'

const app = createSSRApp(App)
const html = await renderToString(app)
```

`renderToString` 只返回应用内容，不会自动生成完整文档。真正的服务端还要补上 `<html>`、`<head>`、客户端入口文件、样式和序列化状态：

```ts
const document = `<!doctype html>
<html lang="zh-CN">
  <head>
    <title>Vue SSR</title>
    <link rel="stylesheet" href="/assets/app.css">
  </head>
  <body>
    <div id="app">${html}</div>
    <script>window.__INITIAL_STATE__ = ${serializedState}</script>
    <script type="module" src="/assets/client.js"></script>
  </body>
</html>`
```

实际项目不能直接用 `JSON.stringify` 拼接不可信数据，否则可能产生 XSS；Nuxt 使用专门的序列化方案处理 payload。

SSR 请求的主线如下：

```d2
direction: right

browser: 浏览器 {
  class: group

  request: 请求 URL
  html: 展示服务端 HTML
  hydrate: Hydration
  interactive: 页面可交互 {
    class: ok
  }
}

server: 服务端 {
  class: group

  create: 创建请求级应用
  route: 解析路由
  data: 获取页面数据
  render: 渲染组件树
  document: 组装 HTML、状态与资源
}

browser.request -> server.create
server.create -> server.route -> server.data -> server.render -> server.document
server.document -> browser.html: HTML 响应
browser.html -> browser.hydrate -> browser.interactive
```

### 为什么需要两份构建产物

一套 Vue SSR 应用通常要构建两次：

- Server bundle 运行在 Node.js、Edge Runtime 等服务端环境，负责路由匹配、数据获取和生成 HTML；
- Client bundle 运行在浏览器，负责 Hydration、客户端导航以及后续响应式更新。

两端会复用组件和业务逻辑，但编译结果不同。Vue 模板用于客户端时通常编译为创建 vnode 的 render function；用于 SSR 时可以编译为更适合拼接 HTML 的 SSR render function。

构建工具还要解决模块替换、资源清单和代码分割。服务端渲染某个路由后，需要知道该路由使用了哪些客户端 chunk 和 CSS，才能把正确的 `<script>`、`<link>` 写入响应。手动维护这套系统很复杂，这也是 Vue 官方建议生产项目优先使用 Nuxt 等上层框架的原因。

### 每个请求都要创建应用实例

浏览器应用只服务当前用户，可以使用模块级单例状态；SSR 服务进程会连续处理不同用户的请求，模块却只初始化一次。

下面的状态会被所有请求共享：

```ts
import { reactive } from 'vue'

export const userState = reactive({
  name: '',
})
```

如果请求 A 写入用户信息，请求 B 可能读到同一个对象，形成跨请求状态污染。SSR 应该通过工厂函数为每个请求创建应用、router 和 store：

```ts
import { createSSRApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

/** 为每次服务端请求创建隔离的应用上下文。 */
export function createApp() {
  const app = createSSRApp(App)
  const pinia = createPinia()

  app.use(pinia)

  return { app, pinia }
}
```

Nuxt 已经建立了请求级应用上下文。应用状态应使用 `useState`、Pinia 或请求上下文管理，而不是把用户相关的可变数据放在模块顶层。

## Hydration 如何接管页面

服务端 HTML 只是浏览器可以立即展示的静态标记。Vue 客户端入口仍要创建应用：

```ts
import { createSSRApp } from 'vue'
import App from './App.vue'

createSSRApp(App).mount('#app')
```

`createSSRApp` 告诉 Vue：容器里已经有服务端输出，不要重新创建全部 DOM。Vue 会在客户端执行组件的首次渲染，按顺序匹配 vnode 和现有 DOM，恢复组件实例、响应式依赖并绑定事件。

```d2
direction: down

html: 服务端 HTML 已展示
bundle: 下载客户端 bundle
create: 创建同构 Vue 应用
render: 计算客户端首棵 vnode 树
match: 与已有 DOM 一致? {
  shape: diamond
  class: decision
}
reuse: 复用 DOM 并绑定事件
recover: 丢弃或修正不匹配节点 {
  class: fail
}
ready: 恢复响应式交互 {
  class: ok
}

html -> bundle -> create -> render -> match
match -> reuse: 是
match -> recover: 否
reuse -> ready
recover -> ready
```

Hydration 不是给服务端 HTML“加几个事件”而已。客户端必须建立完整组件树，才能处理后续状态变化。因此 SSR 通常改善内容出现时间，却不会自动消除客户端 JavaScript 的解析和执行成本。

### Hydration mismatch

服务端输出与客户端首次 render 不一致时，会出现 Hydration mismatch。Vue 会尝试恢复，但需要丢弃或修正节点，既有性能成本，也可能造成闪烁。

常见原因包括：

- 服务端渲染时直接读取 `window`、`document`、`localStorage`；
- 模板中使用 `Math.random()`、当前时间等非确定值；
- 服务端和浏览器的时区、语言环境不同；
- HTML 标签嵌套非法，被浏览器解析器自动修正；
- 服务端与客户端拿到不同的数据或初始状态；
- 根据视口宽度直接决定首次渲染结构。

需要浏览器环境的逻辑应放进 `onMounted`，或使用 Nuxt 的客户端组件：

```vue
<script setup lang="ts">
const width = ref<number>()

onMounted(() => {
  width.value = window.innerWidth
})
</script>

<template>
  <p v-if="width">视口宽度：{{ width }}</p>
  <p v-else>正在读取视口信息</p>
</template>
```

这里服务端和客户端首次 render 都会得到占位内容，挂载后才读取宽度。Vue 3.5 的 `data-allow-mismatch` 可以压制明确且不可避免的 mismatch 警告，但不能替代正确的数据和执行环境设计。

### 生命周期和副作用

SSR 只生成一次 HTML，不会挂载 DOM，也不会持续响应状态变化：

- `onMounted`、`onUpdated`、`onUnmounted` 不在服务端执行；
- `setup` 和服务端可执行的创建阶段会在请求期间运行；
- 不要在 `setup` 顶层创建依赖卸载钩子清理的定时器；
- DOM、Canvas、WebSocket 等浏览器能力应在客户端阶段初始化。

服务端渲染期间 Vue 默认关闭不必要的响应式追踪，因为当前请求只需要一次输出，没有后续 DOM 更新。

## Nuxt 如何组织 SSR

Nuxt 默认使用 universal rendering，即初次访问由服务端输出 HTML，浏览器随后 Hydration；客户端路由导航通常在浏览器中完成，不会每次都返回完整文档。

```ts
export default defineNuxtConfig({
  ssr: true,
})
```

`ssr: true` 是默认值，可以省略。一次初始请求大致经历：

```d2
direction: right

nitro: Nitro {
  class: group

  request: 接收请求
  rules: 匹配 routeRules
  api: 执行服务端接口或中间件
}

nuxt: Nuxt 应用 {
  class: group

  app: 创建请求级 NuxtApp
  route: 匹配页面与布局
  async: 执行数据获取
  vue: Vue SSR
  payload: 收集 payload
}

response: 响应 {
  class: group

  document: 组装 head、HTML、payload、资源
  send: 返回浏览器 {
    class: ok
  }
}

nitro.request -> nitro.rules -> nitro.api
nitro.api -> nuxt.app -> nuxt.route -> nuxt.async -> nuxt.vue -> nuxt.payload
nuxt.payload -> response.document -> response.send
```

Nitro 是 Nuxt 的服务端引擎，负责服务端路由、部署产物、缓存和预渲染等能力；Vue renderer 负责把组件树渲染为 HTML。两者职责不能混为一谈。

## 服务端数据如何传到客户端

SSR 页面经常需要先取数据再生成 HTML。直接在组件中使用 `$fetch` 会产生一个容易忽略的问题：

```vue
<script setup lang="ts">
const products = await $fetch('/api/products')
</script>
```

初次访问时，这段 setup 在服务端执行一次；浏览器 Hydration 时还会再执行一次，于是相同数据可能请求两次。`useFetch` 和 `useAsyncData` 会把服务端结果写入 Nuxt payload，客户端 Hydration 按 key 复用，不再重复请求。

```vue
<script setup lang="ts">
const {
  data: products,
  status,
  error,
} = await useFetch('/api/products', {
  key: 'products',
  pick: ['id', 'name', 'price'],
})
</script>

<template>
  <p v-if="status === 'pending'">加载中</p>
  <p v-else-if="error">商品加载失败</p>
  <ul v-else>
    <li v-for="product in products" :key="product.id">{{ product.name }}：{{ product.price }}</li>
  </ul>
</template>
```

`useAsyncData` 适合封装任意异步逻辑：

```vue
<script setup lang="ts">
const route = useRoute()

const { data: article } = await useAsyncData(
  () => `article:${route.params.slug}`,
  () => $fetch(`/api/articles/${route.params.slug}`),
  {
    watch: [() => route.params.slug],
  }
)
</script>
```

关键区别是：

| API            | 主要用途                  | SSR 数据进入 payload | 典型使用位置                                   |
| -------------- | ------------------------- | -------------------- | ---------------------------------------------- |
| `$fetch`       | 发起普通请求              | 否                   | 事件处理器、服务端接口、`useAsyncData` handler |
| `useFetch`     | 基于 URL 的响应式数据获取 | 是                   | 页面或组件 setup                               |
| `useAsyncData` | 管理任意异步结果          | 是                   | 页面或组件 setup                               |

`useFetch` 本质上封装了 `$fetch` 和 `useAsyncData`。它们的 key 不只是缓存标识，还用于让服务端 payload 与客户端调用对上。复用同一个 key 的调用会共享 `data`、`error` 和 `status`，因此 handler、`pick`、`transform` 等关键选项也应保持一致。

Nuxt 使用 `devalue` 序列化 payload，可处理 `Date`、`Map`、`Set` 等比 JSON 更丰富的类型。即便如此，也不应把 token、内部字段等敏感数据放入 payload，因为它最终会发送到浏览器。可以用 `pick` 或 `transform` 减少传输字段：

```ts
const { data: profile } = await useFetch('/api/profile', {
  pick: ['id', 'displayName', 'avatar'],
})
```

### 服务端调用自己的 API

Nuxt 在服务端执行 `$fetch('/api/products')` 时，Nitro 可以直接调用内部 handler，不需要绕一圈真实网络。对于需要当前用户身份的接口，`useFetch` 会在服务端相对请求中代理必要的请求上下文；手动 `$fetch` 外部地址时则要明确处理 Cookie 和 Header，避免无意泄漏请求凭据。

服务端 API 示例：

```ts
// server/api/products.get.ts
export default defineEventHandler(async (event) => {
  const category = getQuery(event).category

  return queryProducts({ category })
})
```

`server/api` 代码只进入服务端产物，可以安全访问数据库驱动和服务端密钥；但返回值仍会发送给客户端，不能返回秘密配置。

## SSR、SSG、SWR 和 ISR

这些模式的主要区别是 HTML 在什么时候生成，以及生成结果缓存在哪里。Hydration 流程可以相同。

| 模式            | HTML 生成时机            | 是否需要运行时服务端 | 数据更新方式              |
| --------------- | ------------------------ | -------------------- | ------------------------- |
| SSR             | 每次未命中页面缓存的请求 | 是                   | 每次重新渲染              |
| SSG / prerender | 构建期间                 | 否                   | 重新构建和部署            |
| SWR             | 首次请求或缓存更新时     | 是                   | 过期后后台重新生成        |
| ISR             | 首次请求或缓存更新时     | 取决于平台           | 在支持的平台写入 CDN 缓存 |
| CSR             | 浏览器运行时             | 否                   | 客户端请求接口            |

### SSR 实践

Nuxt 默认 SSR。需要读取 Cookie、Header 或当前请求身份的页面可以直接使用请求级 API：

```vue
<script setup lang="ts">
const { data: user } = await useAsyncData('current-user', async () => {
  const headers = useRequestHeaders(['cookie'])

  return $fetch('/api/me', { headers })
})
</script>

<template>
  <h1>你好，{{ user?.displayName }}</h1>
</template>
```

个性化响应不能直接作为所有用户共享的整页缓存，否则可能把某个用户的内容返回给其他用户。缓存页面前要先区分公共内容和请求级内容。

### SPA 与局部 CSR

关闭全局 SSR：

```ts
export default defineNuxtConfig({
  ssr: false,
})
```

这会生成客户端渲染应用，不是 SSG。服务端返回的主要是 HTML shell，内容要等 JavaScript 执行后生成。

实际项目通常不需要全局关闭 SSR，可以只让后台路由客户端渲染：

```ts
export default defineNuxtConfig({
  routeRules: {
    '/admin/**': { ssr: false },
  },
})
```

### SSG 与预渲染

执行 `nuxt generate` 时，Nuxt 会使用 Nitro 在构建阶段渲染页面，输出静态 HTML、客户端资源和 payload。部署后可直接由对象存储或 CDN 返回，不需要 Nuxt 服务进程。

预渲染器会从入口路由开始，读取页面中的链接并继续爬取。没有被链接发现的动态路由要显式提供：

```ts
export default defineNuxtConfig({
  nitro: {
    prerender: {
      crawlLinks: true,
      routes: ['/articles/vue-ssr', '/articles/nuxt-rendering', '/sitemap.xml'],
    },
  },
})
```

也可以在 `routeRules` 中标记：

```ts
export default defineNuxtConfig({
  routeRules: {
    '/': { prerender: true },
    '/articles/**': { prerender: true },
    '/preview/**': { prerender: false },
  },
})
```

`'/articles/**': { prerender: true }` 不会凭空枚举数据库里的所有 slug。动态地址仍需通过可爬取链接、`nitro.prerender.routes` 或构建钩子提供。

SSG 运行的是同一套服务端渲染逻辑，只是发生在构建期。因此构建环境必须能访问内容源，页面也不能依赖真实用户请求中的 Cookie 或 Header。

### SWR 与 ISR

混合渲染通过 `routeRules` 为不同路由设置生成和缓存策略：

```ts
export default defineNuxtConfig({
  routeRules: {
    '/': { prerender: true },
    '/search': { swr: 60 },
    '/products/**': { swr: 3600 },
    '/blog/**': { isr: 3600 },
    '/admin/**': { ssr: false },
  },
})
```

- `swr: 3600`：完整响应缓存 3600 秒；过期后先返回旧内容，同时在后台重新生成；
- `isr: 3600`：语义接近 SWR，但在 Netlify、Vercel 等支持的平台使用 CDN 持久缓存；
- `isr: true`：CDN 中保持到下次部署；
- `prerender: true`：构建时生成静态资源；
- `ssr: false`：该路由仅在客户端渲染。

`isr` 的落地能力依赖 Nitro 部署适配器，不能假设任意 Node.js 主机都自动具备 CDN ISR。使用 `nuxt generate` 进行纯静态导出时也没有运行时混合渲染；SWR/ISR 需要可执行的服务端或平台能力。

## 普通组件、客户端组件和服务端组件

“页面使用了 SSR”不等于“页面里的组件都是服务端组件”。Nuxt 至少存在以下几种不同边界：

| 类型                    | 服务端生成 HTML | 进入客户端 bundle | Hydration              | 适合场景                   |
| ----------------------- | --------------- | ----------------- | ---------------------- | -------------------------- |
| 普通 `.vue` 组件        | 是              | 是                | 是                     | 大多数页面和交互组件       |
| `.client.vue`           | 否              | 是                | 挂载后渲染             | 强依赖浏览器 API           |
| `<ClientOnly>` 中的组件 | 否              | 是                | 挂载后渲染             | 局部隔离客户端库           |
| `.server.vue` 组件      | 是              | 否                | 自身不 Hydration       | Markdown、代码高亮、重计算 |
| `.server.vue` 页面      | 是              | 不含页面渲染代码  | 通过服务端组件机制更新 | 无需整页客户端逻辑的页面   |

### 普通组件参与 SSR

普通组件的 setup 会在初次请求的服务端执行，也会在 Hydration 时进入浏览器。它既不是“只在服务端”，也不是“只在客户端”：

```vue
<script setup lang="ts">
const count = ref(0)
</script>

<template>
  <button @click="count++">
    {{ count }}
  </button>
</template>
```

服务端会输出 `<button>0</button>`，客户端 bundle 包含组件代码，Hydration 后点击才能更新。SSR 改变的是首屏 HTML 的生成位置，不会自动让组件代码退出客户端 bundle。

### 客户端组件

组件必须访问 DOM、WebGL 或不支持 SSR 的第三方库时，可以使用 `.client.vue`：

```vue
<!-- app/components/Map.client.vue -->
<script setup lang="ts">
const mapContainer = useTemplateRef<HTMLDivElement>('mapContainer')

onMounted(() => {
  createMap(mapContainer.value)
})
</script>

<template>
  <div ref="mapContainer" class="map" />
</template>
```

页面中通过自动导入使用：

```vue
<template>
  <Map />
</template>
```

`.client.vue` 只在挂载后渲染，服务端没有它的内容。这个后缀只对 Nuxt 自动导入或 `#components` 导入生效，不能通过真实文件路径显式导入后期待 Nuxt 仍将其转换为客户端组件。

临时隔离普通组件时，可以使用 `<ClientOnly>`：

```vue
<template>
  <ClientOnly fallback-tag="div" fallback="图表加载中">
    <AnalyticsChart />
  </ClientOnly>
</template>
```

客户端组件能解决运行环境冲突，但会牺牲这部分内容的首屏 HTML。静态内容不应因为少量交互就整体改成 client-only，更合理的做法是把浏览器相关部分拆小。

### Nuxt 服务端组件

Nuxt 的组件 Islands 目前仍是实验能力，需要显式开启：

```ts
export default defineNuxtConfig({
  experimental: {
    componentIslands: true,
  },
})
```

组件使用 `.server.vue` 后缀：

```vue
<!-- app/components/HighlightedMarkdown.server.vue -->
<script setup lang="ts">
const props = defineProps<{
  source: string
}>()

const html = renderMarkdown(props.source)
</script>

<template>
  <article v-html="html" />
</template>
```

它的 Markdown parser 和高亮依赖不会进入客户端 bundle。服务端组件没有客户端响应式交互；props 变化时，`<NuxtIsland>` 会发起请求，服务端在隔离的 Vue 应用中重新渲染组件，再更新页面中的 HTML。

```d2
direction: right

page: 页面组件 {
  class: group

  parent: 客户端父组件
  props: props 变化
  dom: 替换 Island HTML
}

island: 服务端 Island {
  class: group

  request: 接收 Island 请求
  context: 创建隔离 Vue 上下文
  render: 渲染 .server.vue
  response: 返回 HTML
}

page.parent -> page.props
page.props -> island.request
island.request -> island.context -> island.render -> island.response
island.response -> page.dom
```

这套机制有几个重要限制：

- 服务端组件必须只有一个根节点，HTML 注释也会被视为节点；
- props 通过 URL query 传输，不适合传递大量数据；
- Island 拥有独立 NuxtApp 上下文，不能直接访问外层页面上下文；
- Island 中的 `useRoute()` 指向 Island 请求，而不是外层页面路由；
- 每个 Island 都有请求和应用创建开销，不应把页面拆成大量细碎 Island；
- 路由中间件不会因为 Island 渲染而执行。

如果服务端组件需要当前路由信息，应由父组件通过 props 或显式 context 传入。

### 服务端页面

Nuxt 4 支持 `.server.vue` 页面：

```text
app/pages/report.server.vue
```

页面会通过服务端组件机制渲染，渲染它所需的代码不进入客户端 bundle，同时仍可由 Vue Router 发起客户端导航。它同样要求单一根节点。

服务端页面适合报告、只读详情等不需要整页交互的内容。如果页面包含大量表单和本地状态，普通 SSR 页面通常更直接。

### 在服务端组件中保留交互

服务端组件可以与客户端组件组合，把大块静态计算留在服务端，只 Hydration 必要的交互区域。Nuxt 的 selective client 功能同样属于实验能力：

```ts
export default defineNuxtConfig({
  experimental: {
    componentIslands: {
      selectiveClient: true,
    },
  },
})
```

```vue
<template>
  <article>
    <HighlightedMarkdown :source="source" />
    <CopyButton nuxt-client :content="source" />
  </article>
</template>
```

不要仅为了减少 JavaScript 就直接采用实验性 Islands。Nuxt 还支持普通组件延迟 Hydration，例如让非首屏组件进入视口后再 Hydration：

```vue
<template>
  <LazyComments hydrate-on-visible />
</template>
```

延迟 Hydration 的组件仍会进入客户端 bundle，也仍是普通客户端组件，只是推迟执行时机；它与 server-only component 是两种不同优化。

### 与 React Server Components 的区别

Nuxt Server Components 和 React Server Components 都希望让部分组件代码留在服务端，但实现模型不同：

- React Server Components 使用 RSC payload 描述服务端组件树，并与 React renderer、bundler 和 Client Component 边界深度结合；
- Nuxt `.server.vue` 基于 `<NuxtIsland>` 请求独立渲染 HTML，props 更新时重新请求 Island；
- Nuxt Islands 是实验能力，不应把 React RSC 的缓存、流式传输或组件组合语义直接套用过来。

讨论 Vue 项目时，应该先明确指的是“普通组件参与 SSR”“server-only page”，还是实验性的 Nuxt Server Component。

## 实践中的常见问题

### 服务端与客户端代码边界

Nuxt 提供 `.client.ts`、`.server.ts` 插件和 `import.meta.client`、`import.meta.server` 等环境判断。优先把实现按环境拆开，而不是在通用代码里到处判断：

```ts
if (import.meta.client) {
  const preference = localStorage.getItem('theme')
  applyTheme(preference)
}
```

必须同时运行在两端的组件要确保首次输出确定且一致。

### 第三方库不支持 SSR

先确认库是否真的需要在服务端运行。图表、地图、编辑器通常只需要客户端组件；格式化、Markdown parser 等纯计算库则可以放在服务端。

不要在服务端伪造完整 `window` 来强行运行浏览器库，这容易影响库的环境检测。隔离为 `.client.vue` 往往更可靠。

### 缓存了不该共享的内容

使用 SWR/ISR 前检查页面是否依赖：

- 登录用户和权限；
- Cookie、Authorization Header；
- 地区、语言或实验分组；
- 实时库存、余额等强一致数据。

这些数据如果会改变完整 HTML，就不能用单一公共 key 缓存。可将公共页面缓存与用户数据拆开：主体使用 SSG/SWR，登录后再由客户端请求个性化区域。

### payload 过大

SSR 把数据放入 HTML 或独立 payload 后，浏览器仍要下载、解析和持有这些数据。不要把完整数据库对象传给页面：

- 用 `pick` 或 `transform` 只保留渲染需要的字段；
- 列表接口分页；
- 不把可在客户端交互后再取的数据塞入首屏 payload；
- 避免多个不同 key 重复保存相同大对象。

### 把 SSR 当成性能保证

SSR 往往改善首屏内容和 SEO，但会增加服务端计算和 TTFB。页面如果串行请求多个慢接口，SSR 可能让用户更晚收到第一个字节。实践中还需要：

- 并行执行没有依赖的数据请求；
- 为公共页面配置合理缓存；
- 减少首屏客户端 JavaScript；
- 避免 Hydration 大量非交互内容；
- 监控 TTFB、LCP、INP 和服务端错误率。

## 如何选择

先选择路由的渲染模式，再选择组件边界：

1. 内容在构建时确定且路由可枚举：使用 SSG；
2. 内容公共但会定期更新：使用 SWR，或在受支持平台使用 ISR；
3. 页面依赖当前请求身份或实时数据：使用 SSR；
4. 登录后的重交互后台且不要求 SEO：考虑局部 CSR；
5. 普通交互组件：保持普通 `.vue`，让它参与 SSR 和 Hydration；
6. 强依赖浏览器环境：缩小边界后使用 `.client.vue` 或 `<ClientOnly>`；
7. 计算昂贵、输出只读且需要减少客户端依赖：评估 `.server.vue`，同时接受实验性和额外请求成本。

Nuxt 项目通常是组合方案：文章页预渲染，商品页使用 SWR，搜索页按请求 SSR，后台路由客户端渲染；页面内部再将地图隔离为客户端组件，将 Markdown 高亮评估为服务端组件。

## 总结

Vue SSR 的本质是一套双端协作协议：服务端创建请求级应用并生成 HTML，客户端用相同组件树 Hydration。两端首次输出必须一致，状态必须安全地序列化，并且服务端请求之间不能共享用户状态。

Nuxt 用 Nitro、文件路由、数据 composable 和 payload 封装了这条链路。`useFetch`、`useAsyncData` 解决的不只是请求写法，还负责把服务端结果交给客户端；预渲染、SWR 和 ISR 则是在不同时间执行同一套渲染，并把结果存放到不同缓存层。

普通组件参与 SSR 不代表它只在服务端执行。`.client.vue` 放弃服务端 HTML，`.server.vue` 通过实验性的 Islands 机制只在服务端生成片段。正确选型的关键是分别判断路由何时生成 HTML、组件代码在哪一侧执行，以及哪些交互真正需要 Hydration。

## 参考资料

- [Vue Server-Side Rendering](https://vuejs.org/guide/scaling-up/ssr.html)
- [Vue Server-Side Rendering API](https://vuejs.org/api/ssr.html)
- [Nuxt Rendering Modes](https://nuxt.com/docs/4.x/guide/concepts/rendering)
- [Nuxt Lifecycle](https://nuxt.com/docs/4.x/guide/concepts/nuxt-lifecycle)
- [Nuxt Server Engine](https://nuxt.com/docs/4.x/guide/concepts/server-engine)
- [Nuxt Data Fetching](https://nuxt.com/docs/4.x/getting-started/data-fetching)
- [Nuxt Prerendering](https://nuxt.com/docs/4.x/getting-started/prerendering)
- [Nuxt Components](https://nuxt.com/docs/4.x/directory-structure/app/components)
- [Nuxt Pages](https://nuxt.com/docs/4.x/directory-structure/app/pages)
- [Nuxt Hydration Best Practices](https://nuxt.com/docs/4.x/guide/best-practices/hydration)
