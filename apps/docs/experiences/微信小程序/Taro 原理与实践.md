---
createdAt: '2026-07-08 18:13'
draft: true
---

# Taro 原理与实践

跨端框架在小程序端要解决的问题，不是把 Web 页面搬进小程序，而是让一份 React 代码跑在多种非浏览器运行时上。每种运行时都有自己的组件模型、样式系统、宿主 API 和线程模型。框架真正要做的，是把上层 DSL 转成运行时能识别的组件、样式和 API 调用。

围绕这件事，Taro 前后采用过两种架构：Taro 1/2 以**编译时模板转换**为核心，Taro 3+ 转向**运行时适配**。沿着这条演进线看，Taro 为什么换架构、运行时做了什么、工程里该怎么取舍，都会更清楚。

> 本文假设你已了解小程序运行机制。相关内容见[《微信小程序原理与实践》](./原理与实践.md)。

## Taro 1/2 编译时架构

Taro 1/2 的核心思路，是在编译期分析 JSX，把组件结构提前转换成小程序能识别的 WXML/WXSS/JS。运行时不需要维护虚拟 DOM，React 写法和小程序产物之间的差异主要在构建阶段被消化掉。

```d2
direction: right

source: 业务代码 {
  class: group

  input: JSX / 小程序 API 调用
}

compile: 编译期 {
  class: group

  parse: 解析
  ast: AST
  transform: 转换
  emit: 生成小程序产物

  parse -> ast -> transform -> emit
}

target: 小程序端 {
  class: group

  files: WXML / WXSS / JS / JSON
}

source.input -> compile.parse: 输入
compile.emit -> target.files: 生成
```

### 编译流水线

入口拿到 JSX 后，编译阶段可以拆成四个职责：

- **解析**：Babel 把源代码解析成 AST；
- **转换**：遍历 AST，把 `<View>`、`<Text>`、`<Image>` 等 Taro 组件映射到小程序内置组件；把 `className`、`onClick`、`style` 等 JSX 属性翻译成模板属性、事件绑定和数据字段；
- **模板生成**：根据转换后的 AST 生成 `wxml` 和 `wxss`。页面入口生成页面模板，作为自定义组件输出的组件生成组件模板；
- **逻辑收口**：页面逻辑注册到 `Page({ ... })`，组件逻辑注册到 `Component({ ... })`，生命周期和状态更新接入小程序的页面或组件模型。

业务写 React 组件，构建产物是小程序页面、组件、模板和样式文件；运行时不走 React 的渲染流程，而是执行 `Page` / `Component` 实例和数据绑定。

### 组件映射与属性编译

框架组件到小程序组件的映射，是 Taro 1/2 最基础的一层抽象。

```jsx
<View className={cls} onClick={handleTap}>
  <Text>{title}</Text>
  <Image src={url} mode="aspectFill" />
</View>
```

编译后大致变成：

```xml
<view class="{{cls}}" bindtap="handleTap">
  <text>{{title}}</text>
  <image src="{{url}}" mode="aspectFill"></image>
</view>
```

`className` 会编译成小程序模板的 `class`，`onClick` 会编译成 `bindtap`，子组件和属性同样按小程序模板语法生成。其中：

- 静态部分直接写进模板字符串，`<view class="box">` 这类字面量在编译期就能定下来；
- 动态部分通过 `{{}}` 数据绑定落地，对应字段被加到 `data` 上；
- 事件回调按模板事件名挂载。`onClick` 编译成 `bindtap`，`onInput` 编译成 `bindinput`，`onChange` 编译成 `bindchange`；页面模板里的 `bindtap="handleTap"` 会调用 `Page({ handleTap() {} })` 上的同名函数，组件模板里的同名事件会调用 `Component({ methods: { handleTap() {} } })` 中的方法。`catch*` 前缀的事件不冒泡，相当于 `stopPropagation`。

```js
Component({
  data: {
    cls: 'box',
    title: 'Hello',
    url: 'https://example.com/x.png',
  },
  methods: {
    handleTap() {
      // 业务处理
    },
  },
})
```

### 列表与条件

数组渲染通过 `wx:for` 实现，列表项用 `wx:key` 标识。源代码里的 `list.map(...)` 会在小程序模板中生成 `wx:for`，列表数据则通过页面或组件的 `data` 提供。

```jsx
<View>
  {list.map((item) => (
    <View key={item.id}>{item.name}</View>
  ))}
</View>
```

```xml
<view wx:for="{{list}}" wx:key="id">
  {{item.name}}
</view>
```

三元表达式、逻辑与表达式和 `if` 分支会被转换成 `wx:if` / `wx:elif` / `wx:else` 这类条件模板，用来决定节点是否参与渲染。

```jsx
{
  show ? <View>A</View> : <View>B</View>
}
```

```xml
<view wx:if="{{show}}">A</view>
<view wx:else>B</view>
```

这套“模板级”表达力有一个硬边界：模板能承载的主要是“数据 + 字符串模板”，不能像 JSX 那样用函数在运行时返回新的组件树。编译器也无法在运行时补出模板里没有声明过的结构。这一限制直接推动了 Taro 3 的架构重写。

### 跨端走插件机制

Taro 1/2 的跨端策略是“构建期决定目标平台”。`@tarojs/plugin-platform-weapp`、`@tarojs/plugin-platform-h5`、`@tarojs/plugin-platform-rn` 等平台插件，分别负责把同一份中间产物生成对应平台的最终文件。

```d2
direction: right

source: JSX 源码
core: 框架核心编译
mid: 平台无关中间产物
weapp: weapp 插件
h5: h5 插件
rn: rn 插件
wa_out: 微信小程序产物
h5_out: H5 产物
rn_out: RN 产物

source -> core -> mid
mid -> weapp -> wa_out
mid -> h5 -> h5_out
mid -> rn -> rn_out
```

平台差异由插件集中处理，业务代码不感知目标平台。

### Taro 1/2 的优势

- **运行时轻**：没有虚拟 DOM、没有 reconciler，小程序运行时几乎不知道框架存在；
- **包体积小**：编译产物是小程序原生文件，没有额外的 runtime 字节；
- **性能接近“原生”**：`setData` 由业务显式控制，粒度由业务自己掌握。

这套架构很契合小程序“模板 + 数据绑定”的范式，也是 Taro 在 2018 年开源后快速流行的原因，早期主要在京东内部和前端社区传播。

## 为什么换架构

Taro 1/2 在工程规模上来之后，会撞到表达力墙。最常见的限制集中在两处：模板表达力和跨端维护成本。

```d2
direction: down

drivers: 限制 {
  class: group

  A: 表达力受限
  B: 跨端成本
}

A -> result
B -> result

result: Taro 3: 运行时架构
```

### 表达力受限

模板把“组件树”降级成“数据 + 字符串模板”，既写不出 JSX 那种“返回组件树”的函数，也难以表达运行时决定的 UI 结构。具体有两类问题：

- **JS 层惯用法缺位**：高阶组件、render props、动态组件类型、条件渲染嵌套这些惯用法，要么用“配置式”写法代替，一份声明描述所有可能节点；要么直接放弃；
- **运行时结构受限**：动态表单、权限化 UI、插件化页面都依赖运行时数据驱动；Taro 1/2 倾向于把所有可能性都枚举进模板，结构调整空间有限。

### 跨端成本

不同平台模板的差异不是语法糖差异，而是模型差异。同一段 React 组件代码，编译到 weapp 是 WXML，编译到 H5 是 HTML + JS，编译到 RN 是原生组件声明。这带来两层成本：

- **能力不对齐，维护成本随平台数增长**：A 平台能用的语法在 B 平台可能没有对应物；每多一个平台就要多考虑一套限制；
- **调试与生态割裂**：组件被拆成 wxml/wxss/js/json 四个文件后，运行时错误堆栈只能指到编译产物里的 JS 行号，模板或编译期错误直接指向 wxml 行号，两者都不容易映射回 JSX 源文件。第三方组件库也要写多套。

## Taro 3 运行时架构

Taro 3 翻转了架构：**编译时主要负责打包和小程序能力注入，运行期把 React 组件树挂载到小程序 Page/Component 模型上**。这一节展开核心机制。

```d2
direction: down

compile: 编译期 {
  class: group

  dsl: JSX 模板
  js: 转译为 JS
  inject: 小程序能力注入
}

runtime: 运行期 {
  class: group

  reconcile: Reconciler
  dom: Taro DOM 树
  bridge: 小程序端 Bridge
  endinst: 小程序组件实例
}

end: 运行平台 {
  class: group

  weapp: 微信小程序
  h5: H5
  rn: React Native
  harmony: Harmony
}

compile.dsl -> compile.js
compile.dsl -> compile.inject
compile.js -> runtime.reconcile
compile.inject -> runtime.bridge
runtime.reconcile -> runtime.dom
runtime.dom -> runtime.bridge
runtime.bridge -> endinst
endinst -> end.weapp
endinst -> end.h5
endinst -> end.rn
endinst -> end.harmony
```

### 整体架构

Taro 3 的运行时分三层：

```d2
direction: down

core: taro-runtime {
  class: group

  dom: Taro DOM 抽象
  reconcile: Reconciler
  event: 事件系统
  schedule: setData 调度
}

adapter: 平台 runtime {
  class: group

  weapp: 微信小程序
  h5: H5
  rn: React Native
}

app: 业务代码

core -> adapter: 输出 Taro DOM 与 setData
adapter -> app: 接管 Page / Component 生命周期
```

- **`taro-runtime`**：与平台无关的核心，包含 Taro DOM 抽象、renderer 接入、事件系统和 `setData` 调度；
- **平台 runtime**：weapp、h5、rn 等平台由 `@tarojs/plugin-platform-*` 提供适配，把 Taro DOM 树映射到对应平台的组件实例，承接平台事件，再回调 `taro-runtime`；
- **业务代码**：用 React 写组件，平台 runtime 接管平台生命周期后，再把生命周期桥接给业务框架。

### 编译时职责

Taro 3 的编译时不再把业务 JSX 模板逐组件翻译成小程序模板，主要产出 JS 代码，并注入小程序相关能力。小程序端仍会生成运行所需的基础模板、配置和宿主文件，只是业务 UI 结构主要交给运行时维护。

```d2
direction: right

dsl: JSX 模板
compiler: 框架编译器
js: 调用 Taro runtime API 的 JS
inject: 小程序能力注入
output: JS 产物

dsl -> compiler -> js -> inject -> output
```

- **组件标签**：`import { View, Text } from '@tarojs/components'`，业务侧仍按 React 组件使用，运行时再映射到小程序组件实例；
- **属性传递**：`onClick={fn}` 仍然写在 JSX 上，但事件会进入 Taro DOM 节点的事件代理链路，而不是简单编译成 `bindtap`；
- **小程序能力**：`Taro.request`、`Taro.getStorage` 这类 API 由平台插件和小程序端 runtime 适配到小程序原生实现。

业务代码、组件库和主要构建产物在 Taro 3 下更接近普通 JS 包。Taro 仍然有“编译”，但它的角色从“把业务模板翻译成小程序模板”转向“打包、代码转换和小程序能力注入”。

### Taro DOM 抽象

Taro 的运行时没有浏览器 DOM，也不直接操作小程序 Page/Component 节点。Taro 在内存里维护一棵 Taro DOM 树，节点类型对应小程序组件。

```d2
direction: down

dom: Taro DOM 树 {
  class: group

  page: 页面节点
  comp: 自定义组件节点
  view: 视图节点
  text: 文本节点
  image: 图像节点
}
```

- **节点类型**：内置组件（`view`、`text`、`image`）、自定义组件和文本节点；
- **属性**：每个节点持有 props，包括 `className`、`style`、`src`、事件回调等；
- **树形结构**：父子关系对应 JSX 嵌套，列表渲染的 key 在这里依然承担身份标识。

这棵 DOM 树是 renderer 工作的基础，也是 `setData` 调度生成补丁的对象。

### Reconciler 与组件挂载

Taro 3 的关键不是把 React 的结果直接挂到浏览器 DOM，而是提供一套面向小程序端的 renderer。React 在这里可以理解为自定义宿主环境，commit 阶段把 vnode 变成对 Taro DOM API 的调用。

```d2
direction: right

vdom: 框架 VDOM {
  class: group

  r_vnode: React vnode
}

reconcile: Taro Reconciler {
  class: group

  fiber: 调度器
  diff: 差异计算
  side: 副作用
}

taro_dom: Taro DOM 树

vdom.r_vnode -> reconcile.fiber
reconcile.fiber -> reconcile.diff
reconcile.diff -> reconcile.side
reconcile.side -> taro_dom
```

浏览器 React 把 vnode 变成 DOM 操作；Taro React 把 vnode 变成 Taro DOM 操作，再由小程序端 runtime 同步到小程序组件实例。差异点主要在 commit 阶段：

- 浏览器 React：`commit` 把 vnode 树变成 DOM API 调用，挂到 `document`；
- Taro React：`commit` 把 vnode 树变成对 Taro DOM API 的调用，更新 Taro DOM 树，再由小程序端 runtime 同步到小程序组件实例。

**挂载**。页面被打开时，Taro runtime 创建一棵新的 Taro DOM 树，把根节点关联到小程序 Page/Component 实例。小程序 Page/Component 的生命周期（`onLoad`、`onShow`、`onReady`）由小程序端 runtime 桥接到框架的 effect / mount 钩子。

**更新**。组件状态变化触发框架调度，进入更新与 commit 流程，最终体现为 Taro DOM 树的变更。

### setData 调度

Taro 3 的 `setData` 不再是“业务显式调用”，而是由小程序端 runtime 在 patch 阶段根据 Taro DOM 变更生成数据补丁，再合批成小程序 `setData` 调用。

```d2
direction: right

state: 状态变更
dom: 更新 Taro DOM
diff: 节点 diff
patch: 路径合批
bridge: 小程序 setData
view: 小程序渲染层

state -> dom -> diff -> patch -> bridge -> view
```

**合批**。一次更新可能涉及多个组件、多个字段。小程序端 runtime 会尽量把变更按目标组件分组，并减少跨线程 `setData` 调用次数。

**路径写法**。和原生小程序一样，Taro 也支持“只更新某路径”：Taro DOM 节点的 diff 输出“哪些路径变了”，小程序端 runtime 在调用 `setData` 时也使用路径写法。

**业务不需要手写 `setData`**。这是 Taro 3 和 Taro 1/2、原生小程序之间很关键的差异：状态变更走框架调度，`setData` 由小程序端 runtime 触发。业务看到的“一次 `setData`”，可能由多次 state 变更合批而成。

### 事件代理

小程序事件回到 Taro 侧，要经过两段桥接。

```d2
direction: down

user: 用户操作
end_evt: 小程序事件
end_rt: 小程序端 runtime
taro_evt: Taro DOM 事件
frm_evt: 框架事件系统
handler: 业务回调

user -> end_evt -> end_rt -> taro_evt -> frm_evt -> handler
```

1. **小程序事件**：用户在 `view` 上点击，小程序 Page/Component 收到 `bindtap`。
2. **小程序端 runtime 派发**：小程序端 runtime 根据事件 target 找到对应的 Taro DOM 节点，把事件对象整理为框架事件对象。
3. **框架事件系统**：事件沿 Taro DOM 树冒泡，触发 React 事件回调。

`catchtap`、`stopPropagation` 等“不冒泡”语义在小程序端 runtime 处生效。Taro 会尽量对齐 React 的事件回调模型，但小程序事件对象、冒泡链路和浏览器 DOM 事件并不完全等价。

### 跨端运行时抽象

```d2
direction: down

core: taro-runtime {
  class: group

  dom: Taro DOM
  reconcile: Reconciler
  event: 事件系统
  api: 平台能力 API 接口
}

end: 平台 runtime {
  class: group

  weapp: 微信小程序
  h5: H5
  rn: React Native
}

core.api -> end.weapp
core.api -> end.h5
core.api -> end.rn
```

`taro-runtime` 暴露给上层的是与平台无关的接口（DOM 操作、事件分发、API 调用）。平台 runtime 是适配层，把这些接口变成平台原生调用：

- **DOM 操作**：Taro DOM 节点创建/更新/删除 → 平台组件实例创建/属性更新/销毁；
- **事件**：平台事件 → Taro DOM 事件 → 框架事件；
- **API**：`Taro.request` → 平台网络 API，例如 `wx.request` / `fetch` / RN 侧的 `fetch` 或 `XMLHttpRequest`。

新增平台的工作主要落在平台 runtime 包与 plugin-platform 上，core 一般不用动。

### Taro 3 的优势

- **更完整地支持 React 惯用法**：高阶组件、render props、动态组件类型、Context、ref 等能力更接近原框架，Portal 这类能力仍要看具体平台和版本支持；
- **跨端模型更统一**：各平台都围绕 Taro DOM 抽象工作，平台差异主要收敛到平台 runtime；
- **调试体验更接近原框架**：错误堆栈、SourceMap、断点都更多落在 JS 上，接近 React 自身的开发体验。

### Taro 3 的代价

- **运行期有 renderer 和适配层**：调度开销比 Taro 1/2 大，包体积也更大；
- **`setData` 由框架合批**：业务需要理解“什么时候会触发 `setData`”，写出“少变更、少引用变化”的代码；
- **仍有小程序能力边界**：部分小程序原生能力需要运行时特殊处理才能用，比如同层渲染、`cover-view` 等。

## Taro 3 工程实践

理解运行时架构后，工程问题主要落在五处：包体积、`setData` 性能、跨端兼容、组件选型和调试诊断。

### 项目结构与多平台组织

Taro 3 的项目结构和普通 React 项目差异不大，平台差异主要落在配置和命令上。

```text
src/
  app.ts                // 入口
  app.config.ts         // 全局配置
  pages/                // 页面
  components/           // 业务组件
  services/             // 跨页面服务
  utils/                // 纯函数
  store/                // 状态管理
config/
  dev.ts
  prod.ts
  index.ts
```

构建命令通过环境变量区分平台：

```text
taro build --type weapp
taro build --type h5
taro build --type rn
```

`config/index.ts` 里按平台返回不同配置，平台相关常量（接口前缀、是否开启调试）在配置层收口。

### 包体积与分包

Taro 3 默认产物比 Taro 1/2 大（runtime + 平台适配 + 业务代码）。优化路径有几条：

- **按需引入平台 runtime**：不要让所有平台 runtime 进同一个包，平台配置决定进哪个平台 runtime；
- **按需 polyfill**：避免 `core-js` 全量引入，按目标平台基础库版本选 polyfill 子集；
- **分包**：小程序端同样支持 `subpackages`，把非首屏页面下移到分包；
- **tree-shaking**：确保打包工具按 ES Module 摇树；
- **图片/字体**：尽量用 CDN 引用，小程序端要受 `2MB` 主包限制。

```d2
direction: right

src: 业务代码
runtime: taro-runtime
polyfill: polyfill
adapter: 平台 runtime
tree: tree-shaking
sub: 分包

src -> tree
runtime -> tree
polyfill -> tree
adapter -> tree
tree -> sub
sub -> output
output: 平台产物
```

### setData 与渲染性能

包体积解决首屏加载成本，`setData` 解决运行时更新成本。Taro 3 的 `setData` 是**框架合批**的，业务不需要手写 `setData`，但需要理解“什么时候会触发 `setData`”：

- 状态变更（`useState` / `data` 字段）；
- props 变化（父组件重渲染）；
- context 变化（订阅的 context 值变化）；
- 强制更新（`forceUpdate`）。

这里不再展开 `setData` 的路径写法、合并策略和行为约束，只看 Taro 3 额外带来的影响：组件树越深、引用变化越多、父组件重渲染越频繁，框架合批出的 `setData` 跨线程消息通常也越多。React 自身的渲染优化，例如 `memo` / `useCallback` / `useMemo` / 列表稳定 key / 长列表虚拟化，在 Taro 3 项目里同样必要。

### 跨端兼容

平台能力差异是跨端框架必须正面回答的问题。Taro 3 提供三层抽象：

```d2
direction: down

L1: 平台判断
L2: 条件编译
L3: 业务封装

L1 -> L2
L2 -> L3
```

**平台判断**。运行时拿当前平台信息：

```js
import { getEnv, getSystemInfoSync } from '@tarojs/taro'

const env = getEnv()
console.log(env) // 'WEAPP' | 'H5' | 'RN' | ...

const sys = getSystemInfoSync()
console.log(sys.platform) // 'ios' / 'android' / ...
```

**条件编译**。配置层用 `defineConstants` 区分平台：

```js
// config/index.ts
export default {
  defineConstants: {
    ENABLE_H5_ONLY_FEATURE: false,
  },
}
```

代码层用注释指令：

```js
/** 业务逻辑。 */
function loadList() {
  // #ifdef MP-WEIXIN
  return Taro.request({ url: '/api/list' })
  // #endif

  // #ifdef H5
  return fetch('/api/list').then((r) => r.json())
  // #endif
}
```

**业务封装**。把平台差异收口到 `adapter/`：

```text
src/
  adapter/
    storage.ts
    request.ts
    share.ts
```

业务代码只调用 `adapter/*`，平台差异集中在 adapter 内部。条件编译应该逐步收敛到 adapter，业务层不再直接写。

### 组件选型

- **Taro UI / NutUI**：覆盖较全的跨端组件库，按目标平台选对应的包；
- **自研组件**：跨端组件需要“平台无关”，不直接依赖小程序 API，数据通过 props / 事件传递；
- **第三方 React 组件库**：有机会复用，但样式和事件可能需要适配 Taro 的属性命名，例如 `onClick` 而不是 `bindtap`，CSS 单位也要注意 `rpx`。

选型原则：能用跨端组件库就用；不能用再自研；自研组件保持“平台无关”，避免在业务组件内直接依赖小程序 API。

### 调试与诊断

Taro 3 的调试体验比 Taro 1/2 接近原 React：

- **编译产物可读**：错误堆栈更多指向 JS 文件，而不是 wxml 行号；
- **SourceMap**：构建时开启 `devtool: 'source-map'`，错误堆栈能映射回 JSX 源文件；
- **平台开发者工具**：H5 用浏览器 devtools，weapp 用微信开发者工具，RN 用 Flipper + Metro；
- **Trace**：复杂性能问题借平台开发者工具的 Trace 看渲染、`setData`、事件链路。

常见性能问题排查路径：

```d2
direction: down

start: 页面卡顿
trace: wx devtools Trace：看 setData 频率
tree: 看组件树：是否过度细分组件
props: 看 props 引用：是否大量 inline 对象
list: 看长列表：是否未用 recycle-view
api: 看跨端 API：是否有平台差异未处理

start -> trace -> tree -> props -> list -> api
```

### 监控

Taro 3 项目里，监控可以分为三段：

```d2
direction: right

err: 错误监控
perf: 性能监控
biz: 业务自打点

err -> perf
perf -> biz
```

**错误监控**。小程序原生错误入口（`App.onError`、`wx.onError`、Promise 拒绝）由小程序端 runtime 桥接给业务，业务可以注册全局 handler：

```js
import { getApp } from '@tarojs/taro'

/** 捕获全局错误并上报。 */
function setupErrorReport() {
  const app = getApp()
  // 小程序端 runtime 会把 wx.onError 转发到这里
  app.onError = (err) => {
    reportError(err)
  }
}
```

**性能监控**。关键页面进入、关键 API 耗时、关键 setData 触发由业务自打点。Taro 提供的性能 API 在不同平台覆盖度不同，业务封装层统一。

**业务自打点**。重要交互（点击、提交、页面切换）打点上报，采样率按用户/页面区分。

监控上报本身不要影响主流程。异步、批量、采样、离线缓存这几条原则，在 Taro 项目里同样适用。

## 跨端方案对比

对比跨端方案时，先看两个问题：框架层主要放在编译期还是运行期，以及 DSL 给业务保留多少自由度。下面的比较以小程序场景为主，具体选型仍要回到目标平台、版本和团队技术栈。

### 架构总览

```d2
direction: down

taro12: Taro 1/2 {
  class: group

  dsl_a: JSX
  compile_a: 编译时模板转换
  end_a: 平台模板产物
}

taro3: Taro 3 {
  class: group

  dsl_b: JSX
  compile_b: 平台能力注入
  runtime_b: Taro 运行时
  end_b: 平台组件实例
}

uni: uni-app {
  class: group

  dsl_c: Vue 为主
  compile_c: 编译时模板转换（增强）
  runtime_c: 轻量 Vue 适配
  end_c: 平台模板产物
}

remax: Remax {
  class: group

  dsl_d: React
  compile_d: 平台能力注入
  runtime_d: 运行时适配
  end_d: 平台组件实例
}

taro12.compile_a -> taro12.end_a
taro3.compile_b -> taro3.runtime_b -> taro3.end_b
uni.compile_c -> uni.runtime_c -> uni.end_c
remax.compile_d -> remax.runtime_d -> remax.end_d
```

### 对比矩阵

| 维度       | Taro 1/2                     | Taro 3                                 | uni-app                        | Remax                  |
| ---------- | ---------------------------- | -------------------------------------- | ------------------------------ | ---------------------- |
| 架构       | 编译时模板                   | 运行时适配                             | 编译时模板（增强）+ 轻量运行时 | 运行时适配             |
| DSL        | React                        | React                                  | Vue 为主                       | React                  |
| 平台覆盖   | weapp / h5 / rn / 多家小程序 | weapp / h5 / rn / harmony / 多家小程序 | weapp / h5 / 各类小程序        | weapp / h5 / alipay 等 |
| 运行时开销 | 低                           | 中（reconciler + 平台 runtime）        | 中低                           | 中                     |
| 表达力     | 受限                         | 较完整                                 | 中等（受模板编译能力限制）     | 较完整                 |
| 包体积     | 小                           | 较大                                   | 中                             | 较大                   |
| 生态       | 历史项目多                   | 主流、组件库完善                       | 工具链完善、社区大             | 维护节奏放缓           |

### uni-app 的方案

uni-app 主体是**编译时模板转换**，但 Vue 编译器在小程序端做了特殊化：先把 Vue 模板编译为 uni-app 的中间表示，再由各平台编译器转成对应平台原生代码。运行时是一层轻量 Vue 适配，把组件实例和小程序 Page/Component 桥接。

- **优势**：性能接近原生、包体积可控、HBuilderX 工具链完善、社区活跃；
- **局限**：Vue 表达力受模板编译能力限制，动态能力弱于 Taro 3 / Remax；非 Vue 生态需要额外桥接。

### Remax 的方案

Remax 跟 Taro 3 思路接近，用 React + 运行时适配，更强调“用 React 写小程序”。运行时没有业务小程序模板产物，组件树直接映射到小程序组件实例。

- **优势**：React 表达力完整、API 简洁、对 React 开发者友好；设计方向与 Taro 3 接近；
- **局限**：平台覆盖较少；官方维护节奏在 2022 年后放缓，新项目采用前需要评估现状。

### 选型框架

不同业务有不同取舍，下面给一段经验性判断：

- **新项目、跨多平台、复杂业务** → Taro 3：平台覆盖面较广、生态成熟，适合作为优先评估项；
- **新项目、Vue 为主、性能敏感** → uni-app：Vue 生态成熟、性能表现好、HBuilderX 提效明显；
- **新项目、React 为主、追求极简** → Remax：API 干净、学习成本低，但要确认平台覆盖和社区维护现状；
- **Taro 1/2 历史项目** → 视既有栈而定；老项目一般保留或迁到 Taro 3。

Remax 当前更适合学习其设计思路，而不是新项目首选。

## 总结

跨端框架在小程序端的核心问题，是“DSL → 运行平台”中间那一层怎么搭。Taro 1/2 选了“编译时模板转换”，Taro 3 / Remax 选了“运行时适配”，uni-app 在两者之间偏前者。不同选择的具体取舍：

- **选 Taro 1/2**：选的是“性能 + 包小 + 表达力受限”，适合轻量业务或历史项目维护；
- **选 Taro 3**：选的是“更完整的 React 表达力 + 跨端 + 包稍大”，适合跨端需求复杂的新项目；
- **选 uni-app**：选的是“Vue + 性能 + 生态完整”，适合 Vue 为主、追求工程效率的团队；
- **选 Remax**：选的是“React 优先 + 极简设计”，但要确认平台覆盖和社区维护现状。

把架构看明白，原理与实践之间的取舍才有依据。先理解小程序运行时，再看跨端框架如何适配它，Taro 的很多设计就会顺起来。
