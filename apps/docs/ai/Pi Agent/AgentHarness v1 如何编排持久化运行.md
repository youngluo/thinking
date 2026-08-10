---
createdAt: '2026-08-09 22:15'
order: 10
draft: true
---

# AgentHarness v1 如何编排持久化运行

本文结合 `packages/agent/docs/agent-harness.md` 和 `packages/agent/docs/harness.md`，说明 AgentHarness 为什么要位于低层 Agent Loop 之上，以及它如何管理 Session、运行配置、资源解析、操作锁和恢复流程。本文讨论的是 v1 设计，不能把设计文档中的待办项当作当前已完成的能力。

## 为什么需要 AgentHarness

## AgentHarness 如何管理一次运行

## Ref 如何指向 Session 分支

## Session entry 与 Harness entry

## 锁、队列与异常恢复

## v1 设计与当前实现的边界

## 源码阅读路线

## 小结
