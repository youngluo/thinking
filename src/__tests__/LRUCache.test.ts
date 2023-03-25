import { LRUCache } from '../LRUCache'

const cache = new LRUCache(2)

describe('LRUCache', () => {
  test('LRUCache case 01', () => {
    cache.put(1, 1)
    cache.put(2, 2)
    expect(cache.get(1)).toBe(1)
  })

  test('LRUCache case 02', () => {
    cache.put(3, 3)
    expect(cache.get(2)).toBe(-1)
  })

  test('LRUCache case 03', () => {
    cache.put(4, 4)
    expect(cache.get(1)).toBe(-1)
  })

  test('LRUCache case 04', () => {
    expect(cache.get(3)).toBe(3)
  })

  test('LRUCache case 05', () => {
    expect(cache.get(4)).toBe(4)
  })
})
