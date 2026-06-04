import { pluginNodePolyfill } from '@rsbuild/plugin-node-polyfill'
import mermaid from 'rspress-plugin-mermaid'
import { defineConfig } from '@rspress/core'
import { map, size, get } from 'lodash-es'
import { readFileSync, readdirSync } from 'fs'
import { dirname, join, relative, sep } from 'path'

const __dirname = dirname(decodeURIComponent(new URL(import.meta.url).pathname))
const BASE_PATH = '/thinking/'
const EXPERIENCES_PATH = 'experiences'
const WRITINGS_PATH = 'writings'
const SITE_URL = 'https://youngluo.github.io'
const SITE_ORIGIN = `${SITE_URL}${BASE_PATH}`
const SITE_TITLE = 'Thinking'
const SITE_DESCRIPTION =
  '北冥有鱼的技术笔记，记录前端工程、架构实践、计算机基础与 AI Agent 的长期思考。'
const SITE_KEYWORDS =
  '前端工程,前端架构,React,Vue,TypeScript,JavaScript,AI Agent,LLM,计算机基础,技术笔记'

function getSiteUrl(pathname = '') {
  return new URL(pathname.replace(/^\//, ''), SITE_ORIGIN).toString()
}

function getRouteUrl(routePath: string) {
  if (routePath === '/') {
    return getSiteUrl()
  }

  return getSiteUrl(
    routePath.endsWith('.html') ? routePath : `${routePath}.html`
  )
}

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

function getMarkdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(dir, entry.name)

    if (entry.isDirectory()) {
      return getMarkdownFiles(filePath)
    }

    return entry.isFile() && entry.name.endsWith('.md') ? [filePath] : []
  })
}

function getMermaidRoutePaths() {
  return [EXPERIENCES_PATH, WRITINGS_PATH]
    .flatMap((dir) => getMarkdownFiles(join(__dirname, dir)))
    .filter((filePath) =>
      readFileSync(filePath, 'utf-8').includes('```mermaid')
    )
    .map((filePath) => {
      return `/${relative(__dirname, filePath)
        .split(sep)
        .join('/')
        .replace(/\.md$/, '')}`
    })
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
      items: ['如何理解前端架构', '数据请求'],
    },
    {
      text: '多端',
      items: ['浏览器原理', '微信小程序'],
    },
    {
      text: '构建工具',
      items: ['Vite', 'Webpack', 'Rspack'],
    },
    {
      text: '监控',
      items: ['日志采集', '性能指标采集', '性能异常监控', '页面崩溃监控'],
    },
    {
      text: 'React',
      items: ['渲染机制', '调度机制', 'Reconcile', 'Zustand'],
    },
    {
      text: 'Agent',
      items: ['Harness', 'RAG', '提示词工程'],
    },
  ],
  'experiences'
)

export default defineConfig({
  root: '.',
  base: BASE_PATH,
  lang: 'zh',
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  head: [
    ['meta', { name: 'author', content: '北冥有鱼' }],
    ['meta', { name: 'keywords', content: SITE_KEYWORDS }],
    ['meta', { name: 'robots', content: 'index,follow' }],
    (route) => [
      'link',
      { rel: 'canonical', href: getRouteUrl(route.routePath) },
    ],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: SITE_TITLE }],
    ['meta', { property: 'og:title', content: SITE_TITLE }],
    ['meta', { property: 'og:description', content: SITE_DESCRIPTION }],
    (route) => [
      'meta',
      { property: 'og:url', content: getRouteUrl(route.routePath) },
    ],
    ['meta', { property: 'og:locale', content: 'zh_CN' }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
    ['meta', { name: 'twitter:title', content: SITE_TITLE }],
    ['meta', { name: 'twitter:description', content: SITE_DESCRIPTION }],
    `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_TITLE,
      description: SITE_DESCRIPTION,
      url: getSiteUrl(),
      author: {
        '@type': 'Person',
        name: '北冥有鱼',
        url: 'https://github.com/youngluo',
      },
      inLanguage: 'zh-CN',
      sameAs: ['https://github.com/youngluo/thinking'],
    })}</script>`,
  ],
  ssg: {
    experimentalExcludeRoutePaths: getMermaidRoutePaths(),
  },
  route: {
    exclude: ['components/**', 'doc_build/**', 'rspress.config.ts', 'theme/**'],
  },
  themeConfig: {
    nav: [
      { text: '思考总结', link: getFirstLink(experiences) },
      { text: '代码笔记', link: getFirstLink(writings) },
    ],
    sidebar: {
      '/experiences/': experiences,
      '/writings/': writings,
    },
    // lastUpdated: true,
  },
  builderConfig: {
    plugins: [pluginNodePolyfill()],
  },
  plugins: [mermaid()],
})
