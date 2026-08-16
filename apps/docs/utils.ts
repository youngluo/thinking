import { existsSync, readFileSync, readdirSync } from 'fs'
import { dirname, join, relative, sep } from 'path'

export const DOCS_ROOT = dirname(
  decodeURIComponent(new URL(import.meta.url).pathname)
)
export const EXPERIENCES_PATH = 'experiences'
export const AI_PATH = 'ai'
export const CODE_PATH = 'code'
export const INTERVIEW_PATH = 'interview'
const CONTENT_PATHS = [EXPERIENCES_PATH, AI_PATH, CODE_PATH, INTERVIEW_PATH]

type MarkdownMeta = {
  order?: number
  createdAt?: number
  draft?: boolean
}

type MarkdownPage = MarkdownMeta & {
  group: string
  link: string
  sidebarText: string
  text: string
}

type GeneratedSidebarOptions = {
  includeDraft?: boolean
}

export type SidebarItem =
  | {
      text: string
      link: string
    }
  | {
      text: string
      items: Array<{ text: string; link: string }>
      collapsible: boolean
      collapsed: boolean
    }

export function getSiteUrl(siteOrigin: string, pathname = '') {
  return `${siteOrigin}${toPublicRoutePath(pathname).replace(/^\//, '')}`
}

export function getRouteUrl(siteOrigin: string, routePath: string) {
  if (routePath === '/') {
    return getSiteUrl(siteOrigin)
  }

  return getSiteUrl(
    siteOrigin,
    routePath.endsWith('.html') ? routePath : `${routePath}.html`
  )
}

export function getFirstLink(sidebars: SidebarItem[], fallback = '/') {
  const item = sidebars[0]

  if (!item) {
    return fallback
  }

  if ('link' in item) {
    return item.link
  }

  return item.items[0]?.link ?? fallback
}

function sanitizeRoutePath(pathname: string) {
  return pathname.replace(/\s+/g, '_')
}

function toPublicRoutePath(pathname: string) {
  return sanitizeRoutePath(pathname)
}

const MARKDOWN_EXTENSIONS = ['.md', '.mdx'] as const

function getMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(dir, entry.name)

    if (entry.isDirectory()) {
      return getMarkdownFiles(filePath)
    }

    if (!entry.isFile()) {
      return []
    }

    return MARKDOWN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))
      ? [filePath]
      : []
  })
}

function toRoutePath(filePath: string) {
  return `/${relative(DOCS_ROOT, filePath)
    .split(sep)
    .join('/')
    .replace(/\.(md|mdx)$/, '')}`
}

function parseMarkdownMeta(content: string): MarkdownMeta {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)

  if (!frontmatter) {
    return {}
  }

  const order = frontmatter[1].match(
    /^order:\s*['"]?(-?\d+(?:\.\d+)?)['"]?\s*$/m
  )
  const createdAt = frontmatter[1].match(/^createdAt:\s*['"]?(.+?)['"]?\s*$/m)
  const draft = frontmatter[1].match(/^draft:\s*(true|false)\s*$/m)
  const createdAtTime = createdAt
    ? Date.parse(createdAt[1].replace(' ', 'T') + '+08:00')
    : Number.NaN

  return {
    ...(order ? { order: Number(order[1]) } : {}),
    ...(Number.isNaN(createdAtTime) ? {} : { createdAt: createdAtTime }),
    ...(draft ? { draft: draft[1] === 'true' } : {}),
  }
}

function getMarkdownMeta(filePath: string) {
  return parseMarkdownMeta(readFileSync(filePath, 'utf-8'))
}

function isDraftMarkdownFile(filePath: string) {
  return getMarkdownMeta(filePath).draft === true
}

function getPublishedMarkdownFiles(dir: string) {
  return getMarkdownFiles(dir).filter(
    (filePath) => !isDraftMarkdownFile(filePath)
  )
}

function getVisibleMarkdownFiles(dir: string, includeDraft = false) {
  return includeDraft ? getMarkdownFiles(dir) : getPublishedMarkdownFiles(dir)
}

function compareText(first: string, second: string) {
  return first.localeCompare(second, 'zh-CN')
}

function compareMarkdownPage(first: MarkdownPage, second: MarkdownPage) {
  if (first.order !== undefined || second.order !== undefined) {
    if (first.order === undefined) {
      return 1
    }

    if (second.order === undefined) {
      return -1
    }

    if (first.order !== second.order) {
      return first.order - second.order
    }
  }

  if (first.createdAt !== undefined || second.createdAt !== undefined) {
    if (first.createdAt === undefined) {
      return 1
    }

    if (second.createdAt === undefined) {
      return -1
    }

    if (first.createdAt !== second.createdAt) {
      return first.createdAt - second.createdAt
    }
  }

  return compareText(first.text, second.text)
}

function compareSidebarGroup(
  sidebarGroupOrders: Record<string, string[]>,
  path: string,
  firstGroup: string,
  secondGroup: string
) {
  const groupOrder = sidebarGroupOrders[path] || []
  const firstIndex = groupOrder.indexOf(firstGroup)
  const secondIndex = groupOrder.indexOf(secondGroup)
  const firstKnown = firstIndex !== -1
  const secondKnown = secondIndex !== -1

  if (firstKnown || secondKnown) {
    if (!firstKnown) {
      return 1
    }

    if (!secondKnown) {
      return -1
    }

    if (firstIndex !== secondIndex) {
      return firstIndex - secondIndex
    }
  }

  return compareText(firstGroup, secondGroup)
}

export function getGeneratedSidebar(
  path: string,
  sidebarGroupOrders: Record<string, string[]>,
  options: GeneratedSidebarOptions = {}
): SidebarItem[] {
  const baseDir = join(DOCS_ROOT, path)
  const pages = getVisibleMarkdownFiles(baseDir, options.includeDraft).map(
    (filePath) => {
      const meta = getMarkdownMeta(filePath)
      const routePath = toPublicRoutePath(toRoutePath(filePath))
      const relativePath = relative(baseDir, filePath).split(sep)
      const text = relativePath.at(-1)!.replace(/\.(md|mdx)$/, '')

      return {
        ...meta,
        group: relativePath.length > 1 ? relativePath[0] : text,
        link: routePath,
        sidebarText:
          options.includeDraft && meta.draft === true
            ? `${text}（草稿）`
            : text,
        text,
      }
    }
  )

  const groups = new Map<string, MarkdownPage[]>()

  pages.forEach((page) => {
    groups.set(page.group, [...(groups.get(page.group) || []), page])
  })

  return Array.from(groups.entries())
    .sort(([firstGroup], [secondGroup]) =>
      compareSidebarGroup(sidebarGroupOrders, path, firstGroup, secondGroup)
    )
    .map(([text, items]) => {
      const sortedItems = [...items].sort(compareMarkdownPage)

      if (sortedItems.length === 1 && sortedItems[0].text === text) {
        return { text: sortedItems[0].sidebarText, link: sortedItems[0].link }
      }

      return {
        text,
        collapsible: true,
        collapsed: true,
        items: sortedItems.map((item) => ({
          text: item.sidebarText,
          link: item.link,
        })),
      }
    })
}

function getWhitespaceMarkdownFiles(includeDraft = false) {
  return CONTENT_PATHS.flatMap((dir) =>
    getVisibleMarkdownFiles(join(DOCS_ROOT, dir), includeDraft)
  ).filter((filePath) => /\s/.test(toRoutePath(filePath)))
}

export function getWhitespaceMarkdownExcludePaths(includeDraft = false) {
  return getWhitespaceMarkdownFiles(includeDraft).map((filePath) =>
    relative(DOCS_ROOT, filePath).split(sep).join('/')
  )
}

export function getDraftMarkdownExcludePaths() {
  return CONTENT_PATHS.flatMap((dir) => getMarkdownFiles(join(DOCS_ROOT, dir)))
    .filter(isDraftMarkdownFile)
    .map((filePath) => relative(DOCS_ROOT, filePath).split(sep).join('/'))
}
