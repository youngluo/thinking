---
createdAt: '2026-07-15 17:00'
draft: true
---

# Vite 原理与实践

Vite 在开发和生产阶段采用不同的处理方式。开发时，dev server 根据浏览器请求按需转换源码模块，以缩短启动和更新等待；构建时，Vite 从入口出发处理完整依赖图，生成适合部署的静态资源。这两条链路共同构成了 Vite 的工作方式。

## Vite 8 的工具链变化

Vite 8 延续了这套开发与生产分工，主要更新集中在底层工具链。依赖预构建和生产构建统一使用 Rolldown，原有的 Rollup 插件大多可以继续使用；新增构建配置应写入 `rolldownOptions`。JS、TS 和 JSX 转换以及生产环境的 JS 压缩主要由 Oxc 完成，CSS 则默认由 Lightning CSS 压缩。

底层工具更换后，Vite 的插件接口仍以 `resolveId`、`load`、`transform` 等钩子为核心，并可通过 hook filters 在进入 JavaScript 钩子前过滤模块。Vite 8 还加入了 `resolve.tsconfigPaths`、`server.forwardConsole` 等配置，分别用于解析 `tsconfig.json` 中的路径映射，以及把浏览器运行时错误和日志转发到 dev server 终端。这些变化分别作用于开发和生产流程。

## 开发阶段

dev server 串起整个开发流程，可以拆成四段：启动 dev server、首次打开页面、按需加载模块和热更新。

```d2
grid-columns: 1

dev: 启动 dev server {
  class: group
  direction: right

  a: 执行 vite dev
  b: 加载配置和插件
  c: 准备 HTTP / WS / 文件监听
  d: 依赖预构建或复用缓存

  a -> b -> c -> d
}

cold: 首次打开页面 {
  class: group
  direction: right

  a: 浏览器请求 index.html
  b: HTML 转换并注入 HMR client
  c: dev server 返回 HTML

  a -> b -> c
}

load: 按需加载模块 {
  class: group
  direction: right

  a: 浏览器 import 源码模块
  b: 解析、读取并转换源码
  c: 分析 import 并更新模块图
  d: 返回浏览器可执行的 ESM

  a -> b -> c -> d
}

hmr: 热更新 {
  class: group
  direction: right

  a: chokidar 发现变化
  b: 定位模块并使缓存失效
  c: 插件处理并寻找 HMR 边界
  d: 推送 update 并局部更新
  e: 整页刷新

  a -> b -> c
  c -> d: 找到边界
  c -> e: 未找到边界
}

```

### 启动 dev server

执行 `vite dev` 后，Vite 会先加载配置、解析插件，并准备 HTTP 服务、WebSocket 通道和文件监听。这里准备的是一个按需响应模块请求的服务，不会提前处理所有页面、路由和业务模块，因此冷启动通常较快。

启动阶段还会准备依赖预构建。Vite 发现 `import React from 'react'` 这类裸模块导入后，会先通过 Rolldown 预构建依赖，再把导入地址改写为 `/node_modules/.vite/deps/react.js?v=hash` 这类浏览器可以请求的 URL。预构建主要解决两个问题：

- 兼容性：将 CJS、UMD 或具有复杂入口的依赖转换为 ESM；
- 请求数量：有些 ESM 依赖包含大量小模块，浏览器逐个请求会拖慢页面加载。预构建会将这些模块合并，减少请求数量。

预构建产物保存在 `node_modules/.vite/deps/`。后续启动时，如果 lockfile 和相关配置没有变化，Vite 会复用已有产物；如果运行过程中发现新的裸模块导入，则会重新执行预构建，并在需要时刷新页面。通常无需手动配置，只有自动识别结果不符合预期时，才需要通过 `optimizeDeps.include` 指定要预构建的依赖，或通过 `optimizeDeps.exclude` 排除不需要预构建的依赖。

### 首次打开页面

浏览器首次请求 `index.html` 时，dev server 会转换 HTML、注入 HMR 客户端，再将结果返回给浏览器。HMR 客户端随后与服务端建立 WebSocket 连接，用于接收模块更新、错误信息和页面重载指令。

浏览器收到 HTML 后，会从入口脚本开始沿 ESM 导入关系请求源码模块。Vite 不会在启动时生成完整 bundle，而是在浏览器请求模块时按需处理。

### 按需加载模块

以 `/src/App.tsx` 为例，下面的流程图展示 dev server 从收到请求到返回 ESM 的处理过程：

```d2
direction: right

req: 浏览器请求 /src/App.tsx
out: 返回浏览器可执行的 ESM

server: Vite Dev Server {
  class: group

  B: resolveId 解析模块路径
  C: load 读取模块内容
  D: transform 转换源码
  E: import 分析并重写 URL
}

req -> server.B -> server.C -> server.D -> server.E -> out
```

这条链路中，`resolveId` 把导入路径解析为模块 id，`load` 读取或生成模块内容，`transform` 负责转换源码。转换结束后，Vite 会分析 import 语句，将导入地址改写为浏览器可以请求的 URL，并把依赖关系记录到模块图中。转换结果会作为 `transformResult` 缓存在对应的模块节点上。

CSS 和静态资源也会按需处理。导入 CSS 时，Vite 会将其包装成模块，并支持样式热更新；导入图片或字体时，Vite 会返回对应的资源 URL。`public` 目录中的文件不经过转换，直接按原路径提供。

### 模块缓存与模块图

Vite 会结合浏览器缓存和 dev server 的转换缓存，避免重复处理模块。源码请求使用 HTTP 协商缓存，预构建依赖则通过带版本参数的 URL 进行强缓存。dev server 会把转换结果保存在模块节点中，并在缓存未失效时复用。

为了管理转换结果和模块之间的导入关系，Vite 会维护模块图。下面的图展示了模块图如何定位节点，以及每个节点保存的主要信息：

```d2 maxHeight=400
graph: EnvironmentModuleGraph {
  class: group
  grid-columns: 3

  indexes: 索引入口 {
    class: subgroup
    grid-columns: 1

    url: 请求 URL
    id: 解析后 id
    file: 文件路径
    etag: ETag
  }

  spacer: " "
  spacer.width: 170
  spacer.style.opacity: 0

  node: EnvironmentModuleNode {
    class: subgroup
    grid-columns: 1

    identity: 模块身份
    cache: 转换缓存
    invalidation: 失效状态
    importers: importers
    importedModules: importedModules
    hmr: HMR 边界信息
  }

  indexes -> node: 找到模块节点
}
```

图中的主要数据结构及字段职责如下：

- `EnvironmentModuleGraph`：通过 URL、id、文件路径或 ETag 定位模块节点；
- `EnvironmentModuleNode`：保存转换结果、失效状态和 HMR 边界信息；
- `importers`：记录哪些模块导入了当前模块；
- `importedModules`：记录当前模块导入了哪些模块。

再次请求尚未失效的模块时，Vite 可以复用转换结果；文件变化后，则沿导入关系使受影响的模块失效，并计算 HMR 更新范围。

### 热更新

文件保存后，chokidar 会把变化通知 Vite。Vite 定位受影响的模块节点，并通过 `handleHotUpdate` 让插件调整本次更新范围，随后沿 `importers` 向上寻找 HMR 边界并使相关模块失效。找到边界时推送局部更新，否则触发整页刷新。完整流程如下：

```d2 maxHeight=420
shape: sequence_diagram

developer -> chokidar: 保存文件
chokidar -> devserver: 通知文件变化
devserver -> plugins: 执行 handleHotUpdate 钩子
plugins -> devserver: 返回待更新模块
devserver -> devserver: 寻找 HMR 边界并使模块失效

devserver -> client: WebSocket 推送 update（找到边界）
client -> devserver: 重新 import 新模块
devserver -> client: 返回新 ESM
client -> client: 执行 accept 回调并局部更新

devserver -> client: WebSocket 推送 full-reload（未找到边界）
client -> client: 整页刷新
```

实际开发中，HMR 边界通常由 React、Vue 等框架插件在转换阶段注入或标记。Vite 负责 HMR 通信和模块更新，框架插件负责将更新接入框架的刷新机制。以 React 为例，组件状态能否保留取决于 React Fast Refresh 的边界判断。

为了说明 HMR 边界如何接收更新，下面用底层 API 展示一个简化示例。假设 `utils` 导出了 `formatMessage`，可以在它更新后替换当前使用的函数：

```ts fold title="src/main.ts"
import { formatMessage } from './utils'

let format = formatMessage

function render() {
  document.querySelector('#app')!.textContent = format('Vite')
}

render()

if (import.meta.hot) {
  import.meta.hot.accept('./utils', (newModule) => {
    if (!newModule) return

    // 用新模块替换旧实现
    format = newModule.formatMessage
    render()
  })
}
```

## 生产阶段

### 构建流程

`vite build` 从入口开始解析、加载和转换模块，构建完整依赖图，最终生成可部署的静态资源。标准应用默认以 `index.html` 为入口，也可以通过 `build.rolldownOptions.input` 指定其它入口。

Vite 8 使用 Rust 编写的 Rolldown 完成生产构建。Rolldown 会在模块处理和产物生成过程中执行相应的插件钩子，并兼容 Rollup 插件 API，因此大多数现有 Vite 插件可以继续使用。完整流程如下：

```d2
direction: right

start: 执行 vite build
config: 加载生产配置
entry: 确定构建入口
modules: 解析 / 加载 / 转换模块
graph: 构建完整依赖图
optimize: Tree Shaking / 代码分块
assets: 处理 CSS / 静态资源
emit: 压缩 / 哈希命名
dist: 输出 dist 产物

start -> config -> entry -> modules -> graph -> optimize -> assets -> emit -> dist
```

### 优化策略

基于完整依赖图，Vite 和 Rolldown 默认会执行以下优化：

- Tree Shaking：基于模块的静态结构移除未使用代码；
- Code Splitting：根据入口、动态导入和自定义规则生成 chunk；
- CSS Code Splitting：提取异步 chunk 关联的 CSS，并确保 CSS 加载完成后再执行该 chunk；
- Module Preload：预加载入口依赖和动态导入所需的 chunk，减少串行请求；
- 资源哈希：根据内容生成带 hash 的文件名，支持长期缓存；
- 压缩：客户端构建默认使用 Oxc Minifier 压缩 JS，使用 Lightning CSS 压缩 CSS。

这些策略通常不需要额外配置。下面以 React 项目为例，展示几项可按实际情况调整的配置：

```ts fold title="vite.config.ts"
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    // 内联较小的资源，减少额外请求；阈值不宜过大，以免增加包体积
    assetsInlineLimit: 8 * 1024,

    // CI 已有产物分析时，关闭 gzip 统计可缩短大型项目的构建时间
    reportCompressedSize: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // 避免生成过小的公共 chunk
          minSize: 20 * 1024,
          groups: [
            {
              // 框架依赖变动较少，单独分包可提高长期缓存命中率
              name: 'react-vendor',
              test: /node_modules[\\/]react/,
              // 优先于通用公共分组
              priority: 20,
            },
            {
              // 抽取至少被两个入口共享的模块
              name: 'common',
              minShareCount: 2,
              priority: 10,
            },
          ],
        },
      },
    },
  },
})
```

## dev 与 build 差异

dev 和 build 共用配置与插件体系，但处理范围和输出目标不同：dev 按浏览器请求转换模块，build 则从入口出发分析完整依赖图并生成部署产物。差异主要体现在以下方面：

- **处理范围**：未访问的路由或模块可能不会在 dev 中被转换，build 会处理所有可达模块，因此可能暴露模块解析、语法或变量动态导入问题。变量动态导入需使用相对路径和明确扩展名，变量只能表示一层文件名；更复杂的场景可使用 `import.meta.glob`；

- **转换目标**：dev 面向现代浏览器，尽量保留源码语法；build 则根据 `build.target` 转换语法，并执行 Tree Shaking、代码分块和压缩；

- **依赖处理**：依赖预构建只用于 dev，build 会重新分析并打包依赖。非标准的 CJS/ESM 导出可能暴露导入错误，错误的 `sideEffects` 声明也可能导致必要代码被移除；

- **资源路径**：dev server 直接提供本地资源，build 产物中的 JS、CSS 和图片 URL 则根据 `base` 生成。部署到 CDN 或子路径时，需要按实际路径配置并验证产物。

因此，提交或部署前应运行 `vite build`，再通过 `vite preview` 或真实环境检查产物。Vite 只转译 TypeScript，不执行类型检查，TypeScript 项目还需要运行 `tsc --noEmit` 或相应的检查工具。

## 插件机制

### 钩子分类

Vite 插件扩展了 Rolldown 的插件接口。`resolveId`、`load`、`transform` 等通用钩子同时参与 dev 和 build，Vite 专属钩子则用于配置、dev server、HTML 转换和 HMR。生产构建还会调用 `generateBundle` 等产物生成钩子。

按执行阶段和职责划分，常用钩子如下：

| 分类      | Hook                 | 执行时机与用途                                                                                                       |
| --------- | -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 配置      | `config`             | 配置解析前执行，用于修改用户传入的 Vite 配置                                                                         |
| 配置      | `configResolved`     | 配置解析后执行，用于读取和保存最终配置                                                                               |
| 模块处理  | `resolveId`          | 将 import 路径解析为模块 id，dev 中响应模块请求，build 中参与构建依赖图                                              |
| 模块处理  | `load`               | 读取模块内容，也可以生成虚拟模块                                                                                     |
| 模块处理  | `transform`          | 转换模块源码，返回后续链路需要的代码和 source map                                                                    |
| 开发服务  | `configureServer`    | 仅在 dev 中执行，用于注册中间件、扩展 WebSocket 或保存 dev server 实例                                               |
| 开发服务  | `handleHotUpdate`    | 仅在 dev 中执行，用于过滤受影响的模块或自定义 HMR 处理；接管更新或触发整页刷新时，需要通过 `server.ws.send` 发送消息 |
| HTML 处理 | `transformIndexHtml` | 在 dev 和 build 中处理入口 HTML，可以改写内容或注入标签                                                              |
| 生命周期  | `buildStart`         | 在生产构建开始或 dev server 启动时执行，适合初始化插件状态                                                           |
| 产物生成  | `generateBundle`     | 仅在 build 的产物生成阶段执行，可以生成额外文件、调整产物或分析 chunk 结构                                           |
| 生命周期  | `closeBundle`        | 在生产构建结束或 dev server 关闭时执行，适合清理状态、输出报告或通知外部流程                                         |

可以通过 `apply: 'serve' | 'build'` 限制插件的生效范围。只处理特定文件时，可以使用 hook filters 在调用钩子前过滤，并保留钩子内部检查，以兼容不支持该能力的旧版 Vite。下面的 alias 插件便用 hook filter 筛选 `@/` 导入，并将其映射到 `src/`：

```ts fold title="plugins/my-alias.ts"
import type { Plugin } from 'vite'
import { fileURLToPath } from 'node:url'

export default function myAlias(): Plugin {
  return {
    name: 'my-alias',
    resolveId: {
      // 在进入钩子前过滤非 @/ 导入。
      filter: { id: /^@\// },
      handler(source) {
        // 保留内部检查，以兼容不支持 hook filters 的旧版 Vite。
        if (!source.startsWith('@/')) return null

        return fileURLToPath(new URL(`../src/${source.slice(2)}`, import.meta.url))
      },
    },
  }
}
```

这个插件通过 `resolveId` 统一处理两条链路中的路径解析：dev 模式下解析模块请求，build 模式下参与 Rolldown 构建依赖图。

### 常用插件

常用插件可以按职责分为：

- 框架集成：`@vitejs/plugin-vue`、`@vitejs/plugin-react`、`@sveltejs/vite-plugin-svelte`；
- 跨工具复用：`unplugin-icons`、`unplugin-auto-import`、`unplugin-vue-components`，可以在 Vite、Webpack、Rollup 和 Rolldown 等工具中复用插件逻辑；
- 调试分析：`vite-plugin-inspect` 用于查看插件转换结果，`rollup-plugin-visualizer` 用于分析构建产物占比；
- Vite DevTools：安装 `@vitejs/devtools` 并设置 `devtools: true` 后，可以查看内部状态和构建分析。该实验性能力目前只支持 build 模式。

### Module Federation

Vite 本身不提供开箱即用的 Module Federation 配置。需要跨应用暴露和加载模块时，可以接入 `@module-federation/vite`：remote 声明可暴露模块，host 配置远程入口和导入别名。

remote 端负责暴露模块：

```ts fold title="remote/vite.config.ts"
import { federation } from '@module-federation/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    federation({
      // remote 应用名，用来标识远程容器。
      name: 'remote',
      // 构建后生成的远程入口文件。
      filename: 'remoteEntry.js',
      // 对外暴露的模块，key 以 ./ 开头，value 是内部文件路径。
      exposes: {
        './Button': './src/Button.tsx',
      },
      // 运行时复用的依赖，React 这类依赖通常需要保持单例。
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
      },
    }),
  ],
})
```

host 端通过 `remotes` 指向远程入口：

```ts fold title="host/vite.config.ts"
import { federation } from '@module-federation/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    federation({
      // host 应用名，用来标识当前容器。
      name: 'host',
      // 声明 host 可以消费哪些远程应用。
      remotes: {
        // host 里的导入别名，例如 import 'remoteApp/Button'。
        remoteApp: {
          // Vite remote 通常按 ESM 入口加载。
          type: 'module',
          // 对应 remote 端 name 字段。
          name: 'remote',
          // remote 端暴露出来的远程地址，对应 filename 字段。
          entry: 'http://localhost:3001/remoteEntry.js',
        },
      },
      // 与 remote 端保持一致，避免重复加载 React。
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
      },
    }),
  ],
})
```

如果 host 要加载 Webpack 产出的 `var` remote，要把入口格式和全局容器名写清楚，同时确认共享依赖版本和运行时版本：

```ts fold title="host/vite.config.ts"
federation({
  name: 'host',
  remotes: {
    remoteApp: {
      // Webpack remote 通常按全局变量容器加载。
      type: 'var',
      // 对应 remote 的 name。
      name: 'webpackRemote',
      // remote 暴露出来的入口地址。
      entry: 'http://localhost:3002/remoteEntry.js',
      // remoteEntry 挂到全局对象上的变量名。
      entryGlobalName: 'webpackRemote',
    },
  },
})
```

然后在 host 里按「导入前缀/暴露模块名」导入：

```tsx fold title="host/src/App.tsx"
import RemoteButton from 'remoteApp/Button'

export function App() {
  return <RemoteButton />
}
```

## 总结

Vite 的核心不是“不打包”，而是为开发和生产提供目标不同的处理链路。

开发阶段，dev server 按浏览器请求转换业务源码，依赖预构建合并裸模块请求。dev server 缓存避免重复转换，模块图记录转换结果、导入关系和 HMR 边界。

生产阶段，Rolldown 从入口构建完整依赖图，再执行 Tree Shaking、代码分块、资源哈希、压缩和预加载优化。

`resolveId`、`load`、`transform` 等通用钩子可以同时服务两条链路，dev server 中间件、HMR 和产物生成则各有专属钩子。区分这些职责后，问题落在 dev 还是 build 链路，可以从钩子归属快速判断。
