/**
 * 实现一个函数，将数字转为中文输出，不超过 10000 亿
 * numberToChinese(100010001) ==> 一亿零一万零一
 */
export function numberToChinese(num: number) {
  if (isNaN(num) || typeof num !== 'number' || num >= 1000000000000) {
    return '无效的数字或数字过大'
  }
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
      // 排除“零零”、“零万”、“零亿”
    } else if (
      result.length > 0 &&
      result[0] !== chnNumber[0] &&
      result[0] !== chnGroupUnits[groupIndex]
    ) {
      result = chnNumber[0] + result
    }

    num = Math.floor(num / 10)

    if (num > 0 && ++unitIndex === 4) {
      // 排除“亿万”
      if (groupIndex > 0 && chnGroupUnits[groupIndex] === result[0]) {
        result = result.slice(1)
      }
      // 加零处理，例如 1001000、10010000000
      // const zero =
      //   num % 100 === 0 && result.length > 0 && result[0] !== chnNumber[0] ? chnNumber[0] : ''
      result = chnGroupUnits[++groupIndex] + result
      unitIndex = 0
    }
  }

  return result.replace(/^一十/, '十')
}
