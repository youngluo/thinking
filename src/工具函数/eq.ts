const OBJECT_TYPE = '[object Object]'
const ARRAY_TYPE = '[object Array]'
const MAP_TYPE = '[object Map]'
const SET_TYPE = '[object Set]'
const REF_TYPES = [OBJECT_TYPE, ARRAY_TYPE, MAP_TYPE, SET_TYPE]

const getType = (target: unknown) => Object.prototype.toString.call(target)

export default function eq(target: any, other: any): boolean {
  const targetType = getType(target)
  const otherType = getType(other)
  if (targetType !== otherType) return false

  // 基础类型
  if (!REF_TYPES.includes(targetType)) return Object.is(target, other)

  if (targetType === OBJECT_TYPE) {
    const targetKeys = Object.keys(target)
    const otherKeys = Object.keys(other)
    if (targetKeys.length !== otherKeys.length) return false
    let n = targetKeys.length - 1

    while (n >= 0) {
      if (!eq(target[targetKeys[n]], other[targetKeys[n]])) return false
      n--
    }
    return true
  }

  if (targetType === ARRAY_TYPE) {
    if (target.length !== other.length) return false
    let n = target.length - 1
    while (n >= 0) {
      if (!eq(target[n], other[n])) return false
      n--
    }
    return true
  }

  if (targetType === MAP_TYPE) {
    return eq(Array.from(target), Array.from(other))
  }

  //
  return false
}
