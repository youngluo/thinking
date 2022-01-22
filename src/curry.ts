export default function curry(func: Function) {
  return function curried(...args: any[]): any {
    // 如果实际传参数量小于原函数形参数量，说明需要继续进行柯里化调用
    if (args.length < func.length) {
      // 返回一个新函数并合并参数
      return curried.bind(null, ...args)
    }
    return func.apply(null, args)
  }
}
