export default function flatDeep(arr: any[]): any[] {
  return arr.reduce((pre, v) => pre.concat(Array.isArray(v) ? flatDeep(v) : v), [])
}
