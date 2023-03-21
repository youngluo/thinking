/**
 * 实现一个函数，将数字转为中文输出，不超过 10000 亿
 * numberToChinese(100010001) ==> 一亿零一万零一
 */
export function numberToChinese(num: number): string {
  const chnNumber = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  const chnUnits = ['', '十', '百', '千']
  const chnGroupUnits = ['', '万', '亿']

  if (num === 0) {
    return chnNumber[0]
  }

  let result = ''
  let unitIndex = 0
  let groupIndex = 0

  while (num > 0) {
    const digit = num % 10
    if (digit !== 0) {
      result = chnNumber[digit] + chnUnits[unitIndex] + result
    } else {
      if (result[0] !== chnNumber[0]) {
        result = chnNumber[0] + result
      }
    }

    if (unitIndex++ === 4) {
      groupIndex++
      result = chnGroupUnits[groupIndex] + result
      unitIndex = 0
    }

    num = Math.floor(num / 10)
  }

  return result
}
