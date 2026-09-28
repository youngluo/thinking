---
createdAt: '2026-09-21 12:25'
draft: true
---

# Node 的并发模型与高并发实践

「Node 是单线程的」这句话通常被听成两种结论。一种以为它一次只能处理一个请求，于是把并发的希望全押在多开进程或者 Worker 上；另一种以为异步能力由线程池的线程数决定，把池调大接口就能更快。前一种把「谁在执行 JS」和「谁在等待 I/O」当成了同一个问题，后一种找对了资源却估错了范围。

同一个 Node 进程可以同时挂着几千条 TCP 连接，而它的 JS 主线程在同一瞬间只执行一个函数。差别在于等待和计算落在谁身上，等待可以被交出去，计算只能占着主线程。这条分界线决定了接口能写多快、单进程能扛多少，也决定了压力上来之后该加什么限制。文中数值全部实测于 Node.js v22.21.0、本机回环环境，换版本换机器要用同样的方法重测。

## 单线程不等于没有并发

单线程说的是 JS 的执行。不创建 Worker 时，一个进程里只有一个线程在跑你的代码，同一时刻执行栈上只有一个函数。它不会因为并发请求变多而松动，反过来也保证了一段同步代码不会被另一段 JS 打断。

等待不在这条约束里。一个典型接口的耗时几乎都花在查库和调下游，主线程只做两件事，把请求交出去，以及在结果回来之后接着算。真正等的时候，socket 由内核照看，文件读写和域名解析由 libuv 线程池照看。所以对等待占大头的服务来说，并发不来自线程数，而来自「把等待交给外部，回调排队等主线程」。

代价在另一头，回调之间是串行的。一次大 JSON 解析、一次回溯严重的正则匹配、一个在循环里跑的纯 JS 加密计算，都会让这段时间内其它所有连接的回调一起等。

按「谁在执行」划分，能推进工作的资源大致分四类：

| 操作类型 | 谁在执行 | 代价与适用 |
| --- | --- | --- |
| 业务代码的同步执行 | JS 主线程 | 只放短任务 |
| 网络与数据库读写 | 操作系统，就绪后回调进入事件循环 | 不占主线程，等待为主的操作都走这里 |
| 文件读写、主机名解析 | libuv 线程池内的工作线程 | 排队等线程，线程数限制这一类的吞吐 |
| 长时间占用 CPU 的 JS | Worker 或子进程里另一个 V8 实例 | 多一份堆和一次通信，只为计算付这笔钱 |

## 线程池承担了什么

线程池不是 Node 执行异步 I/O 的主通道，它服务的是一小类内核没有提供异步接口的操作。libuv 文档给的范围是文件系统操作以及 `getaddrinfo`、`getnameinfo` 两类解析请求，默认 4 个线程，`UV_THREADPOOL_SIZE` 最大 1024。

这个值只在池创建时读取一次。启动前设置环境变量能生效，线程池已经建立之后再改 `process.env.UV_THREADPOOL_SIZE` 不起作用，实测改后 4 个派生任务仍按 4 线程并发。

对照实验很小：先发两个 `crypto.pbkdf2` 占住线程，再同时做一次 `fs.readFile` 和一次到本机 IP 的 HTTP 请求，各自打印耗时。

```text fold title="占住线程后的两个耗时"
$ node pool-starve.js
http 5ms
fs.readFile 6ms

$ UV_THREADPOOL_SIZE=1 node pool-starve.js
http 4ms
fs.readFile 85ms
```

线程只剩 1 个且被占住时，文件读取从个位数毫秒变成 85ms，走内核的 socket 读写不受影响。「libuv 池只有 4 个线程，所以 Node 最多同时处理 4 个异步 I/O」不成立，socket 读写不进这个池。唯一的例外是主机名解析，把请求目标从 IP 换成主机名再跑，这条请求也会掉到 90ms 量级，因为连接建立前要过一次 `dns.lookup`，而那一步在池里。

派生密钥、压缩这类有原生异步实现的任务同样进这个池，这一点是实测归因而非 libuv 文档的措辞，`zlib.gzip` 在线程被占满时从 9ms 等到 156ms。自己写的 JS 进不去，池里排的都是别人的活，一旦排队就会挤掉文件读写，4 个派生任务加 4 个小文件读取：

```text fold title="改池大小的输出"
pool=default(4)  总耗时 52ms，4 个文件读取都等到 51ms 才完成
pool=1           总耗时 177ms，派生任务依次 44/89/133/177ms
pool=8           总耗时 50ms，文件读取 1ms 完成，派生任务 49ms
```

默认 4 线程时，1ms 就能读完的小文件被挤到最后，因为线程全被派生任务占着。调大池的判据是文件读写、解析或压缩的耗时是否随并发上升，而不是「反正调大不吃亏」。

## Worker 与 Cluster

需要真并行时才动用第四类资源。Node 官方对 Worker Threads 的定位写得很直接，用于 CPU 密集的 JavaScript 运算，对 I/O 密集的活帮助不大，内置的异步 I/O 比 Worker 更有效；每个任务都新建 Worker 的话，创建开销很可能超过收益，这类用法应当池化。

所以「接口并发不够，加 Worker」这个答案在多数 Web 服务里是错的，等待型负载加 Worker 不改变等待的归属，只是多了一层通信和一份内存。

Worker 是同一个进程里的多个 V8 实例，各有各的堆和 GC，不共享普通 JS 对象，`postMessage` 按 HTML 结构化克隆传值，除了可转移的 `ArrayBuffer` 都是整份复制；只有 `SharedArrayBuffer` 是两边真正读写同一块内存，这也是 `worker_threads` 相对 `child_process` 和 `cluster` 的关键差别。

Cluster 用 `child_process.fork()` 创建子进程，把监听句柄在进程之间传递，多个进程因此共同监听同一个端口。它是多进程而不是多线程，内存不共享，崩溃半径彼此隔开，但真实分布可能很不均衡。工作进程退出后 Node 不会自动补，要监听 `exit` 事件自己再 `fork`；全部挂掉时现有连接被丢弃、新连接被拒绝。

选哪一种，看要并行的是 CPU 还是故障隔离，再看状态需要共享还是必须隔开。共享内存只有 Worker 能做，要隔开崩溃和堆上限则进程更合适，已经跑在按 CPU 伸缩的编排层里时，Cluster 的收益大多和水平扩展重叠。

## 与浏览器的事件循环

两边共有的只有「一个线程执行 JS，其它事情排在队列里等」这层抽象，机制不是一套。浏览器的循环由 HTML 规范定义，讲的是任务队列、微任务检查点和渲染机会；Node 的循环由 libuv 定义，讲的是阶段和 I/O 就绪。拿浏览器的名词去推 Node 的顺序会得出错误结论，反过来也一样。

Node 侧的阶段，官方按这个顺序说明：pending callbacks 处理推迟到下一轮的事件，例如 TCP 的系统错误；idle 和 prepare 仅供内部使用；poll 取出新的 I/O 事件并执行绝大多数 I/O 回调，没有事件就在这里阻塞；check 执行 `setImmediate`；close callbacks 处理关闭事件；timers 执行到期的 `setTimeout` 和 `setInterval`。这里有一条版本边界，从 libuv 1.45.0（Node.js 20）起，timers 在每一轮 poll 之后运行，此前在 poll 之前。那张把循环画成固定起点的环形图在新版本上已经不严格，值得记的是每条回调属于哪个队列，而不是阶段名的顺序。

顺序问题用实测回答更可靠。在模块顶层依次调用 `setTimeout(fn, 0)`、`setImmediate`、`queueMicrotask`、`process.nextTick` 和 `Promise.resolve().then`，再在 `fs.readFile` 的回调里重复一次 `setTimeout(fn, 0)` 和 `setImmediate`：

```text fold title="顺序实验的输出"
sync start
sync end
process.nextTick
queueMicrotask
promise.then
setTimeout(0)          ← 与 setImmediate 先后不定
setImmediate
--- 进入 I/O 回调 ---
setImmediate in I/O
setTimeout(0) in I/O
```

两件事被这段输出确定下来：`process.nextTick` 总是排在微任务之前，而 `setTimeout(0)` 和 `setImmediate` 在主模块里先后会变、一旦进入 I/O 回调就固定下来，因为 check 紧挨在 poll 之后。

`process.nextTick` 按官方说法技术上不属于事件循环，`nextTickQueue` 在当前操作完成后、事件循环继续之前清空，不管当时处在哪个阶段。风险也就在这里，递归调用它会让循环退不到 poll，I/O 因此饿死，实测把递归放到 200 万次，期间一次已经发起的 `fs.readFile` 回调始终没有执行。浏览器里同一层的问题是微任务队列清空前拿不到输入和绘制机会，两个宿主被饿死的东西不同。另外浏览器没有 `setImmediate`，也没有 `requestAnimationFrame` 这类和渲染帧对齐的机会。

## 一个接口怎么变快

机制到此为止，接下来是写法。单个接口变慢有四个原因，第一个来自依赖之间的等待方式。三个各需 80ms、彼此没有数据关系的下游调用：

```js fold title="并行依赖"
// 串行：实测 255ms
const user = await getUser(id);
const order = await getOrder(orderId);
const stock = await getStock(sku);

// 并行：实测 85ms
const [user, order, stock] = await Promise.all([
  getUser(id),
  getOrder(orderId),
  getStock(sku),
]);
```

串行把三段时间排成一队，并行只取最长那段。并行的前提是它们之间真的没有数据依赖，而且每个请求各自占用下游一个连接，扇出的并发要落进后面讲限制的那一节。

第二个原因是请求次数。循环里逐条取数据，就是把一次往返拆成 N 次，20 次逐个请求要 1643ms、在服务端留下 20 次新建连接，换成一个批量接口一次取回是 82ms、1 次连接。这个对照只算了往返，实验里批量接口和单条接口的后端同样花 80ms，真实批量会随条数变贵，能省的是那十几次往返。数据库上的对应形态是 N+1 查询，解法同样是把键收集起来一次 `IN`。

第三个原因是连接本身。v22 的 `http.globalAgent` 默认开着 keep-alive、空闲连接 5s 回收，但 `maxSockets` 默认是 `Infinity`，复用开着而并发不设限。绕开全局 agent（每请求 new 一个，或者传 `agent: false`）就退化成每次握手，300 次顺序请求，每次新建连接耗时 54ms、平均 179µs、服务端看到 300 条连接，复用后是 19ms、平均 65µs、1 条连接。省下的 114µs 一次，只在高频串行调用下游时才攒得出感觉，偶发请求无所谓；换到跨机房链路，每次握手还要多付一个往返。

第四个原因既拖慢接口又吃内存，是把整块数据读进来再处理。100MB 的文件用 `readFile` 一次读满，104857600 字节全落在堆上，这次大分配本身也占着主线程，随后的回收还要 GC 参与；换成 `pipeline(fs.createReadStream(FILE), transform, res)`，缓冲峰值是一个块的大小。并发会把差值放大成数量级，十个请求同时下载这个文件，前者要 1GB 堆，后者每个请求占用的缓冲只是一个高水位量级。

## Stream 背压与流错误

上一节的流式写法能不能真的护住内存，取决于背压有没有被接住。背压要处理的是生产比消费快，数据不会因为消费不过来而消失，只会堆在某个地方，在 Node 里那个地方通常是内存。

同一个生产量 12800KB（200 个 64KB 块）、可写端每块处理 2ms 的场景，`upstream` 是数据源、`res` 是响应对象，三种写法差别很大：

```js fold title="三种消费方式"
const { once } = require('node:events');

// 一：交给 pipe，背压由它处理
upstream.pipe(res);

// 二：异步迭代，但忽略 write() 的返回值
for await (const chunk of upstream) {
  res.write(chunk);
}
res.end();

// 三：异步迭代并尊重背压
for await (const chunk of upstream) {
  if (!res.write(chunk)) await once(res, 'drain');
}
res.end();
```

```text fold title="可写端 writableLength 峰值"
写法一  64KB
写法二  12800KB，即全部生产量
写法三  128KB
```

先弄清楚这条线的口径。`highWaterMark` 在普通流按字节计，`objectMode` 按对象个数计，处理字符串但不解码的流按 UTF-16 码元计。实测 v22.21.0 上普通流默认 65536，`objectMode` 默认 16，换版本要用 `stream.getDefaultHighWaterMark()` 读，不要照抄别人文章里的数。

`write()` 的返回值就是那条线上的信号，内部缓冲已经不小于 `highWaterMark` 时返回 `false`，此后应当停止写入，等到 `'drain'` 再继续。写法二没有接这个信号，全部生产量都堆进了内存，这是一个下载接口把机器吃光的典型过程。写法三的峰值比写法一多出一个块，两者都是在拿到 `false` 之后停手，这一档差值我没有继续拆开验证，只报数。

这几种写法背后是同一个握手，`pipe()` 和 `pipeline()` 做的事也就是把它交给运行时：

```d2
direction: right
producer: 生产者
buf: 可写缓冲
slow: 慢消费者

producer -> buf: 写入一个块
buf -> slow: 交给下游
slow -> buf: 消化后腾出空间
buf -> producer: 满时 false，腾空后 drain
```

`pipe()` 自带背压，但有一个官方写明的缺口，可读流出错时，作为目的地的可写流不会被自动关闭，链路上每个流都要手动关掉，否则就是泄漏。`pipeline()` 是默认选择，任意一环出错就销毁整条链并把错误交回给你，还能接 `AbortSignal`，信号中止时整条链以 `AbortError` 被销毁；用异步生成器作数据源时必须处理传进来的 `signal`，否则 pipeline 可能永远不结束。

`for await` 读流的边界是：中途 `break` 或者循环体抛错，源流都会被销毁、`destroyed` 变 `true`，但循环体抛出的错误只从 `for await` 抛出，不会作为 `'error'` 事件发给流的监听器，别指望两处错误处理共用一套。它和 `pipe()` 混用时同一份数据有两条消费路径，选一种。

流之外还有两条错误规则适用于所有异步代码。`try` 和 `catch` 只接得住同一调用栈里的同步抛出，回调和 Promise 在另一个任务里执行，栈早就断了；`EventEmitter` 和流上无人监听的 `'error'` 事件会抛出并让进程崩溃，实测一个 `destroy(err)` 之后没有 `error` 监听的流就是这样。至于错误会不会让整个进程死掉，那是进程级行为，放到最后一节说。

## 单进程的天花板

前面四类资源里，只有主线程会被你的代码占住，所以单进程能给多少吞吐，先看每个请求占它多久。同一个服务，每次请求要么在算要么在等，两种情况的曲线完全不同。把 handler 写成占用主线程 2ms 的纯计算，和写成等待 2ms 的异步调用，客户端并发从 1 加到 16，实测：

```text fold title="单进程逐级加压（每请求 2ms）"
            cpu：占主线程 2ms            io：等待 2ms
并发   吞吐   p50   ELU          并发   吞吐   p50   ELU
1      473    2.1   1.00         1      372    2.7   0.17
2      481    4.2   1.00         2      724    2.8   0.21
4      490    8.1   1.00         4     1437    2.8   0.23
8      488   16.3   1.00         8     2631    3.1   0.32
16     492   32.5   1.00        16     4541    3.6   0.45
```

单位是 req/s 和 ms，ELU 是事件循环占用比例。cpu 那一组，并发涨到 16 倍，吞吐只从 473 挪到 492，涨的全是延迟，p50 从 2.1ms 变成 32.5ms，ELU 一直是 1，整段测量里事件循环没有空闲；io 那一组吞吐跟着并发涨到 12 倍，延迟几乎没动。

单进程能给的吞吐大致是 `1000 / 每请求占主线程的毫秒数`，2ms 一档算出来 500，表里 cpu 那五行的 473 到 492 就是这条线。要抬高它有三条路：把每请求的 CPU 时间降下来，把计算挪去 Worker 或子进程，或者加实例；继续加客户端并发只会把排队变长。这组数字的前提是单核、本机回环、客户端不是瓶颈。

判断落点在哪一类资源上，`performance.eventLoopUtilization()` 给事件循环占用比例，`monitorEventLoopDelay()` 给回调延迟的分位数。前者要留意它挂在 `performance` 上，`perf_hooks` 顶层没有同名导出，实测是 `undefined`。占用接近饱和说明在算，减每请求 CPU 或者加实例；占用很低而耗时高说明在等，去看连接池和下游。

## 限制与退出

压力上来之后先崩的通常是下游。下游有 90% 的请求失败时，200 个用户请求经四次尝试打出 696 个真实请求，放大 3.5 倍，这波流量正好砸在已经出故障的服务上。两种策略的对照，到达量峰值按任意 100ms 窗口统计：

```text fold title="下游 90% 失败时的重试（200 个逻辑请求）"
无退避、固定重试到 4 次   83ms 完成   成功 68/200   下游 696 次（3.5 倍）   峰值 696 次/100ms
指数退避加 400ms 总时限   2881ms 完成   成功 99/200   下游 930 次（4.7 倍）   峰值 76 次/100ms
```

两组的总请求数由尝试次数上限决定，4 次对应 3.5 倍、6 次对应 4.7 倍，退避本身不减总量，它压低的是同一时刻打在下游的量，峰值从每 100ms 696 次降到 76 次，那一组整批只跑了 83ms，全部落在同一个窗口里，这正是要避开的形状。成功数从 68 涨到 99 说明这一轮下游确实在恢复，摊开重试给了它恢复的时间。两者都不能让故障消失，能做的只是别把压垮它的流量再放大几倍。重试还要求被重试的操作幂等，写操作要带幂等键，否则重试只是把重复扣款的机会交还给网络抖动。

入口这一侧并发要有顶，超了就排队，队排满要拒绝（快速失败或者 429）。三件事缺一不可，只设并发不设队列上限等于把内存堆积换个地方。这些数字都作用在单进程上，连接池的 `max` 是每个 Node 进程的上限，数据库实际承受的总量是实例数乘以它，下游并发上限同理。

超时要按链路顺序对齐。实测 v22.21.0 的默认值是 `keepAliveTimeout` 5000ms、`headersTimeout` 60000ms、`requestTimeout` 300000ms、`server.timeout` 0，这些默认值随版本变，别把 5000 当常量。空闲连接的关闭时机两边各算各的，只要贴近就会出现竞态，一方准备复用这条连接、另一方已经把它关掉，表现是偶发的 `ECONNRESET`。Node 自己留了余地，`keepAliveTimeoutBuffer` 实测默认 1000ms，文档写着它把 socket 的实际超时加到对外宣告的 keep-alive 时间之外，就是为了减少这类 reset。代理侧的空闲时间要比 Node 大还是小，取决于代理怎么维护连接池，这一条要按你的部署核对。

取消要传递，请求生命周期上的 `AbortSignal` 应当一路带到流、下游请求和排队任务里，否则客户端早断开、服务端还在替它算。

限制都设好之后，进程级的错误行为决定它是慢慢退化还是当场死掉。未捕获异常的默认行为是打印堆栈并以退出码 1 结束，注册 `uncaughtException` 会覆盖这个默认行为，实测进程可以继续活到下一个定时器回调、退出码变成 0，但官方明确写了这种状态下恢复运行并不安全，handler 里只做同步收尾然后退出。要上报又不想改变崩溃行为，挂在 `uncaughtExceptionMonitor` 上。未被处理的 Promise rejection 默认按未捕获异常处理，实测退出码同样是 1。

然后是让进程正常退出去。句柄（handle）和请求（request）都会让事件循环保持存活，实测进程里一个句柄都没有、只剩一个未完成的压缩任务时，它也会等 436ms 把任务跑完再退。区别在于请求完成就消失，句柄不会自己消失，没 `clear` 的 `setInterval`、没 `close` 的 server、数据库连接池、还在运行的 Worker 会一直把进程留住，所以「进程为什么不退出」要查的是句柄。一个仍在运行的 Worker 会让父进程在代码跑完后继续存活，`terminate()` 之后立刻退出，本仓库的 D2 预渲染插件就是为此显式终止那个常驻 worker。`unref()` 能让句柄不再阻止退出，适合心跳和纯打点的定时器，代价是回调可能永远等不到执行。

```js fold title="graceful-shutdown.js"
const http = require('node:http');
const { once } = require('node:events');

const server = http.createServer(handler);

process.on('SIGTERM', async () => {
  server.close(() => console.log('在途请求已完成'));

  // 给在途请求一个上限，超时后强制关连接；unref 让这个定时器不反过来拖住退出
  const force = setTimeout(() => {
    console.log('在途请求超时，强制关闭');
    server.closeAllConnections();
  }, 10_000);
  force.unref();

  await once(server, 'close');
  clearTimeout(force);
  await db.end(); // 连接池同样是要释放的句柄
  process.exitCode = 0;
});

server.listen(3000);
```

`handler` 和 `db` 留给具体的服务，两条退出路径都实测过，在途请求能在 10s 内跑完时按顺序收尾，跑不完时先强制关闭再关连接池。`server.close()` 停止接受新连接并关掉空闲连接，从 v19.0.0 起它在返回前就关掉空闲连接，不必再配 `closeIdleConnections()`；`closeAllConnections()` 关闭正在传输的连接，但不会销毁已经升级到其它协议的 socket，WebSocket 要自己管，两者一起用时官方建议先 `close()` 再 `closeAllConnections()`。

收尾不要用 `process.exit()`，它会丢弃尚未完成的异步操作，实测一次输出 2000000 字符的 `console.log` 在它之后经管道只落到 65536 字节，不调用时字节数完整。改用 `process.exitCode`，让事件循环把在途的响应写完再退。
