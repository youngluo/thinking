---
createdAt: '2026-05-28 20:47'
order: 1
---

# Webpack 原理与实践

Webpack 以模块图为核心，通过插件扩展构建能力。它把 JavaScript、CSS、图片和字体统一纳入模块系统，一次构建会经过配置读取、Compiler 创建、模块图构建、模块转换和产物生成，最终输出浏览器可以加载的静态资源。文件变化时，开发模式会沿着同一编译链路重新处理受影响模块。

## 构建流程

执行 `webpack` 命令后，Webpack 会按准备、编译和输出三个阶段完成一次构建，主链路如下：

```d2 maxHeight=320
direction: down
grid-columns: 1

prepare: 准备 {
  class: group
  direction: right

  cli: 读取配置
  compiler: 创建 Compiler

  cli -> compiler
}

compile: 编译 {
  class: group
  direction: right

  compilation: 创建 compilation
  module: 构建模块图
  chunkGraph: 生成 chunk graph

  compilation -> module -> chunkGraph
}

output: 输出 {
  class: group
  direction: right

  optimize: Tree Shaking / splitChunks
  render: 生成 bundle 与 runtime
  assets: 生成 assets
  emit: 写入输出目录

  optimize -> render -> assets -> emit
}

```

### 创建 Compiler

执行 `webpack` 命令是构建入口。Webpack CLI 读取配置，从 `entry` 开始收集依赖，依据 `output` 确定产物写入方式，然后创建 Compiler 启动编译。

Compiler 是一次 Webpack 运行的总控制器，保存配置并管理生命周期，负责触发构建、监听文件变化和输出结果。每次具体编译由 compilation 表示，它记录本次构建的模块、依赖、chunk、asset、warning 和 error。开发模式下，每次文件变化都会创建新的 compilation。

### 构建模块图

Webpack 先构建 module graph，再据此生成 chunk graph。前者记录模块间的依赖，后者记录模块与 chunk 的归属，以及 chunk 之间的加载关系。

构建 module graph 时，Webpack 从 `entry` 开始收集依赖。resolver 先将模块请求解析为文件路径，Webpack 创建模块并执行 loader 转换，parser 再提取依赖信息。发现新依赖后，Webpack 会重复这一过程，直到没有新的模块需要处理。动态导入还会标记异步加载边界，供后续 chunk graph 使用。

module graph 完成后，Webpack 会根据入口和动态导入边界建立 chunk，再应用 `splitChunks` 规则调整分组。入口及其同步依赖通常进入初始 chunk，动态导入分支形成异步 chunk，可复用模块则可能被提取到公共 chunk。

### 输出资源

模块与 chunk 的关系确定后，Webpack 会先优化 chunk，再生成 asset 并写入输出目录：

- **优化 chunk**：Webpack 在 chunk graph 的基础上调整 chunk 的内容与边界。Tree Shaking 会标记未使用的导出，减少最终生成的代码；
- **生成 asset**：chunk 是构建过程中的模块分组，不直接等同于输出文件。Webpack 会将 chunk 生成 JavaScript bundle，bundle 是 asset 的一种；资源模块、loader 或 plugin 还可以生成 CSS、图片、字体、HTML 和 source map 等其它 asset。所有 asset 都会记录在本次 compilation 中，并可通过 `compilation.hooks.processAssets` 继续处理；
- **emit 写入**：所有 asset 准备完成后，Compiler 进入 emit 阶段。`output.path` 指定输出目录，`output.filename` 和 `output.chunkFilename` 分别确定初始、非初始 chunk 的文件名，`output.assetModuleFilename` 确定资源模块的文件名。Webpack 随后通过输出文件系统写入这些 asset。

### Webpack Runtime

Webpack Runtime 是随构建产物注入的运行时代码，负责注册和执行模块、缓存模块结果，以及按需加载异步 chunk。实际 runtime 还会根据 `publicPath` 计算 chunk URL，并处理加载失败和 HMR；下面只保留 `import('./src/settings.js')` 对应的加载、注册和执行过程：

```js fold title="webpack runtime（简化）"
// 模块 ID 到模块工厂函数的映射
const modules = {}
const moduleCache = {}
const chunkPromises = {}

function requireModule(moduleId) {
  const cachedModule = moduleCache[moduleId]
  if (cachedModule) {
    return cachedModule.exports
  }

  const module = { exports: {} }
  moduleCache[moduleId] = module
  modules[moduleId](module)
  return module.exports
}

// 异步 chunk 执行时调用，向模块表注册新模块
window.registerChunk = (newModules) => {
  Object.assign(modules, newModules)
}

function loadChunk(chunkId) {
  if (!chunkPromises[chunkId]) {
    chunkPromises[chunkId] = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `${chunkId}.chunk.js`
      script.onload = resolve
      script.onerror = reject
      document.head.appendChild(script)
    })
  }

  return chunkPromises[chunkId]
}

async function loadSettings() {
  // 先加载 settings.chunk.js，等待其中的模块注册完成
  await loadChunk('settings')
  // 再执行已注册的 settings 模块，并返回它的导出值
  return requireModule('./src/settings.js')
}

// 以下代码位于 settings.chunk.js
window.registerChunk({
  './src/settings.js': (module) => {
    module.exports = {
      title: 'Settings',
    }
  },
})
```

### 热更新

HMR 处理开发模式下的模块更新。文件保存后，Webpack 只重新编译受影响模块，生成 update manifest 和 hot update chunk；dev server 通知浏览器 runtime。runtime 请求 manifest，加载变更 chunk 后检查 HMR accept 边界，命中时替换局部模块，未命中时通常回退到整页刷新：

```d2 maxHeight=420
shape: sequence_diagram

source: 文件系统
compiler: Compiler
dev: Dev Server
runtime: Browser Runtime

source -> compiler: 文件保存
compiler -> compiler: 重新编译受影响模块
compiler -> dev: 生成 update manifest 和 hot update chunk
dev -> runtime: 通知有更新
runtime -> runtime: 请求 update manifest
runtime -> runtime: 拉取变更模块
runtime -> runtime: 检查 HMR accept 边界
runtime -> runtime: 命中 -> 局部替换
runtime -> runtime: 未命中 -> 整页刷新
```

局部更新取决于更新链路上是否存在可以接受更新的边界。业务代码可以通过 HMR API 声明更新边界：

```js fold title="src/index.js"
function updatePage() {
  // 重新读取 foo，并更新当前页面
}

// CommonJS 模块
if (module.hot) {
  module.hot.accept('./foo', updatePage)
}

// 严格 ESM 模块
if (import.meta.webpackHot) {
  import.meta.webpackHot.accept('./foo', updatePage)
}
```

如果链路上没有可接受更新的边界，HMR 通常会回退到整页刷新。在 React、Vue 等项目中，业务代码一般由框架的热更新集成接入，不需要手写回调。

HMR 变慢通常与通知过程无关，常见原因是受影响模块重新编译耗时、loader 链过重、依赖链过长，或更新边界不稳定导致频繁刷新。

## Loader

loader 负责将单个文件转换成 Webpack 可以继续解析的模块。Webpack 根据 `module.rules` 匹配文件，按 loader 链从右到左执行，再由 parser 分析转换结果中的依赖。

例如 CSS 本身不是 JavaScript 模块，但可以通过 loader 进入模块图：

```js fold title="webpack.config.js"
module.exports = {
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
}
```

这段配置会先执行 `css-loader`，解析 CSS 中的 `@import` 和 `url()`，并将 CSS 转换成 JS 模块；再执行 `style-loader`，把转换结果封装为运行时代码，注入页面的 `<style>` 标签。

生产项目应通过 `include` 或 `exclude` 限制 loader 的处理范围，避免 Babel、SWC 或 TypeScript loader 扫描不必要的目录，拖慢冷启动、HMR 和 CI 构建。

## Plugin

plugin 通过 hooks 介入 Webpack 的构建生命周期，入口是 `apply(compiler)`。`compiler.hooks` 面向一次完整构建，`compilation.hooks` 面向一次具体编译，可以处理模块、chunk 和 asset：

```js fold title="plugins/BuildDonePlugin.js"
class BuildDonePlugin {
  apply(compiler) {
    compiler.hooks.done.tap('BuildDonePlugin', () => {
      console.log('build done')
    })
  }
}
```

常见插件职责包括：

- `HtmlWebpackPlugin`：生成 HTML，并注入构建产物；
- `MiniCssExtractPlugin`：把 CSS 从 JS 中抽离成独立 CSS 文件；
- `DefinePlugin`：在编译阶段替换常量；
- `HotModuleReplacementPlugin`：注入 HMR 运行时能力；
- `BundleAnalyzerPlugin`：分析产物体积和模块来源。

一个插件可以通过多个 hooks 影响不同阶段。遇到产物内容异常、资源没有输出或环境变量替换错误时，应先定位对应插件，再沿着它注册的生命周期钩子排查。

## Parser

parser 负责分析模块语法并生成 Webpack 的依赖信息。它会识别 `import`、`require()` 和 `import()` 等依赖请求，记录 `export` 与导出使用情况，再把依赖写入 module graph。静态 `import` 会形成同步依赖，动态 `import()` 会创建异步依赖边界，供 chunk graph 生成异步 chunk；导出使用信息则参与 Tree Shaking。parser 只分析代码，不执行模块。

## 优化路径

优化 Webpack 时，先建立构建和产物基线，再根据现象定位模块、chunk、asset 或缓存链路：

- **产物结构**：使用 `webpack-bundle-analyzer` 分析依赖体积、重复模块以及 chunk、module、asset 的关系；
- **Tree Shaking**：确认依赖是否提供 ESM 产物、导入是否可静态分析、`sideEffects` 是否正确声明；
- **缓存稳定性**：对比多次构建的文件名和 hash，检查 runtime、module id 以及构建输入是否稳定；
- **加载表现**：用浏览器 Network 面板确认首屏请求数量、资源大小和缓存命中情况；
- **依赖与发布**：检查 `node_modules` 中是否混入多个版本的大依赖，以及 source map 是否被错误发布到公网；
- **运行时依赖**：如果使用 MF，单独检查 remoteEntry 加载、shared 版本协商和 remote 失败兜底。

根据定位结果选择策略：chunk 过大时，检查低频功能是否缺少动态导入，或重依赖是否进入首屏；chunk 过碎时，检查 `splitChunks` 是否过于激进，或公共模块是否过小；vendor hash 频繁变化时，检查 runtime 是否独立、module id 是否稳定，以及构建输入是否包含时间戳或随机值。

## Tree Shaking

ES Module 的 `import` 和 `export` 是静态声明，Webpack 无需执行代码即可确定模块依赖、导出和引用关系，并沿 module graph 标记哪些导出被使用。CommonJS 可以动态调用 `require()`、修改 `module.exports`，或通过变量访问导出，构建阶段难以安全判断，通常会保留更多代码。

Webpack 的处理过程可以概括为：先标记已使用的导出，再结合 `sideEffects` 判断模块是否可以整体跳过，最后由压缩器删除不可达代码：

```d2
direction: right

analysis: 分析 ESM 的导入和导出
mark: 标记已使用的导出
optimize: 结合副作用声明优化模块
minify: 压缩阶段删除不可达代码

analysis -> mark -> optimize -> minify
```

Webpack 在 production 模式下默认会分析导出使用情况，也可以显式配置 `optimization.usedExports`：

```js fold title="webpack.config.js"
module.exports = {
  mode: 'production',
  optimization: {
    usedExports: true,
  },
}
```

即使使用 ES Module，namespace import 和动态属性访问也会降低依赖的可分析性。Tree Shaking 只能删除构建阶段能够证明未使用的代码；首屏必需的大依赖应评估替代方案，可延后的依赖再按需加载。

## 副作用

`sideEffects` 声明模块是否包含顶层副作用，`usedExports` 标记模块中被使用的导出。Webpack 可以在 `package.json` 中配置 `sideEffects`：

```json fold title="package.json"
{
  "sideEffects": false
}
```

`sideEffects: false` 表示包中的模块没有顶层副作用，Webpack 可以在确认模块没有被使用时跳过整个模块。CSS 引入、polyfill、全局注册、修改原型和顶层执行埋点，都可能构成副作用。错误声明会让生产包丢失必要代码。

如果只有部分文件有副作用，可以只声明这些文件：

```json fold title="package.json"
{
  "sideEffects": ["**/*.css", "./src/polyfills.js"]
}
```

## 分包策略

分包需要同时服务首屏加载和缓存命中。通常把变化频率接近的代码放在一起，把加载时机不同的代码拆开，避免初始资源过大或一次改动导致无关资源失效。

可以按职责和加载时机拆分为：

| 分包       | 内容                           | 目标                       |
| ---------- | ------------------------------ | -------------------------- |
| 入口包     | 当前入口必须执行的业务代码     | 保证首屏可运行             |
| 异步业务包 | 路由页、弹窗、低频功能         | 降低首屏体积               |
| vendor 包  | React、Vue、组件库等第三方依赖 | 利用依赖低频变化做长期缓存 |
| runtime 包 | Webpack runtime 和 manifest    | 降低 hash 传染             |
| 公共包     | 多个异步 chunk 共享的业务模块  | 避免重复打包               |

下面的配置展示了常见的分包方式：

```js fold title="webpack.config.js"
module.exports = {
  output: {
    filename: 'static/js/[name].[contenthash:8].js',
    chunkFilename: 'static/js/[name].[contenthash:8].chunk.js',
    clean: true,
  },
  optimization: {
    // 单独拆出 runtime，缩小其变化对业务包 hash 的影响
    runtimeChunk: 'single',
    splitChunks: {
      // 同步与异步 chunk 一起参与分包
      chunks: 'all',
      // 20KB 以下不单独拆，避免小请求过多
      minSize: 20 * 1024,
      // 限制入口包的请求数
      maxInitialRequests: 6,
      // 限制异步加载的请求数
      maxAsyncRequests: 10,
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          // 优先提取第三方依赖
          priority: 10,
        },
        common: {
          // 至少被 2 个 chunk 共享才拆出
          minChunks: 2,
          name: 'common',
          priority: 0,
          // 有可复用 chunk 时直接复用
          reuseExistingChunk: true,
        },
      },
    },
  },
}
```

这些参数需要结合首屏请求数、chunk 体积和缓存命中情况调整。vendor 不宜无限细拆，过细会增加请求数量和调度成本，过粗又会导致一个依赖变化让整个 vendor 失效。

路由级动态导入通常是收益最稳定的分包方式：

```js fold title="src/router.js"
const SettingsPage = () => import('./pages/settings')
const ReportPage = () => import('./pages/report')
```

动态导入适合低频、重型、非首屏模块，例如后台报表、编辑器、地图、图表库和管理页。首屏必须用到的小模块不应强行动态导入，否则可能增加额外请求和网络瀑布。

## 缓存策略

生产构建的缓存策略需要同时保证入口及时更新和稳定资源长期复用。HTML 等入口文件需要及时失效，带 `contenthash` 的静态资源适合长期强缓存。可以按资源类型设置缓存策略：

| 资源        | 文件名                        | HTTP 缓存                                            |
| ----------- | ----------------------------- | ---------------------------------------------------- |
| HTML        | `index.html`                  | `Cache-Control: no-cache` 或短缓存                   |
| JS/CSS      | `[name].[contenthash].js/css` | `Cache-Control: public, max-age=31536000, immutable` |
| 图片/字体   | `[name].[contenthash][ext]`   | `Cache-Control: public, max-age=31536000, immutable` |
| remoteEntry | `remoteEntry.js` 或带版本路径 | 短缓存、协商缓存或版本化发布                         |
| source map  | 视发布策略决定                | 通常不公开或限制访问                                 |

Webpack 侧通常通过 `contenthash`、稳定的 module 和 chunk id，以及单独的 runtime 配置配合缓存：

```js fold title="webpack.config.js"
module.exports = {
  output: {
    // 内容变化时更新文件名
    filename: 'static/js/[name].[contenthash:8].js',
    chunkFilename: 'static/js/[name].[contenthash:8].chunk.js',
    assetModuleFilename: 'static/media/[name].[contenthash:8][ext]',
  },
  optimization: {
    // 使用稳定的 module id
    moduleIds: 'deterministic',
    // 使用稳定的 chunk id
    chunkIds: 'deterministic',
    // 独立 runtime，减少业务包 hash 变化
    runtimeChunk: 'single',
  },
}
```

常见失效情况如下：

- **入口缓存过久**：HTML 长期强缓存，用户持续拿到旧入口；
- **资源缺少 hash**：文件内容变化后 URL 不变，旧缓存无法及时失效；
- **runtime 未拆分**：运行时代码变化，导致其它 chunk 的 hash 大面积变化。

Module Federation 还需要单独处理 `remoteEntry`。host 先加载它，再根据其中的信息查找 remote 暴露的模块和 chunk。生产上通常使用版本化 remote 路径，或为 `remoteEntry` 设置短缓存并配合明确的回滚策略。

## 构建提速

Webpack 构建变慢时，先建立耗时基线，定位瓶颈是在模块解析、loader 转换、压缩、source map、插件还是文件监听，再按「缩小查找范围 → 转译与并行 → 压缩与 source map → 持久化缓存」逐项处理。

### 缩小查找范围

构建提速可以先从缩小 Webpack 的查找和处理范围入手。解析阶段只保留实际使用的文件后缀，通过 `alias` 固定模块路径；loader 用 `include` 限定扫描目录；对确认没有依赖声明的完整库用 `noParse` 跳过 parser，对不需要的可选资源用 `IgnorePlugin` 排除模块请求。示例配置如下：

```js fold title="webpack.config.js"
const path = require('path')
const webpack = require('webpack')

module.exports = {
  resolve: {
    // 只尝试项目实际使用的文件后缀
    extensions: ['.js', '.jsx', '.ts', '.tsx'],
    // 将源码中的别名解析到固定目录
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  module: {
    // 对确认没有依赖声明的完整库跳过 parser
    noParse: /jquery|lodash/,
    rules: [
      {
        // 匹配 JS、JSX、TS 和 TSX 文件
        test: /\.[jt]sx?$/,
        // 只让 loader 处理 src 目录
        include: path.resolve(__dirname, 'src'),
        use: 'babel-loader',
      },
    ],
  },
  plugins: [
    // 排除 moment 不需要的 locale 资源
    new webpack.IgnorePlugin({
      resourceRegExp: /^\.\/locale$/,
      contextRegExp: /moment$/,
    }),
  ],
}
```

### 转译与并行

转译是构建耗时的重要来源。`swc-loader` 基于 Rust 实现，通常比 Babel 更快，负责代码转译；`ForkTsCheckerWebpackPlugin` 则在独立进程中执行 TypeScript 类型检查，使两项工作可以并行进行。模块足够多且 loader 耗时明显时，再考虑使用 `thread-loader`，但它存在 worker 启动和通信成本，应结合耗时基线确认并行是否有收益。示例配置如下：

```js fold title="webpack.config.js"
const path = require('path')
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin')

module.exports = {
  module: {
    rules: [
      {
        // 匹配 TS 和 TSX 文件
        test: /\.tsx?$/,
        // 只处理 src 目录
        include: path.resolve(__dirname, 'src'),
        use: [
          {
            // 利用 pitch 阶段先行，将右侧 loader 放到 worker 中执行
            loader: 'thread-loader',
            options: {
              // worker 数量结合 CPU 核数和构建规模调整
              workers: 2,
            },
          },
          {
            // 在 worker 中执行 SWC 转译；只转译，不做类型检查
            loader: 'swc-loader',
            options: {
              // 解析 TS 和 TSX 语法并输出 JavaScript
              jsc: {
                parser: {
                  syntax: 'typescript',
                  tsx: true,
                },
              },
            },
          },
        ],
      },
    ],
  },
  plugins: [
    // 将 TypeScript 类型检查从转译流程中拆开
    new ForkTsCheckerWebpackPlugin({
      typescript: {
        // 在独立进程中读取 tsconfig 执行类型检查
        configFile: path.resolve(__dirname, 'tsconfig.json'),
        // 同时检查语法错误和类型错误
        diagnosticOptions: {
          // 检查类型关系和语义错误
          semantic: true,
          // 检查语法错误
          syntactic: true,
        },
      },
    }),
  ],
}
```

### 压缩与 source map

压缩和 source map 都会增加构建耗时。生产构建可以开启压缩并行，压缩轮次保持默认值即可，具体配置如下：

```js fold title="webpack.config.js"
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin')
const TerserPlugin = require('terser-webpack-plugin')

module.exports = {
  optimization: {
    // 开启生产压缩
    minimize: true,
    minimizer: [
      new TerserPlugin({
        // 并行处理压缩任务
        parallel: true,
        terserOptions: {
          // 保持默认压缩轮次，避免额外耗时
          compress: { passes: 1 },
        },
      }),
        // 压缩 CSS
        new CssMinimizerPlugin(),
    ],
  },
}
```

source map 需要在构建速度、调试体验和源码暴露之间取舍：

| 场景         | devtool                                  |
| ------------ | ---------------------------------------- |
| 本地开发     | `eval-cheap-module-source-map`           |
| 测试环境     | `cheap-module-source-map`                |
| 生产错误定位 | `source-map`，但上传到监控平台或限制访问 |
| 极致构建速度 | 关闭生产 source map，或只在需要时开启    |

### 持久化缓存

Webpack 的 filesystem cache 会将模块和 loader 的处理结果持久化到磁盘，后续构建可以直接复用，避免重复处理。配置如下：

```js fold title="webpack.config.js"
const path = require('path')

module.exports = {
  cache: {
    // 将缓存持久化到文件系统
    type: 'filesystem',
    // 指定缓存目录
    cacheDirectory: path.resolve(__dirname, '.webpack-cache'),
    buildDependencies: {
      // 配置文件变化时使缓存失效
      config: [__filename],
    },
  },
}
```

如果 CI 使用临时环境，还需要通过 CI 的缓存机制保留 `.webpack-cache` 目录，让后续任务继续复用已有缓存。GitHub Actions 可以这样配置：

```yaml fold title=".github/workflows/build.yml"
name: Webpack build

on:
  push:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: pnpm/action-setup@v4

      - name: Cache Webpack
        uses: actions/cache@v4
        with:
          # 缓存 Webpack filesystem cache
          path: .webpack-cache
          # 锁文件或配置变化时创建新缓存
          key: ${{ runner.os }}-webpack-${{ hashFiles('**/pnpm-lock.yaml', '**/webpack.config.js') }}
          # 精确 key 未命中时，按此前缀匹配旧缓存
          restore-keys: |
            ${{ runner.os }}-webpack-

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm exec webpack
```

### DLL 预构建

`DllPlugin` 可将变化较少的依赖提前单独构建，再由主构建通过 `DllReferencePlugin` 复用。它会增加额外的配置和维护成本，通常只在依赖规模较大、变化稳定且独立构建收益明确时考虑。DLL 构建配置如下：

```js fold title="webpack.dll.config.js"
const path = require('path')
const webpack = require('webpack')

module.exports = {
  // 单独构建变化较少的依赖
  entry: {
    vendor: ['react', 'react-dom'],
  },
  output: {
    // 输出 DLL 文件和 manifest
    path: path.resolve(__dirname, 'dist/dll'),
    filename: '[name].dll.js',
    // 将 DLL 暴露为 vendor_<fullhash> 形式的库名
    library: '[name]_[fullhash]',
  },
  plugins: [
    new webpack.DllPlugin({
      // 记录模块名与模块 id 的映射
      path: path.resolve(__dirname, 'dist/dll/[name]-manifest.json'),
      // 与 output.library 使用相同的库名
      name: '[name]_[fullhash]',
    }),
  ],
}
```

主构建读取 manifest，复用已经生成的 DLL：

```js fold title="webpack.config.js"
const path = require('path')
const webpack = require('webpack')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const AddAssetHtmlPlugin = require('add-asset-html-webpack-plugin')

module.exports = {
  plugins: [
    new webpack.DllReferencePlugin({
      // 引用 DLL 构建生成的 manifest
      manifest: require('./dist/dll/vendor-manifest.json'),
    }),
    // 生成 index.html，作为主 bundle 和 DLL 的注入目标
    new HtmlWebpackPlugin(),
    new AddAssetHtmlPlugin({
      // 将 DLL 文件注入 HTML，并置于主 bundle 前
      filepath: path.resolve(__dirname, 'dist/dll/vendor.dll.js'),
    }),
  ],
}
```

## Module Federation

Module Federation 是 Webpack 5 提供的运行时模块共享机制，一个构建产物可以加载另一个构建产物暴露的模块。它常用于微前端，但职责只限于模块共享和加载。

核心对象包括：

| 概念        | 含义                            |
| ----------- | ------------------------------- |
| host        | 消费远程模块的应用              |
| remote      | 暴露模块给别人消费的应用        |
| exposes     | remote 对外暴露的模块           |
| remotes     | host 声明要消费哪些 remote      |
| shared      | 多个应用之间共享的依赖          |
| remoteEntry | remote 暴露给外部加载的入口文件 |

remote 配置示例：

```js fold title="webpack.remote.config.js"
const { ModuleFederationPlugin } = require('webpack').container

module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      // remote 的名称
      name: 'remoteApp',
      // host 加载的入口文件
      filename: 'remoteEntry.js',
      exposes: {
        './Button': './src/Button',
      },
      shared: {
        // 避免 remote 和 host 各自加载一份 React
        react: {
          singleton: true,
          requiredVersion: '^18.2.0',
        },
        'react-dom': {
          singleton: true,
          requiredVersion: '^18.2.0',
        },
      },
    }),
  ],
}
```

host 配置示例：

```js fold title="webpack.host.config.js"
const { ModuleFederationPlugin } = require('webpack').container

module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      name: 'hostApp',
      remotes: {
        // 指向 remoteEntry，运行时据此查找远程模块
        remoteApp: 'remoteApp@https://cdn.example.com/remoteEntry.js',
      },
      shared: {
        // 与 remote 共享 React 单例
        react: {
          singleton: true,
          requiredVersion: '^18.2.0',
        },
        'react-dom': {
          singleton: true,
          requiredVersion: '^18.2.0',
        },
      },
    }),
  ],
}
```

这些配置建立了 remote 的暴露关系和 host 的消费关系。生产环境还需要处理 remoteEntry 加载、缓存更新和加载失败兜底。

## 核心概念

前文涉及的核心对象及其职责如下：

| 概念                | 作用                                              |
| ------------------- | ------------------------------------------------- |
| `entry`             | 构建入口，Webpack 从这里开始收集依赖              |
| `output`             | 控制输出目录、文件名和资源命名规则                |
| `mode`               | 选择开发或生产模式，并启用对应默认配置            |
| `resolver`           | 将模块请求解析为具体文件路径                      |
| `module`            | 模块图里的单个节点，可以是 JS、CSS、图片等资源    |
| `loader`            | 把匹配到的文件转换成 Webpack 能处理的模块         |
| `parser`             | 分析模块内容并提取依赖                            |
| `plugin`            | 介入构建生命周期，扩展全局构建能力                |
| `compiler`          | 一次 Webpack 运行的总控制器                       |
| `compilation`       | 一次具体编译过程，包含模块、chunk、asset 等信息   |
| `module graph`       | 记录模块之间的依赖关系                            |
| `chunk graph`        | 记录模块与 chunk 的归属及 chunk 之间的关系        |
| `chunk`             | 按入口、动态导入和分包规则形成的模块分组          |
| `bundle`            | 由 chunk 生成的 JavaScript 输出文件，也是一种 asset |
| `asset`             | 最终输出资源，可以是 JS、CSS、图片、字体、HTML 等 |
| `runtime`           | Webpack 注入的模块加载和 chunk 加载逻辑           |
| `Tree Shaking`      | 标记并删除未使用导出的生产优化能力                |
| `Module Federation` | 运行时加载远程构建产物暴露模块的能力              |
| `source map`        | 产物代码到源码的映射，用于调试和错误定位          |
