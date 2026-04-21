/**
 * 实现一个 repeat 函数，每隔 interval 秒执行 fn，重复 repeat 次
 */
export function createRepeat(fn: Function, repeat = 0, interval = 0) {
  let count = 0
  return function run(...args: unknown[]) {
    setTimeout(() => {
      fn(...args)
      if (++count < repeat) {
        run(...args)
      }
    }, interval * 1000)
  }
}
