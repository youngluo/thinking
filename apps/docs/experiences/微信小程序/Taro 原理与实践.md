---
createdAt: '2026-07-15 00:00'
---

# Taro 原理与实践

当前的跨端框架，基本思路都是希望用 React、Vue 这类主流框架来写业务层代码。到了小程序端，这些代码最终要对应到小程序能识别的产物和调用。解题思路其实也很常见，要么在编译阶段提前转成目标平台产物，要么在运行时提供一层适配，把上层框架的渲染结果接到小程序运行环境里。

Taro 的架构变化，也是在这两种思路之间演进。Taro 1/2 主要靠**编译时模板转换**，Taro 3+ 则把更多能力放到了**运行时适配**里。下面就按这条演进线展开。

> 本文假设你已了解小程序运行机制。相关内容见[《微信小程序原理与实践》](./原理与实践.md)。

## Taro 1/2 编译时架构

Taro 1/2 的核心思路，是在编译时分析 JSX，把组件结构提前转换成小程序能识别的 WXML/WXSS/JS。运行时不需要维护虚拟 DOM，React 写法和小程序产物之间的差异主要在构建阶段被消化掉。

### 编译时职责

入口拿到 JSX 后，编译阶段可以拆成四个职责：

- **解析**：Babel 把源代码解析成 AST；
- **转换**：遍历 AST，把 `<View>`、`<Text>`、`<Image>` 等 Taro 组件映射到小程序内置组件；把 `className`、`onClick`、`style` 等 JSX 属性翻译成模板属性、事件绑定和数据字段；
- **模板生成**：根据转换后的 AST 生成 `wxml` 和 `wxss`；页面入口生成页面模板，自定义组件入口生成组件模板；
- **逻辑收口**：页面逻辑注册到 `Page({ ... })`，组件逻辑注册到 `Component({ ... })`，生命周期和状态更新接入小程序的页面或组件配置。

业务层写 React 组件，构建产物是小程序页面、组件、模板和样式文件；运行时不走 React 的渲染流程，而是执行 `Page` / `Component` 实例和数据绑定。

### 组件映射

React 组件到小程序组件的映射，是 Taro 1/2 最基础的一层抽象。

```jsx fold
<View className="box" onClick={handleTap}>
  <Input value={value} onInput={handleInput} />
  <Picker mode="selector" range={options} onChange={handleChange}>
    <Text>{selectedLabel}</Text>
  </Picker>
</View>
```

编译后大致变成：

```xml fold
<view class="box" bindtap="handleTap">
  <input value="{{value}}" bindinput="handleInput"></input>
  <picker mode="selector" range="{{options}}" bindchange="handleChange">
    <text>{{selectedLabel}}</text>
  </picker>
</view>
```

`className` 会编译成小程序模板的 `class`，`onClick` 会编译成 `bindtap`，子组件和属性同样按小程序模板语法生成。其中：

- 静态部分直接写进模板字符串，`<picker mode="selector">` 这类字面量在编译时就能定下来；
- 动态部分通过 `{{}}` 绑定模板数据，对应字段被加到 `data` 上；
- 事件回调按模板事件名挂载。页面模板里的 `bindtap="handleTap"` 会调用页面配置上的同名方法，组件模板里的事件会调用组件 `methods` 中的同名方法。

```js fold
Component({
  data: {
    value: '',
    options: ['A', 'B'],
    selectedLabel: 'A',
  },
  methods: {
    handleTap() {
      // 业务处理
    },
    handleInput(event) {
      // 输入处理
    },
    handleChange(event) {
      // 选择处理
    },
  },
})
```

### 列表与条件

数组渲染通过 `wx:for` 实现，列表项用 `wx:key` 标识。源代码里的 `list.map(...)` 会在小程序模板中生成 `wx:for`，列表数据则通过页面或组件的 `data` 提供。

```jsx fold
list.map((item) => <View key={item.id}>{item.name}</View>)
```

```xml fold
<view wx:for="{{list}}" wx:key="id">
  {{item.name}}
</view>
```

三元、逻辑与和函数体里的 `if` 分支会被转换成 `wx:if` / `wx:elif` / `wx:else` 这类条件模板，用来决定节点是否参与渲染。

```jsx fold
show ? <View>A</View> : <View>B</View>
```

```xml fold
<view wx:if="{{show}}">A</view>
<view wx:else>B</view>
```

这也是编译时方案的主要限制，模板只能表达“预先确定的结构 + 数据”，不能像 JSX 那样在运行时灵活的返回组件树。模板里没有声明过的结构，编译器也无法在运行时补全。要想支持更完整的 React 写法，就需要把更多渲染能力放到运行时。

### 跨端构建机制

多平台构建时，构建命令会先确定目标平台，然后进入对应的编译和生成链路。上层业务代码尽量保持同一套写法，平台差异则在构建阶段展开，由不同平台的适配逻辑生成各自能运行的产物。

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

不同平台最终拿到的产物并不一样。`weapp` 会生成 WXML/WXSS/JS/JSON，`h5` 会生成 Web 产物，`rn` 则生成面向 React Native 的 JS bundle 和组件调用。Taro 1/2 的核心是编译时转换，但并不意味着完全没有运行时，API 调用、生命周期、事件等能力仍然需要公共运行时代码承接。

这种方案适合页面结构相对稳定的场景。组件结构提前生成后，小程序端可以直接接入模板和数据绑定机制，运行时只需要处理数据更新、事件和平台 API 等能力。

### 架构优势

- **运行时链路短**：组件结构已在编译时生成目标产物，运行时主要处理 API、生命周期和事件桥接；
- **贴近原生模型**：小程序端产物以 WXML/WXSS/JS/JSON 为主，直接接入平台的模板和数据绑定机制；
- **更新成本可控**：模板结构提前确定，运行时主要更新数据字段，`setData` 路径更容易和模板绑定对应。

这些优势都是建立在“结构提前确定”的前提上。当业务表达变得更动态，或者目标平台继续增加时，编译时方案需要维护的映射和约束也会变多。

## 为什么换架构

随着工程规模扩大，Taro 1/2 的编译时架构会遇到三类问题：模板表达力受限、构建产物膨胀，以及跨端维护成本上升。

表达力的问题来自模板生成方式。Taro 1/2 要求编译器提前看见组件结构，才能生成目标平台模板。已知节点的显隐和重复可以交给 `wx:if`、`wx:for` 处理，但组件类型或嵌套关系如果要到运行时才确定，模板就很难像 JSX 一样表达动态组件树。动态表单、权限化 UI、插件化页面都属于这类场景。

产物体积也会受到影响。编译时模板转换会按组件结构生成平台产物，业务越复杂，生成代码越多。Taro 3+ 虽然增加了 runtime 成本，但页面结构主要由运行时描述和更新，项目规模变大后，模板产物不再随页面复杂度线性膨胀。

跨端维护成本则来自平台差异。这些差异最终会转移到编译器、平台适配层和业务约束里：

- **能力不对齐，维护成本随平台数增长**：组件、样式、事件和宿主 API 在不同平台上不完全等价；每多一个目标平台，就要多维护一套映射规则和兼容边界；
- **调试与生态割裂**：源码被拆成目标平台产物后，错误可能出现在 JS、模板或样式文件里，定位时需要在源码和生成文件之间来回映射。第三方组件库也需要满足各平台的组件和样式约束。

这些问题单靠增强编译器很难完全解决，因此 Taro 3+ 把更多能力移到了运行时。

## Taro 3+ 运行时架构

Taro 3+ 不再把组件结构在编译时提前转成平台模板，而是由运行时承接框架的渲染结果，再同步到对应平台。整体链路可以拆成四段：框架层业务代码、框架渲染器（renderer）、`taro-runtime` 和目标平台适配。

```d2 maxHeight=500
direction: down

framework: 业务代码 {
  grid-columns: 5
  class: group
  width: 1100

  react: React
  vue: Vue3
  solid: Solid
}

renderer: 框架渲染器 {
  grid-columns: 5
  class: group
  width: 1100

  react: '@tarojs/react'
  vue: Vue3 自带
  solid: Solid 自带
}

runtime: taro-runtime {
  grid-columns: 5
  class: group
  width: 1100

  dom: Taro DOM / BOM
  config: 页面 / 组件配置创建
  lifecycle: 生命周期桥接
  event: 事件系统
  schedule: 调度更新
}

platform: 平台渲染器 {
  grid-columns: 5
  class: group
  width: 1100

  weapp: 微信小程序
  web: Web
  rn: React Native
  harmony: Harmony
  jd: 京东小程序
}

framework -> renderer: reconciler
renderer -> runtime
runtime -> platform: Taro DOM 变更
platform -> runtime: 生命周期与事件
```

- **业务代码 / 框架层**：业务仍按 React、Vue 等框架写组件，状态更新先进入对应框架的渲染流程；
- **框架渲染器**：把框架的更新接入 Taro，React 通过 `@tarojs/react` 和 reconciler 工作；Vue、Solid 等框架也会通过各自接入层把更新转成 Taro 可处理的操作；
- **taro-runtime**：与平台无关的核心，维护 Taro DOM / BOM 抽象，负责页面 / 组件配置创建、生命周期桥接、事件系统和更新序列化；
- **平台渲染器**：微信小程序、Web、RN 等平台把 Taro DOM 变更同步到宿主环境，并把平台生命周期和事件回传给 `taro-runtime`。

### 编译时职责

Taro 3+ 仍然保留编译阶段，但重点转向为运行时准备静态产物。以小程序端为例，主要包括四类：

- **动态模板**：生成可复用的组件模板，提前声明节点类型、属性绑定和 `children` 递归位置；
- **平台配置**：根据应用、页面、组件和插件配置生成 `app.json`、页面 `json`、组件引用等配置文件；
- **平台入口**：生成应用、页面和组件入口，让小程序的 `Page` / `Component` 配置能加载对应的业务模块；
- **JS 产物**：打包业务代码、框架渲染器、`taro-runtime` 和小程序端适配代码。

动态模板是 Taro 3+ 编译阶段最关键的变化。小程序模板仍然需要提前存在，所以编译阶段会生成一组通用模板，声明常见节点类型和递归关系。运行时再把 Taro DOM 树序列化成数据，交给这些模板渲染。也就是说，模板不再绑定具体业务结构，而是服务于运行时的节点描述。简化后的结构如下：

```xml fold
<template name="tpl_view">
  <view
    hover-stop-propagation="{{ hoverStopPropagation }}"
    hover-start-time="{{ hoverStartTime || 50 }}"
    hover-stay-time="{{ hoverStayTime || 400 }}"
    hover-class="{{ hoverClass }}"
    class="{{ className }}"
    style="{{ style }}"
    id="{{ uid }}"
  >
    <block wx:for="{{ children }}" wx:key="uid">
      <template is="{{ 'tpl_' + item.nodeName }}" data="{{ item }}" />
    </block>
  </view>
</template>
```

这里的 `tpl_view` 对应小程序的 `view` 节点，`children` 用来继续递归子节点，`nodeName` 决定下一个要使用的模板。真实产物还会包含事件、属性等字段，但核心思路相同：模板提供可复用的节点结构，运行时用 Taro DOM 数据决定渲染哪些节点，以及它们如何嵌套。

### Taro DOM 抽象

动态模板让小程序端有了可复用的渲染结构，Taro DOM 则给框架渲染器提供一棵可以操作的节点树。小程序逻辑层没有浏览器 DOM/BOM，Taro 运行时会提供一套精简版 DOM/BOM API，例如 `appendChild`、`insertBefore`、`removeChild` 等，并由构建工具注入到逻辑层。这样渲染器提交更新时，就可以通过这些 API 修改 Taro DOM 树。内部节点定义关系简化如下：

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

- **DOM/BOM 入口**：提供 `document`、节点创建、插入和删除等 API，让渲染器有稳定的宿主接口；
- **节点模型**：`TaroNode` 模拟基础 DOM 节点，维护父子关系和兄弟关系；`TaroElement` 表示元素或组件节点，`TaroText` 表示文本节点；
- **属性与事件**：在 `TaroElement` 上保存 `props`、`className`、`style`、事件监听和事件派发信息；
- **更新调度**：由 `TaroRootElement` 负责收集和批量处理 DOM 更新，通过 `performUpdate()` 生成小程序 `setData` 所需的数据，`scheduleTask()` 负责异步调度，减少高频 `setData`。

以上就是 Taro DOM 的核心价值：上层框架只需要面向一个稳定的宿主环境提交更新，后续再由小程序端 runtime 把 Taro DOM 变更转换成 `setData` 数据。

### Reconciler 与组件挂载

在 Taro 3+ 里，React 可以理解为运行在一套自定义渲染器上。组件执行、状态调度、diff 和 commit 仍然走 React 自己的流程，变化发生在 commit 阶段：浏览器里操作的是真实 DOM，小程序里操作的是 Taro DOM。

以页面为例，编译产物会生成小程序 `Page` 配置，用来承接小程序生命周期并启动框架渲染。首次挂载时，Taro 会创建并更新页面对应的 Taro DOM root，再把它和当前小程序页面实例关联起来，随后初始化视图数据。简化后的关键链路如下：

```d2
direction: right

page: "小程序 Page.onLoad"
path: 生成页面标识
render: 启动框架渲染
root: 创建并更新 Taro DOM root
page_ctx: 关联 Page 实例并分发 onLoad
data: 首次 setData
template: 动态模板首次渲染

page -> path
path -> render
render -> root
root -> page_ctx
page_ctx -> data
data -> template
```

挂载之后还会涉及两类回调：小程序生命周期和 React effect。`onLoad`、`onShow`、`onReady` 等生命周期先进入 Taro runtime，再由 runtime 分发到 Taro 提供的页面生命周期入口；`useEffect` / `useLayoutEffect` 不对应某个小程序生命周期，它们只响应 React commit 后的状态和 props 变化。

常见页面生命周期的映射关系如下，斜杠前是 Hooks 写法，斜杠后是类组件写法：

| 小程序生命周期 | Taro 映射                         |
| -------------- | --------------------------------- |
| `onLoad`       | `useLoad` / `onLoad`              |
| `onShow`       | `useDidShow` / `componentDidShow` |
| `onReady`      | `useReady` / `onReady`            |
| `onHide`       | `useDidHide` / `componentDidHide` |
| `onUnload`     | `useUnload` / `onUnload`          |

### 调度更新

框架渲染器在 commit 阶段会调用 Taro DOM 方法，先修改逻辑层里的 Taro DOM Tree。小程序渲染层不能直接读取这棵内存树，所以 runtime 需要记录本轮发生变化的路径和值，并生成小程序 `data` 上的更新，例如 `{ "root.cn[0].cn[1].value": 1 }`，再通过 `setData` 发送给对应的 Page/Component 实例。这条更新链路可以简化成：

```d2
direction: right

state: 状态变更
commit: commit
method: Taro DOM 方法
tree: 修改 Taro DOM Tree
record: 记录更新
patch: 合并路径和值
bridge: setData
view: 渲染层更新

state -> commit -> method
method -> tree
method -> record
record -> patch
patch -> bridge -> view
```

一次 commit 可能调用多个 Taro DOM 方法，影响多个节点和多个字段。runtime 会先收集同一轮更新里的记录，再按对应的 Page/Component 实例提交，避免每个字段变化都单独触发一次跨线程通信。

这里更新的粒度来自 Taro DOM 变更。提交给 `setData` 的不是整棵 Taro DOM 树，而是变更对应的路径和值。相对于更粗的 data 级别更新，这种方式更精准。

### 事件代理

Taro 基于 Taro DOM 实现了一套自己的事件机制。runtime 会维护节点上的监听器，把原始小程序事件封装成统一的事件对象，并在 Taro DOM 树上处理冒泡和阻止冒泡。

在小程序端，编译生成的模板会把常见事件绑定到 `eventHandler`。事件触发后，runtime 根据事件携带的节点标识找到对应的 TaroElement，把原始小程序事件封装成 `TaroEvent`，再通过 `TaroElement.dispatchEvent()` 执行监听器和冒泡逻辑。这条路径可以简化成下面几步：

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

需要注意的是，`TaroEvent` 会保留原始小程序事件引用，方便在必要时读取平台事件字段。它只是尽量模拟 Web 标准事件，并不等同于浏览器原生 DOM 事件。比如捕获阶段不能按浏览器 DOM 的完整语义理解，特殊原生组件事件和平台特有字段也要以 runtime 的适配结果为准。

### 架构取舍

Taro 3+ 用运行时适配换来了更完整的框架表达力，同时也把一部分成本转移到了 runtime、包体积和更新调度上。

- **表达力更完整**：业务代码不再被编译时模板结构强约束，动态组件、条件结构和配置化 UI 更容易表达；高阶组件、render props、Context、ref 等能力也更接近原框架。代价是运行时链路变长，状态变化要经过框架调度、Taro DOM 更新和 `setData`。
- **跨端维护更集中**：React、Vue 等技术栈通过各自的渲染器接入 Taro DOM，平台差异主要收敛到 runtime、事件系统、API 适配和平台插件，维护位置更集中。
- **调试更接近框架本身**：错误堆栈、SourceMap、断点更多集中在 JS 上，定位问题时更接近 React / Vue 自身的开发体验。但性能问题也要看完整链路，包括框架渲染、Taro DOM 更新和小程序 `setData`。
- **包体积曲线不同**：框架、Taro DOM 和平台适配层会增加初始包体积；但小程序端模板相对固定，WXML 体积有上限，不会随着业务组件结构持续膨胀。项目规模较小时 runtime 成本更明显，页面和组件变多后，固定模板的体积优势会更容易体现。

## Taro 3+ 工程实践

工程实践主要包括几类问题：项目结构、包体积、跨端兼容、组件选型、调试和监控。

### 项目结构与多平台

Taro 3+ 的项目结构和普通 React 项目差异不大，平台差异主要体现在配置和构建命令上。

```text fold
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

```bash fold
taro build --type weapp
taro build --type h5
taro build --type rn
```

`config/index.ts` 里按平台返回不同配置，接口前缀、调试开关这类平台常量也尽量在配置层统一管理。

### 包体积

Taro 3+ 引入了 runtime 和平台适配层，小项目里初始包体积通常会比 Taro 1/2 更大。常见优化方向有几类：

- **控制平台代码边界**：不同平台分别出包，避免把无关平台的 runtime 和适配代码带进当前产物；
- **按需 polyfill**：避免 `core-js` 全量引入，按目标平台基础库版本选 polyfill 子集；
- **分包**：小程序端同样支持 `subpackages`，把非首屏页面下移到分包；
- **tree-shaking**：确保打包工具按 ES Module 摇树；
- **图片/字体**：尽量用 CDN 引用，小程序端要受 `2MB` 主包限制。

### 跨端兼容

平台能力差异不会因为使用跨端框架而消失。Taro 3+ 能统一组件写法、生命周期入口和常用 API，但宿主能力、组件行为和样式细节仍会有差异。工程里通常把兼容逻辑分成两类：JS / TS 里的编译期平台分支，以及样式里的条件编译。确定会长期存在的差异，再收敛到业务封装中。

JS / TS 里的平台判断主要依赖 `process.env.TARO_ENV`。它表示当前编译平台类型，常见取值包括 `weapp`、`swan`、`alipay`、`h5`、`rn`、`tt`、`qq`、`jd`、`harmony`、`jdrn`。如果某段逻辑只应该出现在特定平台产物里，可以基于它写编译期分支：

```js fold
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

```css fold
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

这些分支不应该长期分散在页面和组件里。平台能力差异稳定后，JS / TS 逻辑应沉到 `adapter/`，样式差异则收敛到平台样式文件、变量或组件样式封装中：

```text fold
src/
  adapter/
    storage.ts
    request.ts
    share.ts
```

业务代码只调用 `adapter/*`，平台差异集中在边界层处理。这样页面和组件仍然保持一套主要逻辑，跨端代码才不会被条件分支拆散。

### 组件选型

组件选型优先看目标平台覆盖范围。如果需求能被 Taro UI、NutUI 这类跨端组件库满足，通常优先使用对应平台版本，成本最低。

跨端组件库覆盖不到时，再考虑自研组件。自研组件要尽量保持平台无关，数据通过 props 传入，交互通过事件抛出，不在组件内部直接依赖小程序 API。确实需要平台能力时，也应通过 adapter 收敛。

第三方 React 组件库可以评估复用，但不能默认可用。很多 Web 组件依赖浏览器 DOM、CSS 选择器能力或 Web 事件模型，放到 Taro 小程序端可能需要改造；即使能复用，也要注意事件命名、样式单位和目标平台支持情况。

### 调试

Taro 3+ 的业务逻辑主要运行在 JS 里，错误堆栈、SourceMap 和断点调试会更接近 React / Vue 自身的开发体验。构建时应开启合适的 SourceMap，例如 `devtool: 'source-map'`，让错误堆栈能映射回源码。

平台开发者工具仍然要用。Web 主要看浏览器 DevTools，小程序端看微信开发者工具，RN 看对应的 Metro / Flipper 链路。遇到复杂性能问题时，重点看框架渲染、Taro DOM 更新、`setData` 和事件链路之间的耗时关系。常见页面卡顿可以按下面的路径排查：

```d2
direction: right

start: 页面卡顿
trace: wx devtools Trace：看 setData 频率
tree: 看渲染范围：是否过度重渲染
props: 看 props 引用：是否大量 inline 对象
list: 看长列表：是否未用 recycle-view
api: 看跨端 API：是否有平台差异未处理

start -> trace -> tree -> props -> list -> api
```

### 监控

Taro 3+ 项目里的监控通常覆盖三类信号：运行错误、性能指标和业务事件。错误监控应该优先接入应用级生命周期，例如 `onError`、`onUnhandledRejection`，之后再按平台接入对应的错误回调或上报能力：

```js fold
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

业务打点用于补齐技术指标看不到的链路，例如点击、提交、支付、分享和页面切换。监控上报不要阻塞主流程，可以通过异步发送、批处理、采样和离线缓存来降低影响。

## 跨端框架选型

以小程序场景为例，选型时一般关注两点：框架依赖编译时还是运行时，以及支持哪些开发框架。具体选择还要结合目标平台、版本和团队技术栈。以下是 Taro 3+ 和 uni-app 的一个简单对比：

| 维度       | Taro 3+                            | uni-app                          |
| ---------- | ---------------------------------- | -------------------------------- |
| 架构       | 运行时适配                         | 编译时模板（增强）+ 轻量运行时   |
| DSL        | React / Vue / Solid 等             | Vue                              |
| 平台覆盖   | Web / RN / Harmony / 各类小程序    | Web / App / Harmony / 各类小程序 |
| 运行时开销 | 中（reconciler + 平台 runtime）    | 中低                             |
| 表达力     | 较完整                             | 中等（受模板编译能力限制）       |
| 包体积     | 初始较大，规模变大后固定模板更占优 | 中                               |
| 生态       | 主流、组件库完善                   | 工具链完善、社区大               |

uni-app 的架构也采用编译时模板转换：业务主要使用 Vue 写法，构建时再按目标平台生成对应的小程序、Web 或 App 产物。它的性能和包体积相对可控，工具链、插件市场和社区生态也比较完整；缺点是复杂动态结构仍会受模板编译限制。

## 总结

Taro 架构的核心变化，是从“重编译时、轻运行时”转向“轻编译时、重运行时”。编译阶段不再把组件结构转换成平台模板，而是交给运行时的框架、Taro DOM 和平台适配层协作完成。这样既能保留更完整的 React / Vue 表达能力，提升开发体验，也能更集中的管理跨端差异。
