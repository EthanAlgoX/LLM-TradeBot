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
        'trade.reason': 'Reason'
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
        'trade.reason': '平仓原因'
    }
};

// Export for use in app.js
if (typeof window !== 'undefined') {
    window.i18n = i18n;
}
