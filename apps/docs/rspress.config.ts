import mermaid from 'rspress-plugin-mermaid'
import { defineConfig } from '@rspress/core'
import { map, size, get } from 'lodash-es'

function getSidebar(
  sidebars: Array<{ text: string; items: string[] }>,
  path: string
) {
  return map(sidebars, (item) => {
    const page = item.items[0]
    if (size(item.items) > 1 || item.text !== page) {
      return {
        text: item.text,
        items: map(item.items, (page) => ({
          link: `/${path}/${item.text}/${page}`,
          text: page,
        })),
      }
    }
    return { text: page, link: `/${path}/${page}` }
  })
}

type SidebarItem = ReturnType<typeof getSidebar>[number]

function getFirstLink(sidebars: SidebarItem[]) {
  const item = sidebars[0]
  return (item.link || get(item, 'items[0].link')) as string
}

const writings = getSidebar(
  [
    {
      text: '算法',
      items: [
        '查找最小的 k 个数',
        '排序算法',
        '链表消消乐',
        '最长公共子串',
        'numberToChinese',
        'reduplicationHandler',
      ],
    },
    {
      text: '函数式',
      items: ['柯里化', 'koa-compose', 'reduce'],
    },
    {
      text: '设计模式',
      items: ['eventEmitter', 'observer'],
    },
    {
      text: '数据结构',
      items: ['LinkedHashMap', 'LRU 缓存'],
    },
    {
      text: '工具函数',
      items: [
        'bind',
        'concurrentHandle',
        'createRepeat',
        'debounce',
        'deepClone',
        'eq',
        'inherits',
        'iterable',
        'jsonp',
        'query',
        'retry',
        'sleep',
        'template',
        'thousands',
        'transform',
        'uniqueOrderArray',
      ],
    },
  ],
  'writings'
)

const experiences = getSidebar(
  [
    {
      text: '架构',
      items: ['如何理解前端架构'],
    },
    {
      text: '监控',
      items: ['日志采集', '性能指标采集', '性能异常监控', '页面崩溃监控'],
    },
    {
      text: '流处理',
      items: ['API 扫盲', 'AI 应用', '大文件处理', '实时音视频'],
    },
    {
      text: 'React',
      items: ['渲染机制'],
    },
    { text: '数据请求', items: ['数据请求'] },
  ],
  'experiences'
)

export default defineConfig({
  root: '.',
  base: '/thinking/',
  title: 'Thinking',
  description: '前端经验总结',
  themeConfig: {
    nav: [
      { text: '项目经验', link: getFirstLink(experiences) },
      { text: '手写题', link: getFirstLink(writings) },
    ],
    sidebar: {
      '/experiences/': experiences,
      '/writings/': writings,
    },
  },
  plugins: [
    mermaid({
      mermaidConfig: {
        themeCSS: 'text-align: center',
      },
    }),
  ],
})
