import { transformerNotationErrorLevel } from '@shikijs/transformers'
import { pluginNodePolyfill } from '@rsbuild/plugin-node-polyfill'
import mermaid from 'rspress-plugin-mermaid'
import { defineConfig, type RspressPlugin } from '@rspress/core'
import { map, size, get } from 'lodash-es'
import { readFileSync, readdirSync } from 'fs'
import { dirname, extname, isAbsolute, join, relative, sep } from 'path'

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
  return `${SITE_ORIGIN}${toPublicRoutePath(pathname).replace(/^\//, '')}`
}

function sanitizeRoutePath(pathname: string) {
  return pathname.replace(/\s+/g, '_')
}

function toPublicRoutePath(pathname: string) {
  return sanitizeRoutePath(pathname)
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
          link: toPublicRoutePath(`/${path}/${item.text}/${page}`),
          text: page,
        })),
      }
    }
    return { text: page, link: toPublicRoutePath(`/${path}/${page}`) }
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

function toRoutePath(filePath: string) {
  return `/${relative(__dirname, filePath)
    .split(sep)
    .join('/')
    .replace(/\.md$/, '')}`
}

function parseInternalUrl(url: string) {
  const [pathnameWithSearch, hash = ''] = url.split('#')
  const [pathname, search = ''] = pathnameWithSearch.split('?')

  return {
    pathname,
    search: search ? `?${search}` : '',
    hash: hash ? `#${hash}` : '',
  }
}

function isExternalUrl(url: string) {
  return /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//')
}

function toPublicMarkdownUrl(url: string, filePath: string) {
  if (!url || url.startsWith('#') || isExternalUrl(url)) {
    return url
  }

  const { pathname, search, hash } = parseInternalUrl(url)

  if (!pathname) {
    return url
  }

  if (pathname.endsWith('.md')) {
    const targetFile = isAbsolute(pathname)
      ? join(__dirname, pathname)
      : join(dirname(filePath), pathname)

    return `${toPublicRoutePath(toRoutePath(targetFile))}.html${search}${hash}`
  }

  const extension = extname(pathname)
  const suffix = extension ? '' : '.html'

  return `${toPublicRoutePath(pathname)}${suffix}${search}${hash}`
}

function getMermaidRoutePaths() {
  return [EXPERIENCES_PATH, WRITINGS_PATH]
    .flatMap((dir) => getMarkdownFiles(join(__dirname, dir)))
    .filter((filePath) =>
      readFileSync(filePath, 'utf-8').includes('```mermaid')
    )
    .map((filePath) => toPublicRoutePath(toRoutePath(filePath)))
}

function getWhitespaceMarkdownFiles() {
  return [EXPERIENCES_PATH, WRITINGS_PATH]
    .flatMap((dir) => getMarkdownFiles(join(__dirname, dir)))
    .filter((filePath) => /\s/.test(toRoutePath(filePath)))
}

function getWhitespaceMarkdownExcludePaths() {
  return getWhitespaceMarkdownFiles().map((filePath) =>
    relative(__dirname, filePath).split(sep).join('/')
  )
}

function pluginRoutePathRewrite(): RspressPlugin {
  return {
    name: 'plugin-route-path-rewrite',
    routeServiceGenerated(routeService) {
      const isExistRoute = routeService.isExistRoute.bind(routeService)

      routeService.isExistRoute = (link: string) =>
        isExistRoute(link) || isExistRoute(toPublicRoutePath(link))
    },
    markdown: {
      remarkPlugins: [
        () => (tree, file) => {
          const rewrite = (node: { url?: unknown }) => {
            if (typeof node.url === 'string') {
              node.url = toPublicMarkdownUrl(node.url, String(file.path))
            }
          }
          const visit = (node: unknown) => {
            if (!node || typeof node !== 'object') {
              return
            }

            const current = node as {
              type?: unknown
              children?: unknown
              url?: unknown
            }

            if (current.type === 'link' || current.type === 'definition') {
              rewrite(current)
            }

            if (Array.isArray(current.children)) {
              current.children.forEach(visit)
            }
          }

          visit(tree)
        },
      ],
    },
    addPages() {
      return getWhitespaceMarkdownFiles().map((filePath) => ({
        routePath: toPublicRoutePath(toRoutePath(filePath)),
        filepath: filePath,
      }))
    },
  }
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
      items: ['浏览器原理'],
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
      items: [
        'Harness Engineering 是什么',
        'RAG 是什么',
        '如何使用 LangChain 构建 RAG',
        'SSE 和 NDJSON 指南',
        '提示词工程',
        'SDD 实践',
      ],
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
    exclude: [
      'components/**',
      'doc_build/**',
      'rspress.config.ts',
      'theme/**',
      ...getWhitespaceMarkdownExcludePaths(),
    ],
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
  plugins: [mermaid(), pluginRoutePathRewrite()],
  markdown: {
    shiki: {
      transformers: [transformerNotationErrorLevel()],
    },
  },
})
