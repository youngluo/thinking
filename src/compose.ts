/**
 * koa-compose 实现
 *
 * let middlewares = []
 * middlewares.push((next) => {
 *   console.log(1)
 *   next()
 *   console.log(1.1)
 * })
 *
 * middlewares.push((next) => {
 *   console.log(2)
 *   next()
 *   console.log(2.1)
 * })
 *
 * middlewares.push((next) => {
 *   console.log(3)
 *   next()
 *   console.log(3.1)
 * })
 *
 * compose(middlewares)() // 1 2 3 3.1 2.1 1.1
 */
function compose(middlewares: Function[]) {
  if (!Array.isArray(middlewares)) throw new TypeError('Middleware stack must be an array!')

  for (const fn of middlewares) {
    if (typeof fn !== 'function') throw new TypeError('Middleware must be composed of functions!')
  }

  return () => {
    return dispatch(0)
    function dispatch(i: number): Promise<unknown> {
      const fn = middlewares[i]
      if (!fn) return Promise.resolve()

      try {
        return Promise.resolve(fn(dispatch.bind(null, i + 1)))
      } catch (error) {
        return Promise.reject(error)
      }
    }
  }
}
