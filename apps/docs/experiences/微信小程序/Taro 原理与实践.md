---
createdAt: '2026-07-08 18:13'
draft: true
---

# Taro 原理与实践

跨端框架在小程序端要解决的问题，不是把 Web 页面搬进小程序，而是让同一份 React 或 Vue 代码跑在多种非浏览器运行时上。每种运行时都有自己的组件模型、样式系统、宿主 API 和线程模型。框架真正要做的，是把上层 DSL 转成运行时能识别的组件、样式和 API 调用。

围绕这件事，Taro 前后采用过两种架构：Taro 1/2 以**编译时模板转换**为核心，Taro 3+ 转向**运行时适配**。沿着这条演进线看，Taro 为什么换架构、运行时做了什么、工程里该怎么取舍，都会更清楚。

> 本文假设你已了解小程序运行机制。相关内容见[《微信小程序原理与实践》](./原理与实践.md)。

## Taro 1/2 编译时架构

Taro 1/2 的核心思路，是在编译时分析 JSX，把组件结构提前转换成小程序能识别的 WXML/WXSS/JS。运行时不需要维护虚拟 DOM，React 写法和小程序产物之间的差异主要在构建阶段被消化掉。

```d2
direction: right

source: 业务代码 {
  class: group

  input: JSX / 小程序 API 调用
}

compile: 编译时 {
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

- 静态部分直接写进模板字符串，`<view class="box">` 这类字面量在编译时就能定下来；
- 动态部分通过 `{{}}` 绑定模板数据，对应字段被加到 `data` 上；
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

三元、逻辑与和函数体里的 `if` 分支会被转换成 `wx:if` / `wx:elif` / `wx:else` 这类条件模板，用来决定节点是否参与渲染。

```jsx
{
  show ? <View>A</View> : <View>B</View>
}
```

```xml
<view wx:if="{{show}}">A</view>
<view wx:else>B</view>
```

这套“模板级”表达力有一个硬边界：模板能承载的主要是“数据 + 字符串模板”，不能像 JSX 那样用函数在运行时返回新的组件树。编译器也无法在运行时补出模板里没有声明过的结构。这一限制直接推动了 Taro 3+ 的架构重写。

### 跨端构建机制

前面以微信小程序为例讲了模板转换；放到跨端场景里，区别在于构建命令会先确定目标平台，后续生成阶段再选择对应的平台适配逻辑。

```d2 maxHeight=260
direction: right

source: JSX 源码
core: AST 解析与转换
weapp: weapp
h5: h5
rn: rn
wa_out: 微信小程序产物
h5_out: H5 产物
rn_out: RN 产物

source -> core
core -> weapp -> wa_out
core -> h5 -> h5_out
core -> rn -> rn_out
```

不同平台适配逻辑会输出不同产物：`weapp` 生成 WXML/WXSS/JS/JSON，`h5` 生成 Web 产物，`rn` 生成面向 React Native 的 JS bundle 和组件调用。Taro 1/2 仍有公共运行时代码，用来承接 API 调用、生命周期和事件等能力。业务代码可以尽量保持同构，平台专有能力再通过条件编译或业务封装收口。

### Taro 1/2 的优势

- **运行时链路短**：UI 结构已在编译时生成平台产物，运行时主要处理 API、生命周期和事件桥接；
- **贴近原生模型**：小程序端产物以 WXML/WXSS/JS/JSON 为主，直接接入平台的模板和数据绑定机制；
- **更新成本可控**：模板结构提前确定，运行时主要更新数据字段，`setData` 路径更容易和模板绑定对应。

这套架构的优势来自编译时转换；同样，限制也来源于此。

## 为什么换架构

随着工程规模扩大，Taro 1/2 的编译时架构会逐渐暴露三类问题：模板表达力受限、构建产物膨胀，以及跨端维护成本上升。

### 表达力受限

Taro 1/2 的模板转换有一个天然边界：编译器必须提前看见组件结构，才能生成目标平台模板。已知节点的显隐和重复可以交给 `wx:if`、`wx:for` 这类模板指令处理；但如果组件类型、嵌套层级或结构形状要到运行时才确定，模板就很难像 JSX 一样自由表达组件树。具体有两类问题：

- **语法表达受限**：上层 DSL 最终要转换成目标平台模板，不能跳出平台模板的表达范围；如果组件结构要到运行时才确定，编译器就很难提前生成完整模板；
- **运行时结构受限**：动态表单、权限化 UI、插件化页面往往由配置决定组件类型和嵌套关系；而 Taro 1/2 需要提前在模板里声明可能出现的结构，后续调整空间有限。

### 产物膨胀

编译时模板转换会按组件结构生成平台产物，业务越复杂，生成代码越多，整体包体积也会随之增长。Taro 3+ 虽然增加了 runtime 成本，但业务 UI 结构主要由运行时维护，规模上来后体积优势会逐渐显现。

### 跨端成本

跨端代码能保持一套写法，但平台差异不会消失，只是转移到编译器、平台适配层和业务约束里。成本主要体现在两方面：

- **能力不对齐，维护成本随平台数增长**：组件、样式、事件和宿主 API 在不同平台上不完全等价；每多一个目标平台，就要多维护一套映射规则和兼容边界；
- **调试与生态割裂**：源码被拆成目标平台产物后，错误可能出现在 JS、模板或样式文件里，定位时需要在源码和生成文件之间来回映射。第三方组件库也需要满足各平台的组件和样式约束。

## Taro 3+ 运行时架构

Taro 3+ 不再在编译时把业务 UI 转成目标平台模板，而是在运行时把框架组件树同步到目标平台。运行链路可以拆成四段：框架层业务代码、renderer、`taro-runtime` 和目标平台适配。

```d2
direction: down

framework:  业务代码 {
  class: group

  react: React
  vue: Vue3
  solid: Solid
}

renderer: 框架渲染器 {
  class: group

  react: '@tarojs/react'
  vue: Vue3 自带
  solid: Solid 自带
}

core: taro-runtime {
  class: group

  dom: Taro DOM / BOM
  b: 页面 / 组件配置创建
  c: 生命周期桥接
  event: 事件系统
  schedule: Hydrate 序列化
}

platform: 平台渲染器 {
  class: group

  weapp: 微信小程序
  web: Web
  rn: React Native
}

framework -> renderer
renderer -> core: reconciler
core -> platform: Taro DOM 变更与事件分发
platform -> core: 平台生命周期与事件
```

- **业务代码 / 框架层**：业务仍按 React、Vue 等框架写组件，状态更新先进入对应框架的渲染流程；
- **框架渲染器**：把框架侧的更新接入 Taro。React 侧通过 `@tarojs/react` 和 reconciler 工作；Vue、Solid 等框架也会通过各自接入层把更新转成 Taro 可处理的操作；
- **`taro-runtime`**：与平台无关的核心，维护 Taro DOM / BOM 抽象，并承接页面 / 组件配置创建、生命周期桥接、事件系统和更新序列化；
- **平台渲染器**：微信小程序、Web、RN 等平台把 Taro DOM 变更同步到宿主环境，并把平台生命周期和事件回传给 `taro-runtime`。

### 编译时职责

Taro 3+ 仍然保留编译阶段，但重点转向为运行时准备小程序侧静态产物，主要包括四类：

- **动态模板**：生成可复用的组件模板，提前声明节点类型、属性绑定和 `children` 递归位置；
- **平台配置**：根据应用、页面、组件和插件配置生成 `app.json`、页面 `json`、组件引用等配置文件；
- **平台入口**：生成应用、页面和组件入口，建立小程序文件与业务模块之间的引用关系；
- **JS 产物**：打包业务代码、框架 renderer、`taro-runtime` 和小程序端适配代码。

动态模板是这里最关键的差异。小程序模板仍然需要提前存在，所以 Taro 3+ 会生成一组通用模板，提前声明常见节点类型以及父子递归关系。运行时再把 Taro DOM 树序列化成数据，驱动这些模板渲染出真实视图。它和 Taro 1/2 的区别在于：模板不再对应具体业务组件结构，而是对应运行时可复用的节点描述。

简化后可以理解成下面这种结构：

```xml
<template name="tpl_view">
  <view
    id="{{ uid }}"
    class="{{ className }}"
    style="{{ style }}"
    hover-class="{{ hoverClass }}"
    hover-stop-propagation="{{ hoverStopPropagation }}"
    hover-start-time="{{ hoverStartTime || 50 }}"
    hover-stay-time="{{ hoverStayTime || 400 }}"
  >
    <block wx:for="{{ children }}" wx:key="uid">
      <template is="{{ 'tpl_' + item.nodeName }}" data="{{ item }}" />
    </block>
  </view>
</template>
```

这里的 `tpl_view` 对应小程序 `view` 组件，`children` 保存子节点数据，`nodeName` 决定继续调用 `tpl_text`、`tpl_image` 等其它模板。真实产物会比这个复杂，也会包含事件、属性、组件类型等更多字段；但核心思路相同：模板先提供可复用的节点渲染结构，运行时再用 Taro DOM 数据决定这次渲染哪些节点、节点之间如何嵌套。

### Taro DOM 抽象

动态模板解决的是“小程序模板需要提前存在”的问题，Taro DOM 解决的是“框架 renderer 要操作什么”的问题。小程序逻辑层没有浏览器 DOM/BOM，Taro 运行时会提供一套精简版 DOM/BOM API，例如 `document`、`appendChild`、`insertBefore`、`removeChild`、`setAttribute` 等，由构建工具注入到逻辑层代码里。这样 renderer 可以像操作真实 DOM 一样提交更新，最终落到 Taro DOM 树上。

```d2
direction: right

event: TaroEventTarget {
  shape: class

  addEventListener()
  removeEventListener()
}

node: TaroNode {
  shape: class

  +uid: string
  +nodeType: NodeType
  +nodeName: string
  +parentNode: "TaroNode | null"
  +childNodes: "TaroNode[]"
  +nextSibling: "TaroNode | null"
  +previousSibling: "TaroNode | null"
  +firstChild: "TaroNode | null"
  +lastChild: "TaroNode | null"
  +ownerDocument: TaroDocument
  +appendChild(child\: TaroNode)
  +removeChild(child\: TaroNode, options?) : TaroNode
  +insertBefore(child\: TaroNode, refChild?\: TaroNode)
  +replaceChild(newChild\: TaroNode, oldChild\: TaroNode) : TaroNode
  +remove(options?\: RemoveChildOptions)
  +hasChildNodes() : boolean
  +enqueueUpdate(payload\: UpdatePayload)
}

element: TaroElement {
  shape: class

  +ctx: MpInstance
  +tagName: string
  +props: "Record<string, any>"
  +style: Style
  +dataset: "Record<string, unknown>"
  +innerHTML: string
  +id: string
  +className: string
  +classList: ClassList
  +children: "TaroElement[]"
  +attributes: "Attributes[]"
  +textContent: string
  +hasAttribute(qualifiedName\: string) : boolean
  +hasAttributes() : boolean
  +getAttribute(qualifiedName\: string) : string
  +setAttribute(name\: string, value\: any)
  +getElementsByTagName(tagName\: string) : "TaroElement[]"
  +dispatchEvent(event\: TaroEvent) : boolean
  -_stopPropagation(event\: TaroEvent)
}

text: TaroText {
  shape: class

  textContent: string
  nodeValue: string
  nodeType: NodeType.TEXT_NODE
  nodeName: '#text'
}

root: TaroRootElement {
  shape: class

  +updatePayloads: "UpdatePayload[]"
  +updateCallbacks: "TFunc[]"
  +pendingUpdate: boolean
  +ctx: "MpInstance | null"
  +scheduleTask(fn\: TFunc)
  +enqueueUpdate(payload\: UpdatePayload)
  +performUpdate(initRender, prerender)
}

node -> event: extends
element -> node: extends
text -> node: extends
root -> element: extends
```

- **DOM/BOM 入口**：提供 `document`、节点创建、插入和删除等 API，让 renderer 有稳定的宿主接口；
- **节点模型**：用 `TaroNode`、`TaroElement`、`TaroText` 描述元素、文本、父子关系和兄弟关系；
- **属性与事件**：在 `TaroElement` 上保存 `props`、`className`、`style`、事件监听和事件派发信息；
- **更新调度**：由 `TaroRootElement` 负责收集和批量处理 DOM 更新，通过 `performUpdate()` 生成小程序 `setData` 所需的数据，`scheduleTask()` 负责异步调度，减少高频 `setData`。

这就是 Taro DOM 的核心价值：上层框架只需要面向一个稳定的宿主环境提交更新，底层再把 Taro DOM 变更序列化成动态模板需要的数据。下一步，小程序端 runtime 会根据这棵树生成 `setData` 数据补丁。

### Reconciler 与组件挂载

在 Taro 3+ 里，React 可以理解为运行在一套自定义 renderer 上。React 仍然负责组件执行、状态调度、diff 和 commit；变化的是 commit 阶段的宿主操作：浏览器环境会提交成真实 DOM 操作，小程序环境会提交成 Taro DOM 操作。

React renderer 不直接创建小程序原生视图，只修改内存中的 Taro DOM 树。后续由小程序端 runtime 把 Taro DOM 转成 `setData` 数据，交给动态模板渲染。

以页面为例，编译产物会生成小程序 `Page` 配置，用来承接小程序生命周期并启动框架渲染。首次挂载时，Taro 会把框架渲染结果绑定到当前小程序页面实例，分发生命周期，并同步初始视图数据。简化后的关键链路如下：

```d2
direction: right

page: "Page onLoad"
config: Taro 页面配置
mount: "Current.app.mount()"
render: React render
commit: React commit
root: 按页面路径获取 root
load: 执行页面加载回调
ctx: 关联 Page 实例
update: "performUpdate(true)"
data: 首次 setData
template: 动态模板首次渲染 {
  class: ok
}

page -> config: 触发
config -> mount
mount -> render
render -> commit
commit -> root: 写入 Taro DOM
root -> load
load -> ctx
ctx -> update
update -> data
data -> template
```

小程序生命周期和 React effect 需要分开看。`onLoad`、`onShow`、`onReady` 等生命周期先进入 Taro runtime，再由 runtime 分发到 Taro 提供的页面生命周期入口；`useEffect` / `useLayoutEffect` 不对应某个小程序生命周期，它们只响应 React commit 后的状态和 props 变化。

常见页面生命周期的映射关系如下，斜杠前是 Hooks 写法，斜杠后是类组件写法：

| 小程序生命周期 | Taro 映射                         |
| -------------- | --------------------------------- |
| `onLoad`       | `useLoad` / `onLoad`              |
| `onReady`      | `useReady` / `onReady`            |
| `onShow`       | `useDidShow` / `componentDidShow` |
| `onHide`       | `useDidHide` / `componentDidHide` |
| `onUnload`     | `useUnload` / `onUnload`          |

首次挂载之后，组件状态变化仍会回到框架调度和 commit 流程，最终表现为 Taro DOM 树的变更。至于这些变更如何通过批处理减少跨线程 `setData` 调用，下一节会展开这条链路。

### 调度更新

框架 renderer 在 commit 阶段提交宿主操作，这些操作最终会落到 Taro DOM 方法上，并先修改逻辑层里的 Taro DOM Tree。小程序渲染层不能直接读取这棵内存树，所以 runtime 还需要把本轮更新整理成小程序 `data` 上的路径和值，例如 `{ "root.cn[0].cn[1].value": 1 }`，再通过 `setData` 发送给对应的 Page/Component 实例。这条更新链路可以简化成：

```d2
direction: right

state: 状态变更
commit: renderer commit
method: Taro DOM 方法
tree: 修改 Taro DOM Tree
enqueue: "enqueueUpdate()"
patch: 生成路径和值
bridge: setData
view: 渲染层更新

state -> commit -> method
method -> tree
method -> enqueue
enqueue -> patch
patch -> bridge -> view
```

一次 commit 可能调用多个 Taro DOM 方法，影响多个节点和多个字段。runtime 会先收集同一轮更新里的记录，再按对应的 Page/Component 实例提交，避免每个字段变化都单独触发一次跨线程通信。

这里更新的粒度是 DOM 级别，只有最终发生变化的 DOM 节点会被同步到渲染层。相对于 Taro 1/2 的 data 级别更新，这种粒度更精准。

### 事件代理

Taro 的事件代理同样围绕 Taro DOM 展开。它的目标是在小程序这类非浏览器环境里，提供一套接近 Web 的事件模型：节点通过 `addEventListener()` / `removeEventListener()` 管理监听器，事件对象统一成 `TaroEvent`，冒泡和阻止冒泡回到 Taro DOM 树上处理。

在小程序端，编译生成的模板会把常见事件绑定到统一入口 `eventHandler`。事件触发后，runtime 根据事件携带的节点标识找到对应的 TaroElement，再把原始小程序事件整理成 `TaroEvent`，最后通过 `dispatchEvent()` 重新派发。

```d2
direction: right

user: 用户操作
template: 小程序模板事件
entry: eventHandler
node: 查找 TaroElement
event: 创建 TaroEvent
dispatch: "TaroElement.dispatchEvent"
callback: 业务回调

user -> template
template -> entry
entry -> node
entry -> event
event -> dispatch
node -> dispatch
dispatch -> callback
```

这条链路里有两层适配。第一层是事件对象适配：不同平台的原始事件字段不完全一致，runtime 会先整理成 Taro 能识别的 `TaroEvent`，同时保留原始小程序事件引用。第二层是派发语义适配：事件回到 Taro DOM 树后，监听器管理、冒泡控制和 `stopPropagation()` 等行为由 Taro DOM 事件系统处理。

`TaroEvent` 只是尽量模拟 Web 标准事件，并不等同于浏览器原生 DOM 事件。比如捕获阶段不能按浏览器 DOM 的完整语义理解，特殊原生组件事件和平台特有字段也要以 runtime 的适配结果为准。

### Taro 3+ 的取舍

Taro 3+ 用运行时适配换来了更完整的框架表达力，同时也把一部分成本转移到了 runtime、包体积和更新调度上。

- **表达力更完整**：业务代码不再被编译时模板结构强约束，动态组件、条件结构和配置化 UI 更容易表达；高阶组件、render props、Context、ref 等能力也更接近原框架。代价是运行时链路变长，状态变化要经过框架调度、Taro DOM 更新和 `setData`。
- **跨端维护更集中**：React、Vue 等技术栈通过各自 renderer 接入 Taro DOM，平台差异主要收敛到 runtime、事件系统、API 适配和 plugin-platform。差异不会消失，只是从业务模板转换转移到运行时适配和组件/API 边界里。
- **调试更接近框架本身**：错误堆栈、SourceMap、断点更多落在 JS 上，定位问题时更接近 React / Vue 自身的开发体验。但性能问题也要看完整链路，包括框架渲染、Taro DOM 更新和小程序 `setData`。
- **包体积曲线不同**：renderer、Taro DOM 和平台适配层会抬高初始包体积；但小程序端模板相对固定，WXML 体积有上限，不会随着业务组件结构持续膨胀。项目规模较小时 runtime 成本更明显，规模上来后固定模板的体积优势才会体现。

## Taro 3+ 工程实践

理解运行时架构后，工程问题主要集中在项目结构、包体积、跨端兼容、组件选型、调试诊断和监控这几处。

### 项目结构与多平台组织

Taro 3+ 的项目结构和普通 React 项目差异不大，平台差异主要落在配置和命令上。

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

Taro 3+ 默认产物比 Taro 1/2 大（runtime + 平台适配 + 业务代码）。优化路径有几条：

- **按需引入平台 runtime**：不要让所有平台 runtime 进同一个包，平台配置决定进哪个平台 runtime；
- **按需 polyfill**：避免 `core-js` 全量引入，按目标平台基础库版本选 polyfill 子集；
- **分包**：小程序端同样支持 `subpackages`，把非首屏页面下移到分包；
- **tree-shaking**：确保打包工具按 ES Module 摇树；
- **图片/字体**：尽量用 CDN 引用，小程序端要受 `2MB` 主包限制。

### 跨端兼容

平台能力差异不会因为使用跨端框架而消失。Taro 3+ 能统一组件写法、生命周期入口和常用 API，但宿主能力、组件行为和样式细节仍会有平台差异。工程里通常把兼容逻辑分成两类：JS / TS 里的编译期平台分支，以及样式里的条件编译。稳定后，再把这些差异收敛到业务封装中。

JS / TS 里的平台判断主要依赖 `process.env.TARO_ENV`。它表示当前编译平台类型，常见取值包括 `weapp`、`swan`、`alipay`、`h5`、`rn`、`tt`、`qq`、`jd`、`harmony`、`jdrn`。如果某段逻辑只应该出现在特定平台产物里，可以基于它写编译期分支：

```js
/** 获取当前平台的接口前缀。 */
function getApiBaseURL() {
  if (process.env.TARO_ENV === 'h5') {
    return '/api'
  }

  if (process.env.TARO_ENV === 'weapp') {
    return 'https://api.example.com'
  }

  return ''
}
```

样式里的平台差异可以用注释指令处理。`#ifdef` 表示当前平台匹配时保留，`#ifndef` 表示当前平台匹配时剔除：

```css
/* #ifdef weapp */
.weapp-only-style {
  color: red;
}
/* #endif */

/* #ifndef h5 */
.non-h5-style {
  color: blue;
}
/* #endif */
```

这些分支不应该长期散落在页面和组件里。平台能力差异稳定后，JS / TS 逻辑应沉到 `adapter/`，样式差异则收口到平台样式文件、变量或组件样式封装中：

```text
src/
  adapter/
    storage.ts
    request.ts
    share.ts
```

业务代码只调用 `adapter/*`，平台差异集中在边界处展开。这样页面和组件仍然保持一套主要逻辑，跨端代码才不会被条件分支拆散。

### 组件选型

组件选型优先看目标平台覆盖范围。如果需求能被 Taro UI、NutUI 这类跨端组件库满足，通常优先使用对应平台版本，成本最低。

跨端组件库覆盖不到时，再考虑自研组件。自研组件要尽量保持平台无关，数据通过 props 传入，交互通过事件抛出，不在组件内部直接依赖小程序 API。确实需要平台能力时，也应通过 adapter 收口。

第三方 React 组件库可以评估复用，但不能默认可用。很多 Web 组件依赖浏览器 DOM、CSS 选择器能力或 Web 事件模型，放到 Taro 小程序端可能需要改造；即使能复用，也要注意事件命名、样式单位和目标平台支持情况。

### 调试与诊断

Taro 3+ 的业务逻辑主要运行在 JS 里，错误堆栈、SourceMap 和断点调试会更接近 React / Vue 自身的开发体验。构建时应开启合适的 SourceMap，例如 `devtool: 'source-map'`，让错误堆栈能映射回源码。

平台开发者工具仍然不能省。Web 主要看浏览器 DevTools，小程序端看微信开发者工具，RN 看对应的 Metro / Flipper 链路。遇到复杂性能问题时，重点看框架渲染、Taro DOM 更新、`setData` 和事件链路之间的耗时关系。

常见页面卡顿可以按下面的路径排查：

```d2
direction: down

start: 页面卡顿
trace: wx devtools Trace：看 setData 频率
tree: 看渲染范围：是否过度重渲染
props: 看 props 引用：是否大量 inline 对象
list: 看长列表：是否未用 recycle-view
api: 看跨端 API：是否有平台差异未处理

start -> trace -> tree -> props -> list -> api
```

### 监控

Taro 3+ 项目里的监控通常覆盖三类信号：运行错误、性能指标和业务事件。错误监控优先接应用级生命周期，例如 `onError`、`onUnhandledRejection`，再按平台补充原生错误入口：

```js
import { Component } from 'react'

class App extends Component {
  /** 捕获应用级错误并上报。 */
  onError(err) {
    reportError(err)
  }

  /** 捕获未处理的 Promise 拒绝并上报。 */
  onUnhandledRejection(res) {
    reportError(res.reason)
  }
}
```

性能监控重点看关键页面进入耗时、接口耗时、长任务、渲染卡顿和 `setData` 相关指标。不同平台能拿到的性能数据不完全一致，建议在业务封装层统一字段和采样规则。

业务自打点用于补齐技术指标看不到的链路，例如点击、提交、支付、分享和页面切换。监控上报本身不要影响主流程，异步、批处理、采样和离线缓存这几条原则，在 Taro 项目里同样适用。

## 跨端方案对比

对比跨端方案时，先看两个问题：框架层主要放在编译时还是运行时，以及 DSL 给业务保留多少自由度。下面的比较以小程序场景为主，具体选型仍要回到目标平台、版本和团队技术栈。

| 维度       | Taro 3+                                      | uni-app                        |
| ---------- | -------------------------------------------- | ------------------------------ |
| 架构       | 运行时适配                                   | 编译时模板（增强）+ 轻量运行时 |
| DSL        | React / Vue / Solid 等                       | Vue 为主                       |
| 平台覆盖   | 微信小程序 / Web / RN / Harmony / 多家小程序 | App / Web / 各类小程序         |
| 运行时开销 | 中（reconciler + 平台 runtime）              | 中低                           |
| 表达力     | 较完整                                       | 中等（受模板编译能力限制）     |
| 包体积     | 初始较大，规模上来后看模板复用收益           | 中                             |
| 生态       | 主流、组件库完善                             | 工具链完善、社区大             |

uni-app 主体是编译时模板转换：Vue 模板先编译为 uni-app 的中间表示，再由各平台编译器转成平台原生代码。它的性能和包体积相对可控，工具链、插件市场和社区生态也比较完整；代价是复杂动态结构仍会受模板编译边界影响。

新项目如果跨多平台、业务结构复杂，Taro 3+ 通常适合作为优先评估项；如果团队已经采用 uni-app / DCloud 生态，并且更看重工具链、插件市场和小程序端稳定性，uni-app 通常更容易落地。

## 总结

Taro 3+ 的核心变化，是从“把业务组件编译成平台模板”转向“让框架更新在运行时落到 Taro DOM，再由平台 runtime 同步到宿主环境”。动态模板、调度更新和事件代理，都是围绕这条链路展开的。

这套架构换来了更完整的框架表达力和更集中的跨端适配，也带来了 runtime 成本、包体积和更新链路复杂度。工程上要做的，是分清差异出现在哪一层：组件表达在框架层，视图更新在 Taro DOM 和平台 runtime，平台能力则尽量收口到 adapter。
