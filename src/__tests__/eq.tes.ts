import eq from '../eq'

describe('eq', () => {
  test('"Object.is({ a: 1, b: 2 }, { a: 1, b: 2 })" should be equal to "false"', () => {
    expect(Object.is({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(false)
  })

  test('"eq({ a: 1, b: 2 }, { a: 1, b: 2 })" should be equal to "true"', () => {
    expect(eq({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
  })

  test('"eq({ b: 2, a: 1 }, { a: 1, b: 2 })" should be equal to "true"', () => {
    expect(eq({ b: 2, a: 1 }, { a: 1, b: 2 })).toBe(true)
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

  test('"eq({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })" should be equal to "true"', () => {
    expect(eq({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true)
  })

  test('"eq(null, null)" should be equal to "true"', () => {
    expect(eq(null, null)).toBe(true)
  })

  test('"eq(NaN, NaN)" should be equal to "true"', () => {
    expect(eq(NaN, NaN)).toBe(true)
  })

  test('"eq([1, 2, 3], [1, 2, 3])" should be equal to "true"', () => {
    expect(eq([1, 2, 3], [1, 2, 3])).toBe(true)
  })

  test('"eq([1, 2, 3], [1, 3, 2])" should be equal to "false"', () => {
    expect(eq([1, 2, 3], [1, 3, 2])).toBe(false)
  })

  test('"eq([1, 2, { a: 1, b: { c: 2 } }], [1, 2, { a: 1, b: { c: 2 } }])" should be equal to "true"', () => {
    expect(eq([1, 2, { a: 1, b: { c: 2 } }], [1, 2, { a: 1, b: { c: 2 } }])).toBe(true)
  })

  test('"eq([1, 2, { b: { c: 2 }, a: 1 }], [1, 2, { a: 1, b: { c: 2 } }])" should be equal to "true"', () => {
    expect(eq([1, 2, { b: { c: 2 }, a: 1 }], [1, 2, { a: 1, b: { c: 2 } }])).toBe(true)
  })

  test('"eq(Map([["a", 1], ["b", 2]]), Map([["a", 1], ["b", 2]]))" should be equal to "true"', () => {
    expect(
      eq(
        new Map([
          ['a', 1],
          ['b', 2],
        ]),
        new Map([
          ['a', 1],
          ['b', 2],
        ])
      )
    ).toBe(true)
  })

  test('"eq(Map([["b", 2], ["a", 1]]), Map([["a", 1], ["b", 2]]))" should be equal to "false"', () => {
    expect(
      eq(
        new Map([
          ['b', 2],
          ['a', 1],
        ]),
        new Map([
          ['a', 1],
          ['b', 2],
        ])
      )
    ).toBe(false)
  })
})
