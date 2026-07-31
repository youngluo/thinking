---
createdAt: '2026-06-30 20:00'
order: 8
---

# SDD 指南

与 Agent 协作时，需求通常从几句对话开始，再随着方案讨论和实现不断补充。目标、边界、约束和验收标准散落在多轮对话中，Agent 和开发者很难始终基于同一套信息推进工作。因此，需要把这些内容整理成可持续更新的规格，为后续设计、实现和验收提供稳定依据。

## 什么是 SDD

这种以规格为共同依据、先明确要求再推进开发的方式，就是 SDD（Spec-Driven Development，规格驱动开发）。SDD 通常覆盖以下信息：

| 信息                            | 作用                                     |
| ------------------------------- | ---------------------------------------- |
| 产品规格（Product Spec）        | 说明用户问题、目标、范围和非目标         |
| 验收标准（Acceptance Criteria） | 定义实现必须满足的完成条件               |
| 技术设计（Technical Design）    | 说明技术方案、接口、数据结构和关键取舍   |
| 实现计划（Implementation Plan） | 把方案拆成可执行步骤，每一步都有验证方式 |

这些信息不必一一对应独立文档，具体组织方式取决于工具。无论采用哪种目录结构，SDD 都从澄清规格开始，再进入技术设计、任务拆解、实现和交付：

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

OpenSpec 是一个开源的 SDD 工具，以变更为单位组织需求、规格、设计和任务，并在完成后归档相关产物，使变更过程和历史都可追踪。

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

| 产物          | 作用                                     |
| ------------- | ---------------------------------------- |
| `proposal.md` | 说明为什么做、做什么、不做什么           |
| `specs/`      | 描述本次变更对系统能力的增量要求         |
| `design.md`   | 说明技术方案、接口、迁移、风险和关键取舍 |
| `tasks.md`    | 把实现拆成可勾选、可验证的任务           |

### 常用命令

默认的 `core` profile 包含以下命令：

| 命令            | 用途                                                        |
| --------------- | ----------------------------------------------------------- |
| `/opsx:propose` | 创建变更并生成全部规划产物，相当于 `/opsx:new` + `/opsx:ff` |
| `/opsx:explore` | 梳理问题、需求或方案                                        |
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

需要扩展命令时，执行 `openspec config profile` 选择工作流，再在项目中执行 `openspec update`。

### 变更流程

下面以“增加密码重置功能”为例，走一遍变更的创建、实现、验证和归档。在 Codex 中，输入 `$` 选择对应的 OpenSpec skill，例如 `$openspec-propose`；在 Claude Code 中，使用 `/opsx:*` 命令。下文以 Claude Code 的写法为例。

**提出变更**

```bash
/opsx:propose 为用户登录增加密码重置功能
```

OpenSpec 会根据描述生成变更名，并在信息不足时继续确认需求。生成的变更目录可能如下：

```text fold title="openspec/changes/add-password-reset/"
openspec/changes/add-password-reset/
  proposal.md
  specs/password-reset/spec.md
  design.md
  tasks.md
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

沿用前面的密码重置变更。实现中发现重置链接的有效期尚未明确，需要先澄清取舍、更新产物，再继续实现。

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

Superpowers 是一套面向编码 Agent 的开发方法，由一组可组合的 skill 构成，用于约束 Agent 从需求澄清到分支收尾的整个开发流程。

### 安装

在 Codex 中，可以从官方插件市场搜索 Superpowers；在 Claude Code 中，可以执行：

```bash
/plugin install superpowers@claude-plugins-official
```

安装后，Agent 会根据任务场景自动触发相应的 skill，通常只需说明目标和当前阶段。

### 完整 skill 列表

Superpowers 包含以下 14 个 skill：

| 分类 | Skill                            | 作用                                         |
| ---- | -------------------------------- | -------------------------------------------- |
| 入口 | `using-superpowers`              | 在任务开始前识别并调用相关 skill             |
| 设计 | `brainstorming`                  | 通过问答澄清需求并形成设计                   |
| 设计 | `writing-plans`                  | 把设计拆成可执行、可验证的实现计划           |
| 执行 | `using-git-worktrees`            | 创建独立 worktree，隔离分支和工作区          |
| 执行 | `subagent-driven-development`    | 为每个任务派发新的子 Agent，并执行任务评审   |
| 执行 | `executing-plans`                | 在不支持子 Agent 的环境中按计划推进任务      |
| 执行 | `dispatching-parallel-agents`    | 并发处理相互独立的任务                       |
| 质量 | `test-driven-development`        | 按 RED-GREEN-REFACTOR 循环实现功能           |
| 质量 | `systematic-debugging`           | 先定位根因，再验证修复                       |
| 质量 | `verification-before-completion` | 在声明完成前运行验证并检查结果               |
| 质量 | `requesting-code-review`         | 在任务完成、重大功能完成或合并前请求代码评审 |
| 质量 | `receiving-code-review`          | 核实评审意见并据此修改                       |
| 收尾 | `finishing-a-development-branch` | 验证并决定分支如何收尾                       |
| 扩展 | `writing-skills`                 | 创建、修改和测试 skill                       |

### 核心开发流程

新功能开发通常沿以下主路径推进：

```d2
direction: right

A: 初始想法
B: 需求澄清\nbrainstorming
C: 隔离工作区\nusing-git-worktrees
D: 实现计划\nwriting-plans
E: 支持子 Agent？ {
  shape: diamond
  class: decision
}
F1: 任务派发\nsubagent-driven-development
F2: 计划执行\nexecuting-plans
G: 测试驱动实现\ntest-driven-development
H: 代码评审\nrequesting-code-review
I: 完成前验证\nverification-before-completion
J: 分支收尾\nfinishing-a-development-branch

A -> B -> C -> D -> E
E -> F1: 是
E -> F2: 否
F1 -> G
F2 -> G
G -> H -> I -> J
```

## OpenSpec vs Superpowers

OpenSpec 和 Superpowers 解决的是 SDD 中的不同问题：

| 维度     | OpenSpec                             | Superpowers                      |
| -------- | ------------------------------------ | -------------------------------- |
| 核心定位 | 管理规格与变更                       | 约束 Agent 开发流程              |
| 管理对象 | 需求、规格、设计和任务等变更产物     | Agent 的任务执行与质量检查       |
| 作用范围 | 从提出变更到验证、归档和规格持续维护 | 从需求澄清到实现、评审和分支收尾 |
| 核心问题 | 做什么、范围在哪里、如何验收         | 如何规划、实现并验证             |

两者可以组合使用：OpenSpec 提供可追踪的变更上下文和验收依据，Superpowers 据此推进实现、评审和验证。

## 协作原则

- **人负责判断方向**：确认需求价值、产品边界、工程取舍和验收标准。Agent 可以提供建议，但关键决策仍由人确认；
- **Agent 负责推进执行**：根据目标、范围和验收标准搜索代码、拆解任务、修改实现并运行验证；
- **按复杂度选择流程**：涉及多处联动或关键取舍时先写规格；明确的局部修改直接实现并验证即可。
