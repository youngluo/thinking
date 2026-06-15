---
createdAt: '2026-06-04 12:00'
---

# React Reconcile

协调阶段负责比较 `current Fiber` 和本轮渲染得到的 `nextChildren`，生成 `workInProgress Fiber`。入口在渲染阶段的 [beginWork](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberBeginWork.js#L341)。

```js fold title="react-reconciler/src/ReactFiberBeginWork.js"
export function reconcileChildren(
  current: Fiber | null,
  workInProgress: Fiber,
  nextChildren: any,
  renderLanes: Lanes,
) {
  if (current === null) {
    workInProgress.child = mountChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderLanes,
    );
  } else {
    // 对比 current Fiber 的子元素和 nextChildren，生成 workInProgress 的子元素
    workInProgress.child = reconcileChildFibers(
      workInProgress,
      current.child,
      nextChildren,
      renderLanes,
    );
  }
}
```

`reconcileChildFibers` 是包装后的协调入口，实际逻辑在 [reconcileChildFibersImpl](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactChildFiber.js#L1849) 中。

```js fold title="react-reconciler/src/ReactChildFiber.js"
/**
 * 协调过程会给子节点打上副作用标记，在遍历子节点和父节点时，这些副作用会被加入副作用链表
 * 只会在 Usables/Lazy 上递归，不会对嵌套数组递归
 */
function reconcileChildFibersImpl(
  returnFiber: Fiber,
  currentFirstChild: Fiber | null,
  newChild: any,
  lanes: Lanes,
): Fiber | null {
  //...
  // 如果是对象，则说明是单一节点
  if (typeof newChild === 'object' && newChild !== null) {
    switch (newChild.$$typeof) {
      case REACT_ELEMENT_TYPE: {
        return placeSingleChild(
          reconcileSingleElement(
            returnFiber,
            currentFirstChild,
            newChild,
            lanes,
          ),
        );
      }
      case REACT_PORTAL_TYPE:
        return placeSingleChild(
          reconcileSinglePortal(
            returnFiber,
            currentFirstChild,
            newChild,
            lanes,
          ),
        );
      case REACT_LAZY_TYPE: {
        const result = resolveLazy((newChild));
        return reconcileChildFibersImpl(
          returnFiber,
          currentFirstChild,
          result,
          lanes,
        );
      }
    }
  }

  // 文本等节点也是单一节点
  if (
    (typeof newChild === 'string' && newChild !== '') ||
    typeof newChild === 'number' ||
    typeof newChild === 'bigint'
  ) {
    //...
  }

  // 多节点 Diff
  if (isArray(newChild)) {
    return reconcileChildrenArray(
      returnFiber,
      currentFirstChild,
      newChild,
      lanes,
    );
  }

  // ...
  // 将其它类型的 Fiber 及其兄弟 Fiber 标记为删除
  return deleteRemainingChildren(returnFiber, currentFirstChild);
}
```

## 单节点 diff

单节点 diff 在 [reconcileSingleElement](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactChildFiber.js#L1698) 中完成，`reconcileSinglePortal` 逻辑类似：

1. 当 `key` 不同时，将 Fiber 标记为删除，继续遍历兄弟节点寻找可复用节点；
2. 如果没有找到可复用节点，则创建新的 Fiber；
3. 如果 `key` 和 `type` 都相同，复用 `oldFiber`，删除多余的兄弟节点并更新 `props`；
4. 如果 `key` 相同但 `type` 不同，删除 `oldFiber` 及其兄弟节点，创建新的 Fiber。

```js fold title="react-reconciler/src/ReactChildFiber.js"
function reconcileSingleElement(
  returnFiber: Fiber,
  currentFirstChild: Fiber | null,
  element: ReactElement,
  lanes: Lanes,
): Fiber {
  const key = element.key;
  let child = currentFirstChild;
  while (child !== null) {
    // 比较 key 是否相同（包括都为 null 的情况）
    if (child.key === key) {
      // ...
      // 比较类型是否相同
      if (child.elementType === element.type) {
        // key 相同，类型相同，可直接复用该 Fiber，将其多余的兄弟节点标记为删除
        deleteRemainingChildren(returnFiber, child.sibling);
        // 更新 props
        const existing = useFiber(child, element.props);
        // ...
        // 直接返回复用 Fiber
        return existing;
      }
      // key 相同，但 type 不同，说明该节点已改变类型，将该 Fiber 及其兄弟 Fiber 标记为删除，跳出循环，生成新的 Fiber
      deleteRemainingChildren(returnFiber, child);
      break;
    } else {
      // 当 key 不同时直接将该 Fiber 标记为删除
      deleteChild(returnFiber, child);
    }
    // 继续尝试比较其兄弟节点，看能否找到 key 相同的节点（例如更新前是多个节点，更新后只有其中一个节点）
    child = child.sibling;
  }
  // ...
  // 没有旧节点，根据 JSX 内容生成新的 Fiber
  const created = createFiberFromElement(element, returnFiber.mode, lanes);
  // ...
  // 子 Fiber 指向父级
  created.return = returnFiber;
  return created;
}
```

## 多节点 diff

多节点 diff 在 [reconcileChildrenArray](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactChildFiber.js#L1175) 中完成：

1. 如果 `key` 和 `type` 都相同，复用 Fiber；如果 `type` 不同，创建新的 Fiber，并将 `oldFiber` 标记为删除；更新 `lastPlacedIndex`（第一部分遍历）；
2. 如果 `key` 不同，跳出第一部分遍历；
3. 如果 `newChildren` 先遍历完成，说明更新后节点变少，将剩余的 `oldFiber` 标记为删除；如果新旧节点同时遍历完成，diff 结束；
4. 如果 `oldFiber` 先遍历完成，说明更新后节点变多，将新增节点创建为 Fiber 并标记为插入；更新 `lastPlacedIndex`（第二部分遍历）；
5. 如果新旧节点都还没遍历完，先将剩余的 `oldFiber` 及其兄弟节点存入 `Map`：以 `oldFiber.key === null ? oldFiber.index : oldFiber.key` 为 key, `oldFiber` 为 value；
6. 继续遍历 `newChildren`，在 `Map` 中查找候选旧 Fiber，再比较 `type` 判断能否复用；复用成功后从 `Map` 中删除它，并更新 `lastPlacedIndex`（第三部分遍历）；
7. 将 `Map` 中剩余的 Fiber 标记为删除。

```js fold title="react-reconciler/src/ReactChildFiber.js"
/**
 * 此算法不能通过双指针进行两端搜索优化，因为 current Fiber 是通过 sibling 指针形成的单链表，没有 back pointer
 */
function reconcileChildrenArray(
  returnFiber: Fiber,
  currentFirstChild: Fiber | null,
  newChildren: Array<any>,
  lanes: Lanes,
): Fiber | null {
  // 保存最终的 newFiber
  let resultingFirstChild: Fiber | null = null;
  let previousNewFiber: Fiber | null = null;
  let oldFiber = currentFirstChild;
  // 上一个插入点（实际上保存的是 oldFiber.index）
  let lastPlacedIndex = 0;
  let newIdx = 0;
  let nextOldFiber = null;
  // 第一部分遍历
  for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
    // 说明位置已经改变过，将跳出本循环，直接走到第三部分遍历
    if (oldFiber.index > newIdx) {
      // ...
    } else {
      nextOldFiber = oldFiber.sibling;
    }
    // 如果 key 不相同，直接返回 null，跳出循环走到第二部分遍历
    // 如果 key 相同，类型相同，则复用旧节点，否则创建新节点
    const newFiber = updateSlot(
      returnFiber,
      oldFiber,
      newChildren[newIdx],
      lanes,
    );
    // 如果 key 不相同跳出循环
    if (newFiber === null) {
      // ...
      break;
    }
    if (shouldTrackSideEffects) {
      // newFiber.alternate === null 说明是新创建的节点，即此时 key 相同，类型不同，需将 oldFiber 标记为删除
      if (oldFiber && newFiber.alternate === null) {
        deleteChild(returnFiber, oldFiber);
      }
    }
    // 更新 lastPlacedIndex
    lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
    if (previousNewFiber === null) {
      resultingFirstChild = newFiber;
    } else {
      // 将 newFiber 串联成新的链表
      previousNewFiber.sibling = newFiber;
    }
    previousNewFiber = newFiber;
    oldFiber = nextOldFiber;
  }

  // newChildren 遍历完成
  if (newIdx === newChildren.length) {
    // 如果有多余的节点，说明新节点变少了，需要将多余的节点标记为删除，再返回 newFiber
    deleteRemainingChildren(returnFiber, oldFiber);
    return resultingFirstChild;
  }

  // newChildren 未遍历完成，oldFiber 遍历完成，说明新节点数量增多了，需要将多余的节点生成 workInProgress Fiber，并标记为插入，再返回新节点
  if (oldFiber === null) {
    // 第二部分遍历
    for (; newIdx < newChildren.length; newIdx++) {
      const newFiber = createChild(returnFiber, newChildren[newIdx], lanes);
      if (newFiber === null) {
        continue;
      }
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
      // ...
    }
    return resultingFirstChild;
  }

  // 如果 newChildren 和 oldFiber 都没有遍历完，需要将 oldFiber 节点及其兄弟节点
  // 以 oldFiber.key === null ? oldFiber.index : oldFiber.key 为 key, oldFiber 为 value，生成一个 Map 对象，方便快速查找
  const existingChildren = mapRemainingChildren(returnFiber, oldFiber);

  // 继续遍历 newChildren（第三部分遍历）
  for (; newIdx < newChildren.length; newIdx++) {
    const newFiber = updateFromMap(
      existingChildren,
      returnFiber,
      newIdx,
      newChildren[newIdx],
      lanes,
    );
    if (newFiber !== null) {
      if (shouldTrackSideEffects) {
        // 说明存在复用 oldFiber，需要将其在 Map 中移除，保证后续不会把它标记为删除
        if (newFiber.alternate !== null) {
          existingChildren.delete(
            newFiber.key === null ? newIdx : newFiber.key,
          );
        }
      }
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
      // ...
    }
  }

  //...
  if (shouldTrackSideEffects) {
    // 剩余的节点都需要标记为删除
    existingChildren.forEach(child => deleteChild(returnFiber, child));
  }

  return resultingFirstChild;
}
```

### 标记节点移动

多节点 diff 使用 [placeChild](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactChildFiber.js#L511) 判断节点是否需要移动，并更新 `lastPlacedIndex`。

```js fold title="react-reconciler/src/ReactChildFiber.js"
function placeChild(
  newFiber: Fiber,
  lastPlacedIndex: number,
  newIndex: number,
): number {
  newFiber.index = newIndex;
  // ...
  const current = newFiber.alternate;
  // 说明是复用 oldFiber  ==> 此时是 key 相同，type 相同
  if (current !== null) {
    const oldIndex = current.index;
    // 如果 oldFiber.index 小于 lastPlacedIndex，说明该节点在旧列表中的位置比当前已处理的节点靠前，现在需要移动到后面，lastPlacedIndex 不变
    if (oldIndex < lastPlacedIndex) {
      newFiber.flags = Placement;
      return lastPlacedIndex;
    } else {
      // 如果旧节点 index 大于等于 lastPlacedIndex，说明相对位置没变，不需要移动，lastPlacedIndex = oldIndex
      return oldIndex;
    }
  } else {
    // 说明是新创建的 Fiber，不需要移动处理
    newFiber.flags = Placement;
    return lastPlacedIndex;
  }
}
```

### 示例演示

看一个列表重排的例子：

```text
旧列表: [A, B, C, D]
新列表: [A, C, B, D]
```

1. **第一阶段（顺序对比）**
   - A 匹配，`lastPlacedIndex = 0`
   - B 与 C 不匹配，中断

2. **第二阶段（Map 查找）**

   将剩余旧节点 `[B, C, D]` 存入 Map。
   - 处理新节点 C：从 Map 找到 C（`oldIndex = 2`），`2 > 0`，不移动，`lastPlacedIndex = 2`
   - 处理新节点 B：从 Map 找到 B（`oldIndex = 1`），`1 < 2`，标记移动，`lastPlacedIndex = 2`
   - 处理新节点 D：从 Map 找到 D（`oldIndex = 3`），`3 > 2`，不移动，`lastPlacedIndex = 3`

3. **Commit 阶段**
   - React 检测到 B 有 `Placement` 标记
   - 调用 `commitPlacement`，将 B 移到 D 之前

### Placement 如何移动 DOM

`Placement` 只表示 Fiber 对应的 DOM 需要插入或移动，并不记录目标位置。目标顺序由新的 Fiber 链表决定；旧列表只用于判断能否复用，以及是否需要打标记。`reconcileChildrenArray` 每处理一个新节点，就通过 `previousNewFiber.sibling = newFiber` 把它串到新链表里。

以 `[A, C, B, D]` 为例：

- A：复用（oldIndex=0），无 flags，`resultingFirstChild = A`
- C：复用（oldIndex=2），无 flags，`A.sibling = C`
- B：复用（oldIndex=1），标 `Placement`，`C.sibling = B`
- D：复用（oldIndex=3），无 flags，`B.sibling = D`

最终 Fiber 链表是 `A → C → B → D`。`Placement` 只附加在 B 上，不影响 sibling 链接顺序。

commit 阶段根据新 Fiber tree 的 sibling 关系找锚点。最简单的情况是所有节点都是 host 节点，本身持有 `stateNode`，可以直接定位 DOM。

整体流程可以概括为：

```d2
direction: down

placement: Placement 标记节点
commit: commitPlacement
parent: 查找父节点 hostParentFiber
sibling: getHostSibling
walk: 向后查找可用 host sibling
skip: 跳过带 Placement 的节点
stable: 找到稳定兄弟节点
hasBefore: 有参考节点? {
  shape: diamond
  class: decision
}
insert: insertBefore
append: appendChild
done: DOM 插入完成 {
  class: ok
}

placement -> commit -> parent -> sibling -> walk -> skip -> stable -> hasBefore
hasBefore -> insert: 是
hasBefore -> append: 否
insert -> done
append -> done
```

示例中新 Fiber tree：

```text
parent
  ├─ A (index=0, 无 flags)
  ├─ C (index=1, 无 flags)
  ├─ B (index=2, Placement)
  └─ D (index=3, 无 flags)
```

B 的 sibling 是 D（无 Placement），`getHostSibling` 返回 D 的 DOM，`commitPlacement` 把 B 插到 D 之前：

```js fold title="react-reconciler/src/ReactFiberCommitHostEffects.js（简化）"
function commitPlacement(finishedWork: Fiber): void {
  // 1. 向上找到最近的 host parent：
  let hostParentFiber;
  let parentFiber = finishedWork.return;
  while (parentFiber !== null) {
    if (isHostParent(parentFiber)) {
      hostParentFiber = parentFiber;
      break;
    }
    parentFiber = parentFiber.return;
  }

  // 2. 根据 parent 类型选择插入到普通 DOM 节点还是 container
  switch (hostParentFiber.tag) {
    case HostComponent: {
      const parent = hostParentFiber.stateNode;
      const before = getHostSibling(finishedWork);
      insertOrAppendPlacementNode(finishedWork, before, parent, null);
      break;
    }
    case HostRoot:
    case HostPortal: {
      const parent = hostParentFiber.stateNode.containerInfo;
      const before = getHostSibling(finishedWork);
      insertOrAppendPlacementNodeIntoContainer(finishedWork, before, parent, null);
      break;
    }
  }
}

function getHostSibling(fiber: Fiber): Instance | null {
  let node: Fiber = fiber;

  siblings: while (true) {
    while (node.sibling === null) {
      if (node.return === null || isHostParent(node.return)) {
        return null;
      }
      node = node.return;
    }

    node.sibling.return = node.return;
    node = node.sibling;

    while (node.tag !== HostComponent && node.tag !== HostText) {
      if (node.flags & Placement) {
        continue siblings;
      }
      if (node.child === null) {
        continue siblings;
      }
      node.child.return = node;
      node = node.child;
    }

    if (!(node.flags & Placement)) {
      return node.stateNode;
    }
  }
}
```

新顺序中 B 位于 C 和 D 之间：C、D 没有 `Placement` 标记，DOM 不动；B 被插到 D 之前。若 B 是最后一个节点，没有 sibling，则用 `appendChild` 追加到父节点末尾。

React 没有为每个 Fiber 维护“在父节点中的动态 index”，而是依赖新 Fiber tree 中的下一个可用 host sibling 来定位。

#### 非 host 节点场景

列表项通常会被组件包一层：

```jsx
<ul>
  {items.map((item) => (
    <ListItem key={item.id} value={item.value} />
  ))}
</ul>
```

`<ul>` 的 children 是 `ListItem` Fiber（FunctionComponent），没有 `stateNode`。`placeChild` 仍会给它打 `Placement`，但 DOM 操作需要递归到真实 host 节点。

```js fold title="react-reconciler/src/ReactFiberCommitHostEffects.js（简化）"
function insertOrAppendPlacementNode(node, before, parent, parentFragmentInstances) {
  if (node.tag === HostComponent || node.tag === HostText) {
    const stateNode = node.stateNode
    if (before) {
      insertBefore(parent, stateNode, before)
    } else {
      appendChild(parent, stateNode)
    }
    return
  }

  const child = node.child
  if (child !== null) {
    insertOrAppendPlacementNode(child, before, parent, parentFragmentInstances)
    let sibling = child.sibling
    while (sibling !== null) {
      insertOrAppendPlacementNode(sibling, before, parent, parentFragmentInstances)
      sibling = sibling.sibling
    }
  }
}
```

新链表 `A → C → B → D`（均为 ListItem），B 标 `Placement`：

1. `getHostSibling(B)`：从 B 的 sibling D 开始，D 不是 host → 沿 D 的 child 找到 `<li>` DOM。
2. `insertOrAppendPlacementNode(B, before=<li>, parent=<ul>)`：B 不是 host → 沿 B.child 找到 `<li>`，执行 `ul.insertBefore(<li>, before)`。

最终 DOM 顺序仍是 `A → C → B → D`。组件层级越深，递归路径越长，但这通常不是列表重排的主要瓶颈；真正需要警惕的是 key 错位、子节点结构变化等不稳定因素，它们会触发更多 `Placement`，也更需要稳定的 key 和 `React.memo` 来收敛更新范围。

### 为什么节点移动总是向右的

这里说的“向右移动”，指的是 React 在 diff 阶段选择移动的总是旧位置更靠前、但新顺序排在后面的节点。

React 从左到右遍历新 children，用 `lastPlacedIndex` 记录已确认节点中的最大旧位置。后续节点的 `oldIndex` 如果小于它，说明这个节点在旧列表中位于某个已处理节点之前，但在新列表中排到了它之后，因此需要标记 `Placement`。否则，相对顺序仍然成立，不需要移动。

例如 `[A, B, C, D]` 变成 `[A, C, B, D]`，React 不会记录 C 左移，而是把 B 标记为 `Placement`，再在 commit 阶段把 B 插到 D 前面。这样 diff 只需要找出需要后移的节点，真实 DOM 重排交给 `insertBefore` 或 `appendChild` 完成。
