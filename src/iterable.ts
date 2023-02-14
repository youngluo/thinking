export function range(start: number, end: number) {
  if (start > end) throw new RangeError()
  let i = start

  return {
    [Symbol.iterator]() {
      return this
    },
    next() {
      if (i > end) return { done: true }

      return { value: i++, done: false }
    },
  }
}

for (const v of range(1, 3)) {
  console.log(v) // 1,2,3
}
// 等价于
const it = range(1, 3)
for (let v, res; (res = it.next()) && !res.done; ) {
  v = res.value
  console.log(v) // 1,2,3
}
