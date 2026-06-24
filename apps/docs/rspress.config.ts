import { transformerNotationErrorLevel } from '@shikijs/transformers'
import { pluginNodePolyfill } from '@rsbuild/plugin-node-polyfill'
import { pluginSitemap } from '@rspress/plugin-sitemap'
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
  INTERVIEW_PATH,
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
const SITE_HOME_URL = getSiteUrl(SITE_ORIGIN)
const SITE_TITLE = 'Thinking'
const SITE_DESCRIPTION =
  '我叫阿良，这里记录前端、全栈、架构、与 AI Agent 的实践思考。'
const SITE_KEYWORDS =
  '前端,全栈,前端架构,React,Vue,TypeScript,JavaScript,AI Agent,LLM,技术笔记'
const AUTHOR_NAME = '我叫阿良'
const AUTHOR_ALTERNATE_NAMES = ['Young', 'youngluo']
const AUTHOR_URL = `${SITE_HOME_URL}about`
const GITHUB_PROFILE_URL = 'https://github.com/youngluo'
const GITHUB_REPOSITORY_URL = 'https://github.com/youngluo/thinking'
const UMAMI_SCRIPT_URL = process.env.DOCS_UMAMI_SCRIPT_URL
const UMAMI_WEBSITE_ID = process.env.DOCS_UMAMI_WEBSITE_ID
const SIDEBAR_GROUP_ORDERS: Record<string, string[]> = {
  [EXPERIENCES_PATH]: [
    '架构',
    '浏览器原理',
    '构建工具',
    'React',
    'Vue',
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
const interview = getGeneratedSidebar(INTERVIEW_PATH, SIDEBAR_GROUP_ORDERS)

export default defineConfig({
  root: '.',
  base: BASE_PATH,
  lang: 'zh',
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  head: [
    ['meta', { name: 'author', content: AUTHOR_NAME }],
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
    ...(UMAMI_SCRIPT_URL && UMAMI_WEBSITE_ID
      ? [
          `<script defer src="${UMAMI_SCRIPT_URL}" data-website-id="${UMAMI_WEBSITE_ID}"></script>`,
        ]
      : []),
    `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Person',
          '@id': `${AUTHOR_URL}#person`,
          name: AUTHOR_NAME,
          alternateName: AUTHOR_ALTERNATE_NAMES,
          url: AUTHOR_URL,
          sameAs: [GITHUB_PROFILE_URL, GITHUB_REPOSITORY_URL],
        },
        {
          '@type': 'WebSite',
          '@id': `${SITE_HOME_URL}#website`,
          name: SITE_TITLE,
          alternateName: 'Thinking',
          description: SITE_DESCRIPTION,
          url: SITE_HOME_URL,
          author: {
            '@id': `${AUTHOR_URL}#person`,
          },
          inLanguage: 'zh-CN',
        },
      ],
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
      { text: '面试题', link: getFirstLink(interview) },
      { text: '关于', link: '/about' },
    ],
    sidebar: {
      '/experiences/': experiences,
      '/ai/': ai,
      '/code/': code,
      '/interview/': interview,
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
    pluginSitemap({
      siteUrl: SITE_HOME_URL,
    }),
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
