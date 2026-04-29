# Harness Engineering

## 什么是 Harness Engineering

一句话定义：Harness Engineering = 包裹 LLM 的运行时基础设施。包含管理工具调度、上下文工程、安全执行、状态持久化、会话连续性等，LLM 只负责推理决策，其余全是 Harness 的事情。

Agent = Model + Harness

```mermaid
%%{init: {'themeVariables': {'lineColor': '#7fa3ff'}}}%%
graph TD
    subgraph U ["你"]
        A1["输入意图 / 审批权限 / 观察结果"]
    end

    subgraph H ["Harness Engineering"]
        B1["Agentic Loop"]
        B2["Tools"]
        B3["Context"]
        B4["Memory"]
        B5["Hooks"]
        B6["Permissions"]
    end

    subgraph L ["LLM"]
        C1["只负责推理决策，其余全是 Harness 的事"]
    end

    U -.-> H
    H -.-> L

    style U fill:#7fa3ff29,stroke:#07f,stroke-width:1px,rx:4,ry:4
    style H fill:#fffaf0,stroke:#ffa500,stroke-width:2px,stroke-dasharray:5,5,rx:4,ry:4
    style L fill:#7fa3ff29,stroke:#07f,stroke-width:1px,rx:4,ry:4
    style B1 fill:#ffe0b2,stroke:none,color:#bf360c,rx:4,ry:4
    style B2 fill:#bbdefb,stroke:none,color:#0d47a1,rx:4,ry:4
    style B3 fill:#c8e6c9,stroke:none,color:#1b5e20,rx:4,ry:4
    style B4 fill:#e1bee7,stroke:none,color:#4a148c,rx:4,ry:4
    style B5 fill:#b2ebf2,stroke:none,color:#006064,rx:4,ry:4
    style B6 fill:#ffcdd2,stroke:none,color:#b71c1c,rx:4,ry:4

    classDef note fill:none,stroke:none,color:#333,font-size:13px

    class A1 note;
    class C1 note;
```

## Harness 六大核心组件

| 组件         | 职责                                                     | 不做会怎样                         |
| ------------ | -------------------------------------------------------- | ---------------------------------- |
| Agentic Loop | 推理 → 工具 → 回注 → 继续推理的核心循环                  | 模型只能回答一次，无法完成复杂任务 |
| 工具系统     | Read/Write/Bash/Grep 等原子操作                          | 模型只会说，不会做                 |
| 上下文管理   | 自动压缩 + 关键信息重注入                                | 长任务 token 爆炸或遗忘关键信息    |
| 状态持久化   | 对话历史、工具结果、会话恢复                             | 断线重连后从头开始                 |
| 事件钩子     | 工具执行前后的自动化拦截                                 | 无法实现自动校验、自动通知         |
| 权限控制     | allow/deny/ask 细粒度控制 Agent 执行危险操作（rm -rf /） | 无法控制危险操作                   |

### Agentic Loop

```mermaid
%%{init: {'themeVariables': {'lineColor': '#7fa3ff'}}}%%
flowchart LR
    A[开始]:::start

    subgraph LOOP[核心循环]
        B[接收输入（prompt + 上下文）]:::step1
        C[LLM 推理 → 生成响应/工具调用]:::step2
        D[执行工具 → 收集结果]:::step3
        E{检查是否完成}:::decision
    end

    F[结束]:::complete

    A --> B
    B -.-> C
    C -.-> D
    D -.-> E

    E -. 未完成 .-> B
    E -- 完成 --> F

    style LOOP fill:#fffaf0,stroke:#ffa500,stroke-width:2px,stroke-dasharray:5,5,rx:4,ry:4
    style A fill:#7fa3ff29,stroke:#07f,stroke-width:1px,padding:10px,rx:4,ry:4
    style B fill:#ffe0b2,stroke:none,stroke-width:1px,color:#bf360c,rx:4,ry:4
    style C fill:#bbdefb,stroke:none,stroke-width:1px,color:#0d47a1,rx:4,ry:4
    style D fill:#c8e6c9,stroke:none,stroke-width:1px,color:#1b5e20,rx:4,ry:4
    style E fill:#e1bee7,stroke:none,color:#4a148c,stroke-width:2px,rx:4,ry:4
    style F fill:#7fa3ff29,stroke:#07f,stroke-width:1px,padding:10px,rx:4,ry:4
```
