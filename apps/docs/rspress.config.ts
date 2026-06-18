import { transformerNotationErrorLevel } from '@shikijs/transformers'
import { pluginNodePolyfill } from '@rsbuild/plugin-node-polyfill'
import { defineConfig } from '@rspress/core'
import mermaid from 'rspress-plugin-mermaid'
import {
  d2PreRenderPlugin,
  type D2PreRenderOptions,
} from './plugins/d2PreRender'
import { pluginImageZoom } from './plugins/imageZoom'
import { pluginRoutePathRewrite } from './plugins/routePathRewrite'
import {
  AI_PATH,
  CODE_PATH,
  EXPERIENCES_PATH,
  getDraftMarkdownExcludePaths,
  getFirstLink,
  getGeneratedSidebar,
  getMermaidRoutePaths,
  getSiteUrl,
  getRouteUrl,
  getWhitespaceMarkdownExcludePaths,
} from './utils'

const BASE_PATH = process.env.NODE_ENV === 'production' ? '/' : '/thinking/'
const SITE_URL = 'https://thinking.youngluo.com'
const SITE_ORIGIN = `${SITE_URL}${BASE_PATH}`
const SITE_TITLE = 'Thinking'
const SITE_DESCRIPTION =
  '我叫阿良的技术笔记，记录前端工程、架构实践、计算机基础与 AI Agent 的长期思考。'
const SITE_KEYWORDS =
  '前端工程,前端架构,React,Vue,TypeScript,JavaScript,AI Agent,LLM,计算机基础,技术笔记'
const SIDEBAR_GROUP_ORDERS: Record<string, string[]> = {
  [EXPERIENCES_PATH]: [
    '架构',
    '浏览器原理',
    '构建工具',
    'React',
    '性能优化与监控',
  ],
  [AI_PATH]: ['Agent'],
  [CODE_PATH]: ['算法', '设计模式', '数据结构', '函数式', '工具函数'],
}
const d2PreRenderOptions: D2PreRenderOptions = {
  prelude: `
  classes: {
    group: {
      style.fill: "#fffaf0"
    }
    fail: {
      style.fill: "#ffcdd2"
    }
    ok: {
      style.fill: "#c8e6c9"
    }
    decision: {
      style.fill: "#e1bee7"
    }
  }

  ***.style.stroke-width: 1
  (*** -> ***)[*]: {
    style.stroke-width: 2
  }
  `,
}

const experiences = getGeneratedSidebar(EXPERIENCES_PATH, SIDEBAR_GROUP_ORDERS)
const ai = getGeneratedSidebar(AI_PATH, SIDEBAR_GROUP_ORDERS)
const code = getGeneratedSidebar(CODE_PATH, SIDEBAR_GROUP_ORDERS)

export default defineConfig({
  root: '.',
  base: BASE_PATH,
  lang: 'zh',
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  head: [
    ['meta', { name: 'author', content: '我叫阿良' }],
    ['meta', { name: 'keywords', content: SITE_KEYWORDS }],
    ['meta', { name: 'robots', content: 'index,follow' }],
    (route) => [
      'link',
      { rel: 'canonical', href: getRouteUrl(SITE_ORIGIN, route.routePath) },
    ],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: SITE_TITLE }],
    ['meta', { property: 'og:title', content: SITE_TITLE }],
    ['meta', { property: 'og:description', content: SITE_DESCRIPTION }],
    (route) => [
      'meta',
      {
        property: 'og:url',
        content: getRouteUrl(SITE_ORIGIN, route.routePath),
      },
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
      url: getSiteUrl(SITE_ORIGIN),
      author: {
        '@type': 'Person',
        name: '我叫阿良',
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
      'plugins/**',
      'rspress.config.ts',
      'scripts/**',
      'theme/**',
      'utils.ts',
      ...getDraftMarkdownExcludePaths(),
      ...getWhitespaceMarkdownExcludePaths(),
    ],
  },
  themeConfig: {
    nav: [
      { text: '前端思考', link: getFirstLink(experiences) },
      { text: 'AI', link: getFirstLink(ai) },
      { text: '代码笔记', link: getFirstLink(code) },
    ],
    sidebar: {
      '/experiences/': experiences,
      '/ai/': ai,
      '/code/': code,
    },
    // lastUpdated: true,
  },
  builderConfig: {
    plugins: [pluginNodePolyfill()],
    dev: {
      lazyCompilation: false,
    },
  },
  plugins: [
    mermaid(),
    pluginRoutePathRewrite(),
    pluginImageZoom({
      selector: '.rspress-doc .d2-diagram > svg',
    }),
    d2PreRenderPlugin(d2PreRenderOptions),
  ],
  markdown: {
    shiki: {
      transformers: [transformerNotationErrorLevel()],
    },
  },
  mediumZoom: false,
})
