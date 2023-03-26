function swap(array: number[], i: number, j: number) {
  ;[array[i], array[j]] = [array[j], array[i]]
}

export function bubblingSort(array: number[]) {
  for (let i = 0; i < array.length; i++) {
    for (let j = i + 1; j < array.length; j++) {
      if (array[i] > array[j]) swap(array, i, j)
    }
  }
  return array
}

export function selectSorted(array: number[]) {
  for (let i = 0; i < array.length; i++) {
    let min = i
    for (let j = i + 1; j < array.length; j++) {
      if (array[min] > array[j]) min = j
    }
    if (min !== i) swap(array, min, i)
  }
  return array
}

export function insertOrder(array: number[]) {
  for (let i = 1; i < array.length; i++) {
    let v = array[i]
    let j = i
    while (j > 0) {
      if (v >= array[j - 1]) break
      array[j] = array[j - 1]
      j--
    }
    array[j] = v
  }
  return array
}

function getPivot(array: number[], left: number, right: number) {
  let l = left
  let r = right
  while (l < r) {
    // 右侧扫描
    while (l < r && array[l] <= array[r]) r--
    if (l < r) {
      swap(array, l, r)
      l++
    }
    // 左侧扫描
    while (l < r && array[l] <= array[r]) l++
    if (l < r) {
      swap(array, l, r)
      r--
    }
  }
  return l
}

/**
 * 快速排序（不稳定）
 *
 * 从数列中挑出一个元素，称为 "基准"（pivot）
 * 重新排序数列，元素比基准值小的放在左边，比基准值大的放在右边
 * 在这个分区退出之后，该基准就处于数列的中间位置，这个称为分区（partition）操作
 * 递归地把小于基准值元素的子数列和大于基准值元素的子数列排序
 *
 * 时间复杂度：平均：O(nlogn)、最佳：O(nlogn)、最差：O(n2)
 */
export function quickSort(array: number[], left: number, right: number) {
  if (left < right) {
    const pivot = getPivot(array, left, right)
    quickSort(array, left, pivot - 1)
    quickSort(array, pivot + 1, right)
  }
  return array
}

function merge(left: number[], right: number[]) {
  const result: number[] = []
  while (left.length && right.length) {
    if (left[0] <= right[0]) {
      result.push(left.shift()!)
    } else {
      result.push(right.shift()!)
    }
  }
  return result.concat(left).concat(right)
}

/**
 * 归并排序（稳定）
 *
 * 把数组从中间分成前后两部分
 * 对前后两部分分别排序，再将排好序的两部分合并在一起
 * 重复以上步骤
 *
 * 时间复杂度：O(nlogn)、空间复杂度：O(n)
 */
export function mergeSort(array: number[]): number[] {
  const n = array.length
  if (n < 2) return array
  const mid = Math.floor(n / 2)
  return merge(mergeSort(array.slice(0, mid)), mergeSort(array.slice(mid)))
}
