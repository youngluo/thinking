const OBJECT_TYPE = '[object Object]'
const ARRAY_TYPE = '[object Array]'
const MAP_TYPE = '[object Map]'
const SET_TYPE = '[object Set]'

const getType = (target: any) => Object.prototype.toString.call(target)

export default function eq(target: any, other: any) {
  if (Object.is(other, target)) return true

  const targetType = getType(target)
  const otherType = getType(other)

  if (targetType !== otherType) return false

  if (targetType === OBJECT_TYPE) {
    const targetKeys = Object.keys(target)
    const otherKeys = Object.keys(other)
    if (targetKeys.length !== otherKeys.length) return false
    let n = targetKeys.length - 1

    while (n >= 0) {
      if (!eq(target[targetKeys[n]], other[otherKeys[n]])) return false
      n--
    }
    return true
  }

  //
}
