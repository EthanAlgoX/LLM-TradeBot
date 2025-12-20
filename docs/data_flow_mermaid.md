# Multi-Agent 数据流转架构图

```mermaid
graph TB
    subgraph "1️⃣ 数据采集层 - DataSyncAgent"
        A[🕵️ DataSyncAgent<br/>The Oracle]
        A --> A1[5m K-Line]
        A --> A2[15m K-Line]
        A --> A3[1h K-Line]
        A --> A4[External Quant Data<br/>Netflow, OI]
        A --> A5[Binance Funding Rate]
        A1 & A2 & A3 & A4 & A5 --> MS[MarketSnapshot]
    end
    
    subgraph "2️⃣ 量化分析层 - QuantAnalystAgent"
        MS --> QA[👨‍🔬 QuantAnalystAgent<br/>The Strategist]
        
        subgraph "子 Agent 并行分析"
            QA --> TS[TrendSubAgent<br/>趋势分析]
            QA --> OS[OscillatorSubAgent<br/>震荡分析]
            QA --> SS[SentimentSubAgent<br/>情绪分析]
            
            TS --> TS1[1h-T: +40]
            TS --> TS2[15m-T: +30]
            TS --> TS3[5m-T: +20]
            
            OS --> OS1[1h-O: -20]
            OS --> OS2[15m-O: +10]
            OS --> OS3[5m-O: -5]
            
            SS --> SS1[Sentiment: +25]
        end
        
        TS1 & TS2 & TS3 & OS1 & OS2 & OS3 & SS1 --> QR[quant_analysis<br/>+ Strategist Score]
    end
    
    subgraph "3️⃣ 决策对抗层 - DecisionCoreAgent"
        QR --> DC[⚖️ DecisionCoreAgent<br/>The Critic<br/>加权投票 + 对抗审计]
        
        subgraph "市场感知模块"
            DC --> RD[RegimeDetector<br/>市场状态检测]
            DC --> PA[PositionAnalyzer<br/>价格位置分析]
            
            RD --> RD1[Market State:<br/>CHOPPY/TREND_UP/TREND_DOWN]
            PA --> PA1[Position %:<br/>45.2% MID]
        end
        
        RD1 & PA1 --> DC
        DC --> VR[VoteResult<br/>━━━━━━━━<br/>Action: LONG<br/>Confidence: 75%<br/>Reason: 决策原因<br/>Aligned: ✅<br/>Weighted Score: +52]
    end
    
    subgraph "4️⃣ 风控审计层 - RiskAuditAgent"
        VR --> RA[🛡️ RiskAuditAgent<br/>The Guardian<br/>一票否决 + 自动修正]
        RA --> AR[AuditResult<br/>━━━━━━━━<br/>Passed: ✅<br/>Risk Level: SAFE<br/>Corrections: 止损修正]
    end
    
    subgraph "5️⃣ 执行层"
        AR --> EE[🚀 ExecutionEngine]
        EE --> EX[Order Execution]
    end
    
    subgraph "6️⃣ 可视化层 - Dashboard"
        VR & AR --> DT[📊 Recent Decisions Table<br/>16 Columns]
        DT --> C1[Time, Symbol, Result, Conf]
        DT --> C2[Reason, Strat, 1h-T, 1h-O]
        DT --> C3[15m, 5m, Sent]
        DT --> C4[Risk, Guard, Pos%, Aligned, Context]
    end
    
    style A fill:#4A90E2,color:#fff
    style QA fill:#7ED321,color:#fff
    style DC fill:#F5A623,color:#fff
    style RA fill:#D0021B,color:#fff
    style EE fill:#BD10E0,color:#fff
    style DT fill:#50E3C2,color:#000
    style MS fill:#E8F4F8
    style QR fill:#E8F8E8
    style VR fill:#FFF4E6
    style AR fill:#FFE6E6
```

## 数据流转说明

### 层级 1: 数据采集 (蓝色)

- **DataSyncAgent** 异步并发采集多周期数据
- 输出: `MarketSnapshot` (包含 5m/15m/1h 数据 + 外部量化数据)

### 层级 2: 量化分析 (绿色)

- **QuantAnalystAgent** 协调 3 个子 Agent
  - **TrendSubAgent**: 输出 1h-T, 15m-T, 5m-T
  - **OscillatorSubAgent**: 输出 1h-O, 15m-O, 5m-O
  - **SentimentSubAgent**: 输出 Sentiment Score
- 输出: `quant_analysis` + Strategist 综合评分

### 层级 3: 决策对抗 (橙色)

- **DecisionCoreAgent** 执行加权投票
- 集成 **RegimeDetector** (市场状态) 和 **PositionAnalyzer** (价格位置)
- 输出: `VoteResult` (Action, Confidence, Reason, Aligned, Weighted Score)

### 层级 4: 风控审计 (红色)

- **RiskAuditAgent** 执行最终审核
- 自动修正止损方向、杠杆、仓位
- 输出: `AuditResult` (Passed, Risk Level, Corrections)

### 层级 5: 执行 (紫色)

- **ExecutionEngine** 执行订单

### 层级 6: 可视化 (青色)

- **Recent Decisions Table** 展示所有 Agent 数据 (16列)
