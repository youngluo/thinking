import { createHash } from 'node:crypto'
import { D2, type CompileOptions } from '@terrastruct/d2'

type MarkdownNode = {
  type?: string
  lang?: string
  meta?: string
  value?: string
  children?: MarkdownNode[]
}

type MarkdownFile = {
  path?: string
  history?: string[]
}

export type D2PreRenderOptions = CompileOptions & {
  padX?: number
  prelude?: string
}

type PreparedD2Block = {
  code: string
  padX?: number
  options: CompileOptions
}

type D2DiagramConfig = CompileOptions & {
  layoutEngine?: 'dagre' | 'elk'
}

const d2 = new D2()
const renderCache = new Map<string, string>()

const defaultRenderOptions: CompileOptions = {
  noXMLTag: true,
  sketch: true,
  themeID: 8,
  pad: 32,
}

function getFilePath(file: MarkdownFile) {
  return file.path || file.history?.[0] || 'unknown markdown file'
}

function getBlockCacheKey(
  filePath: string,
  code: string,
  options: CompileOptions,
  padX?: number
) {
  return createHash('sha256')
    .update(filePath)
    .update('\0')
    .update(code)
    .update('\0')
    .update(JSON.stringify(options))
    .update('\0')
    .update(String(padX ?? ''))
    .digest('hex')
}

function getDiagramConfigOptions(config: unknown): CompileOptions {
  if (!config || typeof config !== 'object') {
    return {}
  }

  const { layout, layoutEngine, ...options } = config as D2DiagramConfig
  const nextLayout = layout ?? layoutEngine

  return Object.fromEntries(
    Object.entries({
      ...options,
      ...(nextLayout ? { layout: nextLayout } : {}),
    }).filter(([, value]) => value !== null && value !== undefined)
  )
}

function areCompileOptionsEqual(
  firstOptions: CompileOptions,
  secondOptions: CompileOptions
) {
  return JSON.stringify(firstOptions) === JSON.stringify(secondOptions)
}

function addSvgPadX(svg: string, padX?: number) {
  if (!padX || padX <= 0) {
    return svg
  }

  const viewBox = svg.match(/\bviewBox="([^"]+)"/)

  if (!viewBox) {
    return svg
  }

  const values = viewBox[1].trim().split(/\s+/).map(Number)

  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    return svg
  }

  const [x, y, width, height] = values
  const nextWidth = width + padX * 2
  const nextViewBox = `${x - padX} ${y} ${nextWidth} ${height}`

  return svg
    .replace(viewBox[0], `viewBox="${nextViewBox}"`)
    .replace(
      /\bpreserveAspectRatio="[^"]+"/,
      'preserveAspectRatio="xMidYMid meet"'
    )
}

function parsePadX(meta?: string) {
  if (!meta) {
    return undefined
  }

  const match = meta.match(/(?:^|\s)padX=(\d+(?:\.\d+)?)(?:\s|$)/)

  if (!match) {
    return undefined
  }

  const value = Number(match[1])

  return Number.isFinite(value) && value > 0 ? value : undefined
}

function prepareD2Block(
  code: string,
  options: D2PreRenderOptions,
  meta?: string
): PreparedD2Block {
  const { padX, prelude, ...d2Options } = options
  const content = code.trim()

  return {
    code: [prelude?.trim(), content].filter(Boolean).join('\n\n'),
    padX: parsePadX(meta) ?? padX,
    options: {
      ...defaultRenderOptions,
      ...d2Options,
    },
  }
}

async function compileD2(code: string, options: CompileOptions) {
  return d2.compile({
    fs: {
      index: code,
    },
    inputPath: 'index',
    options,
  })
}

async function resolveCompileOptions(
  code: string,
  options: CompileOptions,
  salt: string
) {
  const baseOptions = {
    ...options,
    salt,
  }
  const firstPassResult = await compileD2(code, baseOptions)
  const diagramOptions = getDiagramConfigOptions(firstPassResult.diagram.config)
  const finalOptions = {
    ...options,
    ...diagramOptions,
    salt,
  }

  if (areCompileOptionsEqual(baseOptions, finalOptions)) {
    return {
      options: finalOptions,
      result: firstPassResult,
    }
  }

  return {
    options: finalOptions,
    result: await compileD2(code, finalOptions),
  }
}

function assertSafeSvg(svg: string, filePath: string, blockIndex: number) {
  if (!svg.trim().startsWith('<svg')) {
    throw new Error(
      `[d2] ${filePath} code block #${blockIndex} did not render an SVG`
    )
  }

  if (/<script[\s>]/i.test(svg) || /\son[a-z]+\s*=/i.test(svg)) {
    throw new Error(
      `[d2] ${filePath} code block #${blockIndex} rendered unsafe SVG content`
    )
  }
}

async function renderD2(
  code: string,
  options: D2PreRenderOptions,
  filePath: string,
  blockIndex: number,
  meta?: string
) {
  const prepared = prepareD2Block(code, options, meta)

  try {
    const cacheKey = getBlockCacheKey(
      filePath,
      prepared.code,
      prepared.options,
      prepared.padX
    )
    const cached = renderCache.get(cacheKey)

    if (cached) {
      return cached
    }

    const { options: compileOptions, result } = await resolveCompileOptions(
      prepared.code,
      prepared.options,
      cacheKey.slice(0, 12)
    )

    const svg = await d2.render(result.diagram, {
      ...result.renderOptions,
      ...compileOptions,
    })
    const normalizedSvg = addSvgPadX(svg, prepared.padX)

    assertSafeSvg(normalizedSvg, filePath, blockIndex)

    const html = `<div class="d2-diagram" role="img">${normalizedSvg}</div>`
    renderCache.set(cacheKey, html)

    return html
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(
      `[d2] failed to render ${filePath} code block #${blockIndex}: ${message}`
    )
  }
}

async function visitD2CodeBlocks(
  node: MarkdownNode,
  options: D2PreRenderOptions,
  filePath: string,
  counter: { value: number }
) {
  if (node.type === 'code' && node.lang === 'd2') {
    counter.value += 1

    const code = node.value?.trim()

    if (!code) {
      throw new Error(
        `[d2] empty D2 code block in ${filePath} code block #${counter.value}`
      )
    }

    node.type = 'html'
    node.value = await renderD2(
      code,
      options,
      filePath,
      counter.value,
      node.meta
    )
    delete node.lang
    delete node.meta

    return
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      await visitD2CodeBlocks(child, options, filePath, counter)
    }
  }
}

export function remarkD2PreRender(options: D2PreRenderOptions = {}) {
  return async (tree: MarkdownNode, file: MarkdownFile) => {
    await visitD2CodeBlocks(tree, options, getFilePath(file), { value: 0 })
  }
}
