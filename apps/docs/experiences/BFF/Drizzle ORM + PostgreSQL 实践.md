---
createdAt: '2026-07-24 15:19'
draft: true
---

# Drizzle ORM + PostgreSQL 实践

本文演示 Drizzle ORM 0.45 与 Postgres.js 3.4 在 Node BFF 中的最小可用链路：定义 Schema、生成迁移、跑 CRUD，再串到 Hono 路由上。

## 认识 Drizzle ORM

Drizzle 把表、字段和约束写成普通 TS 对象，`insert` / `select` / `update` / `delete` 返回的链式构造器带有 Schema 推导出的字段类型，写错的列名或类型在编译期就会报错。链式 API 贴近 SQL，读 `.from(users).where(eq(users.id, 1))` 几乎等于读 `SELECT * FROM users WHERE id = 1`。

Drizzle 自身不连数据库，需要配合驱动使用。PostgreSQL 场景下本文使用 Postgres.js（包名 `postgres`），Drizzle 适配器是 `drizzle-orm/postgres-js`。Postgres.js 自带连接管理，类型随包发布，不需要 `@types/pg`。

开发期的迁移生成、`migrate` 执行和 `studio` 数据浏览由独立的 `drizzle-kit` 提供，与运行时查询分开。

> 版本：Drizzle ORM `0.45.x`、Drizzle Kit `0.31.x`、`postgres` `3.4.x`、Hono `4.12.x`。`drizzle-kit` 和 `drizzle-orm` 是两个独立包，前者只在开发和 CI 中使用。

## 初始化项目

```bash
pnpm add drizzle-orm postgres
pnpm add -D drizzle-kit
```

`drizzle-orm` 是运行时依赖，`drizzle-kit` 负责生成和执行迁移，`postgres` 是 PostgreSQL 驱动，类型随包发布，不需要 `@types/pg` 之类的额外类型包。

加载环境变量时校验：

```ts title="src/env.ts"
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
})

export const env = schema.parse(process.env)
```

### 连接串格式与安全

`DATABASE_URL` 是 Postgres.js 在运行时解析的连接字符串，需要符合驱动可识别的格式：

```text
postgres://user:password@host:port/database?sslmode=require&schema=public
```

要点：

- `protocol` 写 `postgres://` 或 `postgresql://`，两者等价；漏写或写错协议，Postgres.js 在首次连接时报错。
- `user` / `password` 不要直接写进仓库。本地用 `.env`，生产从部署平台的 Secret 读取。
- 本地开发示例（不要提交到仓库）：

  ```text title=".env"
  DATABASE_URL=postgres://postgres:postgres@localhost:5432/myapp
  ```

  `.env` 加入 `.gitignore`；仓库保留 `.env.example`，值用占位符（如 `postgres://user:password@host:5432/db`），让协作者按本地情况替换。

- 托管服务（Neon、Supabase、RDS 等）默认要求 TLS，查询串需要 `sslmode=require` 或 `verify-full`，否则连接被拒绝。
- 数据库账号遵循最小权限：本地应用账号不必是超级用户，生产读写账号与迁移发布账号分开。
- 生产不复用本地密码；CI / Serverless 用只读账号跑查询，写操作走单独的连接串或账号。
- 可选 `application_name=myapp`，便于在 `pg_stat_activity` 中识别连接来源；`schema` 默认 `public`，多租户或多 Schema 时显式声明。

校验使用 `z.string().min(1)` 而不是 `.url()`，因为 Postgres.js 也接受关键字形式（`user:password@host:port/db`）和简化形式（`host/db`），直接 `.url()` 会把合法写法挡掉。

### 数据库客户端

```ts title="src/db/client.ts"
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../env'

const client = postgres(env.DATABASE_URL, { max: 10 })
export const db = drizzle(client)
```

`postgres(url, options)` 返回的客户端自带连接池，连接数、超时等参数在选项中配置。Drizzle 只把查询转换为 SQL 并执行，不参与连接管理；`max: 10` 是示例值，Postgres.js 默认也是 10，生产应按 `max_connections` 与工作进程数估算。应用退出前调用 `await client.end()` 关闭连接。

### Drizzle Kit 配置

`drizzle.config.ts` 告诉 Drizzle Kit 去哪里找 Schema、迁移输出到哪个目录、目标数据库是什么：

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

`schema` 指向 Schema 文件，`out` 是迁移输出目录。`strict: true` 强制字段类型和默认值显式声明，避免静默漂移。

## 定义数据表

Drizzle 用 `pgTable` 把表结构写成普通 TS 对象，字段类型、约束和索引都通过链式调用描述：

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

要点：

- `serial('id')` 对应 PostgreSQL 的 `SERIAL`，等价于自增整数主键；新项目更推荐 `integer('id').generatedAlwaysAsIdentity()`，对应 PostgreSQL 10+ 的身份列；
- `notNull()`、`default(sql\`now()\`)`、`references()` 把约束直接写进 Schema，迁移和类型推导会同时纳入；
- 第二个参数是回调，用来声明索引和额外约束，命名加表名前缀（如 `users_email_idx`）便于排错；
- 外键使用 `references(() => users.id)`，回调形式避免循环引用报错；`onDelete: 'cascade'` 在删除作者时连带删除其文章。

Schema 上挂的 `$inferSelect` 与 `$inferInsert` 推导查询和写入类型：

```ts title="src/db/types.ts"
import { users, posts } from './schema'

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Post = typeof posts.$inferSelect
export type NewPost = typeof posts.$inferInsert
```

`User` 是带 `id` 和 `createdAt` 的完整行；`NewUser` 是写入时可省略自动生成字段的类型。服务层和路由都可以使用它们，避免重复定义接口。

## 同步数据库结构

Drizzle Kit 把 Schema 转成可执行的迁移文件，流程是 `generate` 生成 SQL、`migrate` 在目标数据库执行、`studio` 提供本地数据浏览：

```bash
# 生成迁移文件
pnpm drizzle-kit generate

# 在目标数据库执行迁移
pnpm drizzle-kit migrate

# 本地浏览和编辑数据
pnpm drizzle-kit studio
```

`generate` 比较当前 Schema 与上次生成的状态，把差异写入 `out` 目录。生成的 SQL 是普通文件，可以随项目提交到仓库，由评审逐条查看。

`migrate` 按顺序执行 `out` 目录下的迁移，并记录哪些已经应用。生产部署时，`migrate` 通常作为发布脚本的一步：先确认新迁移，再启动新版本实例。

`push` 不写迁移文件，直接把当前 Schema 推到数据库，只适合本地原型：

```bash
pnpm drizzle-kit push
```

生产或共享环境应当只走 `generate` + `migrate`。`push` 不留审计记录，列重命名等变更也无法被自动识别。

`studio` 启动一个本地 Web 界面，用于查看表结构和手动编辑数据，不在运行时路径里。

## 基础 CRUD API

Drizzle 的 CRUD 以 `db` 为入口，链式调用构造 SQL，通过 `await` 取结果。

### 新增数据

```ts
import { db } from './db/client'
import { users, type NewUser } from './db/schema'

const input: NewUser = { email: 'alice@example.com', name: 'Alice' }

await db.insert(users).values(input)
```

`db.insert(users).values(...)` 对应 `INSERT INTO users (...) VALUES (...)`。未显式提供的字段使用默认值或由数据库生成，例如 `id` 和 `createdAt`。

批量插入直接传数组：

```ts
await db.insert(users).values([
  { email: 'bob@example.com', name: 'Bob' },
  { email: 'carol@example.com', name: 'Carol' },
])
```

Drizzle 会用单条 `INSERT ... VALUES (...), (...)` 完成批量写入。

需要拿到写入结果时使用 `returning`：

```ts
const [created] = await db.insert(users).values({ email: 'dave@example.com', name: 'Dave' }).returning()

console.log(created.id, created.createdAt)
```

`returning()` 由 PostgreSQL 返回指定字段；不传参数时返回完整行。

### 查询数据

```ts
import { eq } from 'drizzle-orm'
import { db } from './db/client'
import { users } from './db/schema'

const list = await db.select().from(users)
const [single] = await db.select().from(users).where(eq(users.id, 1))
```

`db.select()` 不传参数等价于 `SELECT *`，字段顺序由 Schema 声明顺序决定。只有部分字段需要时显式列出：

```ts
const rows = await db.select({ id: users.id, email: users.email }).from(users)
```

对应 SQL 是 `SELECT "id", "email" FROM users`，对大表能避免把不必要字段拉回 Node 进程。

### 更新数据

```ts
import { eq } from 'drizzle-orm'
import { db } from './db/client'
import { users } from './db/schema'

await db.update(users).set({ name: 'Alice 2' }).where(eq(users.id, 1))
```

`set` 写要修改的字段，`where` 限定更新范围；不写 `where` 会更新整张表，是常见事故来源。需要返回更新后的行时使用 `.returning()`：

```ts
const [updated] = await db.update(users).set({ name: 'Alice 2' }).where(eq(users.id, 1)).returning()
```

### 删除数据

```ts
import { eq } from 'drizzle-orm'
import { db } from './db/client'
import { users } from './db/schema'

await db.delete(users).where(eq(users.id, 1))
```

删除操作同样需要 `where`，否则会清空整张表。需要拿回被删除的行时使用 `.returning()`。

## 常用查询 API

Drizzle 的查询条件都来自 `drizzle-orm`，链式组合可以覆盖绝大多数日常场景。

### 比较与组合条件

```ts
import { and, eq, gt } from 'drizzle-orm'

const rows = await db
  .select()
  .from(users)
  .where(and(eq(users.email, 'alice@example.com'), gt(users.age, 18)))
```

常用操作符：

- `eq`、`ne`、`gt`、`gte`、`lt`、`lte`：基本比较；
- `isNull`、`isNotNull`：NULL 判断；
- `inArray`、`notInArray`：集合判断；
- `like`、`ilike`：模糊匹配，`ilike` 在 PostgreSQL 上大小写不敏感；
- `and(...)`、`or(...)`：组合条件，复杂查询可嵌套。

### 排序、分页与聚合

```ts
import { asc, count, sql } from 'drizzle-orm'

const page = await db.select().from(users).orderBy(asc(users.createdAt)).limit(20).offset(40)

const [{ total }] = await db.select({ total: count() }).from(users)
```

`limit` + `offset` 是最常见的分页写法，深分页成本随偏移量线性增长。`count()` 返回单值聚合；`SUM`、`AVG` 等可以用 `sql\`SUM(amount)\`` 直接写。

### Join

```ts
import { eq } from 'drizzle-orm'

const rows = await db
  .select({
    postId: posts.id,
    title: posts.title,
    authorName: users.name,
  })
  .from(posts)
  .innerJoin(users, eq(users.id, posts.authorId))
```

`innerJoin` 只保留匹配行，`leftJoin` 保留左表全部行，必要时再加 `where` 补齐过滤条件。`select` 字段对象显式列出，避免返回过大的行结构。

### 事务

```ts
const [created] = await db.transaction(async (tx) => {
  const [user] = await tx.insert(users).values({ email: 'eve@example.com', name: 'Eve' }).returning()

  const [post] = await tx.insert(posts).values({ title: 'Hello', authorId: user.id }).returning()

  return [post]
})
```

`db.transaction` 接收回调，回调内使用 `tx` 执行查询，回调正常返回即提交，抛出异常即回滚。事务范围由业务操作决定：单条写入不需要事务；多表写入或需要一致读的场景再使用。

## 最小 Hono 整合

下面用一个查询接口和一个新增接口展示完整链路。Hono 的具体路由、中间件和部署细节不在本文范围内。

```ts title="src/app.ts"
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from './db/client'
import { users } from './db/schema'

export const app = new Hono()

const listQuery = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
})

app.get('/users', zValidator('query', listQuery), async (c) => {
  const { limit } = c.req.valid('query')
  const rows = await db.select().from(users).limit(limit)
  return c.json({ rows })
})

const createBody = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(80),
})

app.post('/users', zValidator('json', createBody), async (c) => {
  const body = c.req.valid('json')
  const [created] = await db.insert(users).values({ email: body.email, name: body.name }).returning()
  return c.json(created, 201)
})

app.onError((err, c) => {
  if (err instanceof z.ZodError) {
    return c.json({ error: 'invalid_request' }, 400)
  }
  return c.json({ error: 'internal_error' }, 500)
})
```

要点：

- 请求参数由 Zod 校验。Drizzle 的类型推导只保证查询字段名合法，不替代请求校验。
- `select` 未指定字段时返回完整行，需要做字段白名单时显式写出。
- 错误处理集中在 `onError` 中统一映射 HTTP 状态码，避免把数据库异常直接抛给客户端。

## 常见入门问题

### 类型推导不能替代请求校验

`db.insert(users).values({ email: 123 })` 会在编译期报错，但 `body` 来自 HTTP 请求时，TS 类型无法保证运行时正确。请求参数校验（Zod、Valibot、TypeBox 等）必须独立于 Drizzle 类型。

### `push` 不等同于迁移流程

`drizzle-kit push` 直接把当前 Schema 推到数据库，不生成迁移文件。生产或共享环境只能使用 `generate` + `migrate`，并把迁移文件纳入代码评审。

### 连接复用

Postgres.js 客户端应当在整个进程内复用，不要在每次请求或每次查询时新建。Node.js 长驻进程配合 `max` 控制并发；Serverless 环境要使用对应平台的无连接或单连接驱动，常见做法是 `@neondatabase/serverless`、`@vercel/postgres`，或 Postgres.js 通过 `workerd` 入口在 Cloudflare Workers 中运行。

### 时间与 `bigint`

字段类型决定 Drizzle 读出的 JS 类型：

- `timestamp({ withTimezone: true })` 默认按字符串返回；需要 `Date` 时在字段上加 `mode: 'date'`；
- `bigint` 在 JS 中是 `bigint`，`JSON.stringify` 默认无法处理，需要在接口层转换为字符串或自定义序列化。

### 索引与查询

`where`、`orderBy` 中频繁出现的字段应当建索引；`serial` 主键已自动建索引。SQL 是否走索引要靠 `EXPLAIN ANALYZE` 验证，不能只看文本。

## 总结

把 Drizzle ORM 接入 BFF 的核心链路是：定义 Schema → `drizzle-kit generate` 生成迁移 → 在目标库执行 `migrate` → 用 `db` 完成 CRUD → 在 Hono 路由里把请求参数、数据库操作和 JSON 响应串起来。后续工程化重点是迁移发布顺序、连接池配置、字段白名单和基于真实负载的索引验证。
