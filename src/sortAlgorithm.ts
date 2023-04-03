function swap(array: number[], i: number, j: number) {
  ;[array[i], array[j]] = [array[j], array[i]]
}
/**
 * 冒泡排序（稳定）
 *
 * 比较相邻的元素，如果第一个比第二个大，就交换他们两个
 * 对每一对相邻元素做同样的工作，从开始第一对到结尾的最后一对。在这一点，最后的元素应该会是最大的数
 * 针对所有的元素重复以上的步骤，除了最后一个
 * 持续每次对越来越少的元素重复上面的步骤，直到没有任何一对数字需要比较
 *
 * 时间复杂度：平均：O(n2)、最佳：O(n)、最差：O(n2)
 */
export function bubbleSort(array: number[]) {
  const n = array.length
  for (let i = 0; i < n; i++) {
    // 将较小元素往前移动
    for (let j = n - 2; j >= i; j--) {
      if (array[j] > array[j + 1]) swap(array, j, j + 1)
    }
  }
  return array
}
/**
 * 选择排序（不稳定）
 *
 * 第一次从待排序的数据元素中选出最小（或最大）的一个元素，存放在序列的起始位置
 * 然后再从剩余的未排序元素中寻找到最小（大）元素，然后放到已排序的序列的末尾
 * 以此类推，直到全部待排序的数据元素的个数为零
 *
 * 时间复杂度：O(n2)
 */
export function selectionSort(array: number[]) {
  const n = array.length
  for (let i = 0; i < n; i++) {
    let min = i
    for (let j = i + 1; j < n; j++) {
      if (array[min] > array[j]) min = j
    }
    if (min !== i) swap(array, min, i)
  }
  return array
}
/**
 * 插入排序（稳定）
 *
 * 将待排序序列第一个元素看做一个有序序列，把第二个元素到最后一个元素当成是未排序序列
 * 从头到尾依次扫描未排序序列，将扫描到的每个元素插入有序序列的适当位置
 * 如果待插入的元素与有序序列中的某个元素相等，则将待插入元素插入到相等元素的后面
 *
 * 时间复杂度：平均：O(n2)、最佳：O(n)、最差：O(n2)
 */
export function insertionOrder(array: number[]) {
  const n = array.length
  for (let i = 1; i < n; i++) {
    let j = i
    const v = array[j]
    while (j > 0 && v < array[j - 1]) {
      array[j] = array[j - 1]
      j--
    }
    array[j] = v
  }
  return array
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
 * 希尔排序（不稳定）
 *
 * 它是简单插入排序经过改进之后的一个更高效的版本，也称为缩小增量排序
 * 选择一个增量序列 t1，t2，……，tk，其中 ti > tj, tk = 1
 * 按增量序列个数 k，对序列进行 k 趟排序
 * 每趟排序，根据对应的增量 ti，将待排序列分割成若干长度为 m 的子序列，分别对各子表进行直接插入排序
 * 仅增量因子为 1 时，整个序列作为一个表来处理，表长度即为整个序列的长度
 *
 * 时间复杂度：O(n^(1.3-2))
 */
export function shellSort(array: number[]) {
  const n = array.length
  let gap = 1

  while (gap < n / 3) {
    //动态定义间隔序列
    gap = gap * 3 + 1
  }

  while (gap > 0) {
    for (let i = gap; i < n; i++) {
      const v = array[i]
      let j = i - gap
      while (j >= 0 && array[j] > v) {
        array[j + gap] = array[j]
        j -= gap
      }
      array[j + gap] = v
    }
    gap = Math.floor(gap / 3)
  }

  return array
}
