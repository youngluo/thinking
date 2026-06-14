# Rspress D2 预渲染设计

## 背景

当前文档站使用 `rspress-plugin-mermaid` 渲染流程图。Mermaid 图依赖浏览器端渲染，项目配置里还需要扫描包含 ` ```mermaid ` 的页面并排除 SSG。后续希望用 D2 替代 Mermaid，让流程图在 Rspress 构建阶段预渲染成 SVG，减少运行时依赖，并恢复这些页面的静态渲染能力。

## 目标

- Markdown 图表写法统一为 ` ```d2 `。
- `docs:dev` 和 `docs:build` 都支持 D2 渲染。
- D2 图在 Rspress Markdown 编译阶段预渲染为 SVG。
- 渲染结果以内联 SVG 输出，不引入浏览器端 D2 渲染逻辑。
- 迁移完成后移除 Mermaid 插件、依赖、SSG 排除逻辑和 Mermaid 项目规范。

## 非目标

- 不支持外链 `.d2` 文件。
- 不支持每张图独立配置 theme、layout 或渲染参数。
- 不提供图表编辑器、实时预览器或运行时渲染组件。
- 不编写 Mermaid 到 D2 的自动转换器。
- 不生成独立 SVG 文件，先以内联 SVG 为主。

## 推荐方案

新增 Rspress 本地 Markdown 插件 `pluginD2PreRender()`。插件遍历 Markdown AST，找到语言为 `d2` 的 fenced code block，在 Node 构建期调用 D2 渲染器生成 SVG，然后把原代码块替换成 HTML 节点。

渲染器优先使用 `@terrastruct/d2` npm 包。这个包是 D2 WASM 构建的 JavaScript wrapper，可以随 `pnpm install` 安装，CI 和本地环境更容易保持一致。如果 `@terrastruct/d2` 的 Node 渲染 API、布局引擎或 SVG 输出能力不能满足文档站需求，再切换到 D2 CLI 子进程方案。

最终输出结构：

```html
<div class="d2-diagram" role="img">
  <svg>...</svg>
</div>
```

## 插件行为

- 只处理 `lang === 'd2'` 的 fenced code block。
- D2 源码为空时直接报错。
- D2 渲染失败时直接让 dev/build 编译失败。
- 错误信息包含 Markdown 文件路径、D2 代码块序号和原始渲染错误。
- `docs:dev` 和 `docs:build` 使用同一套渲染逻辑。
- `docs:dev` 增加内存缓存，缓存 key 由文件路径、D2 源码和统一渲染参数组成，避免页面刷新或热更新时重复渲染未变化的图。
- 插件只接收 D2 渲染器输出的 SVG，不允许手写 HTML 直接进入图表容器。

## 样式

在 `apps/docs/theme/custom.css` 中增加少量全局样式：

```css
.d2-diagram {
  margin: 24px 0;
  overflow-x: auto;
}

.d2-diagram svg {
  max-width: 100%;
  height: auto;
}
```

这保证大图在窄屏下可以横向滚动，同时不会撑破正文宽度。

## Mermaid 迁移策略

直接替换 Mermaid，但执行上分阶段：

1. 先接入 D2 预渲染插件，并保留 Mermaid 插件作为迁移期间的兼容层。
2. 选择一篇图少的文章改成 ` ```d2 `，验证渲染、样式和构建表现。
3. 迁移 `Agent 应用中的流处理.md` 这类近期编辑过的文章，确认真实阅读效果。
4. 按语义手动迁移其余 Mermaid 图，不做机械自动转换。
5. `rtk rg '```mermaid' apps/docs` 清零后，移除 `rspress-plugin-mermaid`、`getMermaidRoutePaths()`、`ssg.experimentalExcludeRoutePaths` 和 Mermaid 规范。

Mermaid 中大量 `style A fill:...` 这类节点样式不应逐行翻译成 D2。D2 迁移应优先保持图的语义清晰，再用全站统一样式承接视觉一致性。

## 验证方式

- 新增最小 D2 代码块样例，运行 `rtk pnpm docs:build`。
- 启动 `rtk pnpm docs:dev`，修改 D2 代码块后确认页面能重新渲染。
- 人为写错 D2 语法，确认 dev/build 都会报错，并包含文件路径和代码块序号。
- 迁移过程中持续运行 `rtk rg '```mermaid' apps/docs` 检查剩余 Mermaid 图。
- 全量迁移后运行 `rtk pnpm docs:build`，确认文档站构建通过。

## 风险与取舍

- `@terrastruct/d2` 是首选，但需要先验证它在 Node 构建期的 API 和 SVG 输出是否满足需求。如果不满足，CLI fallback 会引入系统级依赖。
- 内联 SVG 会增加 HTML 体积，但当前文档站图表数量可控，换来的是路径管理简单、预渲染结果直观。
- 渲染失败直接中断 dev/build 会让错误暴露更早，代价是写图时容错性更低。这个取舍符合文档构建应尽早失败的原则。
- 手动迁移 Mermaid 图比自动转换慢，但能避免生成难维护的 D2 源码。
