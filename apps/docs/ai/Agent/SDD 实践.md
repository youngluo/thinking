---
createdAt: '2026-06-10 20:00'
order: 8
---

# SDD 实践

AI 编码工具越来越强之后，一个绕不开的问题是：能不能把需求丢给 Agent，让它自己读代码、改代码、运行测试？

真实项目里这条路并不稳。Agent 越强，越需要把需求、边界、验收方式提前写清楚；否则它能很快地产出大量代码，但你很难判断这些代码是不是沿着正确方向在前进。

SDD（Spec-Driven Development，规格驱动开发）要解决的就是这个矛盾：先明确要做什么、为什么做、怎么验收，再让 Agent 或开发者按规格实现。

## 什么是 SDD

SDD 是一种工作方法：把软件开发中容易散落在聊天、会议和个人经验里的信息，整理成可供开发者和 Agent 共同读取的规格文档。

一个完整的 SDD 流程通常会包含几类材料：

| 材料                | 作用                                     |
| ------------------- | ---------------------------------------- |
| Product Spec        | 说明用户问题、目标、范围和非目标         |
| Technical Design    | 说明技术方案、接口、数据结构和关键取舍   |
| Implementation Plan | 把方案拆成可执行步骤，每一步都有验证方式 |
| Acceptance Criteria | 定义什么叫完成，避免只看代码是否生成     |

这些是概念上的分类，OpenSpec 等工具会有自己的目录结构。SDD 的核心价值在于减少猜测：规格既能降低协作中的沟通成本，也能为 Agent 提供清晰的执行输入。

从模糊需求到交付，规格依次连接需求澄清、技术设计、任务拆解和实现验证：

```d2
direction: right

A: 模糊需求
B: 规格澄清
C: 技术设计
D: 任务拆解
E: 实现与验证
F: 交付

A -> B -> C -> D -> E -> F
```

TDD 强调“先写测试，再写实现”，SDD 则把规格放在测试和实现的上游：**先写清楚要解决什么问题，再决定测试和实现怎么写**。

## OpenSpec

OpenSpec 是一个开源的 SDD 工具，为 AI 编码助手提供“先对齐再编码”的工作方式。需求不再只散落在聊天记录里，每次变更都有独立的目录和产物，完成后统一归档。

- 先对齐再编码：人和 Agent 在写代码前，先在规格和验收标准上达成一致；
- 变更可追踪：每次变更一个目录，里面有 `proposal.md`、`design.md`、`tasks.md` 和规格增量；
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

```text fold title="openspec/"
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

`specs/` 是已经生效的能力规格，是系统当前行为的事实来源，按领域组织，例如 `specs/auth/`、`specs/payments/`。`changes/` 是正在设计或实现的变更，每个变更一个目录，相关的设计文档和规格增量都放在里面；变更完成并选择同步后，增量规格会合入主规格。

### 核心产物

每个变更目录包含四类核心产物：

| 产物          | 作用                                         |
| ------------- | -------------------------------------------- |
| `proposal.md` | 说明为什么做、做什么、不做什么               |
| `design.md`   | 说明技术方案、接口、迁移、风险和关键取舍     |
| `specs/`      | 描述本次变更对系统能力的增量要求             |
| `tasks.md`    | 把实现拆成可勾选任务，每个任务最好带验证方式 |

四个产物形成一条递进链路：`proposal.md` 说明为什么做以及范围是什么，`specs/` 定义系统应该表现出的行为，`design.md` 记录技术方案和关键取舍，`tasks.md` 再把这些内容拆成执行步骤。

### 常用命令

#### 默认快速路径

| 命令            | 用途                         |
| --------------- | ---------------------------- |
| `/opsx:propose` | 创建变更，一次性生成规划产物 |
| `/opsx:explore` | 在正式创建变更前，先梳理想法 |
| `/opsx:apply`   | 按变更产物实现任务           |
| `/opsx:update`  | 更新已有变更的规划产物       |
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

OpenSpec 的命令和 `profile` 会随版本调整。当前 `core` profile 使用上面的快速路径；如果需要扩展命令，可以执行 `openspec config profile` 选择对应模式，再在项目里执行 `openspec update`。

### 一个变更的完整流程

下面用一个具体例子走一遍主路径：把首页改成一个 3D 知识星球效果。命令前缀因工具而异：Codex 中输入 `$` 选择对应的 OpenSpec skill，支持 slash command 的工具使用 `/opsx:*`。下文以 `/opsx:*` 为例。

#### 提出变更

```bash
/opsx:propose 把首页改成一个知识星球的 3D 效果
```

OpenSpec 会根据描述创建 kebab-case 格式的变更名；如果信息不足，Agent 需要继续确认需求。这个示例会生成 `add-3d-knowledge-planet`，并按产物依赖补齐规格与计划：

```text fold title="openspec/changes/add-3d-knowledge-planet/"
openspec/changes/add-3d-knowledge-planet/
  proposal.md
  design.md
  tasks.md
  specs/home-3d-planet/spec.md
```

#### 实施变更

```bash
/opsx:apply add-3d-knowledge-planet
```

`apply` 会读取刚才生成的产物，按 `tasks.md` 逐项实现，完成一项就勾选。这样 `tasks.md` 不只是计划，也会变成一份真实的执行记录。

#### 验证变更

```bash
/opsx:verify add-3d-knowledge-planet
```

实现完成后、归档前可以执行这个命令，检查实现的完整性、正确性和一致性。它会列出未完成的任务、偏离规格的实现和需要人工确认的项目，并按 CRITICAL、WARNING、SUGGESTION 分类。这个命令不会阻止归档，但更稳妥的做法是先修复 CRITICAL，并评估 WARNING。

#### 归档变更

```bash
/opsx:archive add-3d-knowledge-planet
```

归档会检查产物和任务的完成状态，并在规格增量尚未同步时询问是否合入主规格，最后把变更移到 `openspec/changes/archive/`。完成同步后，后续变更会以更新后的主规格为事实来源。

### 中途改方案怎么办

实现中经常会发现 `design.md` 跟实际代码不完全一致，或者做着做着才意识到原方案不够好。这时不能闷头改代码。

更稳的做法是先回写文档：目标和范围变化改 `proposal.md`，技术路线变化改 `design.md`，系统行为变化改 `specs/`，执行步骤变化改 `tasks.md`。文档重新对齐后，再继续 `/opsx:apply`。

如果只是觉得方案还不够清楚但说不出具体问题，可以先执行 `/opsx:explore` 和 AI 讨论。方案确定后，再把讨论结果落回 OpenSpec 文档。

## Superpowers

OpenSpec 负责管理规格和变更，Superpowers 则约束 Agent 如何执行开发任务。

Superpowers 是一组面向编码 Agent 的 skill，把需求澄清、计划、测试驱动开发、调试、评审和完成前验证组织成可组合的工作流。Agent 先确认意图并形成规格，再按可验证的步骤推进实现。

它的开发主流程从需求澄清开始，经过计划、隔离实现和评审，最后完成验证与分支收尾：

```d2
direction: right

A: 初始想法
B: 需求澄清
C: 实现计划
D: 隔离工作区
E: 测试驱动实现
F: 代码评审
G: 完成前验证
H: 分支收尾

A -> B -> C -> D -> E -> F -> G -> H
```

### 安装使用

Superpowers 支持多种编码工具。在 Codex App 或 Codex CLI 中，可以从官方插件市场搜索 Superpowers；在 Claude Code 中，可以执行：

```text
/plugin install superpowers@claude-plugins-official
```

安装后，Agent 会根据任务场景触发相应的 skill，不需要手动记住完整清单。

例如想从需求开始：

> 我想给列表页增加批量导出功能，先和我一起梳理方案。

这时适合触发 `brainstorming`，把需求澄清成规格。

方案已经明确后，可以继续说：

> 请基于刚才的方案写一个实现计划。

这时适合触发 `writing-plans`，把方案拆成具体文件、测试和执行步骤。

真正开始开发时，再让 Agent 按计划执行，并要求它在每一步执行对应验证命令。

### 完整 skill 列表

按当前版本，Superpowers 包含以下 14 个 skill。版本升级时，具体列表和职责可能调整。

| 分类 | Skill                            | 作用                                         |
| ---- | -------------------------------- | -------------------------------------------- |
| 入口 | `using-superpowers`              | 识别当前任务需要调用的 skill                 |
| 设计 | `brainstorming`                  | 通过问答澄清需求并形成设计                   |
| 设计 | `writing-plans`                  | 把设计拆成可执行、可验证的实现计划           |
| 执行 | `using-git-worktrees`            | 创建独立 worktree，隔离分支和工作区          |
| 执行 | `subagent-driven-development`    | 为每个任务派发新的子 Agent，并执行任务评审   |
| 执行 | `executing-plans`                | 在不使用子 Agent 时按计划推进任务            |
| 执行 | `dispatching-parallel-agents`    | 并发处理相互独立的任务                       |
| 质量 | `test-driven-development`        | 按 RED-GREEN-REFACTOR 循环实现功能            |
| 质量 | `systematic-debugging`           | 先定位根因，再验证修复                        |
| 质量 | `verification-before-completion` | 在声明完成前运行验证并检查结果               |
| 质量 | `requesting-code-review`         | 在任务完成、重大功能完成或合并前请求代码评审 |
| 质量 | `receiving-code-review`          | 核实评审意见并据此修改                       |
| 收尾 | `finishing-a-development-branch` | 验证并决定分支如何收尾                       |
| 扩展 | `writing-skills`                 | 创建、修改和测试 skill                       |

### 常用工作流

上图展示了完整开发链路，下面只说明各阶段如何衔接。

#### Brainstorming

当需求还停在“想做某个能力，但交互、接口和边界都没想清楚”时，先用 Brainstorming。它会通过提问澄清目标、约束和备选方案，分段呈现设计供确认；确认后的结论再沉淀成文档，为 `writing-plans` 提供稳定输入。

典型触发方式是：

> 我想做一个导出能力，但还没确定交互和接口设计，先帮我梳理。

#### Writing Plans

设计确认后，`writing-plans` 会先明确文件职责，再把工作拆成可独立测试和评审的任务。任务中的每个步骤通常控制在 2—5 分钟，并给出具体文件路径、实现内容和验证方式。

一个好的计划应该包含：要修改哪些文件、每一步做什么、每一步怎么验证、需要新增哪些测试、什么时候提交或进入下一步。计划越具体，Agent 执行时越不容易跑偏。

#### Using Git Worktrees

开始执行前，`using-git-worktrees` 会在新分支上创建独立 worktree，按项目情况完成环境准备，并检查基线测试。后续工作都在这个隔离空间里进行，避免污染当前工作区。

#### Subagent-Driven Development

计划就绪后，`subagent-driven-development` 会为每个任务派发新的子 Agent。任务完成后统一检查规格符合性和代码质量，全部任务结束后再做整分支评审。

#### Test-Driven Development

实现阶段强制 RED-GREEN-REFACTOR：

1. 先写失败测试；
2. 确认测试因为预期原因失败；
3. 写最少实现让测试通过；
4. 重构，并保持测试通过。

这对 Agent 尤其重要。Agent 很擅长生成实现，但如果没有先定义验证方式，也很容易生成“看起来合理但实际没有得到证明”的代码。TDD 用失败测试约束实现方向，可以降低 Agent 直接生成未经验证实现的风险；测试通过后，仍要检查是否覆盖了关键边界。

#### Requesting Code Review

每个任务完成后、下一个任务开始前，评审 Agent 会对照计划检查实现并按严重程度报告问题。Critical 和 Important 问题需要在继续执行前处理；如果评审结论有误，也应基于代码和测试说明理由。

#### Finishing a Development Branch

所有任务完成后收尾。它会先验证测试是否全绿，然后给出四个选项：合并 / 提 PR / 保留分支 / 丢弃 worktree，并执行对应清理。

## OpenSpec 和 Superpowers 对比

两者都能服务 SDD，但关注点不一样。

| 维度     | OpenSpec                     | Superpowers                  |
| -------- | ---------------------------- | ---------------------------- |
| 核心定位 | 管理规格和变更               | 管理 Agent 工作流            |
| 主要产物 | 规格、设计、任务等文档       | skill 驱动的流程和计划       |
| 适合场景 | 长期维护、跨人协作、变更追踪 | Agent 编码、调试、计划、验证 |
| 优势     | 规格结构清晰，便于归档和审查 | 强约束执行过程，减少随意发挥 |
| 风险     | 只写规格但执行不受控         | 流程强度高，小任务显得重     |
| 关注问题 | “我们到底要做什么”           | “Agent 怎么把事做对”         |

两者可以组合使用：OpenSpec 管理需求和变更上下文，Superpowers 约束 Agent 的执行过程。

仍以 3D 知识星球为例，可以这样组织：

1. 用 OpenSpec 明确首页改版的目标、非目标和验收标准，并生成 `proposal.md`、增量规格 `specs/<capability>/spec.md`、`design.md` 与 `tasks.md`。
2. 让 `writing-plans` 根据这些产物确定文件职责，把 3D 场景、交互和降级方案拆成可独立验证的任务。
3. 在独立 worktree 中按 TDD 实现，每个任务完成后检查规格符合性和代码质量。
4. 完成后回到 OpenSpec 的验收标准逐项检查。

## 如何协作

SDD 能否起效，还取决于人和 Agent 如何分工。人需要提前说明关键判断，Agent 则根据这些判断推进执行。

- **你负责判断方向**：需求是否值得做、必须覆盖哪些场景、哪些边界可以暂缓、技术取舍是否符合团队方向，以及验收标准能否代表真实目标，这些判断应由人负责。Agent 可以提供建议，但产品边界和工程取舍仍需要人确认；
- **Agent 负责推进执行**：Agent 适合根据规格搜索代码、生成测试用例、拆解步骤、修改局部实现、运行测试，并根据验证结果继续迭代。给 Agent 的上下文至少要包含三项：这次要完成什么、哪些事情不在范围内，以及如何证明任务完成。目标、边界和验证方式越清楚，输出通常越稳定；
- **小任务不要过度流程化**：改一个错别字、调整一处样式间距或补一行注释，都不需要完整规格。可以用一个问题判断是否值得采用 SDD：任务是否涉及多个文件、多个角色或多个隐藏决策？如果涉及，就应该先写规格；如果只是一处明确的小改动，直接修改并验证即可。

## 总结

SDD 的核心是把想法整理成可执行、可验证、可复查的规格。OpenSpec 用于沉淀需求和变更上下文，Superpowers 用于约束 Agent 的执行过程。

Agent 能否稳定推进开发，取决于目标、边界、验证方式和反馈回路是否清楚。人负责判断方向，Agent 负责执行，每一步都要留下可以检查的依据。
