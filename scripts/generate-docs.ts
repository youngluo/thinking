import {
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  rmSync,
} from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const docsDir = join(rootDir, 'docs')
const srcDir = join(rootDir, 'src')

interface FunctionDoc {
  title: string
  description: string
  code: string
  hasSummary: boolean
}

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

    // 跳过已被使用的范围（包括函数内部的 const）
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
        .map((l) => l.replace(/^\s*\*\s?/, '').replace(/\s*$/, ''))

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
        .replace(/^( *)/gm, (_, spaces) =>
          spaces
            ? spaces
                .split('')
                .map(() => '&nbsp;')
                .join('')
            : ''
        )
        .replace(/\n/g, '<br/>')
        .replace(/\{\{/g, '&#123;&#123;')
        .replace(/\}\}/g, '&#125;&#125;')
    }

    const nextJsdoc = content.indexOf('/**', funcStart + funcSignature.length)
    const funcEnd = nextJsdoc === -1 ? content.length : nextJsdoc
    const beforeFunc = content.substring(0, funcStart)
    const lastNewline = beforeFunc.lastIndexOf('\n')
    let code = content.substring(lastNewline + 1, funcEnd)
    code = code
      .split('\n')
      .map((l) => l.replace(/\s+$/, ''))
      .join('\n')

    usedRanges.push([funcStart, funcEnd])
    docs.push({ title, description, code, hasSummary })
  }

  return docs
}

function getAllTsFiles(
  dir: string,
  excludeDirs: string[] = ['__tests__']
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

function generateDocs() {
  const writingDir = join(docsDir, 'writings')
  if (existsSync(writingDir)) {
    rmSync(writingDir, { recursive: true })
  }
  mkdirSync(writingDir, { recursive: true })

  const tsFiles = getAllTsFiles(srcDir)

  for (const file of tsFiles) {
    const content = readFileSync(file, 'utf-8')
    const funcDocs = extractFunctionDocs(content)
    if (funcDocs.length === 0) continue

    const filename = file.split('/').pop()!.replace('.ts', '')
    const relativePath = file.replace(srcDir + '/', '')
    const [categoryDir] = relativePath.split('/')
    const category = categoryDir

    const description =
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

    const outputDir = join(docsDir, 'writings', category)
    mkdirSync(outputDir, { recursive: true })

    writeFileSync(join(outputDir, filename + '.md'), description)
    console.log('Generated: ' + outputDir + '/' + filename + '.md')
  }
}

generateDocs()
