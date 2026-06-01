import { Layout as OriginalLayout } from '@rspress/core/theme-original'
import { HomePage } from '../components/HomePage'
import './custom.css'

export * from '@rspress/core/theme-original'

export function Layout(props: Parameters<typeof OriginalLayout>[0]) {
  return <OriginalLayout {...props} HomeLayout={HomePage} />
}
