const OBJECT_TYPE = '[object Object]'
const ARRAY_TYPE = '[object Array]'
const MAP_TYPE = '[object Map]'
const SET_TYPE = '[object Set]'
const DEEP_TYPES = [OBJECT_TYPE, ARRAY_TYPE, MAP_TYPE, SET_TYPE]

const getType = (target: any) => Object.prototype.toString.call(target)

export default function deepClone(target: any, cache = new WeakMap()) {
  const type = getType(target)
  if (DEEP_TYPES.includes(type)) {
    // 通过构造函数初始化引用类型
    const cloneObj = new target.constructor()
    // 处理循环引用
    if (cache.has(target)) return cache.get(target)
    cache.set(target, cloneObj)

    if (type === ARRAY_TYPE) {
      target.forEach((v: any, index: number) => {
        cloneObj[index] = deepClone(v, cache)
      })
    }

    if (type === OBJECT_TYPE) {
      Object.entries(target).forEach(([k, v]) => {
        cloneObj[k] = deepClone(v, cache)
      })
    }

    if (type === MAP_TYPE) {
      target.forEach((v: any, k: any) => {
        cloneObj.set(k, deepClone(v, cache))
      })
    }

    if (type === SET_TYPE) {
      target.forEach((v: any) => {
        cloneObj.add(deepClone(v, cache))
      })
    }

    return cloneObj
  }

  return target
}
