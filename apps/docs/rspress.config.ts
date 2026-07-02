import { transformerNotationErrorLevel } from '@shikijs/transformers'
import { pluginNodePolyfill } from '@rsbuild/plugin-node-polyfill'
import { pluginSitemap } from '@rspress/plugin-sitemap'
import { defineConfig } from '@rspress/core'
import mermaid from 'rspress-plugin-mermaid'
import { config as loadEnv } from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  type D2PreRenderOptions,
  d2PreRenderPlugin,
} from './plugins/d2PreRender'
import {
  getWhitespaceMarkdownExcludePaths,
  getDraftMarkdownExcludePaths,
  getMermaidRoutePaths,
  getGeneratedSidebar,
  EXPERIENCES_PATH,
  INTERVIEW_PATH,
  getFirstLink,
  CODE_PATH,
  AI_PATH,
} from './utils'
import { pluginRoutePathRewrite } from './plugins/routePathRewrite'
import { pluginImageZoom } from './plugins/imageZoom'
import { pluginHtmlMinifier } from './plugins/htmlMinifier'
import { createSeoConfig } from './config/seo'

const CONFIG_DIR = dirname(fileURLToPath(import.meta.url))

loadEnv({ path: join(CONFIG_DIR, '.env.local') })

const IS_PROD = process.env.NODE_ENV === 'production'
const BASE_PATH = IS_PROD ? '/' : '/thinking/'
const SEO = createSeoConfig(BASE_PATH)
const UMAMI_SCRIPT_URL = process.env.DOCS_UMAMI_SCRIPT_URL
const UMAMI_WEBSITE_ID = process.env.DOCS_UMAMI_WEBSITE_ID
const INCLUDE_DRAFT = !IS_PROD
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

const experiences = getGeneratedSidebar(
  EXPERIENCES_PATH,
  SIDEBAR_GROUP_ORDERS,
  { includeDraft: INCLUDE_DRAFT }
)
const ai = getGeneratedSidebar(AI_PATH, SIDEBAR_GROUP_ORDERS, {
  includeDraft: INCLUDE_DRAFT,
})
const code = getGeneratedSidebar(CODE_PATH, SIDEBAR_GROUP_ORDERS, {
  includeDraft: INCLUDE_DRAFT,
})
const interview = getGeneratedSidebar(INTERVIEW_PATH, SIDEBAR_GROUP_ORDERS, {
  includeDraft: INCLUDE_DRAFT,
})

export default defineConfig({
  root: '.',
  base: BASE_PATH,
  lang: 'zh',
  title: SEO.siteTitle,
  description: SEO.siteDescription,
  head: [
    ...SEO.head,
    ...(UMAMI_SCRIPT_URL && UMAMI_WEBSITE_ID
      ? [
          `<script defer src="${UMAMI_SCRIPT_URL}" data-website-id="${UMAMI_WEBSITE_ID}"></script>`,
        ]
      : []),
  ],
  ssg: {
    experimentalExcludeRoutePaths: getMermaidRoutePaths(),
  },
  route: {
    exclude: [
      'components/**',
      'config/**',
      'doc_build/**',
      'plugins/**',
      'rspress.config.ts',
      'scripts/**',
      'theme/**',
      'utils.ts',
      ...(IS_PROD ? ['code/**'] : []),
      ...(IS_PROD ? getDraftMarkdownExcludePaths() : []),
      ...getWhitespaceMarkdownExcludePaths(INCLUDE_DRAFT),
    ],
  },
  themeConfig: {
    nav: [
      { text: '前端思考', link: getFirstLink(experiences) },
      { text: 'AI', link: getFirstLink(ai) },
      ...(IS_PROD ? [] : [{ text: '代码笔记', link: getFirstLink(code) }]),
      ...(IS_PROD ? [] : [{ text: '面试题', link: getFirstLink(interview) }]),
    ],
    sidebar: {
      '/experiences/': experiences,
      '/ai/': ai,
      ...(IS_PROD ? {} : { '/code/': code }),
      ...(IS_PROD ? {} : { '/interview/': interview }),
    },
    // lastUpdated: true,
  },
  builderConfig: {
    plugins: [pluginNodePolyfill(), ...(IS_PROD ? [pluginHtmlMinifier()] : [])],
    source: {
      define: {
        'process.env.DOCS_GISCUS_REPO': JSON.stringify(
          process.env.DOCS_GISCUS_REPO ?? ''
        ),
        'process.env.DOCS_GISCUS_REPO_ID': JSON.stringify(
          process.env.DOCS_GISCUS_REPO_ID ?? ''
        ),
        'process.env.DOCS_GISCUS_CATEGORY': JSON.stringify(
          process.env.DOCS_GISCUS_CATEGORY ?? ''
        ),
        'process.env.DOCS_GISCUS_CATEGORY_ID': JSON.stringify(
          process.env.DOCS_GISCUS_CATEGORY_ID ?? ''
        ),
      },
    },
    dev: {
      lazyCompilation: false,
    },
  },
  plugins: [
    mermaid(),
    pluginSitemap({
      siteUrl: SEO.siteHomeUrl,
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
