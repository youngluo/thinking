# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm test           # Run all tests (turbo)
pnpm build          # Build all packages (turbo)
pnpm docs:dev       # Start VitePress docs dev server
pnpm docs:build     # Build VitePress docs
```

- Single test: `cd packages/utils && pnpm test`
- Lint: `eslint --fix` (configured via husky pre-commit hook)

## Commit Rules

**All commits must use the `commit` skill.** Use the `Skill` tool to invoke `commit` for guided commit message creation.

## Architecture

Turbo Monorepo with the following structure:

```
├── apps/
│   └── docs/                  # VitePress documentation site
├── packages/
│   ├── utils/                # @thinking/utils - TypeScript utilities
│   └── rc/                    # @thinking/rc - React components (empty)
├── turbo.json                # Build pipeline configuration
├── pnpm-workspace.yaml       # Workspace packages definition
└── tsconfig.base.json       # Shared TypeScript configuration
```

### @thinking/utils

Source code at `packages/utils/src/`:

```
├── 算法/            # Algorithm implementations
├── 数据结构/        # Data structure implementations
├── 设计模式/        # Design patterns
├── 函数式/          # Functional utilities
└── 工具函数/        # General utilities
```

### @thinking/docs

VitePress documentation at `apps/docs/`:

- Scripts: `scripts/generate-docs.ts` - Auto-generate docs from source
- Writings: `apps/docs/writings/` - Auto-generated API documentation

## Tech Stack

- **Package Manager**: pnpm workspaces
- **Build Tool**: Turborepo
- **TypeScript**: ES2020 target, ESNext modules
- **Testing**: Jest with ts-jest preset (in packages/utils)
- **Linting**: ESLint + Prettier via husky pre-commit
- **Commits**: commitlint + commitizen with conventional-changelog format
- **Documentation**: VitePress
