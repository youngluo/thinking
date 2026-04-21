# LinkedHashMap

结合哈希表和双向链表的优点：<br/>哈希表提供 O(1) 的查找效率<br/>双向链表维护插入顺序，支持 O(1) 的顺序遍历<br/>头部和尾部为哨兵节点，简化边界处理<br/><br/>const map = new LinkedHashMap()<br/>map.set('a', 1)<br/>map.set('b', 2)<br/>map.get('a') // 返回 1<br/>map.delete('b')<br/>map.has('b') // 返回 false

```ts
export class LinkedHashMap {
  size: number = 0

  private head: ListNode

  private tail: ListNode

  private map: Map<string, ListNode>

  constructor() {
    this.head = new ListNode(0, 0)
    this.tail = new ListNode(0, 0)
    this.head.next = this.tail
    this.tail.prev = this.head
    this.map = new Map()
  }

  private addNodeFromTail(node: ListNode) {
    node.next = this.tail
    node.prev = this.tail.prev
    this.tail.prev!.next = node
    this.tail.prev = node
    this.size++
  }

  private removeNode(node: ListNode) {
    node.prev!.next = node.next
    node.next!.prev = node.prev
    this.size--
  }

  has(key: string) {
    return this.map.has(key)
  }

  get(key: string) {
    return this.map.get(key)?.value
  }

  set(key: string, value: unknown) {
    const node = new ListNode(key, value)
    this.addNodeFromTail(node)
    this.map.set(key, node)
  }

  delete(key: string) {
    if (!this.has(key)) return
    const node = this.map.get(key)
    this.removeNode(node!)
    this.map.delete(key)
  }

  keys() {
    return this.map.keys()
  }
}

// 双向链表节点
class ListNode {
  next: ListNode | null

  prev: ListNode | null

  key: string | number

  value: unknown

  constructor(key: string | number, value: unknown) {
    this.value = value
    this.key = key
    this.prev = null
    this.next = null
  }
}

```
