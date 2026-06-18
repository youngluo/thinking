---
createdAt: '2026-05-28 20:47'
order: 1
---

# Webpack 实践

Webpack 的核心，是把应用里的各种资源都看成模块，然后从入口开始构建依赖图，最后输出浏览器可以加载的静态资源。

它不只处理 JavaScript。CSS、图片、字体、JSON、WASM、模板文件，都可以通过 loader、plugin 和内置资源模块进入同一套构建流程。

理解 Webpack 可以分成两层：

- 原理：它如何构建模块图，如何生成 chunk，如何做热更新，如何在编译阶段判断哪些代码可以删除。
- 实践：生产项目里如何分包、如何做长期缓存、如何让构建更快，以及什么时候引入 Module Federation。

我的理解是：Webpack 不是简单的“把 JS 合成一个文件”，而是一个可编程的构建平台。它的强大来自统一的模块图和插件系统，复杂也来自这里。

## 原理

Webpack 的原理主线可以概括成：

```text
读取配置
  -> 创建 compiler
  -> 从 entry 构建 module graph
  -> loader 转换源码
  -> plugin 介入生命周期
  -> 生成 chunk graph
  -> 优化和代码生成
  -> 输出 assets
```

这条链路不是为了记步骤，而是为了定位问题。构建慢、分包异常、缓存失效、HMR 不稳定，通常都能落回这条链路里的某个阶段。

### 构建流程

Webpack 构建的起点是 entry。它从入口模块开始解析 import、require、动态导入、CSS 资源引用等依赖，把所有被引用到的内容纳入模块图。等模块图稳定后，再根据入口、动态导入和优化规则，把模块分配到不同 chunk，最后生成 JS、CSS、图片、HTML 等 assets。

整体流程可以这样看：

```d2
direction: down

cli -> compiler: 读取配置并创建 compiler
compiler -> compilation: 创建 compilation
compilation -> module: 构建模块图（resolver + loader + parser）
module -> compilation: 登记依赖并递归
compilation -> chunkGraph: 生成 chunk graph
chunkGraph -> chunkGraph: Tree Shaking / splitChunks / runtime
chunkGraph -> fs: emit assets
```

这里最容易混淆的是 compiler 和 compilation。

compiler 是一次 Webpack 运行的总控制器。配置读取完成后，Webpack 会创建 compiler，它保存完整配置，管理生命周期，暴露插件钩子，并负责启动构建、监听文件变化和输出结果。

compilation 表示一次具体编译。开发模式下每次文件变化都会产生新的 compilation。它持有当前这次构建里的模块、依赖、chunk、asset、warning、error 等信息。

再往下看，module graph 描述“源码如何依赖”，chunk graph 描述“这些模块最终如何分到不同产物里”。所以排查 Webpack 问题时，不能只看最终 bundle。很多问题实际发生在 resolve、loader、plugin、module graph、chunk graph 或 optimize 阶段。

### Loader

loader 解决的是“某类文件如何变成 Webpack 能理解的模块”。这个边界很重要。loader 面向单个模块转换，不应该承担全局资源优化、产物注入、文件输出编排这类职责。

例如 CSS 本身不是 JavaScript 模块，但可以通过 loader 进入模块图：

```js title="webpack.config.js"
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

loader 的执行顺序是从右到左：

```text
style-loader(css-loader(source))
```

这段配置里，css-loader 解析 CSS 里的 `@import` 和 `url()`，把 CSS 转成 JS 模块；style-loader 再把 CSS 通过 JS 注入页面的 `<style>` 标签。

再比如 TypeScript：

```js title="webpack.config.js"
module.exports = {
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'swc-loader',
        exclude: /node_modules/,
      },
    ],
  },
}
```

生产项目里，loader 的关键不是“能不能跑”，而是“处理范围是否足够小”。如果 Babel、SWC、TypeScript loader 扫到不该处理的目录，冷启动、HMR 和 CI 构建都会被拖慢。

### Plugin

plugin 解决的是“如何扩展构建生命周期”。如果说 loader 是单个模块的转换函数，plugin 就是插入构建流水线的扩展点。

Webpack 的插件通过 `compiler.hooks` 或 `compilation.hooks` 介入不同阶段：

```js title="plugins/BuildDonePlugin.js"
class BuildDonePlugin {
  apply(compiler) {
    compiler.hooks.done.tap('BuildDonePlugin', (stats) => {
      console.log('build done')
    })
  }
}
```

常见插件职责包括：

- `HtmlWebpackPlugin`：生成 HTML，并注入构建产物。
- `MiniCssExtractPlugin`：把 CSS 从 JS 中抽离成独立 CSS 文件。
- `DefinePlugin`：在编译阶段替换常量。
- `HotModuleReplacementPlugin`：注入 HMR 运行时能力。
- `WebpackBundleAnalyzer`：分析产物体积和模块来源。

插件能力很强，也意味着构建行为可能被多个插件共同影响。一个产物为什么多了某段代码、某个资源为什么没有输出、某个环境变量为什么被替换错，很多时候要沿着插件生命周期查，而不是只看 loader。

### Chunk、Bundle 和 Runtime

Webpack 构建出来的不是简单的“一个模块对应一个文件”。它会先把源码组织成 module graph，再根据入口、动态导入和分包规则生成 chunk。

可以这样理解：

```text
module
  -> 源码或资源里的一个模块

chunk
  -> 一组 module 的集合

bundle / asset
  -> chunk 最终输出到磁盘的文件
```

例如：

```js title="src/pages/settings.js"
import('./settings')
```

动态导入会形成异步 chunk。最终产物可能是：

```text
main.8b7f1a.js
settings.91c2af.js
```

浏览器先加载入口 bundle，执行到动态导入时，再由 Webpack runtime 加载异步 chunk。runtime 是 Webpack 注入到产物里的运行时代码，负责模块加载、模块缓存、异步 chunk 加载、HMR 更新等逻辑。

生产环境做长期缓存时，runtime 通常要单独拆出来。原因不是 runtime 很大，而是 runtime 里记录了 chunk 映射等运行时信息。它如果混在业务包或 vendor 包里，轻微的 chunk 变化也可能让大包 hash 跟着变化。

### Tree Shaking 和副作用

Tree Shaking 解决的是“没被用到的导出能不能从最终产物里删掉”。它依赖 ES Module 的静态结构，因为 `import` 和 `export` 在编译阶段就能分析出依赖关系。

简化流程是：

```text
分析 ESM 导入导出
  -> 标记 used exports
  -> 结合 sideEffects 判断模块是否可跳过
  -> 压缩阶段删除不可达代码
```

Webpack 自己会做标记，但真正删除代码通常发生在压缩阶段。所以 Tree Shaking 不是“配置一个开关就删除所有无用代码”，而是模块格式、依赖写法、副作用声明和压缩器一起工作的结果。

常见配置和包声明是：

```js title="webpack.config.js"
module.exports = {
  mode: 'production',
  optimization: {
    usedExports: true,
  },
}
```

```json title="package.json"
{
  "sideEffects": false
}
```

`sideEffects: false` 表示包里的模块没有顶层副作用，未被使用的模块可以安全跳过。但这句话不能乱写。CSS 引入、polyfill、全局注册、修改原型、顶层执行埋点，这些都可能是副作用。如果误标为无副作用，生产包可能直接丢代码。

更稳的写法是只保留确实有副作用的文件：

```json title="package.json"
{
  "sideEffects": ["*.css", "./src/polyfills.js"]
}
```

Tree Shaking 效果不好时，通常先看三件事：依赖是不是 CommonJS，是否有错误的副作用声明，业务代码是否把按需导入写成了大范围 namespace import。namespace import 指的是 `import * as utils from './utils'` 这种写法，它会把模块导出的内容收进一个命名空间对象里；如果后续再通过动态属性访问，构建工具就更难判断到底用到了哪些导出。Tree Shaking 是生产体积优化的一部分，不是替代分包策略的工具。

### 热更新流程

HMR 解决的是开发阶段文件变化后的反馈速度问题。Webpack 的 HMR 建立在 bundle、dev server 和 runtime 之上。

流程可以这样看：

```d2
shape: sequence_diagram

source: 文件系统
compiler: Compiler
dev: Dev Server
runtime: Browser Runtime

source -> compiler: 文件保存
compiler -> compiler: 重新编译受影响模块
compiler -> dev: 生成 hot update chunk
dev -> runtime: 推送 hot update
runtime -> runtime: 拉取更新模块
runtime -> runtime: 检查 HMR accept 边界
runtime -> runtime: 命中 -> 局部替换
runtime -> runtime: 未命中 -> 整页刷新
```

HMR 的关键不是“文件变了就替换文件”，而是模块链路上要有能处理更新的边界。

手写 HMR 边界大致是这样：

```js title="src/index.js"
if (module.hot) {
  module.hot.accept('./foo', () => {
    // 重新读取 foo，并更新当前页面
  })
}
```

如果模块链路上没有找到能接受更新的边界，Webpack 就只能整页刷新。在 React、Vue 等项目中，业务代码通常不会手写这些回调，而是由框架 loader 或插件接入。例如 React Fast Refresh 会处理组件级刷新，Vue loader 会处理 SFC 的模板、脚本、样式更新。

HMR 慢通常不是 dev server 通知慢，而是受影响模块重新编译慢、loader 链过重、模块依赖链过长，或者更新边界不稳定导致频繁整页刷新。

### Module Federation

Module Federation 是 Webpack 5 提供的运行时模块共享能力。它常被用在微前端里，但本质不是“微前端框架”，而是让一个构建产物在运行时加载另一个构建产物暴露出来的模块。

几个概念要先分清：

| 概念        | 含义                            |
| ----------- | ------------------------------- |
| host        | 消费远程模块的应用              |
| remote      | 暴露模块给别人消费的应用        |
| exposes     | remote 对外暴露的模块           |
| remotes     | host 声明要消费哪些 remote      |
| shared      | 多个应用之间共享的依赖          |
| remoteEntry | remote 暴露给外部加载的入口文件 |

最小形态大致是：

```js title="webpack.remote.config.js"
const { ModuleFederationPlugin } = require('webpack').container

module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      name: 'remoteApp',
      filename: 'remoteEntry.js',
      exposes: {
        './Button': './src/Button',
      },
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
      },
    }),
  ],
}
```

host 侧消费：

```js title="webpack.host.config.js"
new ModuleFederationPlugin({
  name: 'hostApp',
  remotes: {
    remoteApp: 'remoteApp@https://cdn.example.com/remoteEntry.js',
  },
})
```

MF 的难点不在这几行配置，而在运行时边界。remoteEntry 加载失败怎么办，共享依赖版本不一致怎么办，remote 发布后 host 的缓存怎么处理，错误是否会拖垮主应用，这些都是生产环境必须提前设计的。

### 核心概念速记

| 概念                | 作用                                              |
| ------------------- | ------------------------------------------------- |
| `entry`             | 构建入口，Webpack 从这里开始收集依赖              |
| `module`            | 模块图里的单个节点，可以是 JS、CSS、图片等资源    |
| `loader`            | 把匹配到的文件转换成 Webpack 能处理的模块         |
| `plugin`            | 介入构建生命周期，扩展全局构建能力                |
| `compiler`          | 一次 Webpack 运行的总控制器                       |
| `compilation`       | 一次具体编译过程，包含模块、chunk、asset 等信息   |
| `chunk`             | 一组模块组成的中间产物                            |
| `bundle`            | chunk 渲染后的最终 JS 文件                        |
| `asset`             | 最终输出资源，可以是 JS、CSS、图片、字体、HTML 等 |
| `runtime`           | Webpack 注入的模块加载和 chunk 加载逻辑           |
| `Tree Shaking`      | 标记并删除未使用导出的生产优化能力                |
| `Module Federation` | 运行时加载远程构建产物暴露模块的能力              |
| `source map`        | 产物代码到源码的映射，用于调试和错误定位          |

## 实践

生产环境的 Webpack 配置目标很明确：资源要小，缓存要稳，加载要快，构建也要快。

实践上最重要的是六件事：

- 排查与基线：先看清当前构建和产物的真实状态，再决定优化点。
- Tree Shaking：哪些代码根本不应该进入最终产物。
- 分包策略：哪些代码应该放在一起，哪些代码应该拆开。
- 缓存策略：哪些资源可以长期缓存，哪些资源必须及时更新。
- 构建提速：减少重复工作，缩小编译范围，把重活交给更快的工具。
- MF 取舍：是否真的需要运行时跨应用共享模块。

### 排查思路

排查是实践的第一步。看不清构建和产物的真实状态，就去调 splitChunks、加缓存、堆多线程，往往是配置越改越复杂、收益越来越小。先建基线，再动配置。

常用手段包括：

- 用 `webpack-bundle-analyzer` 看哪些依赖占体积，是否存在重复依赖。
- 用 `stats.json` 看 chunk、module、asset 的关系。
- 对比两次构建的文件名和 hash，确认缓存是否稳定。
- 检查 Tree Shaking 是否被 CommonJS、错误副作用声明或导入方式影响。
- 检查 `node_modules` 里是否混入多个版本的大依赖。
- 检查 source map 是否被错误发布到公网。
- 用浏览器 Network 面板确认首屏请求数量、资源大小和缓存命中。
- 如果用了 MF，单独检查 remoteEntry 加载、shared 版本协商和 remote 失败兜底。

生成 stats 的方式通常是：

```bash title="terminal"
webpack --profile --json > stats.json
```

如果发现 chunk 过大，优先判断是不是低频功能没有动态导入，或者某个重依赖进入了首屏入口。如果发现 chunk 过碎，优先看 splitChunks 是否过于激进，或者公共模块体积太小却被频繁抽离。

如果发现 vendor hash 经常变化，优先看 runtime 是否独立、module id 是否稳定、构建输入是否包含时间戳或环境随机值。如果发现 Tree Shaking 没效果，优先看依赖产物格式和 sideEffects 声明，而不是继续拆 chunk。

### Tree Shaking

Tree Shaking 要放在分包之前理解：分包决定代码放在哪个 chunk，Tree Shaking 决定未使用代码是否应该进入任何 chunk。

生产配置通常不需要写很多东西，因为 `mode: 'production'` 已经会打开相关优化。真正影响效果的，反而是依赖格式和副作用声明：

```js title="webpack.config.js"
module.exports = {
  mode: 'production',
  optimization: {
    usedExports: true,
    sideEffects: true,
  },
}
```

业务包或组件库如果确认大部分模块没有顶层副作用，可以在 `package.json` 里声明：

```json title="package.json"
{
  "sideEffects": ["*.css", "./src/polyfills.js"]
}
```

这个声明的价值是告诉 Webpack：除了这些文件，未被引用的模块可以更大胆地跳过。它的风险也在这里：如果一个模块虽然没有导出被使用，但它在顶层做了全局注册、样式注入或 polyfill，错误的 sideEffects 声明会让生产包行为异常。

Tree Shaking 排查可以按这个顺序：

- 先看依赖是否提供 ESM 产物。CommonJS 依赖通常不如 ESM 容易摇掉无用导出。
- 再看导入写法。优先使用 `import { debounce } from 'lodash-es'` 这类具名导入，少用 `import * as lodash from 'lodash-es'` 这类 namespace import，尤其不要再配合 `lodash[name]` 这种动态属性访问。
- 然后看 `sideEffects` 声明。CSS、polyfill、全局注册文件要明确保留。
- 最后用 bundle analyzer 看无用模块是否仍然进入产物。

Tree Shaking 不会解决所有体积问题。大依赖如果真的被首屏使用，就算摇树正常，也仍然应该考虑按需加载、替换依赖或延后加载。

### 分包策略

分包的目标不是“拆出更多文件”，而是同时服务首屏加载和缓存命中。一个比较稳的判断标准是：变化频率接近的代码放在一起，加载时机不同的代码拆开。

常见拆分方式是：

| 分包       | 内容                           | 目标                       |
| ---------- | ------------------------------ | -------------------------- |
| 入口包     | 当前入口必须执行的业务代码     | 保证首屏可运行             |
| 异步业务包 | 路由页、弹窗、低频功能         | 降低首屏体积               |
| vendor 包  | React、Vue、组件库等第三方依赖 | 利用依赖低频变化做长期缓存 |
| runtime 包 | Webpack runtime 和 manifest    | 降低 hash 传染             |
| 公共包     | 多个异步 chunk 共享的业务模块  | 避免重复打包               |

基础配置通常会包含：

```js title="webpack.config.js"
module.exports = {
  output: {
    filename: 'static/js/[name].[contenthash:8].js',
    chunkFilename: 'static/js/[name].[contenthash:8].chunk.js',
    clean: true,
  },
  optimization: {
    runtimeChunk: 'single', // 单独拆出 runtime，缩小其变化对业务包 hash 的影响
    splitChunks: {
      chunks: 'all', // 同步与异步 chunk 一起参与分包
      minSize: 20 * 1024, // 20KB 以下不单独拆，避免小请求爆炸
      maxInitialRequests: 6, // 入口包请求数上限，超出后会被合并回大块
      maxAsyncRequests: 10, // 异步加载请求数上限，超出后会被合并
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          priority: 10, // 比 common 优先；命中 vendor 后就不再走 common
        },
        common: {
          minChunks: 2, // 至少被 2 个 chunk 共享才拆出来
          name: 'common',
          priority: 0,
          reuseExistingChunk: true, // 已有可复用 chunk 时直接复用，不再重复拆
        },
      },
    },
  },
}
```

这里的重点不是照抄参数，而是理解每个参数背后的取舍。例如 vendor 不宜无限细拆，过细会增加请求数量和调度成本，过粗又会导致一个依赖变化让整个 vendor 失效。

路由级动态导入通常是收益最稳定的分包方式：

```js title="src/router.js"
const SettingsPage = () => import('./pages/settings')
const ReportPage = () => import('./pages/report')
```

动态导入适合低频、重型、非首屏模块，例如后台报表、编辑器、地图、图表库、管理页。首屏必须用到的小模块不要强行动态导入，否则会让页面多一次网络瀑布流。

### 缓存策略

生产构建里，缓存策略比“文件名好不好看”重要得多。缓存策略的核心不是让所有东西都缓存很久，而是让可变资源容易更新，让不可变资源放心复用。

基本原则是：

- HTML 不做长期强缓存，避免用户一直拿到旧入口。
- JS、CSS、图片、字体使用 `contenthash` 文件名，并配置长期强缓存。
- runtime 单独拆分，避免运行时代码变化导致业务包和 vendor 包 hash 被污染。
- remoteEntry 这类运行时入口不能简单套用普通静态资源长期缓存策略。

推荐的资源策略：

| 资源        | 文件名                        | HTTP 缓存                                            |
| ----------- | ----------------------------- | ---------------------------------------------------- |
| HTML        | `index.html`                  | `Cache-Control: no-cache` 或短缓存                   |
| JS/CSS      | `[name].[contenthash].js/css` | `Cache-Control: public, max-age=31536000, immutable` |
| 图片/字体   | `[name].[contenthash][ext]`   | `Cache-Control: public, max-age=31536000, immutable` |
| remoteEntry | `remoteEntry.js` 或带版本路径 | 短缓存、协商缓存或版本化发布                         |
| sourcemap   | 视发布策略决定                | 通常不公开或限制访问                                 |

Webpack 侧配置大致是：

```js title="webpack.config.js"
module.exports = {
  output: {
    filename: 'static/js/[name].[contenthash:8].js',
    chunkFilename: 'static/js/[name].[contenthash:8].chunk.js',
    assetModuleFilename: 'static/media/[name].[contenthash:8][ext]',
  },
  optimization: {
    moduleIds: 'deterministic',
    chunkIds: 'deterministic',
    runtimeChunk: 'single',
  },
}
```

`contenthash` 表示文件内容变化时文件名才变化。配合长期强缓存后，浏览器可以长期复用没有变化的资源。`moduleIds: 'deterministic'` 和 `chunkIds: 'deterministic'` 可以让模块和 chunk id 更稳定，减少无关改动引起的 hash 变化。

缓存问题常见事故有三类：HTML 被长期强缓存，用户一直加载旧入口；静态资源没有 hash，文件内容变了但 URL 不变；runtime 没拆，运行时代码变化导致其他 chunk hash 大面积变化。

如果用了 Module Federation，还要单独看 remoteEntry。host 通常先加载 remoteEntry，再通过它找到 remote 暴露的模块和 chunk。如果 remoteEntry 被长期缓存，用户可能拿到旧远程入口；如果 remoteEntry 总是无缓存，又可能让每次访问多一次网络成本。生产上更稳的做法是版本化 remote 路径，或者让 remoteEntry 使用短缓存和明确的发布回滚策略。

### 构建提速

Webpack 慢通常不是一个开关能解决的。要先判断慢在哪里：模块解析慢、loader 转换慢、压缩慢、source map 慢、插件慢，还是文件监听慢。没有基线就直接调参数，很容易把配置调复杂但收益很小。

凭感觉改配置是常见浪费，最快的定位办法是把每个 loader 和 plugin 的耗时打出来：

```js title="webpack.config.js"
const SpeedMeasurePlugin = require('speed-measure-webpack-plugin')

const smp = new SpeedMeasurePlugin()

module.exports = smp.wrap({
  // ...原有配置
})
```

或者直接用 Webpack 自带的 profile：

```bash title="terminal"
webpack --profile --json > stats.json
```

`stats.json` 的具体解读在「排查思路」一节有更细的说明。拿到耗时分布后，按「解析 → 转译 → 压缩 → 缓存」这个顺序逐项优化，跳过前面直接调后面的配置往往收益很小。

**解析阶段**经常被低估。`resolve.alias` 把深层路径替换成短路径，省掉从 `package.json` 入口一路 resolve 的成本，也避免 monorepo 内部包出现多版本歧义：

```js title="webpack.config.js"
const path = require('path')

module.exports = {
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    modules: [path.resolve(__dirname, 'src'), 'node_modules'],
    extensions: ['.js', '.jsx', '.ts', '.tsx'],
  },
}
```

`extensions` 列表越短越快，但要和实际文件后缀匹配，不要把不存在的后缀放进去。`noParse` 告诉 Webpack 某个库不需要走 parser，前提是它没有 `require` 或 `import` 也没有 AMD 依赖：

```js title="webpack.config.js"
module.exports = {
  module: {
    noParse: /jquery|lodash/,
  },
}
```

`IgnorePlugin` 则让某些模块整体不进入依赖图，适合砍掉 moment 这类多 locale 资源：

```js title="webpack.config.js"
const webpack = require('webpack')

module.exports = {
  plugins: [
    new webpack.IgnorePlugin({
      resourceRegExp: /^\.\/locale$/,
      contextRegExp: /moment$/,
    }),
  ],
}
```

这些配置不会减少业务代码，但能把「node_modules 里那些你根本没用到的部分」从依赖图里直接拿掉，常见能省几秒到几十秒。

**loader 范围**的原则是只处理需要处理的源码：

```js title="webpack.config.js"
const path = require('path')

module.exports = {
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        include: path.resolve(__dirname, 'src'),
        use: 'swc-loader',
      },
    ],
  },
}
```

不要让 Babel、SWC、TypeScript loader 扫完整个仓库或 `node_modules`。loader 链能不引入就不引入，能合并就合并。

**转译器选择**直接影响 CPU 占用。现代项目里可以用 `swc-loader` 或 `esbuild-loader` 替代部分 Babel 转换；TypeScript 类型检查和转译拆开，构建时只转译，类型检查交给 `fork-ts-checker-webpack-plugin` 或独立命令。loader 这层能省的时间往往比想象中多，老项目的 Babel 链是常见的隐形瓶颈。

**压缩和 source map** 是生产构建的隐性成本。`TerserPlugin` 默认配置不一定利用多核：

```js title="webpack.config.js"
const TerserPlugin = require('terser-webpack-plugin')

module.exports = {
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        parallel: true,
        terserOptions: {
          compress: { passes: 1 },
        },
      }),
    ],
  },
}
```

`parallel: true` 让压缩跑满多核；`compress.passes` 默认是 1，再往上加收益递减但时间翻倍，除非有明确体积收益要求，否则不要轻易调到 2 或 3。CSS 压缩同样可以用 `css-minimizer-webpack-plugin` 配合并行选项。

source map 选择和构建速度强相关：

```js title="webpack.config.js"
module.exports = {
  devtool: process.env.NODE_ENV === 'production' ? 'source-map' : 'eval-cheap-module-source-map',
}
```

| 场景         | devtool                                  |
| ------------ | ---------------------------------------- |
| 本地开发     | `eval-cheap-module-source-map`           |
| 测试环境     | `cheap-module-source-map`                |
| 生产错误定位 | `source-map`，但上传到监控平台或限制访问 |
| 极致构建速度 | 关闭生产 source map，或只在需要时开启    |

**持久化缓存**是减少重复构建的关键：

```js title="webpack.config.js"
module.exports = {
  cache: {
    type: 'filesystem',
    buildDependencies: {
      config: [__filename],
    },
  },
}
```

`cache: { type: 'filesystem' }` 看上去简单，但「缓存能否命中」依赖一些细节。`cacheDirectory` 要选一个稳定且不会被 `git clean` 误删的目录；`buildDependencies` 把影响产物的配置和脚本都列上，否则这些文件改了 Webpack 不会重置缓存。pnpm 项目里 `node_modules` 是符号链接结构，`managedPaths` 默认识别正确；yarn pnp 或自定义 hoisting 场景下可能要显式声明 `immutablePaths` 和 `managedPaths`，否则缓存键会包含 `node_modules` 内容，命中率急剧下降。

**CI 上 filesystem cache 默认是失效的**：每次 runner 重建，缓存目录就被清空。要让 CI 也拿到「二次构建秒开」的体验，需要把缓存目录作为 CI artifact 跨 job 复用：

```yaml title=".github/workflows/build.yml"
- name: Cache Webpack
  uses: actions/cache@v4
  with:
    path: .webpack-cache
    key: webpack-${{ hashFiles('package-lock.json') }}-${{ github.ref }}
    restore-keys: webpack-${{ hashFiles('package-lock.json') }}-
```

`key` 用 `package-lock.json` 的 hash 是因为 `node_modules` 变化时产物几乎必然变化；`restore-keys` 用来在 lockfile 变了之后还能复用一部分旧缓存。`node_modules` 本身的缓存可以单独用 `actions/setup-node` 的 `cache: 'pnpm'` 或类似机制处理，不要和 Webpack cache 混在一起。

**dev 二次构建**的瓶颈和首次构建不同。HMR 那一节讲过，热更新慢通常不是 dev server 通知慢，而是受影响模块重新编译慢。dev 环境可以单独写一份 loader 配置，比 prod 更激进：限制 loader 范围、关闭不必要的 source map 精度、用持久化缓存复用未变化模块。

`thread-loader` 不一定适合 dev：线程启动、进程通信和缓存管理也有成本，模块数量少或转换本身已经很快时，盲目开启反而可能变慢。判断标准是单个 loader 处理一个模块超过几十毫秒，且模块数量足够多，开 thread-loader 才有意义。

### 微前端与 MF 取舍

Module Federation 适合解决“多个独立构建、独立发布的应用需要在运行时组合”的问题。它不适合只为了拆代码而引入。如果只是单应用首屏包太大，优先用动态导入和 splitChunks；如果只是多个包共享组件，优先考虑 npm 包或 monorepo 内部包。

MF 更适合这些场景：

- 多个团队独立发布业务模块，主应用只负责装配。
- 存量系统逐步迁移，新旧应用需要在一段时间内共存。
- 某些低频但很重的模块希望独立部署，不跟主应用一起发版。

它不适合这些场景：

- 团队很小，但引入 MF 只是为了“微前端架构感”。
- 所有模块都必须强一致发布，运行时拆分反而增加风险。
- 没有统一的依赖版本、错误兜底、监控和回滚机制。

生产上最容易出问题的是 shared 依赖和 remoteEntry。React 这类依赖通常会配置 singleton，避免页面里出现多个 React 实例；但 singleton 不是万能的，版本范围过松可能埋运行时问题，版本范围过紧又可能导致远程模块加载失败。

一个相对谨慎的 shared 配置是：

```js title="webpack.config.js"
new ModuleFederationPlugin({
  shared: {
    react: {
      singleton: true,
      requiredVersion: '^18.2.0',
    },
    'react-dom': {
      singleton: true,
      requiredVersion: '^18.2.0',
    },
  },
})
```

MF 的发布也要按运行时系统来设计。remote 加载失败时，host 要能展示降级 UI；remote 抛错时，要有错误边界隔离；remoteEntry 缓存策略要能支持回滚；监控里要能区分是 host 错误、remote 错误，还是共享依赖版本错误。

### 一套比较稳的生产思路

生产项目可以按这个顺序推进：

```d2
direction: down

baseline: 建立基线（体积、构建耗时、缓存命中）
tree: 检查 Tree Shaking 和副作用声明
split: 按路由和重依赖做分包
cache: 配置 contenthash 和缓存头
runtime: 拆 runtime 并稳定 module id
speed: 开启持久化缓存和快速转译
mf: 判断是否需要 MF {
  class: decision
}
done: 稳定上线 {
  class: ok
}

baseline -> tree -> split -> cache -> runtime -> speed -> mf -> done
```

不要一开始就追求复杂的 cacheGroups，也不要把 MF 当成默认架构。先做 Tree Shaking、路由级异步拆分、vendor/runtime 拆分和长期缓存，通常已经能解决大部分生产问题。

等真实数据暴露出首屏包过大、重复依赖、缓存失效、构建过慢，或者组织上确实需要跨应用独立发布，再有针对性地调整。

## 总结

Webpack 的原理，是从入口构建完整模块图，再把模块图转换成适合浏览器加载的 chunk 和 asset。理解 compiler、compilation、module graph、chunk graph 和 runtime，才能解释构建流程、HMR 流程和生产产物为什么长成现在这样。

生产实践里，重点不是把配置写得多复杂，而是让 Tree Shaking 删除真正无用的代码，让代码分包符合加载时机和变化频率，让缓存策略符合资源类型，让构建链路少做无效工作。

Module Federation 是 Webpack 5 很重要的能力，但它解决的是运行时跨应用组合和独立发布问题，不是普通分包优化的替代品。

一句话概括：原理上，Webpack 是围绕模块图和构建生命周期工作的；实践上，Webpack 优化要围绕分包、摇树、缓存、构建成本和运行时边界来做。
