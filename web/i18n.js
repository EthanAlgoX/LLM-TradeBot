// Lightweight i18n Configuration for LLM-TradeBot Dashboard
const i18n = {
    en: {
        // Header
        'header.mode': 'MODE',
        'header.environment': 'ENVIRONMENT',
        'header.cycle': 'CYCLE',
        'header.equity': 'EQUITY',

        // Buttons
        'btn.settings': 'Settings',
        'btn.backtest': 'Backtest',
        'btn.logout': 'Exit',
        'btn.start': 'Start Trading',
        'btn.pause': 'Pause Trading',
        'btn.stop': 'Stop System',

        // Main Sections
        'section.kline': '📉 Real-time K-Line',
        'section.netvalue': '📈 Net Value Curve',
        'section.decisions': '📋 Recent Decisions',
        'section.trades': '📜 Trade History',
        'section.logs': '📡 Live Log Output',

        // Net Value Chart
        'chart.initial': 'Initial Balance',
        'chart.current': 'Current Funds',
        'chart.available': 'Available',
        'chart.profit': 'Total Profit',

        // Decision Table - Agent Groups
        'group.system': '📊 System',
        'group.strategist': '📈 Strategy',
        'group.trend': '🔮 TREND',
        'group.setup': '📊 SETUP',
        'group.trigger': '⚡ TRIGGER',
        'group.prophet': '🔮 Prophet',
        'group.bullbear': '🐂🐻 Bull/Bear',
        'group.critic': '⚖️ Critic',
        'group.guardian': '🛡️ Guard',

        // Decision Table Headers
        'table.time': 'Time',
        'table.cycle': 'Cycle',
        'table.symbol': 'Symbol',
        'table.layers': 'Layers',
        'table.adx': 'ADX',
        'table.oi': 'OI',
        'table.regime': 'Regime',
        'table.position': 'Position',
        'table.zone': 'Zone',
        'table.signal': 'Signal',
        'table.pup': 'P(Up)',
        'table.bull': '🐂Bull',
        'table.bear': '🐻Bear',
        'table.result': 'Result',
        'table.conf': 'Conf',
        'table.reason': 'Reason',
        'table.guard': 'Guard',

        // Trade History Headers
        'trade.time': 'Time',
        'trade.open': 'Open',
        'trade.close': 'Close',
        'trade.symbol': 'Symbol',
        'trade.entry': 'Entry Price',
        'trade.posvalue': 'Pos Value',
        'trade.exit': 'Exit Price',
        'trade.pnl': 'PnL',
        'trade.pnlpct': 'PnL %',
        'trade.notrades': 'No trades yet',

        // Filters
        'filter.all.symbols': 'All Symbols',
        'filter.all.results': 'All Results',
        'filter.wait': 'Wait',
        'filter.long': 'Long',
        'filter.short': 'Short',

        // Position Info
        'position.count': 'Positions',
        'position.none': 'No open positions',

        // Log Mode
        'log.simplified': 'Simplified',
        'log.detailed': 'Detailed',

        // Settings Modal
        'settings.title': '⚙️ Settings',
        'settings.tab.keys': 'API Keys',
        'settings.tab.accounts': 'Accounts',
        'settings.tab.trading': 'Trading',
        'settings.tab.strategy': 'Strategy',
        'settings.save': 'Save Changes',

        // Trading Config
        'config.mode': 'Trading Mode',
        'config.mode.test': 'Test Mode (Paper Trading)',
        'config.mode.live': 'Live Trading (Real Money)',
        'config.symbols': 'Trading Symbols',
        'config.leverage': 'Leverage',

        // Common
        'common.loading': 'Loading...',
        'common.refresh': 'Refresh',

        // Agent Card Titles
        'agent.card.datasync': 'DataSync Agent',
        'agent.card.symbol_selector': 'Symbol Selector',
        'agent.card.quant': 'Quant Analyst',
        'agent.card.regime': 'Regime Detector',
        'agent.card.trigger_detector': 'Trigger Detector',
        'agent.card.position_analyzer': 'Position Analyzer',
        'agent.card.predict': 'Predict Agent',
        'agent.card.trend': 'Trend Agent',
        'agent.card.trigger': 'Trigger Agent',
        'agent.card.ai_filter': 'AI Filter',
        'agent.card.decision': 'Decision Core',
        'agent.card.risk': 'Risk Audit',
        'agent.card.final_output': 'Final Output',
        'agent.card.reflection': 'Reflection Agent',

        // Framework Labels
        'framework.subtitle': 'Signal -> Audit -> Execute',
        'framework.layer.data': '📡 Data Layer',
        'framework.layer.analysis': '📊 Analysis Layer',
        'framework.layer.strategy': '🧠 Semantic Strategy Layer',
        'framework.layer.decision': '⚖️ Decision Layer',
        'framework.layer.execution': '🛡️ Execution Layer',
        'framework.legend.title': 'Status',
        'framework.legend.subtitle': 'Agent + Signal',
        'framework.legend.section.agent': 'Agent State',
        'framework.legend.section.signal': 'Signal',
        'framework.legend.idle': 'Idle',
        'framework.legend.running': 'Running',
        'framework.legend.completed': 'Completed',
        'framework.legend.long': 'LONG',
        'framework.legend.short': 'SHORT',

        // Agent Output Labels
        'agent.label.5m': '5m:',
        'agent.label.15m': '15m:',
        'agent.label.1m': '1m:',
        'agent.label.oi': 'OI:',
        'agent.label.mode': 'Mode:',
        'agent.label.symbol': 'Symbol:',
        'agent.label.bias': 'Bias:',
        'agent.label.score': 'Score:',
        'agent.label.ema': 'EMA:',
        'agent.label.rsi': 'RSI:',
        'agent.label.macd': 'MACD:',
        'agent.label.bb': 'BB:',
        'agent.label.state': 'State:',
        'agent.label.adx': 'ADX:',
        'agent.label.conf': 'Conf:',
        'agent.label.pattern': 'Pattern:',
        'agent.label.signal': 'Signal:',
        'agent.label.zone': 'Zone:',
        'agent.label.sr': 'S/R:',
        'agent.label.range': 'Range:',
        'agent.label.pup': 'P(Up):',
        'agent.label.pdown': 'P(Down):',
        'agent.label.trend1h': '1h Trend:',
        'agent.label.fire5m': '5m Fire:',
        'agent.label.entry': 'Entry:',
        'agent.label.status': 'Status:',
        'agent.label.veto': 'Veto:',
        'agent.label.reason': 'Reason:',
        'agent.label.bull': '🐂 Bull:',
        'agent.label.bear': '🐻 Bear:',
        'agent.label.risk': 'Risk:',
        'agent.label.size': 'Size:',
        'agent.label.sl': 'SL:',
        'agent.label.tp': 'TP:',
        'agent.label.trades': 'Trades:',
        'agent.label.winrate': 'Win Rate:',
        'agent.label.insight': 'Insight:',

        // Agent Documentation
        'agent.oracle.title': '🕵️ Oracle (DataSync)',
        'agent.oracle.role': 'Unified Data Provider. Multi-dimensional market snapshot.',
        'agent.oracle.feat1': 'Multi-timeframe data (5m/15m/1h) + Funding Rates',
        'agent.oracle.feat2': 'Time-slice alignment to prevent data drift',
        'agent.oracle.feat3': 'Dual View: Stable (Closed) + Real-time (Ticking)',

        'agent.strategist.title': '👨‍🔬 Strategist (QuantAnalyst)',
        'agent.strategist.role': 'Multi-dimensional Signal Generator. Core of Quant Analysis.',
        'agent.strategist.feat1': 'Trend Agent: EMA/MACD Direction Judgment',
        'agent.strategist.feat2': 'Oscillator Agent: RSI/BB Overbought/Oversold',
        'agent.strategist.feat3': 'Sentiment Agent: Funding Rate/Flow Anomalies',

        'agent.prophet.title': '🔮 Prophet (Predict)',
        'agent.prophet.role': 'ML Prediction Engine. Probabilistic Decision Support.',
        'agent.prophet.feat1': 'LightGBM 50+ Features. Auto-retrain every 2h',
        'agent.prophet.feat2': '30-min Price Direction Probability (0-100%)',
        'agent.prophet.feat3': 'SHAP Feature Importance Analysis',

        'agent.critic.title': '⚖️ Critic (DecisionCore)',
        'agent.critic.role': 'LLM Adversarial Judge. Final Decision Hub.',
        'agent.critic.feat1': 'Market Regime: Trend / Chop / Chaos',
        'agent.critic.feat2': 'Price Position: High / Mid / Low',
        'agent.critic.feat3': '🐂🐻 Bull/Bear Debate → Weighted Voting',

        'agent.guardian.title': '🛡️ Guardian (RiskAudit)',
        'agent.guardian.role': 'Independent Risk Audit. Has Veto Power.',
        'agent.guardian.feat1': 'R/R Check: Min 2:1 Risk-Reward',
        'agent.guardian.feat2': 'Drawdown Protection: Auto-pause on threshold',
        'agent.guardian.feat3': 'Twisted Protection: Block counter-trend trades',

        'agent.mentor.title': '🪞 Mentor (Reflection)',
        'agent.mentor.role': 'Trade Review Analysis. Continuous Evolution.',
        'agent.mentor.feat1': 'Triggers LLM Deep Review every 10 trades',
        'agent.mentor.feat2': 'Pattern Recognition: Success/Failure summary',
        'agent.mentor.feat3': 'Insight Injection: Feedback to Critic for optimization',

        // Backtest Page
        'backtest.title': '🔬 Backtesting',
        'backtest.config': '⚙️ Configuration',
        'backtest.symbols': 'Symbols',
        'backtest.daterange': '📅 Date Range',
        'backtest.start': 'Start',
        'backtest.end': 'End',
        'backtest.capital': '💰 Capital',
        'backtest.timestep': '⏱ Step',
        'backtest.stoploss': '🔻 SL%',
        'backtest.takeprofit': '🔺 TP%',
        'backtest.advanced': '⚙️ Advanced Settings',
        'backtest.leverage': 'Leverage',
        'backtest.margin': 'Margin Mode',
        'backtest.contract': 'Contract Type',
        'backtest.feetier': 'Fee Tier',
        'backtest.strategy': 'Strategy Mode',
        'backtest.strategy.technical': '📊 Technical (EMA)',
        'backtest.strategy.agent': '🤖 Multi-Agent (Simulated)',
        'backtest.funding': 'Include Funding Rate',
        'backtest.run': '▶️ Run Backtest',
        'backtest.running': '⏳ Running...',
        'backtest.results': '📊 Results',
        'backtest.history': '📜 Recent Backtests',
        'backtest.equity': '📈 Equity Curve',
        'backtest.drawdown': '📉 Drawdown',
        'backtest.trades': '📋 Trade History',
        'backtest.back': '← Back to Dashboard',
        'backtest.nohistory': 'No backtest history yet',
        'backtest.clickview': 'Click to view details',
        // Metrics
        'metric.return': 'Total Return',
        'metric.annual': 'Annual Return',
        'metric.maxdd': 'Max Drawdown',
        'metric.sharpe': 'Sharpe Ratio',
        'metric.winrate': 'Win Rate',
        'metric.trades': 'Total Trades',
        'metric.pf': 'Profit Factor',
        'metric.avgtrade': 'Avg Trade',
        // Trade Table
        'trade.time': 'Time',
        'trade.side': 'Side',
        'trade.entry': 'Entry',
        'trade.exit': 'Exit',
        'trade.pnl': 'PnL',
        'trade.pnlpct': 'PnL%',
        'trade.duration': 'Duration',
        'trade.reason': 'Reason',

        // Backtest Symbol Buttons
        'backtest.symbol.major': 'Major',
        'backtest.symbol.ai500': 'AI500',
        'backtest.symbol.alts': 'Alts',
        'backtest.symbol.all': 'All',
        'backtest.symbol.clear': 'Clear',
        'backtest.symbol.selected': 'Selected',

        // Backtest Date Range Buttons
        'backtest.date.1day': '1 Day',
        'backtest.date.3days': '3 Days',
        'backtest.date.7days': '7 Days',
        'backtest.date.14days': '14 Days',
        'backtest.date.30days': '30 Days',

        // Backtest Form Labels
        'backtest.label.capital': 'Capital',
        'backtest.label.step': 'Step',
        'backtest.label.sl': 'SL%',
        'backtest.label.tp': 'TP%',

        // Backtest Advanced Settings
        'backtest.funding.settlement': 'Include Funding Rate Settlement',

        // Backtest History Metrics (Short Form)
        'metric.winrate.short': 'WIN RATE',
        'metric.trades.short': 'TRADES',
        'metric.maxdd.short': 'MAX DD',

        // Backtest Results Sections
        'metric.section.risk': 'RISK METRICS',
        'metric.section.trading': 'TRADING',
        'metric.section.longshort': 'LONG/SHORT',

        // Detailed Metrics
        'metric.sortino': 'Sortino Ratio',
        'metric.volatility': 'Volatility',
        'metric.longtrades': 'Long Trades',
        'metric.shorttrades': 'Short Trades',
        'metric.avghold': 'Avg Hold Time',

        // Backtest Live Metrics
        'metric.currentequity': 'Current Equity:',
        'metric.currentprofit': 'Profit:',
        'metric.tradecount': 'Trades:',
        'metric.livewrate': 'Win Rate:',
        'metric.livemaxdd': 'Max DD:',
        'metric.finalequity': 'Final Equity',
        'metric.profit': 'Profit/Loss',
        'backtest.liveequity': '📈 Live Equity Curve',
        'backtest.livedrawdown': '📉 Live Drawdown',
        'backtest.livetrades': '💼 Recent Trades',
        'trade.price': 'Price',

        // Agent Dynamic Summaries
        'summary.risk.idle': 'Risk idle.',
        'summary.risk.blocked': 'RISK BLOCKED:',
        'summary.risk.format': 'RISK {level} | Size {size} | SL {sl} | TP {tp}.',
        'summary.output.pending': 'Output pending.',
        'summary.output.blocked': 'EXEC BLOCKED',
        'summary.output.format': 'EXEC {action} {symbol} {size}.',
        'summary.decision.pending': 'Decision pending.',
        'summary.blocked.reason': 'blocked by risk audit',

        // Reason translations (Chinese -> English)
        'reason.无仓位需要平仓': 'No position to close',
        'reason.当前无持仓': 'No current position',
        'reason.风控拦截': 'Risk audit blocked',
        'reason.趋势不明确': 'Trend unclear',
        'reason.波动率过高': 'Volatility too high',
        'reason.信号强度不足': 'Signal strength insufficient',
        'reason.仓位已满': 'Position limit reached',
        'reason.冷却期未过': 'Cooldown period not over',
        'reason.市场状态不适合': 'Market condition unfavorable',
        'reason.风险过高': 'Risk too high',
        'reason.资金不足': 'Insufficient funds',
        'reason.多空分歧': 'Bull-bear disagreement',
        'reason.信心不足': 'Confidence insufficient',
        'reason.等待更好入场点': 'Waiting for better entry',
        'reason.HOLD决策': 'HOLD decision'
    },

    zh: {
        // Header
        'header.mode': '模式',
        'header.environment': '环境',
        'header.cycle': '周期',
        'header.equity': '权益',

        // Buttons
        'btn.settings': '设置',
        'btn.backtest': '回测',
        'btn.logout': '退出',
        'btn.start': '开始交易',
        'btn.pause': '暂停交易',
        'btn.stop': '停止系统',

        // Main Sections
        'section.kline': '📉 实时K线',
        'section.netvalue': '📈 净值曲线',
        'section.decisions': '📋 最近决策',
        'section.trades': '📜 交易历史',
        'section.logs': '📡 实时日志',

        // Net Value Chart
        'chart.initial': '初始余额',
        'chart.current': '当前资金',
        'chart.available': '可用余额',
        'chart.profit': '总盈亏',

        // Decision Table - Agent Groups
        'group.system': '📊 系统',
        'group.strategist': '📈 策略',
        'group.trend': '🔮 趋势',
        'group.setup': '📊 设置',
        'group.trigger': '⚡ 触发',
        'group.prophet': '🔮 预言',
        'group.bullbear': '🐂🐻 多空',
        'group.critic': '⚖️ 评判',
        'group.guardian': '🛡️ 守护',

        // Decision Table Headers
        'table.time': '时间',
        'table.cycle': '周期',
        'table.symbol': '交易对',
        'table.layers': '层级',
        'table.adx': 'ADX',
        'table.oi': 'OI',
        'table.regime': '市场状态',
        'table.position': '价格位置',
        'table.zone': '区域',
        'table.signal': '信号',
        'table.pup': '上涨概率',
        'table.bull': '🐂多头',
        'table.bear': '🐻空头',
        'table.result': '结果',
        'table.conf': '信心度',
        'table.reason': '原因',
        'table.guard': '风控',

        // Trade History Headers
        'trade.time': '时间',
        'trade.open': '开仓',
        'trade.close': '平仓',
        'trade.symbol': '交易对',
        'trade.entry': '开仓价',
        'trade.posvalue': '持仓价值',
        'trade.exit': '平仓价',
        'trade.pnl': '盈亏',
        'trade.pnlpct': '盈亏%',
        'trade.notrades': '暂无交易',

        // Filters
        'filter.all.symbols': '所有交易对',
        'filter.all.results': '所有结果',
        'filter.wait': '等待',
        'filter.long': '做多',
        'filter.short': '做空',

        // Position Info
        'position.count': '持仓数',
        'position.none': '无持仓',

        // Log Mode
        'log.simplified': '精简',
        'log.detailed': '详细',

        // Settings Modal
        'settings.title': '⚙️ 设置',
        'settings.tab.keys': 'API密钥',
        'settings.tab.accounts': '账户',
        'settings.tab.trading': '交易',
        'settings.tab.strategy': '策略',
        'settings.save': '保存更改',

        // Trading Config
        'config.mode': '交易模式',
        'config.mode.test': '测试模式（模拟交易）',
        'config.mode.live': '实盘交易（真实资金）',
        'config.symbols': '交易币种',
        'config.leverage': '杠杆倍数',

        // Common
        'common.loading': '加载中...',
        'common.refresh': '刷新',

        // Agent Card Titles
        'agent.card.datasync': '数据同步',
        'agent.card.symbol_selector': '选币器',
        'agent.card.quant': '量化分析',
        'agent.card.regime': '市场状态',
        'agent.card.trigger_detector': '触发检测',
        'agent.card.position_analyzer': '位置分析',
        'agent.card.predict': '预测代理',
        'agent.card.trend': '趋势代理',
        'agent.card.trigger': '触发代理',
        'agent.card.ai_filter': 'AI 过滤',
        'agent.card.decision': '决策核心',
        'agent.card.risk': '风控审计',
        'agent.card.final_output': '最终输出',
        'agent.card.reflection': '复盘代理',

        // Framework Labels
        'framework.subtitle': '信号 -> 审计 -> 执行',
        'framework.layer.data': '📡 数据层',
        'framework.layer.analysis': '📊 分析层',
        'framework.layer.strategy': '🧠 语义策略层',
        'framework.layer.decision': '⚖️ 决策层',
        'framework.layer.execution': '🛡️ 执行层',
        'framework.legend.title': '状态',
        'framework.legend.subtitle': '智能体 + 信号',
        'framework.legend.section.agent': '智能体状态',
        'framework.legend.section.signal': '信号',
        'framework.legend.idle': '空闲',
        'framework.legend.running': '运行中',
        'framework.legend.completed': '完成',
        'framework.legend.long': '多头',
        'framework.legend.short': '空头',

        // Agent Output Labels
        'agent.label.5m': '5m：',
        'agent.label.15m': '15m：',
        'agent.label.1m': '1m：',
        'agent.label.oi': '持仓量：',
        'agent.label.mode': '模式：',
        'agent.label.symbol': '交易对：',
        'agent.label.bias': '偏向：',
        'agent.label.score': '评分：',
        'agent.label.ema': 'EMA：',
        'agent.label.rsi': 'RSI：',
        'agent.label.macd': 'MACD：',
        'agent.label.bb': 'BB：',
        'agent.label.state': '状态：',
        'agent.label.adx': 'ADX：',
        'agent.label.conf': '置信度：',
        'agent.label.pattern': '形态：',
        'agent.label.signal': '信号：',
        'agent.label.zone': '区域：',
        'agent.label.sr': '支撑/阻力：',
        'agent.label.range': '区间：',
        'agent.label.pup': '上行概率：',
        'agent.label.pdown': '下行概率：',
        'agent.label.trend1h': '1h趋势：',
        'agent.label.fire5m': '5m触发：',
        'agent.label.entry': '入场：',
        'agent.label.status': '状态：',
        'agent.label.veto': '否决：',
        'agent.label.reason': '原因：',
        'agent.label.bull': '🐂 多头：',
        'agent.label.bear': '🐻 空头：',
        'agent.label.risk': '风险：',
        'agent.label.size': '仓位：',
        'agent.label.sl': '止损：',
        'agent.label.tp': '止盈：',
        'agent.label.trades': '交易数：',
        'agent.label.winrate': '胜率：',
        'agent.label.insight': '洞察：',

        // Agent Documentation
        'agent.oracle.title': '🕵️ 先知 (数据同步)',
        'agent.oracle.role': '统一数据提供者。多维度市场快照。',
        'agent.oracle.feat1': '多时间框架数据 (5m/15m/1h) + 资金费率',
        'agent.oracle.feat2': '时间切片对齐，防止数据漂移',
        'agent.oracle.feat3': '双视图：稳定视图（已收盘）+ 实时视图（跳动中）',

        'agent.strategist.title': '👨‍🔬 策略师 (量化分析)',
        'agent.strategist.role': '多维度信号生成器。量化分析核心。',
        'agent.strategist.feat1': '趋势Agent：EMA/MACD方向判断',
        'agent.strategist.feat2': '震荡Agent：RSI/BB超买超卖',
        'agent.strategist.feat3': '情绪Agent：资金费率/资金流异常',

        'agent.prophet.title': '🔮 预言家 (预测)',
        'agent.prophet.role': '机器学习预测引擎。概率决策支持。',
        'agent.prophet.feat1': 'LightGBM 50+特征。每2小时自动重训练',
        'agent.prophet.feat2': '30分钟价格方向概率 (0-100%)',
        'agent.prophet.feat3': 'SHAP特征重要性分析',

        'agent.critic.title': '⚖️ 评判者 (决策核心)',
        'agent.critic.role': 'LLM对抗式裁判。最终决策中枢。',
        'agent.critic.feat1': '市场状态：趋势 / 震荡 / 混沌',
        'agent.critic.feat2': '价格位置：高位 / 中位 / 低位',
        'agent.critic.feat3': '🐂🐻 多空辩论 → 加权投票',

        'agent.guardian.title': '🛡️ 守护者 (风险审计)',
        'agent.guardian.role': '独立风险审计。拥有否决权。',
        'agent.guardian.feat1': '风报比检查：最低2:1风险回报比',
        'agent.guardian.feat2': '回撤保护：达到阈值自动暂停',
        'agent.guardian.feat3': '扭曲保护：阻止逆势交易',

        'agent.mentor.title': '🪞 导师 (反思)',
        'agent.mentor.role': '交易复盘分析。持续进化。',
        'agent.mentor.feat1': '每10笔交易触发LLM深度复盘',
        'agent.mentor.feat2': '模式识别：成功/失败总结',
        'agent.mentor.feat3': '洞察注入：反馈给评判者以优化',

        // Backtest Page
        'backtest.title': '🔬 策略回测',
        'backtest.config': '⚙️ 回测配置',
        'backtest.symbols': '交易对',
        'backtest.daterange': '📅 日期范围',
        'backtest.start': '开始',
        'backtest.end': '结束',
        'backtest.capital': '💰 初始资金',
        'backtest.timestep': '⏱ 步长',
        'backtest.stoploss': '🔻 止损%',
        'backtest.takeprofit': '🔺 止盈%',
        'backtest.advanced': '⚙️ 高级设置',
        'backtest.leverage': '杠杆倍数',
        'backtest.margin': '保证金模式',
        'backtest.contract': '合约类型',
        'backtest.feetier': '费率等级',
        'backtest.strategy': '策略模式',
        'backtest.strategy.technical': '📊 技术指标 (EMA)',
        'backtest.strategy.agent': '🤖 多Agent仿真 (慢速)',
        'backtest.funding': '包含资金费率',
        'backtest.run': '▶️ 开始回测',
        'backtest.running': '⏳ 运行中...',
        'backtest.results': '📊 回测结果',
        'backtest.history': '📜 历史记录',
        'backtest.equity': '📈 净值曲线',
        'backtest.drawdown': '📉 回撤曲线',
        'backtest.trades': '📋 交易记录',
        'backtest.back': '← 返回控制台',
        'backtest.nohistory': '暂无回测记录',
        'backtest.clickview': '点击查看详情',
        // Metrics
        'metric.return': '总收益率',
        'metric.annual': '年化收益',
        'metric.maxdd': '最大回撤',
        'metric.sharpe': '夏普比率',
        'metric.winrate': '胜率',
        'metric.trades': '总交易数',
        'metric.pf': '盈亏比',
        'metric.avgtrade': '平均盈亏',
        // Trade Table
        'trade.time': '时间',
        'trade.side': '方向',
        'trade.entry': '开仓价',
        'trade.exit': '平仓价',
        'trade.pnl': '盈亏',
        'trade.pnlpct': '盈亏%',
        'trade.duration': '持仓时间',
        'trade.reason': '平仓原因',

        // Backtest Symbol Buttons
        'backtest.symbol.major': '主流币',
        'backtest.symbol.ai500': 'AI500',
        'backtest.symbol.alts': '山寨币',
        'backtest.symbol.all': '全选',
        'backtest.symbol.clear': '清空',
        'backtest.symbol.selected': '已选择',

        // Backtest Date Range Buttons
        'backtest.date.1day': '1天',
        'backtest.date.3days': '3天',
        'backtest.date.7days': '7天',
        'backtest.date.14days': '14天',
        'backtest.date.30days': '30天',

        // Backtest Form Labels
        'backtest.label.capital': '初始资金',
        'backtest.label.step': '时间步长',
        'backtest.label.sl': '止损%',
        'backtest.label.tp': '止盈%',

        // Backtest Advanced Settings
        'backtest.funding.settlement': '包含资金费率结算',

        // Backtest History Metrics (Short Form)
        'metric.winrate.short': '胜率',
        'metric.trades.short': '交易数',
        'metric.maxdd.short': '最大回撤',

        // Backtest Results Sections
        'metric.section.risk': '风险指标',
        'metric.section.trading': '交易统计',
        'metric.section.longshort': '多空分析',

        // Detailed Metrics
        'metric.sortino': '索提诺比率',
        'metric.volatility': '波动率',
        'metric.longtrades': '做多次数',
        'metric.shorttrades': '做空次数',
        'metric.avghold': '平均持仓时间',

        // Backtest Live Metrics
        'metric.currentequity': '当前净值:',
        'metric.currentprofit': '收益:',
        'metric.tradecount': '交易次数:',
        'metric.livewrate': '胜率:',
        'metric.livemaxdd': '最大回撤:',
        'metric.finalequity': '最终金额',
        'metric.profit': '盈亏金额',
        'backtest.liveequity': '📈 实时净值曲线',
        'backtest.livedrawdown': '📉 实时回撤曲线',
        'backtest.livetrades': '💼 最近交易',
        'trade.price': '价格',

        // Agent Dynamic Summaries
        'summary.risk.idle': '风控待机',
        'summary.risk.blocked': '风控拦截:',
        'summary.risk.format': '风险 {level} | 仓位 {size} | 止损 {sl} | 止盈 {tp}',
        'summary.output.pending': '等待输出',
        'summary.output.blocked': '执行拦截',
        'summary.output.format': '执行 {action} {symbol} {size}',
        'summary.decision.pending': '等待决策',
        'summary.blocked.reason': '被风控拦截'
    }
};

// Export for use in app.js
if (typeof window !== 'undefined') {
    window.i18n = i18n;
}
