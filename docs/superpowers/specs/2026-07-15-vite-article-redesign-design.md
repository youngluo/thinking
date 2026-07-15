# Vite 原理与实践文章设计

## 背景

`apps/docs/experiences/构建工具/Vite 原理.md` 当前有完整正文（368 行），最近经过多轮 mermaid → d2 转换、polish、列表化重构。但当前大纲以"主题分章"组织（开发流程 / HMR / 插件 / 生产构建 / 为什么快 / 差异 / 边界 / 总结），存在几个问题：

- 主题之间有重叠："为什么快"与"和传统打包器的差异"内容相互覆盖。
- HMR、插件被拆成独立小节，但它们其实是 dev 链路中的一环，单独成章打断了"dev 实际怎么跑"的叙事节奏。
- "常见边界"只是一组 caveat 列表，没有从"dev vs build 差异"角度系统讲清楚。
- 不够"讲透"：原理部分点到为止，缺少代码层细节；实践部分也偏单薄。

`experiences/构建工具/` 目录下已有《Webpack 实践》，写法稳定。本文沿用同一风格，但走"原理到实践"路线，覆盖深度更高。

## 目标

- 重新组织大纲，按 dev/build 核心链路（dev 启动 → 浏览器加载 → HMR → build）展开，把插件机制、模块图作为内嵌要点而非独立章节。
- 把当前 8 节（开发流程 / HMR / 插件 / 生产 / 为什么快 / 差异 / 边界 / 总结）合并为 7 章，每章覆盖"原理 + 实战 + 关键点"。
- 面向"用过 Vite 但没读透原理" + "想深入内部机制"的进阶读者，同时覆盖面试常考点（HMR 边界、依赖预构建、按需转换、模块图、dev/build 差异）。
- 每章按统一 3 段式：原理（why / how）→ 实战（配置 / 代码示例）→ 关键点（核心结论 / 面试点）。
- 插件机制和模块图在合适章节里深入展开，不单独成章但内容不缩水。
- 文章保持 `draft: true` 状态，写完由用户审阅后再去掉 draft。

## 非目标

- 不写 Vite 入门（项目初始化、Hello World、CLI 用法速成）。
- 不写 Rollup 完整文档（Vite build 基于 Rollup，提到时给关键点即可，不展开）。
- 不写 Vue/React 框架内部渲染机制（Fast Refresh 在 HMR 章里只讲与 Vite 的对接，不展开 React 内部）。
- 不写其他构建工具横向对比（Webpack、Rollup、esbuild、swc 等只在需要时点名，不展开）。
- 不写 Vite 生态周边（vite-plugin-react 完整配置、UI 库集成等）。
- 不复述 Vite 官方文档已经讲清的概念定义，只引用结论与边界。
- 不为引出正确说法而构造不存在的反面 API；如需对比，对比对象必须真实存在。
- 不在文章里堆代码示例，每段代码不超过 15 行，能用伪代码就避免依赖大量上下文的真实代码。

## 受众与深度

- 读者画像：熟悉 ES Modules、有 Vite/Webpack 使用经验、想读透 Vite 设计原理的前端工程师；或准备 Vite 相关面试的候选人。
- 深度：原理级别。出现 API / 钩子时给"为什么这样设计"和"它解决什么问题"，不给完整参数表。
- 读者已经知道：什么是 ESM、什么是 dev server、什么是 HMR、什么是 build；不需要再科普这些基础概念。
- 读者需要知道：Vite 怎么实现"按需加载"的、HMR 边界判断的代码层机制、模块图的具体字段、插件钩子调用顺序、build 流水线全貌、dev/build 关键差异。

## 写作风格约束

- 沿用目录同级文章的写法：长文中文技术文章、大段叙述 + 代码块 + d2 流程图。
- 流程图用 d2，不用 mermaid。架构/对比/链路类视觉必须用 d2。
- d2 全局渲染参数（class 配色、容器、节点尺寸）由 `apps/docs/rspress.config.ts` 的 `d2PreRenderOptions` 统一管理，不在文章里重复声明全局样式。
- d2 节点命名采用 `d2PreRenderOptions` 已定义的语义类（`group`、`fail`、`ok`、`decision`），不新增全局 class。
- 代码块按 AGENTS.md 规则：函数/类型/类使用 `/** ... */`，函数体内部使用 `//`。
- 每章结尾用"关键点"或"实战建议"段落收口，把核心结论或面试常问问题点出。
- 标题和小节标题避免"先看 xx / 一文看懂 xx / 把 xx 搞清楚"等口语化、营销化表达。
- 技术词汇与 Vite 官方文档一致（如 `transform / handleHotUpdate / optimizeDeps / acceptedHmrDeps / resolveId`），不自造核心概念。
- 不为引出正确说法而凭空构造反面判断；如需对比，对比对象必须真实存在（官方文档或源码）。
- 所有 d2 节点、分组标题和连线使用 D2 默认样式；不单独设置文字颜色、线条颜色、边框、圆角、箭头样式。
- 用列表 + 粗体引导词组织多要点信息（参考 AGENTS.md 的"为什么快"列表化写法）。
- 破折号（——）禁止使用，改用句号或逗号断句。
- 文章用全角中文标点；英文句子、代码标识符、配置项保持原始符号。

## 文档结构

文章 frontmatter：

```text
---
createdAt: '2026-07-15 17:00'
draft: true
order: 3
---
```

正文总览：

```text
开场（1-2 段：双策略核心 + 文章路线图）
1. dev 启动：让浏览器参与模块加载
2. 源码按需转换：ESM 驱动的模块服务
3. 模块图与 HMR
4. 插件机制：统一的扩展点
5. 生产构建：完整的优化流水线
6. dev 与 build 的差异
7. 总结
```

### 开场

- 1-2 段直接点出"dev/build 是两套独立的优化策略"，作为讲透 Vite 的前提。
- 用一行 inline code 给出核心链路：`启动 dev server -> 依赖预构建 -> 浏览器 ESM 加载 -> 按需转换 -> HMR -> build`。
- 不再展开术语解释（dev server、ESM、HMR、build 在各自章节里自然带出）。
- 不再放独立的"主流程图"和 6 个术语定义列表（原大纲 16 行的开篇压到 4 行）。

### 一、dev 启动：让浏览器参与模块加载

**范围**

- dev server 启动流程：加载配置 → 解析插件 → 创建 server → 注入客户端 runtime。
- 依赖预构建要解决的 2 个问题：CJS/UMD 兼容 + 请求数量爆炸。
- 预构建产物：`node_modules/.vite/deps`、hash 缓存、首次冷启动 vs 后续启动。

**关键点**

- 浏览器原生 ESM 不认识裸模块导入，预构建是把 `import React from 'react'` 改写成 `/node_modules/.vite/deps/react.js?v=hash`。
- 预构建的优化前提是"变化少 + 强缓存"：第三方依赖体积大、变化少，适合预构建；源码变化多，预构建缓存会频繁失效。

**实战**

- `optimizeDeps.include` / `optimizeDeps.exclude` 配置场景。
- 冷启动后 `node_modules/.vite/deps` 目录结构解读。
- 预构建何时触发重跑（依赖 lockfile 变化、配置变化）。

**面试点**

- 为什么需要依赖预构建？两个原因分别举具体例子。
- 预构建产物为什么放在 `node_modules/.vite/deps` 而不是项目目录？

### 二、源码按需转换：ESM 驱动的模块服务

**范围**

- 浏览器 ESM 加载模型：import 触发模块请求，Vite dev server 返回可执行模块。
- 服务端模块处理：`resolveId` → `load` → `transform` 三步。
- transform 的责任边界：TS / JSX / CSS / Vue SFC / 自定义扩展。
- 缓存策略：文件时间戳、HTTP 协商缓存、依赖缓存。

**关键点**

- Vite 的开发模式是"模块服务"而不是"提前打包"——浏览器天然知道自己还需要哪些子模块，Vite 只在被请求时转换。
- 按需转换不等于每次重新转换：缓存 + 协商让重复请求不重做工作。

**实战**

- 自定义 transform 钩子：把 `.svg` 当成 React 组件返回。
- 处理 CSS / 静态资源的 plugin 链顺序。
- 304 协商缓存的触发条件。

**面试点**

- Vite 怎么把 TS / JSX 跑在浏览器里？transform 链都做了什么？
- 按需转换和"懒加载"是不是一回事？区别在哪？

### 三、模块图与 HMR

**范围**

- 模块图数据结构：`url / id / file / importers / importedModules / acceptedHmrDeps / transformResult`。
- 模块图是 dev server 的运行时索引，浏览器负责真实加载，Vite 负责记录关系。
- 文件监听：chokidar 检测变化 → 定位 ModuleNode → 清理转换缓存。
- HMR 边界：accept 回调机制 + 向上找 importers。
- 客户端 HMR 流程：import 新模块（带 `?t=timestamp`）→ accept 回调 → 框架运行局部更新。
- 找不到 HMR 边界时的整页刷新。

**关键点**

- 模块图是 Vite 的核心数据结构，HMR 边界判断完全依赖它。
- 同一份模块图同时服务"加载阶段"和"HMR 阶段"——这与 dev/build 拆成两套策略不矛盾，因为模块图只在 dev 维护。

**实战**

- 手写 `import.meta.hot.accept` 监听某个依赖的变化。
- 框架集成：Vue SFC / React Fast Refresh 怎么把组件级更新接入 Vite HMR API。
- 整页刷新兜底的常见触发场景（全局副作用、状态初始化、复杂 module 拓扑）。

**面试点**

- 模块图里 `importers` 和 `importedModules` 怎么用？HMR 边界向上查找的具体路径。
- React 组件状态能不能保留，取决于谁？Vite 还是 React Fast Refresh？
- 哪些场景下 HMR 一定退化为整页刷新？

### 四、插件机制：统一的扩展点

**范围**

- 钩子全景：开发阶段（`config / configureServer / resolveId / load / transform / handleHotUpdate`）vs 构建阶段（`buildStart / generateBundle / closeBundle` 等 Rollup 钩子）。
- 钩子调用顺序：dev 模式下 `resolveId → load → transform` 是一条链；handleHotUpdate 在文件变化时触发。
- 实战：手写一个 Vite 插件（场景自定，如 `.txt` 资源处理 / 注入全局变量 / 简单的 alias）。
- 常用插件推荐：`@vitejs/plugin-vue`、`@vitejs/plugin-react`、`unplugin-*` 系列。

**关键点**

- 同一套插件系统能同时覆盖 dev 和 build，但 Vite 会根据当前命令选择不同执行路径——开发钩子在 dev server 里跑，构建钩子在 Rollup pipeline 里跑。
- 插件不是只服务生产构建，开发体验（dev server 中间件、HMR 处理）也靠插件扩展。

**实战**

- 手写一个 `my-alias` 插件：把 `@/` 映射到 `src/`，分别在 dev 和 build 下验证。
- 解释 unplugin 是什么、为什么会出现（跨构建工具复用同一份插件逻辑）。

**面试点**

- 一个 Vite 插件要覆盖开发体验和生产构建，需要同时实现哪几类钩子？
- `handleHotUpdate` 钩子返回 `undefined` 和返回一个空数组，行为分别是什么？

### 五、生产构建：完整的优化流水线

**范围**

- 为什么 dev 模式不能直接用于生产：没有 Tree Shaking、没有压缩、没有 hash、没有 modulepreload。
- 构建流程：入口 → 模块图 → 插件构建钩子 → 优化 → 产物。
- 优化策略详解：Tree Shaking、Code Splitting、CSS 拆分、资源 hash、modulepreload、压缩。
- 产物结构：`dist/` 下 HTML / JS / CSS / 静态资源的关系。

**关键点**

- 生产构建会做开发阶段不适合做的事：移除死代码、压缩体积、生成长期缓存友好的文件名、为入口生成预加载提示。
- dev 模式追求"每次改动后的反馈速度"，build 模式追求"用户访问时的加载效率"——两个不同问题，所以 Vite 才用两套策略。

**实战**

- `build.target` / `build.cssCodeSplit` / `build.rollupOptions` 三个最常用的 build 配置。
- 产物分析：为什么某个 chunk 这么大？用 `rollup-plugin-visualizer` 看依赖占比。
- 多入口 / 动态导入对 chunk 拆分的影响。

**面试点**

- Tree Shaking 依赖什么前提？ESM 的哪个特性让它能生效？
- 资源 hash 怎么保证长期缓存友好？`contenthash` 和 `chunkhash` 区别。

### 六、dev 与 build 的差异

**范围**

- 首屏请求膨胀：dev 不打包，浏览器按模块请求；大项目或首屏依赖复杂时可能请求数过多。
- 类型检查与转译分离：Vite 默认只做 TS 转译，类型检查要交给 `tsc --noEmit` 或编辑器 / CI。
- HMR 不可用场景：全局副作用模块、复杂状态初始化、动态依赖。
- 动态导入路径在 dev / build 下解析行为可能不同（动态字符串变量在 build 时无法静态分析）。
- 资源路径依赖 `base` 配置：dev 默认 `/`，build 默认 `./`，部署到子路径时需要正确设置。
- chunk 拆分后可能出现的加载失败或缓存问题。

**关键点**

- dev 和 build 不是完全同一条链路，所以 dev 通过 ≠ build 通过。
- 关键改动必须跑 `vite build` 验证，并在必要时预览构建产物（`vite preview`）。

**实战**

- `tsc --noEmit --watch` 作为独立进程跑类型检查的常见实践。
- `import.meta.env.DEV` / `import.meta.env.PROD` 在代码里区分 dev / build 行为。
- `base` 配置在不同部署场景下的值（CDN 根路径、子路径、相对路径）。

**面试点**

- 为什么 Vite dev 通过了但 build 失败？举两个具体原因。
- 类型检查为什么不能放进 Vite dev？放在 CI 和编辑器里有什么取舍？

### 七、总结

- 收束 Vite 的设计哲学：把开发时最贵的"全量打包"推迟，让浏览器和开发服务器各做擅长的事。
- 选型建议：什么场景选 Vite（现代 ESM 项目、对启动速度敏感的项目），什么场景保留 Webpack（强控制力、复杂 loader 链、历史模块格式支持）。
- 不重复目录。

## d2 图清单

| 章节 | 用途 | 关键节点 |
| ---- | ---- | -------- |
| 二 | 浏览器加载 + 按需转换主链路 | dev server 子容器（resolveId/load/transform） |
| 三 | HMR 流程（含决策） | 存在 HMR 边界? 决策节点 + 整页刷新兜底 |
| 五 | 生产构建流水线 | 入口 → 模块图 → 优化策略 → 产物 |

仅 3 张 d2 图，避免堆图。

## 写作节奏约束

- 每章 800-1500 字（不含代码块），整篇 6000-9000 字。
- 每章必须出现至少 1 段"实战"内容（配置 / 代码示例）。
- 章节末尾用 2-4 行"关键点 / 面试点"收口，列出本章 2-3 个核心结论或常问问题。
- 不为填充篇幅堆术语解释；每段都要有信息密度。
- 不为显结构而机械分段；短句该合就合。

## 落地流程

1. 按本 spec 写实现计划（章节顺序、每章字数、是否新增 d2 节点、代码示例具体内容）。
2. 按实现计划落到 `apps/docs/experiences/构建工具/Vite 原理.md`。
3. 写完后跑 d2 编译（如果有 d2 改动）确保渲染正常。
4. 文章保持 `draft: true`，由用户审阅后再去掉 draft。
