/**
 * 一个模板和一个对象，利用对象中的数据渲染模板，并返回最终结果。
 * let template = '您好，今天是{{ date }}，现在位于{{group.name}}，这里有{{group.foods[0]}}、{{group["foods"][1]}}等美食。'
 * let obj = {
 *   group: {
 *     name: '成都市',
 *     foods: ['火锅', '烧烤']
 *   },
 *   date: '2021年7月19日'
 * }
 */
export function template(tpl: string) {
  const string = tpl.replace(/\{\{(.+?)\}\}/g, (match, v) => `\$\{this.${v.trim()}\}`)
  const func = new Function(`return \`${string}\``)

  return (data: Record<string, unknown>) => func.call(data)
}
