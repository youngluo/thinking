import { numberToChinese } from '../numberToChinese'

describe('numberToChinese', () => {
  // test('numberToChinese(100010001) === 一亿零一万零一', () => {
  //   expect(numberToChinese(100010001)).toBe('一亿零一万零一')
  // })

  test('numberToChinese(100001) === 十万零一', () => {
    expect(numberToChinese(100001)).toBe('十万零一')
  })

  // test('numberToChinese(10000) === 一万', () => {
  //   expect(numberToChinese(10000)).toBe('一万')
  // })

  // test('numberToChinese(100) === 一百', () => {
  //   expect(numberToChinese(10)).toBe('一百')
  // })

  // test('numberToChinese(10) === 十', () => {
  //   expect(numberToChinese(10)).toBe('十')
  // })

  // test('numberToChinese(1) === 一', () => {
  //   expect(numberToChinese(1)).toBe('一')
  // })
})
