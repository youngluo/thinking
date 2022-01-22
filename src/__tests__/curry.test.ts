import curry from '../curry'

function testFn(a: number, b: number, c: number) {
  return a + b + c
}

const curriedFn = curry(testFn)

describe('curry', () => {
  test('"curriedFn(1)(2)(3)" should be equal to "testFn(1, 2, 3)"', () => {
    expect(testFn(1, 2, 3)).toBe(curriedFn(1)(2)(3))
  })

  test('"curriedFn(1, 2)(3)" should be equal to "testFn(1, 2, 3)"', () => {
    expect(testFn(1, 2, 3)).toBe(curriedFn(1, 2)(3))
  })

  test('"curriedFn(1)(2, 3)" should be equal to "testFn(1, 2, 3)"', () => {
    expect(testFn(1, 2, 3)).toBe(curriedFn(1)(2, 3))
  })

  test('"curriedFn(1, 2, 3)" should be equal to "testFn(1, 2, 3)"', () => {
    expect(testFn(1, 2, 3)).toBe(curriedFn(1, 2, 3))
  })

  test('"curriedFn(1, 2, 3, 4)" should be equal to "testFn(1, 2, 3)"', () => {
    expect(testFn(1, 2, 3)).toBe(curriedFn(1, 2, 3, 4))
  })
})
