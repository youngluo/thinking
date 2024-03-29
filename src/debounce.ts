/**
 * 一定时间连续触发的事件只在最后执行一次
 * 注意事项
 * 1. 修正 this
 * 2. 第一次是否需要立即执行
 */
export function debounce(fn: Function, delay: number = 0, immediate = false) {
  let timer: NodeJS.Timeout | null

  return function (...args: any[]) {
    if (timer) clearTimeout(timer)

    if (immediate && !timer) {
      fn.apply(this, args)
    }

    timer = setTimeout(() => {
      fn.apply(this, args)
      timer = null
    }, delay)
  }
}

/**
 * 一段时间内只执行一次
 * setTimeout 版本
 * 1. 事件触发不立即执行
 * 2. 事件触发停止后还会执行一次
 * 3. 异步执行
 */
export function throttleTimer(fn: Function, delay: number = 0) {
  let timer: NodeJS.Timeout | null

  return function (...args: any[]) {
    if (timer) return
    timer = setTimeout(() => {
      fn.apply(this, args)
      timer = null
    }, delay)
  }
}

/**
 * 时间戳版本
 * 1. 事件触发立即执行
 * 2. 事件触发停止后不会再执行
 * 3. 同步执行
 */
export function throttleTimestamp(fn: Function, delay: number = 0) {
  let previous = 0

  return function (...args: any[]) {
    const now = Date.now()

    if (now - previous >= delay) {
      fn.apply(this, args)
      previous = now
    }
  }
}

/**
 * 综合版
 * 1. 事件触发立即执行
 * 2. 事件触发停止后再执行一次
 */
export function throttle(fn: Function, delay: number = 0) {
  let timer: NodeJS.Timeout | null
  let previous = 0

  return function (...args: any[]) {
    const now = Date.now()
    const remaining = delay - (now - previous)
    if (remaining <= 0) {
      fn.apply(this, args)
      previous = now
    } else {
      // 保证只执行最后一个 timer
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        fn.apply(this, args)
        previous = now
        timer = null
      }, remaining)
    }
  }
}
