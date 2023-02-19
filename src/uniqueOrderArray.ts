/**
 * 有序数组原地去重
 */
export function uniqueOrderArray(arr: unknown[]) {
  let i = 0
  while (i < arr.length) {
    if (arr[i + 1] === arr[i]) {
      arr.splice(i, 1)
    } else {
      i++
    }
  }
}
