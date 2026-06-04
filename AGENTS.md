# AGENTS.md

@/Users/young/.codex/RTK.md

---

## 项目指南

本文件为在此仓库中工作的编码代理提供项目指导。

- 默认不要自动使用 superpowers skill；只有用户或项目文档明确要求时才使用。
- 写作、修改、润色或评审文档时，必须使用 `.codex/skills/polish` skill。
- 所有 shell 命令必须按 RTK 规则加 `rtk` 前缀。

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

Rspress 文档位于 `apps/docs/`。文档生成脚本是 `scripts/generate-docs.ts`，生成内容位于 `apps/docs/writings/`。

修改 `apps/docs/` 中的 Rspress 相关内容时，可参考 Rspress 官方 LLM 文档：

- https://rspress.rs/llms.txt
- https://rspress.rs/guide/start/introduction.md

## Mermaid 规范

- 只统一配色和线条，不限制 Mermaid 的结构、方向和节点组织方式。
- 所有 Mermaid 图统一使用：

```mermaid
%%{init: {'themeVariables': {'lineColor': '#7fa3ff'}}}%%
```

- 线条主色固定为 `#7fa3ff`。
- 所有节点与分组标题的文字颜色都使用 Mermaid 默认文字色，不单独设置 `color`。
- Mermaid 配色使用低饱和浅色系，不要为单篇文档切换成新主题：
- 普通节点：`fill:#7fa3ff29,stroke:#07f,stroke-width:1px`，这是最常用的节点
- subgraph/分组容器：`fill:#fffaf0,stroke:#ffa500,stroke-width:2px,stroke-dasharray:5,5`
- 红色步骤：`fill:#ffcdd2,stroke:#b71c1c,stroke-width:1px`，可表示失败或者需慎重的节点
- 绿色步骤：`fill:#c8e6c9,stroke:#1b5e20,stroke-width:1px`，可表示成功的节点
- 紫色步骤：`fill:#e1bee7,stroke:#4a148c,stroke-width:1px`，可作为判断节点
- 橙色步骤：`fill:#ffe0b2,stroke:#bf360c,stroke-width:1px`，可随机分配
- 蓝色步骤：`fill:#bbdefb,stroke:#0d47a1,stroke-width:1px`，可随机分配
- 青色步骤：`fill:#b2ebf2,stroke:#006064,stroke-width:1px`，可随机分配
- 说明文字：`fill:none,stroke:none,color:#333,font-size:13px`
- 节点圆角统一使用 `rx:4,ry:4`；常规节点边框 `stroke-width:1px`，subgraph/分组容器边框 `stroke-width:2px` 并使用虚线。
