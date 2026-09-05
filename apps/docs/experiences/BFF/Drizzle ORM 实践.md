---
createdAt: '2026-08-26 21:39'
draft: true
---

# Drizzle ORM 实践

PostgreSQL 负责保存数据、执行 SQL 并保证约束，ORM 则为应用代码提供另一种访问数据库的方式。Drizzle 把表结构描述为 TypeScript 对象，用接近 SQL 的 query builder 生成查询，并从 Schema 推导结果和写入类型。

Drizzle 不会替代 PostgreSQL 的数据建模、索引设计和执行计划分析。本文沿用 `users` / `posts` 示例，重点介绍如何把已经理解的 PostgreSQL 结构映射到 TypeScript 项目中。

## Drizzle ORM 的定位

Drizzle 主要解决三类问题：

- 用 TypeScript 描述表、字段、约束和索引；
- 用类型安全的 query builder 组织常见 SQL；
- 使用 `drizzle-kit` 生成和执行数据库结构迁移。

运行时的 `drizzle-orm` 负责连接数据库和构造查询，`drizzle-kit` 是开发与发布阶段使用的命令行工具，负责 Schema 对比、迁移生成、迁移执行和数据库浏览。

Drizzle 生成的查询仍然会交给 PostgreSQL 执行。查询是否命中索引、返回字段是否合理、事务边界是否正确，仍然需要按照 PostgreSQL 的规则判断：

```ts
import { eq } from 'drizzle-orm'
import { db } from './db/client'
import { users } from './db/schema'

const userId = 1
const [user] = await db
  .select({ id: users.id, email: users.email })
  .from(users)
  .where(eq(users.id, userId))
```

## 初始化项目

### 安装依赖

```bash fold
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit
```

`drizzle-orm` 和 `postgres` 是应用运行时依赖，`drizzle-kit` 通常只在开发、迁移和 CI/CD 环境中使用。

### 创建数据库客户端

本文使用 Postgres.js 作为 PostgreSQL 驱动。连接池的容量需要结合数据库允许的总连接数和应用实例数配置，不能把单个进程的默认值当成生产配置：

```ts fold title="src/db/client.ts"
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}

const client = postgres(databaseUrl, {
  max: 10,
})

export const db = drizzle(client)
export { client }
```

应用优雅退出时可以调用 `client.end()` 释放连接。连接串、TLS 和连接池的计算方式属于 PostgreSQL 接入基础，应该先明确数据库侧的约束，再决定应用侧配置。

### 配置 Drizzle Kit

```ts fold title="drizzle.config.ts"
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
```

配置文件告诉 Drizzle Kit 使用哪种数据库方言、从哪里读取 Schema，以及迁移文件输出到哪里。真实项目还应根据目录结构配置环境变量加载方式。

## 用 Schema 映射 PostgreSQL

Drizzle 的 Schema 不是另一套数据库。`pgTable` 中的字段和约束最终会对应 PostgreSQL 的表定义：

```ts fold title="src/db/schema.ts"
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

export const users = pgTable(
  'users',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    email: text('email').notNull(),
    name: text('name'),
    age: integer('age'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('users_email_idx').on(table.email)]
)

export const posts = pgTable(
  'posts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    title: text('title').notNull(),
    authorId: integer('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    index('posts_author_created_idx').on(
      table.authorId,
      table.createdAt,
      table.id
    ),
  ]
)
```

这里的对应关系是：

- `integer(...).primaryKey().generatedAlwaysAsIdentity()` 对应 PostgreSQL 身份列和主键；
- `.notNull()`、`.references()` 对应非空约束和外键；
- `uniqueIndex` 保证邮箱不重复；
- `index` 为文章列表的筛选和排序提供索引入口；
- `withTimezone: true` 对应带时区的时间类型。

Schema 只描述数据库结构，不会自动保证查询性能。组合索引的列顺序仍然要结合实际 SQL 判断，必要时应回到 PostgreSQL 使用 `EXPLAIN` 分析。

### 推导读写类型

Schema 可以直接推导查询结果和写入数据的类型：

```ts fold title="src/db/types.ts"
import { posts, users } from './schema'

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Post = typeof posts.$inferSelect
export type NewPost = typeof posts.$inferInsert
```

`User` 表示查询得到的完整记录，`NewUser` 表示插入时允许省略由数据库生成的字段。类型推导减少了重复声明，但不会替代运行时输入校验。

## 使用 Drizzle Kit 管理结构变更

Drizzle Kit 的常用命令职责不同：

| 命令 | 作用 | 是否直接修改数据库 | 适用场景 |
| ---- | ---- | ------------------ | -------- |
| `generate` | 根据 Schema 生成 SQL 迁移文件 | 否 | 开发和代码评审 |
| `migrate` | 执行尚未应用的迁移文件 | 是 | 发布流程 |
| `push` | 对比 Schema 并直接同步数据库 | 是 | 本地快速迭代 |
| `studio` | 浏览和操作数据库中的数据 | 可能 | 本地开发和排查 |

`generate` 只生成迁移，不会修改数据库。生产发布采用 `generate` 产物并执行 `migrate`，这样结构变更可以进入代码评审和发布记录。`push` 省略了迁移文件，适合快速验证 Schema；是否用于生产属于团队流程选择，本文将它限定为本地迭代。Studio 可以修改数据，不应该被当作结构迁移工具。

推荐的迁移链路如下：

```d2
direction: right

schema: 修改 schema.ts
generate: 生成 SQL 迁移
review: 评审迁移内容
migrate: 发布时执行迁移

schema -> generate -> review -> migrate
```

已经执行的迁移文件不要直接修改。发现问题时新增一份迁移，让数据库从旧状态逐步变成新状态。

## 用 Drizzle 完成数据操作

### 新增数据

```ts fold title="src/users.ts"
import { db } from './db/client'
import { users } from './db/schema'
import type { NewUser } from './db/types'

const input: NewUser = {
  email: 'alice@example.com',
  name: 'Alice',
}

const [created] = await db.insert(users).values(input).returning()
```

传入数组时，Drizzle 会生成一条包含多组值的 `INSERT`：

```ts fold
await db.insert(users).values([
  { email: 'bob@example.com', name: 'Bob' },
  { email: 'carol@example.com', name: 'Carol' },
])
```

PostgreSQL 支持 `RETURNING`。在 Drizzle 中，不传参数的 `.returning()` 会返回受影响行的全部字段。如果只需要部分字段，可以传入对象，例如 `.returning({ id: users.id, email: users.email })`。插入、更新或删除后需要拿回受影响的记录时，可以使用这种写法，避免额外查询。

### 查询数据

不传字段时，`select()` 会选择表中的全部字段。BFF 返回响应时更适合显式声明字段：

```ts fold title="src/users.ts"
import { eq } from 'drizzle-orm'
import { db } from './db/client'
import { users } from './db/schema'

const list = await db
  .select({
    id: users.id,
    email: users.email,
    name: users.name,
  })
  .from(users)

const [user] = await db
  .select({
    id: users.id,
    email: users.email,
    name: users.name,
  })
  .from(users)
  .where(eq(users.id, 1))
```

显式字段可以控制响应大小，避免把内部字段直接暴露给前端。类型安全只保证代码引用了存在的字段，不能替代接口层的字段白名单。

### 更新与删除

```ts fold title="src/users.ts"
import { eq } from 'drizzle-orm'
import { db } from './db/client'
import { users } from './db/schema'

await db
  .update(users)
  .set({ name: 'Alice 2' })
  .where(eq(users.id, 1))

await db
  .delete(users)
  .where(eq(users.id, 1))
```

`where` 在 Drizzle 中不是强制参数。省略它会让更新或删除作用于整张表，因此服务层应明确构造条件，并在 code review 中重点检查这类调用。

## 条件查询与性能边界

### Join、排序与分页

Drizzle 的查询表达式对应常见 SQL 结构：

```ts fold title="src/posts.ts"
import { and, desc, eq, gt } from 'drizzle-orm'
import { db } from './db/client'
import { posts, users } from './db/schema'

const rows = await db
  .select({
    postId: posts.id,
    title: posts.title,
    authorName: users.name,
  })
  .from(posts)
  .innerJoin(users, eq(users.id, posts.authorId))
  .where(and(eq(posts.authorId, 1), gt(posts.id, 0)))
  .orderBy(desc(posts.createdAt), desc(posts.id))
  .limit(20)
```

`innerJoin` 只保留能够匹配的记录，`leftJoin` 会保留左表记录。分页仍然要根据数据规模选择 `limit` + `offset` 或游标方案，ORM 不会自动解决深分页问题。

### 观察生成的 SQL

Drizzle 生成的是 PostgreSQL 要执行的 SQL。遇到慢查询时，应查看生成结果，并把对应查询放回 PostgreSQL 使用 `EXPLAIN (ANALYZE, BUFFERS)` 分析。

重点仍然是：

- 查询是否选择了真正需要的字段；
- `WHERE`、`JOIN` 和 `ORDER BY` 是否有匹配索引；
- 组合索引顺序是否符合常用查询；
- 是否在循环中重复发起关联查询；
- 结果数量和分页边界是否受到控制。

不要因为查询写成了 TypeScript，就忽略 SQL 的执行成本。

## 事务

Drizzle 使用回调把多条语句放进同一个事务。回调抛出错误时，事务会回滚：

```ts fold title="src/publish.ts"
import { db } from './db/client'
import { posts, users } from './db/schema'

await db.transaction(async (tx) => {
  const [user] = await tx
    .insert(users)
    .values({
      email: 'eve@example.com',
      name: 'Eve',
    })
    .returning({ id: users.id })

  await tx
    .insert(posts)
    .values({
      title: 'Hello PostgreSQL',
      authorId: user.id,
    })
})
```

事务保证这两次写入作为一个逻辑单元提交或撤销。它不等于更高的隔离级别，具体可见性仍由 PostgreSQL 的事务配置决定。只有当多步操作需要原子完成时才使用事务，不要把所有 HTTP 请求都包在事务中。

## BFF 中的使用边界

Drizzle 能够约束 TypeScript 代码中的字段和参数类型，但以下职责仍需要应用层和数据库共同完成：

- 使用运行时校验检查外部输入；
- 在 BFF 层判断用户身份、权限和业务状态；
- 用数据库约束兜住非空、唯一和引用完整性；
- 对外查询显式声明字段并限制分页；
- 使用参数化表达式，不拼接不可信的 SQL；
- 根据真实 SQL 和执行计划调整索引；
- 为结构变更保留可评审、可回滚的迁移记录。

## 总结

Drizzle 的价值是把 PostgreSQL 的表结构和查询操作带进 TypeScript 的类型系统，同时保留接近 SQL 的表达方式。它可以减少重复类型和手写查询代码，但不会替你完成数据建模、索引设计、SQL 性能分析和事务边界设计。

实际项目可以沿着这条链路组织：先根据业务设计 PostgreSQL 表结构，再用 Drizzle Schema 映射约束和索引，使用 `generate` 生成迁移，发布时执行 `migrate`，最后根据真实查询和执行计划持续调整。
