import { createHash } from 'node:crypto'
import { D2, type CompileOptions } from '@terrastruct/d2'
import type { RspressPlugin } from '@rspress/core'

type MarkdownNode = {
  type?: string
  lang?: string
  meta?: string
  value?: string
  name?: string
  attributes?: unknown[]
  data?: {
    estree?: unknown
    [key: string]: unknown
  }
  children?: MarkdownNode[]
}

type MarkdownFile = {
  path?: string
  history?: string[]
}

export type D2PreRenderOptions = CompileOptions & {
  padX?: number
  prelude?: string
  maxHeight?: number
}

type PreparedD2Block = {
  code: string
  padX?: number
  maxHeight?: number
  options: CompileOptions
}

type D2DiagramConfig = CompileOptions & {
  layoutEngine?: 'dagre' | 'elk'
}

const d2 = new D2()
const renderCache = new Map<string, string>()
let d2TaskQueue: Promise<unknown> = Promise.resolve()

const defaultRenderOptions: CompileOptions = {
  noXMLTag: true,
  sketch: true,
  themeID: 8,
  pad: 32,
}

function getFilePath(file: MarkdownFile) {
  return file.path || file.history?.[0] || 'unknown markdown file'
}

/**
 * 为 MDX 文件创建一个可编译的内联 SVG 节点。
 */
function createMdxSvgNode(svg: string): MarkdownNode {
  const expression = `{__html: ${JSON.stringify(svg)}}`

  return {
    type: 'mdxJsxFlowElement',
    name: 'div',
    attributes: [
      {
        type: 'mdxJsxAttribute',
        name: 'dangerouslySetInnerHTML',
        value: {
          type: 'mdxJsxAttributeValueExpression',
          value: expression,
          data: {
            estree: {
              type: 'Program',
              start: 0,
              end: expression.length,
              body: [
                {
                  type: 'ExpressionStatement',
                  expression: {
                    type: 'ObjectExpression',
                    properties: [
                      {
                        type: 'Property',
                        method: false,
                        shorthand: false,
                        computed: false,
                        key: {
                          type: 'Identifier',
                          name: '__html',
                        },
                        value: {
                          type: 'Literal',
                          value: svg,
                          raw: JSON.stringify(svg),
                        },
                        kind: 'init',
                      },
                    ],
                  },
                },
              ],
              sourceType: 'module',
            },
          },
        },
      },
    ],
    children: [],
  }
}

function getBlockCacheKey(
  filePath: string,
  code: string,
  options: CompileOptions,
  padX?: number,
  maxHeight?: number
) {
  return createHash('sha256')
    .update(filePath)
    .update('\0')
    .update(code)
    .update('\0')
    .update(JSON.stringify(options))
    .update('\0')
    .update(String(padX ?? ''))
    .update('\0')
    .update(String(maxHeight ?? ''))
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

function runD2Task<T>(task: () => Promise<T>) {
  const run = d2TaskQueue.then(task, task)
  d2TaskQueue = run.catch(() => undefined)

  return run
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

function addSvgMaxHeight(svg: string, maxHeight?: number) {
  if (!maxHeight || maxHeight <= 0) {
    return svg
  }

  return svg.replace(/<svg\b/, `<svg style="max-height: ${maxHeight}px"`)
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

function parseMaxHeight(meta?: string) {
  if (!meta) {
    return undefined
  }

  const match = meta.match(/(?:^|\s)maxHeight=(\d+(?:\.\d+)?)(?:\s|$)/)

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
  const { padX, maxHeight, prelude, ...d2Options } = options
  const content = code.trim()

  return {
    code: [prelude?.trim(), content].filter(Boolean).join('\n\n'),
    padX: parsePadX(meta) ?? padX,
    maxHeight: parseMaxHeight(meta) ?? maxHeight,
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
      prepared.padX,
      prepared.maxHeight
    )
    const cached = renderCache.get(cacheKey)

    if (cached) {
      return cached
    }

    const svg = await runD2Task(async () => {
      const { options: compileOptions, result } = await resolveCompileOptions(
        prepared.code,
        prepared.options,
        cacheKey.slice(0, 12)
      )

      return d2.render(result.diagram, {
        ...result.renderOptions,
        ...compileOptions,
      })
    })
    const normalizedSvg = addSvgPadX(svg, prepared.padX)
    const finalSvg = addSvgMaxHeight(normalizedSvg, prepared.maxHeight)

    assertSafeSvg(finalSvg, filePath, blockIndex)

    const html = `<div class="d2-diagram" role="img">${finalSvg}</div>`
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

    const svg = await renderD2(
      code,
      options,
      filePath,
      counter.value,
      node.meta
    )

    // MDX 不会像 Markdown 一样自动把 html 节点交给 rehype-raw 处理。
    if (filePath.endsWith('.mdx')) {
      Object.assign(node, createMdxSvgNode(svg))
    } else {
      node.type = 'html'
      node.value = svg
    }

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

export function d2PreRenderPlugin(
  options: D2PreRenderOptions = {}
): RspressPlugin {
  return {
    name: 'd2-pre-render',
    markdown: {
      remarkPlugins: [[remarkD2PreRender, options]],
    },
    async afterBuild(_config, isProd) {
      if (!isProd) {
        return
      }

      // `@terrastruct/d2` 在 Node 端用 worker_threads 起了一个常驻 WASM
      // worker，D2 类没有暴露 terminate()。构建结束后需要手动终止，
      // 否则事件循环会因为 worker 句柄无法退出。
      const worker = (
        d2 as unknown as { worker?: { terminate?: () => Promise<unknown> } }
      ).worker
      await worker?.terminate?.()
    },
  }
}
