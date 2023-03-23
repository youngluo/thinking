import { findMinNums } from '../findMinNums'

describe('findMinNums', () => {
  test('findMinNums([4, 5, 1, 6, 2, 7, 3, 8], 4) === [4, 3, 2, 1]', () => {
    expect(findMinNums([4, 5, 1, 6, 2, 7, 3, 8], 4)).toStrictEqual([4, 3, 2, 1])
  })

  test('findMinNums([1], 0) === []', () => {
    expect(findMinNums([1], 0)).toStrictEqual([])
  })

  test('findMinNums([0, 1, 2, 1, 2], 3) === [1, 1, 0]', () => {
    expect(findMinNums([0, 1, 2, 1, 2], 3)).toStrictEqual([1, 1, 0])
  })
})
