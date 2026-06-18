import { existsSync, readFileSync, readdirSync } from 'fs'
import { basename, join, relative, sep } from 'path'
import type { SidebarItem } from '../../utils'

interface FunctionDoc {
  title: string
  description: string
  code: string
  hasSummary: boolean
}

export interface CodeDocsGeneratorOptions {
  sourceDir: string
  routePrefix?: string
  excludeDirs?: string[]
}

export interface CodeDocPage {
  category: string
  content: string
  filePath: string
  routePath: string
  text: string
}

const defaultExcludeDirs = ['__tests__']

function extractFunctionDocs(content: string): FunctionDoc[] {
  const docs: FunctionDoc[] = []
  const pattern =
    /\/\*\*([\s\S]*?)\*\/\s*\n((?:export\s+(?:default\s+)?)?(?:function|class|const)\s+(\w+))|((?:export\s+(?:default\s+)?)?(?:function|class|const)\s+(\w+))/g
  let match
  const usedRanges: [number, number][] = []

  while ((match = pattern.exec(content)) !== null) {
    const jsdoc = match[1]
    const funcSignature = match[2] || match[4]
    const funcName = match[3] || match[5]
    const funcStart = match.index + match[0].indexOf(funcSignature)

    if (
      usedRanges.some(([start, end]) => funcStart >= start && funcStart < end)
    ) {
      continue
    }

    let title = funcName
    let description = ''
    let hasSummary = false

    if (jsdoc) {
      const lines = jsdoc
        .split('\n')
        .map((line) => line.replace(/^\s*\*\s?/, '').replace(/\s*$/, ''))

      const summaryLine = lines.find((line) =>
        line.trim().startsWith('@summary')
      )
      hasSummary = !!summaryLine
      if (summaryLine) {
        title = summaryLine.replace('@summary', '').trim() || funcName
      }

      const processedLines: string[] = []
      for (const line of lines) {
        if (line.trim().startsWith('@')) continue
        if (line === summaryLine) continue
        processedLines.push(line)
      }

      description = processedLines
        .join('\n')
        .replace(/^\n+|\n+$/g, '')
        .replace(/^( *)/gm, (_, spaces: string) =>
          spaces
            ? spaces
                .split('')
                .map(() => '&nbsp;')
                .join('')
            : ''
        )
        .replace(/\{/g, '&#123;')
        .replace(/\}/g, '&#125;')
        .replace(/\n/g, '<br/>')
    }

    const nextJsdoc = content.indexOf('/**', funcStart + funcSignature.length)
    const funcEnd = nextJsdoc === -1 ? content.length : nextJsdoc
    const beforeFunc = content.substring(0, funcStart)
    const lastNewline = beforeFunc.lastIndexOf('\n')
    let code = content.substring(lastNewline + 1, funcEnd)
    code = code
      .split('\n')
      .map((line) => line.replace(/\s+$/, ''))
      .join('\n')

    usedRanges.push([funcStart, funcEnd])
    docs.push({ title, description, code, hasSummary })
  }

  return docs
}

function getAllTsFiles(
  dir: string,
  excludeDirs: string[] = defaultExcludeDirs
): string[] {
  const files: string[] = []
  if (!existsSync(dir)) return files

  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!excludeDirs.includes(entry.name)) {
        files.push(...getAllTsFiles(join(dir, entry.name), excludeDirs))
      }
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(join(dir, entry.name))
    }
  }

  return files
}

function normalizeRoutePrefix(routePrefix = '/code') {
  return `/${routePrefix.replace(/^\/+|\/+$/g, '')}`
}

function sanitizeRoutePath(pathname: string) {
  return pathname.replace(/\s+/g, '_')
}

function compareText(first: string, second: string) {
  return first.localeCompare(second, 'zh-CN')
}

function compareSidebarGroup(
  sidebarGroupOrder: string[],
  firstGroup: string,
  secondGroup: string
) {
  const firstIndex = sidebarGroupOrder.indexOf(firstGroup)
  const secondIndex = sidebarGroupOrder.indexOf(secondGroup)
  const firstKnown = firstIndex !== -1
  const secondKnown = secondIndex !== -1

  if (firstKnown || secondKnown) {
    if (!firstKnown) return 1
    if (!secondKnown) return -1
    if (firstIndex !== secondIndex) return firstIndex - secondIndex
  }

  return compareText(firstGroup, secondGroup)
}

function buildPageContent(filename: string, funcDocs: FunctionDoc[]) {
  return (
    `# ${filename}\n\n` +
    funcDocs
      .map((doc) => {
        if (doc.description) {
          return doc.hasSummary
            ? `## ${doc.title}\n${doc.description}\n\n\`\`\`ts\n${doc.code}\n\`\`\`\n`
            : `${doc.description}\n\n\`\`\`ts\n${doc.code}\n\`\`\`\n`
        }

        return `\`\`\`ts\n${doc.code}\n\`\`\`\n`
      })
      .join('\n')
  )
}

export function getCodeDocPages(
  options: CodeDocsGeneratorOptions
): CodeDocPage[] {
  const sourceDir = options.sourceDir
  const routePrefix = normalizeRoutePrefix(options.routePrefix)

  return getAllTsFiles(sourceDir, options.excludeDirs).flatMap((filePath) => {
    const content = readFileSync(filePath, 'utf-8')
    const funcDocs = extractFunctionDocs(content)
    if (funcDocs.length === 0) return []

    const filename = basename(filePath).replace(/\.ts$/, '')
    const relativePath = relative(sourceDir, filePath).split(sep)
    const category = relativePath[0]
    const routePath = sanitizeRoutePath(
      `${routePrefix}/${category}/${filename}`
    )

    return {
      category,
      content: buildPageContent(filename, funcDocs),
      filePath,
      routePath,
      text: filename,
    }
  })
}

export function getCodeDocsSidebar(
  pages: CodeDocPage[],
  sidebarGroupOrder: string[] = []
): SidebarItem[] {
  const groups = new Map<string, CodeDocPage[]>()

  pages.forEach((page) => {
    groups.set(page.category, [...(groups.get(page.category) || []), page])
  })

  return Array.from(groups.entries())
    .sort(([firstGroup], [secondGroup]) =>
      compareSidebarGroup(sidebarGroupOrder, firstGroup, secondGroup)
    )
    .map(([text, items]) => ({
      text,
      items: [...items]
        .sort((first, second) => compareText(first.text, second.text))
        .map((item) => ({
          text: item.text,
          link: item.routePath,
        })),
    }))
}
