import { getRouteUrl, getSiteUrl } from '../utils'

type HeadRoute = {
  routePath: string
}

type HeadItem =
  | string
  | [string, Record<string, string>]
  | ((route: HeadRoute) => [string, Record<string, string>])

const SITE_URL = 'https://thinking.youngluo.com'
const SITE_NAME = "Aliang's thinking"
const SITE_DESCRIPTION = `${SITE_NAME} 是 aliang 的个人技术笔记，关注前端工程、React、Vue、TypeScript 与 AI Agent 实践。`
const SITE_KEYWORDS = [
  'aliang',
  '我叫阿良',
  '阿良',
  '前端',
  '技术博客',
  'React',
  'Vue',
  'TypeScript',
  'JavaScript',
  '工程化',
  '前端架构',
  'AI Agent',
]
const AUTHOR_NAME = 'aliang'
const AUTHOR_ALTERNATE_NAME = ['Aliang', '我叫阿良', 'youngluo']
const AUTHOR_SAME_AS = [
  'https://github.com/youngluo',
  'https://github.com/youngluo/thinking',
]

export function getSiteOrigin(basePath: string) {
  return `${SITE_URL}${basePath}`
}

export type SeoConfig = {
  siteHomeUrl: string
  siteOrigin: string
  siteTitle: string
  siteDescription: string
  head: HeadItem[]
}

export function createSeoConfig(basePath: string): SeoConfig {
  const siteOrigin = getSiteOrigin(basePath)
  const siteHomeUrl = getSiteUrl(siteOrigin)
  const authorUrl = siteHomeUrl

  return {
    siteHomeUrl,
    siteOrigin,
    siteTitle: SITE_NAME,
    siteDescription: SITE_DESCRIPTION,
    head: [
      ['meta', { name: 'author', content: AUTHOR_NAME }],
      ['meta', { name: 'keywords', content: SITE_KEYWORDS.join(',') }],
      ['meta', { name: 'robots', content: 'index,follow' }],
      ['meta', { name: 'theme-color', content: '#ffffff' }],
      (route) => [
        'link',
        { rel: 'canonical', href: getRouteUrl(siteOrigin, route.routePath) },
      ],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:site_name', content: SITE_NAME }],
      ['meta', { property: 'og:title', content: SITE_NAME }],
      ['meta', { property: 'og:description', content: SITE_DESCRIPTION }],
      (route) => [
        'meta',
        {
          property: 'og:url',
          content: getRouteUrl(siteOrigin, route.routePath),
        },
      ],
      ['meta', { property: 'og:locale', content: 'zh_CN' }],
      ['meta', { name: 'twitter:card', content: 'summary' }],
      `<script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Person',
            '@id': `${authorUrl}#person`,
            name: AUTHOR_NAME,
            alternateName: AUTHOR_ALTERNATE_NAME,
            url: authorUrl,
            sameAs: AUTHOR_SAME_AS,
          },
          {
            '@type': 'Blog',
            '@id': `${siteHomeUrl}#blog`,
            name: SITE_NAME,
            alternateName: SITE_NAME,
            description: SITE_DESCRIPTION,
            url: siteHomeUrl,
            keywords: SITE_KEYWORDS,
            author: {
              '@id': `${authorUrl}#person`,
            },
            publisher: {
              '@id': `${authorUrl}#person`,
            },
            inLanguage: 'zh-CN',
          },
        ],
      })}</script>`,
    ],
  }
}
