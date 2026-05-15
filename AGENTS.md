# AGENTS.md

@/Users/young/.codex/RTK.md

---

## Project Guide

This file provides guidance to coding agents working with code in this repository.

## Commands

```bash
rtk pnpm test           # Run all tests (turbo)
rtk pnpm build          # Build all packages (turbo)
rtk pnpm docs:dev       # Start Rspress docs dev server
rtk pnpm docs:build     # Build Rspress docs
```

- Single test: `rtk pnpm test --filter=@thinking/utils`

## Commit Rules

**All commits must use the `commit` skill.** Use the `commit` skill for guided commit message creation.

## Architecture

Turbo monorepo with the following structure:

```text
├── apps/
│   └── docs/                  # Rspress documentation site
├── packages/
│   ├── utils/                 # @thinking/utils - TypeScript utilities
│   └── rc/                    # @thinking/rc - React components (empty)
├── turbo.json                 # Build pipeline configuration
├── pnpm-workspace.yaml        # Workspace packages definition
└── tsconfig.base.json         # Shared TypeScript configuration
```

### @thinking/utils

Source code at `packages/utils/src/`:

```text
├── 算法/            # Algorithm implementations
├── 数据结构/        # Data structure implementations
├── 设计模式/        # Design patterns
├── 函数式/          # Functional utilities
└── 工具函数/        # General utilities
```

### @thinking/docs

Rspress documentation at `apps/docs/`:

- Scripts: `scripts/generate-docs.ts` - Auto-generate docs from source
- Writings: `apps/docs/writings/` - Auto-generated API documentation

## Tech Stack

- **Package Manager**: pnpm workspaces
- **Build Tool**: Turborepo
- **TypeScript**: ES2020 target, ESNext modules
- **Testing**: Jest with ts-jest preset (in packages/utils)
- **Linting**: ESLint + Prettier via husky pre-commit
- **Commits**: commitlint + commitizen with conventional-changelog format
- **Documentation**: Rspress

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
