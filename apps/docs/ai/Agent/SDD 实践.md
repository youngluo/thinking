---
createdAt: '2026-06-10 20:00'
order: 7
---

# SDD 实践

AI 编码工具越来越强之后，一个绕不开的问题是：能不能把需求丢给 Agent，让它自己读代码、改代码、运行测试？

真实项目里这条路并不稳。Agent 越强，越需要把需求、边界、验收方式提前写清楚；否则它能很快地产出大量代码，但你很难判断这些代码是不是沿着正确方向在前进。

SDD（Spec-Driven Development，规格驱动开发）要解决的就是这个矛盾：先明确要做什么、为什么做、怎么验收，再让 Agent 或开发者按规格实现。

## 什么是 SDD

SDD 不是新框架，也不是某个工具的专属流程。它更接近一种工作方法：把软件开发里那些容易散落在聊天、会议、脑子里的信息，整理成可以被人和 Agent 共同读取的规格文档。

一个完整的 SDD 流程通常会包含几类材料：

| 材料                | 作用                                     |
| ------------------- | ---------------------------------------- |
| Product Spec        | 说明用户问题、目标、范围和非目标         |
| Technical Design    | 说明技术方案、接口、数据结构和关键取舍   |
| Implementation Plan | 把方案拆成可执行步骤，每一步都有验证方式 |
| Acceptance Criteria | 定义什么叫完成，避免只看代码是否生成     |

注意，这些是概念上的分类，OpenSpec 等具体工具会有自己的目录结构，但思想是相通的。SDD 的核心价值不是"多写文档"，而是减少猜测：规格让人和人之间的沟通成本下降，对 Agent 来说，规格就是执行时清晰可用的输入。

```mermaid
%%{init: {'themeVariables': {'lineColor': '#7fa3ff'}}}%%
flowchart LR
    A[模糊需求] --> B[规格澄清]
    B --> C[技术设计]
    C --> D[任务拆解]
    D --> E[实现与验证]
    E --> F[交付]

    style A fill:#ffcdd2,stroke:#b71c1c,stroke-width:1px,rx:4,ry:4
    style B fill:#7fa3ff29,stroke:#07f,stroke-width:1px,rx:4,ry:4
    style C fill:#7fa3ff29,stroke:#07f,stroke-width:1px,rx:4,ry:4
    style D fill:#7fa3ff29,stroke:#07f,stroke-width:1px,rx:4,ry:4
    style E fill:#7fa3ff29,stroke:#07f,stroke-width:1px,rx:4,ry:4
    style F fill:#c8e6c9,stroke:#1b5e20,stroke-width:1px,rx:4,ry:4
```

如果说 TDD 是"先写测试，再写实现"，SDD 把这一步再往前推：**先写清楚要解决什么问题，再决定测试和实现怎么写**，规格是测试和实现共同的上游。

## OpenSpec

OpenSpec 是一个开源的 SDD 工具，给 AI 编码助手加了一层"先对齐再编码"的规范。需求不再只散落在聊天记录里，每一次变更都有对应的目录、产物和归档。

- 先对齐再编码：人和 Agent 在写代码前，先在规格和验收标准上达成一致。
- 变更可追踪：每次变更一个目录，里面有 `proposal.md`、`design.md`、`tasks.md` 和规格增量。
- 持续更新：方案、任务和规格可以跟着实现走，发现偏差先更新文档，再继续执行。

### 安装使用

全局安装：

```bash
pnpm install -g @fission-ai/openspec@latest
```

进入项目并初始化：

```bash
cd your-project
openspec init
```

初始化后，项目里会出现 `openspec/` 目录：

```text
openspec/
  specs/                      # 已生效的能力规格
    <capability>/
      spec.md
  changes/                    # 正在设计或实现的变更
    <change-id>/
      proposal.md
      design.md
      tasks.md
      specs/
        <capability>/
          spec.md
  config.yaml                 # 项目级配置，按需存在
```

`specs/` 是已经生效的能力规格，是系统当前行为的事实来源，按领域组织，例如 `specs/auth/`、`specs/payments/`。`changes/` 是正在设计或实现的变更，每个变更一个目录，相关的设计文档和规格增量都放在里面；变更完成后，增量规格会合入主规格。

### 核心产物

每个 change 目录里有四类产物，理解它们才能把流程走顺：

| 产物          | 作用                                         |
| ------------- | -------------------------------------------- |
| `proposal.md` | 说明为什么做、做什么、不做什么               |
| `design.md`   | 说明技术方案、接口、迁移、风险和关键取舍     |
| `specs/`      | 描述本次变更对系统能力的增量要求             |
| `tasks.md`    | 把实现拆成可勾选任务，每个任务最好带验证方式 |

四个产物形成一条递进链路：`proposal.md` 回答"要不要做"，`design.md` 回答"怎么做"，`specs/` 回答"系统应该表现成什么样"，`tasks.md` 回答"具体怎么一步步落地"。

### 常用命令

#### 默认快速路径

| 命令            | 用途                         |
| --------------- | ---------------------------- |
| `/opsx:propose` | 创建变更，一次性生成规划产物 |
| `/opsx:explore` | 在正式创建变更前，先梳理想法 |
| `/opsx:apply`   | 按变更产物实现任务           |
| `/opsx:sync`    | 把增量规格合并到主规格       |
| `/opsx:archive` | 归档已完成变更               |

#### 扩展工作流命令（自定义模式后启用）

| 命令                 | 用途                     |
| -------------------- | ------------------------ |
| `/opsx:new`          | 创建一个新的变更骨架     |
| `/opsx:continue`     | 按依赖关系生成下一个产物 |
| `/opsx:ff`           | 快速生成全部规划产物     |
| `/opsx:verify`       | 校验实现是否匹配变更产物 |
| `/opsx:bulk-archive` | 一次归档多个已完成变更   |
| `/opsx:onboard`      | 引导式走完整个工作流     |

默认只包含快速路径命令。如果需要扩展命令，可以执行 `openspec config profile` 选对应模式，再在项目里执行 `openspec update`。

### 一个变更的完整流程

下面用一个真实例子走一遍主路径：把首页改成一个 3D 知识星球效果。命令前缀因工具而异：Codex 中输入 `$` 选对应 skill，Claude Code 中输入 `/` 触发 commands。

#### 1. 提出变更

```bash
/opsx:propose 把首页改成一个知识星球的 3D 效果
```

OpenSpec 会先确认需求，再把这句话整理成 kebab-case 的变更名。这个示例会生成 `add-3d-knowledge-planet`，并按 proposal、design/specs、tasks 的顺序补齐产物：

```text
openspec/changes/add-3d-knowledge-planet/
  proposal.md
  design.md
  tasks.md
  specs/home-3d-planet/spec.md
```

#### 2. 实施变更

```bash
/opsx:apply add-3d-knowledge-planet
```

`apply` 会读取刚才生成的产物，按 `tasks.md` 逐项实现，完成一项就勾选。这样 `tasks.md` 不只是计划，也会变成一份真实的执行记录。

#### 3. 验证变更

```bash
/opsx:verify add-3d-knowledge-planet
```

实现完成后、归档前可以执行这个命令，确认产出是否与变更文档相符。它关注的不是"测试全过"那么简单，而是把还没做的事、偏离 spec 的地方、需要人工验证的项列清楚。CRITICAL 修完、WARNING 评估过之后，再进入归档。

#### 4. 归档变更

```bash
/opsx:archive add-3d-knowledge-planet
```

归档会结束这个 change，把它移到 archive 目录，并把变更里的规格增量合入主规格。之后再做相关需求，新的 change 会以更新后的主规格作为事实来源。

### 中途改方案怎么办

实现中经常会发现 design 跟实际代码不完全一致，或者做着做着才意识到原方案不够好。这时不能闷头改代码。

更稳的做法是先回写文档：目标和范围变化改 `proposal.md`，技术路线变化改 `design.md`，系统行为变化改 `specs/`，执行步骤变化改 `tasks.md`。文档重新对齐后，再继续 `/opsx:apply`。

如果只是觉得方案还不够清楚但说不出具体问题，可以先执行 `/opsx:explore` 和 AI 讨论。方案确定后，再把讨论结果落回 OpenSpec 文档。

## Superpowers

如果说 OpenSpec 更偏"规格文档管理"，Superpowers 更偏"把 Agent 的开发流程制度化"。

Superpowers 是一组面向编码 Agent 的 skills，把常见工程动作拆成可组合的工作流，包括 brainstorming、writing-plans、test-driven-development、systematic-debugging、verification-before-completion 等。它的核心思路是：不让 Agent 一上来就写代码，而是先澄清意图、形成规格、写计划，再按可验证步骤执行。

```mermaid
%%{init: {'themeVariables': {'lineColor': '#7fa3ff'}}}%%
flowchart LR
    A[初始想法] --> B[需求澄清]
    B --> C[实现计划]
    C --> D[测试驱动实现]
    D --> E[代码评审]
    E --> F[完成前验证]
    F --> G[完成或合并]

    style A fill:#ffcdd2,stroke:#b71c1c,stroke-width:1px,rx:4,ry:4
    style B fill:#7fa3ff29,stroke:#07f,stroke-width:1px,rx:4,ry:4
    style C fill:#7fa3ff29,stroke:#07f,stroke-width:1px,rx:4,ry:4
    style D fill:#7fa3ff29,stroke:#07f,stroke-width:1px,rx:4,ry:4
    style E fill:#7fa3ff29,stroke:#07f,stroke-width:1px,rx:4,ry:4
    style F fill:#7fa3ff29,stroke:#07f,stroke-width:1px,rx:4,ry:4
    style G fill:#c8e6c9,stroke:#1b5e20,stroke-width:1px,rx:4,ry:4
```

Superpowers 给 Agent 装了一套"工程习惯"，主要强调几件事：先澄清需求再实现、复杂任务先写计划、功能和 bugfix 尽量按 TDD 推进、完成前必须验证、较大任务可以用子 Agent 拆分执行。

### 安装使用

在 Claude Code 里，通过 `/plugin` 命令从插件市场搜索 Superpowers 并安装。

装好之后，Superpowers 的用法不是记一堆命令，而是让 Agent 在合适场景触发对应 skill。

例如想从需求开始：

```bash
我想给列表页增加批量导出功能，先和我一起梳理方案。
```

这时适合触发 `brainstorming`，把需求澄清成规格。

方案已经明确后，可以继续说：

```bash
请基于刚才的方案写一个实现计划。
```

这时适合触发 `writing-plans`，把方案拆成具体文件、测试和执行步骤。

真正开始开发时，再让 Agent 按计划执行，并要求它在每一步执行对应验证命令。

### 完整 skill 列表

Superpowers 提供的 skill 按用途分成 3 类。

| 分类 | Skill                            | 作用                                                   |
| ---- | -------------------------------- | ------------------------------------------------------ |
| 测试 | `test-driven-development`        | RED-GREEN-REFACTOR 循环，含测试反模式参考              |
| 调试 | `systematic-debugging`           | 四阶段根因分析，含根因追踪、纵深防御、条件式等待等技巧 |
| 调试 | `verification-before-completion` | 确保问题真的被修好                                     |
| 协作 | `brainstorming`                  | 通过问答逐步澄清设计                                   |
| 协作 | `writing-plans`                  | 把设计拆成可执行的实现计划                             |
| 协作 | `executing-plans`                | 按计划批量执行，关键节点设人工检查点                   |
| 协作 | `dispatching-parallel-agents`    | 并发调度多个子 Agent                                   |
| 协作 | `requesting-code-review`         | 评审前的自检清单                                       |
| 协作 | `receiving-code-review`          | 回应评审反馈                                           |
| 协作 | `using-git-worktrees`            | 用独立 worktree 做并行开发                             |
| 协作 | `finishing-a-development-branch` | 决定分支如何收尾（合并 / 提 PR / 保留 / 丢弃）         |
| 协作 | `subagent-driven-development`    | 快速迭代，每任务做规格符合性 + 代码质量两阶段评审      |

### 常用工作流

把开发主流程里高频用到的 skill 串成一条完整工作流。

```mermaid
%%{init: {'themeVariables': {'lineColor': '#7fa3ff'}}}%%
flowchart LR
    A[模糊需求] --> B[澄清目标和约束]
    B --> C[拆成实现计划]
    C --> D[创建隔离工作区]
    D --> E[派发子 Agent]
    E --> F[测试驱动实现]
    F --> G[代码评审]
    G --> H[完成前验证]
    H --> I[分支收尾]

    style A fill:#ffcdd2,stroke:#b71c1c,stroke-width:1px,rx:4,ry:4
    style B fill:#7fa3ff29,stroke:#07f,stroke-width:1px,rx:4,ry:4
    style C fill:#7fa3ff29,stroke:#07f,stroke-width:1px,rx:4,ry:4
    style D fill:#7fa3ff29,stroke:#07f,stroke-width:1px,rx:4,ry:4
    style E fill:#7fa3ff29,stroke:#07f,stroke-width:1px,rx:4,ry:4
    style F fill:#7fa3ff29,stroke:#07f,stroke-width:1px,rx:4,ry:4
    style G fill:#7fa3ff29,stroke:#07f,stroke-width:1px,rx:4,ry:4
    style H fill:#7fa3ff29,stroke:#07f,stroke-width:1px,rx:4,ry:4
    style I fill:#c8e6c9,stroke:#1b5e20,stroke-width:1px,rx:4,ry:4
```

#### Brainstorming

当需求还停在“想做某个能力，但交互、接口和边界都没想清楚”时，先用 Brainstorming，而不是直接进入计划或编码。它会通过提问澄清目标、约束和备选方案，分段呈现设计供确认；确认后的结论再沉淀成文档，后续 `writing-plans` 才有稳定输入。

典型触发方式是：

```bash
我想做一个导出能力，但还没确定交互和接口设计，先帮我梳理。
```

#### Writing Plans

设计批准后接手。它把工作拆成 2-5 分钟可完成的小任务，每一项都给出具体的文件路径、完整代码草稿、验证步骤。

一个好的计划应该包含：要修改哪些文件、每一步做什么、每一步怎么验证、需要新增哪些测试、什么时候提交或进入下一步。计划越具体，Agent 执行时越不容易跑偏。

#### Using Git Worktrees

开始执行前切到独立工作区。它在新分支上创建 worktree，初始化项目（安装依赖、迁移），并确认基线测试是绿的。后面所有工作都在这个隔离空间里进行，避免污染主分支。

#### Subagent-Driven Development

计划就绪后开始执行。每个任务交给一个全新的子 Agent 跑，执行过程有"规格符合性 + 代码质量"两阶段评审。也可以用 `executing-plans` 模式批量执行、设置人工检查点。

#### Test-Driven Development

实现阶段强制 RED-GREEN-REFACTOR：

1. 先写失败测试；
2. 确认测试因为预期原因失败；
3. 写最少实现让测试通过；
4. 重构，并保持测试通过。

这对 Agent 尤其重要。Agent 很擅长生成实现，但如果没有先定义验证方式，它也很容易生成"看起来合理但实际没证明"的代码。能运行不代表对，通过也不代表覆盖了边界。而且，TDD 强制先写测试，不会让 Agent 提前写出未经验证的实现。

#### Requesting Code Review

每个任务完成后、下一个任务开始前，它对照计划逐项检查实现，按严重度报告问题。Critical 级问题会阻塞后续任务，必须先解决。

#### Finishing a Development Branch

所有任务完成后收尾。它会先验证测试是否全绿，然后给出四个选项：合并 / 提 PR / 保留分支 / 丢弃 worktree，并执行对应清理。

## OpenSpec 和 Superpowers 对比

两者都能服务 SDD，但关注点不一样。

| 维度       | OpenSpec                     | Superpowers                  |
| ---------- | ---------------------------- | ---------------------------- |
| 核心定位   | 管理规格和变更               | 管理 Agent 工作流            |
| 主要产物   | spec、design、tasks 等文档   | skill 驱动的流程和计划       |
| 最适合场景 | 长期维护、跨人协作、变更追踪 | Agent 编码、调试、计划、验证 |
| 优势       | 规格结构清晰，便于归档和审查 | 强约束执行过程，减少随意发挥 |
| 风险       | 只写规格但执行不受控         | 流程强度高，小任务显得重     |
| 关注问题   | "我们到底要做什么"           | "Agent 怎么把事做对"         |

更实用的方式不是二选一，而是组合：

```text
OpenSpec 管需求和变更上下文
Superpowers 管 Agent 的执行纪律
```

比如一个复杂功能可以这样组织：

1. 用 OpenSpec 写 `proposal.md`、`tasks.md` 和规格增量；
2. 让 Superpowers 的 writing-plans 把任务拆到可执行粒度；
3. 开发时用 TDD 和 verification-before-completion 控制质量；
4. 完成后回到 OpenSpec 的验收标准逐项检查。

## 如何协作

工具和流程都有了，SDD 真正起效果还要看人和 Agent 怎么分工：对人的要求不是写更多漂亮文档，而是把关键判断提前说清楚。

### 你负责判断方向

判断方向最好由人来做：这个需求是不是真的要做、哪些场景必须覆盖、哪些边界可以暂时不做、技术取舍是否符合团队长期方向、验收标准是否足够代表真实目标。Agent 可以给建议，但不应该替人决定产品边界和工程取舍。

### Agent 负责推进执行

执行层面更适合交给 Agent：根据规格搜索相关代码、生成测试用例、拆解实现步骤、修改局部代码、运行测试并整理失败信息、根据验证结果继续迭代。让 Agent 做事时最好给它三类上下文：目标是这次要完成什么、边界是哪些事情不要做、验证是怎么证明完成。如果一句话里能同时包含这三点，Agent 的输出质量通常会稳定很多。

### 小任务不要过度流程化

SDD 不是把所有事情都变成仪式，改一个错别字、调整一个样式间距、补一行注释都不需要完整 spec。判断要不要走 SDD 的标准是：这个任务涉及多个文件、多个角色或多个隐藏决策吗？如果是，就值得写规格；如果只是一处明确的小改动，直接改完并验证即可。

## 总结

SDD 的核心是把"想法"变成"可执行、可验证、可复查"的规格。OpenSpec 适合沉淀需求和变更，让项目有清晰的规格来源；Superpowers 适合约束 Agent 的执行过程，让它先澄清、再计划、再验证，前者解决"上下文放在哪里"，后者解决"Agent 怎么按工程方式工作"。Agent 开发能不能真正起效，关键在于有没有给它足够清晰的目标、边界和反馈回路，SDD 的价值就在这里：让人负责判断，让 Agent 负责执行，让每一步都有证据可查。
