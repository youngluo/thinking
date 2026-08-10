# AGENTS.md

@/Users/young/.codex/RTK.md

---

## 项目指南

本文件为在此仓库中工作的编码代理提供项目指导。

- 默认不要自动使用 superpowers skill；只有用户或项目文档明确要求时才使用；如果是 apps/docs/ 下的文档编写，则只是有 brainstorm skill，跳过其它与文档无关的 skill。
- 所有 shell 命令必须按 RTK 规则加 `rtk` 前缀。
- 修改文档后不要自动执行 `rtk pnpm docs:build`；只有用户明确要求验证构建时才运行。

## 常用命令

```bash
rtk pnpm test           # 运行全部测试（turbo）
rtk pnpm build          # 构建所有包（turbo）
rtk pnpm docs:dev       # 启动 Rspress 文档开发服务器
rtk pnpm docs:build     # 构建 Rspress 文档
```

- 单个包测试：`rtk pnpm test --filter=@thinking/utils`

## 提交规则

所有提交都必须使用 `commit` skill，并生成符合 Conventional Commits 的提交信息。

## 编码行为准则

以下准则用于减少常见的编码代理错误。它们偏向谨慎而不是速度；处理简单任务时应结合实际情况判断。

### 1. 先想清楚再编码

不要假设，不要掩盖不确定性，要主动说明取舍。

- 实现前明确说明假设；如果不确定，先提问。
- 如果存在多种理解，不要静默选择，应说明可选解释。
- 如果有更简单的方案，应直接指出；必要时可以提出反对意见。
- 如果需求不清楚，应停下来说明哪里不清楚，并向用户确认。

### 2. 简单优先

用最少的代码解决问题，不做推测性设计。

- 不添加用户没有要求的功能。
- 不为单次使用的代码抽象新接口。
- 不添加未被要求的灵活性或可配置项。
- 不为不可能发生的场景增加错误处理。
- 如果 200 行代码可以改成 50 行，应主动简化。

判断标准：资深工程师是否会认为这个实现过度复杂。如果是，就继续简化。

### 3. 精准修改

只修改必须修改的内容，只清理自己造成的问题。

- 不顺手“优化”相邻代码、注释或格式。
- 不重构没有问题的代码。
- 匹配现有风格，即使你个人会用不同写法。
- 发现无关的废弃代码时，只说明问题，不要直接删除。
- 删除由本次改动造成的无用导入、变量或函数。
- 不删除本来就存在的死代码，除非用户明确要求。

判断标准：每一行改动都应该能追溯到用户请求。

### 4. 目标驱动执行

把任务转化为可验证的目标，并持续迭代到验证完成。

- “添加校验”应转化为：为非法输入编写测试，再让测试通过。
- “修复 bug”应转化为：先写出复现问题的测试，再修复并通过测试。
- “重构 X”应转化为：确保重构前后测试都能通过。

多步骤任务应给出简短计划：

```text
1. [步骤] -> verify: [检查方式]
2. [步骤] -> verify: [检查方式]
3. [步骤] -> verify: [检查方式]
```

成功标准越清晰，越能独立完成循环。像“让它工作”这类模糊目标，应先澄清。

## 架构

这是一个 Turbo monorepo：

```text
apps/docs/                 # Rspress 文档站点
packages/utils/            # @thinking/utils，TypeScript 工具库
packages/rc/               # @thinking/rc，React 组件库
turbo.json                 # 构建流水线配置
pnpm-workspace.yaml        # 工作区包配置
tsconfig.base.json         # 共享 TypeScript 配置
```

`packages/utils/src/` 按主题组织源码：

```text
算法/
数据结构/
设计模式/
函数式/
工具函数/
```

Rspress 文档位于 `apps/docs/`。文档生成脚本是 `scripts/generate-docs.ts`，生成内容位于 `apps/docs/code/`。

修改 `apps/docs/` 中的 Rspress 相关内容时，可参考 Rspress 官方 LLM 文档：

- https://rspress.rs/llms.txt
- https://rspress.rs/guide/start/introduction.md

编写 Rspress 文档代码块时：

- 代码块默认添加 `fold`，除非代码很短且需要直接展开对照阅读。
- 代码块对应具体文件路径时，把文件路径写到代码块的 `title` 配置里，例如 ```ts fold title="src/App.tsx"。
- 展示事件监听时，避免只包含注释的匿名空回调，例如 `() => { /* comment */ }`；更推荐先声明命名函数，再传给 `addEventListener`。
- 示例代码中，函数、类型、类等 API 说明使用 `/** ... */`；函数体内部的局部说明使用 `//`。

编写 blog 或技术文章时：

- 新建文章的 frontmatter 默认设置 `draft: true`，`createdAt` 使用创建文件时的当前时间，格式为 `YYYY-MM-DD HH:mm`。
- 没有特殊说明时，文件名（不含扩展名）应与文章标题一致。
- 技术表述要精准，但不要为了精准堆叠冗余解释。优先写清“谁在什么时候做什么、输入是什么、输出是什么、边界在哪里”，避免只写空泛概括。
- 机制类段落优先给出明确职责拆分，例如不同阶段、模块或角色分别负责什么。如果一个细节已在后文展开，前文只保留结论和必要边界，不重复展开。
- 术语要在同一语境内保持一致，不为了显得专业而使用自造或含混词；如果必须区分层次，直接写具体对象、模块、阶段或数据结构。

## D2 规范

- 表示流程（如数据流、调用链、状态转换、流水线步骤）时，避免使用 ```text 代码块，应优先使用 d2 图。
- D2 全局样式统一配置在 `apps/docs/rspress.config.ts` 的 `d2PreRenderOptions` 中，单篇文档不要重复声明全局样式或切换主题。
- 只维护少量语义 class，其他节点、分组标题和连线默认使用 D2 样式；不要单独设置文字颜色、线条颜色、边框、圆角、箭头样式。
- 当前全局 class：group、subgroup、fail、decision。
- 所有节点、分组标题和连线都使用 D2 默认样式；不要单独设置文字颜色、线条颜色、边框、圆角、箭头样式。
- 分组容器使用 `class: group`。
- 嵌套分组容器使用 `class: subgroup`。
- 判断节点使用 `class: decision`。
- 普通节点不设置 `class`；除 `group`、`subgroup`、`fail`、`decision` 之外，不新增全局 class。单篇文档确有语义需要时再局部定义。
- 控制节点大小时使用 `width` 和 `height`；D2 没有通用 CSS 式 `padding`，需要更大留白时优先增大节点尺寸。
