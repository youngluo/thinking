import {
  getParamsByURLSearchParams,
  getParamsByMatchAll,
  getParamsByRepalce,
  getParamsByURL,
} from '../query'

const url = 'http://www.google.com?a=1&b=232&a=2'

describe('query', () => {
  test('should get params by new URL from url', () => {
    expect(getParamsByURL(url)).toStrictEqual({ b: '232', a: '2' })
  })

  test('should get params by URLSearchParams from url', () => {
    expect(getParamsByURLSearchParams(url)).toStrictEqual({ b: '232', a: '2' })
  })

  test('should get params by replace from url', () => {
    expect(getParamsByRepalce(url)).toStrictEqual({ b: '232', a: '2' })
  })

  test('should get params by matchAll from url', () => {
    expect(getParamsByMatchAll(url)).toStrictEqual({ b: '232', a: '2' })
  })
})
