/**
 * 利用正则统计叠词数量，输出叠词去重后的结果
 */
export function reduplicationHandler(string: string) {
  // 叠词数量
  let count = 0
  let matches: Record<string, number> = {}
  // \1 获取第一个 () 匹配的引用
  const result = string.replace(/(.)\1+/g, (match, word) => {
    matches[word] = match.length
    count++
    return word
  })

  return {
    origin: string,
    result,
    count,
    matches,
  }
}
