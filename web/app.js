const API_URL = '/api/status';

// Chart Instance
let equityChart = null;

function initChart() {
    const ctx = document.getElementById('equityChart').getContext('2d');
    equityChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Total Equity (USDT)',
                data: [],
                borderColor: '#00ff9d',
                backgroundColor: 'rgba(0, 255, 157, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(23, 25, 30, 0.9)',
                    titleColor: '#94a3b8',
                    bodyColor: '#e0e6ed',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
}

// 全局存储决策历史以便过滤
let allDecisionHistory = [];

function updateDashboard() {
    fetch(API_URL)
        .then(response => response.json())
        .then(data => {
            renderSystemStatus(data.system);
            renderMarketData(data.market);
            renderAgents(data.agents);
            renderDecision(data.decision);
            renderLogs(data.logs);

            // New Renderers
            if (data.account) renderAccount(data.account);
            if (data.account) {
                // TODO: API should return positions array
                // For now, create mock data if no positions available
                const positions = data.positions || [];
                updatePositionInfo(data.account, positions);
            }
            if (data.chart_data && data.chart_data.equity) renderChart(data.chart_data.equity);

            // Layout v2 Renderers with Filtering
            if (data.decision_history) {
                allDecisionHistory = data.decision_history;
                applyDecisionFilters(); // 应用当前过滤条件
            }
            if (data.trade_history) renderTradeHistory(data.trade_history);

            // Check for account fetch failure alert
            if (data.account_alert && data.account_alert.active) {
                showAccountAlert(data.account_alert.failure_count);
            }
        })
        .catch(err => console.error('Error fetching data:', err));
}

// 决策表过滤函数
function applyDecisionFilters() {
    const symbolFilter = document.getElementById('filter-symbol')?.value || 'all';
    const resultFilter = document.getElementById('filter-result')?.value || 'all';

    let filtered = allDecisionHistory;

    // 按币种过滤
    if (symbolFilter !== 'all') {
        filtered = filtered.filter(d => d.symbol === symbolFilter);
    }

    // 按结果过滤
    if (resultFilter !== 'all') {
        filtered = filtered.filter(d => {
            const action = (d.action || '').toLowerCase();
            return action.includes(resultFilter);
        });
    }

    renderDecisionTable(filtered);
}

// 过滤器事件监听
document.getElementById('filter-symbol')?.addEventListener('change', applyDecisionFilters);
document.getElementById('filter-result')?.addEventListener('change', applyDecisionFilters);

function renderTradeHistory(trades) {
    const tbody = document.querySelector('#trade-table tbody');
    if (!tbody) return;

    tbody.innerHTML = trades.map(t => {
        const time = t.record_time || t.timestamp || 'N/A';
        // Simplified time if needed: time.substring(5, 16) -> MM-DD HH:MM

        const symbol = t.symbol || 'BTC';
        const action = t.action || 'Trade';

        // Formatting numbers
        const fmtUsd = val => val ? '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-';

        const price = fmtUsd(t.price);
        const cost = fmtUsd(t.cost);
        const exit = Number(t.exit_price) > 0 ? fmtUsd(t.exit_price) : '-';

        // PnL with Color
        let pnlHtml = '-';
        if (t.pnl !== undefined && t.pnl !== 0 && t.pnl !== '0.0') {
            const val = Number(t.pnl);
            const cls = val > 0 ? 'pos' : (val < 0 ? 'neg' : 'neutral');
            const sign = val > 0 ? '+' : '';
            pnlHtml = `<span class="val ${cls}">${sign}${val.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>`;
        }

        // Action Color
        let actCls = 'action-hold';
        if (action.includes('LONG') || action.includes('BUY')) actCls = 'action-buy';
        else if (action.includes('SHORT') || action.includes('SELL')) actCls = 'action-sell';

        return `
            <tr>
                <td>${time}</td>
                <td>${symbol}</td>
                <td class="${actCls}">${action}</td>
                <td>${price}</td>
                <td>${cost}</td>
                <td>${exit}</td>
                <td>${pnlHtml}</td>
            </tr>
        `;
    }).join('');
}

function renderDecisionTable(history) {
    const tbody = document.querySelector('#decision-table tbody');
    if (!tbody) return;

    tbody.innerHTML = history.map(d => {
        const time = d.timestamp || 'Just now';
        const symbol = d.symbol || 'BTCUSDT';
        const action = (d.action || 'HOLD').toUpperCase();
        const conf = d.confidence ? ((d.confidence > 1 ? d.confidence : d.confidence * 100).toFixed(0) + '%') : '-';

        let actionClass = 'action-hold';
        if (action.includes('LONG') || action.includes('BUY')) actionClass = 'action-buy';
        else if (action.includes('SHORT') || action.includes('SELL')) actionClass = 'action-sell';

        // Helper to format score cell with Semantic Support
        const fmtScore = (key, label) => {
            // Get Numeric Score
            let scoreVal = 'N/A';
            if (d.vote_details && d.vote_details[key] !== undefined && d.vote_details[key] !== null) {
                scoreVal = Math.round(d.vote_details[key]);
            }

            // Check for semantic analysis first
            if (d.vote_analysis && d.vote_analysis[key]) {
                const text = d.vote_analysis[key];
                let cls = 'neutral';
                if (text.toLowerCase().includes('bull') || text.toLowerCase().includes('buy') || text.toLowerCase().includes('up')) cls = 'pos';
                else if (text.toLowerCase().includes('bear') || text.toLowerCase().includes('sell') || text.toLowerCase().includes('down')) cls = 'neg';

                // Truncate long text for display, tooltip for Score
                const shortText = text.replace(/\(.*\)/, '').trim(); // Remove () parts for short display
                return `<span class="val ${cls}" title="Score: ${scoreVal}" style="cursor:help; font-size: 0.8em;">${shortText}</span>`;
            }

            // Fallback to number if no semantic
            if (scoreVal === 'N/A') return '<span class="cell-na">-</span>';
            const val = parseInt(scoreVal);
            const cls = val > 0 ? 'pos' : (val < 0 ? 'neg' : 'neutral');
            return `<span class="val ${cls}">${val}</span>`;
        };

        // Extract Agent Scores (Semantic)
        const stratHtml = fmtScore('strategist_total');
        const trend1hHtml = fmtScore('trend_1h');
        const osc1hHtml = fmtScore('oscillator_1h');
        const sentHtml = fmtScore('sentiment');

        // Combine 1h signals (Compact view)
        const signal1h = `<div style="font-size:0.75em">T:${trend1hHtml}<br>O:${osc1hHtml}</div>`;

        // Multi-period signals (15m, 5m) - Semantic
        const trend15mHtml = fmtScore('trend_15m');
        const osc15mHtml = fmtScore('oscillator_15m');

        // Combine 15m and 5m signals (Compact view)
        // If semantic is available, we might want to show abbreviated icons or short text
        // For compact cells, let's just use the short semantic
        const signal15m = `<div style="font-size:0.75em">T:${trend15mHtml}<br>O:${osc15mHtml}</div>`;

        const trend5mHtml = fmtScore('trend_5m');
        const osc5mHtml = fmtScore('oscillator_5m');
        const signal5m = `<div style="font-size:0.75em">T:${trend5mHtml}<br>O:${osc5mHtml}</div>`;

        // Reason (truncated with tooltip)
        let reasonHtml = '<span class="cell-na">-</span>';
        if (d.reason) {
            const fullReason = d.reason.replace(/"/g, '&quot;'); // Escape quotes for HTML attribute
            const shortReason = d.reason.length > 40 ? d.reason.substring(0, 40) + '...' : d.reason;
            reasonHtml = `<span title="${fullReason}" style="font-size:0.8em;cursor:help;display:block;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${shortReason}</span>`;
        }

        // Position % (exact percentage)
        let posPctHtml = '<span class="cell-na">-</span>';
        if (d.position && d.position.position_pct !== undefined) {
            const pct = d.position.position_pct.toFixed(1);
            posPctHtml = `<span style="font-size:0.85em">${pct}%</span>`;
        }

        // Alignment status
        let alignedHtml = '<span class="cell-na">-</span>';
        if (d.multi_period_aligned !== undefined) {
            alignedHtml = d.multi_period_aligned
                ? '<span class="badge pos" title="Multi-period aligned">✅</span>'
                : '<span class="badge neutral" title="Not aligned">➖</span>';
        }

        // Risk & Guardian
        let riskHtml = '<span class="cell-na">-</span>';
        if (d.risk_level) {
            let cls = 'neutral';
            if (d.risk_level === 'safe') cls = 'pos';
            else if (d.risk_level === 'warning') cls = 'warn'; // Assuming css class exists or we use inline
            else if (d.risk_level === 'danger' || d.risk_level === 'fatal') cls = 'neg';
            riskHtml = `<span class="val ${cls}">${d.risk_level.toUpperCase()}</span>`;
        }

        let guardHtml = '<span class="cell-na">-</span>';
        if (d.guardian_passed !== undefined) {
            if (d.guardian_passed) {
                guardHtml = '<span class="badge pos" title="Passed">✅</span>';
            } else {
                const reason = d.guardian_reason || 'Blocked';
                guardHtml = `<span class="badge neg" title="${reason}">⛔</span>`;
            }
        }

        // Render Regime and Position separately
        let regHtml = '-';
        let posHtml = '-';
        if (d.regime && d.position) {
            let reg = (d.regime.regime || 'unknown').toLowerCase();
            if (reg === 'trending_up') reg = 'UP';
            else if (reg === 'trending_down') reg = 'DOWN';
            else if (reg === 'choppy') reg = 'CHOP';
            else reg = reg.toUpperCase().substring(0, 4);

            let pos = (d.position.location || 'unknown').toLowerCase();
            // Simplify position text
            if (pos === 'middle') pos = 'MID';
            else if (pos === 'low') pos = 'LOW';
            else if (pos === 'high') pos = 'HIGH';
            else if (pos === 'upper') pos = 'UPPER';
            else if (pos === 'lower') pos = 'LOWER';
            else pos = pos.toUpperCase().substring(0, 5);

            regHtml = `<span class="badge neutral">${reg}</span>`;
            posHtml = `<span class="badge neutral">${pos}</span>`;
        }

        // Prophet P(Up) - PredictAgent probability
        let prophetHtml = '<span class="cell-na">-</span>';
        if (d.prophet_probability !== undefined && d.prophet_probability !== null) {
            const pUp = (d.prophet_probability * 100).toFixed(0);
            const cls = d.prophet_probability > 0.55 ? 'pos' : (d.prophet_probability < 0.45 ? 'neg' : 'neutral');
            prophetHtml = `<span class="val ${cls}">${pUp}%</span>`;
        }

        return `
            <tr>
                <td>${time}</td>
                <td>${d.cycle_number || '-'}</td>
                <td>${symbol}</td>
                <td class="${actionClass}">${action}</td>
                <td>${conf}</td>
                <td>${reasonHtml}</td>
                <td>${stratHtml}</td>
                <td>${signal1h}</td>
                <td>${signal15m}</td>
                <td>${signal5m}</td>
                <td>${sentHtml}</td>
                <td>${prophetHtml}</td>
                <td>${riskHtml}</td>
                <td>${guardHtml}</td>
                <td>${posPctHtml}</td>
                <td>${alignedHtml}</td>
                <td>${regHtml}</td>
                <td>${posHtml}</td>
            </tr>
        `;
    }).join('');
}

function renderAccount(account) {
    const fmt = num => `$${num.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    // Safety check helper
    const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setTxt('acc-equity', fmt(account.total_equity));
    setTxt('acc-wallet', fmt(account.wallet_balance));
    // Header equity also if exists
    setTxt('header-equity', fmt(account.total_equity));

    // PnL Styling
    const pnlEl = document.getElementById('acc-pnl');
    if (pnlEl) {
        pnlEl.textContent = fmt(account.total_pnl);
        if (account.total_pnl > 0) pnlEl.className = 'val pos';
        else if (account.total_pnl < 0) pnlEl.className = 'val neg';
        else pnlEl.className = 'val neutral';
    }
}

function renderChart(history) {
    if (!equityChart) return;

    // Update data safely
    const times = history.map(h => h.time);
    const values = history.map(h => h.value);

    equityChart.data.labels = times;
    equityChart.data.datasets[0].data = values;
    equityChart.update('none'); // Update without full re-animation for smoothness
}

function updatePositionInfo(account, positions = []) {
    const fmt = num => `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Update position count
    const countEl = document.getElementById('position-count');
    if (countEl) {
        const posCount = positions.length || 0;
        countEl.textContent = `📊 Positions: ${posCount}`;
    }

    // Update position details
    const detailsEl = document.getElementById('position-details');
    if (detailsEl) {
        if (positions && positions.length > 0) {
            detailsEl.innerHTML = positions.map(pos => {
                const pnlClass = pos.pnl > 0 ? 'pos' : (pos.pnl < 0 ? 'neg' : 'neutral');
                return `
                    <div style="display: flex; align-items: center; gap: 8px; padding: 4px 10px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                        <span style="color: #e0e6ed; font-weight: 600;">${pos.symbol}</span>
                        <span style="color: #a0aec0; font-size: 0.8em;">${pos.quantity}</span>
                        <span class="val ${pnlClass}" style="font-size: 0.85em;">${fmt(pos.pnl)}</span>
                    </div>
        `;
            }).join('');
        } else {
            detailsEl.innerHTML = '<span style="color: #718096; font-size: 0.8em;">No open positions</span>';
        }
    }

    // Update total PnL with color
    const pnlEl = document.getElementById('position-pnl');
    if (pnlEl) {
        pnlEl.textContent = `Total PnL: ${fmt(account.total_pnl)}`;
        if (account.total_pnl > 0) {
            pnlEl.className = 'val pos';
        } else if (account.total_pnl < 0) {
            pnlEl.className = 'val neg';
        } else {
            pnlEl.className = 'val neutral';
        }
    }
}

// ... (renderSystemStatus and others remain same)

// Init
initChart();
setInterval(updateDashboard, 2000); // Poll every 2s
updateDashboard();

// Note: Control button event listeners moved to setupEventListeners() at end of file
// Symbol Selector - handled directly in index.html by TradingView loader
// (K-Line chart now dynamically reloads on symbol change)

// Interval Selector
const intervalSelector = document.getElementById('interval-selector');
if (intervalSelector) {
    intervalSelector.addEventListener('change', (e) => {
        const newInterval = e.target.value;
        console.log('Interval changed to:', newInterval, 'minutes');

        // Send interval change to backend
        fetch('/api/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'set_interval', interval: parseInt(newInterval) })
        })
            .then(res => res.json())
            .then(data => {
                console.log('Interval updated:', data);
                alert(`Cycle interval updated to ${newInterval} minutes.\nChanges will take effect on next cycle.`);
            })
            .catch(err => {
                console.error('Failed to update interval:', err);
                alert('Failed to update interval. Please try again.');
            });
    });
}

// Note: sendControl removed - functionality moved to setControl() in setupEventListeners()

function renderSystemStatus(system) {
    const statusEl = document.getElementById('sys-mode');

    // Status Logic
    if (system.mode) {
        statusEl.textContent = system.mode.toUpperCase();

        if (system.mode === 'Running') statusEl.className = 'value badge online';
        else if (system.mode === 'Paused') statusEl.className = 'value badge warning'; // Yellow-ish
        else statusEl.className = 'value badge offline';
    } else {
        // Fallback
        statusEl.textContent = system.running ? "ONLINE" : "OFFLINE";
    }

    // Update Cycle Counter
    const cycleEl = document.getElementById('cycle-counter');
    if (cycleEl && system.cycle_counter !== undefined) {
        cycleEl.textContent = `#${system.cycle_counter}`;
    }

    // Sync Interval Selector with backend value
    const intervalSel = document.getElementById('interval-selector');
    if (intervalSel && system.cycle_interval !== undefined) {
        intervalSel.value = system.cycle_interval.toString();
    }

    // Update Environment Indicator (Test Mode / Live Trading)
    const envEl = document.getElementById('sys-env');
    if (envEl && system.is_test_mode !== undefined) {
        if (system.is_test_mode) {
            envEl.textContent = '🧪 TEST';
            envEl.className = 'value badge warning'; // Yellow for test
            envEl.title = 'Running in test mode - No real trades';
        } else {
            envEl.textContent = '💰 LIVE';
            envEl.className = 'value badge online'; // Green for live
            envEl.title = 'Live trading mode - Real money at risk';
        }
    }
}


function renderMarketData(market) {
    // Removed as per request (Context merged into Table/Logs)
}

function updateTagClass(el, text) {
    text = text.toLowerCase();
    el.className = 'value-tag neutral';

    if (text.includes('bull') || text.includes('trend') || text === 'bullish') {
        el.className = 'value-tag bullish';
    } else if (text.includes('bear') || text.includes('volatile') || text === 'bearish') {
        el.className = 'value-tag bearish';
    }
}

function renderAgents(agents) {
    // Updated IDs function renderAgentVisualizers(agents) {
    // Widgets removed as per user request.
    // Data now shown in Logs and Decision Table.
}

function renderDecision(decision) {
    // Deprecated in V2 (Using Table now)
    // But we might want to highlight latest row if needed.
    // For now, do nothing or update if we kept the card.
    // Since we removed #decision-box from HTML, this function can share empty logic or be removed.
}

function renderLogs(logs) {
    const container = document.getElementById('logs-container');
    if (!container) return;

    // Smart Scroll: Check if user is near bottom before update
    const isScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 100;
    const previousScrollTop = container.scrollTop;

    container.innerHTML = logs.map(logLine => {
        // Strip ANSI colors
        let cleanLine = logLine.replace(/\x1b\[[0-9;]*m/g, '');

        // Parse: [time] message
        let content = cleanLine;
        let time = '';

        const timeMatch = cleanLine.match(/^\[(.*?)\]\s*(.*)/);
        if (timeMatch) {
            time = `<span class="log-time">${timeMatch[1]}</span>`;
            content = timeMatch[2];
        }

        // --- Color Highlighting Rules ---

        // 1. Top-Level Agents (Bold + Specific Color)
        // Oracle (Purple)
        content = content.replace(/DataSyncAgent/g, '<span style="color: #a29bfe; font-weight: bold;">DataSyncAgent</span>');
        content = content.replace(/The Oracle/g, '<span style="color: #a29bfe;">The Oracle</span>');

        // Strategist (Green)
        content = content.replace(/QuantAnalystAgent/g, '<span style="color: #00b894; font-weight: bold;">QuantAnalystAgent</span>');
        content = content.replace(/The Strategist/g, '<span style="color: #00b894;">The Strategist</span>');

        // Critic (Orange/Gold)
        content = content.replace(/DecisionCoreAgent/g, '<span style="color: #fdcb6e; font-weight: bold;">DecisionCoreAgent</span>');
        content = content.replace(/The Critic/g, '<span style="color: #fdcb6e;">The Critic</span>');

        // Guardian (Red)
        content = content.replace(/RiskAuditAgent/g, '<span style="color: #ff7675; font-weight: bold;">RiskAuditAgent</span>');
        content = content.replace(/The Guardian/g, '<span style="color: #ff7675;">The Guardian</span>');

        // Executor (Cyan)
        content = content.replace(/ExecutionEngine/g, '<span style="color: #00cec9; font-weight: bold;">ExecutionEngine</span>');
        content = content.replace(/The Executor/g, '<span style="color: #00cec9;">The Executor</span>');

        // Prophet (Magenta/Pink)
        content = content.replace(/PredictAgent/g, '<span style="color: #e84393; font-weight: bold;">PredictAgent</span>');
        content = content.replace(/The Prophet/g, '<span style="color: #e84393;">The Prophet</span>');

        // 2. Sub-Agents (Lighter Green)
        content = content.replace(/TrendSubAgent/g, '<span style="color: #55efc4;">TrendSubAgent</span>');
        content = content.replace(/OscillatorSubAgent/g, '<span style="color: #55efc4;">OscillatorSubAgent</span>');
        content = content.replace(/SentimentSubAgent/g, '<span style="color: #55efc4;">SentimentSubAgent</span>');

        // 3. Key Actions/Results
        content = content.replace(/Vote: ([A-Z]+)/g, 'Vote: <span style="color: #ffeaa7; font-weight: bold;">$1</span>');
        content = content.replace(/Result: (✅ PASSED)/g, 'Result: <span style="color: #55efc4; font-weight: bold;">✅ PASSED</span>');
        content = content.replace(/Result: (❌ BLOCKED)/g, 'Result: <span style="color: #ff7675; font-weight: bold;">❌ BLOCKED</span>');
        content = content.replace(/Command: ([A-Z]+)/g, 'Command: <span style="color: #74b9ff; font-weight: bold;">$1</span>');

        // 4. Cycle Info (Highlight Cycle #X)
        content = content.replace(/Cycle #(\d+)/g, '<span style="color: #74b9ff; font-weight: bold;">Cycle #$1</span>');

        return `<div class="log-entry">${time} ${content}</div>`;
    }).join('');

    // Auto-scroll to bottom: 
    // - 如果用户没有主动向上滚动（距离底部100px以内），则自动滚动到底部
    // - 首次加载时（scrollTop === 0）也自动滚动到底部
    if (isScrolledToBottom || previousScrollTop === 0) {
        container.scrollTop = container.scrollHeight;
    } else {
        container.scrollTop = previousScrollTop;
    }
}

// Init
initChart();
setupEventListeners();
setInterval(updateDashboard, 2000); // Poll every 2s
updateDashboard();

function setControl(action, payload = {}) {
    fetch('/api/control', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            action: action,
            ...payload
        })
    })
        .then(res => res.json())
        .then(data => {
            console.log(`Command ${action} sent.`, data);
            setTimeout(updateDashboard, 200);
        })
        .catch(err => console.error('Control request failed:', err));
}

// Account Failure Alert Modal
let alertShown = false;

function showAccountAlert(failureCount) {
    if (alertShown) return; // Only show once
    alertShown = true;

    const modal = document.createElement('div');
    modal.id = 'account-alert-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        background: linear-gradient(135deg, #1e1e2e 0%, #2a2a3e 100%);
        border: 2px solid #ff4444;
        border-radius: 12px;
        padding: 30px;
        max-width: 500px;
        box-shadow: 0 10px 40px rgba(255, 68, 68, 0.3);
    `;

    content.innerHTML = `
        <div style="text-align: center;">
            <div style="font-size: 48px; margin-bottom: 20px;">⚠️</div>
            <h2 style="color: #ff4444; margin: 0 0 15px 0; font-size: 24px;">账户信息获取失败</h2>
            <p style="color: #94a3b8; margin: 0 0 10px 0; line-height: 1.6;">
                连续 <strong style="color: #ff4444;">5 分钟</strong> 无法获取账户信息
            </p>
            <p style="color: #64748b; margin: 0 0 25px 0; font-size: 14px;">
                连续失败次数: <span style="color: #ff4444; font-weight: bold;">${failureCount}</span>
            </p>
            <div style="background: rgba(255, 68, 68, 0.1); border-left: 3px solid #ff4444; padding: 15px; margin-bottom: 25px; text-align: left;">
                <p style="margin: 0; color: #e0e6ed; font-size: 14px; line-height: 1.5;">
                    <strong>可能原因:</strong><br>
                    • API 密钥失效或权限不足<br>
                    • 网络连接问题<br>
                    • Binance API 服务异常
                </p>
            </div>
            <button id="close-alert-btn" style="
                background: linear-gradient(135deg, #ff4444 0%, #cc0000 100%);
                color: white;
                border: none;
                padding: 12px 30px;
                border-radius: 6px;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                transition: all 0.3s;
            ">
                我知道了
            </button>
        </div>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    document.getElementById('close-alert-btn').addEventListener('click', () => {
        modal.remove();
        alertShown = false; // Allow showing again if issue persists
    });
}

function setupEventListeners() {
    const btnStart = document.getElementById('btn-start');
    if (btnStart) btnStart.addEventListener('click', () => setControl('start'));

    const btnPause = document.getElementById('btn-pause');
    if (btnPause) btnPause.addEventListener('click', () => setControl('pause'));

    const btnStop = document.getElementById('btn-stop');
    if (btnStop) btnStop.addEventListener('click', () => setControl('stop'));

    const btnRestart = document.getElementById('btn-restart');
    if (btnRestart) btnRestart.addEventListener('click', () => setControl('restart'));

    const intervalSel = document.getElementById('interval-selector');
    if (intervalSel) {
        intervalSel.addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            setControl('set_interval', { interval: val });
        });
    }
}
