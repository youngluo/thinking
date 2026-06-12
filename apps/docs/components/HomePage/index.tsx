import type { FC } from 'react'
import { useMemo } from 'react'
import { usePages, withBase } from '@rspress/core/runtime'
import { TrailCloud } from '../TrailCloud'
import './index.css'

type LatestExperience = {
  title: string
  href: string
  createdAt: string
  dateTime: string
  createdAtMs: number
}

const TRAILS = [
  '前端架构',
  '微前端',
  'React.js',
  'Vue.js',
  'Angular',
  'Next.js',
  'Node',
  'Koa.js',
  'Nest.js',
  'Astro',
  'SvelteKit',
  'Nuxt.js',
  'Hono.js',
  'Remix',
  'TanStack Router',
  'TanStack Query',
  'Express.js',
  'Webpack',
  'Vite',
  'Rspack',
  'Rspress',
  'Rollup',
  'Taro',
  '微信小程序',
  '前端监控',
  'AI Agent',
  'LLM',
  'TypeScript',
  'JavaScript',
  'HTML5',
  '性能优化',
  '工程化',
  '浏览器原理',
  '模块化',
  '组件化',
  '设计模式',
  '数据结构',
  'RAG',
  'Harness',
  'CSS',
  'Tailwind CSS',
  'CSS Modules',
  'SCSS',
  'Less',
  'PostCSS',
  'Babel',
  'SWC',
  'esbuild',
  'ESM',
  'npm',
  'pnpm',
  'Yarn',
  'Monorepo',
  'Turborepo',
  'Vitest',
  'Playwright',
  'Storybook',
  'Redux',
  'Zustand',
  'Ant Design',
  'SSR',
  'SSG',
  'React Compiler',
  'RSC',
  'PWA',
  'Web Components',
  'Service Worker',
  'Web Worker',
  'Bun.js',
  'Biome',
  'Oxc',
  'shadcn/ui',
  'Core Web Vitals',
] as const

const CURRENT_YEAR = new Date().getFullYear()
const CREATED_AT_TIMEZONE = '+08:00'
const LATEST_EXPERIENCES_LIMIT = 5

function compareDesc(a: string, b: string) {
  if (a === b) {
    return 0
  }

  return a > b ? -1 : 1
}

function getCreatedAtMeta(createdAt: unknown) {
  if (typeof createdAt !== 'string') {
    return undefined
  }

  const createdAtMs = Date.parse(
    `${createdAt.replace(' ', 'T')}${CREATED_AT_TIMEZONE}`
  )

  if (Number.isNaN(createdAtMs)) {
    return undefined
  }

  return {
    createdAt,
    dateTime: new Date(createdAtMs).toISOString(),
    createdAtMs,
  }
}

export const HomePage: FC = () => {
  const { pages } = usePages()
  const latestExperiences = useMemo(() => {
    return pages
      .filter((page) => page.routePath.startsWith('/experiences/'))
      .map((page) => {
        const createdAt = getCreatedAtMeta(page.frontmatter.createdAt)

        if (!createdAt) {
          return undefined
        }

        return {
          title: page.title,
          href: withBase(`${page.routePath}.html`),
          ...createdAt,
        }
      })
      .filter((page): page is LatestExperience => page !== undefined)
      .sort((a, b) => {
        if (a.createdAtMs !== b.createdAtMs) {
          return b.createdAtMs - a.createdAtMs
        }

        return compareDesc(a.href, b.href)
      })
      .slice(0, LATEST_EXPERIENCES_LIMIT)
  }, [pages])

  return (
    <main className="thinking-home">
      <section className="thinking-home__hero">
        <div className="thinking-home__hero-copy">
          <p className="thinking-home__eyebrow">Thinking Notes</p>
          <h1 className="thinking-home__title">
            Stay Hungry.
            <span>Stay Foolish.</span>
          </h1>
          <p className="thinking-home__intro">
            记录前端工程、架构实践、计算机基础与 AI Agent 的长期思考。
          </p>
          <div className="thinking-home__actions">
            <a
              className="thinking-home__button thinking-home__button--primary"
              href={withBase('/experiences/架构/如何理解前端架构.html')}
            >
              开始阅读
            </a>
            <a
              className="thinking-home__button thinking-home__button--secondary"
              href="https://github.com/youngluo/thinking"
            >
              GitHub
            </a>
          </div>
        </div>

        <section
          className="thinking-home__panel"
          aria-labelledby="thinking-home-latest-title"
        >
          <h2
            className="thinking-home__panel-title"
            id="thinking-home-latest-title"
          >
            最新文章
          </h2>
          <ol className="thinking-home__latest-list">
            {latestExperiences.map((article, index) => (
              <li key={article.href}>
                <span className="thinking-home__latest-index">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <a className="thinking-home__latest-link" href={article.href}>
                  <span className="thinking-home__latest-title">
                    {article.title}
                  </span>
                  {/* <time
                    className="thinking-home__latest-date"
                    dateTime={article.dateTime}>
                    {article.createdAt}
                  </time> */}
                </a>
              </li>
            ))}
          </ol>
        </section>
      </section>

      <TrailCloud trails={TRAILS} />

      <footer className="thinking-home__footer">
        <span>© {CURRENT_YEAR} 北冥有鱼</span>
      </footer>
    </main>
  )
}

HomePage.displayName = 'HomePage'
