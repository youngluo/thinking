# template

一个模板和一个对象，利用对象中的数据渲染模板，并返回最终结果。<br/>let template = '您好，今天是&#123;&#123; date &#125;&#125;，现在位于&#123;&#123;group.name&#125;&#125;，这里有&#123;&#123;group.foods[0]&#125;&#125;、&#123;&#123;group["foods"][1]&#125;&#125;等美食。'<br/>let obj = {<br/>&nbsp;&nbsp;group: {<br/>&nbsp;&nbsp;&nbsp;&nbsp;name: '成都市',<br/>&nbsp;&nbsp;&nbsp;&nbsp;foods: ['火锅', '烧烤']<br/>&nbsp;&nbsp;},<br/>&nbsp;&nbsp;date: '2021年7月19日'<br/>}

```ts
export function template(tpl: string) {
  const string = tpl.replace(/\{\{(.+?)\}\}/g, (_, v) => `\${this.${v.trim()}}`)
  const func = new Function(`return \`${string}\``)

  return (data: Record<string, unknown>) => func.call(data)
}

```
