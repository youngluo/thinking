import { thousands, thousandsByReg, thousandsByNative } from '../thousands'

describe('thousands', () => {
  test('case 1', () => {
    expect(thousands(123456)).toBe('123,456')
  })

  test('case 2', () => {
    expect(thousands(-12345678)).toBe('-12,345,678')
  })

  test('case 3', () => {
    expect(thousands(123)).toBe('123')
  })

  test('case 4', () => {
    expect(thousands(12)).toBe('12')
  })

  test('case 5', () => {
    expect(thousands(12.23)).toBe('12.23')
  })

  test('case 6', () => {
    expect(thousands(12345.123)).toBe('12,345.123')
  })

  test('case 7', () => {
    expect(thousands(1234567.123)).toBe('1,234,567.123')
  })

  test('case 8', () => {
    expect(thousands(1234567.1234)).toBe('1,234,567.1234')
  })

  test('case 9', () => {
    expect(thousandsByReg(1234567.125)).toBe('1,234,567.125')
  })

  test('case 10', () => {
    expect(thousandsByNative(1234567.125)).toBe('1,234,567.125')
  })
})
