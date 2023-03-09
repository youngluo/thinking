// @ts-ignore
Function.prototype.myBind = function () {
  const args = Array.prototype.slice.call(arguments)
  const boundThis = args.shift()
  const targetFn = this

  function boundFn() {
    const boundFnArgs = Array.prototype.slice.call(arguments)
    // 当 boundFn 通过 new 执行时，绑定当前实例
    targetFn.apply(this instanceof boundFn ? this : boundThis, args.concat(boundFnArgs))
  }

  // 继承原型方法
  function o() {}
  // 当 Function.prototype.myBind() 时，targetFn.prototype === undefined
  if (targetFn.prototype) {
    o.prototype = targetFn.prototype
  }
  // 此时 boundFn 的实例 obj 原型链为：obj.__proto__.__proto__ === targetFn.prototype
  boundFn.prototype = new (o as any)()

  return boundFn
}
