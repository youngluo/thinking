import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitepress'
import { size, map } from 'lodash-es'

type SidebarItem = {
  text: string
  collapsed?: boolean
  link?: string
  items?: SidebarItem[]
}

const writingsSidebar = [
  {
    text: '算法',
    items: [
      '最长公共子串',
      'reduplicationHandler',
      '排序算法',
      '查找最小的 k 个数',
      '链表消消乐',
    ],
  },
  { text: '数据结构', items: ['LinkedHashMap', 'LRU 缓存'] },
  { text: '设计模式', items: ['EventEmitter', 'observer'] },
  { text: '函数式', items: ['koa-compose', 'reduce', '柯里化'] },
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
].map((item) => {
  if (size(item.items) > 0) {
    return {
      text: item.text,
      collapsed: true,
      items: map(item.items, (page) => ({
        link: `/writings/${item.text}/${page}`,
        text: page,
      })),
    }
  }
  return { text: item.text, link: `/writings/${item.text}` }
})

const getFirstLink = (sidebar: SidebarItem[]) => {
  for (const item of sidebar) {
    if ('items' in item && item.items?.[0]) return item.items[0].link
    if ('link' in item) return item.link
  }
}

const experiencesSidebar: SidebarItem[] = [
  { text: '架构', items: ['如何理解前端架构'] },
  {
    text: '监控',
    items: ['日志采集', '性能指标采集', '性能异常监控', '页面崩溃监控'],
  },
  {
    text: '流处理',
    items: ['API 扫盲', 'AI 应用', '大文件处理', '实时音视频'],
  },
  { text: '数据请求' },
].map((item) => {
  if (size(item.items) > 0) {
    return {
      text: item.text,
      collapsed: true,
      items: map(item.items, (page) => ({
        link: `/experiences/${item.text}/${page}`,
        text: page,
      })),
    }
  }
  return { text: item.text, link: `/experiences/${item.text}` }
})

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/thinking/' : '/',
  title: 'Thinking',
  vite: {
    plugins: [tailwindcss()],
    cacheDir: '.vitepress/cache',
  },
  description: '前端经验总结',
  srcDir: '.',
  themeConfig: {
    nav: [
      { text: '项目经验', link: getFirstLink(experiencesSidebar)! },
      { text: '手写题', link: getFirstLink(writingsSidebar)! },
    ],
    sidebar: {
      '/experiences/': experiencesSidebar,
      '/writings/': writingsSidebar,
    },
  },
})
