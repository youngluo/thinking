/**
 * 实现一个函数，将数字转为中文输出，不超过 10000 亿
 * numberToChinese(100010001) ==> 一亿零一万零一
 */
export function numberToChinese(number: number): string {
  const chnNumber = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  const chnUnit = ['', '十', '百', '千']
  const result = ''

  while (number > 0) {
    const num = number % 10
  }

  return result
}
