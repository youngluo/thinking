---
createdAt: '2026-07-23 21:54'
draft: true
---

# Drizzle ORM + PostgreSQL 实践

本文从 Drizzle ORM 的基本概念出发，介绍如何在 Node.js 项目中连接 PostgreSQL、定义 Schema、管理迁移并完成常用数据操作，最后通过一个最小 Hono 示例串起 BFF 接口与数据库访问。

## 认识 Drizzle ORM

- Drizzle ORM 的定位与特点；
- SQL-like API 与类型推导；
- Drizzle ORM、PostgreSQL 驱动和 Drizzle Kit 的职责边界。

## 初始化项目

- 安装 `drizzle-orm`、`pg` 和 `drizzle-kit`；
- 配置数据库连接与环境变量；
- 创建 Drizzle 实例；
- 配置 `drizzle.config.ts`。

## 定义数据表

- 使用 `pgTable` 定义表；
- 配置常见字段类型、主键、默认值和非空约束；
- 添加唯一约束与外键；
- 使用 `$inferSelect` 和 `$inferInsert` 推导查询与写入类型。

## 同步数据库结构

- 使用 `generate` 生成迁移文件；
- 使用 `migrate` 执行迁移；
- 区分 `push` 与迁移流程的适用场景；
- 使用 `studio` 查看和编辑本地数据。

## 基础 CRUD API

### 新增数据

- `insert` 的基本用法；
- 批量写入；
- 使用 `returning` 获取写入结果。

### 查询数据

- `select` 的基本用法；
- 查询全部字段与指定字段；
- 根据条件查询单条或多条数据。

### 更新数据

- 使用 `update` 与 `set` 更新字段；
- 通过 `where` 限定更新范围；
- 返回更新后的数据。

### 删除数据

- 使用 `delete` 删除数据；
- 通过 `where` 限定删除范围；
- 返回被删除的数据。

## 常用查询 API

- 使用 `eq`、`ne`、`gt`、`gte`、`lt`、`lte` 构造比较条件；
- 使用 `and`、`or` 组合查询条件；
- 使用 `orderBy`、`limit` 和 `offset` 完成排序与分页；
- 使用聚合函数统计数据；
- 使用 Join 查询关联数据；
- 使用 `transaction` 完成基础事务操作。

## 最小 Hono 整合

- 在 Hono 路由中调用 Drizzle；
- 实现一个查询接口；
- 实现一个新增接口；
- 将请求参数、数据库操作和 JSON 响应串成完整链路。

## 常见入门问题

- Drizzle 的类型推导不能替代请求参数校验；
- `push` 不等同于可审查、可追踪的迁移流程；
- 数据库连接和连接池不应按请求重复创建；
- 时间、`bigint` 等类型在 PostgreSQL、Node.js 和 JSON 之间需要明确转换规则。

## 总结

回顾从定义 Schema、生成迁移、执行查询到接入 Hono 接口的完整流程，并整理 Drizzle ORM 入门阶段需要掌握的核心 API。
