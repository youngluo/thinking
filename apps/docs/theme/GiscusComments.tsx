import type { FC } from 'react'
import { useDark, usePage } from '@rspress/core/runtime'
import Giscus from '@giscus/react'

const GISCUS_CATEGORY_ID = process.env.DOCS_GISCUS_CATEGORY_ID ?? ''
const GISCUS_CATEGORY = process.env.DOCS_GISCUS_CATEGORY ?? ''
const GISCUS_REPO_ID = process.env.DOCS_GISCUS_REPO_ID ?? ''
const GISCUS_REPO = process.env.DOCS_GISCUS_REPO ?? ''

const hasGiscusConfig =
  GISCUS_REPO !== '' &&
  GISCUS_REPO_ID !== '' &&
  GISCUS_CATEGORY !== '' &&
  GISCUS_CATEGORY_ID !== ''

export const GiscusComments: FC = () => {
  const { page } = usePage()
  const isDark = useDark()

  if (!hasGiscusConfig) {
    return null
  }

  return (
    <div className="doc-comments">
      <Giscus
        repo={GISCUS_REPO as `${string}/${string}`}
        theme={isDark ? 'dark' : 'light'}
        categoryId={GISCUS_CATEGORY_ID}
        category={GISCUS_CATEGORY}
        repoId={GISCUS_REPO_ID}
        inputPosition="bottom"
        reactionsEnabled="0"
        key={page.routePath}
        mapping="pathname"
        emitMetadata="0"
        loading="lazy"
        lang="zh-CN"
        strict="0"
      />
    </div>
  )
}

GiscusComments.displayName = 'GiscusComments'
