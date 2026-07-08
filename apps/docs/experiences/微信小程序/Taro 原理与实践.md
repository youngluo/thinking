---
createdAt: '2026-07-08 18:13'
draft: true
---

# Taro 原理与实践

跨端框架在小程序侧要解决的问题，不是"Web 跨端"，而是"一套代码同时落到多种非浏览器运行时"。每种运行时都有自己的组件模型、样式系统、宿主 API、线程模型。框架要做的，是把上层 DSL（React/Vue）映射到这些运行时的"原生形态"。Taro 自己走过的两条路，是这道题的两类典型解法：**编译时模板转换**（Taro 1/2）和**运行时适配**（Taro 3+）。本文顺着这条演进主线，把 Taro 的原理、对比与工程实践讲清楚。

> 文中默认读者已经理解小程序的运行环境、双线程模型与 `setData` 机制。相关内容见姊妹文章《原理与实践.md》。

## Taro 1/2 编译时架构

Taro 1/2 的核心思路是"用编译把 JSX/Vue 模板变成端侧模板"。React 组件树在编译期就被展开成端侧能识别的 WXML/WXSS/JS，运行时不维护虚拟 DOM，业务代码和端原生形态之间只隔一层 Babel/编译器。

```d2
direction: right

source: 业务代码 {
  class: group

  jsx: JSX / Vue SFC
  api: 端能力调用
}

compile: 编译期 {
  class: group

  parse: 解析
  ast: AST
  transform: 转换
  emit: 生成端产物
}

target: 端产物 {
  class: group

  wxml: WXML
  wxss: WXSS
  js: JS
  json: JSON
}

source.jsx -> compile.parse -> compile.ast
compile.ast -> compile.transform -> compile.emit
source.api -> compile.emit
compile.emit -> target.wxml
compile.emit -> target.wxss
compile.emit -> target.js
compile.emit -> target.json
```

### 编译流水线

入口拿到 JSX 或 Vue SFC 后，编译流水线大致分四步：

1. **解析**：Babel（React 路径）或 Vue 编译器把源代码解析成 AST。
2. **转换**：遍历 AST，把 `<View>`、`<Text>`、`<Image>` 等框架组件映射到端内置组件；把 JSX/Vue 属性翻译成端模板属性；把事件回调注册到 `Page`/`Component` 的 `methods`。
3. **模板生成**：根据转换后的 AST 生成端模板文件。React 路径下，每一个组件文件最终产出一个目录，包含 `wxml` / `wxss` / `js` / `json` 四个文件。
4. **逻辑收口**：组件 JS 被改写成 `Page({ ... })` 或 `Component({ ... })`，状态与生命周期由框架运行时管理。

业务写 React 组件，编译产物是端原生文件，端运行时几乎不知道 Taro 的存在。

### 组件映射与 props 编译

框架组件到端组件的映射，是 Taro 1/2 最基础的一层抽象。

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

`className` 落到模板的 `class`，`onClick` 落到 `bindtap`，子组件和 props 同样按端模板语法落地。其中：

- **静态部分**直接写进模板字符串（`<view class="box">` 这类字面量在编译期就能定下来）。
- **动态部分**通过 `{{}}` 数据绑定落地，对应字段被加到 `data` 上。
- **事件回调**被注册到 `Page`/`Component` 的 `methods`，模板里用 `bindtap` / `bindinput` / `catchtap` 等端原生事件名。

```js
Page({
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

### 事件、列表与条件

**事件**。`onClick` → `bindtap`、`onInput` → `bindinput`、`onChange` → `bindchange`，事件对象在端侧被组装后回传到逻辑层。`catch*` 前缀的事件不冒泡，相当于 `stopPropagation`。

**列表**。数组渲染通过 `wx:for` 实现，列表项用 `wx:key` 标识。源代码里的 `list.map(...)` 会被改写成一个 `data` 字段加一个 `for` 指令。

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

**条件**。`wx:if` / `wx:elif` / `wx:else` 来自三元或 `if` 语句。`hidden` 来自布尔取反。

```jsx
{
  show ? <View>A</View> : <View>B</View>
}
```

```xml
<view wx:if="{{show}}">A</view>
<view wx:else>B</view>
```

这套"模板级"表达力上有一个硬边界：模板能承载的只是"数据 + 字符串模板"，不能写 JSX 那种"返回组件树"的函数。后续章节会展开这一限制。

### 跨端：以 weapp 为准，其他端通过插件替换

Taro 1/2 的跨端策略是"构建期决定目标端"。`@tarojs/plugin-platform-weapp`、`@tarojs/plugin-platform-h5`、`@tarojs/plugin-platform-rn` 等端插件，分别负责把同一份中间产物生成对应端的最终文件。

```text
JSX/Vue 源码
  -> 框架核心编译
  -> 端无关中间产物
  -> weapp 插件 -> 微信小程序产物
  -> h5 插件 -> H5 产物
  -> rn 插件 -> RN 产物
```

端差异由插件集中处理，业务代码不感知目标端。

### Taro 1/2 的优势

- **运行时轻**：没有虚拟 DOM、没有 reconciler，端运行时几乎不知道框架存在。
- **包体积小**：编译产物是端原生形态，没有额外的 runtime 字节。
- **性能接近"原生"**：setData 由业务显式控制，粒度由业务自己掌握。

这套架构在小程序这种"端模板 + 数据绑定"的范式下非常契合，也是 Taro 在 2018 年开源后快速流行的原因（早期主要在京东内部和前端社区传播）。

## 演进的动因：为什么 Taro 要换架构

Taro 1/2 在工程规模上来之后，会撞到表达力墙。这一节把限制讲清楚，作为下一节 Taro 3 的铺垫。

```d2
direction: down

drivers: 限制 {
  class: group

  A: JS 表达力受限
  B: 跨端能力不均
  C: 动态能力差
  D: 调试与生态
  E: 行业趋势
}

result: 推论

A -> result
B -> result
C -> result
D -> result
E -> result

result: Taro 3: 运行时架构
```

### JS 表达力受限

模板能承载的只是"数据 + 字符串模板"，不能写 JSX 那种"返回组件树"的函数。这意味着：

- **高阶组件**：把组件包一层返回新组件；编译期无法静态展开。
- **render props**：把"如何渲染"作为函数传给子组件；模板里没有函数插槽。
- **动态组件类型**：运行时根据状态决定渲染哪个组件；模板只支持枚举字面量。
- **条件渲染嵌套**：复杂条件组合下的多分支，模板的 `wx:if` 链可读性差。

这些 React/Vue 惯用法在 Taro 1/2 都要绕着走，要么用"配置式"代替（一份声明描述可能的所有节点），要么干脆放弃。

### 跨端能力不均

不同端模板的差异不是语法糖差异，而是模型差异。同一段 React 组件代码编译到 weapp 是 WXML，编译到 H5 是 HTML + JS，编译到 RN 是原生组件声明。模型差异带来两个工程问题：

- **能力不对齐**：A 端能用的语法在 B 端可能没有对应物。
- **维护成本线性增长**：业务要在 3–4 套模板上同时保证可表达性，每多一个端就要多考虑一套限制。

### 动态能力差

Taro 1/2 的运行时几乎不参与渲染决策，所有结构都在编译期固定。这导致：

- **动态表单**：字段类型 / 表单项 / 校验规则都靠后端返回的"表单 schema"驱动；在 Taro 1/2 下需要把可能的结构都枚举到模板里。
- **权限化 UI**：根据用户角色显示不同入口；同样需要枚举所有可能。
- **插件化页面**：不同业务方接入自己的模块；模板组合能力撑不住。

### 调试与生态

- **编译后代码与源代码脱节**：Taro 1/2 把组件拆成 wxml/wxss/js/json 四个文件后，运行时错误堆栈往往只能指到编译产物里的 JS 行号，模板/编译期错误直接指向 wxml 行号，两者都不容易映射回 JSX 源文件。
- **组件库生态受限**：第三方组件必须提供 Taro 编译产物，跨端组件库要写多套。

### 行业趋势

业务复杂度在涨，跨端框架必须能承载更接近"完整前端框架"的开发体验。React/Vue 本身也在朝"函数即组件、组合优先"方向演化。这些趋势汇总起来指向一个共同的方向：把"框架层"从编译期推到运行期。

## Taro 3 运行时架构

Taro 3 翻转了架构：**编译时只做端差异注入，运行期用一套 reconciler 把 React/Vue 组件树挂载到端 Page/Component 模型上**。这一节展开核心机制。

```d2
direction: down

compile: 编译期 {
  class: group

  dsl: JSX / Vue 模板
  js: 转译为 JS
  inject: 端能力注入
}

runtime: 运行期 {
  class: group

  reconcile: Reconciler
  dom: Taro DOM 树
  bridge: 端侧 Bridge
  endinst: 端组件实例
}

end: 端运行时 {
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

adapter: 端侧 runtime {
  class: group

  weapp: 微信端
  h5: H5 端
  rn: RN 端
}

app: 业务代码

core -> adapter: 输出 Taro DOM 与 setData
adapter -> app: 接管 Page / Component 生命周期
```

- **`taro-runtime`**：与端无关的核心，包含 Taro DOM 抽象、Reconciler 接入、事件系统、setData 调度。
- **端侧 runtime**：`@tarojs/runtime` 是与端无关的核心；weapp、h5、rn 等端各自由 `@tarojs/plugin-platform-*` 提供适配。它们把 Taro DOM 树映射到端组件实例，承接端事件，回调 `taro-runtime`。
- **业务代码**：用 React/Vue 写组件，框架把组件树挂载到端 Page/Component。

### 编译时：从 DSL 到 JS

Taro 3 的编译时**不再生成端模板**，只产出 JS 代码 + 端能力注入。

```text
JSX / Vue 模板
  -> 框架编译器
  -> 调用 Taro runtime API 的 JS
  -> 端能力注入 (Taro.xxx 绑定到端原生 API)
  -> JS 产物
```

- **组件标签**：`import { View, Text } from '@tarojs/components'`，这些是 React/Vue 组件，运行时会渲染为端组件实例。
- **属性传递**：`onClick={fn}` 仍然写在 JSX 上，但运行时把它登记到 Taro DOM 节点上的事件代理，而不是编译成 `bindtap`。
- **端能力**：`Taro.request`、`Taro.getStorage` 在编译期被绑定到端原生实现，运行时由端侧 runtime 提供。

业务代码、组件库、构建产物在 Taro 3 下都是普通 JS 包。Taro 仍然有"编译"，但它的角色从"翻译模板"降为"打包 + 端能力注入"。

### Taro DOM 抽象

Taro 的运行时**没有浏览器 DOM**，也不直接操作端 Page/Component 节点。Taro 在内存里维护一棵**虚拟的 DOM 树**，节点类型对应端组件。

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

- **节点类型**：内置组件（`view`、`text`、`image`）、自定义组件、文本节点。
- **属性**：每个节点持有 props（className、style、src、事件回调等）。
- **树形结构**：父子关系对应 JSX 嵌套；列表渲染的 key 在这里依然承担身份标识。

这棵 DOM 树是 reconciler 工作的基础，也是 setData 调度的"工作面"。

### Reconciler 与组件挂载

Taro 3 复用 React/Vue 自身的 reconciler，但接入方式做了改造。

```d2
direction: right

vdom: 框架 VDOM {
  class: group

  r_vnode: React vnode
  v_vnode: Vue vnode
}

reconcile: Taro Reconciler {
  class: group

  fiber: 调度器
  diff: 差异计算
  side: 副作用
}

taro_dom: Taro DOM 树

vdom.r_vnode -> reconcile.fiber
vdom.v_vnode -> reconcile.fiber
reconcile.fiber -> reconcile.diff
reconcile.diff -> reconcile.side
reconcile.side -> taro_dom
```

浏览器 React 把 vnode 变成 DOM；Taro React 把 vnode 变成**端组件实例**。差异点在 commit 阶段：

- 浏览器 React：`commit` 把 vnode 树变成 DOM API 调用，挂到 `document`。
- Taro React：`commit` 把 vnode 树变成对 Taro DOM API 的调用，更新 Taro DOM 树，再由端侧 runtime 同步到端组件实例。

**挂载**。页面被打开时，Taro runtime 创建一棵新的 Taro DOM 树，把根节点挂到端 Page/Component 实例上。端 Page/Component 的生命周期（`onLoad`、`onShow`、`onReady`）由端侧 runtime 桥接到框架的 effect / mount 钩子。

**更新**。组件状态变化触发框架调度（React 的 scheduler / Vue 的 nextTick），reconciler 计算出 vnode 树差异，commit 阶段更新 Taro DOM 树。

### setData 调度

Taro 3 的 `setData` 不再是"业务显式调用"，而是由端侧 runtime 在 patch 阶段"对比 Taro DOM 树 vs 端组件实例树"，把差异合批成端 `setData` 调用。

```d2
direction: right

state: 状态变更
dom: 更新 Taro DOM
diff: 节点 diff
patch: 路径合批
bridge: 端侧 setData
view: 端渲染层

state -> dom -> diff -> patch -> bridge -> view
```

**合批**。一次更新可能涉及多个组件、多个字段。端侧 runtime 把所有变更按"目标组件"分组，每个目标组件一次 `setData`。

**路径写法**。和原生小程序一样，Taro 也支持"只更新某路径"：`Taro DOM 节点的 diff 输出"哪些路径变了"，端侧 runtime 在调用 `setData` 时也使用路径写法。

**业务不需要手写 setData**。这是 Taro 3 和 Taro 1/2、原生小程序最大的差异点：状态变更走框架调度，setData 由端侧 runtime 触发。业务看到的"一次 setData"，可能由多次 state 变更合批而成。

### 事件代理

端事件回到 Taro 侧，要经过两段桥接。

```d2
direction: down

user: 用户操作
end_evt: 端事件
end_rt: 端侧 runtime
taro_evt: Taro DOM 事件
frm_evt: 框架事件系统
handler: 业务回调

user -> end_evt -> end_rt -> taro_evt -> frm_evt -> handler
```

1. **端事件**：用户在 `view` 上点击，端 Page/Component 收到 `bindtap`。
2. **端侧 runtime 派发**：端侧 runtime 根据事件 target 找到对应的 Taro DOM 节点，把事件对象整理为框架事件对象。
3. **框架事件系统**：事件沿 Taro DOM 树冒泡，触发 React/Vue 事件回调。

`catchtap`、`stopPropagation` 等"不冒泡"语义在端侧 runtime 处生效；React 合成事件系统与浏览器一致。

### 跨端 runtime 抽象

```d2
direction: down

core: taro-runtime {
  class: group

  dom: Taro DOM
  reconcile: Reconciler
  event: 事件系统
  api: 端能力 API 接口
}

end: 端侧 runtime {
  class: group

  weapp: 微信小程序端
  h5: H5 端
  rn: RN 端
}

core.api -> end.weapp
core.api -> end.h5
core.api -> end.rn
```

`taro-runtime` 暴露给上层的是与端无关的接口（DOM 操作、事件分发、API 调用）。端侧 runtime 是适配层，把这些接口变成端原生调用：

- **DOM 操作**：Taro DOM 节点创建/更新/删除 → 端 Page/Component 实例创建/属性更新/销毁。
- **事件**：端事件 → Taro DOM 事件 → 框架事件。
- **API**：`Taro.request` → 端网络 API（`wx.request` / `fetch` / RN 侧的 `fetch` 或 `XMLHttpRequest`）。

新增端只需要写一个端侧 runtime 包，core 不用动。

### Taro 3 的优势

- **完整支持 React/Vue 惯用法**：高阶组件、render props、动态组件类型、Context、ref、Portal 都可以。
- **跨端能力一致**：所有端都跑同一套 Taro DOM 抽象，端差异只出现在端侧 runtime。
- **调试体验好**：错误堆栈、SourceMap、断点都打在 JS 上，接近 React/Vue 自身的开发体验。

### Taro 3 的代价

- **运行期有 reconciler**：调度开销比 Taro 1/2 大，包体积也更大。
- **setData 由框架合批**：业务需要理解"什么时候会触发 setData"，写出"少变更、少引用变化"的代码。
- **少量语法限制**：部分端原生能力需要运行时特殊处理才能用，比如同层渲染、`cover-view` 等。

## 横向对比：Taro 1/2 vs Taro 3 vs uni-app vs Remax

把四个跨端方案的架构差异放在同一张图上对比。核心分歧点有两个：把框架层放在编译期还是运行期，以及 DSL 的选择自由度。

### 架构总览

```d2
direction: down

taro12: Taro 1/2 {
  class: group

  dsl_a: JSX / Vue
  compile_a: 编译时模板转换
  end_a: 端模板产物
}

taro3: Taro 3 {
  class: group

  dsl_b: JSX / Vue
  compile_b: 端能力注入
  runtime_b: Taro 运行时
  end_b: 端组件实例
}

uni: uni-app {
  class: group

  dsl_c: Vue 为主
  compile_c: 编译时模板转换（增强）
  runtime_c: 轻量 Vue 适配
  end_c: 端模板产物
}

remax: Remax {
  class: group

  dsl_d: React
  compile_d: 端能力注入
  runtime_d: 运行时适配
  end_d: 端组件实例
}

taro12.compile_a -> taro12.end_a
taro3.compile_b -> taro3.runtime_b -> taro3.end_b
uni.compile_c -> uni.runtime_c -> uni.end_c
remax.compile_d -> remax.runtime_d -> remax.end_d
```

### 对比矩阵

| 维度       | Taro 1/2        | Taro 3                           | uni-app                        | Remax        |
| ---------- | --------------- | -------------------------------- | ------------------------------ | ------------ |
| 架构       | 编译时模板      | 运行时适配                       | 编译时模板（增强）+ 轻量运行时 | 运行时适配   |
| DSL        | React / Vue     | React / Vue                      | Vue 为主                       | React        |
| 端覆盖     | weapp / h5 / rn / 多家小程序 | weapp / h5 / rn / harmony / 更多 | weapp / h5 / 各类小程序        | weapp / h5   |
| 运行时开销 | 低              | 中（reconciler + 端侧 runtime）  | 中低                           | 中           |
| 表达力     | 受限            | 完整                             | 中等（受模板编译能力限制）     | 完整         |
| 包体积     | 小              | 较大                             | 中                             | 较大         |
| 生态       | 历史项目多      | 主流、组件库完善                 | 工具链完善、社区大             | 维护节奏放缓 |

### uni-app 的方案

uni-app 主体是**编译时模板转换**，但 Vue 编译器在小程序侧做了特殊化：先把 Vue 模板编译为 uni-app 的中间表示，再由各端编译器转成对应端原生代码。运行时是一层轻量 Vue 适配，把组件实例和端 Page/Component 桥接。

- **优势**：性能接近原生、包体积可控、HBuilderX 工具链完善、社区活跃。
- **局限**：Vue 表达力受模板编译能力限制，动态能力弱于 Taro 3 / Remax；非 Vue 生态需要额外桥接。

### Remax 的方案

Remax 跟 Taro 3 思路接近，用 React + 运行时适配，但更彻底地"用 React 写小程序"。运行时没有端模板产物，组件树直接映射到端组件实例。

- **优势**：React 表达力完整、API 简洁、对 React 开发者最友好；设计哲学对 Taro 3 有直接影响。
- **局限**：端覆盖较少；官方维护节奏在 2022 年后放缓，新项目采用前需要评估现状。

### 选型框架

不同业务有不同取舍，下面给一段经验性判断：

- **业务大、复杂、跨多端、React/Vue 都用** → Taro 3：跨端覆盖最广、组件库生态最大、新项目默认选项。
- **业务中等、Vue 为主、追求性能与包体积** → uni-app：Vue 生态最熟、性能好、HBuilderX 提效明显。
- **业务 React 为主、只跑 weapp/h5、追求极简** → Remax：API 干净、学习成本低，但要确认端覆盖和社区维护现状。
- **历史项目维护** → 视既有栈而定；Taro 1/2 老项目一般保留或迁到 Taro 3。

Remax 当前更适合学习其设计思路，而不是新项目首选。

## Taro 3 工程实践

原理讲清楚后，回到日常项目。这一节给出 Taro 3 项目里最常见的工程取舍：包体积、`setData` 性能、跨端兼容、组件选型、调试。

### 项目结构与多端组织

Taro 3 的项目结构和普通 React/Vue 项目差异不大，端差异主要落在配置和命令上。

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

构建命令通过环境变量区分端：

```text
taro build --type weapp
taro build --type h5
taro build --type rn
```

`config/index.ts` 里按端返回不同配置，端相关常量（接口前缀、是否开启调试）在配置层收口。

### 包体积与分包

Taro 3 默认产物比 Taro 1/2 大（runtime + 端适配 + 业务代码）。优化路径有几条：

- **按需引入端 runtime**：不要让所有端 runtime 进同一个包，端配置决定进哪个端 runtime。
- **按需 polyfill**：避免 `core-js` 全量引入，按目标端基础库版本选 polyfill 子集。
- **分包**：小程序侧同样支持 `subpackages`，把非首屏页面下移到分包。
- **tree-shaking**：确保打包工具按 ES Module 摇树。
- **图片/字体**：尽量用 CDN 引用，小程序侧要受 `2MB` 主包限制。

```d2
direction: right

src: 业务代码
runtime: taro-runtime
polyfill: polyfill
adapter: 端侧 runtime
tree: tree-shaking
sub: 分包

src -> tree
runtime -> tree
polyfill -> tree
adapter -> tree
tree -> sub
sub -> output
output: 端产物
```

### setData 与渲染性能

Taro 3 的 setData 是**框架合批**的，业务不需要手写 setData，但需要理解"什么时候会触发 setData"：

- 状态变更（`useState` / `data` 字段）。
- props 变化（父组件重渲染）。
- context 变化（订阅的 context 值变化）。
- 强制更新（`forceUpdate`）。

优化点：

- **不可变更新**：避免就地修改对象/数组，让引用变化能被框架检测。
- **稳定引用**：减少 inline 函数 / inline 对象作为 props，否则每次 render 都会被视作"prop 变化"，引发下游组件重渲染。
- **列表 key**：列表项必须稳定 key，避免整列重建。
- **长列表**：`recycle-view` / `virtual-list` 风格组件做节点复用。
- **动画/滚动**：动画状态尽量放 `useRef` 或 Taro 提供的动画 API，避免频繁 setState。

```jsx
import { useState, useCallback } from 'react'

/** 子组件，props 引用稳定能避免无谓重渲染。 */
function Item({ id, onTap }) {
  return <View onClick={() => onTap(id)}>...</View>
}

function List({ items }) {
  const [selected, setSelected] = useState(null)

  // 用 useCallback 保持 handleTap 引用稳定
  const handleTap = useCallback((id) => {
    setSelected(id)
  }, [])

  return items.map((item) => <Item key={item.id} id={item.id} onTap={handleTap} />)
}
```

这条优化路径在 React/Vue 自身项目里也存在，Taro 3 只是把同样的问题用 setData 暴露出来：父组件重渲染越频繁，跨线程消息越多。

### 跨端兼容

端能力差异是跨端框架必须正面回答的问题。Taro 3 提供三层抽象：

```d2
direction: down

L1: 端判断
L2: 条件编译
L3: 业务封装

L1 -> L2
L2 -> L3
```

**端判断**。运行时拿当前端信息：

```js
import { getEnv, getSystemInfoSync } from '@tarojs/taro'

const env = getEnv()
console.log(env) // 'WEAPP' | 'H5' | 'RN' | ...

const sys = getSystemInfoSync()
console.log(sys.platform) // 'ios' / 'android' / ...
```

**条件编译**。配置层用 `defineConstants` 区分端：

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

**业务封装**。把端差异收口到 `adapter/`：

```text
src/
  adapter/
    storage.ts
    request.ts
    share.ts
```

业务代码只调用 `adapter/*`，端差异集中在 adapter 内部。条件编译应该逐步收敛到 adapter，业务层不再直接写。

### 组件选型

- **Taro UI / NutUI**：覆盖较全的跨端组件库，按目标端选对应的包。
- **自研组件**：跨端组件需要"端无关"（不直接依赖端 API），数据通过 props / 事件传递。
- **第三方 React/Vue 组件库**：能直接用，但样式和事件可能需要适配 Taro 的属性命名（`onClick` 而不是 `bindtap`、CSS 单位注意 `rpx`）。

选型原则：能用跨端组件库就用；不能用再自研；自研组件要"端无关"，别把端 API 写进业务组件。

### 调试与诊断

Taro 3 的调试体验比 Taro 1/2 接近原 React/Vue：

- **编译产物可读**：错误堆栈指向 JS 文件，不是 wxml 行号。
- **SourceMap**：构建时开启 `devtool: 'source-map'`，错误堆栈能映射回 JSX/Vue 源文件。
- **端开发者工具**：H5 用浏览器 devtools；weapp 用微信开发者工具；RN 用 Flipper + Metro。
- **Trace**：复杂性能问题借端开发者工具的 Trace 看渲染、setData、事件链路。

常见性能问题排查路径：

```text
页面卡顿
  -> wx devtools Trace：看 setData 频率
  -> 看组件树：是否过度细分组件
  -> 看 props 引用：是否大量 inline 对象
  -> 看长列表：是否未用 recycle-view
  -> 看跨端 API：是否有端差异未处理
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

**错误监控**。端原生错误入口（`App.onError`、`wx.onError`、Promise 拒绝）由端侧 runtime 桥接给业务，业务可以注册全局 handler：

```js
import { getApp } from '@tarojs/taro'

/** 捕获全局错误并上报。 */
function setupErrorReport() {
  const app = getApp()
  // 端侧 runtime 会把 wx.onError 转发到这里
  app.onError = (err) => {
    reportError(err)
  }
}
```

**性能监控**。关键页面进入、关键 API 耗时、关键 setData 触发由业务自打点。Taro 提供的性能 API 在不同端覆盖度不同，业务封装层统一。

**业务自打点**。重要交互（点击、提交、页面切换）打点上报，采样率按用户/页面区分。

设计原则：**异步、批量、采样、离线缓存**。上报本身不要阻塞主流程；网络请求尽量合并；采样要按用户、设备和场景控制；弱网下要支持本地暂存与补发。

## 总结

跨端框架在小程序侧的核心问题，是"DSL → 端运行时"中间那一层怎么搭。Taro 1/2 选了"编译时模板转换"，Taro 3 / Remax 选了"运行时适配"，uni-app 在两者之间偏前者。不同选择带来的取舍，写在每一行代码的脚下：

- **选 Taro 1/2**：选的是"性能 + 包小 + 表达力受限"，适合轻量业务或历史项目维护。
- **选 Taro 3**：选的是"完整 React/Vue + 跨端 + 包稍大"，新项目跨端需求复杂时的默认选项。
- **选 uni-app**：选的是"Vue + 性能 + 生态完整"，Vue 为主、追求工程效率的团队。
- **选 Remax**：选的是"React 优先 + 极简设计"，但要确认端覆盖和社区维护现状。

把架构看明白，原理与实践之间的取舍才有依据。本文和姊妹文章《原理与实践.md》合起来，就是"小程序原理 + 跨端原理"两篇，建议按顺序阅读。
