---
createdAt: '2026-07-24 15:19'
draft: true
---

# PostgreSQL 指南

如果只记住几条 SQL 语句，仍然很难判断一张表该怎么设计、查询为什么变慢，以及一组写操作什么时候需要事务。理解 PostgreSQL，应该先建立一条完整的认识路径：数据保存在哪里，表和表如何关联，应用如何读写数据，数据库如何保证数据有效，查询如何变快。

本文以博客中的用户和文章为例，使用原生 SQL 和 Node.js 的 Postgres.js 逐步完成这些操作。读者不需要先掌握 PostgreSQL 的所有功能，但应该能在读完后看懂一套基本的数据模型，并独立完成常见的增删改查。

## PostgreSQL 是什么

PostgreSQL 是一个关系型数据库管理系统。应用把数据写入表中，再通过 SQL 查询和修改这些数据。PostgreSQL 还负责执行约束、索引和事务规则，避免数据在多个写入入口下逐渐失去一致性。

在 Web 应用中，PostgreSQL 通常位于接口服务之后：

1. 前端向接口服务发起请求；
2. 接口服务校验参数、权限和业务条件；
3. 接口服务使用参数化 SQL 读取或修改 PostgreSQL 中的数据；
4. PostgreSQL 检查约束并执行查询；
5. 接口服务根据查询结果组装响应。

接口服务负责接口和业务流程，PostgreSQL 负责持久化数据、保证基本约束并执行 SQL。两边的职责需要配合，不能把所有规则都放在其中一边。

## PostgreSQL 的基本模型

### 数据库、Schema 和表

一个 PostgreSQL 服务可以运行多个数据库。数据库中可以包含多个 Schema，Schema 用来组织表、视图、函数等对象。应用最常操作的是表，本文默认使用常见的 `public` Schema。

表可以先用下面的方式理解：

- 表是一组结构相同的数据；
- 列描述每条数据有哪些字段，以及字段的类型；
- 行表示一条具体记录；
- 主键用来唯一标识一条记录；
- 外键用来表达表与表之间的关系。

例如，博客应用可以拆成两张表：

- `users` 保存用户；
- `posts` 保存文章；
- `posts.author_id` 保存文章作者对应的用户 id。

一个用户可以有多篇文章，一篇文章只属于一个用户，这是典型的一对多关系。把用户和文章拆开后，用户信息只需要保存一次，查询文章时再通过外键关联作者。

### 数据类型

字段类型应该表达数据本身的含义：

- `integer` 和 `bigint` 适合整数；
- `numeric` 适合需要精确计算的金额；
- `text` 适合文本；
- `boolean` 适合真假状态；
- `timestamptz` 适合表示一个具体时刻；
- `jsonb` 适合结构变化较多、又需要在数据库中查询的半结构化数据。

`jsonb` 不能替代所有关系。需要独立查询、建立约束或参与关联的数据，仍然应该拆成列或独立的关联表。

### 约束解决什么问题

约束是数据库在写入数据时执行的规则。常见约束包括：

- `PRIMARY KEY` 保证一张表中的记录有唯一标识；
- `REFERENCES` 创建外键，防止记录引用不存在的对象；
- `NOT NULL` 要求字段必须有值；
- `UNIQUE` 防止字段出现重复值；
- `CHECK` 限制字段必须满足一个条件；
- `DEFAULT` 在没有提供字段值时使用默认值。

身份列和主键承担不同职责。身份列负责自动生成 id，主键负责保证 id 唯一。`GENERATED ALWAYS AS IDENTITY` 表示插入新记录时，由 PostgreSQL 自动生成该列的值，通常不需要在 `INSERT` 中提供 `id`。本文使用这种身份列，不能因为字段会自动生成值，就省略主键或唯一约束。

### 外键删除行为

外键不仅能限制引用关系，还可以定义删除被引用记录时如何处理关联记录。以 `posts.author_id` 引用 `users.id` 为例：

- `NO ACTION`：如果删除后仍有文章引用该用户，约束检查会失败。它是 PostgreSQL 的默认动作；
- `RESTRICT`：存在文章引用该用户时，拒绝删除用户；
- `CASCADE`：删除用户时，数据库自动删除所有引用该用户的文章；
- `SET NULL`：删除用户后，把文章的 `author_id` 设置为 `NULL`，因此该字段必须允许为空。

在普通的非延迟约束场景中，`NO ACTION` 和 `RESTRICT` 都会阻止删除仍被引用的用户。是否使用级联，需要根据数据模型决定。如果文章可以独立保留，可以限制删除或将作者置空。如果文章是用户的一部分，才适合使用 `ON DELETE CASCADE`。

## 连接 PostgreSQL

前面的内容说明了数据保存在哪里。接下来先建立一个数据库连接，再执行后面的建表和查询示例。本文默认已经有一个可以访问的 PostgreSQL 实例，不展开不同操作系统下的安装过程。

### 使用连接串

Node.js 应用通常从环境变量读取连接信息：

```text fold title=".env.example"
DATABASE_URL=postgres://user:password@host:5432/myapp
```

连接串包含协议、用户名、密码、主机、端口和数据库名。生产环境还需要根据数据库服务商的要求，通过驱动的 `ssl` 选项配置 TLS。真实密码不应该写进代码或提交到仓库。

有 `psql` 客户端时，可以使用连接串直接连接：

```bash fold
psql $DATABASE_URL
```

`psql` 适合临时执行 SQL 和查看结果。应用代码则通过数据库驱动创建连接池，供多个请求复用。

### 使用 Postgres.js 创建客户端

先安装驱动：

```bash fold
pnpm add postgres
```

创建数据库客户端：

```ts fold title="src/db/client.ts"
import postgres from 'postgres'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required')
}

export const sql = postgres(databaseUrl, {
  max: 10,
})
```

Postgres.js 使用标签模板执行 SQL。模板中的插值会作为查询参数发送给 PostgreSQL，不需要手动拼接引号。

可以先执行一条简单查询确认连接成功：

```ts fold title="src/db/check-connection.ts"
import { sql } from './client'

const [{ now }] = await sql`SELECT now()`

console.log(now)
```

查询结果通常是一个数组，每一项对应一行记录。`SELECT now()` 返回当前数据库时间，能够同时验证连接和查询是否正常。

### 连接池和权限

连接池会复用已经建立的数据库连接，避免每个请求都重新创建连接。`max` 表示一个 Node.js 进程最多占用的连接数。连接池容量不能只看单个进程，应用实例增加后，连接总数也会增加：

`每个实例的最大连接数 ≤ (数据库最大连接数 - 预留连接数) / 实例数`

预留连接需要覆盖迁移任务、管理操作和其它服务。应用退出时应调用 `sql.end()`，释放连接并等待未完成的请求结束。

应用账号应该只拥有运行时所需的读写权限，迁移任务和只读任务可以使用不同账号。权限控制、密钥保存和 TLS 配置属于部署环境的一部分，不应该由业务代码绕过。

## 创建 users 和 posts 表

### 设计表结构

先把关系转换成表结构：

- `users.id` 是用户主键；
- `users.email` 是不能重复的用户邮箱；
- `posts.id` 是文章主键；
- `posts.author_id` 是文章作者的外键；
- `posts.author_id` 不能为空，因为示例中的文章必须有作者；
- `posts.created_at` 和 `posts.id` 可以共同确定文章列表的稳定顺序。

### 执行建表 SQL

```sql fold title="schema.sql"
CREATE TABLE users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text,
  age integer CHECK (age IS NULL OR age >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE posts (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  author_id integer NOT NULL
    REFERENCES users (id)
    ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
```

这段 SQL 创建了两张表。创建 `posts` 时，`users` 必须已经存在，因为外键需要引用它的主键。

`users.email` 的 `UNIQUE` 约束会阻止重复邮箱。`posts.author_id` 的外键会阻止文章引用不存在的用户。示例使用 `ON DELETE CASCADE`，所以删除用户时，数据库也会删除属于该用户的文章。真实业务是否需要这个行为，要根据文章能否脱离用户独立存在来决定。

`published_at` 没有 `NOT NULL`，表示未发布的文章可以暂时没有发布时间。`age` 的检查约束允许空值，但不允许负数。

## 基本增删改查

表结构创建好之后，就可以保存和读取数据。CRUD 是四类最基本的操作：

- Create，新增数据；
- Read，查询数据；
- Update，修改数据；
- Delete，删除数据。

### 新增数据

可以使用 `RETURNING` 取回数据库生成的 id 和默认字段：

```ts fold title="src/users.ts"
import { sql } from './db/client'

const email = 'alice@example.com'
const name = 'Alice'

const [user] = await sql`
  INSERT INTO users (email, name)
  VALUES (${email}, ${name})
  RETURNING id, email, name, created_at
`

console.log(user)
```

插入成功后，`user.id` 就是这条用户记录的主键。它可以继续用于创建文章。下面代码用 1 作为示意值，实际应使用上一段返回的 `user.id`，不能假设身份列一定从 1 开始：

```ts fold title="src/posts.ts"
import { sql } from './db/client'

const title = 'Hello PostgreSQL'
const authorId = 1

const [post] = await sql`
  INSERT INTO posts (title, author_id)
  VALUES (${title}, ${authorId})
  RETURNING id, title, author_id, created_at
`

console.log(post)
```

`authorId` 需要替换成真实存在的用户 id。外键约束会检查这个用户是否存在。

### 查询数据

查询时优先选择接口真正需要的字段：

```ts fold title="src/users.ts"
import { sql } from './db/client'

const email = 'alice@example.com'

const [user] = await sql`
  SELECT id, email, name, created_at
  FROM users
  WHERE email = ${email}
`
```

这段查询可以按几个部分理解：

- `SELECT` 决定返回哪些列；
- `FROM` 决定从哪张表读取；
- `WHERE` 决定只保留哪些行；
- `ORDER BY` 决定结果顺序；
- `LIMIT` 限制返回数量。

`WHERE` 是查询范围的核心。没有 `WHERE` 的 `SELECT` 会读取整张表，没有 `WHERE` 的 `UPDATE` 或 `DELETE` 则可能修改整张表。

### 更新和删除数据

更新和删除都应该带上明确的 `WHERE` 条件：

```ts fold title="src/users.ts"
import { sql } from './db/client'

const userId = 1
const newName = 'Alice 2'

await sql`
  UPDATE users
  SET name = ${newName}
  WHERE id = ${userId}
`

await sql`
  DELETE FROM users
  WHERE id = ${userId}
`
```

这个示例中的删除会触发外键定义的级联行为。删除用户后，引用该用户的文章也会被删除。更新和删除前应确认业务是否允许这种结果，不能只因为 SQL 执行成功就认为操作正确。

Postgres.js 会把标签模板中的插值作为参数处理。用户输入应该通过这种方式绑定，不能直接拼进 SQL 字符串。

## 关联查询和分页

用户和文章分开保存后，接口通常需要一次返回文章和作者信息。这时使用 `JOIN` 把相关记录组合起来：

```ts fold title="src/posts.ts"
import { sql } from './db/client'

const authorId = 1
const limit = 20
const offset = 0

const rows = await sql`
  SELECT
    p.id,
    p.title,
    p.created_at,
    u.id AS author_id,
    u.name AS author_name
  FROM posts AS p
  INNER JOIN users AS u ON u.id = p.author_id
  WHERE p.author_id = ${authorId}
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT ${limit}
  OFFSET ${offset}
`
```

`INNER JOIN` 只返回能够匹配用户的文章。下面把 `users` 放在左边，使用 `LEFT JOIN` 查询所有用户及其文章：

```ts fold title="src/users-with-posts.ts"
import { sql } from './db/client'

const rows = await sql`
  SELECT
    u.id AS user_id,
    u.name AS user_name,
    p.id AS post_id,
    p.title AS post_title
  FROM users AS u
  LEFT JOIN posts AS p ON p.author_id = u.id
  ORDER BY u.id, p.created_at DESC NULLS LAST, p.id DESC
`
```

`LEFT JOIN` 会保留左表中的记录，即使右表没有匹配项。因此，没有文章的用户仍然会出现在结果中，只是文章相关字段会是 `NULL`。当前表结构使用级联删除，所以不存在用户被删除而文章仍然保留的情况。

`LIMIT` 和 `OFFSET` 适合数据量较小或页码较浅的列表。页码很深时，数据库仍然需要跳过前面的记录，代价会随着页码增加。

如果列表数据量较大，可以使用基于游标的分页。游标需要和排序字段保持一致：

```sql fold
SELECT id, title, created_at
FROM posts
WHERE (created_at, id) < ('2026-01-01T00:00:00Z', 100)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

这里的 `created_at` 和 `id` 一起构成稳定排序。即使多篇文章的创建时间相同，`id` 也能作为第二排序条件，避免翻页时重复或遗漏记录。

不要先查询一页文章，再在循环中逐篇查询作者。那会产生 N+1 查询，应该优先使用 `JOIN` 或一次批量查询。

## 事务

### 为什么需要事务

一项业务操作可能包含多条 SQL。例如创建用户后创建第一篇文章，如果第二步失败，通常不希望只留下一个没有文章的用户。

事务把多条语句放在一个操作中。全部成功时提交，任意一步失败时回滚：

```sql fold
BEGIN;

INSERT INTO users (email, name)
VALUES ('bob@example.com', 'Bob')
RETURNING id;

-- 应用程序读取上一步返回的 id
INSERT INTO posts (title, author_id)
VALUES ('First post', 42);

COMMIT;
```

上面的 `42` 只是示意，实际应该使用上一条 `INSERT` 返回的用户 id。如果中间步骤失败，应执行 `ROLLBACK`，让事务中的写入一起撤销。

在 Node.js 中，可以使用 Postgres.js 的事务 API：

```ts fold title="src/create-user-with-post.ts"
import { sql } from './db/client'

await sql.begin(async (transaction) => {
  const [user] = await transaction`
    INSERT INTO users (email, name)
    VALUES (${'bob@example.com'}, ${'Bob'})
    RETURNING id
  `

  await transaction`
    INSERT INTO posts (title, author_id)
    VALUES (${'First post'}, ${user.id})
  `
})
```

回调中的 SQL 全部属于同一个事务。回调抛出错误时，事务会回滚；回调正常结束时，事务会提交。

简单理解，事务有点类似前端的 `Promise.all`，都是把多个操作看成一个整体。

### 原子性和隔离级别

事务的原子性表示一组操作要么全部成功，要么全部撤销。隔离级别解决的是并发事务之间如何互相看到数据，这两个概念不能混为一谈。

PostgreSQL 默认使用 `Read Committed`。大多数普通接口不需要手动调整隔离级别，但涉及库存、余额或并发更新时，需要结合业务规则选择更强的并发控制方式。

事务边界应该跟业务操作保持一致。单条独立写入通常不需要额外包裹事务，多表写入和必须一起完成的步骤才需要显式事务。不要为了统一形式把每个 HTTP 请求都放进一个长事务。

## 索引和查询性能

前面的查询在数据量很小时通常都能运行，但数据增长后，数据库需要处理的行数会变多。索引和执行计划解决的是「如何用更少的工作找到需要的数据」。

### 索引是什么

索引是表之外维护的一种查找结构。它可以帮助 PostgreSQL 更快定位符合条件的行，但会额外占用空间，并增加插入、更新和删除时的维护成本。因此，索引应该根据真实查询设计，不能给每一列都创建索引。

常见索引类型包括：

- `B-tree` 是默认索引，适合等值、范围和排序查询；
- `GIN` 适合 `jsonb`、数组等包含关系查询；
- `BRIN` 适合数据量很大，且物理顺序与时间或数值范围高度相关的表。

主键和唯一约束会自动创建唯一索引，但 PostgreSQL 不会自动为外键列创建索引。`posts.author_id` 经常用于筛选和关联，因此需要结合查询建立索引。

### 组合索引

本文的文章列表按作者筛选，再按创建时间和 id 倒序排列，可以创建组合索引：

```sql fold title="schema.sql"
CREATE INDEX posts_author_created_idx
  ON posts (author_id, created_at DESC, id DESC);
```

组合索引的列顺序很重要。这个索引的第一列是 `author_id`，能够服务于按作者筛选的查询，后面的列可以继续服务于排序。索引是否有效，仍然需要通过执行计划和真实数据验证。

### 使用执行计划

`EXPLAIN` 可以查看 PostgreSQL 为查询选择的执行计划。`ANALYZE` 会实际执行语句，并显示真实执行时间和实际行数：

```sql fold
EXPLAIN (ANALYZE, BUFFERS)
SELECT
  p.id,
  p.title,
  p.created_at
FROM posts AS p
WHERE p.author_id = 1
ORDER BY p.created_at DESC, p.id DESC
LIMIT 20;
```

重点观察：

- 是否使用了 `Seq Scan`、`Index Scan` 或 `Bitmap Index Scan`；
- 估算行数和实际行数是否相差很大；
- 过滤条件是在索引中执行，还是读取数据后才过滤；
- 排序、Join 和聚合是否消耗了主要成本。

`Seq Scan` 不一定代表问题。小表或者需要读取大部分数据时，全表扫描可能更快。`EXPLAIN ANALYZE` 会实际执行语句，对 `UPDATE` 和 `DELETE` 尤其要谨慎。

### 常见性能问题

SQL 性能优化应该从真实请求和执行计划开始，常见排查方向包括：

- 只查询接口真正需要的字段，避免无目的使用 `SELECT *`；
- 为稳定的筛选条件、排序和关联关系设计索引；
- 检查组合索引的列顺序是否匹配查询；
- 使用 `JOIN` 或批量查询，避免 N+1 查询；
- 对深分页场景评估游标分页；
- 使用接近生产规模的数据验证优化结果；
- 同时考虑索引带来的写入、存储和维护成本。

## 结构变更和应用服务边界

### 管理结构变更

生产环境中的表结构不应该依赖手工操作。每次变更都应形成可审查、可重复执行的迁移文件，并与应用代码一起版本管理。

常见流程是先增加兼容结构，再发布读写逻辑，最后清理旧结构。已经执行的迁移文件不要直接修改，后续修正应新增迁移。

### 应用服务的数据访问边界

应用服务和 PostgreSQL 各自承担不同职责：

- 应用服务校验请求格式、权限和业务流程；
- PostgreSQL 约束保证所有写入入口都满足基本数据规则；
- SQL 使用参数绑定，不能把用户输入拼接进查询文本；
- 对外接口显式选择字段，不直接把整行数据返回给前端；
- 列表接口限制返回数量，并明确分页规则；
- 多步写入使用与业务操作一致的事务边界；
- 数据库错误需要转换成合适的接口错误，不能直接泄露连接信息或内部 SQL。

## 总结

读写 PostgreSQL 的基本流程可以归纳为：

1. 根据业务关系设计表和字段；
2. 使用类型和约束保证数据有效；
3. 通过连接池执行参数化 SQL；
4. 使用 `INSERT`、`SELECT`、`UPDATE` 和 `DELETE` 完成基本操作；
5. 使用 `JOIN` 获取关联数据；
6. 使用事务保证多步操作的原子性；
7. 根据真实查询设计索引，并用 `EXPLAIN` 验证性能。

掌握这条路径后，再使用 ORM 时就能判断 Schema 是否合理、生成的 SQL 是否符合预期，以及索引和事务是否真正解决了业务问题。
