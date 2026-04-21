/**
 * 链表消消乐。先找到最长连续重复字符串，消除掉，再找，在消除，直到最后无法消除为止。
 * 1 2 3 3 2 1 → 空
 * 1 2 3 3 4 → 124
 * 1 2 2 3 3 3 2 4 4 4 5 5 → 1
 */
export function eliminate(str: string): string {
  const strArray = str.split('')
  const n = strArray.length
  let i = 0
  let j = 1
  let maxLen = 0
  let startIndex = 0

  while (i < n && j < n) {
    if (strArray[j] === strArray[i]) {
      j++
      const len = j - i
      if (len > maxLen) {
        maxLen = len
        startIndex = i
      }
    } else {
      i++
      j++
    }
  }

  if (maxLen > 0) {
    strArray.splice(startIndex, maxLen)
    return eliminate(strArray.join(''))
  } else {
    return strArray.join('')
  }
}
