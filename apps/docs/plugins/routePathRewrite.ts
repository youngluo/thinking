import type { RspressPlugin } from '@rspress/core'
import { readFileSync, readdirSync } from 'fs'
import { dirname, extname, isAbsolute, join, relative, sep } from 'path'

const DOCS_ROOT = dirname(
  dirname(decodeURIComponent(new URL(import.meta.url).pathname))
)
const EXPERIENCES_PATH = 'experiences'
const CODE_PATH = 'code'

function sanitizeRoutePath(pathname: string) {
  return pathname.replace(/\s+/g, '_')
}

function toPublicRoutePath(pathname: string) {
  return sanitizeRoutePath(pathname)
}

function getMarkdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(dir, entry.name)

    if (entry.isDirectory()) {
      return getMarkdownFiles(filePath)
    }

    return entry.isFile() && entry.name.endsWith('.md') ? [filePath] : []
  })
}

function toRoutePath(filePath: string) {
  return `/${relative(DOCS_ROOT, filePath)
    .split(sep)
    .join('/')
    .replace(/\.md$/, '')}`
}

function isDraftMarkdownFile(filePath: string) {
  const frontmatter = readFileSync(filePath, 'utf-8').match(
    /^---\n([\s\S]*?)\n---/
  )

  return Boolean(frontmatter?.[1].match(/^draft:\s*true\s*$/m))
}

function getPublishedMarkdownFiles(dir: string) {
  return getMarkdownFiles(dir).filter(
    (filePath) => !isDraftMarkdownFile(filePath)
  )
}

function parseInternalUrl(url: string) {
  const [pathnameWithSearch, hash = ''] = url.split('#')
  const [pathname, search = ''] = pathnameWithSearch.split('?')

  return {
    pathname,
    search: search ? `?${search}` : '',
    hash: hash ? `#${hash}` : '',
  }
}

function isExternalUrl(url: string) {
  return /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//')
}

function toPublicMarkdownUrl(url: string, filePath: string) {
  if (!url || url.startsWith('#') || isExternalUrl(url)) {
    return url
  }

  const { pathname, search, hash } = parseInternalUrl(url)

  if (!pathname) {
    return url
  }

  if (pathname.endsWith('.md')) {
    const targetFile = isAbsolute(pathname)
      ? join(DOCS_ROOT, pathname)
      : join(dirname(filePath), pathname)

    return `${toPublicRoutePath(toRoutePath(targetFile))}.html${search}${hash}`
  }

  const extension = extname(pathname)
  const suffix = extension ? '' : '.html'

  return `${toPublicRoutePath(pathname)}${suffix}${search}${hash}`
}

function getWhitespaceMarkdownFiles() {
  return [EXPERIENCES_PATH, CODE_PATH]
    .flatMap((dir) => getPublishedMarkdownFiles(join(DOCS_ROOT, dir)))
    .filter((filePath) => /\s/.test(toRoutePath(filePath)))
}

export function pluginRoutePathRewrite(): RspressPlugin {
  return {
    name: 'plugin-route-path-rewrite',
    routeServiceGenerated(routeService) {
      const isExistRoute = routeService.isExistRoute.bind(routeService)

      routeService.isExistRoute = (link: string) =>
        isExistRoute(link) || isExistRoute(toPublicRoutePath(link))
    },
    markdown: {
      remarkPlugins: [
        () => (tree, file) => {
          const rewrite = (node: { url?: unknown }) => {
            if (typeof node.url === 'string') {
              node.url = toPublicMarkdownUrl(node.url, String(file.path))
            }
          }
          const visit = (node: unknown) => {
            if (!node || typeof node !== 'object') {
              return
            }

            const current = node as {
              type?: unknown
              children?: unknown
              url?: unknown
            }

            if (current.type === 'link' || current.type === 'definition') {
              rewrite(current)
            }

            if (Array.isArray(current.children)) {
              current.children.forEach(visit)
            }
          }

          visit(tree)
        },
      ],
    },
    addPages() {
      return getWhitespaceMarkdownFiles().map((filePath) => ({
        routePath: toPublicRoutePath(toRoutePath(filePath)),
        filepath: filePath,
      }))
    },
  }
}
