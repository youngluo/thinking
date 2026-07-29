---
createdAt: '2026-06-10 20:00'
order: 8
---

# SDD 指南

Agent 读代码、改实现、跑测试都很快，但对需求的理解很容易在多轮执行中逐渐偏离原意。只靠对话传递需求，目标、边界和验收标准可能被遗漏，最终也难以判断实现是否符合预期。为此，需要把这些关键信息整理成可以持续引用和更新的规格。

## 什么是 SDD

SDD（Spec-Driven Development，规格驱动开发）是一种把规格放在实现之前的开发方法。它先把散落在聊天、会议和个人经验里的信息整理成开发者和 Agent 共同读取的规格，明确要解决的问题、目标、范围和验收标准，再据此实现与验证。

SDD 没有统一的文档模板，常见流程会覆盖以下信息：

| 信息                             | 作用                                     |
| -------------------------------- | ---------------------------------------- |
| 产品规格（Product Spec）         | 说明用户问题、目标、范围和非目标         |
| 技术设计（Technical Design）     | 说明技术方案、接口、数据结构和关键取舍   |
| 实现计划（Implementation Plan）  | 把方案拆成可执行步骤，每一步都有验证方式 |
| 验收标准（Acceptance Criteria）  | 定义什么叫完成，避免只看代码是否生成     |

这些信息不一定拆成四份文档，具体工具也会采用不同的目录结构，但都用于减少协作中的猜测，为实现和验收提供清晰依据。从模糊需求到最终交付，SDD 通常按以下阶段推进：

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

## OpenSpec

OpenSpec 是一个开源的 SDD 工具，以变更为单位组织需求、规格、设计和任务。编码前先对齐规格与验收标准，实施中同步更新产物，完成后归档整个变更，使上下文始终可追踪。

### 安装与初始化

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
  config.yaml                 # 项目级配置
```

`specs/` 是已经生效的能力规格，是系统当前行为的事实来源，按领域组织，例如 `specs/auth/`、`specs/payments/`。`changes/` 是正在设计或实现的变更，每个变更一个目录，相关的设计文档和规格增量都放在里面。增量规格可以在归档前手动同步，也可以在归档过程中按提示合入主规格。

### 核心产物

每个变更目录包含四类核心产物：

| 产物          | 作用                                         |
| ------------- | -------------------------------------------- |
| `proposal.md` | 说明为什么做、做什么、不做什么               |
| `design.md`   | 说明技术方案、接口、迁移、风险和关键取舍     |
| `specs/`      | 描述本次变更对系统能力的增量要求             |
| `tasks.md`    | 把实现拆成可勾选任务，每个任务最好带验证方式 |

### 常用命令

默认的 `core` profile 包含以下命令：

| 命令            | 用途                                                        |
| --------------- | ----------------------------------------------------------- |
| `/opsx:propose` | 创建变更并生成全部规划产物，相当于 `/opsx:new` + `/opsx:ff` |
| `/opsx:explore` | 在正式创建变更前，先梳理想法                                |
| `/opsx:apply`   | 按变更产物实现任务                                          |
| `/opsx:update`  | 更新已有变更的规划产物                                      |
| `/opsx:sync`    | 把增量规格合并到主规格                                      |
| `/opsx:archive` | 归档已完成变更                                              |

切换到自定义 profile 后，还可以启用以下扩展命令：

| 命令                 | 用途                     |
| -------------------- | ------------------------ |
| `/opsx:new`          | 创建一个新的变更骨架     |
| `/opsx:continue`     | 按依赖关系生成下一个产物 |
| `/opsx:ff`           | 快速生成全部规划产物     |
| `/opsx:verify`       | 校验实现是否匹配变更产物 |
| `/opsx:bulk-archive` | 一次归档多个已完成变更   |
| `/opsx:onboard`      | 引导式走完整个工作流     |

命令和 `profile` 可能随版本调整。需要扩展命令时，执行 `openspec config profile` 选择工作流，再在项目中执行 `openspec update`。

### 变更流程

下面以“增加密码重置功能”为例，走一遍变更的创建、实现、验证和归档。Codex 中输入 `$` 选择对应的 OpenSpec skill，例如 `$openspec-propose`；支持 slash command 的工具使用 `/opsx:*`。下文以 `/opsx:*` 为例。

**提出变更**

```bash
/opsx:propose 为用户登录增加密码重置功能
```

OpenSpec 会根据描述生成变更名，并在信息不足时继续确认需求。生成的变更目录可能如下：

```text fold title="openspec/changes/add-password-reset/"
openspec/changes/add-password-reset/
  proposal.md
  design.md
  tasks.md
  specs/password-reset/spec.md
```

**实施变更**

```bash
/opsx:apply add-password-reset
```

`apply` 会读取变更产物，按 `tasks.md` 逐项实现，并同步更新任务状态。

**验证变更**

如果已启用扩展工作流，可以在归档前执行 `verify`：

```bash
/opsx:verify add-password-reset
```

`verify` 会从完整性、正确性和一致性三个维度检查实现，并将问题分为 CRITICAL、WARNING、SUGGESTION。它不会阻止归档，但应先处理 CRITICAL，并评估 WARNING。

**归档变更**

```bash
/opsx:archive add-password-reset
```

归档会检查产物和任务的完成状态，在规格增量尚未同步时询问是否合入主规格，然后把变更移到 `openspec/changes/archive/YYYY-MM-DD-<change-id>/`。

### 调整变更

沿用前面的密码重置变更。实现中发现重置链接的有效期尚未明确，需要先调整变更产物，再继续实现。

**梳理方案**

先梳理安全性与使用体验之间的取舍：

```bash
/opsx:explore add-password-reset 中的重置链接有效期应该设置为多久
```

**更新产物**

确定有效期为 15 分钟后，更新受影响的产物：

```bash
/opsx:update add-password-reset 将重置链接的有效期设为 15 分钟，并更新受影响的产物
```

`update` 会修改 `specs/password-reset/spec.md`，并根据影响范围同步更新 `design.md` 和 `tasks.md`。

**继续实施**

确认产物一致后，继续执行：

```bash
/opsx:apply add-password-reset
```

## Superpowers

OpenSpec 管理规格和变更，Superpowers 则通过一组可组合的 skill 约束 Agent 如何澄清需求、制定计划、实现、调试、评审和验证。

它的开发主流程从需求澄清开始，依次完成工作区隔离、实现计划、测试驱动实现、评审和验证，最后收尾分支：

```d2
direction: right

A: 初始想法
B: 需求澄清
C: 隔离工作区
D: 实现计划
E: 测试驱动实现
F: 代码评审
G: 完成前验证
H: 分支收尾

A -> B -> C -> D -> E -> F -> G -> H
```

### 安装

Superpowers 支持多种编码工具。在 Codex App 或 Codex CLI 中，可以从官方插件市场搜索 Superpowers；在 Claude Code 中，可以执行：

```bash
/plugin install superpowers@claude-plugins-official
```

安装后，Agent 会根据任务场景触发相应的 skill。实际使用时只需说明目标和当前阶段，不必手动指定完整流程。

### 完整 skill 列表

按当前版本，Superpowers 包含以下 14 个 skill。版本升级时，具体列表和职责可能调整。

| 分类 | Skill                            | 作用                                         |
| ---- | -------------------------------- | -------------------------------------------- |
| 入口 | `using-superpowers`              | 在任务开始前识别并调用相关 skill             |
| 设计 | `brainstorming`                  | 通过问答澄清需求并形成设计                   |
| 设计 | `writing-plans`                  | 把设计拆成可执行、可验证的实现计划           |
| 执行 | `using-git-worktrees`            | 创建独立 worktree，隔离分支和工作区          |
| 执行 | `subagent-driven-development`    | 为每个任务派发新的子 Agent，并执行任务评审   |
| 执行 | `executing-plans`                | 在不支持子 Agent 的环境中按计划推进任务       |
| 执行 | `dispatching-parallel-agents`    | 并发处理相互独立的任务                       |
| 质量 | `test-driven-development`        | 按 RED-GREEN-REFACTOR 循环实现功能            |
| 质量 | `systematic-debugging`           | 先定位根因，再验证修复                        |
| 质量 | `verification-before-completion` | 在声明完成前运行验证并检查结果               |
| 质量 | `requesting-code-review`         | 在任务完成、重大功能完成或合并前请求代码评审 |
| 质量 | `receiving-code-review`          | 核实评审意见并据此修改                       |
| 收尾 | `finishing-a-development-branch` | 验证并决定分支如何收尾                       |
| 扩展 | `writing-skills`                 | 创建、修改和测试 skill                       |

### 核心开发流程

核心流程由以下 skill 串联：

1. **`brainstorming`**：通过问答澄清目标、约束和备选方案，形成经过确认的设计；
2. **`using-git-worktrees`**：创建独立 worktree，完成环境准备并检查基线测试；
3. **`writing-plans`**：明确文件职责，把设计拆成可独立测试和评审的任务。每个步骤通常控制在 2～5 分钟，并写明实现与验证方式；
4. **`subagent-driven-development`**：在支持子 Agent 的环境中逐项派发任务，并在每项完成后检查规格符合性和代码质量；
5. **`test-driven-development`**：约束每个任务的实现过程，先确认测试按预期失败，再编写最少实现并重构；
6. **`requesting-code-review`**：在任务完成、重大功能完成或合并前发起评审，Critical 和 Important 问题应在继续前处理；
7. **`verification-before-completion`**：在声明完成前重新运行验证，并根据输出确认结果；
8. **`finishing-a-development-branch`**：测试通过后，由人决定合并、提交 PR 或保留分支；只有明确要求丢弃时才执行销毁和清理。

## OpenSpec vs Superpowers

两者都能服务 SDD，但职责不同。

| 维度     | OpenSpec                     | Superpowers                  |
| -------- | ---------------------------- | ---------------------------- |
| 核心定位 | 管理规格和变更               | 管理 Agent 工作流            |
| 主要产物 | 规格、设计、任务等文档       | skill 驱动的流程和计划       |
| 适合场景 | 长期维护、跨人协作、变更追踪 | Agent 编码、调试、计划、验证 |
| 关注问题 | “我们到底要做什么”           | “Agent 怎么把事做对”         |

两者可以组合使用：OpenSpec 提供变更上下文和验收依据，Superpowers 据此推进实现与验证。

## 协作原则

- **人负责判断方向**：确认需求价值、产品边界、工程取舍和验收标准。Agent 可以提供建议，但关键决策仍由人确认；
- **Agent 负责推进执行**：根据目标、范围和验收标准搜索代码、拆解任务、修改实现并运行验证；
- **按复杂度选择流程**：涉及多处联动或关键取舍时先写规格；明确的局部修改直接实现并验证即可。
