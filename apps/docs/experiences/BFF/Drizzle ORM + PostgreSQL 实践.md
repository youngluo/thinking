---
createdAt: '2026-07-24 15:19'
draft: true
---

# Drizzle ORM + PostgreSQL 实践

BFF 接到真实的 PostgreSQL，最朴素的方式是手写参数化 SQL，类型靠手维护、改字段靠 review。Drizzle 走的是中间路线：query builder 几乎就是 SQL，但能从 Schema 推类型，并配套 `drizzle-kit` 管迁移。下面把它从选型思路、装包、定义 Schema，到生成迁移、跑 CRUD 串一遍。

## 认识 Drizzle ORM

Drizzle 把表、字段和约束写成普通 TS 对象，`insert` / `select` / `update` / `delete` 返回链式构造器，写错的列名或类型在编译期就会报错：

```ts
db.select().from(users).where(eq(users.id, 1))
```

可读性与参数化 SQL 几乎一致，但「写错列名」这件事 IDE 和 TS 帮你先拦一轮。Drizzle 自身不连数据库，迁移生成、执行和数据浏览由独立的 `drizzle-kit` 提供，运行时不加载。版本基线：Drizzle ORM `0.45.x`、Drizzle Kit `0.31.x`。

## 认识 PostgreSQL

PostgreSQL 在 Node 项目里几乎是默认选择——事务、外键、视图、触发器开箱即用，并通过扩展提供 JSONB、全文检索、地理空间等能力。日常会用到的主要特性：

- 身份列：`SERIAL` 或 PostgreSQL 10+ 推荐的 `GENERATED ALWAYS AS IDENTITY`；
- 时间类型：`TIMESTAMP` 与 `TIMESTAMP WITH TIME ZONE`，业务时间统一按 UTC 存；
- `ENUM` 与 `JSONB`：`ENUM` 限定取值，`JSONB` 存半结构化数据并支持索引；
- 索引：`B-tree`（默认）、`Hash`、`GIN`（适合 JSONB / 数组）、`BRIN`（适合按时间或大范围连续数据）；
- 外键与级联：`REFERENCES ... ON DELETE CASCADE`。

Drizzle 通过 `drizzle-orm/pg-core` 暴露这些能力的字段构造器，`pgTable` 与 SQL 类型一一对应。

> 本文示例在 PostgreSQL 14+ 上验证。Node 端的驱动本文用 Postgres.js（包名 `postgres`）：单包发布、自带连接池、prepared statement 自动复用、跨 Node / Bun / Workers 用同一份代码。版本基线 `3.4.x`。

## 初始化项目

```bash
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit
```

`drizzle-orm` 是运行时依赖，`drizzle-kit` 仅在开发与 CI 中加载。

### DATABASE_URL 怎么写

连接串不是占位字符串，是 Postgres.js 运行时实际解析的字段：

```text
postgres://user:password@host:port/database?sslmode=require&schema=public
```

几个常踩的点：

- 协议头必须写 `postgres://` 或 `postgresql://`，漏一个冒号 Postgres.js 启动时报错；
- 本地写进 `.env`，仓库只保留 `.env.example` 占位；
- 托管服务（Neon、Supabase、RDS）默认要 TLS，查询串加 `sslmode=require` 或 `verify-full`；
- 账号遵循最小权限：写账号、迁移账号、CI 只读账号分开。

```text title=".env"
DATABASE_URL=postgres://postgres:postgres@localhost:5432/myapp
```

校验用 `z.string().min(1)` 而不是 `.url()`——Postgres.js 也支持 `user:pass@host/db` 这种关键字写法，直接 `.url()` 会把合法串挡掉。

### 客户端与配置

```ts title="src/db/client.ts"
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env'

const client = postgres(env.DATABASE_URL, { max: 10 })
export const db = drizzle(client)
```

`max: 10` 是 Postgres.js 默认值，不是「少了就要出问题」。生产应该按 PostgreSQL `max_connections` 和 Pod 数估算：把 `(max_connections - 保留连接) / Pod 数` 当下限。应用退出前 `await client.end()` 释放连接，否则进程会被 SIGTERM 强杀。

```ts title="drizzle.config.ts"
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
})
```

`strict: true` 我推荐打开：字段类型和默认值不显式声明时会发警告，避免从 TS 类型推到数据库时悄悄漂移。

## 定义 Schema

Schema 是 Drizzle 类型系统的入口。我习惯先写表体 + 索引，再写外键，最后导出 `$inferSelect` / `$inferInsert`：

```ts title="src/db/schema.ts"
import { sql } from 'drizzle-orm'
import { pgTable, serial, text, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    email: text('email').notNull(),
    name: text('name'),
    age: integer('age'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    emailIdx: uniqueIndex('users_email_idx').on(table.email),
  })
)

export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  authorId: integer('author_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
})
```

几个我总会检查的点：

- **主键用 `serial` 还是 `generatedAlwaysAsIdentity`**：`SERIAL` 等价于自增整数主键；新项目我直接用 `integer('id').generatedAlwaysAsIdentity()`，对应 PostgreSQL 10+ 的身份列，迁移更顺；
- **外键用回调形式**：`references(() => users.id)`。函数形式是为了避开循环引用——`posts` 引用 `users` 时如果直接写 `users.id`，某些写法会撞到解析顺序问题；
- **索引命名带表名前缀**：`users_email_idx` 而不是 `email_idx`，查 `pg_stat_user_indexes` 排错时一眼能归属；
- **`$inferSelect` / `$inferInsert` 抽到独立文件**（`src/db/types.ts`），服务层和路由统一引用，避免到处重写接口。

```ts title="src/db/types.ts"
import { users, posts } from './schema'

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Post = typeof posts.$inferSelect
export type NewPost = typeof posts.$inferInsert
```

`User` 是带 `id` 和 `createdAt` 的完整行，`NewUser` 是写入时可省略自动生成字段的类型。

## 同步数据库结构

Drizzle Kit 在开发期和生产发布期干两件不同的事，我倾向这样分工：

| 命令       | 阶段     | 改库 | 进 git             |
| ---------- | -------- | ---- | ------------------ |
| `generate` | 开发     | 否   | 进                 |
| `push`     | 原型环境 | 是   | 否                 |
| `studio`   | 开发     | 否   | 否                 |
| `migrate`  | 生产发布 | 是   | 用 `generate` 产物 |

开发期：写完 Schema 改一下，先 `generate` 看 SQL 是不是预期，提交时一起进仓库。`push` 只在本地原型或一次性环境用，没有任何审计记录：

```bash
pnpm drizzle-kit generate
pnpm drizzle-kit studio
```

生产发布只走 `migrate`：

```bash
pnpm drizzle-kit migrate
```

首次发布和后续发布共用同一命令：全新库从第一份迁移开始执行并建记录表，已有库只跑未标记的迁移。`migrate` 每次发布跑一次，多副本同时执行会争 advisory lock，得不偿失。`migrate` 应放在发布管线的独立 Step / Job，而不是应用启动钩子：

```d2
direction: right

pull: 拉取新代码
review: 确认新增 SQL 已评审
mig: 执行 drizzle-kit migrate
start: 启动新版本实例

pull -> review -> mig -> start
```

迁移是单向的：已执行的 SQL 不要改，后续要修就写新文件。

## 跑 CRUD

### 新增数据

```ts
import { db } from './db/client'
import { users, type NewUser } from './db/schema'

const input: NewUser = { email: 'alice@example.com', name: 'Alice' }
await db.insert(users).values(input)
```

`values` 接收数组时，Drizzle 合成单条 `INSERT ... VALUES (...), (...)`，不会循环执行多条语句：

```ts
await db.insert(users).values([
  { email: 'bob@example.com', name: 'Bob' },
  { email: 'carol@example.com', name: 'Carol' },
])
```

能 `.returning()` 就 `.returning()`：

```ts
const [created] = await db.insert(users).values({ email: 'dave@example.com', name: 'Dave' }).returning()
```

省掉一次「插入完再 SELECT 拿 id / createdAt」的往返。

### 查询数据

```ts
import { eq } from 'drizzle-orm'
import { db } from './db/client'
import { users } from './db/schema'

const list = await db.select().from(users)
const [single] = await db.select().from(users).where(eq(users.id, 1))
```

`select()` 不传字段等价于 `SELECT *`，顺序按 Schema 声明。BFF 接口默认显式列字段：

```ts
const rows = await db.select({ id: users.id, email: users.email }).from(users)
// SELECT "id", "email" FROM users
```

`SELECT *` 在小表或写代码阶段无妨，但接口一旦上线就不应该把无关字段带到前端——一是 payload 浪费，二是提前暴露一些你其实不想暴露的列。

### 更新与删除

```ts
await db.update(users).set({ name: 'Alice 2' }).where(eq(users.id, 1))
await db.delete(users).where(eq(users.id, 1))
```

`set` 和 `where` 是必选项。漏 `where` 会更新或清空整张表——这是 ORM 入门踩坑率最高的事故，我一般会在 code review 里专门扫这种调用。需要拿回最新行就链上 `.returning()`。

## 常用查询

### 条件、排序、分页

```ts
import { and, asc, count, eq, gt, sql } from 'drizzle-orm'

const rows = await db
  .select()
  .from(users)
  .where(and(eq(users.email, 'alice@example.com'), gt(users.age, 18)))
  .orderBy(asc(users.createdAt))
  .limit(20)

const [{ total }] = await db.select({ total: count() }).from(users)
```

`and` / `or` 是显式组合，比裸 `, ` 清晰，多层嵌套也能一眼看出优先级。`count()` 直接给出聚合值，`SUM` / `AVG` 用 `` sql`SUM(amount)` `` 模板字符串。

分页默认 `limit` + `offset`。深分页（`offset` 几万起步）成本随偏移线性增长——大表换条件分页或游标方案。

### Join 与显式列

```ts
const rows = await db
  .select({
    postId: posts.id,
    title: posts.title,
    authorName: users.name,
  })
  .from(posts)
  .innerJoin(users, eq(users.id, posts.authorId))
```

`innerJoin` 取两表交集，`leftJoin` 保留左表全部行。`select` 字段对象的 key 用 `table_column` 命名，同名字段撞车的概率低得多。

### 事务

```ts
await db.transaction(async (tx) => {
  const [user] = await tx.insert(users).values({ email: 'eve@example.com', name: 'Eve' }).returning()

  const [post] = await tx.insert(posts).values({ title: 'Hello', authorId: user.id }).returning()

  return [post]
})
```

事务范围由业务粒度决定：单条写入不开事务，多表写入或需要「读到一致快照」时用。我见过一些 BFF 把每个 HTTP 请求都套一层事务，那是浪费——多数请求只是几条独立 SQL，事务开销远大于收益。

## 总结

最小链路就这几步：装包 → `pgTable` 写 Schema → `generate` + 评审产出迁移文件 → `migrate` 在生产执行 → 用 `db` 跑 CRUD。

后面真正决定 BFF 好不好维护的是三件事：

- **Schema 一改就提交迁移文件**，让 review 能拦住「删了一列、丢了数据」这类事故；
- **`postgres` 客户端的最大连接数按实例数估算**，避免 PostgreSQL 端被连接打爆；
- **查询永远带字段白名单和分页**，不靠 TS 类型偷懒——减少 payload、避免泄漏字段，也为后续分析慢 SQL 留下清晰对象。
