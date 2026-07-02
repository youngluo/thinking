import { isProduction, useFrontmatter } from '@rspress/core/runtime'
import { Layout as OriginalLayout } from '@rspress/core/theme-original'
import { HomePage } from '../components/HomePage'
import { DraftNotice } from './DraftNotice'
import { GiscusComments } from './GiscusComments'
import './custom.css'

export * from '@rspress/core/theme-original'

export function Layout(props: Parameters<typeof OriginalLayout>[0]) {
  const { frontmatter } = useFrontmatter()
  const beforeDocContent =
    !isProduction() && frontmatter.draft === true ? <DraftNotice /> : null

  return (
    <OriginalLayout
      {...props}
      HomeLayout={HomePage}
      beforeDocContent={beforeDocContent}
      afterDocFooter={<GiscusComments />}
    />
  )
}
