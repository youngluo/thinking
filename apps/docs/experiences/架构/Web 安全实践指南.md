---
createdAt: '2026-09-03 11:38'
draft: true
---

# Web 安全实践指南

Web 安全需要覆盖从浏览器发起请求到服务端完成业务处理的全过程。浏览器会根据 Cookie 属性自动附带符合条件的 Cookie，也会按照 HTML、JavaScript、CSS 或 URL 的规则解析服务端返回的内容；服务端除了识别请求身份，还要判断这个身份是否有权执行当前操作、请求是否来自预期来源，以及请求是否仍然有效。

这些边界一旦处理不当，不可信数据就可能被当成代码执行，跨站请求可能被误认为是用户操作，旧请求可能被重复接受，已通过身份认证的用户也可能执行超出权限范围的操作。因此，选择防护方案时，应先明确要解决的安全问题，再分析攻击成立的条件和方案能够覆盖的范围，据此选择合适的机制。

## 安全基础

### 安全目标

评估一个请求的安全性，至少要确认下面五件事：

| 安全目标 | 要回答的问题 | 常见手段 |
| --- | --- | --- |
| 机密性 | 不应看到数据的人能否读到它 | HTTPS、TLS、访问控制、敏感数据脱敏 |
| 完整性 | 数据在传输或处理过程中能否被悄悄修改 | TLS、请求签名、服务端校验 |
| 身份认证 | 当前请求由谁发出 | Session、Cookie、Access Token、客户端证书 |
| 授权 | 这个身份是否有权执行当前操作 | 服务端权限校验、资源归属校验 |
| 新鲜性 | 这是不是当前请求，而不是旧请求的重复提交 | 时间戳、Nonce、防重放缓存、幂等键 |

这些目标相互关联，但不能互相替代。HTTPS 可以保护传输过程中的机密性和完整性，不能替代身份认证或业务权限校验；有效的登录态可以帮助服务端确认请求属于哪个用户，但不能说明该用户是否有权修改当前资源。

### 同源策略

同源策略根据协议、主机和端口判断两个页面是否同源，主要限制一个源的脚本读取另一个源的响应，不等于服务端的身份认证和授权。它会限制跨源脚本访问对方页面的 DOM，按 Origin 隔离 Web Storage 和 IndexedDB，并要求 <code>fetch</code> 或 <code>XMLHttpRequest</code> 获取跨源响应时由目标服务端通过 CORS 明确允许。Cookie 使用独立的域和路径匹配规则，脚本能否读取还受 <code>HttpOnly</code> 等属性影响。

跨源写入和资源嵌入在很多场景下仍然允许，例如链接、表单、图片和 <code>iframe</code>。这类能力本身不等于 XSS，是否产生脚本执行还取决于资源类型、执行上下文和页面的安全策略。

### 跨文档通信

同源策略限制不同源页面的直接访问；当页面确实需要通信时，不同源的窗口或 <code>iframe</code> 可以通过 <code>window.postMessage</code> 建立受控的跨文档消息通道。发送方应指定准确的 <code>targetOrigin</code>；接收方应校验 <code>event.origin</code>、必要时校验 <code>event.source</code>，并检查 <code>event.data</code> 的结构。不要使用 <code>*</code> 传递敏感数据，也不要把消息类型当作身份认证。

### 接口安全

浏览器会根据域名、路径和 Cookie 属性自动附加符合条件的 Cookie；通过 <code>Authorization</code> 头发送的 Token 通常需要前端 JavaScript 显式设置。Cookie 鉴权需要防御 CSRF，Authorization Token 则需要控制存储并降低 XSS 的影响。无论采用哪种方式，服务端都必须完成身份认证和授权校验。

状态变更请求通常需要经过多项安全检查。下面的流程图按职责展示这些检查的先后关系，并不要求所有接口都采用同一种认证方式。

```d2
direction: right

request: 客户端请求
tls: HTTPS / TLS
origin: Origin / CSRF 校验
auth: 身份认证
permission: 权限与资源归属
freshness: 时间戳、Nonce、签名
idempotency: 幂等与重复提交
business: 业务执行

request -> tls -> origin -> auth -> permission -> freshness -> idempotency -> business
```

## XSS

### 攻击类型与根因

XSS（Cross-Site Scripting，跨站脚本攻击）指攻击者控制的数据被浏览器当成 HTML、JavaScript、CSS 或可执行 URL 解析，最终在受害者的页面上下文中执行。

根因不是某个特殊字符串，而是应用把「不可信数据」放进了不适合它的解析上下文。例如，普通评论应该作为文本显示，却被拼接到 <code>innerHTML</code>；用户提供的 URL 应该是链接地址，却没有限制协议，最终被当成脚本地址。

常见类型如下：

| 类型 | 数据从哪里进入 | 典型场景 |
| --- | --- | --- |
| 反射型 XSS | 当前请求参数 | 搜索关键词被服务端直接回显到 HTML |
| 存储型 XSS | 数据库或缓存 | 恶意评论、昵称或公告被保存后展示给其它用户 |
| DOM 型 XSS | 浏览器端 URL、Storage 或消息 | 前端把 <code>location.hash</code> 直接写入 HTML |

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

<code>dangerouslySetInnerHTML</code>、<code>v-html</code>、<code>innerHTML</code>、<code>outerHTML</code> 和 <code>document.write</code> 等 API 会改变默认的文本语义。只有在确实需要渲染富文本时，才允许使用它们。

HTML、HTML 属性、JavaScript、CSS 和 URL 使用不同的解析规则，不能用一个「统一转义函数」覆盖所有场景：

- HTML 文本使用 HTML 实体编码；
- HTML 属性使用属性编码，并始终使用引号包裹属性值；
- URL 参数使用 URL 编码，并对完整 URL 做协议和域名白名单校验；
- 不要把不可信数据直接放入 <code>&lt;script&gt;</code>、事件处理器、CSS 代码或动态代码执行 API；
- 能不用动态拼接就不用动态拼接，优先通过 DOM 属性或框架属性传值。

例如，用户控制的跳转地址应先限制协议，再交给 <code>URL</code> 解析，而不是直接拼接到 <code>href</code>：

```ts fold
function getSafeUrl(input: string) {
  const url = new URL(input, 'https://example.com')

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return '/invalid-link'
  }

  return url.toString()
}
```

上面的示例只限制了协议。是否允许外部域名，还要根据业务需要增加域名白名单。安全 URL 校验应该发生在最终使用位置附近，避免数据在多个上下文之间流转后失去语义。

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

清洗配置需要和产品实际支持的富文本能力一起维护。放开 <code>style</code>、事件属性、任意 URL 协议或复杂 SVG 时，应重新评估攻击面。

### CSP 纵深防御

CSP（Content Security Policy）通过响应头限制页面可以加载和执行的资源。可以先从下面的最小策略开始，再按真实资源补充：

```http fold
Content-Security-Policy: default-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```

<code>connect-src</code> 限制 <code>fetch</code>、<code>XMLHttpRequest</code>、WebSocket 等脚本连接目标；<code>form-action</code> 限制表单提交目标。<code>connect-src</code> 在未单独设置时可以使用 <code>default-src</code> 作为兜底，但 <code>form-action</code> 不会继承 <code>default-src</code>，需要限制表单提交目标时应显式配置。

CSP 的策略需要先通过 <code>Content-Security-Policy-Report-Only</code> 观察违规报告，再切换为强制策略。不要为了让旧代码快速运行就长期加入 <code>unsafe-inline</code> 或 <code>unsafe-eval</code>。

CSP 不能替代输出编码和 HTML 清洗。它可能因为浏览器兼容性、策略配置错误或允许的资源过多而无法阻止所有 XSS。<code>HttpOnly</code> 也只是阻止页面脚本直接读取某个 Cookie，不能阻止 XSS 以当前用户身份发起请求或读取页面中的其它敏感数据。

## CSRF

### 攻击条件

CSRF（Cross-Site Request Forgery，跨站请求伪造）利用的是浏览器会自动携带 Cookie。攻击者诱导已经登录的用户访问恶意页面，恶意页面再向目标站点发起修改资料、创建订单或转账等请求。目标服务端看到的是有效的登录 Cookie，因此可能把请求当成用户主动操作。

同源策略通常会阻止恶意页面读取跨源响应，但不一定阻止它发起一个请求。CSRF 的核心风险是「请求被执行」，而不是「攻击者能否看到响应」。

一次使用 Cookie 鉴权的状态变更请求可以抽象为：

```http fold
POST /api/profile/email HTTP/1.1
Host: app.example.com
Cookie: __Host-session=opaque-session-id
Content-Type: application/x-www-form-urlencoded

email=new-address@example.com
```

如果服务端只依赖 Cookie，没有校验请求是否来自自己的页面，攻击者就可能构造类似请求。状态变更不能使用 GET，因为 GET 请求很容易被链接、图片、预加载和爬虫触发。

防护可以叠加 CSRF Token、SameSite Cookie 和来源校验，具体组合取决于会话方式、跨站需求和接口风险。

### CSRF Token

服务端可以为当前会话生成不可预测的 Token，并要求所有状态变更请求通过隐藏字段或自定义请求头携带它。攻击者可以让浏览器带上 Cookie，但通常无法读取同源页面中的 Token：

```ts fold
async function updateProfile(
  input: { email: string },
  csrfToken: string
) {
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

如果使用自定义请求头，浏览器跨源脚本通常需要先通过 CORS 预检。服务端仍应执行显式校验，不能把「浏览器会预检」当成唯一安全边界，因为非浏览器客户端不受这条浏览器规则约束。

### 来源校验

对于状态变更请求，服务端可以优先校验 <code>Origin</code>，必要时再根据兼容性策略检查 <code>Referer</code>。校验必须是完整的源匹配，不能使用简单的字符串包含判断：

```ts fold
const trustedOrigins = new Set([
  'https://app.example.com',
])

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

### CSRF 与 CORS

CORS 决定浏览器脚本能否读取跨源响应，CSRF 防御决定状态变更请求是否可信。即使 CORS 配置为空，跨站表单仍可能发起「简单请求」；即使 CORS 配置正确，也不能替代 Token、SameSite 和 Origin 校验。

## 会话管理

### Cookie 属性

Cookie 常被用作会话凭证，服务端可以这样设置：

```http fold
Set-Cookie: __Host-session=opaque-random-value; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1800
```

Cookie 共享只表示浏览器在发送 HTTP 请求时，按照匹配规则自动附加 Cookie。它不会让两个站点变成同源，也不会赋予页面脚本访问对方 Origin 的 DOM、Storage 或接口响应的权限。Origin 由协议、主机和端口决定，因此 <code>app.example.com</code> 与 <code>api.example.com</code> 仍然是跨 Origin 的；Cookie 则使用独立的 <code>Domain</code> 和 <code>Path</code> 规则。未设置 <code>Domain</code> 时，Cookie 只发送给设置它的主机；设置 <code>Domain=example.com</code> 后，才会发送给 <code>example.com</code> 及其子域。对于完全不同的域名，Cookie 不能由一方设置给另一方。

如果共享 Cookie 没有设置 <code>HttpOnly</code>，符合 <code>Domain</code> 范围的页面脚本仍可能通过 <code>document.cookie</code> 读取它；设置 <code>HttpOnly</code> 只能阻止脚本读取，不能阻止浏览器在请求中携带 Cookie。因此，共享 Cookie 同时扩大了子域之间的信任范围，需要结合子域隔离、XSS 防护和 CSRF 防护一起评估。

<code>SameSite</code> 控制 Cookie 是否随跨站请求发送：

- <code>Strict</code> 限制最强，但可能影响从外部站点进入后立即保持登录态的体验；
- <code>Lax</code> 对常见的跨站顶级导航更宽松，适合许多普通站点，但不能覆盖所有业务风险；
- <code>None</code> 允许跨站发送，必须同时设置 <code>Secure</code>，通常只在确实需要跨站 Cookie 时使用。

<code>SameSite</code> 中的 Site 与 <code>Origin</code> 不是同一概念。Origin 由协议、主机和端口决定；Site 通常由协议和可注册域名决定，因此同一注册域下的不同子域可能同站但不同源。SameSite 是重要的纵深防御，但不应在所有部署条件下作为唯一防线。共享注册域、旧浏览器、跨站业务和错误的 GET 副作用都可能留下风险，高风险状态变更仍应结合 Token 或来源校验。

在 <code>fetch</code> 等跨源请求中，是否发送 Cookie 还取决于请求的 <code>credentials</code> 模式和 <code>SameSite</code> 等属性；CORS 主要控制脚本能否读取响应，不会改变 Cookie 的域匹配规则。Cookie 的发送不按端口区分，因此 <code>Domain</code> 范围越大，受信任的子域越多，不需要共享时应省略它。

各属性的职责如下：

| 属性 | 作用 | 注意事项 |
| --- | --- | --- |
| <code>Secure</code> | 只通过 HTTPS 发送 | 不能防止 XSS；开发环境也应尽量使用 HTTPS |
| <code>HttpOnly</code> | 禁止页面脚本通过 <code>document.cookie</code> 读取 | 不能阻止 XSS 使用当前会话发起请求 |
| <code>SameSite</code> | 限制跨站请求是否携带 Cookie | 是 CSRF 的一层防护，不等于完整 CSRF 方案 |
| <code>Domain</code> | 控制哪些主机可以接收 Cookie | 范围越大，受影响的子域越多；不需要时不要设置 |
| <code>Path</code> | 限制请求路径 | 是 Cookie 发送范围，不应当被当作完整的权限边界 |
| <code>Max-Age/Expires</code> | 控制有效期 | 服务端还需要维护 idle timeout、绝对过期和主动失效 |

<code>__Host-</code> 前缀要求 Cookie 使用 <code>Secure</code>、<code>Path=/</code>，且不能设置 <code>Domain</code>，因此不能用于子域共享，适合减少域和路径配置错误。需要共享时应使用普通 Cookie 名称，并重新评估子域之间的信任边界。会话值应是由密码学安全随机数生成器产生的不可预测的不透明值，不要把密码、权限规则或其它敏感信息直接放进 Cookie。

### 会话生命周期

服务端至少需要处理下面几个时机：

- 登录成功、提升权限、修改密码或发生高风险事件后重新认证或轮换 Session ID，避免会话固定；
- 登出时让服务端会话失效，不能只清除浏览器 Cookie；
- 同时设置空闲超时和绝对超时；
- 记录登录、轮换、失效、异常 Token 和关键操作，日志中不要写入完整 Cookie、Token 或签名密钥。

会话 ID 出现在 URL 中会进入浏览器历史、Referer、代理日志和服务器日志，因此不应使用 URL 参数传递登录态。

### Cookie 与 Token

HttpOnly Cookie 可以降低 Token 被 XSS 直接读取和批量外带的风险，但 Cookie 鉴权需要配合 CSRF 防护。放在 <code>Authorization</code> 头中的 Bearer Token 不会被浏览器自动附加到普通跨站请求，因此通常不受传统 Cookie 型 CSRF 影响，但前端需要访问 Token，XSS 一旦发生就可能直接窃取它。

<code>localStorage</code> 中的长期 Token 可以被同源页面脚本读取。它不是绝对禁止使用的存储，但不适合在没有充分 XSS 防护和短期轮换机制的情况下保存高价值长期凭证。更稳妥的方案通常是短期 Access Token 配合服务端管理的 Refresh Token，或由 BFF 使用 HttpOnly Cookie 维护浏览器会话。

无论选择哪种方式，服务端都必须重新校验：

- Token 是否有效、是否过期；
- 签发者、受众和用途是否匹配；
- 当前用户是否有权操作目标资源；
- 会话是否已经登出、撤销或进入风险状态。

## 通信安全

### HTTPS 与 TLS

HTTPS 是 HTTP 运行在 TLS 上的结果。TLS 主要提供三项能力：

- 加密，避免传输内容被旁路观察；
- 完整性校验，发现传输中的篡改；
- 服务端身份认证，浏览器通过证书验证连接的主机。

部署时应让页面和所有子资源都使用 HTTPS。HTTP 入口可以重定向到对应的 HTTPS 地址，但不能把「重定向」误认为完整防护，因为第一次 HTTP 连接仍可能被中间人干扰。可以通过 HSTS 让浏览器在后续访问中直接使用 HTTPS：

```http fold
HTTP/1.1 301 Moved Permanently
Location: https://app.example.com/account
```

```http fold
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

HSTS 响应头只会在 HTTPS 响应中生效。确认域名及其子域都支持 HTTPS 后，再逐步扩大 <code>max-age</code> 和 <code>includeSubDomains</code>。服务端不能关闭证书校验，也不应在客户端通过「忽略证书错误」解决问题。

### CORS

CORS（Cross-Origin Resource Sharing）是一组 HTTP 响应头，用于告诉浏览器哪些 Origin 可以读取当前响应。它不是服务端授权系统，也不阻止非浏览器客户端直接调用接口。

需要允许凭据的跨源请求时，应使用明确的 Origin 白名单：

```http fold
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE
Access-Control-Allow-Headers: Content-Type, X-CSRF-Token
Vary: Origin
```

不要把用户提交的 <code>Origin</code> 原样回显到 <code>Access-Control-Allow-Origin</code>，也不要在允许凭据时使用 <code>*</code>。如果接口是公开且不携带凭据的资源，才可以根据业务需要使用 <code>Access-Control-Allow-Origin: *</code>。

浏览器会对某些跨源请求先发送 <code>OPTIONS</code> 预检，服务端需要校验请求源、方法和请求头，并只允许实际需要的范围。CORS 失败时，浏览器脚本通常只能看到请求失败；服务端仍应照常执行身份认证、授权和输入校验。

### 安全响应头

安全响应头的作用是让浏览器采用更严格的默认行为，但它们不是服务端业务安全的替代品：

| 响应头 | 常见用途 | 边界 |
| --- | --- | --- |
| <code>Content-Security-Policy</code> | 限制脚本、资源和嵌入来源 | 不能替代输出编码和 HTML 清洗 |
| <code>Content-Security-Policy: frame-ancestors 'none'</code> | 防止页面被嵌入，降低点击劫持风险 | 需要根据产品是否允许嵌入来配置 |
| <code>X-Content-Type-Options: nosniff</code> | 禁止浏览器猜测响应 MIME 类型 | 不能修复错误的响应内容 |
| <code>Referrer-Policy</code> | 限制 Referer 泄露范围 | 不应把 Token 放在 URL 中 |
| <code>Strict-Transport-Security</code> | 后续访问强制使用 HTTPS | 首次访问和过期前仍需考虑部署策略 |
| <code>Cache-Control: no-store</code> | 防止敏感响应被缓存 | 只影响缓存，不等于访问控制 |
| <code>X-Frame-Options: DENY</code> | 为旧浏览器提供禁止嵌入的兼容控制 | 现代页面优先使用 CSP 的 <code>frame-ancestors</code> |

对于 API 响应，还应明确设置正确的 <code>Content-Type</code>，避免浏览器将返回内容误判为可执行 HTML 或 JavaScript。

## 请求签名与防重放

### HTTPS 的能力边界

HTTPS 保护的是传输通道。它能降低网络监听者读取和修改请求的风险，但不会自动给业务请求增加「一次性」语义。如果攻击者从被盗的客户端、应用日志、错误的代理记录或其它应用层位置获得了一份有效请求，就可能尝试再次提交。

防重放要解决的是新鲜性问题。服务端需要知道请求是不是在允许时间窗口内生成的，以及这个请求标识是否已经被使用过。

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
import {
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto'

function hashBody(body: string) {
  return createHash('sha256')
    .update(body)
    .digest('base64url')
}

function canonicalQuery(url: URL) {
  return [...url.searchParams.entries()]
    .sort(([firstKey, firstValue], [secondKey, secondValue]) => {
      return firstKey.localeCompare(secondKey) ||
        firstValue.localeCompare(secondValue)
    })
    .map(([key, value]) => {
      return encodeURIComponent(key) + '=' + encodeURIComponent(value)
    })
    .join('&')
}

function buildCanonicalRequest(
  method: string,
  url: URL,
  body: string,
  timestamp: string,
  nonce: string
) {
  return [
    method.toUpperCase(),
    url.pathname,
    canonicalQuery(url),
    hashBody(body),
    timestamp,
    nonce,
  ].join('\n')
}

function signRequest(
  secret: string,
  method: string,
  url: URL,
  body: string,
  timestamp: string,
  nonce = randomBytes(16).toString('hex')
) {
  const canonical = buildCanonicalRequest(
    method,
    url,
    body,
    timestamp,
    nonce
  )

  const signature = createHmac('sha256', secret)
    .update(canonical)
    .digest('base64url')

  return { nonce, signature }
}
```

生产实现需要固定规范化规则，包括重复查询参数的排序、空值处理、路径编码、请求体原文和字符集。客户端与服务端必须使用同一套规则，否则合法请求也会因为签名材料不同而失败。

HMAC 密钥必须只存在于受信任的服务端或 BFF，不能放在浏览器 JavaScript、网页源码或公开配置中。浏览器端应该使用自己的会话和 CSRF 防护访问 BFF，由 BFF 使用服务端密钥签名下游请求。

### 服务端校验顺序

服务端收到签名请求后，可以按下面的顺序处理：

1. 根据 <code>X-Key-Id</code> 查找密钥、调用方和允许访问的资源；
2. 解析时间戳，拒绝超出允许漂移窗口的请求，例如五分钟之外的请求；
3. 使用请求体原文、规范化 URL 和收到的请求方法重新构造签名材料；
4. 使用常量时间比较验证签名，避免因为比较过程泄露信息；
5. 以原子操作写入 <code>Nonce</code>，并设置略大于时间窗口的 TTL。写入失败说明 Nonce 已经使用过，应拒绝请求；
6. 通过身份认证、权限校验和幂等处理后，才执行实际业务。

时间戳只能缩短旧请求的有效时间，不能阻止攻击者在窗口内重复发送；Nonce 能识别重复请求，但必须在服务端保存并原子检查；签名能证明请求内容没有被篡改，却不能证明请求是新的。三者解决不同问题，通常需要组合使用。

防重放缓存需要考虑分布式部署。所有接收请求的实例必须共享缓存或使用具备原子去重能力的存储，不能只在单个进程的内存中记录 Nonce。

## 幂等与重复提交

### 幂等语义

网络超时并不代表服务端没有执行成功。客户端可能在没有收到响应时重试，用户也可能连续点击提交按钮。对于创建订单、支付、发放优惠券等操作，如果每次请求都直接执行，可能产生重复业务结果。

幂等处理关注的是「同一个业务意图重复提交时只产生一个结果」，它和防重放、身份认证不是同一个概念：

- 防重放通常拒绝重复的请求标识；
- 幂等允许网络重试，并返回第一次处理的结果；
- 签名验证调用方和请求内容是否可信；
- 鉴权验证请求属于谁，授权验证是否允许操作。

### Idempotency-Key

客户端为一次业务操作生成一个随机幂等键，并在重试时复用同一个值：

```http fold
POST /api/orders HTTP/1.1
Authorization: Bearer access-token
Idempotency-Key: 8c4c7b2e-...
Content-Type: application/json

{"productId":"p-100","quantity":1}
```

服务端应将幂等键绑定到当前用户、接口和请求参数摘要，避免不同用户之间意外共享，也避免同一个键被用于不同业务参数：

```ts fold
import { createHash } from 'node:crypto'

async function createOrder(request: Request, userId: string) {
  const key = request.headers.get('idempotency-key')

  if (!key) {
    throw new HttpError(400, 'Idempotency-Key is required')
  }

  const bodyText = await request.text()
  const requestHash = createHash('sha256')
    .update(bodyText)
    .digest('base64url')
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

上面的 <code>reserve</code> 必须具备原子性，避免两个并发请求同时发现「还没有记录」并重复执行业务。实际项目还需要定义处理中、失败、超时和记录过期时的行为。支付或订单这类高价值操作通常应把幂等记录和业务写入放进同一个可靠的事务边界。

幂等键不能替代鉴权和授权。服务端必须先确认当前用户是谁、是否有权创建订单，再查找或写入对应的幂等记录。

## 实践建议

实际应用时，可以从下面几个方面着手：

### 输入和输出

- 所有用户输入都被当作不可信数据处理；
- 普通文本使用框架默认转义或 <code>textContent</code> 渲染；
- 富文本经过白名单清洗，清洗策略有测试和版本管理；
- URL、HTML 属性、JavaScript 和 CSS 使用对应上下文的安全 API；
- 没有把不可信数据放入事件处理器、动态脚本、<code>eval</code> 或危险 DOM API。

### 会话和身份

- 会话 Cookie 设置了 <code>Secure</code>、<code>HttpOnly</code> 和合适的 <code>SameSite</code>；
- Session ID 在登录和权限变化后轮换，登出时服务端失效；
- 会话拥有服务端控制的空闲和绝对过期时间；
- Token 没有出现在 URL、日志、错误信息和客户端公开配置中；
- 每个接口都同时执行身份认证、权限和资源归属校验。

### 状态变更接口

- GET、HEAD 和 OPTIONS 不产生业务副作用；
- Cookie 鉴权的写操作使用 CSRF Token、SameSite 和来源校验的组合；
- 缺少 Token、Origin 不可信或请求体格式错误时，在业务执行前拒绝；
- 需要跨源访问时使用明确的 CORS 白名单，不动态反射任意 Origin。

### 传输和响应头

- 页面、脚本、样式、图片和接口都通过 HTTPS 提供；
- HTTP 入口正确重定向到 HTTPS，并在确认部署条件后启用 HSTS；
- 没有混合内容，客户端没有关闭证书校验；
- HTML 响应配置了合适的 CSP 和 <code>frame-ancestors</code>；
- API 明确返回正确的 <code>Content-Type</code>，敏感响应使用 <code>Cache-Control: no-store</code>。

### 防重放和幂等

- 高价值服务间请求包含签名、时间戳和随机 Nonce；
- 签名覆盖方法、路径、查询参数和请求体摘要；
- 时间窗口、Nonce 去重和签名比较在服务端完成，Nonce 检查具备原子性；
- 浏览器代码没有持有服务端 HMAC 密钥；
- 可重试的业务操作支持幂等键，并校验相同幂等键对应的请求参数。

### 日志和监控

- 记录登录、登出、会话轮换、CSRF 失败、签名失败、Nonce 重复和关键业务操作；
- 日志中不记录完整 Cookie、Bearer Token、请求签名和密码；
- 对连续的校验失败、异常来源和重复请求设置告警或限流；
- 安全日志经过结构化编码，避免攻击者通过输入伪造日志行。
