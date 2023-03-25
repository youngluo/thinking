/**
 * 给定一个长度为 n 的可能有重复值的数组，找出其中不去重的最小的 k 个数
 * 例如数组 [4, 5, 1, 6, 2, 7, 3, 8]，则最小的 4 个数字是 [1,2,3,4]（任意顺序皆可）
 * 数据范围：0 ≤ k, n ≤ 10000，数组中每个数的大小 0≤ val ≤ 1000
 * 要求：空间复杂度 O(n) ，时间复杂度 O(nlogk)
 * 示例 1：
 * 输入：[4, 5, 1, 6, 2, 7, 3, 8], 4
 * 返回：[1, 2, 3, 4]
 * 说明：返回最小的 4 个数即可，返回 [1, 3, 2, 4] 也可以
 * 示例 2：
 * 输入：[1], 0
 * 返回值：[]
 * 示例 3:
 * 输入：[0, 1, 2, 1, 2], 3
 * 返回值：[0, 1, 1]
 */

function minHeapify(nums: number[], i: number, heapSize: number) {
  const left = 2 * i + 1
  const right = 2 * i + 2
  let minIndex = i

  if (left < heapSize && nums[left] < nums[minIndex]) {
    minIndex = left
  }

  if (right < heapSize && nums[right] < nums[minIndex]) {
    minIndex = right
  }

  if (minIndex != i) {
    ;[nums[i], nums[minIndex]] = [nums[minIndex], nums[i]]
    minHeapify(nums, minIndex, heapSize)
  }
}

function buildMinHeap(nums: number[], heapSize: number) {
  let i = Math.floor((heapSize - 1 - 1) / 2)
  for (i; i >= 0; i--) {
    minHeapify(nums, i, heapSize)
  }
}

export function findMinNums(nums: number[], k: number) {
  if (k < 1) return []
  const n = nums.length
  buildMinHeap(nums, n)
  for (let i = n - 1; i >= n - k; i--) {
    ;[nums[0], nums[i]] = [nums[i], nums[0]]
    minHeapify(nums, 0, i)
  }

  return nums.slice(-k)
}
