import { eliminate } from '../eliminate'

describe('eliminate', () => {
  test('eliminate(1 2 3 3 2 1) === ""', () => {
    expect(eliminate('123321')).toBe('')
  })

  test('eliminate(1 2 3 3 4) === "1 2 4"', () => {
    expect(eliminate('12334')).toBe('124')
  })

  test('eliminate(1 2 2 3 3 3 2 4 4 4 5 5) === "1"', () => {
    expect(eliminate('122333244455')).toBe('1')
  })
})
