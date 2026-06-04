---
createdAt: '2026-06-04 12:00:00'
---

# React Reconcile

协调阶段要做的事，是比较 `current Fiber` 和本轮渲染得到的 `nextChildren`，生成 `workInProgress Fiber`。入口在渲染阶段的 [beginWork](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberBeginWork.js#L341)。

```js title="react-reconciler/src/ReactFiberBeginWork.js"
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

`reconcileChildFibers` 是包装后的协调入口，内部实际调用的是 [reconcileChildFibersImpl](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactChildFiber.js#L1849)。

```js title="react-reconciler/src/ReactChildFiber.js"
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

单节点 diff 在 [reconcileSingleElement](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactChildFiber.js#L1698) 中执行，`reconcileSinglePortal` 逻辑类似：

1. 当 `key` 不相同时，将 Fiber 标记为删除，继续遍历其兄弟节点寻找可复用节点；
2. 如果没有找到可复用节点，则创建新的 Fiber；
3. 如果 `key` 相同并且 `type` 相同，复用 `oldFiber`，删除兄弟节点，更新 `props`；
4. 如果 `key` 相同但 `type` 不同，删除 `oldFiber` 及其兄弟节点，创建新的 Fiber。

```js title="react-reconciler/src/ReactChildFiber.js"
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

多节点 diff 在 [reconcileChildrenArray](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactChildFiber.js#L1172) 中执行：

1. 如果 `key` 相同并且 `type` 相同，复用 Fiber；如果 `type` 不同，创建新的 Fiber，将 `oldFiber` 标记为删除；更新 `lastPlacedIndex`（第一部分遍历）；
2. 如果 `key` 不相同，跳出第一部分遍历；
3. 如果 `newChildren` 先遍历完成，说明更新后节点变少，将剩余的 oldFiber 标记为删除；如果同时遍历完成，diff 结束（理想情况）；
4. 如果 `newChildren` 未遍历完成，oldFiber 先遍历完成，说明更新后节点增加，需将增加的节点创建为新的 Fiber，标记为插入；更新 `lastPlacedIndex`（第二部分遍历）；
5. 如果都没有遍历完成，需要预先将 `oldFiber` 及其兄弟节点处理成一个 `Map` 对象，方便后续快速查找；
6. 继续遍历 `newChildren`，根据类似前面的 `key` 和 `type` 比对结果创建 Fiber。如果复用了 `oldFiber`，则将其从 `Map` 中删除，避免后续被标记为删除；更新 `lastPlacedIndex`（第三部分遍历）；
7. 将 `Map` 中剩余的 Fiber 标记为删除。

```js title="react-reconciler/src/ReactChildFiber.js"
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
  // 以 (oldFiber.key || oldFiber.index) 为 key, oldFiber 为 value，生成一个 Map 对象，方便快速查找
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

多节点 diff 使用 [placeChild](https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactChildFiber.js#L511) 计算是否需要更新 lastPlacedIndex。

```js title="react-reconciler/src/ReactChildFiber.js"
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
    // 如果 oldFiber.index 小于 lastPlacedIndex，说明该节点需要向右移动，lastPlacedIndex 不变
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
