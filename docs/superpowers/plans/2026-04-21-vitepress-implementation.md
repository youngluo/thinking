# VitePress 文档站点实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 thinking 项目添加 VitePress 文档站点，展示手写题（自动从 src 生成）和面试题（手动维护）

**Architecture:** 手写题文档在构建时通过 `scripts/generate-docs.ts` 扫描 `src/**/*.ts` 生成，面试题手动编写 markdown。VitePress 配置顶部导航和侧边栏，GitHub Actions 自动构建部署。

**Tech Stack:** VitePress, TypeScript, Jest, GitHub Actions

---

## 文件结构

```
docs/
├── .vitepress/
│   └── config.ts           # VitePress 配置（创建）
├── index.md                # VitePress 首页（创建）
├── writing-tests/           # 手写题文档（自动生成）
│   ├── index.md            # 手写题首页（创建，静态）
│   ├── algorithm/           # 算法类
│   ├── data-structures/    # 数据结构类
│   ├── functional/          # 函数式类
│   ├── utils/               # 工具类
│   └── design-patterns/     # 设计模式类
├── interview/              # 面试题（手动维护）
│   ├── index.md            # 面试题首页（创建）
│   └── js/
│       └── deep-clone.md   # 示例面试题（创建）
├── .vitepress/
│   └── config.ts
scripts/
└── generate-docs.ts        # 文档生成脚本（创建）
.github/
└── workflows/
    └── docs.yml            # GitHub Actions 工作流（创建）
```

---

### Task 1: 初始化 VitePress 配置

**Files:**
- Create: `docs/.vitepress/config.ts`
- Modify: `docs/index.md` (创建首页)

- [ ] **Step 1: 创建 VitePress 配置目录**

```bash
mkdir -p docs/.vitepress
```

- [ ] **Step 2: 创建 VitePress 配置文件**

```typescript
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Thinking',
  description: '手写题与面试题整理',
  srcDir: '.',
  themeConfig: {
    nav: [
      { text: '手写题', link: '/writing-tests/' },
      { text: '面试题', link: '/interview/' },
    ],
    sidebar: {
      '/writing-tests/': getWritingTestsSidebar(),
      '/interview/': getInterviewSidebar(),
    },
  },
})

function getWritingTestsSidebar() {
  return [
    {
      text: '算法',
      items: [
        { text: 'findMinNums', link: '/writing-tests/algorithm/find-min-nums' },
        { text: 'longestCommonSubstring', link: '/writing-tests/algorithm/longest-common-substring' },
        { text: 'sortAlgorithm', link: '/writing-tests/algorithm/sort-algorithm' },
        { text: 'eliminate', link: '/writing-tests/algorithm/eliminate' },
      ],
    },
    {
      text: '数据结构',
      items: [
        { text: 'LRUCache', link: '/writing-tests/data-structures/lru-cache' },
        { text: 'LinkedHashMap', link: '/writing-tests/data-structures/linked-hash-map' },
      ],
    },
    {
      text: '函数式',
      items: [
        { text: 'compose', link: '/writing-tests/functional/compose' },
        { text: 'curry', link: '/writing-tests/functional/curry' },
        { text: 'flatDeep', link: '/writing-tests/functional/flat-deep' },
        { text: 'reduce', link: '/writing-tests/functional/reduce' },
      ],
    },
    {
      text: '工具函数',
      items: [
        { text: 'bind', link: '/writing-tests/utils/bind' },
        { text: 'deepClone', link: '/writing-tests/utils/deep-clone' },
        { text: 'debounce', link: '/writing-tests/utils/debounce' },
      ],
    },
    {
      text: '设计模式',
      items: [
        { text: 'eventEmitter', link: '/writing-tests/design-patterns/event-emitter' },
        { text: 'observer', link: '/writing-tests/design-patterns/observer' },
      ],
    },
  ]
}

function getInterviewSidebar() {
  return [
    {
      text: 'JavaScript',
      items: [
        { text: '深拷贝', link: '/interview/js/deep-clone' },
        { text: '事件循环', link: '/interview/js/event-loop' },
      ],
    },
    {
      text: '算法',
      items: [
        { text: '防抖与节流', link: '/interview/algorithm/throttle-debounce' },
      ],
    },
  ]
}
```

- [ ] **Step 3: 创建 VitePress 首页**

```markdown
# Thinking

手写题与面试题整理。

## 手写题

自动从 `src/` 目录生成，包含代码、思路和测试结果。

[查看手写题 ->](/writing-tests/)

## 面试题

手动整理的面试题笔记。

[查看面试题 ->](/interview/)
```

- [ ] **Step 4: 提交**

```bash
git add docs/.vitepress/config.ts docs/index.md
git commit -m "docs: add VitePress configuration and homepage"
```

---

### Task 2: 创建文档生成脚本

**Files:**
- Create: `scripts/generate-docs.ts`
- Modify: `package.json` (添加 tsx 依赖和 scripts)

- [ ] **Step 1: 创建 scripts 目录**

```bash
mkdir -p scripts
```

- [ ] **Step 2: 创建文档生成脚本**

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const docsDir = join(rootDir, 'docs')
const srcDir = join(rootDir, 'src')

interface DocInfo {
  title: string
  description: string
  complexity: string
  code: string
  category: string
  filename: string
}

const categoryMap: Record<string, string> = {
  algorithms: 'algorithm',
  dataStructures: 'data-structures',
  functional: 'functional',
  utils: 'utils',
  designPatterns: 'design-patterns',
}

function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

function extractDocInfo(filePath: string, category: string): DocInfo | null {
  const content = readFileSync(filePath, 'utf-8')
  const filename = filePath.split('/').pop()!.replace('.ts', '')
  const kebabName = toKebabCase(filename)

  // 提取 JSDoc 注释
  const jsdocMatch = content.match(/\/\*\*[\s\S]*?\*\//)
  let description = ''
  let complexity = ''

  if (jsdocMatch) {
    const jsdoc = jsdocMatch[0]
    const descMatch = jsdoc.match(/@description\s+(.+)/)
    const complexityMatch = jsdoc.match(/@complexity\s+(.+)/)
    description = descMatch ? descMatch[1].trim() : ''
    complexity = complexityMatch ? complexityMatch[1].trim() : ''
  }

  // 如果没有 JSDoc，使用文件开头的注释作为描述
  if (!description) {
    const firstCommentMatch = content.match(/\/\/\s*(.+)/)
    description = firstCommentMatch ? firstCommentMatch[1].trim() : filename
  }

  return {
    title: filename,
    description,
    complexity,
    code: content,
    category,
    filename: kebabName,
  }
}

function generateMarkdown(doc: DocInfo): string {
  return `# ${doc.title}

## 代码

\`\`\`typescript
${doc.code}
\`\`\`

## 思路

${doc.description}

${doc.complexity ? `## 复杂度\n\n${doc.complexity}` : ''}
`
}

function getAllTsFiles(dir: string): string[] {
  const files: string[] = []
  const entries = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...getAllTsFiles(fullPath))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(fullPath)
    }
  }
  return files
}

function generateDocs() {
  const tsFiles = getAllTsFiles(srcDir)

  for (const file of tsFiles) {
    const relativePath = file.replace(srcDir + '/', '')
    const [categoryDir, filename] = relativePath.split('/')
    const category = categoryMap[categoryDir] || categoryDir

    const docInfo = extractDocInfo(file, category)
    if (!docInfo) continue

    const outputDir = join(docsDir, 'writing-tests', category)
    mkdirSync(outputDir, { recursive: true })

    const outputPath = join(outputDir, `${docInfo.filename}.md`)
    writeFileSync(outputPath, generateMarkdown(docInfo))
    console.log(`Generated: ${outputPath}`)
  }

  // 创建静态首页
  const indexContent = `# 手写题

本页面自动从 \`src/\` 目录生成。

## 题目列表

- [算法](/writing-tests/algorithm/)
- [数据结构](/writing-tests/data-structures/)
- [函数式](/writing-tests/functional/)
- [工具函数](/writing-tests/utils/)
- [设计模式](/writing-tests/design-patterns/)
`
  writeFileSync(join(docsDir, 'writing-tests/index.md'), indexContent)
  console.log('Generated: writing-tests/index.md')
}

generateDocs()
```

- [ ] **Step 3: 更新 package.json**

添加 devDependencies 和 scripts:

```json
{
  "devDependencies": {
    "vitepress": "^1.0.0",
    "tsx": "^4.0.0"
  },
  "scripts": {
    "docs:generate": "tsx scripts/generate-docs.ts",
    "docs:dev": "vitepress dev docs",
    "docs:build": "vitepress build docs"
  }
}
```

- [ ] **Step 4: 提交**

```bash
git add scripts/generate-docs.ts package.json
git commit -m "feat: add docs generation script"
```

---

### Task 3: 添加面试题示例

**Files:**
- Create: `docs/interview/index.md`
- Create: `docs/interview/js/deep-clone.md`
- Create: `docs/interview/algorithm/throttle-debounce.md`

- [ ] **Step 1: 创建面试题首页**

```markdown
# 面试题

手动整理的面试题笔记。

## 分类

- [JavaScript](/interview/js/)
- [算法](/interview/algorithm/)
```

- [ ] **Step 2: 创建深拷贝面试题示例**

```markdown
# 深拷贝

## 题目

实现一个深拷贝函数，考虑循环引用和特殊类型（Date、RegExp、Symbol 等）。

## 思路

1. 判断类型：利用 `Object.prototype.toString.call()` 获取精确类型
2. 处理循环引用：使用 WeakMap 存储已拷贝的对象
3. 处理特殊类型：Date、RegExp、Symbol 等需要单独处理
4. 处理数组和对象：递归拷贝

## 代码

\`\`\`typescript
function deepClone(obj: any, weakMap = new WeakMap()): any {
  if (obj === null || typeof obj !== 'object') return obj

  if (weakMap.has(obj)) return weakMap.get(obj)

  if (obj instanceof Date) return new Date(obj)
  if (obj instanceof RegExp) return new RegExp(obj.source, obj.flags)

  const clone = Array.isArray(obj) ? [] : {}
  weakMap.set(obj, clone)

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      clone[key] = deepClone(obj[key], weakMap)
    }
  }

  return clone
}
\`\`\`

## 复杂度

- 时间复杂度：O(n)，n 为对象的属性数量
- 空间复杂度：O(n)，考虑递归调用栈和 weakMap
```

- [ ] **Step 3: 创建防抖节流面试题示例**

```markdown
# 防抖与节流

## 防抖 (Debounce)

### 题目

实现一个防抖函数，在事件触发 n 秒后才执行，如果 n 秒内再次触发，则重新计时。

### 代码

\`\`\`typescript
function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return function (this: any, ...args: Parameters<T>) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      fn.apply(this, args)
    }, delay)
  }
}
\`\`\`

## 节流 (Throttle)

### 题目

实现一个节流函数，在单位时间内最多执行一次。

### 代码

\`\`\`typescript
function throttle<T extends (...args: any[]) => any>(
  fn: T,
  interval: number
): (...args: Parameters<T>) => void {
  let lastTime = 0
  return function (this: any, ...args: Parameters<T>) {
    const now = Date.now()
    if (now - lastTime >= interval) {
      lastTime = now
      fn.apply(this, args)
    }
  }
}
\`\`\`
```

- [ ] **Step 4: 提交**

```bash
git add docs/interview/
git commit -m "docs: add interview questions examples"
```

---

### Task 4: 添加 GitHub Actions 工作流

**Files:**
- Create: `.github/workflows/docs.yml`

- [ ] **Step 1: 创建 GitHub Actions 工作流**

```yaml
name: Docs

on:
  push:
    branches: [main]
    paths:
      - 'src/**/*.ts'
      - 'docs/**'
      - 'scripts/**'
      - 'package.json'

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install

      - name: Run tests
        run: pnpm test

      - name: Generate docs
        run: pnpm run docs:generate

      - name: Setup Pages
        uses: actions/configure-pages@v4

      - name: Build with VitePress
        run: pnpm run docs:build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: docs/.vitepress/dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: 提交**

```bash
git add .github/workflows/docs.yml
git commit -m "ci: add GitHub Actions workflow for docs"
```

---

## 实现检查清单

- [ ] Task 1: VitePress 配置和首页
- [ ] Task 2: 文档生成脚本
- [ ] Task 3: 面试题示例
- [ ] Task 4: GitHub Actions 工作流
- [ ] 本地运行 `pnpm run docs:generate` 测试生成
- [ ] 本地运行 `pnpm run docs:dev` 测试预览

---

## 备选方案（如果 subagent 无法执行）

如果 subagent-driven-development 不可用，可以手动按顺序执行上述 Task，每个 Task 完成后运行测试验证。
