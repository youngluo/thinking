---
createdAt: '2026-08-27 12:01'
draft: true
order: 7
---

# React Hook 的实现原理

当组件需要重新计算时，React 会重新执行函数组件。按普通函数理解，函数中的局部变量在执行结束后就会消失，但 `useState` 返回的状态却能保留。原因是状态由 React 为组件实例维护，组件函数只是按固定顺序读取这些状态。

`useState` 的行为可以从一个计数器看出来。点击按钮时，组件函数会再次执行，计数却不会回到初始值。理解这个现象，就能顺着它看到 Hook 的核心机制。

## 从一个真实运行的 useState 开始

下面的组件可以直接放进 React 项目中运行。它同时保存计数和步长，便于观察一次更新中多个 Hook 的对应关系。

```tsx fold title="Counter.tsx"
import type { ChangeEvent } from 'react'
import { useState } from 'react'

export const Counter = () => {
  const [count, setCount] = useState(0)
  const [step, setStep] = useState(1)

  const onIncrement = () => {
    setCount((current) => current + step)
  }

  const onStepChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setStep(Number(event.target.value))
  }

  return (
    <div>
      <p>count: {count}</p>
      <label>
        step:
        <select value={step} onChange={onStepChange}>
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={5}>5</option>
        </select>
      </label>
      <button type="button" onClick={onIncrement}>
        increment
      </button>
    </div>
  )
}

Counter.displayName = 'Counter'
```

点击 `increment` 后，从调用 `setCount` 到 UI 变化的过程可以抽象成下面这条路径。图中省略了具体的事件优先级和调度细节。

```d2
direction: right

click: 点击按钮
dispatch: setCount 产生更新
queue: 更新进入 Hook 队列
schedule: 调度当前 Fiber
render: 重新执行 Counter
state: 读取队列并计算 count
commit: Commit 阶段更新 UI

click -> dispatch -> queue -> schedule -> render -> state -> commit
```

这条路径可以拆成四步：

1. `onIncrement` 调用 `setCount`。这里传入的是 updater 函数，它会基于更新时的最新状态计算下一个值；
2. React 把这次更新记录到对应 `useState` 的更新队列，并安排当前组件所在的 Fiber 重新工作；
3. 下一次 Render 执行 `Counter`。第一次调用 `useState` 时，React 找到 `count` 对应的 Hook，读取它的队列并计算新值；第二次调用则读取 `step` 对应的 Hook；
4. Render 得到新的 UI 描述后，Commit 阶段再把变化提交到 DOM。

因此，调用 `setCount` 不会修改当前这次函数执行中的 `count` 变量。它影响的是下一次渲染时 `useState` 返回的值。

## 为什么组件重新执行后状态还在

从组件函数的角度看，它每次都会重新执行：

```tsx fold title="组件重新执行.tsx"
import { useState } from 'react'

const Counter = () => {
  const [count, setCount] = useState(0)

  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      {count}
    </button>
  )
}
```

如果 `count` 只是 `Counter` 函数内部的普通局部变量，那么函数重新执行后它确实会丢失。`useState` 的状态存放在 React 为这个组件实例维护的 Fiber 数据中，组件函数只负责在渲染期间读取它。

一次更新可以拆成四个时刻：

- 第一次渲染时，React 创建当前组件对应的状态记录，并把 `0` 存进去；
- 点击按钮时，`setCount` 找到这条状态记录，把更新放进它的队列；
- 下一次渲染时，React 从同一条状态记录中取出旧值，应用队列中的更新；
- React 把计算后的结果作为新的 `count` 返回给组件。

状态的持久性来自 React 管理的数据结构，而不是来自函数调用本身。

## 用 mini useState 还原核心机制

为了看清状态保存和调用顺序，可以先把运行时缩小到一个组件。这个示例使用数组保存状态槽位；在 `useState` 这类需要保存数据的场景中，React 会把对应的 Hook 节点挂在 Fiber 上，并通过链表连接起来，后文会解释两者的对应关系。

下面的 HTML 文件可以直接在浏览器中打开运行。它支持修改步长和累加计数。

```html fold title="mini-use-state.html"
<div id="root"></div>

<script type="module">
  const root = document.querySelector('#root')
  const hookStates = []
  let hookIndex = 0

  function getInitialState(initialState) {
    return typeof initialState === 'function' ? initialState() : initialState
  }

  function useState(initialState) {
    const index = hookIndex

    if (!(index in hookStates)) {
      hookStates[index] = {
        state: getInitialState(initialState),
        queue: [],
      }
    }

    const hook = hookStates[index]
    let nextState = hook.state

    for (const action of hook.queue) {
      nextState = typeof action === 'function' ? action(nextState) : action
    }

    hook.state = nextState
    hook.queue = []
    hookIndex += 1

    function setState(action) {
      hook.queue.push(action)
      render()
    }

    return [hook.state, setState]
  }

  function App() {
    const [count, setCount] = useState(0)
    const [step, setStep] = useState(1)

    const onIncrement = () => {
      setCount((current) => current + step)
    }

    const onStepChange = (event) => {
      setStep(Number(event.target.value))
    }

    return {
      html: `
        <p>count: ${count}</p>
        <label>
          step:
          <select data-action="step">
            <option value="1" ${step === 1 ? 'selected' : ''}>1</option>
            <option value="2" ${step === 2 ? 'selected' : ''}>2</option>
            <option value="5" ${step === 5 ? 'selected' : ''}>5</option>
          </select>
        </label>
        <button data-action="increment">increment</button>
      `,
      onIncrement,
      onStepChange,
    }
  }

  function render() {
    hookIndex = 0
    const view = App()
    root.innerHTML = view.html

    root.querySelector('[data-action="increment"]').addEventListener('click', view.onIncrement)

    root.querySelector('[data-action="step"]').addEventListener('change', view.onStepChange)
  }

  render()
</script>
```

这个实现包含了 Hook 能工作的几个关键点：

- `hookStates` 位于 `App` 函数之外，所以 `App` 重新执行时不会被重新初始化；
- `hookIndex` 在每次 Render 开始时归零，每调用一次 `useState` 就向后移动一个槽位；
- 第一次访问某个槽位时写入初始状态，后续访问时直接读取已有状态；
- `setState` 不直接重新执行 `App`，它先把 action 放进队列，再触发 `render`；
- `render` 会重新执行 `App`，`useState` 在本次执行中消费队列并得到新的状态。

例如第一次执行 `App` 时，两个 `useState` 分别对应槽位 `0` 和槽位 `1`：

```text fold title="Hook 槽位（示意）"
hookStates[0] -> count
hookStates[1] -> step
```

这里的数组只是为了突出「第几次调用对应第几个状态」的概念。React 需要支持多个组件实例、嵌套组件、并发渲染和更新优先级，因此生产实现使用了更完整的数据结构。

## React 如何把 Hook 挂到 Fiber 上

React 的公共 Hook API 会把调用转交给当前渲染上下文中的 dispatcher。下面是对真实实现的概念化表达：

```js fold title="ReactHooks.js（概念化）"
function useState(initialState) {
  const dispatcher = resolveDispatcher()

  return dispatcher.useState(initialState)
}
```

React 在执行函数组件前，会设置当前正在处理的 Fiber，并根据这是首次渲染还是更新渲染选择不同的 dispatcher。首次渲染使用 mount dispatcher，后续渲染使用 update dispatcher。

React 源码中的 [`renderWithHooks`](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberHooks.js) 会设置 `currentlyRenderingFiber`，清理本轮 Work-in-Progress 的 Hook 结果，然后执行组件函数。

在 `useState` 这类需要保存数据的场景中，React 会在函数组件对应的 Fiber 上维护一条 Hook 链表。链表的头节点通过 Fiber 的 `memoizedState` 保存，后续节点通过 `next` 连接：

```d2
direction: right

fiber: Counter Fiber
hook0: Hook 0（count）
hook1: Hook 1（step）

fiber -> hook0: memoizedState
hook0 -> hook1: next
```

Hook 节点的字段会随 Hook 类型和更新阶段承担不同职责，本文关注的 `useState` 主要涉及这些信息：

- `memoizedState`。对于 `useState` 来说是当前状态，不同 Hook 也可能在这里存放各自的值或对象；
- `baseState` 和 `baseQueue`。更新被跳过或需要重新应用时使用的基础状态和队列；
- `queue`。`useState` 或 `useReducer` 的待处理更新；
- `next`。指向同一个 Fiber 上的下一个 Hook 节点。

首次渲染和更新渲染的核心差异如下：

| 阶段   | Hook 的处理方式                                                                 |
| ------ | ------------------------------------------------------------------------------- |
| mount  | 创建 Hook 节点，初始化状态和更新队列，并追加到 Fiber 的 Hook 链表               |
| update | 按调用顺序找到对应的旧 Hook，复用或复制到 Work-in-Progress 链表，再处理更新队列 |

`mountWorkInProgressHook` 负责创建并追加新的 Hook 节点。`mountState` 在此基础上初始化状态队列，并把 `setState` 绑定到当前 Fiber 和这个队列。

更新时，`updateState` 会进入状态 reducer 的更新逻辑。`updateWorkInProgressHook` 根据当前 Hook 指针找到对应节点，然后依次处理队列中的 action，计算本次渲染需要的状态。

因此，mini 实现中的这几个变量可以和 React 源码做如下对应：

| mini 实现    | React 实现                          |
| ------------ | ----------------------------------- |
| `hookStates` | Fiber 的 `memoizedState` 链表       |
| `hookIndex`  | 当前 Hook 的遍历指针                |
| `hook.queue` | Hook 上的更新队列                   |
| `render()`   | 触发调度后重新进入 Render 和 Commit |

mini 实现把许多事情压缩成一个同步函数。React 还需要处理 Fiber 树、更新优先级、可中断 Render、批量更新以及不同的宿主环境。

## 为什么 Hook 必须按顺序调用

React 不会根据变量名查找状态。对于下面的组件，React 只知道本次执行遇到了两个 `useState`：

```tsx fold title="Hook 顺序示例.tsx"
import { useState } from 'react'

const Example = () => {
  const [name] = useState('React') // Hook 0
  const [count] = useState(0) // Hook 1

  return `${name}: ${count}`
}
```

下一次执行 `Example` 时，第一次 Hook 调用仍然读取 Hook 0，第二次 Hook 调用仍然读取 Hook 1。遍历指针每调用一次 Hook 就向后移动一次，这就是状态和调用位置之间的对应关系。

Hook API 没有要求调用者为每个状态传入名称或 ID。调用顺序因此成为 React 与组件之间约定的隐式标识，既不需要额外配置，也能让自定义 Hook 继续组合其它 Hook。

如果改变调用顺序，状态就会错位：

```tsx fold title="错误的 Hook 调用.tsx"
import { useState } from 'react'

const BrokenExample = ({ showName }: { showName: boolean }) => {
  if (showName) {
    useState('React')
  }

  const [count] = useState(0)

  return count
}
```

假设第一次渲染时 `showName` 为 `true`，那么 `count` 对应 Hook 1。下一次渲染时 `showName` 变成 `false`，`count` 就会变成第一次 Hook 调用，读取到原本属于 `name` 的状态。

所以 Hook 不能放在以下位置：

- 条件分支或三元表达式中；
- `for`、`while` 等循环中；
- 条件提前 return 之后；
- 事件处理函数、普通嵌套函数或 `try/catch` 中。

这些限制的共同原因是，组件每次渲染都必须以相同的顺序调用相同数量的 Hook。React 开发环境会记录 Hook 类型和顺序，发现前后不一致时给出错误或警告。详细规则见 React 官方的 [Rules of Hooks](https://react.dev/reference/rules/rules-of-hooks)。

## 自定义 Hook 如何复用逻辑

自定义 Hook 是一个可以调用其它 Hook 的函数，通常以 `use` 开头。下面把计数逻辑抽取成 `useCounter`：

```ts fold title="useCounter.ts"
import { useState } from 'react'

type UseCounterOptions = {
  initialValue?: number
  step?: number
}

export function useCounter(options: UseCounterOptions = {}) {
  const { initialValue = 0, step = 1 } = options
  const [count, setCount] = useState(initialValue)

  const increment = () => {
    setCount((current) => current + step)
  }

  return { count, increment }
}
```

调用 `useCounter` 不会创建独立的状态容器。它内部调用的 `useState` 仍然占用当前 `Counter` 对应的 Hook 链表位置：

```tsx fold title="Counter.tsx"
import { useState } from 'react'
import { useCounter } from './useCounter'

export const Counter = () => {
  const counter = useCounter({ step: 2 })
  const [label] = useState('total')

  return (
    <button type="button" onClick={counter.increment}>
      {label}: {counter.count}
    </button>
  )
}

Counter.displayName = 'Counter'
```

它的调用顺序是：

1. `Counter` 调用 `useCounter`；
2. `useCounter` 内部调用 `useState`，它占用当前组件的 Hook 0；
3. `Counter` 继续调用自己的 `useState`，它占用 Hook 1；
4. 下一次渲染仍按相同顺序执行，于是两个状态都能被正确读取。

自定义 Hook 复用的是状态逻辑，不会自动共享状态。下面两个组件分别调用 `useCounter` 时，它们拥有各自的 `count`：

```tsx fold title="独立的自定义 Hook 状态.tsx"
const FirstCounter = () => {
  const { count } = useCounter()

  return <p>first: {count}</p>
}

const SecondCounter = () => {
  const { count } = useCounter()

  return <p>second: {count}</p>
}
```

每个组件实例都有自己的 Fiber 和 Hook 链表，因此 `FirstCounter` 和 `SecondCounter` 的状态互不影响。同一个组件中多次调用 `useCounter` 也会按调用位置创建多份独立状态。

如果多个组件需要共享同一份状态，应提升状态到共同父组件，或使用 Context、外部 store 等共享机制。自定义 Hook 本身不会把状态自动变成全局状态。React 官方在[复用逻辑与自定义 Hook](https://react.dev/learn/reusing-logic-with-custom-hooks)中也强调了这一点。

## 这个模型省略了什么

上面的 mini 实现只用于解释核心关系，和 React 生产实现还有这些差异：

- 它只有一个组件和一个全局状态数组，没有 Fiber 树和多个组件实例；
- 它把状态更新立即同步到下一次 `render`，没有更新优先级、Lane、批量更新和可中断 Render；
- 它没有区分 `current` 和 Work-in-Progress 两棵 Fiber 树；
- 它没有处理 `useEffect`、`useRef`、`useMemo` 等不同 Hook 的专用数据结构；
- 它没有实现 Strict Mode 下的开发检查和错误恢复。

这些机制会让 React 的实现更复杂，但不会改变 Hook 原理的主线：当前组件在渲染时按稳定顺序读取自己的 Hook 数据，状态更新则通过对应的队列触发新的 Render。

## 总结

- 函数组件每次渲染都会重新执行，状态由 React 挂在组件 Fiber 上的 Hook 数据保存；
- `setState` 会把更新放进对应 Hook 的队列，并触发当前组件重新渲染；
- React 通过 Hook 的调用顺序定位状态，所以 Hook 不能放在条件、循环或提前 return 之后；
- mini 实现可以用数组表达状态槽位，React 生产实现使用 Fiber 上的 Hook 链表；
- 自定义 Hook 复用的是有状态逻辑，每次调用和每个组件实例仍然拥有独立状态。

## 参考资料

- [useState API](https://react.dev/reference/react/useState)；
- [Rules of Hooks](https://react.dev/reference/rules-of-hooks)；
- [复用逻辑与自定义 Hook](https://react.dev/learn/reusing-logic-with-custom-hooks)；
- [ReactFiberHooks.js](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberHooks.js)。
