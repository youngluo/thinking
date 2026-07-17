---
createdAt: '2026-07-15 17:00'
draft: true
---

# Vite 原理与实践

> 本文基于 Vite 8+ 版本讨论。

Vite 的核心思路，是在开发阶段和生产阶段采用两套不同策略。开发时，它尽量不提前打包业务代码，而是把源码转换成浏览器可直接加载的原生 ESM，按需交给浏览器；生产时，再进入完整构建流水线，集中完成 Tree Shaking、代码分块和资源优化。

## Vite 8 主要更新点

Vite 8 这次比较大的变化，不在"开发按需、生产构建"这条主线上，而在底层工具链。依赖预构建和生产构建都开始走 Rolldown，原来 Rollup 生态里的配置和插件能力还在，但新配置更推荐写到 `rolldownOptions`。JS / TS 转译、生产压缩则更多交给 Oxc：开发时减少单个模块的 transform 时间，生产时也能压低压缩阶段的开销。

其他变化更偏工程细节。CSS 压缩默认走 Lightning CSS，图片、字体和 `public` 目录资源仍然由 Vite 统一处理 URL 和缓存策略；插件钩子还是围绕 `resolveId`、`load`、`transform` 展开，只是 Vite 8 多了 hook filters，可以在进入 JavaScript 钩子前先过滤模块。`resolve.tsconfigPaths` 这类常用能力也有了内置开关，不过它不是要替代所有插件，只是让简单场景少装一层适配。

## 开发阶段

开发阶段可以拆成四段：启动 dev server、首次打开页面、按需加载模块、文件变化后的 HMR 更新。

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
  b: 定位模块并清理缓存
  c: 插件处理并寻找 HMR 边界
  d: 推送 update 并局部更新
  e: 整页刷新

  a -> b -> c
  c -> d: 找到边界
  c -> e: 未找到边界
}

```

### 启动 dev server

执行 `vite dev` 后，Vite 会先加载配置、解析插件，并准备 HTTP 服务、WebSocket 通道和文件监听。这里准备的是一个能"按需响应模块请求"的服务，而不是提前打包好的应用，所以 Vite 冷启动通常很快。它不需要在一开始就把所有页面、所有路由、所有业务模块都处理完。

启动阶段还会处理依赖预构建。浏览器原生 ESM 不认识裸模块导入，`import React from 'react'` 必须被改写成 `/node_modules/.vite/deps/react.js?v=hash` 这种明确 URL，预构建就是做这个改写的前置工作。它主要解决两个问题：

- 兼容性：很多 npm 包仍以 CJS、UMD 或复杂入口形式发布，预构建把它们打成 ESM。
- 请求数量：有些依赖内部会拆成大量小模块，浏览器按原样逐个请求会让页面首屏变慢。预构建把这类依赖整理成更少、更稳定的文件。

在 Vite 8 中，依赖预构建由 Rolldown 负责。它仍然解决兼容性和请求数量问题，同时和生产构建共用同一套打包基础设施，让配置理解和产物形态更一致。

预构建产物落在 `node_modules/.vite/deps/`，文件带 hash 后缀。后续启动如果 lockfile 和配置没变，命中缓存就不会重跑；如果开发过程中出现新的裸模块导入，Vite 也可能补充预构建并刷新页面。

常见配置：

```ts fold title="vite.config.ts"
import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    include: ['lodash-es'],
    exclude: ['my-local-pkg'],
  },
})
```

`include` 用来显式加入需要预构建、但 Vite 没有自动发现的依赖；`exclude` 用来跳过不希望进入预构建流程的依赖，例如需要按源码方式调试的本地包。预构建的优化前提是"变化少 + 强缓存"，源码因为变化频繁不适合走这条路。

### 首次打开页面

浏览器第一次请求 `index.html` 时，dev server 会先对 HTML 做转换，再注入 HMR 客户端，最后返回给浏览器。这个客户端负责和服务端建立 WebSocket 连接，后续接收 HMR 消息、错误覆盖层消息以及页面重载指令。

这一步之后，浏览器才真正开始按 HTML 里的入口脚本加载源码模块。也就是说，Vite 的开发阶段不是"启动时产出一个 bundle"，而是"先返回 HTML，再让浏览器沿着 ESM import 图逐个发起模块请求"。

浏览器 console 日志和报错可以通过 `server.forwardConsole` 转发到 dev server 终端，检测到 coding agent 时会自动开启，对 AI 辅助调试场景特别有用。

### 按需加载模块

业务源码不会在启动时全部转换。浏览器请求到哪个模块，Vite 才处理哪个模块；每个源码文件在开发时仍然以模块为单位存在，浏览器会沿着 import 图继续请求依赖的子模块。这让 Vite 的开发模式更像"模块服务"，而不是"提前打包"。

以 `/src/App.tsx` 为例，dev server 收到请求后，会先解析模块路径，再读取源码、执行转换、分析 import，最后返回浏览器可执行的 ESM：

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

这条链路里，`resolveId` 负责把导入路径解析成模块 id，`load` 负责读取或生成模块内容，`transform` 负责把源码转换成浏览器能执行的形式。TS、JSX、CSS 等语法处理都发生在这里；JS / TS 转译交给 Oxc 后，单个模块的 transform 时间会更短。

转换结束后，Vite 会分析 import 语句，把裸模块导入或相对路径改写成浏览器可以请求的 URL，并把依赖关系记录到模块图里。同一份 transform 结果既用于返回浏览器 ESM，也会作为 `transformResult` 缓存在模块节点上（见模块缓存与模块图小节）。

CSS 和静态资源也沿用这套按需请求模型。CSS 被导入时，Vite 会把它包装成浏览器可加载的模块，并在开发阶段支持样式热更新；图片、字体等资源被导入时，会返回浏览器可请求的 URL，`public` 目录下的文件则按原路径直接提供。

插件可以介入这条链路，transform 顺序由插件的 `enforce: 'pre' | 'post'` 和注册顺序共同决定。比如把 `.svg` 当成可导入的字符串：

```ts fold
import type { Plugin } from 'vite'

export default function svgAsString(): Plugin {
  return {
    name: 'svg-as-string',
    transform(code, id) {
      if (!id.endsWith('.svg')) return
      return `export default ${JSON.stringify(code)}`
    },
  }
}
```

### 模块缓存与模块图

按需转换不等于每次都重新转换。Vite 会结合文件时间戳、HTTP 协商缓存和依赖缓存，尽量复用已有结果。浏览器重复请求同一个模块时，可以通过 ETag / Last-Modified 命中 304；服务端命中缓存时，也不需要重新走完整 transform。

为了让这些缓存能被正确复用和失效，Vite 在服务端维护一份模块图。可以先把它理解成 dev server 的运行时索引：一边通过 URL、id、文件路径或 ETag 找到模块节点，一边记录模块之间的导入关系。

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

对应到 Vite 8 源码里，这些职责可以拆成几部分：

- `EnvironmentModuleGraph`：模块图本体，内部多组 Map 负责定位模块节点。
- `EnvironmentModuleNode`：模块节点，保存转换结果、软/硬失效状态和 HMR 边界信息。
- `importers`：模块节点上的字段，记录"哪些模块导入了当前模块"。
- `importedModules`：模块节点上的字段，记录"当前模块导入了哪些模块"。

这样设计有两个直接作用：请求同一个模块时，可以复用上一次的转换结果；文件变化时，也能沿着导入关系找到需要失效或热更新的范围。失效状态会影响下一次请求的处理方式，比如有些模块需要重新 transform，有些只需要更新导入 URL 上的时间戳。

### 热更新

文件保存后，chokidar 检测到变化，Vite 会定位到对应的模块节点，清理其 `transformResult` 缓存，并把变化交给插件的 `handleHotUpdate` 钩子处理。默认流程会沿 `importers` 向上寻找能接住更新的 HMR 边界，如果找到边界就推送局部更新，否则就触发整页刷新。时序图如下：

```d2 maxHeight=420
shape: sequence_diagram

developer -> chokidar: 保存文件
chokidar -> devserver: 通知文件变化
devserver -> devserver: 定位模块节点并清理缓存
devserver -> plugins: 执行 handleHotUpdate 钩子
plugins -> devserver: 返回待更新模块
devserver -> devserver: 沿 importers 寻找 HMR 边界

devserver -> client: WebSocket 推送 update（找到边界）
client -> devserver: 重新 import 新模块
devserver -> client: 返回新 ESM
client -> client: 执行 accept 回调并局部更新

devserver -> client: WebSocket 推送 full-reload（未找到边界）
client -> client: 整页刷新
```

实际开发里，HMR 边界通常不是业务代码手写的，而是由 React、Vue 等框架插件在转换阶段注入或标记。以 React 为例，组件状态能不能保留取决于 React Fast Refresh 的边界判断；Vite 提供 HMR 通道和模块更新机制，框架插件负责把这个能力翻译成框架内部能理解的刷新方式。

如果脱离框架插件，也可以用底层 API 手写 HMR 边界。例如监听某个工具模块的变化：

```ts fold
if (import.meta.hot) {
  import.meta.hot.accept('./utils', (newModule) => {
    // 用新模块替换旧实现
  })
}
```

全局副作用模块、复杂状态初始化模块通常很难形成稳定的 HMR 边界，因为它们的执行结果可能已经影响了全局对象、事件监听、单例实例或应用初始状态。只替换当前模块，未必能安全撤销旧副作用并重建一致状态，所以这类变化更容易退化为整页刷新。客户端 import 新模块时会带 `?t=timestamp` 参数绕过浏览器缓存。

## 生产阶段

### 构建流程

`vite build` 不会沿用"浏览器按需请求每个源码模块"的方式，而是从入口开始构建完整依赖图，生成适合线上部署的静态资源。生产阶段的目标也和开发阶段不同：dev 追求启动快、更新快，build 追求资源体积、缓存命中、加载顺序和浏览器兼容。

在 Vite 8 中，生产构建基于 Rolldown。Rolldown 是 Rust 写的打包器，兼容 Rollup 插件 API，也承接了 Vite 过去大量 Rollup 生态里的配置和插件能力。

```d2
direction: right

start: 执行 vite build
config: 加载生产配置
entry: 以 index.html 为入口
graph: 构建完整依赖图
hooks: 执行构建阶段插件钩子
optimize: Tree Shaking / 代码分块
assets: CSS 拆分 / 资源处理
emit: 压缩 / 哈希命名
dist: 输出 dist 产物

start -> config -> entry -> graph -> hooks -> optimize -> assets -> emit -> dist
```

### 优化策略

生产阶段主要做这些优化：

- Tree Shaking：基于 ESM 静态结构移除未使用代码，CJS 只能做有限分析。
- Code Splitting：按入口和动态导入拆分 chunk。
- CSS Code Splitting：把异步 chunk 相关 CSS 拆出，并在对应 chunk 加载时一起获取。
- 资源 hash：根据内容生成带 hash 的文件名，让未变化的资源更容易命中长期缓存。
- modulepreload：为 HTML 入口和动态导入涉及的 chunk 计算预加载依赖。
- 压缩：减小 JS、CSS 和资源体积。JS 默认走 Oxc minifier，CSS 默认走 Lightning CSS minifier。

构建配置示例：

```ts fold title="vite.config.ts"
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rolldownOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
})
```

`build.target` 控制目标浏览器版本。Vite 8 默认是 `'baseline-widely-available'`，对应一组 Baseline Widely Available 浏览器；如果需要更旧的浏览器，可以显式设置为具体 ES 版本或浏览器版本。

`build.rollupOptions` 仍作为兼容别名存在，但新配置优先写 `build.rolldownOptions`。这样既能保留 Rollup 生态里的配置习惯，又能落到 Rolldown 的生产构建链路上。

开发阶段追求"每次改动后的反馈速度"，生产阶段追求"用户访问时的加载效率"。这是两个不同的问题，所以 Vite 没有把 dev server 的按需转换链路直接搬到 build 里。

## dev 与 build 差异

前面已经分别展开了开发阶段和生产阶段，这里只收束几个实际项目里容易踩到的问题。dev 能跑起来，并不代表 build 一定通过。

- **变量动态导入**：dev 只处理当前浏览器真正请求到的模块，没访问到的路径可能不会触发；build 必须提前枚举候选文件，像 `import(path)` 这种完全动态的路径，可能导致构建失败或对应 chunk 没生成。处理时要让动态导入范围可分析，例如固定目录和后缀；批量页面或组件导入优先用 `import.meta.glob`。

- **部署路径问题**：本地 dev server 通常跑在根路径，资源 URL 很容易看起来正常；build 产物里的 JS、CSS、图片 URL 会受 `base` 影响，部署到 CDN、子路径或非根目录时可能 404。处理时要根据部署路径设置 `base`，再用 `vite preview` 或真实部署环境验证。

- **第三方依赖导出不一致**：dev 预构建后可能把 CJS 依赖整理成浏览器可加载的 ESM，页面暂时能跑；build 重新打包时可能报 `default is not exported by ...`、`X is not exported by ...`，也可能因为错误的 `sideEffects` 声明把样式或初始化代码摇掉。处理时先检查实际导入方式和依赖入口，必要时改成命名导入、升级依赖、加别名或调整 Tree Shaking 配置。

关键改动最好跑 `vite build` 验证，并用 `vite preview` 预览产物。dev server 只能证明开发链路能跑通，不能替代生产构建验证；类型检查则需要交给 `tsc --noEmit` 或独立插件处理。

## 插件机制

### 钩子分类

插件是 Vite 连接开发阶段和生产阶段的扩展层。Vite 8 的插件接口基于 Rolldown / Rollup 插件模型，再补充少量 Vite 自己的钩子。一个插件可以简化成这样：

```ts fold
export default {
  name: 'example-plugin',

  config(config) {},
  configResolved(config) {},
  configureServer(server) {},

  resolveId(source, importer) {},
  load(id) {},
  transform(code, id) {},

  transformIndexHtml(html) {},
  handleHotUpdate(ctx) {},

  buildStart() {},
  generateBundle() {},
  closeBundle() {},
}
```

这些钩子可以按执行链路逐个理解：

| Hook                 | 说明                                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`             | 最早执行，用来修改用户传入的 Vite 配置                                                                                                                                                                      |
| `configResolved`     | 拿到最终合并后的配置，适合读取命令、模式、根目录、插件列表等结果                                                                                                                                            |
| `configureServer`    | 只在 dev server 中生效，可以注册中间件、扩展 WebSocket 或保存 server 实例                                                                                                                                   |
| `resolveId`          | 把 import 路径解析成模块 id。开发阶段参与每次模块请求，生产阶段参与 Rolldown 构建依赖图                                                                                                                     |
| `load`               | 读取文件内容，也可以直接生成虚拟模块内容                                                                                                                                                                    |
| `transform`          | 把源码转换成浏览器或构建器需要的代码                                                                                                                                                                        |
| `transformIndexHtml` | 专门处理入口 HTML，常见用途是注入脚本、标签或改写 HTML 内容                                                                                                                                                 |
| `handleHotUpdate`    | 只在开发阶段生效，用来接管文件变化后的 HMR 处理。返回 `undefined` 表示继续走默认 HMR 流程；返回模块数组可以收窄本次需要更新的模块；如果插件要接管更新或触发整页刷新，需要自己通过 `server.ws.send` 推送消息 |
| `generateBundle`     | 在产物写入前拿到 bundle 信息，适合生成额外文件、调整产物或分析 chunk 结构                                                                                                                                   |
| `closeBundle`        | 在构建结束后执行，适合做收尾清理、输出报告或通知外部流程                                                                                                                                                    |

如果插件只应该跑在某个阶段，可以用 `apply: 'serve' | 'build'` 限制。如果插件只关心一类文件，应该尽量把匹配范围收窄。Vite 8 可以借助 hook filters 在调用钩子前先过滤模块，避免每个文件都进入 JavaScript 钩子。

举个例子，手写一个 alias 插件把 `@/` 映射到 `src/`：

```ts fold
import type { Plugin } from 'vite'
import { fileURLToPath } from 'node:url'

export default function myAlias(): Plugin {
  return {
    name: 'my-alias',
    resolveId(source) {
      if (source.startsWith('@/')) {
        return fileURLToPath(new URL(`./src/${source.slice(2)}`, import.meta.url))
      }
      return null
    },
  }
}
```

这个插件的核心是 `resolveId`。在 dev 模式下，它参与每次模块请求的路径解析；在 build 模式下，它参与 Rolldown 构建依赖图时的路径解析。

### 常用插件

按场景推荐几类：

- 框架集成：`@vitejs/plugin-vue`、`@vitejs/plugin-react`、`@vitejs/plugin-svelte`。
- 跨工具复用：`unplugin-icons`、`unplugin-auto-import`、`unplugin-vue-components`，同一份逻辑可以复用到 Vite、Webpack、Rollup、Rolldown 等工具里。
- 调试分析：`vite-plugin-inspect`（可视化插件钩子调用链）、`rollup-plugin-visualizer`（构建产物占比）。
- 内置 Devtools：`devtools: true` 开启 `@vitejs/devtools`，从 dev server 直接看模块图、依赖、转换链。

### Module Federation

Vite 本身不内置 Module Federation。需要远程模块加载时，可以通过 `@module-federation/vite` 接入，核心配置就是 remote 暴露什么，以及 host 从哪里消费。

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

```tsx fold
import RemoteButton from 'remoteApp/Button'

export function App() {
  return <RemoteButton />
}
```

## 总结

Vite 的核心不是简单地"不打包"，而是把开发阶段和生产阶段拆成两套目标不同的链路。

开发阶段，dev server 把业务源码按浏览器请求逐个转换，依赖通过预构建和缓存提前稳定，模块图则负责记录转换结果、导入关系和 HMR 边界。生产阶段，Vite 回到完整构建流程，由 Rolldown 构建依赖图，再做 Tree Shaking、代码分块、资源哈希、压缩和预加载优化。

插件机制把这两条链路连接起来：同一套 `resolveId`、`load`、`transform` 可以同时服务 dev 请求和 build 构建，但 dev server 中间件、HMR、构建产物输出又各有自己的钩子。理解这层边界后，就能解释为什么 Vite 开发体验很快，也能理解为什么关键改动仍然需要用 `vite build` 和 `vite preview` 验证生产产物。
