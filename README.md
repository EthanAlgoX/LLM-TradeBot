# 🤖 LLM-TradeBot

[![English](https://img.shields.io/badge/Language-English-blue.svg)](README.md) [![简体中文](https://img.shields.io/badge/Language-简体中文-green.svg)](README_CN.md)

![Adversarial Intelligence Framework](./docs/adversarial_header.png)

Intelligent Multi-Agent Quantitative Trading Bot based on the **Adversarial Decision Framework (ADF)**. Achieves high win rates and low drawdown in automated futures trading through market regime detection, price position awareness, dynamic score calibration, and multi-layer physical auditing.

[![Python](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/)
[![License](https://img.shields.io/badge/License-AGPL%20v3.0-blue.svg)](LICENSE)
[![Framework](https://img.shields.io/badge/Strategy-Adversarial%20Intelligence-gold.svg)](https://github.com/EthanAlgoX/LLM-TradeBot)
[![X Follow](https://img.shields.io/badge/X-@ethan__han999-black.svg?logo=x)](https://x.com/ethan_han999)

---

## 🌐 Web App (Recommended)

**Experience the bot immediately through our web interface:**
**[👉 Live Dashboard](https://web-production-169bb.up.railway.app/)**

---

## ✨ Key Features

- 🕵️ **Perception First**: Unlike strict indicator-based systems, this framework prioritizes judging "IF we should trade" before deciding "HOW to trade".
- 🤖 **Multi-Agent Collaboration**: 9 highly specialized Agents operating independently to form an adversarial verification chain.
- 🧠 **Multi-LLM Support**: Seamlessly switch between DeepSeek, OpenAI, Claude, Qwen, and Gemini via Dashboard settings.
- 📊 **Multi-Account Trading**: Manage multiple exchange accounts with unified API abstraction (currently Binance, extensible).
- ⚡ **Async Concurrency**: Currently fetches multi-timeframe data (5m/15m/1h) concurrently, ensuring data alignment at the snapshot moment.
- 🛡️ **Safety First**: Stop-loss direction correction, capital pre-rehearsal, and veto mechanisms to safeguard live trading.
- 📊 **Full-Link Auditing**: Every decision's adversarial process and confidence penalty details are recorded, achieving true "White-Box" decision-making.

---

## 🤝 Supported Ecosystem

### Supported Exchanges

#### CEX (Centralized Exchanges)

| Exchange | Status | Register (Fee Discount) |
|----------|--------|-------------------------|
| **Binance** | ✅ Supported | [Register](https://www.binance.com/join?ref=NOFXENG) |
| **Bybit** | 🗓️ Coming Soon | [Register](https://partner.bybit.com/b/83856) |
| **OKX** | 🗓️ Coming Soon | [Register](https://www.okx.com/join/1865360) |
| **Bitget** | 🗓️ Coming Soon | [Register](https://www.bitget.com/referral/register?from=referral&clacCode=c8a43172) |

#### Perp-DEX (Decentralized Perpetual Exchanges)

| Exchange | Status | Register (Fee Discount) |
|----------|--------|-------------------------|
| **Hyperliquid** | 🗓️ Coming Soon | [Register](https://app.hyperliquid.xyz/join/AITRADING) |
| **Aster DEX** | 🗓️ Coming Soon | [Register](https://www.asterdex.com/en/referral/fdfc0e) |
| **Lighter** | 🗓️ Coming Soon | [Register](https://app.lighter.xyz/?referral=68151432) |

### Supported AI Models

| AI Model | Status | Get API Key |
|----------|--------|-------------|
| **DeepSeek** | ✅ Supported | [Get API Key](https://platform.deepseek.com) |
| **Qwen** | ✅ Supported | [Get API Key](https://dashscope.console.aliyun.com) |
| **OpenAI (GPT)** | ✅ Supported | [Get API Key](https://platform.openai.com) |
| **Claude** | ✅ Supported | [Get API Key](https://console.anthropic.com) |
| **Gemini** | ✅ Supported | [Get API Key](https://aistudio.google.com) |
| **Grok** | 🗓️ Coming Soon | [Get API Key](https://console.x.ai) |
| **Kimi** | 🗓️ Coming Soon | [Get API Key](https://platform.moonshot.cn) |

---

## 📚 What You Need to Know

**For Complete Beginners**:

- This is an **automated trading bot** that trades cryptocurrency futures on Binance
- It uses AI (LLM) and machine learning to make trading decisions
- **Test mode** lets you practice with virtual money before risking real funds
- The bot runs 24/7 and makes decisions based on market analysis

**Technical Level**: Intermediate Python knowledge recommended but not required for basic usage.

---

## ⚙️ Prerequisites

Before you start, make sure you have:

### Required

- ✅ **Python 3.11+** installed ([Download here](https://www.python.org/downloads/))
- ✅ **Git** installed ([Download here](https://git-scm.com/downloads))
- ✅ **Binance Account** ([Sign up here](https://www.binance.com/))

### For Test Mode (Beginners)

- ✅ Nothing else needed! Test mode uses virtual balance

### For Live Trading (Advanced)

- ✅ **Binance Futures API Keys** with trading permissions
- ✅ **USDT in Futures Wallet** (minimum $100 recommended)
- ⚠️ **Risk Warning**: Only trade with money you can afford to lose

---

## 🚀 Quick Start

### Startup Flow

![Quick Start Flow](./docs/quick_start_flow_9agents.png)

### Detailed Steps

#### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

#### 2. Configure Environment

```bash
# Copy environment variable template
cp .env.example .env

# Set API Keys
./set_api_keys.sh
```

#### 3. Configure Trading Parameters

```bash
# Copy config template
cp config.example.yaml config.yaml
```

Edit `config.yaml` to set parameters:

- Trading pair (symbol)
- Max position size (max_position_size)
- Leverage (leverage)
- Stop loss/Take profit % (stop_loss_pct, take_profit_pct)

##### ⚙️ Dashboard Settings

You can also configure all settings from the Dashboard:

![Settings Tabs](./docs/settings_tabs_composite.png)

*Settings Modal with 4 tabs: API Keys (LLM Provider), Accounts (Multi-Account), Trading, Strategy (Prompt)*

#### 4. Start the Bot

![Dashboard Preview](./docs/dashboard_preview_1.png)
![Live Log Output](./docs/dashboard_preview_2.png)
Built-in modern real-time monitoring dashboard.

##### 🧪 Test Mode (Recommended for beginners)

Simulates trading with virtual balance ($1000). No real trades executed.

```bash
# Start with test mode
python main.py --test --mode continuous
```

##### 🔴 Live Trading Mode

⚠️ **WARNING**: Executes real trades on Binance Futures!

```bash
# Start live trading
python main.py --mode continuous
```

> **Prerequisites for Live Trading**:
>
> - Valid Binance Futures API keys configured in `.env`
> - Sufficient USDT balance in Futures wallet
> - API permissions: Read + Futures Trading enabled

After startup, visit: **<http://localhost:8000>** (or use our [Cloud Hosting](https://web-production-169bb.up.railway.app/))

**Dashboard Features**:

- **📉 Real-time K-Line**: Integrated TradingView widget, 1-minute real-time updates
- **📈 Net Value Curve**: Real-time equity tracking with initial balance baseline
- **📋 Recent Decisions**: Full decision history with 17 columns showing multi-agent analysis:
  - **System**: Time, Cycle, Symbol
  - **Critic**: Result (LONG/SHORT/WAIT), Confidence, Reason
  - **Strategist**: 1h/15m/5m signals (Trend + Oscillator), Sentiment score
  - **Prophet**: ML prediction probability with direction (↗UP/➖NEU/↘DN)
  - **Bull/Bear**: Adversarial perspectives with stance (🔥Strong/↗Slight) and confidence
  - **Context**: Market Regime (📈UP/📉DN/〰️CHOP), Price Position (🔝HIGH/➖MID/🔻LOW)
  - **Guardian**: Risk level (✅SAFE/⚠️WARN/🚨DANGER), Audit result (✅PASS/⛔BLOCK), Multi-period alignment

#### 📋 Recent Decisions Indicator Guide

All indicators use semantic icons and two-line display format for quick visual scanning:

**📊 System Columns**

- **Time**: Decision timestamp
- **Cycle**: Trading cycle number
- **Symbol**: Trading pair (e.g., BTCUSDT)

**⚖️ Critic (Decision Core)**

- **Result**: Final action (LONG/SHORT/WAIT)
- **Conf**: Decision confidence (0-100%)
- **Reason**: Decision rationale (hover for full text)

**👨‍🔬 Strategist (Quant Analysis)**

- **1h/15m/5m**: Multi-timeframe signals
  - Format: `T:UP` (Trend) / `O:DN` (Oscillator)
  - Colors: Green (UP), Red (DN), Gray (NEU)
- **Sent**: Sentiment score with icon (📈/📉/➖)

**🔮 Prophet (ML Prediction)**

- Format: `🔮↗` + `65%`
- Direction: ↗UP (>55%), ➖NEU (45-55%), ↘DN (<45%)

**🐂🐻 Bull/Bear (Adversarial Analysis)**

- **Bull**: `↗Bull` / `🔥Bull` + confidence %
- **Bear**: `↘Bear` / `🔥Bear` + confidence %
- Stance: 🔥Strong, ↗Slight, ➖Neutral, ❓Unclear

**🌍 Context (Market State)**

- **Regime**: `📈UP` / `📉DN` / `〰️CHOP`
- **Position**: `🔝HIGH` / `➖MID` / `🔻LOW` + percentage

**🛡️ Guardian (Risk Control)**

- **Risk**: `✅SAFE` / `⚠️WARN` / `🚨DANGER`
- **Guard**: `✅PASS` / `⛔BLOCK` (with reason on hover)
- **Aligned**: ✅ Multi-period aligned / ➖ Not aligned

- **📜 Trade History**: Complete record of all trades with Open/Close cycles and PnL statistics
- **📡 Live Log Output**: Real-time scrolling logs with highlighted Agent tags (Oracle, Strategist, Critic, Guardian), 500-line history buffer

#### 5. Common Operations

```bash
# Stop the bot
pkill -f "python main.py"

# Restart the bot (Test Mode)
pkill -f "python main.py"; sleep 2; python main.py --test --mode continuous

# View running processes
ps aux | grep "python main.py"

# View logs in terminal (if running in background)
tail -f logs/trading_$(date +%Y%m%d).log
```

---

## 📁 Project Structure

### Directory Tree

![Project Structure](./docs/project_structure_tree_9agents.png)

### Directory Description

```text
LLM-TradeBot/
├── src/                    # Core Source Code
│   ├── agents/            # Multi-Agent Definitions (DataSync, Quant, Decision, Risk)
│   ├── api/               # Binance API Client
│   ├── data/              # Data Processing (processor, validator)
│   ├── exchanges/         # 🆕 Multi-Account Exchange Abstraction
│   │   ├── base.py       # BaseTrader ABC + Data Models
│   │   ├── binance_trader.py  # Binance Futures Implementation
│   │   ├── factory.py    # Exchange Factory
│   │   └── account_manager.py # Multi-Account Manager
│   ├── execution/         # Order Execution Engine
│   ├── features/          # Feature Engineering
│   ├── llm/               # 🆕 Multi-LLM Interface
│   │   ├── base.py       # BaseLLMClient ABC
│   │   ├── openai_client.py  # OpenAI Implementation
│   │   ├── deepseek_client.py # DeepSeek Implementation
│   │   ├── claude_client.py  # Anthropic Claude
│   │   ├── qwen_client.py    # Alibaba Qwen
│   │   ├── gemini_client.py  # Google Gemini
│   │   └── factory.py    # LLM Factory
│   ├── monitoring/        # Monitoring & Logging
│   ├── risk/              # Risk Management
│   ├── strategy/          # LLM Decision Engine
│   └── utils/             # Utilities (DataSaver, TradeLogger, etc.)
│
├── docs/                  # Documentation
│   ├── data_flow_analysis.md          # Data Flow Analysis
│   └── *.png                          # Architecture & Flow Diagrams
│
├── data/                  # Structured Data Storage (Archived by Date)
│   ├── market_data/       # Raw K-Line Data
│   ├── indicators/        # Technical Indicators
│   ├── features/          # Feature Snapshots
│   ├── decisions/         # Final Decision Results
│   └── execution/         # Execution Records
│
├── config/                # Configuration Files
│   └── accounts.example.json  # 🆕 Multi-Account Config Template
│
├── logs/                  # System Runtime Logs
├── tests/                 # Unit Tests
│
├── main.py                # Main Entry Point (Multi-Agent Loop)
├── config.yaml            # Trading Parameters
├── .env                   # API Key Configuration
└── requirements.txt       # Python Dependencies
```

---

## 🎯 Core Architecture

### Adversarial Multi-Agent Workflow

1. **🕵️ DataSyncAgent (The Oracle)**
    - **Role**: Unified Data Provider.
    - **Action**: Asynchronously fetches and aligns multi-timeframe K-lines (5m, 15m, 1h) and external quant data (Netflow, LSR) to ensure a consistent market snapshot.

2. **👨‍🔬 QuantAnalystAgent (The Strategist)**
    - **Role**: Signal Generator (Technical Analysis).
    - **Composition**:
        - `TrendSubAgent`: Analyzes EMA/MACD across timeframes.
        - `OscillatorSubAgent`: Detects reversal zones using RSI/Bollinger Bands.
        - `SentimentSubAgent`: Incorporates external data like Funding Rates and Open Interest.
    - **Output**: A raw comprehensive score and detailed sub-signal breakdown.

3. **🔮 PredictAgent (The Prophet)**
    - **Role**: **Future Predictor (ML Model)**.
    - **Action**:
        - Uses **LightGBM** machine learning model trained on historical data.
        - Analyzes 50+ technical features to predict price direction for the next **30 minutes**.
        - Supports auto-retraining (every 2h) to adapt to changing market conditions.
    - **Output**: Probability of price increase (P_Up) and confidence score.

4. **🐂 Bull Agent (The Optimist)**
    - **Role**: Bullish Market Advocate.
    - **Action**: Analyzes the same market data but focuses **exclusively on bullish signals**.
    - **Output**:
        - `stance`: `STRONGLY_BULLISH` / `SLIGHTLY_BULLISH` / `NEUTRAL` / `UNCERTAIN`
        - `bullish_reasons`: Key observations supporting a long position
        - `bull_confidence`: 0-100% confidence in the bullish case

5. **🐻 Bear Agent (The Pessimist)**
    - **Role**: Bearish Market Advocate.
    - **Action**: Analyzes the same market data but focuses **exclusively on bearish signals**.
    - **Output**:
        - `stance`: `STRONGLY_BEARISH` / `SLIGHTLY_BEARISH` / `NEUTRAL` / `UNCERTAIN`
        - `bearish_reasons`: Key observations supporting a short position
        - `bear_confidence`: 0-100% confidence in the bearish case

6. **⚖️ DecisionCoreAgent (The Critic)**
    - **Role**: **Adversarial Judge**.
    - **Action**:
        - **Contextualization**: Uses `RegimeDetector` to identify market state (Trending/Choppy) and `PositionAnalyzer` to locate price relative to history.
        - **Adversarial Input**: Receives **both Bull and Bear perspectives** to make balanced decisions.
        - **Integration**: Combines Strategist's technical signals with Prophet's ML predictions and Bull/Bear viewpoints.
        - **Weighted Voting**: Re-evaluates granular signals with dynamic weights adapted to the current regime.
        - **Output**: The final trading intent (Long/Short/Wait) with a confidence score.

7. **🛡️ RiskAuditAgent (The Guardian)**
    - **Role**: Risk Controller.
    - **Action**: Physically independent audit layer. Checks Max Drawdown protection, R/R requirements, and exposure limits. Has **Veto Power** to block high-risk trades regardless of high confidence.

8. **🧠 ReflectionAgent (The Philosopher)** 🆕
    - **Role**: Trading Retrospection Analyst.
    - **Trigger**: Automatically runs after every **10 completed trades**.
    - **Action**:
        - Analyzes recent trade history for patterns (winning/losing conditions).
        - Identifies confidence calibration issues (over/under-confident decisions).
        - Generates actionable recommendations for improvement.
    - **Integration**: Reflection insights are injected into the Decision Agent's prompt to influence future decisions.
    - **Output**: Structured analysis with patterns, recommendations, and market insights.

9. **🚀 ExecutionEngine**
    - **Role**: Sniper.
    - **Action**: Precision execution within the closing seconds of the candle, handling order lifecycle and state updates.

### Collaboration Sequence

![Multi-Agent Sequence](./docs/multi_agent_sequence_9agents.png)

*9 Agents working together: Oracle → Strategist → Prophet → Bull/Bear → Philosopher → Critic → Guardian → Executor*

### Data Flow Architecture

![Data Flow Architecture](./docs/data_flow_diagram_9agents.png)

**Architecture Details**:

1. **Data Collection Layer** (Blue): DataSyncAgent async concurrent collection
2. **Quant Analysis Layer** (Green): QuantAnalystAgent with 3 parallel Sub-Agents
3. **Prediction Layer** (Magenta): PredictAgent with LightGBM ML model
4. **Bull/Bear Adversarial Layer** (Yellow): 🐂 Bull Agent + 🐻 Bear Agent provide opposing perspectives
5. **Reflection Layer** (Cyan): 🧠 ReflectionAgent analyzes trade history every 10 trades 🆕
6. **Decision Adversarial Layer** (Orange): DecisionCoreAgent with regime-aware weighted voting + Bull/Bear + Reflection input
7. **Risk Audit Layer** (Red): RiskAuditAgent final check and auto-correction
8. **Execution Layer** (Purple): ExecutionEngine order execution
9. **Visualization Layer**: Recent Decisions table showing full Agent data

#### Detailed Flowchart

![9-Agent Flowchart](./docs/detailed_flowchart_9agents.png)

<details>
<summary>📐 Mermaid Diagram (Interactive)</summary>

```mermaid
graph TB
    subgraph "1️⃣ Data Collection Layer"
        A["🕵️ DataSyncAgent<br/>(The Oracle)"] --> MS["MarketSnapshot<br/>5m/15m/1h K-lines"]
    end
    
    subgraph "2️⃣ Quant Analysis Layer"
        MS --> QA["👨‍🔬 QuantAnalystAgent<br/>(The Strategist)"]
        QA --> TS["📈 TrendSubAgent"]
        QA --> OS["📊 OscillatorSubAgent"]
        QA --> SS["💹 SentimentSubAgent"]
        TS & OS & SS --> QR["Quant Signals"]
    end

    subgraph "3️⃣ Prediction Layer"
        MS --> PA["🔮 PredictAgent<br/>(The Prophet)"]
        PA --> ML["LightGBM Model<br/>Auto-Train 2h"]
        ML --> PR["P_Up Prediction"]
    end

    subgraph "4️⃣ Bull/Bear Adversarial Layer"
        MS --> BULL["🐂 Bull Agent<br/>(The Optimist)"]
        MS --> BEAR["🐻 Bear Agent<br/>(The Pessimist)"]
        BULL --> BP["Bull Perspective"]
        BEAR --> BRP["Bear Perspective"]
    end
    
    subgraph "5️⃣ Reflection Layer"
        TH["📜 Trade History<br/>Last 10 Trades"] --> REF["🧠 ReflectionAgent<br/>(The Philosopher)"]
        REF --> RI["Reflection Insights<br/>Patterns & Recommendations"]
    end
    
    subgraph "6️⃣ Decision Layer"
        QR & PR & BP & BRP & RI --> DC["⚖️ DecisionCoreAgent<br/>(The Critic)"]
        DC --> RD["RegimeDetector"]
        DC --> POS["PositionAnalyzer"]
        RD & POS --> VR["VoteResult<br/>Action + Confidence"]
    end
    
    subgraph "7️⃣ Risk Audit Layer"
        VR --> RA["🛡️ RiskAuditAgent<br/>(The Guardian)"]
        RA --> AR["AuditResult<br/>Risk Level + Guard"]
    end
    
    subgraph "8️⃣ Execution Layer"
        AR --> EE["🚀 ExecutionEngine<br/>(The Executor)"]
        EE -.->|"Trade Complete"| TH
    end
    
    %% Styling for Agent Nodes
    style A fill:#4A90E2,color:#fff,stroke:#2563EB,stroke-width:2px
    style QA fill:#7ED321,color:#fff,stroke:#059669,stroke-width:2px
    style PA fill:#BD10E0,color:#fff,stroke:#9333EA,stroke-width:2px
    style BULL fill:#F8E71C,color:#333,stroke:#CA8A04,stroke-width:2px
    style BEAR fill:#F8E71C,color:#333,stroke:#CA8A04,stroke-width:2px
    style REF fill:#00CED1,color:#fff,stroke:#0891B2,stroke-width:2px
    style DC fill:#F5A623,color:#fff,stroke:#EA580C,stroke-width:2px
    style RA fill:#D0021B,color:#fff,stroke:#DC2626,stroke-width:2px
    style EE fill:#9013FE,color:#fff,stroke:#7C3AED,stroke-width:2px
    
    %% Styling for Output Nodes
    style MS fill:#1E3A5F,color:#fff
    style QR fill:#1E3A5F,color:#fff
    style PR fill:#1E3A5F,color:#fff
    style BP fill:#1E3A5F,color:#fff
    style BRP fill:#1E3A5F,color:#fff
    style RI fill:#1E3A5F,color:#fff
    style VR fill:#1E3A5F,color:#fff
    style AR fill:#1E3A5F,color:#fff
    style TH fill:#1E3A5F,color:#fff
```

</details>

> 📖 **Detailed Docs**: See [Data Flow Analysis](./docs/data_flow_analysis.md) for complete mechanisms.

---

## 📄 Full-Link Data Auditing

### Data Storage Structure

![Data Storage Hierarchy](./docs/data_storage_hierarchy_9agents.png)

### Storage Organization

The system automatically records intermediate processes for each cycle in the `data/` directory, organized by date for easy review and debugging:

```text
data/
├── market_data/           # Raw Multi-Timeframe K-Lines
│   └── {date}/
│       ├── BTCUSDT_5m_{timestamp}.json
│       ├── BTCUSDT_5m_{timestamp}.csv
│       ├── BTCUSDT_5m_{timestamp}.parquet
│       ├── BTCUSDT_15m_{timestamp}.json
│       └── BTCUSDT_1h_{timestamp}.json
│
├── indicators/            # Full Technical Indicators DataFrames
│   └── {date}/
│       ├── BTCUSDT_5m_{snapshot_id}.parquet
│       ├── BTCUSDT_15m_{snapshot_id}.parquet
│       └── BTCUSDT_1h_{snapshot_id}.parquet
│
├── features/              # Feature Snapshots
│   └── {date}/
│       ├── BTCUSDT_5m_{snapshot_id}_v1.parquet
│       ├── BTCUSDT_15m_{snapshot_id}_v1.parquet
│       └── BTCUSDT_1h_{snapshot_id}_v1.parquet
│
├── context/               # Quant Analysis Summary
│   └── {date}/
│       └── BTCUSDT_quant_analysis_{snapshot_id}.json
│
├── llm_logs/              # LLM Input Context & Voting Process
│   └── {date}/
│       └── BTCUSDT_{snapshot_id}.md
│
├── decisions/             # Final Weighted Vote Results
│   └── {date}/
│       └── BTCUSDT_{snapshot_id}.json
│
└── execution/             # Execution Tracking
    └── {date}/
        └── BTCUSDT_{timestamp}.json
```

### Data Formats

- **JSON**: Human-readable, used for configuration and decision results
- **CSV**: High compatibility, easy for Excel import
- **Parquet**: Efficient compression, used for large-scale time-series data

---

## 🛡️ Safety Warning

⚠️ **Important Safety Measures**:

1. **API Keys**: Keep them safe, DO NOT commit to version control.
2. **Test First**: Use `--test` argument to run simulations first.
3. **Risk Control**: Set reasonable stop-loss and position limits in `config.yaml`.
4. **Minimal Permissions**: Grant only necessary Futures Trading permissions to API keys.
5. **Monitoring**: Regularly check the `logs/` directory for anomalies.

---

## 📚 Documentation Navigation

| Document | Description |
|------|------|
| [README.md](./README.md) | Project Overview & Quick Start |
| [Data Flow Analysis](./docs/data_flow_analysis.md) | Complete Data Flow Mechanisms |
| [API Key Guide](./docs/API_KEYS_GUIDE.txt) | API Key Configuration Guide |
| [Config Example](./config.example.yaml) | Trading Parameters Template |
| [Env Example](./.env.example) | Environment Variables Template |

---

## 🎉 Latest Updates

**2025-12-25**:

- ✅ **ReflectionAgent (The Philosopher)**: New agent that analyzes every 10 trades and provides insights to improve future decisions.
- ✅ **Trading Retrospection**: Automatic pattern detection, confidence calibration, and actionable recommendations.
- ✅ **Decision Integration**: Reflection insights are injected into Decision Agent prompts for continuous learning.

**2025-12-24**:

- ✅ **Multi-LLM Support**: Added support for 5 LLM providers (DeepSeek, OpenAI, Claude, Qwen, Gemini) with unified interface.
- ✅ **Dashboard LLM Settings**: Switch LLM provider and API keys directly from Dashboard Settings.
- ✅ **Multi-Account Architecture**: New `src/exchanges/` module with `BaseTrader` abstraction for multi-exchange support.
- ✅ **Account Manager**: Manage multiple trading accounts via Dashboard or `config/accounts.json`.
- ✅ **API Endpoints**: Added `/api/accounts` and `/api/exchanges` for account management.

**2025-12-23**:

- ✅ **Trade History Enhanced**: Added Open/Close Cycle columns, PnL % with color indicators.
- ✅ **Net Value Curve**: Dashed initial capital baseline with centered Y-axis logic.
- ✅ **Decision Table Refactor**: Removed Active PnL column, added tooltip for Guardian block reasons.
- ✅ **Strategy Improvements**: Added `add_position` action for "buy the dip", confidence calibration rules.
- ✅ **Documentation**: Translated dashboard agent descriptions to English.

**2025-12-21**:

- ✅ **ML Model Upgrade**: Upgraded `PredictAgent` to use **LightGBM** machine learning model.
- ✅ **Auto-Training**: Implemented automatic model retraining every 2 hours to adapt to market drifts.
- ✅ **Dashboard Refinement**: Enhanced dashboard with auto-scrolling logs, robust scrollbars, and ML probability display.
- ✅ **Cycle Optimization**: Optimized decision cycle to 3 minutes for faster response.

**2025-12-20**:

- ✅ **Adversarial Decision Framework**: Introduced `PositionAnalyzer` and `RegimeDetector`.
- ✅ **Confidence Score Refactor**: Implemented dynamic confidence penalties.
- ✅ **Documentation Optimization**: Updated README to highlight adversarial architecture.
- ✅ **Project Renamed**: Officially renamed to `LLM-TradeBot`.
- ✅ **Full-Link Auditing**: Implemented complete intermediate state archiving.

---

## ❓ Frequently Asked Questions (FAQ)

### For Beginners

**Q: Is this safe to use? Will I lose money?**
A: Test mode is 100% safe - it uses virtual money. For live trading, only use funds you can afford to lose. Cryptocurrency trading is risky.

**Q: Do I need to know Python to use this?**
A: No! Just follow the Quick Start guide. You only need Python installed, not programming knowledge.

**Q: How much money do I need to start?**
A: Test mode is free. For live trading, minimum $100 USDT recommended, but start small while learning.

**Q: Will the bot trade 24/7?**
A: Yes, once started in continuous mode, it runs non-stop analyzing markets and making decisions.

**Q: How do I know if it's working?**
A: Open `http://localhost:8000` in your browser to see the real-time dashboard with live logs and charts.

### Technical Questions

**Q: Which exchanges are supported?**
A: Currently only Binance Futures. Spot trading and other exchanges are not supported.

**Q: Can I customize the trading strategy?**
A: Yes! Edit `config.yaml` for basic parameters. Advanced users can modify agent logic in `src/` directory.

**Q: What's the difference between Test and Live mode?**
A: Test mode simulates trading with $1000 virtual balance. Live mode executes real trades on Binance.

**Q: How do I stop the bot?**
A: Press `Ctrl+C` in the terminal, or run `pkill -f "python main.py"`

**Q: Why is the dashboard not loading?**
A: Make sure the bot is running and visit `http://localhost:8000`. Check firewall settings if issues persist.

### Troubleshooting

**Q: "ModuleNotFoundError" when starting**
A: Run `pip install -r requirements.txt` to install all dependencies.

**Q: "API Key invalid" error**
A: Check your `.env` file has correct Binance API keys. For test mode, API keys are optional.

**Q: Bot keeps saying "WAIT" and not trading**
A: This is normal! The bot is conservative and only trades when conditions are favorable. Check the dashboard logs for reasoning.

**Q: How do I update to the latest version?**
A: Run `git pull origin main` then restart the bot.

---

## 🤝 Contribution

Issues and Pull Requests are welcome!

---

This project is licensed under the GNU Affero General Public License v3.0. See the [LICENSE](LICENSE) file for details.

---

**Empowered by AI, Focused on Precision, Starting a New Era of Intelligent Quant!** 🚀
