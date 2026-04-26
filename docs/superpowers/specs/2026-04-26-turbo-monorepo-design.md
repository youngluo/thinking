# thinking → Turbo Monorepo 改造设计

**Date:** 2026-04-26
**Status:** Approved

## 1. 目标

将 `thinking` 项目从单 package 改造为 Turbo Monorepo，支持多 package 独立开发与发布。

## 2. 目标架构

```
thinking/
├── apps/
│   └── docs/                  # VitePress 文档站
├── packages/
│   ├── utils/                # 工具库 (@thinking/utils)
│   └── rc/                    # React 组件 (@thinking/rc)
├── turbo.json
├── pnpm-workspace.yaml
└── package.json               # Root 空壳，private: true
```

## 3. Package 详情

### 3.1 `@thinking/utils`

**目的:** 将现有 `src/` 工具库抽取为独立 package

**迁移内容:**
- `src/算法/` → `packages/utils/src/算法/`
- `src/数据结构/` → `packages/utils/src/数据结构/`
- `src/设计模式/` → `packages/utils/src/设计模式/`
- `src/函数式/` → `packages/utils/src/函数式/`
- `src/工具函数/` → `packages/utils/src/工具函数/`
- `src/__tests__/` → `packages/utils/__tests__/`

**输出:** CJS + ESM 双格式，支持 tree-shaking

**依赖:** devDependencies 共享根配置

---

### 3.2 `@thinking/rc`

**目的:** React 组件库

**初始内容:** 空 package 占位，未来逐步添加组件

**依赖:** `react`, `@thinking/utils`

---

### 3.3 `apps/docs`

**目的:** VitePress 文档站

**迁移内容:**
- `docs/` → `apps/docs/`
- `scripts/generate-docs.ts` → `apps/docs/scripts/generate-docs.ts`

**依赖:** `@thinking/utils`（文档示例）

---

## 4. 共享配置

| 配置 | 方案 |
|------|------|
| TypeScript | 每个 package 独立 `tsconfig.json`，继承 root base |
| ESLint | `eslint.config.mjs` 放在 root，各 package 继承 |
| Jest | 各 package 独立配置 |
| Turbo | `turbo.json` 定义 pipeline：build → test |

---

## 5. Turborepo Pipeline

```json
{
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

`^build` 表示先构建所有依赖的 package。

---

## 6. 迁移步骤

1. 创建目录结构
2. 创建 `pnpm-workspace.yaml`
3. 创建 `turbo.json`
4. 迁移 `packages/utils`
5. 迁移 `apps/docs`
6. 初始化 `packages/rc`（空 package 占位）
7. 配置 root `package.json`
8. 更新 CI / scripts

---

## 7. 风险 & 约束

- **Git history:** 保留，所有迁移通过 `git mv` 完成
- **npm scope:** `@thinking` 需要在 npm 上申请 or 使用私有 registry
- **breaking change:** `src/` 不再直接可用，消费者需改为依赖 `@thinking/utils`
