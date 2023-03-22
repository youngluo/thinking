import { numberToChinese } from '../numberToChinese'

describe('numberToChinese', () => {
  test('numberToChinese(1000000000000) === 无效的数字或数字过大', () => {
    expect(numberToChinese(1000000000000)).toBe('无效的数字或数字过大')
  })

  test('numberToChinese(10010000001) === 一百亿一千万零一', () => {
    expect(numberToChinese(10010000001)).toBe('一百亿一千万零一')
  })

  test('numberToChinese(100010001) === 一亿零一万零一', () => {
    expect(numberToChinese(100010001)).toBe('一亿零一万零一')
  })

  test('numberToChinese(100001) === 十万零一', () => {
    expect(numberToChinese(100001)).toBe('十万零一')
  })

  test('numberToChinese(100000000) === 一亿', () => {
    expect(numberToChinese(100000000)).toBe('一亿')
  })

  test('numberToChinese(111111111) === 一亿一千一百一十一万一千一百一十一', () => {
    expect(numberToChinese(111111111)).toBe('一亿一千一百一十一万一千一百一十一')
  })

  test('numberToChinese(10000) === 一万', () => {
    expect(numberToChinese(10000)).toBe('一万')
  })

  test('numberToChinese(100) === 一百', () => {
    expect(numberToChinese(100)).toBe('一百')
  })

  test('numberToChinese(10) === 十', () => {
    expect(numberToChinese(10)).toBe('十')
  })

  test('numberToChinese(1) === 一', () => {
    expect(numberToChinese(1)).toBe('一')
  })
})
