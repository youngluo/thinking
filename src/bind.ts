// @ts-ignore
Function.prototype.myBind = function () {
  const args = [].slice.call(arguments)
  const boundThis = args.shift()
  const targetFn = this

  function boundFn() {
    const boundFnArgs = [].slice.call(arguments)
    // 当 boundFn 通过 new 执行时，绑定当前实例
    targetFn.apply(this instanceof boundFn ? this : boundThis, args.concat(boundFnArgs))
  }

  // 继承原型方法
  function o() {}
  // 当 Function.prototype.myBind() 时，targetFn.prototype === undefined
  if (targetFn.prototype) {
    o.prototype = targetFn.prototype
  }
  // 避免 boundFn.prototype 与 targetFn.prototype 指向同一引用
  // 此时 boundFn 的实例 obj 原型链为：obj.__proto__.__proto__ === targetFn.prototype
  boundFn.prototype = new (o as any)()

  return boundFn
}

// @ts-ignore
Function.prototype.myCall = function (context) {
  // 当 call 第一个参数为 undefined 或者 null 时，this 默认指向 window
  context = context ? Object(context) : window

  const n = arguments.length
  const args = []
  // 排除 context
  for (let i = 1; i < n; i++) {
    args.push('arguments[' + i + ']')
  }
  // 利用 this 指向调用者
  context._fn = this
  // context._fn(arguments[1], arguments[2], arguments[1])
  const result = eval('context._fn(' + args + ')')
  delete context._fn

  return result
}

// @ts-ignore
Function.prototype.myApply = function (context, args: unknown[]) {
  context = context ? Object(context) : window
  context._fn = this

  let result
  if (!args) {
    result = context._fn()
  } else {
    const n = args.length
    const arr: unknown[] = []
    for (let i = 0; i < n; i++) {
      arr.push('args[' + i + ']')
    }
    result = eval('context._fn(' + arr + ')')
  }

  delete context._fn

  return result
}

export function newFactory(Constructor: Function, ...args: unknown[]): object {
  // obj.__proto__ = Constructor.prototype
  const obj = Object.create(Constructor.prototype)
  const result = Constructor.apply(obj, args)
  return typeof result === 'object' && result !== null ? result : obj
}

export function _instanceof(left: object, right: Function) {
  const proto = right.prototype
  // @ts-ignore
  left = left.__proto__
  while (true) {
    // 查询到原型链末端
    if (left === null) return false
    if (left === proto) return true
    // @ts-ignore
    left = left.__proto__
  }
}
