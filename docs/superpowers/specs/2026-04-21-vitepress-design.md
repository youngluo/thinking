# VitePress 文档站点设计

## 概述

为 `thinking` 项目添加 VitePress 文档站点，展示手写题和面试题。手写题代码从 `src/` 自动生成文档，面试题手动维护 markdown 文件。

## 目录结构

```
docs/
├── .vitepress/
│   └── config.ts           # VitePress 配置
├── writing-tests/           # 自动生成的手写题文档（构建时生成）
│   ├── algorithm/
│   │   ├── find-min-nums.md
│   │   ├── longest-common-substring.md
│   │   └── sort-algorithm.md
│   ├── data-structures/
│   │   ├── lru-cache.md
│   │   └── linked-hash-map.md
│   ├── functional/
│   │   ├── compose.md
│   │   ├── curry.md
│   │   ├── flat-deep.md
│   │   └── reduce.md
│   ├── utils/
│   │   ├── bind.md
│   │   ├── deep-clone.md
│   │   ├── debounce.md
│   │   └── ...
│   └── index.md             # 手写题首页
├── interview/              # 手动维护的面试题
│   ├── index.md            # 面试题首页
│   ├── js/
│   │   ├── deep-clone.md
│   │   └── event-loop.md
│   └── algorithm/
│       └── throttle-debounce.md
└── index.md                # VitePress 首页
```

## 导航结构

### 顶部导航栏
- `手写题` → `/writing-tests/`
- `面试题` → `/interview/`

### 侧边栏

**手写题侧边栏**（自动生成，基于文件分组）
```
algorithms
  ├── findMinNums
  ├── longestCommonSubstring
  └── sortAlgorithm
dataStructures
  ├── LRUCache
  └── LinkedHashMap
functional
  ├── compose
  ├── curry
  ├── flatDeep
  └── reduce
utils
  ├── bind
  ├── deepClone
  └── ...
```

**面试题侧边栏**（手动配置）
```
js
  ├── deep-clone
  └── event-loop
algorithm
  └── throttle-debounce
```

## 手写题文档内容

每篇生成的 markdown 包含：

```markdown
# findMinNums

## 代码

\`\`\`typescript
// 代码内容
\`\`\`

## 思路

从 JSDoc 或注释中提取的思路说明

## 复杂度

- 时间复杂度：O(n)
- 空间复杂度：O(1)

## 测试结果

✅ 所有测试通过
```

## 生成脚本设计

`scripts/generate-docs.ts`

1. 扫描 `src/**/*.ts`
2. 读取文件内容，提取：
   - 代码内容
   - JSDoc 注释中的 `@description`（思路）
   - JSDoc 注释中的 `@complexity`（复杂度）
3. 运行 Jest 获取测试结果
4. 生成 `docs/writing-tests/**/*.md`

### JSDoc 约定

```typescript
/**
 * 找出数组中最小的 N 个数
 * @description 使用堆排序的思想，遍历数组构建最小堆...（思路说明）
 * @complexity 时间复杂度 O(n log k)，空间复杂度 O(k)
 */
```

## GitHub Actions 工作流

`.github/workflows/docs.yml`

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

jobs:
  generate-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 8

      - name: Install dependencies
        run: pnpm install

      - name: Run tests
        run: pnpm test

      - name: Generate docs
        run: pnpm run docs:generate

      - name: Build VitePress
        run: pnpm run docs:build

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: docs/.vitepress/dist
```

## package.json 更新

```json
{
  "scripts": {
    "docs:generate": "tsx scripts/generate-docs.ts",
    "docs:dev": "vitepress dev docs",
    "docs:build": "vitepress build docs"
  },
  "devDependencies": {
    "vitepress": "^1.0.0"
  }
}
```

## 初始题目映射

| src 文件 | 文档路径 | 分类 |
|---------|---------|------|
| `src/algorithms/findMinNums.ts` | `writing-tests/algorithm/find-min-nums.md` | algorithm |
| `src/algorithms/longestCommonSubstring.ts` | `writing-tests/algorithm/longest-common-substring.md` | algorithm |
| `src/algorithms/sortAlgorithm.ts` | `writing-tests/algorithm/sort-algorithm.md` | algorithm |
| `src/algorithms/eliminate.ts` | `writing-tests/algorithm/eliminate.md` | algorithm |
| `src/dataStructures/LRUCache.ts` | `writing-tests/data-structures/lru-cache.md` | data-structures |
| `src/dataStructures/LinkedHashMap.ts` | `writing-tests/data-structures/linked-hash-map.md` | data-structures |
| `src/functional/compose.ts` | `writing-tests/functional/compose.md` | functional |
| `src/functional/curry.ts` | `writing-tests/functional/curry.md` | functional |
| `src/functional/flatDeep.ts` | `writing-tests/functional/flat-deep.md` | functional |
| `src/functional/reduce.ts` | `writing-tests/functional/reduce.md` | functional |
| `src/utils/bind.ts` | `writing-tests/utils/bind.md` | utils |
| `src/utils/deepClone.ts` | `writing-tests/utils/deep-clone.md` | utils |
| `src/utils/debounce.ts` | `writing-tests/utils/debounce.md` | utils |
| `src/designPatterns/eventEmitter.ts` | `writing-tests/design-patterns/event-emitter.md` | design-patterns |
| `src/designPatterns/observer.ts` | `writing-tests/design-patterns/observer.md` | design-patterns |

## 实现步骤

1. 初始化 VitePress 配置
2. 创建生成脚本 `scripts/generate-docs.ts`
3. 配置 VitePress 导航和侧边栏
4. 添加 GitHub Actions 工作流
5. 更新 package.json scripts
6. 添加示例面试题 markdown
