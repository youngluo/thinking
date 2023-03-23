import { longestCommonSubstring } from '../longestCommonSubstring'

describe('longestCommonSubstring', () => {
  test('longestCommonSubstring("1AB2345CD", "12345EF") === "2345"', () => {
    expect(longestCommonSubstring('1AB2345CD', '12345EF')).toBe('2345')
  })

  test('longestCommonSubstring("12345CD", "12345EF") === "12345"', () => {
    expect(longestCommonSubstring('12345CD', '12345EF')).toBe('12345')
  })

  test('longestCommonSubstring("12345CD", "12345CD") === "12345CD"', () => {
    expect(longestCommonSubstring('12345CD', '12345CD')).toBe('12345CD')
  })

  test('longestCommonSubstring("", "") === ""', () => {
    expect(longestCommonSubstring('', '')).toBe('')
  })
})
