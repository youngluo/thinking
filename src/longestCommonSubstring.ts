/**
 * 给定两个字符串 str1 和 str2，输出两个字符串的最长公共子串
 * 题目保证 str1 和 str2 的最长公共子串存在且唯一。
 * 输入："1AB2345CD"，"12345EF"
 * 返回值： "2345"
 */

export function longestCommonSubstring(str1: string, str2: string) {
  const m = str1.length
  const n = str2.length
  // 设 dp[i][j] 为 str1 [i, m), str2 [j, n) 的最长公共前缀
  const dp = new Array(m + 1).fill(0).map(() => new Array(n + 1).fill(0))
  let max = 0
  let str1Index = 0

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = str1[i] === str2[j] ? dp[i + 1][j + 1] + 1 : 0
      if (dp[i][j] > max) {
        max = dp[i][j]
        str1Index = i
      }
    }
  }

  return str1.slice(str1Index, str1Index + max)
}
