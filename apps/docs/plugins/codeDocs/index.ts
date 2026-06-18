import type { RspressPlugin } from '@rspress/core'
import {
  existsSync,
  readdirSync,
  statSync,
  watch as watchFileSystem,
  type FSWatcher,
} from 'fs'
import { writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  getCodeDocPages,
  getCodeDocsSidebar,
  type CodeDocsGeneratorOptions,
} from './generator'
import { getFirstLink } from '../../utils'

type WatchOptions = {
  debounceMs?: number
}

export interface CodeDocsPluginOptions extends Partial<CodeDocsGeneratorOptions> {
  navText?: string
  sidebarGroupOrder?: string[]
  watch?: boolean
  watchOptions?: WatchOptions
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const docsRoot = join(__dirname, '../..')
const rootDir = join(docsRoot, '../..')

function getDefaultSourceDir() {
  return join(rootDir, 'packages/utils/src')
}

function normalizeRoutePrefix(routePrefix = '/code') {
  return `/${routePrefix.replace(/^\/+|\/+$/g, '')}`
}

function toSidebarKey(routePrefix: string) {
  return `${normalizeRoutePrefix(routePrefix)}/`
}

function hasNavText(item: unknown, text: string) {
  return (
    !!item &&
    typeof item === 'object' &&
    'text' in item &&
    (item as { text?: unknown }).text === text
  )
}

function getCodeDocs(options: CodeDocsPluginOptions) {
  const routePrefix = normalizeRoutePrefix(options.routePrefix)
  const pages = getCodeDocPages({
    excludeDirs: options.excludeDirs,
    routePrefix,
    sourceDir: options.sourceDir || getDefaultSourceDir(),
  })
  const sidebar = getCodeDocsSidebar(pages, options.sidebarGroupOrder)

  return {
    pages,
    routePrefix,
    sidebar,
  }
}

function getTempFilePath(index: number) {
  return join(docsRoot, 'node_modules/.rspress/runtime', `temp-${index}.mdx`)
}

function watchDirsRecursive(dir: string, onChange: () => void) {
  const watchers: FSWatcher[] = []
  const watchedDirs = new Set<string>()

  const watchDir = (currentDir: string) => {
    if (watchedDirs.has(currentDir) || !existsSync(currentDir)) {
      return
    }

    watchedDirs.add(currentDir)

    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== '__tests__') {
        watchDir(join(currentDir, entry.name))
      }
    }

    watchers.push(
      watchFileSystem(currentDir, (_eventType, filename) => {
        if (!filename) {
          onChange()
          return
        }

        const filePath = join(currentDir, String(filename))

        if (existsSync(filePath) && statSync(filePath).isDirectory()) {
          watchDir(filePath)
          onChange()
          return
        }

        if (
          filePath.endsWith('.ts') &&
          !filePath.endsWith('.test.ts') &&
          !filePath.includes('/__tests__/')
        ) {
          onChange()
        }
      })
    )
  }

  watchDir(dir)

  return () => {
    watchers.forEach((watcher) => watcher.close())
  }
}

function createCodeDocsDevWatcher(
  options: CodeDocsPluginOptions,
  onSynced: () => void
) {
  const sourceDir = options.sourceDir || getDefaultSourceDir()
  const debounceMs = options.watchOptions?.debounceMs ?? 100
  let timeout: ReturnType<typeof setTimeout> | undefined
  let knownRoutePaths = getCodeDocs(options).pages.map((page) => page.routePath)

  const syncPages = async () => {
    const pages = getCodeDocs(options).pages
    const routePaths = pages.map((page) => page.routePath)
    const routeChanged =
      routePaths.length !== knownRoutePaths.length ||
      routePaths.some(
        (routePath, index) => routePath !== knownRoutePaths[index]
      )

    if (routeChanged) {
      console.warn(
        '[plugin-code-docs] code doc routes changed. Restart Rspress dev server to refresh sidebar and routes.'
      )
      knownRoutePaths = routePaths
    }

    await Promise.all(
      pages.map((page, index) =>
        writeFile(getTempFilePath(index), page.content)
      )
    )
    onSynced()
  }

  const closeWatchers = watchDirsRecursive(sourceDir, () => {
    if (timeout) {
      clearTimeout(timeout)
    }

    timeout = setTimeout(() => {
      void syncPages()
    }, debounceMs)
  })

  return {
    close: () => {
      if (timeout) {
        clearTimeout(timeout)
      }

      closeWatchers()
    },
  }
}

export function pluginCodeDocs(
  options: CodeDocsPluginOptions = {}
): RspressPlugin {
  return {
    name: 'plugin-code-docs',
    config(config) {
      const { routePrefix, sidebar } = getCodeDocs(options)
      const sidebarKey = toSidebarKey(routePrefix)
      const navText = options.navText || '代码笔记'
      const themeConfig = config.themeConfig || {}
      const currentNav = Array.isArray(themeConfig.nav) ? themeConfig.nav : []
      const codeNav = sidebar.length
        ? {
            text: navText,
            link: getFirstLink(sidebar),
          }
        : undefined
      const nextNav = codeNav
        ? currentNav.some((item) => hasNavText(item, navText))
          ? currentNav.map((item) =>
              hasNavText(item, navText) ? codeNav : item
            )
          : [...currentNav, codeNav]
        : currentNav

      return {
        ...config,
        builderConfig: {
          ...config.builderConfig,
          server: {
            ...config.builderConfig?.server,
            setup: [
              ...[config.builderConfig?.server?.setup || []].flat(),
              (context) => {
                if (context.action !== 'dev' || options.watch === false) {
                  return
                }

                const watcher = createCodeDocsDevWatcher(options, () => {
                  context.server.sockWrite('static-changed')
                })

                return () => {
                  watcher.close()
                }
              },
            ],
          },
        },
        themeConfig: {
          ...themeConfig,
          nav: nextNav as typeof themeConfig.nav,
          sidebar: {
            ...themeConfig.sidebar,
            [sidebarKey]: sidebar,
          },
        },
      }
    },
    addPages() {
      return getCodeDocs(options).pages.map((page) => ({
        routePath: page.routePath,
        content: page.content,
      }))
    },
  }
}
