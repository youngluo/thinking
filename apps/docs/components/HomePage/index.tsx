import type { FC } from 'react'
import { useMemo } from 'react'
import { usePages, withBase } from '@rspress/core/runtime'
import './index.css'

type LatestArticle = {
  title: string
  href: string
  createdAt: string
  dateTime: string
  createdAtMs: number
}

const CURRENT_YEAR = new Date().getFullYear()
const CREATED_AT_TIMEZONE = '+08:00'
const LATEST_ARTICLE_LIMIT = 12
const ARTICLE_ROUTE_PREFIXES = ['/experiences/', '/ai/'] as const

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
    createdAt: createdAt.split(' ')[0] ?? createdAt,
    dateTime: new Date(createdAtMs).toISOString(),
    createdAtMs,
  }
}

export const HomePage: FC = () => {
  const { pages } = usePages()
  const latestArticles = useMemo(() => {
    return pages
      .filter((page) =>
        ARTICLE_ROUTE_PREFIXES.some((prefix) =>
          page.routePath.startsWith(prefix)
        )
      )
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
      .filter((page): page is LatestArticle => page !== undefined)
      .sort((a, b) => {
        if (a.createdAtMs !== b.createdAtMs) {
          return b.createdAtMs - a.createdAtMs
        }

        return compareDesc(a.href, b.href)
      })
      .slice(0, LATEST_ARTICLE_LIMIT)
  }, [pages])

  return (
    <main className="thinking-home">
      <div className="thinking-home__inner">
        <header className="thinking-home__header">
          <div className="thinking-home__masthead">
            <div className="thinking-home__identity">
              <h1 className="thinking-home__eyebrow">Aliang&apos;s thinking</h1>
              <p className="thinking-home__intro">我叫阿良，一名前端爱好者。</p>
            </div>
            <nav className="thinking-home__links" aria-label="常用入口">
              <a href={withBase('/experiences/架构/如何理解前端架构.html')}>
                Blog
              </a>
              <a href="https://github.com/youngluo">GitHub</a>
            </nav>
          </div>
        </header>

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
            {latestArticles.map((article) => (
              <li key={article.href}>
                <a className="thinking-home__latest-link" href={article.href}>
                  <time
                    className="thinking-home__latest-date"
                    dateTime={article.dateTime}
                  >
                    {article.createdAt}
                  </time>
                  <span className="thinking-home__latest-title">
                    {article.title}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </section>

        <footer className="thinking-home__footer">
          <span>© {CURRENT_YEAR} 我叫阿良</span>
        </footer>
      </div>
    </main>
  )
}

HomePage.displayName = 'HomePage'
