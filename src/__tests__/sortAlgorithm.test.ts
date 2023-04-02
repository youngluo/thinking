import { bubbleSort, selectionSort, insertionOrder, quickSort, mergeSort } from '../sortAlgorithm'

const array = [1, 2, 9, 6, 7, 3, 8, 4, 5]
const result = [1, 2, 3, 4, 5, 6, 7, 8, 9]

describe('sort algorithm', () => {
  test('bubbleSort sort', () => {
    expect(bubbleSort([...array])).toStrictEqual(result)
  })

  test('selection sort', () => {
    expect(selectionSort([...array])).toStrictEqual(result)
  })

  test('insertion sort', () => {
    expect(insertionOrder([...array])).toStrictEqual(result)
  })

  test('quick sort', () => {
    expect(quickSort([...array], 0, array.length - 1)).toStrictEqual(result)
  })

  test('merge sort', () => {
    expect(mergeSort([...array])).toStrictEqual(result)
  })
})
