# AGENTS.md

@/Users/young/.codex/RTK.md

## 项目结构

Turbo monorepo，pnpm workspace 收录 `apps/*` 与 `packages/*`：

| 路径 | 说明 |
| --- | --- |
| `apps/docs/` | Rspress 文档站点（`@thinking/docs`） |
| `packages/utils/` | TypeScript 工具库（`@thinking/utils`） |
| `packages/rc/` | React 组件库（`@thinking/rc`，目前只有入口占位） |

- `packages/utils/src/` 按主题分目录：`算法/`、`数据结构/`、`设计模式/`、`函数式/`、`工具函数/`；Jest 用例放在各主题下的 `__tests__/`。
- `apps/docs/` 下 `experiences/`、`ai/`、`interview/` 是手写内容；`code/` 由脚本生成，不手改。

## 常用命令

```bash
rtk pnpm test           # 全部包测试（turbo run test）
rtk pnpm build          # 构建所有包
rtk pnpm docs:dev       # Rspress 开发服务器 + 代码文档 watch
rtk pnpm docs:build     # 先生成代码文档，再构建站点
```

- 单个包测试：`rtk pnpm test --filter=@thinking/utils`（目前只有该包定义了 `test` 脚本）。
- 仓库没有 `lint` 脚本；ESLint 与 Prettier 通过 husky + lint-staged 在提交时对 `*.{ts,tsx,js,jsx}` 生效。

## 代码文档生成机制

脚本在 `apps/docs/scripts/`：

- `code-docs.ts` 扫描 `packages/utils/src/**/*.ts`（跳过 `__tests__/`），把每个 `export function|class|const` 及其前面的 `/** ... */` 注释写成 `apps/docs/code/<主题>/` 下的页面。
- JSDoc 中 `@summary` 决定条目标题，其余非 `@` 行作为正文，`@param` 等标签行会被丢弃。
- `docs-dev.ts` 在启动 `rspress dev` 前先同步生成一次，再持续 watch。

因此工具库源码的 API 说明必须写在 `/** ... */` 里，否则生成的页面只有代码没有解释。

## 写作规范

### Rspress 文档

修改 `apps/docs/` 中的 Rspress 相关内容时，可参考官方 LLM 文档：

- https://rspress.rs/llms.txt
- https://rspress.rs/guide/start/introduction.md

代码块规则：

- 默认添加 `fold`，除非代码很短且需要直接展开对照阅读。
- 代码块对应具体文件路径时，把路径写进 `title` 配置，例如 ```ts fold title="src/App.tsx"。
- 函数、类型、类等 API 说明用 `/** ... */`；函数体内部的局部说明用 `//`。

### blog 与技术文章

- 新建文章的 frontmatter 默认 `draft: true`，`createdAt` 用创建文件时的当前时间，格式 `YYYY-MM-DD HH:mm`。
- 发布时把 `draft` 改为 `false`，并把 `createdAt` 更新为发布时的当前时间，格式不变。
- 没有特殊说明时，文件名（不含扩展名）与文章标题一致。
- 正文的技术表述、结构与语言质量按 `polish` skill 的标准执行，撰写新文章与优化已有文章都适用。

### D2 图

- 表示流程（数据流、调用链、状态转换、流水线步骤）时避免 ```text 代码块，优先用 d2 图。
- 全局样式统一配置在 `apps/docs/rspress.config.ts` 的 `d2PreRenderOptions` 中，单篇文档不重复声明全局样式，也不切换主题。
- 所有节点、分组标题和连线都用 D2 默认样式；不单独设置文字颜色、线条颜色、边框、圆角、箭头样式。
- 最外层系统名用 D2 `title`（如 `title: |md` 配合 `{near: top-center}`）；分组只表达真实的结构边界，不为装饰增加外层容器，按对象间实际关系安排层级，避免把并列对象强行嵌套。
- `grid-rows`、`grid-columns` 适合强调等距对齐，但网格内连线会走中心到中心的直线。需要弧线或自动寻路时优先普通布局；确需网格时，再用 `vertical-gap` 或 `horizontal-gap` 为连线标签留出空间。

## 协作约定

- 开始修改仓库文件前，先检查文档站点开发服务是否已运行；未运行时启动 `rtk pnpm docs:dev`，复用已有进程并保持服务运行，以便浏览器预览和验证改动。
- 所有 shell 命令按 RTK 规则加 `rtk` 前缀。
- 修改文档后不要自动执行 `rtk pnpm docs:build`；只有用户明确要求验证构建时才运行。
- 默认不自动使用 superpowers skill，只有用户或项目文档明确要求时才用；`apps/docs/` 下的文档编写只保留 brainstorm skill，跳过其它与文档无关的 skill。
- 所有提交都必须使用 `commit` skill，并生成符合 Conventional Commits 的提交信息。
