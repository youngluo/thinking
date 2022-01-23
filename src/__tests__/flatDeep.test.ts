import flatDeep from '../flat-deep'

const arr = [1, 2, 3, [1, 2, 3, 4, [2, 3, 4]]]
const result = [1, 2, 3, 1, 2, 3, 4, 2, 3, 4]

describe('transform', () => {
  test('should flat arr', () => {
    expect(flatDeep(arr)).toEqual(result)
  })
})
