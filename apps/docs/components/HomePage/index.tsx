import type { FC } from 'react'
import { TrailCloud } from '../TrailCloud'
import './index.css'

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

const LATEST_ARTICLE_PLACEHOLDERS = Array.from(
  { length: 5 },
  (_, index) => index
)

export const HomePage: FC = () => {
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
              href="/thinking/experiences/架构/如何理解前端架构.html"
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

        <div className="thinking-home__panel" aria-label="最新文章预留位">
          <span className="thinking-home__panel-kicker">Latest</span>
          <p>最新文章</p>
          <ol className="thinking-home__latest-list" aria-hidden="true">
            {LATEST_ARTICLE_PLACEHOLDERS.map((index) => (
              <li key={index}>
                <span className="thinking-home__latest-index">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="thinking-home__latest-line">
                  <span />
                  <span />
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <TrailCloud trails={TRAILS} />

      <footer className="thinking-home__footer">
        <span>© {CURRENT_YEAR} 北冥有鱼</span>
      </footer>
    </main>
  )
}

HomePage.displayName = 'HomePage'
