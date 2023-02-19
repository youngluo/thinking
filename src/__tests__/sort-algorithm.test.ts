import { bubblingSort, selectSorted, insertOrder, quickSort } from '../sortAlgorithm'

describe('sort algorithm', () => {
  test('bubbling sort', () => {
    expect(bubblingSort([1, 2, 9, 6, 7, 3, 8, 4, 5])).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  test('select sort', () => {
    expect(selectSorted([1, 2, 9, 6, 7, 3, 8, 4, 5])).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  test('insert sort', () => {
    expect(insertOrder([1, 2, 9, 6, 7, 3, 8, 4, 5])).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  test('quick sort', () => {
    const array = [3, 2, 9, 6, 7, 1, 8, 4, 5]
    expect(quickSort(array, 0, array.length - 1)).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })
})
