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

export class LRUCache {
  capacity: number

  cache: LinkedHashMap

  constructor(capacity: number) {
    this.capacity = capacity
    this.cache = new LinkedHashMap()
  }

  get(key: string) {
    if (!this.cache.has(key)) return -1
    const value = this.cache.get(key)
    this.cache.delete(key)
    this.cache.set(key, value)
    return value
  }

  put(key: string, value: unknown) {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size === this.capacity) {
      this.cache.delete(this.cache.keys().next().value)
    }
    this.cache.set(key, value)
  }
}
