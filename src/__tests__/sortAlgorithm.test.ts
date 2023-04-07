import {
  bubbleSort,
  bubbleSortPerf,
  selectionSort,
  insertionSort,
  quickSort,
  mergeSort,
  shellSort,
  countingSort,
  radixSort,
  bucketSort,
} from '../sortAlgorithm'

const array = new Array(3000).fill(0).map(() => Math.ceil(Math.random() * 1000))
const result = [...array].sort((a, b) => a - b)

describe('sort algorithm', () => {
  test('bubble sort', () => {
    expect(bubbleSort([...array])).toStrictEqual(result)
  })

  test('bubble sort perf', () => {
    expect(bubbleSortPerf([...array])).toStrictEqual(result)
  })

  test('selection sort', () => {
    expect(selectionSort([...array])).toStrictEqual(result)
  })

  test('insertion sort', () => {
    expect(insertionSort([...array])).toStrictEqual(result)
  })

  test('quick sort', () => {
    expect(quickSort([...array], 0, array.length - 1)).toStrictEqual(result)
  })

  test('merge sort', () => {
    expect(mergeSort([...array])).toStrictEqual(result)
  })

  test('shell sort', () => {
    expect(shellSort([...array])).toStrictEqual(result)
  })

  test('counting sort', () => {
    expect(countingSort([...array])).toStrictEqual(result)
  })

  test('radix sort', () => {
    expect(radixSort([...array], 4)).toStrictEqual(result)
  })

  test('bucket sort', () => {
    expect(bucketSort([...array])).toStrictEqual(result)
  })
})
