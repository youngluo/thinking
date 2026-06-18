import chokidar from 'chokidar'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { basename, dirname, join, relative, sep } from 'path'
import { fileURLToPath } from 'url'

const currentFilePath = fileURLToPath(import.meta.url)
const docsRoot = join(dirname(currentFilePath), '..')
const rootDir = join(docsRoot, '../..')
const sourceDir = join(rootDir, 'packages/utils/src')
const outputDir = join(docsRoot, 'code')
const debounceMs = 100

interface FunctionDoc {
  title: string
  description: string
  code: string
  hasSummary: boolean
}

interface CodeDocPage {
  category: string
  content: string
  routePath: string
  text: string
}

type WatchCodeDocsOptions = {
  clean?: boolean
}

const excludeDirs = ['__tests__']

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

function getAllTsFiles(dir: string): string[] {
  const files: string[] = []
  if (!existsSync(dir)) return files

  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!excludeDirs.includes(entry.name)) {
        files.push(...getAllTsFiles(join(dir, entry.name)))
      }
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(join(dir, entry.name))
    }
  }

  return files
}

function sanitizeRoutePath(pathname: string) {
  return pathname.replace(/\s+/g, '_')
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

function getCodeDocPages(): CodeDocPage[] {
  return getAllTsFiles(sourceDir).flatMap((filePath) => {
    const content = readFileSync(filePath, 'utf-8')
    const funcDocs = extractFunctionDocs(content)
    if (funcDocs.length === 0) return []

    const filename = basename(filePath).replace(/\.ts$/, '')
    const relativePath = relative(sourceDir, filePath).split(sep)
    const category = relativePath[0]
    const routePath = sanitizeRoutePath(`/code/${category}/${filename}`)

    return {
      category,
      content: buildPageContent(filename, funcDocs),
      routePath,
      text: filename,
    }
  })
}

function getOutputPath(page: CodeDocPage) {
  const relativePath = page.routePath.replace('/code', '').replace(/^\/+/, '')

  return join(outputDir, `${relativePath}.md`)
}

function getGeneratedMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return []

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(dir, entry.name)

    if (entry.isDirectory()) {
      return getGeneratedMarkdownFiles(filePath)
    }

    return entry.isFile() && entry.name.endsWith('.md') ? [filePath] : []
  })
}

function generateCodeDocs(clean: boolean) {
  const pages = getCodeDocPages()
  const nextOutputPaths = new Set(pages.map(getOutputPath))

  if (clean) {
    rmSync(outputDir, { force: true, recursive: true })
  } else {
    getGeneratedMarkdownFiles(outputDir).forEach((filePath) => {
      if (!nextOutputPaths.has(filePath)) {
        rmSync(filePath, { force: true })
      }
    })
  }

  mkdirSync(outputDir, { recursive: true })

  pages.forEach((page) => {
    const outputPath = getOutputPath(page)

    mkdirSync(dirname(outputPath), { recursive: true })
    if (
      !clean &&
      existsSync(outputPath) &&
      readFileSync(outputPath, 'utf-8') === page.content
    ) {
      return
    }

    writeFileSync(outputPath, page.content)
  })

  return pages
}

export function syncCodeDocs(clean = true) {
  const pages = generateCodeDocs(clean)

  console.log(`[code-docs] generated ${pages.length} pages`)
}

export function watchCodeDocs(options: WatchCodeDocsOptions = {}) {
  let timeout: ReturnType<typeof setTimeout> | undefined

  const scheduleSync = () => {
    if (timeout) {
      clearTimeout(timeout)
    }

    timeout = setTimeout(() => {
      syncCodeDocs(options.clean ?? false)
    }, debounceMs)
  }

  const watcher = chokidar.watch(sourceDir, {
    ignoreInitial: true,
    ignored: (path, stats) =>
      path.includes('__tests__') ||
      (!!stats?.isFile() && !path.endsWith('.ts')) ||
      path.endsWith('.test.ts'),
  })

  watcher.on('add', scheduleSync)
  watcher.on('change', scheduleSync)
  watcher.on('unlink', scheduleSync)
  watcher.on('addDir', scheduleSync)
  watcher.on('unlinkDir', scheduleSync)
  watcher.on('error', (error) => {
    console.error('[code-docs] watcher error', error)
  })

  console.log(`[code-docs] watching ${sourceDir}`)

  return {
    close: async () => {
      if (timeout) {
        clearTimeout(timeout)
      }

      await watcher.close()
    },
  }
}

function runBuildCommand() {
  const command = process.argv[2]

  if (command !== 'build') {
    console.error('Usage: tsx scripts/code-docs.ts build')
    process.exit(1)
  }

  syncCodeDocs(true)
}

if (process.argv[1] === currentFilePath) {
  runBuildCommand()
}
