# 技术正确性检查领域

## 前端基础

| 主题 | 检查要点 |
|------|---------|
| React 原理 | 渲染流程（Render → Reconcile → Commit）、Fiber 架构、Hooks 机制、并发模式 |
| Vue 原理 | 响应式系统（Proxy）、虚拟 DOM、编译优化、Composition API |
| 浏览器机制 | 事件循环（宏任务/微任务）、渲染管线（Layout → Paint → Composite）、V8 引擎 |
| CSS | 盒模型、Flex/Grid 布局、层叠上下文、BFC、选择器优先级 |
| 构建工具 | Vite（ESM + 预构建）、Webpack（Loader/Plugin）、Tree Shaking、Code Splitting |
| TypeScript | 类型系统、泛型、条件类型、类型守卫、声明文件 |

## AI Agent

| 主题 | 检查要点 |
|------|---------|
| Harness 组件 | Agentic Loop、工具系统、上下文管理、状态持久化、事件钩子、权限控制 |
| Agentic Loop | 推理 → 工具调用 → 结果回注 → 继续推理的循环机制 |
| 上下文管理 | token 窗口限制、自动压缩策略、关键信息重注入 |
| 权限模型 | allow/deny/ask 三级权限、细粒度控制 |
| LLM 原理 | Transformer、注意力机制、token 化、上下文窗口 |
| 工具系统 | 原子操作（读/写/执行/联网/编排）、组合涌现 |

## 后端/全栈

| 主题 | 检查要点 |
|------|---------|
| Node.js | 事件驱动、非阻塞 I/O、Stream、Cluster、Worker Threads |
| 数据库 | 索引优化、事务隔离级别、慢查询优化、连接池 |
| 缓存 | Redis 数据结构、缓存策略（旁路/读写穿透）、缓存雪崩/击穿/穿透 |
| 消息队列 | Kafka/RabbitMQ、消息确认、死信队列、幂等性 |
| 微服务 | 服务发现、熔断、限流、分布式事务（Saga/TCC） |
| Docker/K8s | 容器化、镜像分层、Pod、Service、Deployment |
| API 设计 | RESTful 规范、GraphQL、gRPC、版本控制、错误码 |

## 计算机基础

| 主题 | 检查要点 |
|------|---------|
| 设计模式 | 单例、工厂、观察者、策略、装饰器、代理模式 |
| 数据结构 | 数组、链表、栈、队列、哈希表、树、图、堆 |
| 算法 | 排序、搜索、动态规划、贪心、回溯、分治 |
| 网络协议 | HTTP/1.1/2/3、TCP 三次握手/四次挥手、WebSocket、HTTPS/TLS |
| 操作系统 | 进程/线程、内存管理、虚拟内存、文件系统、死锁 |
