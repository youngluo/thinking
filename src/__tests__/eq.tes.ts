import eq from '../eq'

describe('eq', () => {
  test('"Object.is({ a: 1, b: 2 }, { a: 1, b: 2 })" should be equal to "false"', () => {
    expect(Object.is({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(false)
  })

  test('"eq({ a: 1, b: 2 }, { a: 1, b: 2 })" should be equal to "true"', () => {
    expect(eq({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
  })

  test('"eq({ a: 1, b: 2 }, { a: 1 })" should be equal to "false"', () => {
    expect(eq({ a: 1, b: 2 }, { a: 1 })).toBe(false)
  })

  test('"eq({ a: 1, b: 3 }, { a: 1, b: 2 })" should be equal to "false"', () => {
    expect(eq({ a: 1, b: 3 }, { a: 1, b: 2 })).toBe(false)
  })

  test('"eq({ a: 1, b: { c: 2} }, { a: 1, b: { c: 2 } })" should be equal to "true"', () => {
    expect(eq({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toBe(true)
  })

  test('"eq(null, null)" should be equal to "true"', () => {
    expect(eq(null, null)).toBe(true)
  })

  test('"eq(NaN, NaN)" should be equal to "true"', () => {
    expect(eq(NaN, NaN)).toBe(true)
  })
})
