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
