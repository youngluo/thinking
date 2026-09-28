---
createdAt: '2026-09-03 11:38'
draft: true
---

# Web 安全实践指南

Web 安全要覆盖从浏览器发起请求到服务端处理完成的整个过程，最容易误判的是浏览器侧的规则：同源策略和 CORS 只管当前浏览器里的脚本，命令行工具和服务端自己发出的请求不受影响，服务端的身份认证、权限校验和输入校验必须独立成立。本文说明这些判断由谁负责、什么时候失效，以及请求合法之后的内容边界、滥用和审计。做法是先确定要阻止哪一类请求，再分析它成立的条件。

一次状态变更通常要经过这些检查：

```d2
direction: right

request: 客户端请求
tls: HTTPS / TLS
origin: Origin / CSRF 校验
auth: 身份认证
permission: 权限与资源归属
freshness: 时间戳、Nonce、签名
idempotency: 幂等与重复提交
input: 内容与指令边界
business: 业务执行

request -> tls -> origin -> auth -> permission -> freshness -> idempotency -> input -> business
```

## 安全基础

评估一个请求的安全性，至少要确认下面五件事：

| 安全目标 | 要回答的问题                             | 常见手段                                  |
| -------- | ---------------------------------------- | ----------------------------------------- |
| 机密性   | 不应看到数据的人能否读到它               | HTTPS、TLS、访问控制、敏感数据脱敏        |
| 完整性   | 数据在传输或处理过程中能否被悄悄修改     | TLS、请求签名、服务端校验                 |
| 身份认证 | 当前请求由谁发出                         | Session、Cookie、Access Token、客户端证书 |
| 授权     | 这个身份是否有权执行当前操作             | 服务端权限校验、资源归属校验              |
| 新鲜度   | 这是不是当前请求，而不是旧请求的重复提交 | 防重放、幂等                              |

这些目标相互关联，但不能互相替代。HTTPS 可以保护传输过程中的机密性和完整性，不能替代身份认证或业务权限校验；有效的登录态只说明请求属于哪个用户，不说明该用户是否有权修改当前资源。

## 同源策略

同源策略根据协议、主机和端口判断两个页面是否同源。不同源时，浏览器按行为分别处理：

| 跨源行为                                | 同源策略的处理                             |
| --------------------------------------- | ------------------------------------------ |
| 用 `fetch` 或 `XMLHttpRequest` 读取响应 | 默认读不到，需目标服务端通过 CORS 明确允许 |
| 读写另一个源页面的 DOM 和 Storage       | 禁止                                       |
| 发起请求，例如链接和表单提交            | 通常允许                                   |
| 嵌入资源，例如图片和 `iframe`           | 通常允许                                   |

通常允许的两类不等于内容会被执行，是否执行取决于资源类型、解析上下文和页面的安全策略。

Cookie 不走这套判定，它按域和路径独立匹配，脚本能否读取还受 `HttpOnly` 等属性影响。

确实需要跨源通信时，窗口或 `iframe` 用 `window.postMessage` 建立消息通道，收发两侧都要校验：

- 发送方指定准确的 `targetOrigin`；
- 接收方校验 `event.origin`，必要时校验 `event.source`；
- 消息内容按预先约定的结构检查 `event.data`。

不要用 `*` 传递敏感数据，也不要把 `event.data` 里的类型字段当身份。任何页面都能发出一条结构相同的消息，谁发的只能看 `event.origin` 和 `event.source`。

## CORS

CORS（Cross-Origin Resource Sharing）是浏览器读取跨源响应前做的一次来源检查，服务端用一组响应头告诉浏览器哪些 Origin 可以读这个响应。它由浏览器强制执行，不是服务端的授权系统。

### 允许来源

以 app.example.com 的页面调用 api.example.com 的接口为例，要让页面脚本读到响应，接口需要这样回：

```http fold
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE
Access-Control-Allow-Headers: Content-Type, X-CSRF-Token
Vary: Origin
```

示例里决定谁能读的是 `Access-Control-Allow-Origin`：它填一个完整的源，浏览器就只允许这个源下的页面脚本读取响应。

这个响应头一次只能填一个源，也不接受 https://*.example.com 这种局部通配。另一个取值是 `*`，表示任何来源都能读，只适合公开且不需要登录态的接口；请求一旦带上 Cookie 或 `Authorization`，浏览器就要求填完整的源名，写 `*` 会被判为不允许。

前端域名不止一个时，名单只能存在服务端：请求里的 `Origin` 说明这次是谁在调，服务端比对名单，命中就把这一个源写进响应头，不命中就不写，浏览器随即拦住读取。

`Vary: Origin` 管的是缓存。同一个 URL 现在会因来源不同而返回不同的响应头，就要让 `Origin` 参与缓存键；不声明它，CDN 会把先到的那个来源的响应回给后面的来源，后者读取失败。

### 预检请求

预检是浏览器发出跨源请求前的一次问答：先向服务端发一个 `OPTIONS`，问这个来源、这个方法、这些请求头是否被允许，服务端用对应响应头回答，通过之后才发出正式请求。回答时只列出实际需要的来源、方法和头。

`fetch` 请求要不要预检，取决于它是不是简单请求。同时满足下面三条的算简单请求，浏览器直接发出正式请求：

- 方法限定在 `GET`、`HEAD`、`POST`；
- 除浏览器自动添加的头之外，只带 `Accept`、`Accept-Language`、`Content-Language`、`Content-Type` 和 `Range`；
- 名单里的 `Content-Type` 只取 `application/x-www-form-urlencoded`、`multipart/form-data`、`text/plain` 之一，`Range` 只允许单个字节范围。

任何一条不满足，浏览器就先发一次预检。前端最常见的预检来自 JSON，`Content-Type: application/json` 不在那三个取值里，所以带 JSON 请求体的跨源 `POST` 一定先预检。`XMLHttpRequest` 用同样这三条判断，但多一个触发条件：在 `xhr.upload` 上注册了事件监听（例如上传进度）后，`POST` 即使满足这三条也会先预检，`GET` 不受影响。

预检请求不携带请求体，也不带 Cookie 和 `Authorization`，因此不要把身份认证或业务校验放在预检阶段，否则合法请求会因为「预检阶段没有凭证」而被拒。`Access-Control-Max-Age` 决定浏览器把这次结果复用多久，用来省掉重复往返。

## 通信安全

请求进入业务之前先经过传输链路，响应再带着若干响应头回到浏览器，由它们决定后续的默认行为。

### HTTPS

HTTPS 是 HTTP 运行在 TLS 上的结果。TLS 主要提供三项能力：

- 加密，避免传输内容被旁路观察；
- 完整性校验，发现传输中的篡改；
- 服务端身份认证，浏览器通过证书验证连接的主机。

身份认证这一项取决于证书校验是否真的执行。服务端调用下游、客户端访问接口时都不能关闭证书校验，也不要用「忽略证书错误」绕过问题。

部署时页面和所有子资源都要走 HTTPS，混用两种协议就是「混合内容」。HTTPS 页面里加载的 HTTP 脚本、样式和 `iframe` 属于主动内容，浏览器通常直接阻止；图片、音视频等被动内容会被尝试升级为 HTTPS，或者在控制台告警。

HTTP 入口可以重定向到对应的 HTTPS 地址：

```http fold
HTTP/1.1 301 Moved Permanently
Location: https://app.example.com/account
```

重定向能把用户带到 HTTPS，代价是这一次明文请求已经发出去了，完整路径暴露在网络上，中间人还能改写这条跳转，把用户留在 HTTP 上或者送去别的站点。HSTS 把规则交给浏览器记住，策略由响应头下发：

```http fold
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

HSTS 改变的是浏览器的两个行为。书签、聊天记录和旧页面里写死的 `http://` 链接、在地址栏只输入域名，浏览器都会先把地址改写成 HTTPS 再发请求，那次明文请求和 301 往返都不会发生；访问这个域名时如果出现证书错误，浏览器不再提供跳过入口。

策略要浏览器先用 HTTPS 成功访问过一次站点、并收到过这个响应头才会建立，HTTP 响应里送来的会被忽略，否则中间人塞一条策略就能把用户锁进 HTTPS。示例取值是一年，期限越长回退余地越小，首次启用时可以先用一个更短的值，确认没有子域还依赖 HTTP 之后再放大。`includeSubDomains` 则把生效范围扩大到所有子域，内部系统和临时环境也不例外。

preload 针对的是首次访问。浏览器发行版里内置了一份由 Chrome 维护的域名列表，其它主流浏览器基于它，列表中的域名即使浏览器还没收到过 HSTS 头也会直接走 HTTPS，HTTPS 不可用时连接失败。开启是在响应头里写上 `preload`，再到 hstspreload.org 提交域名，提交要求证书有效、HTTP 入口重定向到 HTTPS、所有子域都能用 HTTPS。

新条目要随 Chrome 发行版发布才生效，通常数月；撤销要去掉响应头里的 `preload` 再提交移除申请，同样要等一次更新才到用户。HSTS 已经覆盖绝大多数场景，`preload` 只适合域名长期由自己控制、能承诺所有子域 HTTPS 的情况，工具和模板不要把它写成默认值。

### 安全响应头

这些响应头只改变浏览器的默认行为，不替代服务端的身份认证、授权和输入校验：

| 响应头                                                       | 说明                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `Content-Security-Policy`                         | 限制脚本、资源和嵌入来源；防嵌入用 `frame-ancestors`，按产品是否允许嵌入配置 |
| `X-Content-Type-Options: nosniff`                 | 禁止浏览器猜测响应 MIME 类型；不能修复错误的响应内容                     |
| `Referrer-Policy`                                 | 限制 Referer 的泄露范围；不应把 Token 放在 URL 中                        |
| `Permissions-Policy`                              | 关闭页面与被嵌入页面用不到的浏览器能力；是能力开关，不控制数据可见性，也不替代授权 |
| `Strict-Transport-Security`                       | 后续访问强制使用 HTTPS；首次访问和过期前仍需考虑部署策略                 |
| `Cache-Control: no-store`                         | 防止敏感响应被缓存；只影响缓存，不等于访问控制                           |
| `X-Frame-Options: DENY`                           | 为旧浏览器提供禁止嵌入的兼容控制；现代页面优先使用 CSP 的 `frame-ancestors` |

响应本身要给出与内容一致的 `Content-Type`。API 返回 JSON 却标注成 `text/html`，页面或用户直接打开这个地址时，浏览器就按 HTML 渲染响应体。

还有一类泄露与浏览器无关。响应体里的堆栈、SQL 语句、内部主机名和依赖版本会帮助攻击者定位可利用的实现细节，生产环境应返回稳定的错误码和追踪标识，原文留在服务端日志里，`X-Powered-By` 一类的框架头同理。

带身份的响应还要检查共享缓存。反向代理和 CDN 按 URL 与请求头决定缓存键，一旦缓存了依赖 `Cookie` 或 `Authorization` 的响应，上一个用户的业务数据就可能被下一个用户读到。这类响应要显式使用 `private` 或 `no-store`，并按需要设置 `Vary`；只写 `Cache-Control` 不等于缓存策略生效，还要确认链路上的代理确实遵守它。

## XSS

XSS（Cross-Site Scripting，跨站脚本攻击）指攻击者控制的数据被浏览器当成 HTML、JavaScript、CSS 或可执行 URL 解析，最终在受害者的页面上下文中执行。

根因不是某个特殊字符串，而是应用把「不可信数据」放进了不适合它的解析上下文。例如，普通评论应该作为文本显示，却被拼接到 `innerHTML`；用户提供的 URL 应该是链接地址，却没有限制协议，最终被当成脚本地址。

常见类型如下：

| 类型       | 数据从哪里进入               | 典型场景                                        |
| ---------- | ---------------------------- | ----------------------------------------------- |
| 反射型 XSS | 当前请求参数                 | 搜索关键词被服务端直接回显到 HTML               |
| 存储型 XSS | 数据库或缓存                 | 恶意评论、昵称或公告被保存后展示给其它用户      |
| DOM 型 XSS | 浏览器端 URL、Storage 或消息 | 前端把 `location.hash` 直接写入 HTML |

### 脚本执行之后

脚本一旦执行，用的就是受害者的登录态和页面权限。以存储型为例，攻击者在评论区留下一段 `<img src=x onerror="…">`，另一个用户打开这个页面，图片加载失败就会触发它，脚本在受害者的会话里运行。它可以把 `document.cookie` 送到攻击者的服务器，也可以直接以受害者的身份发请求、改写页面上展示的金额和收款账号。

### 安全渲染与输出编码

不需要解析 HTML 时，直接使用框架默认的转义能力，或使用 DOM 的文本 API：

```ts fold
const title = document.createElement('h2')
title.textContent = untrustedTitle
container.replaceChildren(title)
```

React、Vue 等框架通常会自动转义插值内容。不要因为输入来自数据库或「看起来像内部数据」就跳过转义，因为数据库中的内容仍可能由用户或外部系统写入：

```tsx fold
export function Comment({ text }: { text: string }) {
  return <p>{text}</p>
}
```

`dangerouslySetInnerHTML`、`v-html`、`innerHTML`、`outerHTML` 和 `document.write` 等 API 会改变默认的文本语义。只有在确实需要渲染富文本时，才允许使用它们。

HTML、HTML 属性、JavaScript、CSS 和 URL 使用不同的解析规则，不能用一个「统一转义函数」覆盖所有场景：

- HTML 文本使用 HTML 实体编码；
- HTML 属性使用属性编码，并始终使用引号包裹属性值；
- URL 参数使用 URL 编码；
- 不要把不可信数据直接放入 `<script>`、事件处理器、CSS 代码或动态代码执行 API；
- 能不用动态拼接就不用动态拼接，优先通过 DOM 属性或框架属性传值。

### 跳转与开放重定向

URL 也是一种解析上下文，`javascript:` 开头的地址会被当成脚本执行。用户可控的跳转地址要限制协议，并对完整 URL 做域名白名单校验，不能直接拼接到 `href`：

```ts fold
function getSafeUrl(input: string) {
  const url = new URL(input, 'https://example.com')

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return '/invalid-link'
  }

  return url.toString()
}
```

上面的示例只限制了协议，指向外部站点的完整地址仍然能通过校验。用户被带到这样的地址，就是「开放重定向」，常见入口是登录完成后的 `returnUrl`、分享跳转和退出登录后的跳转。是否允许外部域名，要根据业务需要增加域名白名单。安全 URL 校验应该发生在最终使用位置附近，避免数据在多个上下文之间流转后失去语义。

### 富文本清洗

如果产品确实需要用户输入 Markdown、评论格式或富文本，应把「允许哪些标签、属性和协议」定义成白名单，再使用成熟的 HTML Sanitizer 或经过审查的库清洗。清洗不是把几个已知危险字符串替换掉，而是按 HTML 解析规则删除不允许的节点和属性：

```ts fold
import DOMPurify from 'dompurify'

const safeHtml = DOMPurify.sanitize(untrustedHtml, {
  ALLOWED_TAGS: ['p', 'strong', 'em', 'ul', 'ol', 'li', 'a'],
  ALLOWED_ATTR: ['href'],
})

element.innerHTML = safeHtml
```

清洗配置需要和产品实际支持的富文本能力一起维护。放开 `style`、事件属性、任意 URL 协议或复杂 SVG 时，应重新评估攻击面。

### CSP 纵深防御

CSP（Content Security Policy）通过响应头限制页面可以加载和执行的资源。可以先从下面的最小策略开始，再按真实资源补充：

```http fold
Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; object-src 'none'; base-uri 'self'
```

`connect-src` 限制 `fetch`、`XMLHttpRequest`、WebSocket 等脚本连接目标；`form-action` 限制表单提交目标。`connect-src` 未单独设置时可以用 `default-src` 兜底，`form-action` 不会继承 `default-src`。

CSP 的策略需要先通过 `Content-Security-Policy-Report-Only` 观察违规报告，再切换为强制策略。不要为了让旧代码快速运行就长期加入 `unsafe-inline` 或 `unsafe-eval`。

CSP 不能替代输出编码和 HTML 清洗。它可能因为浏览器兼容性、策略配置错误或允许的资源过多而无法阻止所有 XSS。

## CSRF

CSRF（Cross-Site Request Forgery，跨站请求伪造）利用的是浏览器会自动携带 Cookie。攻击者诱导已经登录的用户访问恶意页面，恶意页面再向目标站点发起修改资料、创建订单或转账等请求。目标服务端看到的是有效的登录 Cookie，因此可能把请求当成用户主动操作。防护可以叠加 CSRF Token、SameSite Cookie 和来源校验，具体组合取决于会话方式、跨站需求和接口风险。

### 触发方式

触发不需要用户动手。恶意页面里一个 `src` 指向目标站点的 `<img>`，或者一段在加载时自动提交的表单，就足以让浏览器带着受害者的 Cookie 把那笔请求发出去，用户只是打开了那个页面。

同源策略通常会阻止恶意页面读取跨源响应，但不会阻止它发起请求。CSRF 的核心风险是「请求被执行」，而不是「攻击者能否看到响应」。一次使用 Cookie 认证的状态变更请求可以抽象为：

```http fold
POST /api/profile/email HTTP/1.1
Host: app.example.com
Cookie: session=opaque-session-id
Content-Type: application/x-www-form-urlencoded

email=new-address@example.com
```

如果服务端只依赖 Cookie，没有校验请求是否来自自己的页面，攻击者就可能构造类似请求。状态变更不能使用 GET，因为 GET 请求很容易被链接、图片、预加载和爬虫触发。

### CSRF Token

服务端可以为当前会话生成不可预测的 Token，并要求所有状态变更请求通过隐藏字段或自定义请求头携带它。攻击者可以让浏览器带上 Cookie，但通常无法读取同源页面中的 Token：

```ts fold
async function updateProfile(input: { email: string }, csrfToken: string) {
  const response = await fetch('/api/profile', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    throw new Error('profile update failed')
  }
}
```

服务端需要在执行操作前校验 Token，并将它绑定到当前会话或用户。Token 不应只依赖用户可控的字段，也不应通过 URL 传递，以免进入历史记录、Referer 和日志。

如果使用自定义请求头，跨源脚本通常需要先通过 CORS 预检。服务端仍应执行显式校验：预检通过不说明随后的实际请求可信。

### 来源校验

对于状态变更请求，服务端可以优先校验 `Origin`，必要时再根据兼容性策略检查 `Referer`。校验必须是完整的源匹配，不能使用简单的字符串包含判断：

```ts fold
const trustedOrigins = new Set(['https://app.example.com'])

function isTrustedRequest(request: Request) {
  const origin = request.headers.get('origin')

  if (origin) {
    return trustedOrigins.has(origin)
  }

  const referer = request.headers.get('referer')

  if (!referer) {
    return false
  }

  return trustedOrigins.has(new URL(referer).origin)
}
```

对于高风险接口，来源校验失败、来源缺失或 Token 缺失都应在业务执行前返回 403。某些非浏览器客户端可能不会发送这些请求头，可以为它们设计独立的认证方式，而不是无条件放宽浏览器接口。

CORS 决定浏览器脚本能否读取跨源响应，来源校验和 Token 决定状态变更请求是否可信，两者互不替代：CORS 配置为空时，跨站表单仍然可以发起简单请求。

## 会话管理

登录解决的是「这一次」的身份确认，后续请求还要能认出同一个人，这件事由会话承担。

### Cookie 属性

Cookie 常被用作会话凭证，服务端可以这样设置：

```http fold
Set-Cookie: __Host-session=opaque-random-value; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1800
```

各项的作用和边界如下：

| 属性                         | 说明                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Secure`          | 只通过 HTTPS 发送；不能防止 XSS，开发环境也应尽量使用 HTTPS                                                               |
| `HttpOnly`        | 禁止页面脚本通过 `document.cookie` 读取；不能阻止 XSS 使用当前会话发起请求                                     |
| `SameSite`        | 限制跨站请求是否携带 Cookie；是 CSRF 的一层防护，不等于完整 CSRF 方案                                                     |
| `Domain`          | 控制哪些主机可以接收 Cookie；范围越大，受影响的子域越多                                                                   |
| `Path`            | 限制请求路径；是 Cookie 发送范围，不应当被当作完整的权限边界                                                              |
| `Max-Age/Expires` | 控制有效期；服务端还需要维护空闲超时、绝对过期和主动失效                                                                  |
| `__Host-` 前缀  | 名字以它开头时，浏览器只接受同时满足 `Secure`、`Path=/`、不带 `Domain` 的 Cookie，因此子域无法设置或覆盖它；需要子域共享时改用普通名称并重新评估信任边界 |

共用 `Domain` 只表示两边都会收到这个 Cookie，不代表它们同源。app.example.com 与 api.example.com 仍然是跨源关系，但 `Domain=example.com` 的 Cookie 会同时发给两者。匹配只按主机和路径、不按端口区分。未设置 `Domain` 时只发送给设置它的主机，设置后发送给该域及其子域。

扩大 `Domain` 就是扩大受信任子域的范围。未设置 `HttpOnly` 时，范围内的任意页面脚本都能通过 `document.cookie` 读取它，一个子域上的 XSS 就足以拿走会话。Cookie 是否随跨源请求发出，还取决于 `credentials` 模式和 `SameSite`。不需要共享时应省略 `Domain`。

`SameSite` 有三个取值：

- `Strict` 限制最强，但可能影响从外部站点进入后立即保持登录态的体验；
- `Lax` 对常见的跨站顶级导航更宽松，适合许多普通站点，但不能覆盖所有业务风险；
- `None` 允许跨站发送，必须同时设置 `Secure`，通常只在确实需要跨站 Cookie 时使用。

`SameSite` 中的 Site 与 `Origin` 不是同一概念。Site 通常由协议和可注册域名决定，因此同一注册域下的不同子域可能同站但不同源。仅靠 `SameSite` 时，共享注册域、旧浏览器、跨站业务和错误的 GET 副作用都可能留下缺口。

### 会话生命周期

服务端至少需要处理下面几个时机：

- 登录成功、提升权限、修改密码或发生高风险事件后重新认证或轮换 Session ID，避免会话固定；
- 登出时让服务端会话失效，不能只清除浏览器 Cookie；
- 同时设置空闲超时和绝对超时；
- 记录登录、轮换、失效、异常 Token 和关键操作，日志中不要写入完整 Cookie、Token 或签名密钥。

会话 ID 出现在 URL 中会进入浏览器历史、Referer、代理日志和服务器日志，因此不应使用 URL 参数传递登录态。

会话值应是由密码学安全随机数生成器产生的不可预测的不透明值，不要把密码、权限规则或其它敏感信息直接放进 Cookie。

### 凭证存储与校验

HttpOnly Cookie 可以降低 Token 被 XSS 直接读取和批量外带的风险，但使用 Cookie 认证时需要配合 CSRF 防护。放在 `Authorization` 头中的 Bearer Token 不会被浏览器自动附加到普通跨站请求，因此通常不受传统 Cookie 型 CSRF 影响，但前端需要访问 Token，XSS 一旦发生就可能直接窃取它。

`localStorage` 中的长期 Token 可以被同源页面脚本读取。它不是绝对禁止使用的存储，但不适合在没有充分 XSS 防护和短期轮换机制的情况下保存高价值长期凭证。更稳妥的方案通常是短期 Access Token 配合服务端管理的 Refresh Token，或由 BFF 使用 HttpOnly Cookie 维护浏览器会话。

无论选择哪种方式，服务端都必须重新校验：

- Token 是否有效、是否过期；
- 签发者、受众和用途是否匹配；
- 当前用户是否有权操作目标资源，权限取自服务端的权限数据而不是 Token 携带的角色列表，否则权限变更之后旧 Token 仍然生效；
- 会话是否已经登出、撤销或进入风险状态。

前两条在自包含 Token（例如 JWT）上落到三个具体的校验点。签名算法由服务端的配置决定，不能按 Token 头部里的 `alg` 选择：接受 `none`，或者用 HMAC 去验证一个本应是 RS256 签名的 Token，验证结果都不再有意义。`iss`、`aud`、`exp`、`nbf` 和用途相关的声明要逐项校验，受众不匹配的 Token 不能被另一个服务当作有效凭证使用。`kid`、`jku`、`x5u` 这类头部字段是外部输入，不能拼进文件路径或直接当作获取密钥的地址，否则「验证签名」本身就变成一次由调用方指定目标的服务端请求。

自包含 Token 在有效期内无法由服务端单方面收回。需要即时下线的场景（改密、发现异常登录、账号封禁）要么使用短期 Access Token 配合 Refresh Token 轮换，要么在服务端保存会话状态或撤销记录，并让记录的存活时间不短于 Token 的剩余有效期。只把 Token 从浏览器里删掉不构成撤销。

## 越权与资源归属

身份认证回答「请求由谁发出」，授权回答「这个身份能否执行当前操作」，还有第三层回答「这条数据是否在他的范围内」。三者互不覆盖。登录有效不代表可以改别人的收货地址，接口做了权限校验也不代表它返回的字段都该给这个调用方看。

最常见的缺口是只校验登录。认证一过就按路径里的 `id` 查单，这张订单是谁的，服务端并不关心。正确做法是用「当前身份可访问的范围」去限定查询，让越权请求自然查不到数据，而不是先取出数据再比较属主：

```ts fold
async function getOrder(id: string, userId: string) {
  const order = await orderRepo.findByOwner({ id, ownerId: userId })

  if (!order) {
    throw new HttpError(404, 'Order not found')
  }

  return order
}
```

失败响应的口径要提前统一。403 等于承认「这个标识存在，只是不属于你」，404 把「不存在」和「不是你的」混在一起。要防枚举就统一返回 404，代价是排障时状态码分不出两种情况，真实原因只能看服务端日志。

归属查对之后，剩下的边界都在字段和取值上，安全基础里提到的脱敏也落在这一层：

| 边界 | 要守住什么 | 放行的后果 |
| ---- | ---------- | ---------- |
| 字段范围 | 更新只写白名单里列出的字段，不把请求体直接展开进模型或 ORM 对象 | 调用方多传一个 `role`、`ownerId` 或 `status` 就被写进库，这就是「批量赋值」 |
| 取值来源 | 价格、库存、优惠金额和审批结果由服务端从可信数据源读取并重算，状态流转按服务端定义的状态机走 | 前端提交的金额成了写库依据，跳步请求和正常请求一样被接受 |
| 响应字段 | 返回结构按调用方的需要定义，脱敏在服务端完成，不靠前端隐藏 | 整行返回把手机号、证件号和内部成本价带到客户端 |
| 资源标识 | 对外使用随机标识，归属校验照做 | 自增主键暴露业务量级，越权探测可以挨个试一遍 |

这几条都更适合白名单而不是黑名单。这一次想到要排除的字段和状态，挡不住下一次没想到的。

## 请求签名与防重放

HTTPS 保护的是传输通道。它能降低网络监听者读取和修改请求的风险，但不会自动给业务请求增加「一次性」语义。如果攻击者从被盗的客户端、应用日志、错误的代理记录或其它应用层位置获得了一份有效请求，就可能尝试再次提交。

防重放要解决的是新鲜度问题。服务端需要知道请求是不是在允许时间窗口内生成的，以及这个请求标识是否已经被使用过。

### 签名材料

服务端到服务端或 BFF 调用下游服务时，可以把请求规范化后使用 HMAC 签名。一个常见的签名材料包含：

```text fold
HTTP_METHOD
PATH
CANONICAL_QUERY
BODY_SHA256
TIMESTAMP
NONCE
```

请求通过以下请求头携带签名信息：

```http fold
X-Key-Id: service-a
X-Timestamp: 1788406200
X-Nonce: 2c9b8f...
X-Signature: base64url-hmac-value
```

签名示例可以写成：

```ts fold
import { createHash, createHmac, randomBytes } from 'node:crypto'

function hashBody(body: string) {
  return createHash('sha256').update(body).digest('base64url')
}

function canonicalQuery(url: URL) {
  return [...url.searchParams.entries()]
    .sort(([firstKey, firstValue], [secondKey, secondValue]) => {
      return firstKey.localeCompare(secondKey) || firstValue.localeCompare(secondValue)
    })
    .map(([key, value]) => {
      return encodeURIComponent(key) + '=' + encodeURIComponent(value)
    })
    .join('&')
}

function buildCanonicalRequest(method: string, url: URL, body: string, timestamp: string, nonce: string) {
  return [method.toUpperCase(), url.pathname, canonicalQuery(url), hashBody(body), timestamp, nonce].join('\n')
}

function signRequest(secret: string, method: string, url: URL, body: string, timestamp: string, nonce = randomBytes(16).toString('hex')) {
  const canonical = buildCanonicalRequest(method, url, body, timestamp, nonce)

  const signature = createHmac('sha256', secret).update(canonical).digest('base64url')

  return { nonce, signature }
}
```

生产实现需要固定规范化规则，包括重复查询参数的排序、空值处理、路径编码、请求体原文和字符集。客户端与服务端必须使用同一套规则，否则合法请求也会因为签名材料不同而失败。

HMAC 密钥必须只存在于受信任的服务端或 BFF，不能放在浏览器 JavaScript、网页源码或公开配置中。浏览器端应该使用自己的会话和 CSRF 防护访问 BFF，由 BFF 使用服务端密钥签名下游请求。

### 服务端校验顺序

服务端收到签名请求后，可以按下面的顺序处理：

1. 根据 `X-Key-Id` 查找密钥、调用方和允许访问的资源；
2. 解析时间戳，拒绝超出允许漂移窗口的请求，例如五分钟之外的请求；
3. 使用请求体原文、规范化 URL 和收到的请求方法重新构造签名材料；
4. 使用常量时间比较验证签名，避免因为比较过程泄露信息；
5. 以原子操作写入 `Nonce`，并设置略大于时间窗口的 TTL。写入失败说明 Nonce 已经使用过，应拒绝请求；
6. 通过身份认证、权限校验和幂等处理后，才执行实际业务。

时间戳只能缩短旧请求的有效时间，不能阻止攻击者在窗口内重复发送；Nonce 能识别重复请求，但必须在服务端保存并原子检查；签名能证明请求内容没有被篡改，却不能证明请求是新的。

防重放缓存需要考虑分布式部署。所有接收请求的实例必须共享缓存或使用具备原子去重能力的存储，不能只在单个进程的内存中记录 Nonce。

### 一次性链接凭证

签名与 Nonce 处理的是服务端之间的重放，同一套新鲜度要求也适用于发给用户的一次性链接：密码重置、邮箱验证、报表导出地址。这类链接会留在浏览器历史、邮件转发、Referer 和代理日志里，任何一次外泄都可能让它在有效期内被别人用掉。

凭证本身要不可预测、绑定用户和用途、有效期短到只覆盖一次操作，并在消费时用原子操作标记为已使用。同一凭证被二次使用应当触发告警，因为这通常意味着它已经被复制过。凭证最终落到一次跳转上时，跳转目标仍要限制在自家域名白名单内，链接里的凭证也不能随跳转继续带到其它站点。

## 幂等与重复提交

用户点下提交，请求超时了。可能是服务端已经建好订单，只是响应没回到浏览器；也可能是请求根本没到服务端。客户端自动重试，或者用户再点一次，就是同一个意图的第二次执行。对创建订单、支付、发放优惠券这类操作，两次执行会产生两笔业务结果。

幂等要解决的是让重复的请求只产生一个结果。做法是客户端为一次业务意图生成一个随机值，重试时复用同一个值，这个值就是幂等键；服务端第一次见到某个键时正常执行业务，并把响应连同这个键记下来，再见到同一个键，就不再执行业务，直接把记下的响应返回。

这和防重放是两件事。防重放发现重复的请求标识就直接拒绝这次请求，幂等接受重试，并把第一次的处理结果再给调用方一次。签名证明调用方和请求内容可信，身份认证确认请求属于谁，它们都不判断这次是不是重复提交。

请求把键放在一个自定义请求头里带上：

```http fold
POST /api/orders HTTP/1.1
Authorization: Bearer access-token
Idempotency-Key: 8c4c7b2e-...
Content-Type: application/json

{"productId":"p-100","quantity":1}
```

服务端不能只按这个键查记录，要先把它和调用者、接口、请求参数绑在一起。代码里的 `scope` 由用户、方法和键拼成，`requestHash` 是请求参数的摘要。不绑用户，A 生成的键可能被 B 的请求命中；不绑参数摘要，同一个键可以被拿去提交不同的订单。

查记录有三种走向。命中记录且 `requestHash` 一致，就是前面说的重试，直接返回记下的响应。命中记录但摘要不一致，说明这个键被用在了别的请求上，返回 409。没有记录，就先占位再执行业务，成功把响应写回记录，失败释放占位：

```ts fold
import { createHash } from 'node:crypto'

async function createOrder(request: Request, userId: string) {
  const key = request.headers.get('idempotency-key')

  if (!key) {
    throw new HttpError(400, 'Idempotency-Key is required')
  }

  const bodyText = await request.text()
  const requestHash = createHash('sha256').update(bodyText).digest('base64url')
  const scope = userId + ':POST:/api/orders:' + key
  const previous = await idempotencyStore.get(scope)

  if (previous) {
    if (previous.requestHash !== requestHash) {
      throw new HttpError(409, 'Idempotency-Key conflicts with request')
    }

    return previous.response
  }

  const reservation = await idempotencyStore.reserve(scope, requestHash)

  if (!reservation.created) {
    return waitForOrReadExistingResult(scope)
  }

  try {
    const response = await orderService.create({
      userId,
      body: JSON.parse(bodyText),
    })

    await idempotencyStore.complete(scope, requestHash, response)
    return response
  } catch (error) {
    await idempotencyStore.releaseOrMarkFailed(scope, error)
    throw error
  }
}
```

`reserve` 必须是原子操作。两个重试请求可能同时到达，都在对方占位之前查不到记录；占位不原子的话，两边都会去执行业务，幂等就失效了。抢不到占位的请求不必报错，等前一个写完再读它的结果，代码里是 `waitForOrReadExistingResult`。

记录本身还有几种状态要提前定义：处理中的记录被后来的请求读到是等待还是报错，失败的记录能否用同一个键重试，记录保留多久。支付和订单这类高价值操作，通常把幂等记录和业务写入放进同一个事务，避免出现业务已经成功、记录却没落库的情况。

幂等键不能替代身份认证和授权。服务端必须先确认当前用户是谁、是否有权创建订单，再查找或写入对应的幂等记录。

## 不可信输入

前面的检查确认了请求由谁发出、能否执行、是否重复。内容进入业务之后还有另一个问题：数据在什么时刻变成了指令。SQL 语句、shell 命令、对象属性路径、网络地址和文件路径各自有一层解释器，把外部数据拼进去，解释器就分不出「要执行的结构」和「要处理的内容」。

### SQL 与命令注入

查询使用参数化接口，由驱动或 ORM 负责区分结构与数据：

```ts fold
const rows = await pool.query('SELECT id, amount FROM orders WHERE user_id = $1 AND id = $2', [userId, orderId])
```

参数化覆盖的位置是「值」。表名、列名、排序方向、`IN` 列表和 `ORDER BY` 片段不能作为参数传递，这些地方要回到白名单，把输入映射到服务端预先定义的标识符：

```ts fold
const sortColumns = new Map([
  ['created', 'created_at'],
  ['amount', 'amount'],
])

function orderBy(input: string) {
  const column = sortColumns.get(input)

  if (!column) {
    throw new HttpError(400, 'Unsupported sort field')
  }

  return `ORDER BY ${column} DESC`
}
```

ORM 不会自动消除这类风险：把外部字符串传进原始查询接口、用拼接构造 SQL 片段，或者让请求里的字段名直接充当列名，都会绕回同一个根因。

命令执行使用参数数组形式，交给被调用程序自己解析参数，不经过 shell 字符串。一旦把外部数据拼进 `sh -c` 之类的命令串，引号、分号、反引号、管道和环境变量展开就重新变成指令。

同一个模式还出现在别的位置：拼进模板引擎的片段、写进日志行的换行符，以及导出为 CSV 时以 `=`、`+`、`-`、`@` 开头的单元格，会被表格软件当作公式解释。

### 原型污染

`__proto__`、`prototype` 和 `constructor` 在 JavaScript 里既是普通属性名，又参与原型链查找，所以「按键路径写对象」这类通用逻辑会被外部数据影响。下面四种写法在 Node.js v24 下实测，输入都是一段把 `pp` 挂在 `__proto__` 上的 JSON：

| 写法                                | 全局原型是否被污染 | 其它后果                                         |
| ----------------------------------- | ------------------ | ------------------------------------------------ |
| 仅 `JSON.parse`          | 否                 | 得到一个带 `__proto__` 自有属性的对象 |
| 展开语法 `{ ...obj }`    | 否                 | 该自有属性保留在结果里，留到下一次合并时发作     |
| `Object.assign({}, obj)` | 否                 | 目标对象自身的原型被换成外部数据里的对象         |
| 递归按键赋值合并                    | 是                 | 进程内所有对象都能读到被写入的属性               |

`JSON.parse` 本身不改变原型链，风险发生在后续处理。递归合并（自己写的 `merge` 或同类递归实现）会沿 `__proto__` 继续下钻，把子属性写到 `Object.prototype` 上，污染范围是整个进程。`Object.create(null)` 和 `Map` 能避开 setter 这条路径，但数据上仍然带着一个 `__proto__` 自有属性，之后再被合并进普通对象照样发作。展开语法那一行只对原生实现成立：经 TypeScript 降级后按 `Object.assign` 语义克隆，得到的对象原型会被替换。结论是在入口处就按名字拒绝，不要指望下游处理得干净：

```ts fold
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function toSafeRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new HttpError(400, 'Expected an object')
  }

  const safe: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(input)) {
    if (BLOCKED_KEYS.has(key)) {
      throw new HttpError(400, 'Unsupported property name')
    }

    safe[key] = typeof value === 'object' && value !== null && !Array.isArray(value) ? toSafeRecord(value) : value
  }

  return safe
}
```

示例为了简短直接拒绝数组，实际接口要按数据结构递归处理。污染造成的后果取决于进程里还有什么：属性查找结果变化会让权限判断和定价逻辑读到凭空出现的值；如果对象属性随后被拼进 SQL、模板或命令，污染就成了注入的入口。

### 服务端发起的请求

功能要求服务端按调用方给的地址取内容时，发起方就变成了自己的服务：抓取链接生成摘要与缩略图、校验回调地址、从外部数据源导入、代理图片。给出的地址不需要指向公网，指向 `127.0.0.1` 上的管理端口、内网地址段或云厂商的元数据地址，就能借服务端的身份访问调用方本来碰不到的东西，而元数据接口返回的实例凭证往往是更高价值的目标。这里的身份是服务端的身份，业务侧的授权逻辑对它完全不适用。

约束要落在出口上：

- 只允许预先登记的协议、主机和端口，并在 DNS 解析之后仍然校验地址；
- 拒绝回环、私有和链路本地等不应由服务端访问的地址段，把判断做在建立连接之前；
- 让校验与实际连接使用同一个解析结果，否则 DNS 重绑定可以做到「检查时是公网地址、连接时是内网地址」；
- 禁止自动跟随重定向，或者对每一跳重复全套校验；
- 出网流量整体经代理或防火墙收口，让默认规则是拒绝，而不是每个业务接口各自实现一遍。

元数据服务侧的加固（要求额外的会话令牌、缩短凭证有效期）只能降低被访问之后的危害，替代不了出口白名单。

### 文件与内容

文件扩展名和请求里的 `Content-Type` 都由调用方提供，证明不了内容。校验要落在内容本身：能否被目标解析器成功解析成对应类型、大小与像素尺寸上限，以及允许的类型清单。

存储与返回方式决定内容会不会被执行。上传目录如果与站点同源，一个可以写入 HTML 或 SVG 的位置就是同源脚本执行点。要使用随机文件名、与主站隔离的域名或不可执行的路径，返回下载时给出明确的 `Content-Type` 和 `Content-Disposition: attachment`，并配合 `X-Content-Type-Options: nosniff`。

文件名不能参与磁盘路径拼接，`../` 和编码后的分隔符都可能指向预期目录之外。图片类内容需要重新编码后再存储，既去掉嵌入的可执行载荷，也去掉 EXIF 里的设备、位置和原始路径，这些字段往往不是用户打算公开的内容。

## 点击劫持

点击劫持让攻击者把目标页面嵌入自己控制的页面，再覆盖一层与实际意图不符的界面，诱骗用户完成授权、转账或修改绑定。用户的点击是一次真实交互，请求带着自己的 Cookie，来源和 CSRF Token 也都来自自家站点，因此来源校验和身份认证都拦不下它。它利用的是「用户看到的界面」与「实际接收点击的页面」不一致。

攻击成立需要两个条件。目标页面允许被任意来源嵌入，并且被覆盖的那个操作不需要重新认证。一次典型的嵌入只用到普通的绝对定位和透明度：

```html fold
<iframe src="https://app.example.com/settings/authorize" style="position:absolute;left:0;top:0;width:320px;height:200px;opacity:0.01"></iframe>
<div style="position:absolute;left:40px;top:78px">点击领取</div>
```

防御的主手段是限制可嵌入范围，未显式允许时默认禁止：

```http fold
Content-Security-Policy: frame-ancestors 'none'
X-Frame-Options: DENY
```

确实需要被合作方嵌入时，写具体的祖先源，而不是放开到任意来源：

```http fold
Content-Security-Policy: frame-ancestors 'self' https://merchant.example.com
```

`X-Frame-Options` 只能表达「禁止」或「仅同源」，表达不了白名单，现代页面以 `frame-ancestors` 为准。这一层控制的是自己的页面被别人嵌入，反过来嵌入第三方页面时，同样要评估对方能给用户呈现什么界面。

常见的前端自检跳转不足以充当防线：

```js fold
if (window.top !== window.self) {
  window.top.location = window.self.location
}
```

跨源时页面读不到 `window.top.location.href`，读取会抛异常；能否把顶层导航走通要看浏览器是否拦截这次导航，未被拦截时这段代码确实能把顶层换成自己的地址。这段检测在几种情况下失效：`sandbox` 未授予 `allow-top-navigation` 时导航被禁止；攻击者可以让最外层页面只负责承接跳转，把用户留在诱饵页上；合法的嵌入式场景（支付、第三方登录、客服工单）反而会被这段检测打断。

剩余的攻击面来自交互方式的差异：覆盖层可以配合拖拽、双击、长按和指针事件重新排布，用户以为自己在操作 A，实际触发了 B。被嵌入页面的可用能力可以用 `Permissions-Policy` 收窄，但它是能力开关，改变不了「用户看到什么界面」这个根本问题。

## 滥用与限流

前面各节默认请求来自真实用户的少量操作。还有一类请求不利用任何实现缺陷：接口按设计工作，只是被高频、批量、长时间地调用。登录接口上的凭证填充、验证码与短信接口的轰炸、公开读接口被批量拉取数据、深分页拖垮数据库，都属于这一类。它们的后果是直接资损、他人账号被打爆或者服务不可用，因此防护目标是成本与速率，不是合法性。

限流要按维度组合，单一维度都能被绕过。只按 IP 会误伤同一出口下的正常用户（企业 NAT、移动网络、机房出口），也挡不住分布式来源；只按身份则放过批量注册和无需登录的接口。常用的维度是主体（用户、租户、会话）、来源（IP、IP 段、接入网络）和接口，各自的窗口与配额分开配置。

算法之间的差别在于允许的突发形态。固定窗口实现最简单，但在窗口交界处可以通过两倍的配额；滑动窗口更平滑，代价是记账成本；令牌桶允许一定突发，漏桶强制匀速。给接口定配额要能说出依据，例如正常用户的峰值速率、机器消费速率和下游容量，否则这个数字只是从别处抄来的。

失败计数与锁定容易被反过来利用。「连续失败即锁定账号」会让攻击者用错误密码把真实用户锁在门外，等于把可用性攻击变成产品自带的能力。相对稳妥的组合是提高验证成本、按来源限速，并保留人工处置通道。

响应动作通常分层：告警、要求人机校验、降速、拒绝、封禁来源、强制重新认证。读接口还需要限制单次代价，例如分页最大条数、用游标替代无上限的深翻页、把导出改成异步任务并限制并发，否则限流只挡住了请求数量，没有挡住单个请求的开销。

用于识别的线索只能用于识别。User-Agent、Referer 和客户端指纹都由调用方提供，可以被任意改写，它们适合用来分群和解释异常，不适合作为放行或拒绝的唯一依据。限流同样不能替代身份认证与授权，它是前两者都通过之后仍然保留的一层，因为合法身份也可能正在做机器行为。

## 审计与响应

前面这些校验失败时有一个共同特征：请求被拒绝，业务本身没有异常。只有日志能区分「用户在正常使用时出错」和「有人在系统性地试探」。

需要记录的是那些改变信任状态的动作：登录成功与失败、会话轮换与失效、权限与归属校验失败、CSRF Token 与来源校验的结果、签名与 Nonce 的校验结果、幂等键冲突、限流触发、权限配置与密钥变更、批量读取与导出。字段至少包含主体、来源、目标资源、结果和关联的请求标识；跨服务时靠同一个请求标识把散落的记录串成一条链。

凭证原文不进入日志。完整 Cookie、Bearer Token、请求签名、密码、验证码和整个请求体都属于「记下来之后日志本身成为攻击目标」的内容，需要比对时记录摘要而不是原值。

写入方式也要按不可信输入处理：结构化字段逐条写入，字段值里的换行和分隔符要编码后再落盘。否则一个包含换行的昵称就能伪造出「另一条日志」，让后续分析建立在并不存在的记录上。

审计日志自身是高价值目标，需要独立的读取权限和最小化的写入路径，关键事件采用追加而不是修改，否则处置的第一步就是抹掉痕迹。

检测要看跨维度的组合，单一指标异常往往给不出结论：同一身份在短时间内跨大量不同资源标识读取；同一来源集中出现 403 与 404；登录失败率或验证码请求量突增；Nonce 重复与幂等冲突聚集；导出与批量接口的调用量结构发生变化。

处置顺序是先止血再查因：限制来源或接口、强制失效相关会话、撤销凭证、关闭触发问题的开关，之后再处理账号和补校验。这一步要保留取证窗口，直接清库或全量重置会让攻击路径无法还原。

复盘的结论要落到检查点上。一次越权读取说明归属校验缺失，只回滚代码、不补一条「用 B 的会话访问 A 的资源」的回归用例，下次仍然会被绕过。

## 实践建议

下面是按主题整理的落地清单，每项在前文都有对应的机制说明，这里只列要确认的动作。

### 输出与渲染

- 普通文本使用框架默认转义或 `textContent` 渲染；
- 富文本经过白名单清洗，清洗策略有测试和版本管理；
- URL、HTML 属性、JavaScript 和 CSS 使用对应上下文的安全 API；
- 没有把不可信数据放入事件处理器、动态脚本、`eval` 或危险 DOM API；
- 用户可控的跳转地址同时限制协议和域名，不放开到任意外部站点。

### 会话和身份

- 会话 Cookie 设置了 `Secure`、`HttpOnly` 和合适的 `SameSite`，`Domain` 没有无谓扩大；
- Session ID 在登录和权限变化后轮换，登出时服务端失效；
- 会话拥有服务端控制的空闲和绝对过期时间；
- Token 没有出现在 URL、日志、错误信息和客户端公开配置中；
- 自包含 Token 的签名算法由服务端配置决定，声明逐项校验，需要即时下线时有撤销机制。

### 越权与数据范围

- 每个接口在执行前确认主体、操作权限和资源归属，归属通过「可访问范围 + 标识」联合查询；
- 403 与 404 的口径统一，需要防枚举时把真实原因写进服务端日志；
- 更新使用字段白名单，请求体不直接展开进模型；
- 金额、库存、状态和角色由服务端读取并计算，前端提交值只用于对照；
- 响应只包含调用方需要的字段，脱敏在服务端完成；
- 越权用例进入回归测试，至少覆盖「用 B 的会话访问 A 的资源」。

### 接口防护

- GET、HEAD 和 OPTIONS 不产生业务副作用；
- 使用 Cookie 认证的写操作叠加 CSRF Token、SameSite 和来源校验；
- 缺少 Token、Origin 不可信或请求体格式错误时，在业务执行前拒绝；
- 需要跨源访问时使用明确的 CORS 白名单，不动态反射任意 Origin；
- 高价值服务间请求包含签名、时间戳和随机 Nonce，签名覆盖方法、路径、查询参数和请求体摘要；
- 时间窗口、Nonce 去重和签名比较在服务端完成，Nonce 检查具备原子性，浏览器代码不持有 HMAC 密钥；
- 可重试的业务操作支持幂等键，并校验相同幂等键对应的请求参数；
- 一次性链接绑定用途、有效期短，并在消费时原子标记为已使用。

### 服务端输入

- 外部数据默认按不可信内容处理，包括请求参数、路径、头部和已入库的历史数据；
- 查询走参数化接口，表名、列名和排序方向等结构位置用白名单映射；
- 命令以参数数组形式执行，不把外部数据拼进 shell 字符串；
- 外部数据进入递归合并前，按名字拒绝 `__proto__`、`prototype` 和 `constructor`；
- 服务端发起的请求使用出口白名单，按解析后的地址校验并限制重定向；
- 上传按内容校验类型与大小，使用随机文件名和非同源存储，下载头明确 `Content-Type` 与 `Content-Disposition`。

### 运行时与运维

- 页面、脚本、样式、图片和接口都通过 HTTPS 提供，HTTP 入口重定向到 HTTPS；
- 没有混合内容，客户端没有关闭证书校验；
- 启用 HSTS 的 `includeSubDomains` 或 preload 前，确认全部子域都能长期支持 HTTPS；
- HTML 响应配置了合适的 CSP 和 `frame-ancestors`，被嵌入的第三方页面只授予必要能力；
- API 明确返回正确的 `Content-Type`，敏感响应使用 `Cache-Control: no-store`，带身份的响应不被共享缓存；
- 生产响应不返回堆栈、SQL 语句和内部主机名，对外只给错误码与追踪标识；
- 登录、验证码和短信等入口按主体、来源和接口维度组合限流，锁定策略不会被打成拒绝服务；
- 分页有最大条数，深翻页改用游标，导出走异步任务，限流阈值有来自峰值速率或下游容量的依据；
- User-Agent、Referer 等线索只用于识别和分群，不作为放行依据；
- 记录登录、登出、会话轮换、CSRF 失败、签名失败、Nonce 重复和关键业务操作，不记录完整 Cookie、Bearer Token、请求签名和密码；
- 对连续的校验失败、异常来源和重复请求设置告警，日志结构化编码，避免攻击者通过输入伪造日志行；
- 审计日志有独立的读取权限和追加式写入，异常判定看跨维度的组合。
