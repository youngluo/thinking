# koa-compose

let middlewares = []<br/>middlewares.push((next) => {<br/>&nbsp;&nbsp;console.log(1)<br/>&nbsp;&nbsp;next()<br/>&nbsp;&nbsp;console.log(1.1)<br/>})<br/><br/>middlewares.push((next) => {<br/>&nbsp;&nbsp;console.log(2)<br/>&nbsp;&nbsp;next()<br/>&nbsp;&nbsp;console.log(2.1)<br/>})<br/><br/>middlewares.push((next) => {<br/>&nbsp;&nbsp;console.log(3)<br/>&nbsp;&nbsp;next()<br/>&nbsp;&nbsp;console.log(3.1)<br/>})<br/><br/>compose(middlewares)() // 1 2 3 3.1 2.1 1.1

```ts
export function compose(middlewares: Middleware[]) {
  if (!Array.isArray(middlewares))
    throw new TypeError('Middleware stack must be an array!')

  for (const fn of middlewares) {
    if (typeof fn !== 'function')
      throw new TypeError('Middleware must be composed of functions!')
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

type Middleware = (next: () => Promise<unknown>) => Promise<unknown>

```
