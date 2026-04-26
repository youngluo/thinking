# Turbo Monorepo 改造实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 thinking 项目改造为 Turbo Monorepo，包含 @thinking/utils、@thinking/rc、apps/docs 三个 package

**Architecture:** 使用 pnpm workspaces + Turborepo 构建 monorepo，共享配置通过 npm workspace root 配置管理

**Tech Stack:** pnpm workspaces, Turborepo, TypeScript, Jest, VitePress

---

## 文件结构

```
thinking/
├── apps/
│   └── docs/
│       ├── package.json         # docs package
│       ├── tsconfig.json         # 继承 root
│       ├── .vitepress/
│       ├── components/
│       ├── experiences/
│       ├── writings/
│       └── scripts/
│           └── generate-docs.ts
├── packages/
│   ├── utils/
│   │   ├── package.json         # @thinking/utils
│   │   ├── tsconfig.json
│   │   ├── src/                 # 原有 src 内容迁移
│   │   │   ├── 算法/
│   │   │   ├── 数据结构/
│   │   │   ├── 设计模式/
│   │   │   ├── 函数式/
│   │   │   └── 工具函数/
│   │   └── __tests__/          # 测试迁移
│   └── rc/
│       ├── package.json         # @thinking/rc (空壳)
│       └── tsconfig.json
├── turbo.json
├── pnpm-workspace.yaml
└── package.json                  # root 空壳
```

---

## 实现任务

### Task 1: 创建 pnpm-workspace.yaml

**文件:**
- 创建: `pnpm-workspace.yaml`

- [ ] **Step 1: 创建 pnpm-workspace.yaml**

Content:
```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 2: Commit**

```bash
git add pnpm-workspace.yaml
git commit -m "chore: add pnpm-workspace.yaml for monorepo"
```

---

### Task 2: 创建 turbo.json

**文件:**
- 创建: `turbo.json`

- [ ] **Step 1: 创建 turbo.json**

Content:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "lint": {
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add turbo.json
git commit -m "chore: add turbo.json for build pipeline"
```

---

### Task 3: 迁移 packages/utils

**文件:**
- 创建: `packages/utils/package.json`
- 创建: `packages/utils/tsconfig.json`
- 创建: `packages/utils/jest.config.ts`
- 移动: `src/` → `packages/utils/src/` (git mv)
- 移动: `src/__tests__/` → `packages/utils/__tests__/` (git mv)

- [ ] **Step 1: 创建 packages/utils/package.json**

```json
{
  "name": "@thinking/utils",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "lint": "eslint ."
  },
  "devDependencies": {
    "@types/jest": "^29.5.14",
    "@types/lodash-es": "^4.17.12",
    "@types/node": "^25.6.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "typescript": "^5.3.3"
  }
}
```

- [ ] **Step 2: 创建 packages/utils/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/__tests__/**"]
}
```

- [ ] **Step 3: 创建 packages/utils/tsconfig.base.json (root)**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "dom"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "ignoreDeprecations": "6.0",
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

- [ ] **Step 4: 创建 packages/utils/jest.config.ts**

```typescript
import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true }],
  },
};

export default config;
```

- [ ] **Step 5: git mv 迁移 src/ → packages/utils/src/**

```bash
git mv src packages/utils/src
git mv src/__tests__ packages/utils/__tests__
```

- [ ] **Step 6: Commit**

```bash
git add packages/utils/
git commit -m "feat(utils): migrate to @thinking/utils package"
```

---

### Task 4: 迁移 apps/docs

**文件:**
- 移动: `docs/` → `apps/docs/` (git mv)
- 创建: `apps/docs/package.json`
- 创建: `apps/docs/tsconfig.json`
- 移动: `scripts/generate-docs.ts` → `apps/docs/scripts/generate-docs.ts`

- [ ] **Step 1: git mv 迁移 docs/ → apps/docs/**

```bash
git mv docs apps/docs
```

- [ ] **Step 2: git mv 迁移 scripts/ → apps/docs/scripts/**

```bash
git mv scripts apps/docs/scripts
```

- [ ] **Step 3: 创建 apps/docs/package.json**

```json
{
  "name": "@thinking/docs",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "docs:build": "vitepress build .",
    "docs:dev": "pnpm docs:generate && vitepress dev .",
    "docs:generate": "tsx scripts/generate-docs.ts"
  },
  "devDependencies": {
    "@thinking/utils": "workspace:*",
    "@tailwindcss/vite": "^4.2.4",
    "@vainjs/eslint-config": "latest",
    "tailwindcss": "^4.2.4",
    "vitepress": "^1.0.0"
  }
}
```

- [ ] **Step 4: 创建 apps/docs/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "dom"],
    "moduleResolution": "bundler"
  },
  "include": ["**/*.ts", ".vitepress/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/docs/
git commit -m "feat(docs): migrate to apps/docs"
```

---

### Task 5: 初始化 packages/rc

**文件:**
- 创建: `packages/rc/package.json`
- 创建: `packages/rc/tsconfig.json`

- [ ] **Step 1: 创建 packages/rc/package.json**

```json
{
  "name": "@thinking/rc",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "lint": "eslint ."
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "react": "^18.2.0",
    "typescript": "^5.3.3"
  },
  "peerDependencies": {
    "react": ">=17.0.0"
  }
}
```

- [ ] **Step 2: 创建 packages/rc/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "jsx": "react-jsx"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/__tests__/**"]
}
```

- [ ] **Step 3: 创建 packages/rc/src/index.ts (占位)**

```typescript
// @thinking/rc - React Component Library
// TODO: Add components
```

- [ ] **Step 4: Commit**

```bash
git add packages/rc/
git commit -m "feat(rc): initialize @thinking/rc package"
```

---

### Task 6: 配置 root package.json

**文件:**
- 修改: `package.json`

- [ ] **Step 1: 更新 root package.json**

```json
{
  "name": "thinking",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "author": "Young <ly532265997@gmail.com>",
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "commit": "git add -A && git-cz",
    "prepare": "husky"
  },
  "devDependencies": {
    "@commitlint/cli": "^19.8.1",
    "@commitlint/config-conventional": "^19.8.1",
    "commitizen": "^4.2.4",
    "husky": "^9.1.7"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: simplify root package.json for monorepo"
```

---

### Task 7: 更新 .gitignore

**文件:**
- 修改: `.gitignore`

- [ ] **Step 1: 更新 .gitignore 追加**

```
# Turbo
.turbo/

# Build outputs (packages)
packages/*/dist/
apps/*/dist/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: update gitignore for monorepo outputs"
```

---

### Task 8: 验证 monorepo

- [ ] **Step 1: 运行 pnpm install**

```bash
pnpm install
```

- [ ] **Step 2: 验证 turbo.json 解析**

```bash
npx turbo --version
```

- [ ] **Step 3: 测试 build (utils package)**

```bash
cd packages/utils && pnpm build
```

- [ ] **Step 4: 测试 test (utils package)**

```bash
cd packages/utils && pnpm test
```

- [ ] **Step 5: 运行全量 turbo build**

```bash
npx turbo build
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: verify monorepo build pipeline"
```

---

## 自检清单

- [ ] pnpm-workspace.yaml 存在且包含 apps/* 和 packages/*
- [ ] turbo.json 定义了 build/test/lint/dev pipeline
- [ ] @thinking/utils 可以独立 build 和 test
- [ ] apps/docs 可以通过 pnpm docs:dev 启动
- [ ] packages/rc 是合法的空 package
- [ ] 无遗留的 src/ 目录（已迁移）
- [ ] git history 保留
