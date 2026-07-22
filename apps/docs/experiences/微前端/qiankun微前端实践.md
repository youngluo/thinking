---
createdAt: '2026-07-22 22:08'
draft: true
---

# qiankun 微前端实践：从应用接入到独立交付

本文是[《微前端：架构决策与运行原理》](./微前端.md)的实践篇。原理篇讨论为什么引入微前端，以及应用加载、沙箱、样式隔离和通信契约如何工作；本文只关注如何用 qiankun 2.x 把这些边界落到项目中。

示例采用 Webpack 5、React 18 和 Vue 3：React 主应用负责应用编排，订单中心是 React 子应用，报表中心是 Vue 子应用。两个子应用既能嵌入主应用，也能独立启动、构建和发布。

## 实践目标与项目结构

### React 主应用、React 子应用与 Vue 子应用如何分工

三个应用的职责和访问入口如下：

| 应用         | 技术栈   | 本地入口                | 集成路由   | 职责                                   |
| ------------ | -------- | ----------------------- | ---------- | -------------------------------------- |
| portal-shell | React 18 | `http://localhost:9000` | `/`        | 全局布局、应用注册、平台能力和错误兜底 |
| orders-react | React 18 | `http://localhost:9001` | `/orders`  | 订单领域页面和内部路由                 |
| reports-vue  | Vue 3    | `http://localhost:9002` | `/reports` | 报表领域页面和内部路由                 |

主应用只知道子应用的名称、入口、容器和激活规则，不读取子应用内部组件。子应用只依赖主应用通过 Props 提供的平台契约，不导入主应用内部的路由、状态仓库或组件。

```d2
direction: down

system: 集成页面 {
  class: group

  shell: React 主应用 {
    class: subgroup
    registry: 应用注册与路由匹配
    platform: 登录态、导航、弹层、监控
    container: 微应用容器
  }

  apps: 独立子应用 {
    class: subgroup
    orders: React 订单中心
    reports: Vue 报表中心
  }
}

system.shell.registry -> system.apps.orders: /orders
system.shell.registry -> system.apps.reports: /reports
system.shell.platform -> system.apps: customProps
system.apps -> system.shell.container: mount
```

### 如何同时支持集成运行与独立运行

qiankun 加载子应用时会设置 `window.__POWERED_BY_QIANKUN__`，并在生命周期 Props 中提供挂载容器。子应用据此区分两种模式：

- 独立运行：直接调用自己的 `render`，挂到页面原有的 `#root` 或 `#app`；
- 集成运行：只导出生命周期，等待主应用调用 `mount`，并在指定容器内查找根节点。

这两条路径必须使用同一套业务入口。不要为微前端模式复制一份页面实现，否则独立开发环境和集成环境会逐渐产生差异。

## 搭建可运行的主子应用

### 在主应用中注册并启动 qiankun

主应用先定义运行时 manifest。开发环境指向本地服务，生产环境可以在启动时从配置服务获取同样结构的数据：

```ts fold title="portal-shell/src/micro-app-manifest.ts"
export type MicroAppManifest = {
  orders: {
    entry: string
    version: string
  }
  reports: {
    entry: string
    version: string
  }
}

export const microAppManifest: MicroAppManifest = {
  orders: {
    entry: 'http://localhost:9001',
    version: 'local',
  },
  reports: {
    entry: 'http://localhost:9002',
    version: 'local',
  },
}
```

注册时把平台 API 和应用版本放进 `props`。`loader` 只负责当前应用的加载状态，框架生命周期则用于记录阶段信息：

```ts fold title="portal-shell/src/micro-apps.ts"
import type { PlatformAPI } from './platform-api'
import type { MicroAppManifest } from './micro-app-manifest'
import { addGlobalUncaughtErrorHandler, registerMicroApps, start } from 'qiankun'
import './platform-state'

type StartMicroAppsOptions = {
  manifest: MicroAppManifest
  platform: PlatformAPI
  onLoading: (appName: string, loading: boolean) => void
}

let started = false

export function startMicroApps(options: StartMicroAppsOptions) {
  if (started) return
  started = true

  const { manifest, onLoading, platform } = options

  registerMicroApps(
    [
      {
        name: 'orders-react',
        entry: manifest.orders.entry,
        container: '#micro-app-container',
        activeRule: '/orders',
        loader: (loading) => onLoading('orders-react', loading),
        props: {
          appVersion: manifest.orders.version,
          platform,
        },
      },
      {
        name: 'reports-vue',
        entry: manifest.reports.entry,
        container: '#micro-app-container',
        activeRule: '/reports',
        loader: (loading) => onLoading('reports-vue', loading),
        props: {
          appVersion: manifest.reports.version,
          platform,
        },
      },
    ],
    {
      beforeLoad: (app) => {
        platform.recordLifecycle(app.name, 'beforeLoad')
        return Promise.resolve()
      },
      afterMount: (app) => {
        platform.recordLifecycle(app.name, 'afterMount')
        return Promise.resolve()
      },
      afterUnmount: (app) => {
        platform.recordLifecycle(app.name, 'afterUnmount')
        return Promise.resolve()
      },
    }
  )

  addGlobalUncaughtErrorHandler((event) => {
    platform.reportError(event, { source: 'qiankun' })
  })

  start({
    prefetch: true,
    sandbox: {
      experimentalStyleIsolation: true,
    },
    singular: true,
    urlRerouteOnly: true,
  })
}
```

`singular: true` 表示同一时间只挂载一个子应用，适合本例的路由级切换。`urlRerouteOnly: true` 只在 URL 确实变化时重新计算活动应用。两个配置也是 qiankun 2.x 的默认方向，这里显式写出是为了固定项目约定。

主应用必须先渲染容器，再启动 qiankun。React 18 的 Strict Mode 在开发环境可能重复执行 Effect，因此 `startMicroApps` 自身需要保证幂等：

```tsx fold title="portal-shell/src/App.tsx"
import { useCallback, useEffect, useState } from 'react'
import { microAppManifest } from './micro-app-manifest'
import { startMicroApps } from './micro-apps'
import { platformAPI } from './platform-api'

export const App = () => {
  const [loadingApp, setLoadingApp] = useState<string | null>(null)

  const onLoading = useCallback((appName: string, loading: boolean) => {
    setLoadingApp(loading ? appName : null)
  }, [])

  useEffect(() => {
    startMicroApps({
      manifest: microAppManifest,
      platform: platformAPI,
      onLoading,
    })
  }, [onLoading])

  return (
    <main>
      <header>业务平台</header>
      {loadingApp && <p>正在加载 {loadingApp}…</p>}
      <section id="micro-app-container" aria-busy={Boolean(loadingApp)} />
    </main>
  )
}

App.displayName = 'App'
```

### 为 React 子应用实现生命周期

子应用入口必须先导入 public path 设置，再导入可能触发异步分包的业务模块：

```ts fold title="orders-react/src/public-path.ts"
declare let __webpack_public_path__: string

declare global {
  interface Window {
    __POWERED_BY_QIANKUN__?: boolean
    __INJECTED_PUBLIC_PATH_BY_QIANKUN__?: string
  }
}

if (window.__POWERED_BY_QIANKUN__ && window.__INJECTED_PUBLIC_PATH_BY_QIANKUN__) {
  __webpack_public_path__ = window.__INJECTED_PUBLIC_PATH_BY_QIANKUN__
}

export {}
```

主应用中的 `#micro-app-container` 可以保持为空。qiankun 会先把子应用 HTML 插入该容器下的包装节点，再调用 `mount`；因此 React 子应用自己的 HTML 必须提供根节点：

```html fold title="orders-react/public/index.html"
<div id="root"></div>
```

Vue 子应用的 HTML 同理，需要提供 `<div id="app"></div>`。`props.container.querySelector(...)` 查找的是这段由 HTML Entry 带入的子应用内容，而不是要求主应用预先创建子应用根节点。

React 18 需要保存 `createRoot` 返回的根实例，并在 `unmount` 中主动销毁：

```tsx fold title="orders-react/src/index.tsx"
import type { Root } from 'react-dom/client'
import type { MicroAppProps } from './platform-contract'
import './public-path'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { standalonePlatformAPI } from './standalone-platform-api'

let root: Root | null = null

function getRootElement(props: MicroAppProps) {
  const scope = props.container ?? document
  const element = scope.querySelector('#root')

  if (!element) {
    throw new Error('orders-react root element was not found')
  }

  return element
}

function render(props: MicroAppProps) {
  root = createRoot(getRootElement(props))
  root.render(
    <StrictMode>
      <App platform={props.platform} />
    </StrictMode>
  )
}

if (!window.__POWERED_BY_QIANKUN__) {
  render({
    appVersion: 'local',
    platform: standalonePlatformAPI,
  })
}

export async function bootstrap() {
  return Promise.resolve()
}

export async function mount(props: MicroAppProps) {
  render(props)
}

export async function unmount() {
  root?.unmount()
  root = null
}
```

独立运行时使用 `standalonePlatformAPI` 提供本地替身，集成运行时使用主应用注入的真实实现。业务组件因此不需要判断当前是否处于 qiankun 环境。

### 为 Vue 子应用实现生命周期

Vue 3 子应用同样保存应用、路由和 history 实例。每次挂载重新创建，每次卸载彻底销毁：

```ts fold title="reports-vue/src/main.ts"
import type { App as VueApplication } from 'vue'
import type { Router, RouterHistory } from 'vue-router'
import type { MicroAppProps } from './platform-contract'
import './public-path'
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import { routes } from './routes'
import { standalonePlatformAPI } from './standalone-platform-api'

let application: VueApplication<Element> | null = null
let router: Router | null = null
let history: RouterHistory | null = null

function getRootElement(props: MicroAppProps) {
  const scope = props.container ?? document
  const element = scope.querySelector('#app')

  if (!element) {
    throw new Error('reports-vue root element was not found')
  }

  return element
}

function render(props: MicroAppProps) {
  const base = window.__POWERED_BY_QIANKUN__ ? '/reports' : '/'

  history = createWebHistory(base)
  router = createRouter({ history, routes })
  application = createApp(App, { platform: props.platform })
  application.use(router)
  application.mount(getRootElement(props))
}

if (!window.__POWERED_BY_QIANKUN__) {
  render({
    appVersion: 'local',
    platform: standalonePlatformAPI,
  })
}

export async function bootstrap() {
  return Promise.resolve()
}

export async function mount(props: MicroAppProps) {
  render(props)
}

export async function unmount() {
  application?.unmount()
  history?.destroy()
  application = null
  router = null
  history = null
}
```

这里没有在模块加载阶段创建 Vue 实例。否则子应用只是被预加载、尚未激活时，也会提前注册路由和产生 DOM 副作用。`application.unmount()` 销毁 Vue 组件树，`history.destroy()` 显式移除该 history 实例注册的浏览器监听，使重复挂载的资源边界更清楚。Vue 子应用还需要提供与 React 子应用相同的 `public-path.ts`。

### 配置 Webpack UMD 输出与跨域访问

qiankun 2.x 的 HTML Entry 需要从子应用脚本导出生命周期。Webpack 应把入口构建成 UMD 库，并为每个子应用设置唯一运行时名称：

```js fold title="orders-react/webpack.config.js"
const APP_NAME = 'orders-react'

module.exports = {
  output: {
    library: `${APP_NAME}-[name]`,
    libraryTarget: 'umd',
    uniqueName: APP_NAME,
    chunkLoadingGlobal: `webpackJsonp_${APP_NAME.replaceAll('-', '_')}`,
    globalObject: 'window',
  },
  devServer: {
    port: 9001,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    historyApiFallback: true,
    allowedHosts: 'all',
  },
}
```

Vue 子应用使用相同配置，只需要把 `APP_NAME` 和端口改为 `reports-vue`、`9002`。如果项目仍使用 Webpack 4，对应配置项是 `jsonpFunction`。在 Webpack 5 中，`uniqueName` 为构建运行时提供唯一命名空间，`chunkLoadingGlobal` 则显式指定异步 chunk 使用的全局数组；显式配置两者便于跨应用检查和排错，但它们不是两套彼此独立的 qiankun 协议。

开发环境允许任意来源只用于简化本地联调。生产环境应限制允许的主应用来源；如果入口、脚本和样式通过不同 CDN 域名提供，每个被 HTML Entry 请求的资源都要返回正确的 CORS 响应头。

## 处理路由、资源与运行隔离

### 协调 activeRule 与子应用路由前缀

主应用用 `/orders` 激活订单应用，订单应用内部路由就应以 `/orders` 为 basename。React Router 可以在应用根组件中设置：

```tsx fold title="orders-react/src/App.tsx"
import type { PlatformAPI } from './platform-contract'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { OrderDetail } from './pages/OrderDetail'
import { OrderList } from './pages/OrderList'

type AppProps = {
  platform: PlatformAPI
}

export const App = (props: AppProps) => {
  const { platform } = props
  const basename = window.__POWERED_BY_QIANKUN__ ? '/orders' : '/'

  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<OrderList platform={platform} />} />
        <Route path="/:orderId" element={<OrderDetail platform={platform} />} />
      </Routes>
    </BrowserRouter>
  )
}

App.displayName = 'App'
```

Vue 子应用在前面的 `createWebHistory(base)` 中完成同样配置。主应用只匹配一级业务前缀，不应该维护 `/orders/:orderId` 之类的内部路由。

直接刷新 `/orders/123` 时，请求首先到达主应用服务器，因此服务器要把该路径回退到主应用 HTML；主应用启动后匹配 `/orders`，再挂载订单子应用。子应用独立访问时，其本地或独立服务器也要配置 history fallback。

如果简单字符串会误匹配相似路径，例如 `/orders-old`，应改用 activeRule 函数，明确判断 pathname 的边界。

### 设置 publicPath 并解决异步 chunk 404

主应用位于 `http://localhost:9000/orders`，不代表订单应用的异步 chunk 也在 `9000`。qiankun 会根据 HTML Entry 计算子应用资源基地址，并写入 `window.__INJECTED_PUBLIC_PATH_BY_QIANKUN__`；子应用的 `public-path.ts` 再把它赋给 Webpack 的 `__webpack_public_path__`。

这个文件必须在业务入口最先执行。若某个业务 import 先触发了动态加载，Webpack 已经按默认地址拼出 chunk URL，之后再修改 public path 也无法修正已经发出的请求。

发布时还要保证：

- HTML 中脚本和样式使用可基于入口解析的 URL；
- CSS 中字体、图片等资源经过构建工具重写到正确地址；
- 入口指向具体版本目录，异步 chunk 与该版本一起保留；
- 不覆盖旧版本文件，回滚时只切换入口映射。

### 选择沙箱与样式隔离策略

前面的完整 `start` 配置已经启用 Proxy 沙箱和 `experimentalStyleIsolation`，这里只说明 qiankun 配置如何映射到项目边界。沙箱与样式隔离的工作原理见[《微前端：架构决策与运行原理》](./微前端.md)。

qiankun 2.x 常见选择如下：

| 配置                               | 作用                                 | 适用边界                               |
| ---------------------------------- | ------------------------------------ | -------------------------------------- |
| `sandbox: true`                    | 开启 JavaScript 沙箱，不做选择器改写 | 子应用样式已经自行约束                 |
| `experimentalStyleIsolation: true` | 给样式选择器增加应用前缀             | 普通后台应用，兼容成本较低             |
| `strictStyleIsolation: true`       | 使用 Shadow DOM 隔离样式             | 冲突严重且组件库能够适配 Shadow DOM    |
| `sandbox: false`                   | 关闭运行时沙箱                       | 仅适合完全受控并能自行保证无污染的应用 |

本例选择实验性样式隔离，是为了在普通 DOM 中兼容现有 React、Vue 组件库。它仍然无法覆盖挂到 `document.body` 的弹层、全局 `@keyframes` 和绕过加载器插入的样式，因此子应用还要使用 CSS Modules、稳定前缀和语义 token。若改用严格样式隔离，还需验证主题、字体、Portal 和组件库对 Shadow DOM 的支持。

无论选择哪项配置，qiankun 沙箱都只用于减少意外污染，不是执行不可信代码的安全边界。

### 清理全局副作用与框架根节点

前面的生命周期只销毁了 React 或 Vue 根实例。业务代码创建的事件监听、定时器、Observer、WebSocket、订阅和请求仍要在组件卸载或 `unmount` 阶段释放。

qiankun 会记录一部分全局监听和动态样式，并在沙箱停用时尝试恢复，但它无法可靠识别所有第三方库副作用。子应用应满足两个验证条件：

1. 连续执行多次 `mount → unmount` 后，DOM、监听和定时任务数量不持续增长；
2. 子应用卸载后触发窗口事件或状态变化，不再执行该应用逻辑。

弹层如果属于子应用，应挂到子应用容器内并随根实例销毁；如果属于整个平台，则通过主应用提供的全局弹层 API 打开。

## 设计应用通信

### 通过 customProps 注入平台 API

主应用通过 `props` 注入平台能力，qiankun 会把这些值和 `container` 等运行时信息一起传给生命周期。平台接口只暴露稳定行为：

```ts fold title="platform-contract/src/index.ts"
export type CurrentUser = {
  id: string
  permissions: string[]
}

export type PlatformAPI = {
  navigate: (path: string) => void
  getCurrentUser: () => Promise<CurrentUser | null>
  hasPermission: (permission: string) => boolean
  authenticatedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  openGlobalDialog: (name: string, payload: unknown) => Promise<unknown>
  recordLifecycle: (appName: string, phase: string) => void
  reportError: (error: unknown, context?: Record<string, string>) => void
}

export type MicroAppProps = {
  appVersion: string
  container?: HTMLElement
  platform: PlatformAPI
}
```

契约可以作为独立 TypeScript 包发布，但运行时对象仍由主应用注入。子应用不应该直接接收访问令牌，也不应该读取主应用 store；`authenticatedFetch` 和 `getCurrentUser` 可以隐藏登录态的具体存储方式。

`navigate` 可以在主应用中调用 `history.pushState`。qiankun 底层的 single-spa 会监听被包装后的 History API，并在 URL 变化时重新计算活动应用。

### 用 initGlobalState 管理少量平台状态

qiankun 的 `initGlobalState` 适合主题、语言等少量平台状态。主应用应在注册微应用前初始化一次；前面的 `micro-apps.ts` 已通过副作用导入加载这个模块：

```ts fold title="portal-shell/src/platform-state.ts"
import { initGlobalState } from 'qiankun'

export const platformState = initGlobalState({
  locale: 'zh-CN',
  theme: 'light',
})

platformState.onGlobalStateChange((state, previousState) => {
  if (state.theme !== previousState.theme) {
    document.documentElement.dataset.theme = String(state.theme)
  }
})
```

子应用可以通过生命周期 Props 中的 `onGlobalStateChange`、`setGlobalState` 和 `offGlobalStateChange` 订阅、更新和清理。它不适合承载订单、报表筛选或表单状态，否则所有应用会重新依赖同一份可变数据结构。

需要跨应用持久化的业务数据仍应以后端为事实来源；可导航状态放入 URL；“订单已提交”之类的低频事实可以通过版本化事件契约通知。

### 协同登录态、权限、导航与全局弹层

四类能力的职责边界如下：

| 能力     | 主应用负责                       | 子应用负责                         |
| -------- | -------------------------------- | ---------------------------------- |
| 登录态   | 解析会话、刷新凭据、提供当前用户 | 不保存主应用令牌，调用平台请求能力 |
| 权限     | 提供统一策略和导航可见性         | 控制业务操作入口，后端执行最终授权 |
| 导航     | 管理跨应用跳转和一级路由         | 管理应用内部路由                   |
| 全局弹层 | 提供跨容器弹层服务               | 提供业务内容和输入参数             |

平台 API 要版本化。新增能力优先保持向后兼容；删除或修改签名前，先发布同时支持新旧契约的主应用，再逐个升级子应用，最后移除旧实现。

## 独立开发、测试与交付

### 本地只启动当前子应用

开发订单应用时，只需要启动主应用和 `orders-react`。`reports-vue` 可以继续指向集成环境的已部署版本。主应用从环境 manifest 读取入口，因此不必修改注册代码。

子应用还应保留独立入口。开发者可以直接访问 `http://localhost:9001` 调试订单内部逻辑，再通过主应用验证路由、平台 API、样式和生命周期集成。两种模式都要进入日常验证，避免独立模式长期失效。

跨域联调至少检查：

- 子应用 HTML、JS、CSS 和字体是否返回允许主应用读取的 CORS 头；
- 主应用 CSP 是否允许连接和加载子应用来源；
- Cookie、接口域名和代理规则是否与独立模式一致。

CORS 与脚本执行策略是两个问题。同源反向代理可以减少跨域请求和资源来源白名单，但不能消除动态代码执行限制。qiankun 2.x 的 `import-html-entry` 会通过 `eval` 或 `Function` 执行子应用脚本，缺少 `'unsafe-eval'` 的严格 `script-src` 会阻止这条路径。

`'unsafe-eval'` 会降低整个页面的 CSP 防护强度，不能仅为通过接入而直接放开。若生产策略不允许，应在选型阶段改用符合策略的加载方式或隔离方案，而不是等上线时再临时放宽 CSP。

### 测试生命周期、平台契约与核心链路

测试分为四层：

1. 子应用单元测试验证领域逻辑；
2. 生命周期测试重复执行 `bootstrap → mount → unmount`，检查容器和副作用；
3. 契约测试验证 `PlatformAPI`、全局状态和入口 manifest；
4. 集成环境端到端测试覆盖登录、跨应用导航、刷新和回滚。

生命周期测试不要只断言页面出现。它还要验证卸载后根节点被清空、全局监听不再响应，并且同一应用能够再次挂载。

React 和 Vue 子应用可以分别升级框架，但每次升级都要重新跑集成测试。独立部署意味着不同版本会在生产中短暂共存，测试环境也应覆盖当前主应用与新旧子应用的兼容组合。

### 发布不可变产物并支持灰度和回滚

每个子应用先把带内容哈希的资源上传到独立版本目录，再更新 manifest：

```json fold title="micro-app-manifest.json"
{
  "orders": {
    "entry": "/micro-apps/orders/releases/2026-07-22.1/",
    "version": "2026-07-22.1"
  },
  "reports": {
    "entry": "/micro-apps/reports/releases/2026-07-18.3/",
    "version": "2026-07-18.3"
  }
}
```

发布顺序必须是“先资源，后入口”：

1. 上传新版本全部文件；
2. 验证 HTML Entry 和异步 chunk 可访问；
3. 原子更新目标环境的 manifest；
4. 观察指标后扩大流量；
5. 出现异常时把 manifest 切回旧版本。

灰度可以让配置服务根据用户分组返回不同 manifest。不要覆盖旧目录中的文件，否则浏览器缓存、Source Map 和回滚版本会失去一致性。

## 保障性能、稳定性与可观测性

### 配置预加载并控制重复依赖

`prefetch: true` 使用 qiankun 默认的预加载策略。若只有少数高概率访问的应用，可以传应用名数组；`'all'` 会更积极地获取全部应用资源，只适合应用数量少且带宽成本可控的场景。

预加载前先测量首屏、应用切换和总下载量。主应用可优先保证当前路由，再在浏览器空闲且网络状况允许时加载下一个应用。低频报表、体积较大的编辑器和移动网络环境通常不适合全量预取。

qiankun 不会自动消除 React、Vue 或工具库的重复副本。可以通过 externals 等方式共享体积大且版本稳定的依赖，但共享会重新引入版本协调。小型依赖保留在子应用中，通常更有利于独立升级。

### 处理加载、挂载和运行时失败

失败处理需要区分阶段：

| 阶段     | 典型问题                          | 处理方式                                   |
| -------- | --------------------------------- | ------------------------------------------ |
| 入口加载 | HTML、脚本或样式超时、404、CORS   | 展示局部失败页，允许重试或切换稳定入口     |
| 生命周期 | 没有导出 UMD 生命周期、容器不存在 | 记录应用和阶段，清理残留容器，阻止继续挂载 |
| 应用运行 | 组件异常、接口失败                | 使用应用自身错误边界和业务降级             |
| 应用卸载 | 根实例或副作用未释放              | 标记泄漏并阻止错误实例继续复用             |

`loader` 只表示加载状态，不等于错误边界。主应用需要在全局错误处理器中识别应用名称和当前阶段；React、Vue 子应用内部仍要建立自己的错误边界和接口错误处理。

非关键子应用失败时，主应用导航和其他应用应继续可用。对于核心业务，可以保留上一个稳定版本入口，在连续加载失败或灰度指标异常时回退。

### 关联应用版本、生命周期日志与 Source Map

每条微前端日志至少携带：

- 主应用版本、子应用名称和 `appVersion`；
- 当前路由和发布环境；
- `beforeLoad`、`afterMount`、`afterUnmount` 等阶段；
- HTML Entry 与失败资源地址；
- 用户操作或请求的 trace ID。

子应用独立发布后，Source Map 也要按应用名称和版本上传。监控平台用日志中的 `appVersion` 选择对应 Source Map，才能把堆栈还原到准确源码。

性能指标同样按应用区分。至少记录入口加载、资源执行、mount 完成和首次可交互时间，避免只看整页指标而无法定位慢在哪个子应用。

## 渐进迁移与问题排查

### 选择试点并并行保留新旧实现

试点应选择路由独立、跨模块状态少、可以快速回滚的业务域。先建立 qiankun 容器、平台契约、监控和发布链路，再迁移页面；不要从拆全局组件库开始。

迁移期间，新旧实现可以同时发布，由主应用根据 manifest 或灰度规则选择入口：

```d2
direction: right

A: 选择边界清晰的路由
B: 建立 qiankun 接入契约
C: 独立构建并部署子应用
D: 小流量切换新入口
E: 指标满足预期 {
  shape: diamond
  class: decision
}
F: 扩大流量并迁移下一边界
G: manifest 切回旧实现
H: 定位问题并重新验证

A -> B -> C -> D -> E
E -> F: 是
E -> G: 否
G -> H -> C
```

### 用指标决定扩量或回滚

扩量前定义可以比较的指标：

- 子应用入口加载成功率；
- mount 成功率和耗时；
- 页面错误率与核心接口成功率；
- 首次可交互时间；
- 发布和回滚耗时。

只有指标稳定后才迁移下一个边界。若新旧实现长期并存却没有退出标准，主应用会积累双套路由、权限和监控逻辑，迁移成本反而持续增加。

### 建立高频问题排查表

| 现象                           | 常见原因                            | 优先检查                                    |
| ------------------------------ | ----------------------------------- | ------------------------------------------- |
| 子应用资源成功加载但没有渲染   | 生命周期未正确导出或容器选择器错误  | UMD 输出、`mount` 导出、容器内根节点        |
| 刷新子路由返回 404             | 主应用服务器未配置 history fallback | 主站回退规则、activeRule、子应用 basename   |
| 异步 chunk 请求到主应用域名    | public path 设置太晚或入口地址错误  | `public-path.ts` 导入顺序、注入的资源基地址 |
| 子应用样式影响整站             | 全局选择器或弹层逃离容器            | CSS Modules、样式隔离配置、Portal 容器      |
| 切换应用后逻辑仍在执行         | 监听、定时器或订阅未释放            | 组件清理函数、`unmount`、重复挂载测试       |
| 开发环境可用，生产环境加载失败 | CORS、CSP、缓存或入口版本不一致     | 响应头、资源白名单、manifest、CDN 文件      |

排查时先确定失败阶段，再检查该阶段的输入和产物。不要看到空白页就直接关闭沙箱或样式隔离；这通常只会隐藏生命周期、资源路径或清理逻辑中的真实问题。

## 总结：把 qiankun 当作运行时底座，而不是治理方案

qiankun 2.x 提供了 HTML Entry、路由级应用编排、JavaScript 沙箱、样式隔离和预加载，但它不会自动划分业务边界，也不会替团队建立契约、测试、监控和发布流程。

一套可持续的接入方案需要做到：

1. 主应用只负责应用编排和稳定平台能力；
2. 子应用同时支持独立运行与生命周期挂载；
3. 路由、public path、UMD 输出和 CORS 形成明确加载协议；
4. 全局状态保持最小，业务数据留在应用边界内；
5. 每个应用能够独立发布、观测和回滚。

当这些条件成立时，qiankun 才是承载自治应用的运行时底座；如果团队和交付仍然绑定在一起，它只会给模块化单体增加一层运行复杂度。
