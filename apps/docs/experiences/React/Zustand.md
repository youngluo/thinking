---
createdAt: '2026-05-26 20:47'
---

# Zustand 指南

Zustand 是一个非常轻量的 React 状态管理库。它最吸引人的地方，不是功能特别多，而是它把全局状态这件事压到了一个很低的心智负担上：

- 没有 `Provider` 套娃
- 没有 `reducer + action type` 的样板代码
- 默认就支持按需订阅，组件只关心自己读的那部分状态

如果用一句话概括我的理解：Zustand 解决的是“我需要一份跨组件共享的客户端状态，但不想为了它引入一整套重量级约束”。

这也决定了它特别适合两类人：

- 已经在用 React，但不想把状态提升、Context、props drilling 越写越乱的人
- 用过 Redux，但很多页面其实没复杂到必须引入完整 Redux 工作流的人

## Zustand 解决什么问题

React 自身已经能管理组件状态，但一旦状态开始跨组件共享，常见方案会逐渐暴露出不同问题：

- props drilling：状态一路往下传，组件边界会被共享状态污染
- Context：适合传递配置和低频变化数据，但如果把频繁变更的大对象直接塞进去，订阅粒度往往太粗
- Redux：约束强、生态成熟，但在中小型业务里容易显得过重

Zustand 的核心思路很直接：

- 用一个 store 存放共享状态
- 组件通过 selector 订阅 store 的一部分
- 状态变化后，只让真正依赖这部分状态的组件更新

所以它本质上不是“替代 React 状态”，而是在 React 之外补一层“共享状态容器”。

## 适合与不适合的场景

适合：

- 用户信息、权限、主题、购物车、播放器状态这类跨组件共享的客户端状态
- 表单草稿、多步骤流程、列表筛选条件、弹窗系统这类页面级或应用级状态
- 需要在 React 组件外也能读写状态的场景，比如事件总线、埋点、WebSocket 回调

不太适合：

- 服务端状态缓存，比如接口数据的缓存、失效、重试、后台刷新
- 极度强调流程可追溯、强约束、统一规范的大型复杂协作项目
- 需要把状态建模成细粒度依赖图，并通过原子组合表达依赖关系的场景

一句话区分：

- Zustand 更偏客户端共享状态
- Redux 更偏强约束的数据流管理
- Jotai 更偏细粒度原子状态建模

## 基本使用

### 创建一个 store

最常见的入口是 `create`。你可以把它理解成“创建一个带订阅能力的状态容器”。

```ts
import { create } from 'zustand'

type CounterStore = {
  count: number
  inc: () => void
  dec: () => void
  reset: () => void
}

export const useCounterStore = create<CounterStore>((set) => ({
  count: 0,
  inc: () => set((state) => ({ count: state.count + 1 })),
  dec: () => set((state) => ({ count: state.count - 1 })),
  reset: () => set({ count: 0 }),
}))
```

这里有两个点值得注意：

- store 里既可以放状态，也可以放更新状态的 action
- `set` 支持直接传对象，也支持传函数式更新

### 在组件中读取状态

组件通过 selector 读取自己需要的状态：

```tsx
function Count() {
  const count = useCounterStore((state) => state.count)

  return <span>{count}</span>
}
```

读取 action 也是一样：

```tsx
function CounterActions() {
  const inc = useCounterStore((state) => state.inc)
  const dec = useCounterStore((state) => state.dec)

  return (
    <>
      <button onClick={dec}>-</button>
      <button onClick={inc}>+</button>
    </>
  )
}
```

这种写法的关键收益是：`Count` 只订阅 `count`，`CounterActions` 只订阅对应的 action。谁依赖什么，谁就为谁更新。

### 异步 action

Zustand 不要求你把异步逻辑单独拆到 thunk、saga 一类中间层。异步 action 直接写在 store 里即可。

```ts
type User = {
  id: string
  name: string
}

type UserStore = {
  user: User | null
  loading: boolean
  error: string | null
  fetchUser: (id: string) => Promise<void>
}

export const useUserStore = create<UserStore>((set) => ({
  user: null,
  loading: false,
  error: null,
  fetchUser: async (id) => {
    set({ loading: true, error: null })

    try {
      const response = await fetch(`/api/users/${id}`)
      const user = (await response.json()) as User
      set({ user, loading: false })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'fetch user failed',
      })
    }
  },
}))
```

这很符合很多前端项目的直觉：状态和状态变更逻辑放在一起，读代码时不需要在多个文件之间跳来跳去。

### 在 React 组件外访问 store

这是 Zustand 很实用的一点。store 不只给组件用，也可以在组件外读写：

```ts
const user = useUserStore.getState().user

useUserStore.setState({ loading: true })

const unsubscribe = useUserStore.subscribe((state) => {
  console.log('user changed:', state.user)
})

unsubscribe()
```

这类能力在下面这些场景里很方便：

- 请求拦截器里更新登录态
- WebSocket 消息回调里同步状态
- React 组件外的埋点、轮询、播放器控制逻辑

## API 介绍

前面先跑通了基本用法，下面把几个最常用的 API 单独拆开补充一下。

### create

`create` 用来创建 store hook。它接收一个初始化函数，这个函数常见入参有三个：

- `set`：更新状态
- `get`：读取当前状态
- `store`：底层 store 实例，较少直接用

常见写法：

```ts
const useTodoStore = create<TodoStore>((set, get) => ({
  todos: [],
  addTodo: (title) => {
    const nextTodo = { id: crypto.randomUUID(), title, done: false }
    set({ todos: [...get().todos, nextTodo] })
  },
}))
```

### set

`set` 用于更新状态，常见有两种写法：

```ts
set({ count: 1 })

set((state) => ({ count: state.count + 1 }))
```

什么时候用哪种？

- 已知目标值，直接传对象
- 新状态依赖旧状态，优先用函数式更新

`set(partial, replace?)` 的第二个参数可以控制是否整份替换状态。默认是浅合并，只有在你明确要整体替换时才考虑 `replace: true`。

### get

`get` 用于在 action 内读取最新状态：

```ts
toggleTodo: (id) => {
  const todos = get().todos
  set({
    todos: todos.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo)),
  })
}
```

它的价值是避免 action 之间相互传参过多，也能让一些依赖当前状态的逻辑更自然地写在 store 内部。

### subscribe

`subscribe` 可以在组件外监听状态变化：

```ts
const unsubscribe = useTodoStore.subscribe((state) => {
  console.log(state.todos.length)
})
```

如果你只是想驱动某些副作用，而不是让 React 组件参与渲染，这种订阅往往比“再套一层组件状态”更直接。

如果你只想监听某一部分状态，而不是整份 state 的变化，可以再配合
`subscribeWithSelector`。它允许你按 selector 订阅局部状态，这在下面这些场景很有用：

- 只监听某个字段变化
- 做精细化副作用
- 避免整份状态变化都触发外部回调

```ts
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

type PlayerStore = {
  progress: number
  playing: boolean
  setProgress: (progress: number) => void
  setPlaying: (playing: boolean) => void
}

export const usePlayerStore = create<PlayerStore>()(
  subscribeWithSelector((set) => ({
    progress: 0,
    playing: false,
    setProgress: (progress) => set({ progress }),
    setPlaying: (playing) => set({ playing }),
  }))
)

const unsubscribe = usePlayerStore.subscribe(
  (state) => state.playing,
  (playing, prevPlaying) => {
    console.log('playing changed:', prevPlaying, '->', playing)
  }
)

unsubscribe()
```

这个写法的重点不是“订阅更高级”，而是“只在 `playing` 变化时触发回调”，不会因为
`progress` 连续变化就反复执行这段副作用。

### useShallow

当 selector 返回对象或数组时，如果每次都创建新引用，组件可能会重复渲染。`useShallow` 用来做浅比较：

```tsx
import { useShallow } from 'zustand/react/shallow'

function Toolbar() {
  const { keyword, setKeyword, reset } = useSearchStore(
    useShallow((state) => ({
      keyword: state.keyword,
      setKeyword: state.setKeyword,
      reset: state.reset,
    }))
  )

  return (
    <>
      <input value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      <button onClick={reset}>reset</button>
    </>
  )
}
```

它的作用不是“让组件不更新”，而是让“字段没变但引用变了”的情况不至于触发无意义更新。

### 常见中间件

Zustand 常用能力很多是通过中间件扩展出来的。

#### persist

把 store 持久化到 `localStorage`、`sessionStorage` 或自定义存储。

常见场景：

- 登录信息
- 主题配置
- 搜索筛选项
- 草稿数据

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type PreferenceStore = {
  theme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark') => void
}

export const usePreferenceStore = create<PreferenceStore>()(
  persist(
    (set) => ({
      theme: 'light',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'preference-store',
    }
  )
)
```

#### devtools

把状态变化接到 Redux DevTools，方便开发期查看状态变更。

```ts
import { devtools } from 'zustand/middleware'

const useCounterStore = create<CounterStore>()(
  devtools((set) => ({
    count: 0,
    inc: () => set((state) => ({ count: state.count + 1 }), false, 'counter/inc'),
  }))
)
```

如果团队里有人习惯了 Redux 的可追踪调试体验，`devtools` 会明显降低迁移阻力。

#### immer

如果状态嵌套较深，手写不可变更新会比较啰嗦，可以结合 `immer` 简化更新逻辑。

```ts
import { immer } from 'zustand/middleware/immer'

type FormStore = {
  profile: {
    name: string
    address: {
      city: string
    }
  }
  setCity: (city: string) => void
}

export const useFormStore = create<FormStore>()(
  immer((set) => ({
    profile: {
      name: '',
      address: { city: '' },
    },
    setCity: (city) =>
      set((state) => {
        state.profile.address.city = city
      }),
  }))
)
```

## 工程实践

Zustand 默认就比“大对象 Context 全量下发”更容易获得更细的更新粒度，但这不代表用了它就自动没有性能问题。

真正影响项目体验的，通常有两类问题：

- 渲染层面：怎么减少不必要更新
- 架构层面：怎么划清状态职责边界

下面分开说。

### 渲染与性能

#### 1. 尽量用 selector，而不是整份 state

不推荐：

```tsx
const state = useUserStore()
```

推荐：

```tsx
const user = useUserStore((state) => state.user)
const loading = useUserStore((state) => state.loading)
```

原因很简单：订阅范围越大，更新波及面越大。

#### 2. 避免 selector 每次都返回新对象

下面这种写法很常见，但要小心：

```tsx
const { user, loading } = useUserStore((state) => ({
  user: state.user,
  loading: state.loading,
}))
```

因为它每次都会创建一个新对象。如果没有比较策略，组件可能会重复渲染。

可以改成两种方式：

- 分开订阅
- 用 `useShallow`

#### 3. 高频更新状态要单独考虑

像拖拽坐标、滚动位置、播放进度、鼠标移动这种高频变化状态，要特别谨慎。

这类状态如果直接驱动大量 React 组件更新，瓶颈通常不在 Zustand，而在 React 渲染本身。

常见优化方式：

- 只让真正需要显示的组件订阅
- 把高频值放到更靠近使用点的局部状态
- 对组件外逻辑使用 `subscribe`
- 必要时用节流、批处理或 `requestAnimationFrame`

#### 4. 区分“需要渲染”和“只需要响应”

这是很容易被忽略的一点。

如果某个状态变化只是为了触发副作用，比如：

- 刷新埋点上下文
- 同步播放器实例
- 通知外部 SDK

那你不一定需要让 React 组件重新渲染。很多时候直接 `subscribe` 更合适。

### 状态组织与边界

#### 1. 按业务领域拆分 store

不要一上来就做一个 `useAppStore` 把全站状态都装进去。

更好的思路是按业务边界拆分：

- 认证相关一个 store
- 搜索条件一个 store
- 购物车一个 store
- 编辑器状态一个 store

这样做的收益是：

- 职责清晰
- 依赖更收敛
- 测试更简单
- 后续迁移或重构成本更低

#### 2. 把 action 放进 store，保持读写入口稳定

不建议在组件里到处 `setState` 式地拼更新逻辑。

推荐把核心更新动作统一收敛成 action，比如：

- `login`
- `logout`
- `setKeyword`
- `toggleTodo`

这样组件只表达“我要做什么”，而不是“我要怎么改那堆字段”。

#### 3. 不要把服务端状态硬塞进 Zustand

这是 Zustand 在项目里最常见的误用之一。

接口数据的核心问题通常不是“共享”，而是：

- 缓存
- 去重
- 重试
- 失效
- 后台刷新
- 乐观更新

这些都不是 Zustand 的长项，更适合交给专门的数据请求和缓存层处理。

一个更稳妥的分工是：

- 数据请求和缓存层管接口数据
- Zustand 管客户端共享状态

例如：

- 商品列表数据留在接口缓存层
- 列表的筛选面板展开状态、排序方式、当前选中项用 Zustand

#### 4. 不要把所有临时 UI 状态都提升为全局状态

有些状态天然就应该留在组件内部：

- 输入框 hover
- 弹层是否展开且只影响当前组件
- 本地表单即时输入

全局状态不是越多越好。状态提升本身就是耦合，只有确实需要跨组件共享时再放进 store。

#### 5. 给 TypeScript 一个清晰的状态边界

推荐把 `state` 和 `actions` 都显式建模：

```ts
type SearchState = {
  keyword: string
  page: number
}

type SearchActions = {
  setKeyword: (keyword: string) => void
  setPage: (page: number) => void
  reset: () => void
}

type SearchStore = SearchState & SearchActions
```

这种拆法的好处是：

- 类型职责清晰
- 后续做 slice 拆分更自然
- 更适合多人协作

#### 6. 从一开始就约定 store 的职责边界

比“选哪个库”更重要的，是团队内部有没有共识：

- 哪些状态能进 store
- 哪些状态必须留在组件内
- 服务端数据是否统一交给专门的数据请求和缓存层
- 持久化策略怎么做
- action 命名怎么保持一致

如果这些边界不统一，再轻量的库也会慢慢失控。

## 横向对比

单看 Zustand，它最突出的特点其实是“轻”。但状态管理工具是否合适，最终还是要放回具体场景里判断。简单说就是共享客户端状态选 Zustand；需要强约束和可追踪性选 Redux；想拆成细粒度原子选 Jotai。

### 一张表快速看差异

| 维度       | Zustand           | Redux                    | Jotai          |
| ---------- | ----------------- | ------------------------ | -------------- |
| 核心定位   | 客户端共享状态    | 强约束全局状态管理       | 原子化状态管理 |
| 心智负担   | 低                | 中到高                   | 中             |
| 建模方式   | store + selector  | reducer/slice + dispatch | atom 组合      |
| 适合内容   | UI 与业务共享状态 | 复杂流程与强规范协作     | 细粒度依赖状态 |
| 调试追踪   | 中                | 强                       | 中             |
| 最常见误用 | 塞服务端数据      | 为简单场景引入过重方案   | 过度原子化     |

## 最后的建议

如果你现在主要碰到的问题是：

- 多个组件要共享状态
- Context 开始变重
- Redux 又显得太重

那 Zustand 很值得用，而且通常能很快见效。

但也要记住它的边界：

- 它不是所有状态问题的统一答案
- 它不擅长替代服务端缓存层
- 它的“轻”很大程度建立在团队能自觉维护状态职责之上

我的实际建议是：

- 用 Zustand 管客户端共享状态
- 服务端状态交给专门的数据请求和缓存层
- 真正需要强约束和高可追踪性时，再考虑 Redux
- 如果状态依赖关系特别细且可组合性要求高，再看 Jotai

大多数 React 项目里，这样分工通常比“押宝一个库解决所有状态问题”更稳。
