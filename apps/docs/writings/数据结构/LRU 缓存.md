# LRU 缓存

const cache = new LRUCache(2)<br/>cache.put(1, 1)<br/>cache.put(2, 2)<br/>cache.get(1) // 返回 1<br/>cache.put(3, 3) // 删除 key 2，因为容量已满<br/>cache.get(2) // 返回 -1

```ts
export class LRUCache {
  capacity: number

  cache: Map<unknown, unknown>

  constructor(capacity: number) {
    this.capacity = capacity
    this.cache = new Map()
  }

  get(key: unknown) {
    if (!this.cache.has(key)) return -1
    const value = this.cache.get(key)
    this.cache.delete(key)
    this.cache.set(key, value)
    return value
  }

  put(key: unknown, value: unknown) {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size === this.capacity) {
      this.cache.delete(this.cache.keys().next().value)
    }
    this.cache.set(key, value)
  }
}

```
