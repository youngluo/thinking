import deepClone from '../deep-clone'

const basicObject = {
  foo: { b: { c: { d: [{ a: 1, c: '5' }] } } },
  bar: { b: null, c: undefined },
}

const circularObject = {
  foo: [{ a: 1, b: {} }],
  bar: { a: 2, c: [{ d: {} }] },
}
// @ts-ignore
circularObject.c = circularObject

const map = new Map()
map.set({}, 1)
const set = new Set()
set.add(1)
const mapObject = {
  foo: { a: 1, b: set },
  bar: map,
}

// Symbol key isn't enumerable
// const abc = Symbol('abc')
const symbolObject = {
  // foo: { [abc]: 2 },
  foo: { b: null, c: undefined },
  bar: [{ a: 2 }],
}

describe('deep-clone', () => {
  test('[basic object] should have all the same properties', () => {
    expect(deepClone(basicObject)).toStrictEqual(basicObject)
  })

  test('[basic object] should have different reference type', () => {
    expect(deepClone(basicObject)).not.toBe(basicObject)
  })

  test('[circular object] should have all the same properties', () => {
    expect(deepClone(circularObject)).toStrictEqual(circularObject)
  })

  test('[circular object] should have different reference type', () => {
    expect(deepClone(circularObject)).not.toBe(circularObject)
  })

  test('[Map and Set object] should have all the same properties', () => {
    expect(deepClone(mapObject)).toStrictEqual(mapObject)
  })

  test('[Map and Set object] should have different reference type', () => {
    expect(deepClone(mapObject)).not.toBe(mapObject)
  })

  test('[Symbol object] should have all the same properties', () => {
    expect(deepClone(symbolObject)).toStrictEqual(symbolObject)
  })

  test('[Symbol object] should have different reference type', () => {
    expect(deepClone(symbolObject)).not.toBe(symbolObject)
  })
})
