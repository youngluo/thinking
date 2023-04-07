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
 * 冒泡排序（优化版）
 */
export function bubbleSortPerf(array: number[]) {
  const n = array.length
  let isOk = true
  for (let i = 0; i < n; i++) {
    // 将较小元素往前移动
    for (let j = n - 2; j >= i; j--) {
      if (array[j] > array[j + 1]) {
        swap(array, j, j + 1)
        isOk = false
      }
    }
    if (isOk) break
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
export function insertionSort(array: number[], gap = 1) {
  const n = array.length
  for (let i = gap; i < n; i++) {
    let j = i
    const v = array[j]
    while (j > 0 && v < array[j - gap]) {
      array[j] = array[j - gap]
      j -= gap
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
    insertionSort(array, gap)
    gap = Math.floor(gap / 3)
  }
  return array
}
/**
 * 计数排序（稳定）
 *
 * 找出待排序的数组中最大和最小的元素
 * 统计数组中每个值为 i 的元素出现的次数，存入数组 C 的第 i 项
 * 对所有的计数累加（从 C 中的第一个元素开始，每一项和前一项相加）
 * 反向填充目标数组：将每个元素 i 放在新数组的第 C(i) 项，每放一个元素就将 C(i) 减去 1
 *
 * 时间复杂度：O(n + k)
 */
export function countingSort(array: number[]) {
  const bucket = []
  for (const v of array) {
    // 将元素作为序号，并统计出现次数
    if (!bucket[v]) bucket[v] = 0
    bucket[v] += 1
  }
  const n = bucket.length
  let index = 0
  for (let i = 0; i < n; i++) {
    while (bucket[i] > 0) {
      array[index++] = i
      bucket[i] -= 1
    }
  }
  return array
}
/**
 * 基数排序（稳定）
 *
 * 基数排序是按照低位先排序，然后收集；再按照高位排序，然后再收集；依次类推，直到最高位。
 *
 * 时间复杂度：O(n + k)
 */
export function radixSort(array: number[], maxDigit: number) {
  const n = array.length
  const counter: number[][] = []
  let mod = 10
  let dev = 1

  for (let i = 0; i < maxDigit; i++, dev *= 10, mod *= 10) {
    for (let j = 0; j < n; j++) {
      const bucket = Math.floor((array[j] % mod) / dev)
      if (counter[bucket] == null) {
        counter[bucket] = []
      }
      counter[bucket].push(array[j])
    }
    let pos = 0
    for (let j = 0; j < counter.length; j++) {
      let value = null
      if (counter[j] != null) {
        while ((value = counter[j].shift()) != null) {
          array[pos++] = value
        }
      }
    }
  }
  return array
}
/**
 * 桶排序（稳定）
 *
 * 将数组分到有限数量的桶里
 * 对每个桶分别排序
 * 最后合并各个桶
 *
 * 时间复杂度：平均：O(n + k)、最佳：O(n)、最差：O(n2)
 */
export function bucketSort(array: number[], bucketSize = 3) {
  const n = array.length
  if (n === 0) return array
  let minValue = array[0]
  let maxValue = array[0]
  for (let i = 1; i < n; i++) {
    if (array[i] < minValue) {
      minValue = array[i]
    } else if (array[i] > maxValue) {
      maxValue = array[i]
    }
  }

  const bucketCount = Math.floor((maxValue - minValue) / bucketSize) + 1
  const buckets: number[][] = new Array(bucketCount).fill(0).map(() => [])
  // 将数据分配到各个桶中
  for (let i = 0; i < n; i++) {
    buckets[Math.floor((array[i] - minValue) / bucketSize)].push(array[i])
  }

  const result: number[] = []
  for (let i = 0; i < buckets.length; i++) {
    // 对每个桶进行排序，这里使用了插入排序
    result.concat(insertionSort(buckets[i]))
  }
  return result
}
