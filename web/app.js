const API_URL = '/api/status';

// 🔐 Global API fetch wrapper - ensures cookies are sent in HTTPS environments (Railway)
async function apiFetch(url, options = {}) {
    const defaultOptions = {
        credentials: 'include',  // CRITICAL: Required for cookies in cross-origin HTTPS
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    };
    return fetch(url, defaultOptions);
}

// 🌐 Language Management (exposed to window for global access)
window.currentLang = localStorage.getItem('language') || 'en';

// 🎯 Demo Mode Tracking (moved to top to avoid TDZ error)
let demoExpiredShown = false;
window.backendIsTestMode = true;

// Apply translations to elements with data-i18n attribute
function applyTranslations(lang) {
    if (!window.i18n || !window.i18n[lang]) {
        console.warn('i18n not loaded or language not found:', lang);
        return;
    }

    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (window.i18n[lang][key]) {
            // Preserve icons if they exist (with Unicode flag to handle multibyte emojis)
            const icon = el.textContent.match(/^[🌐⚙️🚪📉📈📋📜📡⏹️⏸️▶️🧪💰📊]/u);
            const translation = window.i18n[lang][key];
            el.textContent = icon ? icon[0] + ' ' + translation.replace(/^[🌐⚙️🚪📉📈📋📜📡⏹️⏸️▶️🧪💰📊]\s*/u, '') : translation;
        }
    });
}

function getI18n(key, fallback = '') {
    const lang = window.currentLang || 'en';
    return window.i18n?.[lang]?.[key] || fallback;
}

function updateChartLabels() {
    if (!equityChart) return;
    const isPnl = equityChart?.canvas?.dataset?.chartMode === 'pnl';
    equityChart.data.datasets[0].label = isPnl
        ? getI18n('chart.profit', 'Total Profit')
        : getI18n('chart.balance', 'Balance (USDT)');
    if (equityChart.data.datasets[1]) {
        equityChart.data.datasets[1].label = isPnl
            ? getI18n('chart.break_even', 'Break-even')
            : getI18n(curveBaselineLabelKey || 'chart.initial', 'Initial Balance');
    }
    equityChart.update('none');
}

// Toggle language between EN and ZH
function toggleLanguage() {
    console.log('🌐 Language toggle triggered');
    window.currentLang = window.currentLang === 'en' ? 'zh' : 'en';
    localStorage.setItem('language', window.currentLang);
    applyTranslations(window.currentLang);
    updateLanguageButton();
    updateChartLabels();
}


// Update language button text
function updateLanguageButton() {
    const langText = document.getElementById('lang-text');
    if (langText) {
        langText.textContent = window.currentLang === 'en' ? '中文' : 'EN';
    }
}

function updateDataSyncLabels(timeframes) {
    const labels = ['label-tf-1', 'label-tf-2', 'label-tf-3'];
    const fallback = ['5m', '15m', '1h'];
    const resolved = Array.isArray(timeframes) && timeframes.length > 0 ? timeframes : fallback;
    labels.forEach((id, index) => {
        const el = document.getElementById(id);
        if (!el) return;
        const tf = resolved[index] || `TF${index + 1}`;
        el.textContent = `${tf}:`;
    });
    return resolved;
}

// Chart Instance
let equityChart = null;
let realtimeBalanceHistory = [];
let lastCycleCounter = null;
let curveBaselineBalance = null;
let curveBaselineTime = null;
let curveBaselineLabelKey = 'chart.initial';
let balanceSessionKey = null;
let baselineLoadedFromStorage = false;
const BASELINE_STORAGE_PREFIX = 'rtBalanceBaseline:';
const FIXED_INITIAL_BALANCE = 1000;

const CHART_COLORS = {
    pos: { line: '#00ff9d', fillTop: 'rgba(0, 255, 157, 0.35)', fillBottom: 'rgba(0, 255, 157, 0.02)' },
    neg: { line: '#ff5b5b', fillTop: 'rgba(255, 91, 91, 0.3)', fillBottom: 'rgba(255, 91, 91, 0.02)' },
    neutral: { line: '#a1b4c6', fillTop: 'rgba(161, 180, 198, 0.25)', fillBottom: 'rgba(161, 180, 198, 0.02)' }
};

function formatCurrency(value) {
    const num = Number(value) || 0;
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function extractTimeLabel(label) {
    if (!label) return '';
    const str = String(label);
    const match = str.match(/(\d{2}:\d{2})(?::\d{2})?/);
    return match ? match[1] : str;
}

function extractDateTimeLabel(label) {
    if (!label) return '';
    const str = String(label);
    const match = str.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?/);
    return match ? `${match[1]} ${match[2]}` : str;
}

function formatTimestamp(date = new Date()) {
    const pad = (num) => String(num).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function getBalanceSessionKey(system) {
    if (!system) return null;
    const key = system.uptime_start || system.current_cycle_id || '';
    return key ? `session:${key}` : null;
}

function loadBaselineFromStorage(sessionKey) {
    if (!sessionKey) return null;
    try {
        const raw = localStorage.getItem(`${BASELINE_STORAGE_PREFIX}${sessionKey}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        if (!Number.isFinite(parsed.balance)) return null;
        if (!parsed.time || typeof parsed.time !== 'string') return null;
        return parsed;
    } catch {
        return null;
    }
}

function saveBaselineToStorage(sessionKey, baseline) {
    if (!sessionKey || !baseline) return;
    try {
        localStorage.setItem(`${BASELINE_STORAGE_PREFIX}${sessionKey}`, JSON.stringify(baseline));
    } catch {
        // Ignore storage failures
    }
}

function clearBaselineFromStorage(sessionKey) {
    if (!sessionKey) return;
    try {
        localStorage.removeItem(`${BASELINE_STORAGE_PREFIX}${sessionKey}`);
    } catch {
        // Ignore storage failures
    }
}

function initChart() {
    // Destroy existing chart if it exists to prevent "Canvas is already in use" error
    if (equityChart) {
        equityChart.destroy();
        equityChart = null;
    }

    const canvas = document.getElementById('equityChart');
    if (!canvas) return;
    const chartMode = canvas.dataset.chartMode || 'equity';
    const isPnl = chartMode === 'pnl';
    const ctx = canvas.getContext('2d');
    equityChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: isPnl
                    ? getI18n('chart.profit', 'Total Profit')
                    : getI18n('chart.balance', 'Balance (USDT)'),
                data: [],
                borderColor: (context) => context.dataset.customLineColor || CHART_COLORS.pos.line,
                backgroundColor: (context) => {
                    const { chart } = context;
                    const { chartArea } = chart;
                    if (!chartArea) return CHART_COLORS.pos.fillTop;
                    const top = context.dataset.customFillTop || CHART_COLORS.pos.fillTop;
                    const bottom = context.dataset.customFillBottom || CHART_COLORS.pos.fillBottom;
                    const gradient = chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                    gradient.addColorStop(0, top);
                    gradient.addColorStop(1, bottom);
                    return gradient;
                },
                borderWidth: 2.4,
                fill: true,
                tension: 0.35,
                pointRadius: (context) => {
                    const len = context.dataset.data ? context.dataset.data.length : 0;
                    return context.dataIndex === len - 1 ? 3.5 : 0;
                },
                pointHoverRadius: 5,
                pointHitRadius: 12,
                pointBorderWidth: 2,
                pointBorderColor: 'rgba(6, 10, 16, 0.9)'
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
                    backgroundColor: 'rgba(10, 12, 18, 0.95)',
                    titleColor: '#cbd5f5',
                    bodyColor: '#eef3ff',
                    borderColor: 'rgba(255, 255, 255, 0.15)',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        title: function (items) {
                            return items && items[0] ? extractDateTimeLabel(items[0].label) : '';
                        },
                        label: function (context) {
                            const label = context.dataset.label || '';
                            return `${label}: ${formatCurrency(context.parsed.y)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'category',  // 🔧 Category type prevents auto-scaling drift
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: {
                        color: '#94a3b8',
                        maxRotation: 0,
                        minRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 8,  // Limit to prevent crowding
                        callback: function (value, index, ticks) {
                            // 🔧 Display time label (extract HH:MM from timestamp)
                            const label = this.getLabelForValue(value);
                            return extractTimeLabel(label);
                        }
                    }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: {
                        color: '#94a3b8',
                        callback: (value) => formatCurrency(value)
                    },
                    beginAtZero: true
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            elements: {
                line: { borderCapStyle: 'round', borderJoinStyle: 'round' }
            }
        }
    });
}


// 全局存储决策历史以便过滤
let allDecisionHistory = [];
let currentActivePositions = []; // To share with table renderer

// Helper to verify role permission
function verifyRole() {
    const role = localStorage.getItem('user_role');
    console.log('🔐 Verifying Role:', role);
    if (!role || role === 'user') {
        alert("User mode: No permission to perform this action.");
        return false;
    }
    return true;
}

// Apply UI restrictions based on user role
function applyRoleRestrictions() {
    const role = localStorage.getItem('user_role');
    console.log('🎨 Applying UI restrictions for role:', role);

    if (!role || role === 'user') {
        // User role: Disable all controls
        const controlButtons = [
            'btn-start',
            'btn-pause',
            'btn-stop',
            'btn-settings',
            'btn-logout',
            'interval-selector'
        ];

        controlButtons.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.disabled = true;
                element.style.opacity = '0.4';
                element.style.cursor = 'not-allowed';
                element.title = 'User mode: Read-only access';
            }
        });

        console.log('✅ User role restrictions applied');
    } else {
        console.log('✅ Admin role: Full access granted');
    }
}

// Logout Function
window.logout = function () {
    if (!verifyRole()) return;

    if (confirm('Are you sure you want to logout?')) {
        apiFetch('/api/logout', { method: 'POST' })
            .then(() => {
                localStorage.removeItem('user_role');  // Clear role on logout
                window.location.href = '/login';
            })
            .catch(err => console.error(err));
    }
};

function getPreferredSymbol(system, decisionMap) {
    const selector = document.getElementById('symbol-selector');
    if (selector && selector.value) return selector.value;
    if (system && system.current_symbol) return system.current_symbol;
    if (system && Array.isArray(system.symbols) && system.symbols.length > 0) {
        return system.symbols[0];
    }
    const keys = decisionMap ? Object.keys(decisionMap) : [];
    if (keys.length > 0) return keys[0];
    return window.lastChartSymbol || null;
}

function normalizeDecision(decision, system) {
    if (!decision) return null;
    if (decision.action !== undefined) return decision;
    if (typeof decision === 'object') {
        const symbol = getPreferredSymbol(system, decision);
        if (symbol && decision[symbol]) return decision[symbol];
        const keys = Object.keys(decision);
        return keys.length > 0 ? decision[keys[0]] : null;
    }
    return null;
}

function buildDecisionMap(decision, history) {
    const merged = {};
    if (decision && typeof decision === 'object') {
        if (decision.action !== undefined) {
            const symbol = decision.symbol || 'UNKNOWN';
            merged[symbol] = decision;
        } else {
            Object.keys(decision).forEach(key => {
                merged[key] = decision[key];
            });
        }
    }

    if (Array.isArray(history)) {
        history.forEach(entry => {
            if (entry && entry.symbol && merged[entry.symbol] === undefined) {
                merged[entry.symbol] = entry;
            }
        });
    }

    return merged;
}

function updateDashboard() {
    apiFetch(API_URL)
        .then(response => {
            if (response.status === 401 || response.status === 403) {
                // Session expired or unauthorized - clear stale role
                localStorage.removeItem('user_role');
                window.location.href = '/login';
                throw new Error("Unauthorized");
            }
            return response.json();
        })
        .then(data => {
            const decisionMap = buildDecisionMap(data.decision, data.decision_history);
            const currentDecision = normalizeDecision(decisionMap, data.system) || data.decision_history?.[0] || null;
            window.latestDecisionHistory = Array.isArray(data.decision_history) ? data.decision_history : [];
            renderSystemStatus(data.system);
            renderMarketData(data.market);
            renderAgents(data.agents);
            renderDecision(currentDecision);
            renderLogs(data.logs, data.logs_simplified);

            // 🆕 Update Agent Framework Visualization
            if (data.system) {
                updateAgentFramework(data.system, currentDecision, data.agents);
                if (Array.isArray(data.system.timeframes) && data.system.timeframes.length > 0) {
                    window.strategyTimeframes = data.system.timeframes;
                }
                const sessionKey = getBalanceSessionKey(data.system);
                if (sessionKey && sessionKey !== balanceSessionKey) {
                    balanceSessionKey = sessionKey;
                    realtimeBalanceHistory = [];
                    lastCycleCounter = null;
                    curveBaselineBalance = null;
                    curveBaselineTime = null;
                    curveBaselineLabelKey = 'chart.initial';
                    baselineLoadedFromStorage = false;
                    const stored = loadBaselineFromStorage(balanceSessionKey);
                    if (stored) {
                        curveBaselineBalance = stored.balance;
                        curveBaselineTime = stored.time;
                        curveBaselineLabelKey = stored.labelKey || 'chart.cycle_start';
                        baselineLoadedFromStorage = true;
                    }
                }
            }

            // 🆕 Update K-Line symbol selector with active trading symbols
            if (data.system && data.system.symbols) {
                updateSymbolSelector(data.system.symbols);
                updateDecisionFilter(data.system.symbols);  // 🆕 Also update decision filter
            }
            const selectorInfo = data.agents?.symbol_selector || {};
            const selectorMode = (selectorInfo.mode || '').toUpperCase();
            const selectorSymbol = selectorInfo.symbol && selectorInfo.symbol !== '--' ? selectorInfo.symbol : null;
            const autoSymbol = selectorMode.startsWith('AUTO') ? selectorSymbol : null;
            const agentSymbol = selectorSymbol || autoSymbol || null;

            // Log symbol selector info for debugging
            if (autoSymbol) {
                console.log(`📊 Symbol Selector: mode=${selectorMode}, symbol=${autoSymbol}`);
            }

            const symbolSelectorEl = document.getElementById('symbol-selector');
            if (autoSymbol && symbolSelectorEl) {
                if (Array.isArray(data.system?.symbols) && data.system.symbols.includes(autoSymbol)) {
                    symbolSelectorEl.value = autoSymbol;
                }
            }

            const preferredSymbol = getPreferredSymbol(data.system, decisionMap);
            const headerSymbol = agentSymbol
                || (data.system && data.system.current_symbol)
                || preferredSymbol
                || currentDecision?.symbol
                || (Array.isArray(data.system?.symbols) && data.system.symbols.length > 0 ? data.system.symbols[0] : null);
            if (headerSymbol) {
                const symbolDisplayText = document.getElementById('symbol-display-text');
                if (symbolDisplayText) {
                    symbolDisplayText.textContent = headerSymbol;
                }
            }

            // Priority: AUTO symbol > header symbol > preferred symbol
            const chartSymbol = agentSymbol || headerSymbol || preferredSymbol;
            if (chartSymbol
                && typeof loadTradingViewChart === 'function'
                && chartSymbol !== window.lastChartSymbol) {
                console.log(`📈 Chart Update: ${window.lastChartSymbol || 'none'} → ${chartSymbol}`);
                loadTradingViewChart(chartSymbol);
            }

            updateDataSyncLabels(window.strategyTimeframes);

            // New Renderers
            // Account & Positions Logic
            let activeAccount = data.account;
            let activePositions = data.positions || [];

            if (data.system && data.system.is_test_mode && data.virtual_account) {
                // Construct account object compatible with renderAccount
                const va = data.virtual_account;
                const unrealized = va.total_unrealized_pnl || 0;
                const realizedPnl = va.cumulative_realized_pnl || 0;  // For reference display
                const initialBalance = va.initial_balance || 0;
                // Total Equity = Current Balance (already includes realized PnL) + Unrealized PnL
                const totalEquity = va.current_balance + unrealized;
                // Total PnL = Total Equity - Initial Balance (most accurate formula)
                // Note: current_balance already includes realized PnL from closed trades
                const totalPnl = totalEquity - initialBalance;
                activeAccount = {
                    total_equity: totalEquity,
                    wallet_balance: va.current_balance,
                    available_balance: va.available_balance || va.current_balance,  // 可用余额 = 资金 - 持仓
                    total_pnl: totalPnl,  // ✅ Accurate: Equity - Initial
                    initial_balance: initialBalance, // ✅ Explicitly pass Initial Balance
                    realized_pnl: realizedPnl,  // For potential separate display
                    unrealized_pnl: unrealized   // For potential separate display
                };

                // Convert virtual positions dict to array for UI
                if (va.positions) {
                    activePositions = Object.entries(va.positions).map(([sym, details]) => ({
                        symbol: sym,
                        quantity: details.quantity,
                        entry_price: details.entry_price,
                        pnl: details.unrealized_pnl || 0,
                        side: details.side,
                        leverage: details.leverage || 1
                    }));
                }
            }

            if (activeAccount) {
                renderAccount(activeAccount);
                updatePositionInfo(activeAccount, activePositions);
            }
            const balanceSnapshot = updateRealtimeBalance({
                account: activeAccount,
                system: data.system,
                virtualAccount: data.virtual_account,
                chartData: data.chart_data,
                positions: activePositions,
                trades: data.trade_history || []
            });
            updateAccountTradeStats(data.trade_history || []);

            // Determine Initial Amount for Chart Baseline
            let initialAmount = null;
            if (data.system && data.system.is_test_mode && data.virtual_account) {
                initialAmount = data.virtual_account.initial_balance;
            } else if (activeAccount) {
                // For live, use wallet_balance (Realized Equity) roughly as baseline, 
                // OR if we had a stored 'starting_balance' in backend.
                // Ideally simply using the first point of the day would be better, 
                // but here we use Wallet Balance as the "Center" anchor if no specific starting point.
                // Actually, let's try to trust the first point of the chart if this is null?
                // No, user specifically asked for "Initial Amount". In Test it's clear.
                // In Live, it changes. Let's use Wallet Balance as the "0 PnL" line for current active positions?
                // Yes, Wallet Balance = Equity - Unrealized PnL. So Equity fluctuates around Wallet Balance.
                initialAmount = activeAccount.wallet_balance;
            }

            const cycleCounter = Number(data.system?.cycle_counter ?? NaN);
            if (Number.isFinite(cycleCounter)) {
                if (lastCycleCounter !== null && cycleCounter < lastCycleCounter) {
                    realtimeBalanceHistory = [];
                    curveBaselineBalance = null;
                    curveBaselineTime = null;
                    curveBaselineLabelKey = 'chart.initial';
                    baselineLoadedFromStorage = false;
                    clearBaselineFromStorage(balanceSessionKey);
                }

                if (cycleCounter === 1 && lastCycleCounter !== 1 && !baselineLoadedFromStorage) {
                    realtimeBalanceHistory = [];
                    curveBaselineBalance = null;
                    curveBaselineTime = null;
                    curveBaselineLabelKey = 'chart.cycle_start';
                }

                if (cycleCounter === 1 && curveBaselineBalance === null && balanceSnapshot) {
                    curveBaselineBalance = balanceSnapshot.realtimeBalance;
                    curveBaselineTime = formatTimestamp();
                    saveBaselineToStorage(balanceSessionKey, {
                        balance: curveBaselineBalance,
                        time: curveBaselineTime,
                        labelKey: curveBaselineLabelKey
                    });
                }

                if (cycleCounter >= 1 && curveBaselineBalance === null && balanceSnapshot) {
                    curveBaselineBalance = balanceSnapshot.realtimeBalance;
                    curveBaselineTime = formatTimestamp();
                    curveBaselineLabelKey = 'chart.cycle_start';
                    saveBaselineToStorage(balanceSessionKey, {
                        balance: curveBaselineBalance,
                        time: curveBaselineTime,
                        labelKey: curveBaselineLabelKey
                    });
                }

                lastCycleCounter = cycleCounter;
            }

            const tradeHistory = Array.isArray(data.trade_history) ? data.trade_history : [];
            const baseline = Number.isFinite(balanceSnapshot?.initial)
                ? balanceSnapshot.initial
                : FIXED_INITIAL_BALANCE;
            const tradeCurve = buildBalanceSeriesFromTrades(tradeHistory, baseline);

            if (tradeCurve.length) {
                realtimeBalanceHistory = tradeCurve;
            } else {
                realtimeBalanceHistory = [];
            }

            if (!realtimeBalanceHistory.length) {
                realtimeBalanceHistory.push({
                    time: formatTimestamp(),
                    value: baseline
                });
            }

            if (balanceSnapshot) {
                const point = {
                    time: formatTimestamp(),
                    value: balanceSnapshot.realtimeBalance
                };
                if (!realtimeBalanceHistory.length || realtimeBalanceHistory[realtimeBalanceHistory.length - 1].time !== point.time) {
                    realtimeBalanceHistory.push(point);
                    if (realtimeBalanceHistory.length > 200) {
                        realtimeBalanceHistory.shift();
                    }
                }
            }

            if (realtimeBalanceHistory.length) {
                renderChart(realtimeBalanceHistory, baseline);
            }

            // Layout v2 Renderers with Filtering
            if (data.decision_history) {
                allDecisionHistory = data.decision_history;
                currentActivePositions = activePositions; // Update global
                applyDecisionFilters(); // 应用当前过滤条件
            }
            if (data.trade_history) renderTradeHistory(data.trade_history);

            // Check for account fetch failure alert
            if (data.account_alert && data.account_alert.active) {
                showAccountAlert(data.account_alert.failure_count);
            }

            // Handle Demo Mode Timer and Expiration
            if (data.demo) {
                handleDemoMode(data.demo);
            }
        })
        .catch(err => {
            console.error('Error fetching data:', err);
            // Optional: Show offline status in UI?
        });
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

    renderDecisionTable(filtered, currentActivePositions);
}

// 过滤器事件监听
document.getElementById('filter-symbol')?.addEventListener('change', applyDecisionFilters);
document.getElementById('filter-result')?.addEventListener('change', applyDecisionFilters);




function renderDecisionTable(history, positions = []) {
    const tbody = document.querySelector('#decision-table tbody');
    if (!tbody) return;

    tbody.innerHTML = history.map(d => {
        // 显示日期+时间 (MM-DD HH:MM:SS)
        let time = d.timestamp || 'Just now';
        if (time.includes(' ')) {
            const parts = time.split(' ');
            if (parts.length >= 2) {
                // 提取日期的月-日部分和时间
                const datePart = parts[0].split('-').slice(1).join('-'); // 提取 MM-DD
                const timePart = parts[1]; // HH:MM:SS
                time = `${datePart} ${timePart}`;
            }
        }
        const symbol = d.symbol || 'BTCUSDT';
        const action = (d.action || 'HOLD').toUpperCase();
        const conf = d.confidence ? ((d.confidence > 1 ? d.confidence : d.confidence * 100).toFixed(0) + '%') : '-';

        let actionClass = 'action-hold';
        if (action.includes('LONG') || action.includes('BUY')) actionClass = 'action-buy';
        else if (action.includes('SHORT') || action.includes('SELL')) actionClass = 'action-sell';

        // === NEW: Four-Layer Status ===
        let layersHtml = '<span class="cell-na">-</span>';
        if (d.four_layer_status) {
            const l1 = d.four_layer_status.layer1_pass;
            const l2 = d.four_layer_status.layer2_pass;
            const l3 = d.four_layer_status.layer3_pass;
            const l4 = d.four_layer_status.layer4_pass;
            const blocking = d.four_layer_status.blocking_reason || '';

            const icon = (pass) => pass === true ? '✅' : (pass === false ? '❌' : '⏳');
            const allPass = l1 && l2 && l3 && l4;
            const cls = allPass ? 'pos' : 'neg';

            layersHtml = `<span class="val ${cls}" title="L1:${icon(l1)} L2:${icon(l2)} L3:${icon(l3)} L4:${icon(l4)}\n${blocking}" style="font-size:0.75em;cursor:help">
                ${icon(l1)}${icon(l2)}${icon(l3)}${icon(l4)}
            </span>`;
        }

        // === NEW: ADX Value ===
        let adxHtml = '<span class="cell-na">-</span>';
        if (d.regime && d.regime.adx !== undefined) {
            const adx = parseFloat(d.regime.adx).toFixed(0);
            let cls = 'neutral';
            let label = 'WEAK';
            if (adx >= 25) { cls = 'pos'; label = 'TREND'; }
            else if (adx < 20) { cls = 'neg'; label = 'CHOP'; }
            adxHtml = `<span class="val ${cls}" title="ADX: ${adx}" style="font-size:0.8em">${adx}<br/>${label}</span>`;
        }

        // === NEW: OI Fuel ===
        let oiHtml = '<span class="cell-na">-</span>';
        if (d.vote_details && d.vote_details.oi_fuel) {
            const oi = d.vote_details.oi_fuel;
            if (oi.data_error) {
                oiHtml = `<span class="val neg" title="OI Data Error: ${oi.anomaly_value}%" style="font-size:0.75em">⚠️ERR</span>`;
            } else {
                const change = oi.oi_change_24h !== null ? parseFloat(oi.oi_change_24h).toFixed(1) : '?';
                const strength = oi.fuel_strength || 'unknown';
                let cls = strength === 'strong' ? 'pos' : (strength === 'weak' ? 'neg' : 'neutral');
                let icon = strength === 'strong' ? '🔥' : (strength === 'weak' ? '💨' : '➖');
                oiHtml = `<span class="val ${cls}" title="OI: ${change}%, Fuel: ${strength}" style="font-size:0.8em">${icon}${change}%</span>`;
            }
        } else if (d.vote_details && d.vote_details.sentiment !== undefined) {
            // Fallback to sentiment
            const score = Math.round(d.vote_details.sentiment);
            const icon = score > 30 ? '📈' : (score < -30 ? '📉' : '➖');
            const cls = score > 30 ? 'pos' : (score < -30 ? 'neg' : 'neutral');
            oiHtml = `<span class="val ${cls}" title="Sentiment: ${score}" style="font-size:0.8em">${icon}${score}</span>`;
        }

        // Regime with semantic icons
        let regHtml = '<span class="cell-na">-</span>';
        if (d.regime && d.regime.regime) {
            let reg = (d.regime.regime || 'unknown').toLowerCase();
            let icon = '➖';
            let text = 'UNK';
            let cls = 'neutral';

            if (reg.includes('up') || reg.includes('bull')) {
                icon = '📈'; text = 'UP'; cls = 'pos';
            } else if (reg.includes('down') || reg.includes('bear')) {
                icon = '📉'; text = 'DN'; cls = 'neg';
            } else if (reg.includes('chop') || reg.includes('sideways')) {
                icon = '〰️'; text = 'CHOP'; cls = 'neutral';
            } else if (reg.includes('volatile') || reg.includes('directionless')) {
                icon = '⚡'; text = 'VOL'; cls = 'warn';
            }

            regHtml = `<span class="val ${cls}" title="${d.regime.regime}\n${d.regime.reason || ''}" style="font-size:0.8em;cursor:help">${icon}${text}</span>`;
        }

        // Position with semantic icons
        let posHtml = '<span class="cell-na">-</span>';
        // Fallback: try d.position first, then d.regime if it has position_pct
        let positionData = d.position || (d.regime && d.regime.position_pct !== undefined ? d.regime : null);
        if (positionData && positionData.location) {
            let pos = (positionData.location || 'unknown').toLowerCase();
            let icon = '➖';
            let cls = 'neutral';

            if (pos.includes('high') || pos.includes('upper')) {
                icon = '🔝'; cls = 'warn';
            } else if (pos.includes('low') || pos.includes('lower')) {
                icon = '🔻'; cls = 'pos';
            }

            let posPct = positionData.position_pct !== undefined ? parseFloat(positionData.position_pct).toFixed(0) : '?';
            posHtml = `<span class="val ${cls}" title="${positionData.location}: ${posPct}%" style="font-size:0.8em">${icon}${posPct}%</span>`;
        }

        // === NEW: KDJ Zone ===
        let zoneHtml = '<span class="cell-na">-</span>';
        if (d.vote_details && d.vote_details.kdj_zone) {
            const zone = d.vote_details.kdj_zone.toLowerCase();
            let icon = '➖';
            let text = 'MID';
            let cls = 'neutral';
            if (zone.includes('overbought') || zone.includes('high')) {
                icon = '🔴'; text = 'OB'; cls = 'neg';
            } else if (zone.includes('oversold') || zone.includes('low')) {
                icon = '🟢'; text = 'OS'; cls = 'pos';
            }
            zoneHtml = `<span class="val ${cls}" title="KDJ Zone: ${zone}" style="font-size:0.8em">${icon}${text}</span>`;
        }

        // === NEW: Trigger Signal ===
        let signalHtml = '<span class="cell-na">-</span>';
        if (d.four_layer_status && d.four_layer_status.layer4_pass !== undefined) {
            const pass = d.four_layer_status.layer4_pass;
            const pattern = d.trigger_pattern || d.four_layer_status?.trigger_pattern || d.vote_details?.trigger_pattern || '';
            if (pass) {
                signalHtml = `<span class="val pos" title="Trigger: ${pattern || 'CONFIRMED'}" style="font-size:0.8em">✅GO</span>`;
            } else {
                signalHtml = `<span class="val neutral" title="Waiting for trigger" style="font-size:0.8em">⏳WAIT</span>`;
            }
        }

        // Prophet P(Up) with icon
        let prophetHtml = '<span class="cell-na">-</span>';
        if (d.prophet_probability !== undefined && d.prophet_probability !== null) {
            const pUp = (d.prophet_probability * 100).toFixed(0);
            const cls = d.prophet_probability > 0.55 ? 'pos' : (d.prophet_probability < 0.45 ? 'neg' : 'neutral');
            const icon = d.prophet_probability > 0.55 ? '↗' : (d.prophet_probability < 0.45 ? '↘' : '➖');
            prophetHtml = `<span class="val ${cls}" title="ML Prediction" style="font-size:0.8em">🔮${icon}<br/>${pUp}%</span>`;
        }

        // 🐂🐻 Bull/Bear Agent
        let bullHtml = '<span class="cell-na">-</span>';
        let bearHtml = '<span class="cell-na">-</span>';
        if (d.vote_details) {
            const bullConf = d.vote_details.bull_confidence;
            const bearConf = d.vote_details.bear_confidence;
            const bullStance = d.vote_details.bull_stance || 'UNKNOWN';
            const bearStance = d.vote_details.bear_stance || 'UNKNOWN';

            const stanceAbbr = {
                'STRONGLY_BULLISH': '🔥',
                'SLIGHTLY_BULLISH': '↗',
                'STRONGLY_BEARISH': '🔥',
                'SLIGHTLY_BEARISH': '↘',
                'NEUTRAL': '➖',
                'UNCERTAIN': '❓',
                'UNKNOWN': '?'
            };

            if (bullConf !== undefined) {
                const bullCls = bullConf > 60 ? 'pos' : (bullConf < 40 ? 'neg' : 'neutral');
                const bullIcon = stanceAbbr[bullStance] || '?';
                bullHtml = `<span class="val ${bullCls}" title="${bullStance}" style="font-size:0.8em">${bullIcon}${bullConf}%</span>`;
            }
            if (bearConf !== undefined) {
                const bearCls = bearConf > 60 ? 'neg' : (bearConf < 40 ? 'pos' : 'neutral');
                const bearIcon = stanceAbbr[bearStance] || '?';
                bearHtml = `<span class="val ${bearCls}" title="${bearStance}" style="font-size:0.8em">${bearIcon}${bearConf}%</span>`;
            }
        }

        // Reason (truncated with tooltip)
        let reasonHtml = '<span class="cell-na">-</span>';
        if (d.reason) {
            const fullReason = d.reason.replace(/"/g, '&quot;');
            const shortReason = d.reason.length > 60 ? d.reason.substring(0, 60) + '...' : d.reason;
            reasonHtml = `<span title="${fullReason}" style="font-size:0.75em;cursor:help;display:block;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${shortReason}</span>`;
        }

        // Guardian (merged with Risk + Aligned)
        let guardHtml = '<span class="cell-na">-</span>';
        if (d.guardian_passed !== undefined) {
            const riskLevel = d.risk_level || 'unknown';
            const aligned = d.multi_period_aligned;
            const reason = (d.guardian_reason || '').replace(/"/g, '&quot;');

            let riskIcon = '⚠️';
            if (riskLevel === 'safe') riskIcon = '✅';
            else if (riskLevel === 'danger' || riskLevel === 'fatal') riskIcon = '🚨';

            if (d.guardian_passed) {
                guardHtml = `<span class="badge pos" title="Risk: ${riskLevel}, Aligned: ${aligned ? 'Yes' : 'No'}" style="cursor:help">${riskIcon}PASS</span>`;
            } else {
                guardHtml = `<span class="badge neg" title="${reason}\nRisk: ${riskLevel}" style="cursor:help">⛔BLOCK</span>`;
            }
        }

        return `
            <tr>
                <td>${time}</td>
                <td>${d.cycle_number || '-'}</td>
                <td>${symbol}</td>
                <td>${layersHtml}</td>
                <td>${adxHtml}</td>
                <td>${oiHtml}</td>
                <td>${regHtml}</td>
                <td>${posHtml}</td>
                <td>${zoneHtml}</td>
                <td>${signalHtml}</td>
                <td>${prophetHtml}</td>
                <td>${bullHtml}</td>
                <td>${bearHtml}</td>
                <td class="${actionClass}">${action}</td>
                <td>${conf}</td>
                <td>${reasonHtml}</td>
                <td>${guardHtml}</td>
            </tr>
        `;
    }).join('');
}

function renderAccount(account) {
    const fmt = num => `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Safety check helper
    const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    // Calculate based on Total PnL (Total PnL = Equity - Initial)
    // So: Initial = Equity - Total PnL
    let initialBalance;
    if (account.initial_balance !== undefined) {
        initialBalance = account.initial_balance;
    } else {
        initialBalance = account.total_equity - account.total_pnl;
    }

    const totalEquity = account.total_equity || 0;
    const walletBalance = account.wallet_balance || 0;
    const availableBalance = account.available_balance || walletBalance;  // 可用余额
    const totalPnl = account.total_pnl || 0;

    setTxt('acc-equity', fmt(totalEquity));
    setTxt('header-equity', fmt(totalEquity));
    setTxt('account-wallet-balance', fmt(walletBalance));
    setTxt('account-available-balance', fmt(availableBalance));  // 显示可用余额
    setTxt('acc-initial', fmt(initialBalance));

    // PnL calculation and styling
    const pnlElement = document.getElementById('acc-pnl');
    if (pnlElement) {
        pnlElement.textContent = fmt(totalPnl);
        pnlElement.classList.remove('pos', 'neg', 'neutral');
        if (totalPnl > 0) {
            pnlElement.classList.add('pos');
        } else if (totalPnl < 0) {
            pnlElement.classList.add('neg');
        } else {
            pnlElement.classList.add('neutral');
        }
    }

    // PnL percentage calculation and styling
    const pnlPctElement = document.getElementById('account-total-pnl-pct');
    if (pnlPctElement && initialBalance > 0) {
        const pnlPct = (totalPnl / initialBalance) * 100;
        pnlPctElement.textContent = `${pnlPct.toFixed(2)}%`;
        pnlPctElement.classList.remove('pos', 'neg', 'neutral');
        if (pnlPct > 0) {
            pnlPctElement.classList.add('pos');
        } else if (pnlPct < 0) {
            pnlPctElement.classList.add('neg');
        } else {
            pnlPctElement.classList.add('neutral');
        }
    } else if (pnlPctElement) {
        pnlPctElement.textContent = '0.00%';
        pnlPctElement.classList.remove('pos', 'neg', 'neutral');
        pnlPctElement.classList.add('neutral');
    }
}

function sumUnrealizedFromPositions(positions = []) {
    if (!Array.isArray(positions) || positions.length === 0) return 0;
    return positions.reduce((sum, pos) => sum + (Number(pos?.pnl) || 0), 0);
}

function isTradeClosed(trade) {
    if (!trade || typeof trade !== 'object') return false;
    const status = String(trade.status || '').toUpperCase();
    const action = String(trade.action || '').toUpperCase();
    const exitPrice = Number(trade.exit_price ?? 0);
    return status.includes('CLOSED')
        || (Number.isFinite(exitPrice) && exitPrice !== 0)
        || action.includes('CLOSE');
}

function sumRealizedFromTrades(trades = []) {
    if (!Array.isArray(trades) || trades.length === 0) return 0;
    let realized = 0;
    for (const trade of trades) {
        if (!isTradeClosed(trade)) continue;
        const pnl = Number(trade.pnl);
        if (Number.isFinite(pnl)) realized += pnl;
    }
    return realized;
}

function parseTradeTimestamp(trade) {
    const raw = trade?.timestamp || trade?.record_time || trade?.recorded_at || trade?.time || '';
    if (!raw) return { label: '', ts: null };
    const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const parsed = new Date(iso);
    const ts = Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
    return { label: raw, ts };
}

function buildBalanceSeriesFromTrades(trades = [], initialBalance = 0) {
    if (!Array.isArray(trades) || trades.length === 0) return [];
    const closedTrades = trades.map((trade, index) => {
        if (!isTradeClosed(trade)) return null;
        const pnl = Number(trade.pnl);
        if (!Number.isFinite(pnl)) return null;
        const time = parseTradeTimestamp(trade);
        return {
            pnl,
            label: time.label || `#${index + 1}`,
            ts: time.ts,
            index
        };
    }).filter(Boolean);

    if (!closedTrades.length) return [];

    closedTrades.sort((a, b) => {
        if (a.ts === null && b.ts === null) return a.index - b.index;
        if (a.ts === null) return -1;
        if (b.ts === null) return 1;
        return a.ts - b.ts;
    });

    let balance = Number.isFinite(initialBalance) ? initialBalance : 0;
    const series = [];
    for (const item of closedTrades) {
        balance += item.pnl;
        series.push({
            time: item.label,
            value: balance
        });
    }
    return series;
}

function toFiniteNumber(value, fallback = null) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function computeRealtimeBalance({ account, system, virtualAccount, positions = [], trades = [] }) {
    const isTestMode = Boolean(system?.is_test_mode);

    // Prefer backend account payload so LIVE mode shows true balance instead of a fixed baseline.
    const equity = toFiniteNumber(account?.total_equity);
    const wallet = toFiniteNumber(account?.wallet_balance);
    const totalPnlFromAccount = toFiniteNumber(account?.total_pnl);
    const unrealizedFromAccount = toFiniteNumber(account?.unrealized_pnl);
    const realizedFromAccount = toFiniteNumber(account?.realized_pnl);

    const unrealized = unrealizedFromAccount ?? sumUnrealizedFromPositions(positions);
    const inferredRealized = totalPnlFromAccount !== null
        ? (totalPnlFromAccount - unrealized)
        : sumRealizedFromTrades(trades);
    const realized = realizedFromAccount ?? inferredRealized;
    const totalPnl = totalPnlFromAccount ?? (realized + unrealized);

    let initial = toFiniteNumber(account?.initial_balance);
    if (initial === null) {
        if (equity !== null && totalPnlFromAccount !== null) {
            initial = equity - totalPnlFromAccount;
        } else if (isTestMode) {
            initial = toFiniteNumber(virtualAccount?.initial_balance, FIXED_INITIAL_BALANCE);
        } else {
            initial = wallet ?? FIXED_INITIAL_BALANCE;
        }
    }

    let realtimeBalance = equity;
    if (realtimeBalance === null) {
        if (wallet !== null) {
            realtimeBalance = wallet + unrealized;
        } else {
            realtimeBalance = initial + totalPnl;
        }
    }

    return {
        initial,
        realized,
        unrealized,
        totalPnl,
        realtimeBalance,
        source: equity !== null ? 'account' : 'derived'
    };
}

function updateRealtimeBalance({ account, system, virtualAccount, chartData, positions = [], trades = [] }) {
    const fmt = num => `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    const setPnlClass = (id, val) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('pos', 'neg', 'neutral');
        if (val > 0) {
            el.classList.add('pos');
        } else if (val < 0) {
            el.classList.add('neg');
        } else {
            el.classList.add('neutral');
        }
    };

    const snapshot = computeRealtimeBalance({ account, system, virtualAccount, chartData, positions, trades });
    if (!snapshot) {
        setTxt('account-realtime-balance', '--');
        setTxt('account-realtime-initial', '--');
        setTxt('account-realtime-realized', '--');
        setTxt('account-realtime-unrealized', '--');
        return null;
    }
    const { initial, realized, unrealized, totalPnl, realtimeBalance } = snapshot;
    const currentBalanceDisplay = realtimeBalance;

    setTxt('account-realtime-balance', fmt(currentBalanceDisplay));
    setTxt('account-realtime-initial', fmt(initial));
    setTxt('account-realtime-realized', fmt(realized));
    setTxt('account-realtime-unrealized', fmt(unrealized));
    setTxt('acc-pnl', fmt(realized));
    setTxt('total-unrealized-pnl', fmt(unrealized));
    setPnlClass('acc-pnl', realized);
    setPnlClass('total-unrealized-pnl', unrealized);
    setPnlClass('account-realtime-balance', totalPnl);

    return snapshot;
}

// 🏆 Symbol Performance Ranking - Fetch and Render
async function fetchAndRenderSymbolRanking() {
    try {
        const response = await apiFetch('/api/symbol_stats');
        if (!response.ok) return;

        const result = await response.json();
        if (result.status !== 'success') return;

        const data = result.data || [];
        const tbody = document.getElementById('symbol-ranking-body');
        const summary = document.getElementById('symbol-ranking-summary');

        if (!tbody) return;

        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="padding: 20px; text-align: center; color: #718096;">
                ${getI18n('ranking.no_trades', 'No completed trades in current session')}
            </td></tr>`;
            if (summary) summary.innerHTML = '';
            return;
        }

        // Render table rows
        let totalPnl = 0;
        let totalTrades = 0;
        let totalWins = 0;

        tbody.innerHTML = data.map((item, index) => {
            totalPnl += item.total_pnl;
            totalTrades += item.trade_count;
            totalWins += item.win_count;

            const pnlColor = item.total_pnl > 0 ? '#48bb78' : (item.total_pnl < 0 ? '#f56565' : '#a0aec0');
            const returnColor = item.return_rate > 0 ? '#48bb78' : (item.return_rate < 0 ? '#f56565' : '#a0aec0');
            const winRateColor = item.win_rate >= 50 ? '#48bb78' : '#f56565';
            const pnlSign = item.total_pnl > 0 ? '+' : '';
            const returnSign = item.return_rate > 0 ? '+' : '';

            return `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <td style="padding: 10px 16px; color: #718096;">${index + 1}</td>
                    <td style="padding: 10px 16px; font-weight: 600; color: #edf2f7;">
                        <span style="background: rgba(99,179,237,0.2); padding: 2px 8px; border-radius: 4px;">${item.symbol}</span>
                    </td>
                    <td style="padding: 10px 16px; text-align: right; color: ${pnlColor}; font-weight: 600;">
                        ${pnlSign}$${item.total_pnl.toFixed(2)}
                    </td>
                    <td style="padding: 10px 16px; text-align: right; color: ${returnColor};">
                        ${returnSign}${item.return_rate.toFixed(2)}%
                    </td>
                    <td style="padding: 10px 16px; text-align: center; color: #a0aec0;">
                        ${item.trade_count} <span style="color: #48bb78;">(${item.win_count}W)</span>/<span style="color: #f56565;">(${item.loss_count}L)</span>
                    </td>
                    <td style="padding: 10px 16px; text-align: center;">
                        <span style="color: ${winRateColor}; font-weight: 600;">${item.win_rate.toFixed(1)}%</span>
                    </td>
                </tr>
            `;
        }).join('');

        // Render summary
        if (summary) {
            const overallWinRate = totalTrades > 0 ? (totalWins / totalTrades * 100).toFixed(1) : 0;
            const pnlIcon = totalPnl > 0 ? '📈' : (totalPnl < 0 ? '📉' : '➖');
            const pnlColor = totalPnl > 0 ? '#48bb78' : (totalPnl < 0 ? '#f56565' : '#a0aec0');

            summary.innerHTML = `
                <span style="margin-right: 20px;">${pnlIcon} <strong>${getI18n('ranking.total_pnl', 'Total PnL')}:</strong> 
                    <span style="color: ${pnlColor}; font-weight: 600;">$${totalPnl.toFixed(2)}</span>
                </span>
                <span style="margin-right: 20px;">📊 <strong>${getI18n('ranking.total_trades', 'Trades')}:</strong> ${totalTrades}</span>
                <span>🎯 <strong>${getI18n('ranking.overall_win_rate', 'Win Rate')}:</strong> ${overallWinRate}%</span>
            `;
        }

    } catch (err) {
        console.error('Failed to fetch symbol ranking:', err);
    }
}


function updateAccountTradeStats(trades) {
    const tradesEl = document.getElementById('account-trades-count');
    const winRateEl = document.getElementById('account-win-rate');

    if (!tradesEl && !winRateEl) return;

    const list = Array.isArray(trades) ? trades : [];
    let total = 0;
    let wins = 0;

    for (const trade of list) {
        if (!isTradeClosed(trade)) continue;

        const pnl = Number(trade.pnl);
        if (!Number.isFinite(pnl)) continue;
        total += 1;
        if (pnl > 0) wins += 1;
    }

    const winRate = total > 0 ? (wins / total) * 100 : 0;
    if (tradesEl) tradesEl.textContent = `${total}`;
    if (winRateEl) winRateEl.textContent = `${winRate.toFixed(2)}%`;
}

function renderChart(history, initialAmount = null) {
    if (!equityChart) return;

    // Use all history data - including cycle 0 (startup)
    const dataToShow = history;

    // 🔧 Use timestamps for X-axis display, but with fixed range to prevent drift
    const times = dataToShow.map(h => h.time);
    const rawValues = dataToShow.map(h => h.value);

    // Determine Initial Amount (Baseline)
    // If not provided, fallback to the first value in history, or 0
    const baseline = initialAmount !== null ? initialAmount : (rawValues.length > 0 ? rawValues[0] : 0);
    const isPnl = equityChart?.canvas?.dataset?.chartMode === 'pnl';
    const values = isPnl ? rawValues.map(value => value - baseline) : rawValues;
    const baselineValue = isPnl ? 0 : baseline;
    const latestValue = values.length > 0 ? values[values.length - 1] : baselineValue;
    const trendDelta = isPnl ? latestValue : (latestValue - baseline);
    const tone = trendDelta > 0 ? 'pos' : (trendDelta < 0 ? 'neg' : 'neutral');
    const toneColors = CHART_COLORS[tone];

    equityChart.data.labels = times;
    equityChart.data.datasets[0].label = isPnl
        ? getI18n('chart.profit', 'Total Profit')
        : getI18n('chart.balance', 'Balance (USDT)');
    equityChart.data.datasets[0].data = values;
    equityChart.data.datasets[0].customLineColor = toneColors.line;
    equityChart.data.datasets[0].customFillTop = toneColors.fillTop;
    equityChart.data.datasets[0].customFillBottom = toneColors.fillBottom;
    equityChart.data.datasets[0].pointBackgroundColor = toneColors.line;
    equityChart.data.datasets[0].pointHoverBackgroundColor = toneColors.line;

    // --- Add Dashed Line for Initial Amount ---
    // We create a constant array of the same length as data
    const baselineData = new Array(values.length).fill(baselineValue);

    // Check if second dataset exists (index 1), if not create it
    if (!equityChart.data.datasets[1]) {
        equityChart.data.datasets.push({
            label: isPnl
                ? getI18n('chart.break_even', 'Break-even')
                : getI18n(curveBaselineLabelKey || 'chart.initial', 'Initial Balance'),
            data: baselineData,
            borderColor: 'rgba(255, 255, 255, 0.3)', // Faint white
            borderWidth: 1,
            borderDash: [5, 5], // Dashed
            pointRadius: 0,
            fill: false,
            tension: 0
        });
    } else {
        equityChart.data.datasets[1].label = isPnl
            ? getI18n('chart.break_even', 'Break-even')
            : getI18n(curveBaselineLabelKey || 'chart.initial', 'Initial Balance');
        equityChart.data.datasets[1].data = baselineData;
    }
    // ------------------------------------------

    // --- Axis Centering Logic ---
    if (values.length > 0) {
        // Find min and max equity in the current view
        const maxVal = Math.max(...values);
        const minVal = Math.min(...values);

        // Calculate the maximum deviation from the baseline
        const deltaUp = Math.abs(maxVal - baselineValue);
        const deltaDown = Math.abs(minVal - baselineValue);
        const maxDelta = Math.max(deltaUp, deltaDown);

        // Add some padding (e.g. 10%) so the curve doesn't touch the edges
        // Ensure even if flat, we have a small range (e.g. 10 USDT or 1%)
        const paddingBase = baselineValue === 0 ? (Math.max(10, Math.abs(maxVal) * 0.05)) : (baselineValue * 0.01);
        const padding = maxDelta === 0 ? paddingBase : (maxDelta * 0.2);

        const yMax = baselineValue + maxDelta + padding;
        const yMin = baselineValue - maxDelta - padding;

        equityChart.options.scales.y.min = yMin;
        equityChart.options.scales.y.max = yMax;
    }
    // ----------------------------

    equityChart.update('none'); // Update without full re-animation for smoothness
}

function updatePositionInfo(account, positions = []) {
    const fmt = num => `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Update position count
    const countBadge = document.getElementById('position-count-badge');
    if (countBadge) {
        countBadge.textContent = positions.length || 0;
    }

    // Update total unrealized PnL
    const unrealized = sumUnrealizedFromPositions(positions);
    const pnlEl = document.getElementById('total-unrealized-pnl');
    if (pnlEl) {
        pnlEl.textContent = fmt(unrealized);
        pnlEl.classList.remove('pos', 'neg', 'neutral');
        if (unrealized > 0) pnlEl.classList.add('pos');
        else if (unrealized < 0) pnlEl.classList.add('neg');
        else pnlEl.classList.add('neutral');
    }

    // Update position details list
    const detailsEl = document.getElementById('position-details');
    if (detailsEl) {
        if (positions && positions.length > 0) {
            detailsEl.innerHTML = positions.map(pos => {
                const pnlStatus = pos.pnl > 0 ? 'pos' : (pos.pnl < 0 ? 'neg' : 'neutral');
                const sideLabel = (pos.side || 'LONG').toUpperCase();
                const sideClass = sideLabel === 'LONG' ? 'long' : 'short';

                // Calculate ROE %
                const leverage = pos.leverage || 1;
                const margin = (pos.entry_price * Math.abs(pos.quantity)) / leverage;
                let roe = 0;
                if (margin > 0) roe = (pos.pnl / margin) * 100;
                const roeStatus = roe > 0 ? 'pos' : (roe < 0 ? 'neg' : 'neutral');

                return `
                    <div class="position-item ${sideClass}">
                        <div class="pos-header">
                            <span class="pos-symbol">${pos.symbol}</span>
                            <span class="pos-pnl ${pnlStatus}">${fmt(pos.pnl)}</span>
                        </div>
                        <div class="pos-sub">
                            <span>${sideLabel} ${pos.leverage}x</span>
                            <span class="${roeStatus}">${roe.toFixed(2)}% ROE</span>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            detailsEl.innerHTML = '<span class="empty-msg">No active positions</span>';
        }
    }
}

// ... (renderSystemStatus and others remain same)

// Init (handled in main DOMContentLoaded)

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
        apiFetch('/api/control', {
            method: 'POST',
            body: JSON.stringify({ action: 'set_interval', interval: parseFloat(newInterval) })
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

    // Sync Interval Selector with backend value (default to 3 min)
    const intervalSel = document.getElementById('interval-selector');
    if (intervalSel) {
        // The instruction provided a syntactically incorrect line.
        // Assuming the intent was to keep the original logic for setting the interval value,
        // and that the `<script>` tag was a misplaced artifact or a misunderstanding of JS syntax.
        // To maintain syntactic correctness as per instructions, the original line is kept.
        const interval = system.cycle_interval !== undefined ? system.cycle_interval : 3;
        intervalSel.value = interval.toString();
    }

    // Update Environment Indicator (Test Mode / Live Trading)
    const envEl = document.getElementById('sys-env');
    if (envEl && system.is_test_mode !== undefined) {
        window.backendIsTestMode = Boolean(system.is_test_mode);
        syncTradingModeButtons(window.backendIsTestMode);
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

function normalizeAgentConfig(rawConfig) {
    const config = { ...(rawConfig || {}) };
    const ensure = (key, fallback) => {
        if (config[key] === undefined) config[key] = fallback;
    };

    if (config.trend_agent_llm === undefined && config.trend_agent !== undefined) {
        config.trend_agent_llm = config.trend_agent;
    }
    if (config.setup_agent_llm === undefined && config.setup_agent !== undefined) {
        config.setup_agent_llm = config.setup_agent;
    }
    if (config.trigger_agent_llm === undefined && config.trigger_agent !== undefined) {
        config.trigger_agent_llm = config.trigger_agent;
    }
    if (config.reflection_agent_llm === undefined && config.reflection_agent !== undefined) {
        config.reflection_agent_llm = config.reflection_agent;
    }

    ensure('trend_agent_llm', false);
    ensure('setup_agent_llm', false);
    ensure('trigger_agent_llm', false);
    ensure('trend_agent_local', true);
    ensure('setup_agent_local', true);
    ensure('trigger_agent_local', true);
    ensure('reflection_agent_llm', false);
    ensure('reflection_agent_local', true);

    config.trend_agent = Boolean(
        config.trend_agent_llm ||
        config.trend_agent_local ||
        config.setup_agent_llm ||
        config.setup_agent_local
    );
    config.setup_agent = Boolean(config.setup_agent_llm || config.setup_agent_local);
    config.trigger_agent = Boolean(config.trigger_agent_llm || config.trigger_agent_local);
    config.reflection_agent = Boolean(config.reflection_agent_llm || config.reflection_agent_local);

    return config;
}

// 🆕 Update Agent Framework Visualization
function updateAgentFramework(system, decision, agents) {
    decision = normalizeDecision(decision, system);

    const resolveMode = (sys) => {
        const raw = sys?.mode || (sys?.running ? 'Running' : 'Stopped');
        return typeof raw === 'string' ? raw.trim() : raw;
    };
    const mode = resolveMode(system);
    const lang = window.currentLang === 'zh' ? 'zh' : 'en';

    const statusLabels = {
        en: {
            Idle: 'Idle',
            Running: 'Running',
            Done: 'Done',
            Off: 'Off'
        },
        zh: {
            Idle: '空闲',
            Running: '运行中',
            Done: '完成',
            Off: '关闭'
        }
    };
    const modeLower = typeof mode === 'string' ? mode.toLowerCase() : '';
    const isRunningMode = modeLower === 'running' || modeLower === 'online' || modeLower === 'active';
    const isPausedMode = modeLower === 'paused';
    const isStoppedMode = modeLower === 'stopped';
    const t = (key) => (window.i18n && window.i18n[lang] && window.i18n[lang][key]) || key;

    const translateReason = (reason) => {
        if (!reason) return reason;
        if (lang === 'zh') return reason;
        let text = String(reason).trim();
        text = text.replace(/^风控拦截[:：]\s*/g, '');
        text = text.replace(/【[^】]+】/g, '').trim();
        const rules = [
            { re: /回撤过大.*暂停交易/, out: 'Drawdown too large, trading paused.' },
            { re: /连续亏损过多.*暂停交易/, out: 'Too many consecutive losses, trading paused.' },
            { re: /市场状态不明确.*(交易|开仓)/, out: 'Market regime unclear, trade blocked.' },
            { re: /市场高波动\\(ATR\\s*([\\d.]+)%\\).*风险.*(过大|拦截)/, out: 'High volatility (ATR $1%), risk too high.' },
            { re: /震荡市.*信心不足\\(([^)]+)\\).*?(禁止|拦截)开仓/, out: 'Choppy market, confidence too low ($1), entry blocked.' },
            { re: /空头信心不足\\(([^)]+)\\).*?拦截做空/, out: 'Bearish confidence too low ($1), short blocked.' },
            { re: /空头信号未达到强共振条件.*拦截做空/, out: 'Bearish signal lacks strong confluence, short blocked.' },
            { re: /做多位置过高\\(([^)]+)\\).*?风险/, out: 'Long entry too high ($1), pullback risk.' },
            { re: /做空位置过低\\(([^)]+)\\).*?风险/, out: 'Short entry too low ($1), support risk.' },
            { re: /风险回报比不足\\(([^)]+)\\)/, out: 'Risk-reward ratio too low ($1).' },
            { re: /市场高波动.*风险控制拦截/, out: 'High volatility, risk control blocked.' },
            { re: /震荡市信心不足.*拦截开仓/, out: 'Choppy market, low confidence, entry blocked.' },
            { re: /未设置止损.*动态止损/, out: 'Stop-loss missing, auto-adjusted by ATR.' },
            { re: /止损方向错误.*修正/, out: 'Stop-loss direction corrected.' },
            { re: /持仓数量已达上限\\(([^)]+)\\).*禁止新开仓/, out: 'Position limit reached ($1), new entries blocked.' },
            { re: /本周期已开仓\\(([^)]+)\\).*每周期最多开一个新仓位/, out: 'Cycle entry limit reached ($1), new entry blocked.' },
            { re: /保证金不足/, out: 'Insufficient margin.' }
        ];
        for (const { re, out } of rules) {
            const match = text.match(re);
            if (match) {
                let result = out;
                match.slice(1).forEach((val, idx) => {
                    result = result.replace(`$${idx + 1}`, val);
                });
                return result;
            }
        }
        if (/[\u4e00-\u9fa5]/.test(text)) {
            return t('summary.blocked.reason');
        }
        return text;
    };

    // Update Cycle Number
    const cycleEl = document.getElementById('framework-cycle');
    if (cycleEl && system.cycle_counter !== undefined) {
        cycleEl.textContent = `Cycle #${system.cycle_counter}`;
    }

    // Update Symbol Selector (already handled by updateSymbolSelector)

    const agentConfig = normalizeAgentConfig(window.agentConfig || {});
    const isEnabled = (key) => agentConfig[key] !== false;

    const titleMap = {
        en: {
            trend: { llm: 'Trend Agent (LLM)', local: 'Trend Agent', fallback: 'Trend Agent' },
            trigger: { llm: 'Trigger Agent (LLM)', local: 'Trigger Agent', fallback: 'Trigger Agent' },
            reflection: { llm: 'Reflection Agent (LLM)', local: 'Reflection Agent', fallback: 'Reflection Agent' },
            quant_analyst: 'Quant Analyst',
            multi_period_agent: 'Multi-Period Parser',
            predict_agent: 'Predict Agent',
            bull_agent: 'Bull Perspective',
            bear_agent: 'Bear Perspective',
            reflection_agent: 'Reflection Agent',
            trend_agent: 'Trend Agent',
            setup_agent: 'Setup Agent',
            trigger_agent: 'Trigger Agent',
            risk_audit: 'Risk Audit',
            symbol_selector: 'Symbol Selector',
            decision_core: 'Decision Core'
        },
        zh: {
            trend: { llm: '趋势代理(LLM)', local: '趋势代理', fallback: '趋势代理' },
            trigger: { llm: '触发代理(LLM)', local: '触发代理', fallback: '触发代理' },
            reflection: { llm: '复盘代理(LLM)', local: '复盘代理', fallback: '复盘代理' },
            quant_analyst: '量化分析师',
            multi_period_agent: '多周期解析',
            predict_agent: '预测代理',
            bull_agent: '多头观点',
            bear_agent: '空头观点',
            reflection_agent: '复盘代理',
            trend_agent: '趋势代理',
            setup_agent: '设置代理',
            trigger_agent: '触发代理',
            risk_audit: '风控审计',
            symbol_selector: '选币代理',
            decision_core: '决策核心'
        }
    };

    const trendTitle = document.getElementById('title-trend-agent');
    if (trendTitle) {
        const trendUsesLLM = agentConfig.trend_agent_llm || agentConfig.setup_agent_llm;
        const trendUsesLocal = agentConfig.trend_agent_local || agentConfig.setup_agent_local;
        const labels = titleMap[lang]?.trend || titleMap.en.trend;
        if (trendUsesLLM) {
            trendTitle.textContent = labels.llm;
        } else if (trendUsesLocal) {
            trendTitle.textContent = labels.local;
        } else {
            trendTitle.textContent = labels.fallback;
        }
    }

    const triggerTitle = document.getElementById('title-trigger-agent');
    if (triggerTitle) {
        const labels = titleMap[lang]?.trigger || titleMap.en.trigger;
        if (agentConfig.trigger_agent_llm) {
            triggerTitle.textContent = labels.llm;
        } else if (agentConfig.trigger_agent_local) {
            triggerTitle.textContent = labels.local;
        } else {
            triggerTitle.textContent = labels.fallback;
        }
    }

    const reflectionTitle = document.getElementById('title-reflection-agent');
    if (reflectionTitle) {
        const labels = titleMap[lang]?.reflection || titleMap.en.reflection;
        if (agentConfig.reflection_agent_llm) {
            reflectionTitle.textContent = labels.llm;
        } else if (agentConfig.reflection_agent_local) {
            reflectionTitle.textContent = labels.local;
        } else {
            reflectionTitle.textContent = labels.fallback;
        }
    }

    // Helper to set agent badge status
    const setAgentStatus = (agentId, status) => {
        const badge = document.querySelector(`#${agentId} .agent-badge`);
        const box = document.getElementById(agentId);
        let statusClass = 'idle';
        if (status === 'Running') statusClass = 'running';
        else if (status === 'Done') statusClass = 'completed';
        else if (status === 'Off') statusClass = 'off';
        const displayStatus = statusLabels[lang]?.[status] || status;
        if (box) {
            const currentClass = box.classList.contains('running')
                ? 'running'
                : box.classList.contains('completed')
                    ? 'completed'
                    : box.classList.contains('off')
                        ? 'off'
                        : box.classList.contains('idle')
                            ? 'idle'
                            : null;
            if (currentClass === statusClass) {
                if (badge) {
                    badge.textContent = displayStatus;
                    badge.className = 'agent-badge';
                    badge.classList.add(statusClass);
                }
                box.classList.toggle('flowing', statusClass === 'running');
                return;
            }
        }
        if (box) {
            box.classList.remove('running', 'completed', 'idle', 'off');
            box.classList.add(statusClass);
            box.classList.toggle('flowing', statusClass === 'running');
            if (statusClass === 'completed') {
                box.classList.remove('flow-finish');
                void box.offsetWidth;
                box.classList.add('flow-finish');
                // 🆕 Trigger data-sending animation on completion
                triggerDataCascade(agentId);
            }
            if (statusClass === 'running') {
                // 🆕 Trigger data-receiving animation when agent starts
                box.classList.add('data-receiving');
                setTimeout(() => box.classList.remove('data-receiving'), 400);
            }
            // 🆕 Update layer states after status change
            setTimeout(() => updateLayerStates(), 50);
        }
        if (badge) {
            badge.textContent = displayStatus;
            badge.className = 'agent-badge';
            badge.classList.add(statusClass);
        }
    };

    // 🆕 Data cascade effect - animate data flowing to next layer
    const agentFlowOrder = {
        'flow-datasync': ['flow-quant', 'flow-regime', 'flow-trigger-detector', 'flow-position-analyzer', 'flow-predict'],
        'flow-symbol-selector': ['flow-datasync'],
        'flow-quant': ['flow-trend-agent', 'flow-trigger-agent', 'flow-ai-filter'],
        'flow-regime': ['flow-decision'],
        'flow-predict': ['flow-decision'],
        'flow-trigger-detector': ['flow-decision'],
        'flow-position-analyzer': ['flow-decision'],
        'flow-trend-agent': ['flow-decision'],
        'flow-trigger-agent': ['flow-decision'],
        'flow-ai-filter': ['flow-decision'],
        'flow-decision': ['flow-risk'],
        'flow-risk': ['flow-output'],
        'flow-output': ['flow-reflection']
    };

    const triggerDataCascade = (agentId) => {
        const box = document.getElementById(agentId);
        if (!box) return;

        // 🆕 Trigger meteor arrow animation
        box.classList.add('meteor-sending');
        setTimeout(() => box.classList.remove('meteor-sending'), 700);

        // Trigger sending animation on current agent
        box.classList.add('data-sending');
        setTimeout(() => box.classList.remove('data-sending'), 500);

        // Trigger receiving animation on next agents (with delay)
        const nextAgents = agentFlowOrder[agentId] || [];
        nextAgents.forEach((nextId, index) => {
            const nextBox = document.getElementById(nextId);
            if (nextBox && !nextBox.classList.contains('off')) {
                setTimeout(() => {
                    nextBox.classList.add('data-receiving');
                    setTimeout(() => nextBox.classList.remove('data-receiving'), 400);
                }, 150 + (index * 100));
            }
        });

        // 🆕 Update layer active states
        updateLayerStates();
    };

    // 🆕 Layer mapping for visual feedback
    const layerAgentMap = {
        'data': ['flow-datasync', 'flow-symbol-selector'],
        'analysis': ['flow-quant', 'flow-regime', 'flow-trigger-detector', 'flow-position-analyzer', 'flow-predict'],
        'strategy': ['flow-trend-agent', 'flow-trigger-agent', 'flow-ai-filter'],
        'decision': ['flow-decision'],
        'execution': ['flow-risk', 'flow-output', 'flow-reflection']
    };

    // 🆕 Update layer active states based on running agents
    const updateLayerStates = () => {
        Object.entries(layerAgentMap).forEach(([layerName, agentIds]) => {
            const layer = document.querySelector(`.flow-layer[data-layer="${layerName}"]`);
            if (!layer) return;

            const hasRunningAgent = agentIds.some(id => {
                const box = document.getElementById(id);
                return box && box.classList.contains('running');
            });

            layer.classList.toggle('layer-active', hasRunningAgent);
        });
    };

    // Helper to set output value
    const setOutput = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (value === undefined || value === null || value === '') {
            el.textContent = '--';
            return;
        }
        el.textContent = value;
    };

    const setSummary = (id, text) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (text === undefined || text === null || text === '') {
            el.textContent = '--';
            return;
        }
        el.textContent = text;
    };

    const connectorMap = [
        { id: 'particles-data', sources: ['flow-datasync', 'flow-symbol-selector'] },
        { id: 'particles-analysis', sources: ['flow-quant', 'flow-regime', 'flow-trigger-detector', 'flow-position-analyzer', 'flow-predict'] },
        { id: 'particles-strategy', sources: ['flow-trend-agent', 'flow-trigger-agent', 'flow-ai-filter'] },
        { id: 'particles-decision', sources: ['flow-decision'] }
    ];

    const isActiveBox = (id) => {
        const el = document.getElementById(id);
        if (!el) return false;
        return el.classList.contains('running') || el.classList.contains('completed');
    };

    const setConnectorActive = (particlesId, active) => {
        const dot = document.getElementById(particlesId);
        const connector = dot ? dot.closest('.flow-connector') : null;
        if (!connector) return;
        connector.classList.toggle('active', active);
    };

    const pulseConnector = (particlesId, delay = 0, duration = 900) => {
        const dot = document.getElementById(particlesId);
        const connector = dot ? dot.closest('.flow-connector') : null;
        if (!connector) return;
        setTimeout(() => {
            connector.classList.remove('pulse');
            void connector.offsetWidth;
            connector.classList.add('pulse');
            setTimeout(() => connector.classList.remove('pulse'), duration);
        }, delay);
    };

    const updateFlowConnectors = () => {
        if (!isRunningMode) {
            connectorMap.forEach(({ id }) => setConnectorActive(id, false));
            return;
        }
        connectorMap.forEach(({ id, sources }) => {
            const active = sources.some(isActiveBox);
            setConnectorActive(id, active);
        });
    };

    const beamLinks = [
        { id: 'beam-data-quant', from: 'flow-datasync', to: 'flow-quant' },
        { id: 'beam-data-regime', from: 'flow-datasync', to: 'flow-regime' },
        { id: 'beam-data-trigger', from: 'flow-datasync', to: 'flow-trigger-detector' },
        { id: 'beam-data-position', from: 'flow-datasync', to: 'flow-position-analyzer' },
        { id: 'beam-data-predict', from: 'flow-datasync', to: 'flow-predict' },
        { id: 'beam-analysis-trend', from: 'flow-quant', to: 'flow-trend-agent' },
        { id: 'beam-analysis-trigger', from: 'flow-trigger-detector', to: 'flow-trigger-agent' },
        { id: 'beam-analysis-ai', from: 'flow-predict', to: 'flow-ai-filter' },
        { id: 'beam-strategy-decision', from: 'flow-trend-agent', to: 'flow-decision' },
        { id: 'beam-decision-risk', from: 'flow-decision', to: 'flow-risk' },
        { id: 'beam-risk-output', from: 'flow-risk', to: 'flow-output' },
        { id: 'beam-output-reflection', from: 'flow-output', to: 'flow-reflection' }
    ];

    const ensureFlowBeams = () => {
        const container = document.querySelector('.agent-flow-container');
        if (!container) return null;
        const svg = document.getElementById('flow-beams');
        if (!svg) return null;

        if (!window.flowBeamState) {
            window.flowBeamState = { svg, container, links: {} };
        } else {
            window.flowBeamState.svg = svg;
            window.flowBeamState.container = container;
        }

        if (!svg.dataset.ready) {
            svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            svg.setAttribute('preserveAspectRatio', 'none');
            svg.innerHTML = '';

            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', 'beam-arrow');
            marker.setAttribute('markerWidth', '8');
            marker.setAttribute('markerHeight', '8');
            marker.setAttribute('refX', '6');
            marker.setAttribute('refY', '3');
            marker.setAttribute('orient', 'auto');
            marker.setAttribute('markerUnits', 'strokeWidth');

            const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            arrow.setAttribute('d', 'M0,0 L6,3 L0,6 Z');
            arrow.setAttribute('class', 'beam-arrow');
            marker.appendChild(arrow);
            defs.appendChild(marker);
            svg.appendChild(defs);

            beamLinks.forEach(link => {
                const glow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                glow.setAttribute('data-beam', link.id);
                glow.setAttribute('class', 'beam-glow');

                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('data-beam', link.id);
                path.setAttribute('class', 'beam-path');
                path.setAttribute('marker-end', 'url(#beam-arrow)');

                svg.appendChild(glow);
                svg.appendChild(path);

                window.flowBeamState.links[link.id] = {
                    link,
                    glow,
                    path
                };
            });

            svg.dataset.ready = 'true';
        }

        return window.flowBeamState;
    };

    const getAnchorPoint = (box, containerRect, mode) => {
        const rect = box.getBoundingClientRect();
        const x = rect.left - containerRect.left + rect.width / 2;
        const y = rect.top - containerRect.top + (mode === 'bottom' ? rect.height : 0);
        return { x, y };
    };

    const updateFlowBeams = () => {
        const state = ensureFlowBeams();
        if (!state) return;

        const { svg, container, links } = state;
        const rect = container.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('width', `${width}`);
        svg.setAttribute('height', `${height}`);

        beamLinks.forEach(({ id, from, to }) => {
            const linkState = links[id];
            if (!linkState) return;
            const fromEl = document.getElementById(from);
            const toEl = document.getElementById(to);
            if (!fromEl || !toEl || fromEl.classList.contains('hidden') || toEl.classList.contains('hidden')) {
                linkState.glow.classList.remove('beam-active');
                linkState.path.classList.remove('beam-active');
                return;
            }

            const start = getAnchorPoint(fromEl, rect, 'bottom');
            const end = getAnchorPoint(toEl, rect, 'top');
            const midY = Math.max(30, (end.y - start.y) / 2);
            const d = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${start.x.toFixed(1)} ${(start.y + midY).toFixed(1)}, ${end.x.toFixed(1)} ${(end.y - midY).toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;

            linkState.glow.setAttribute('d', d);
            linkState.path.setAttribute('d', d);

            const active = isActiveBox(from) && (isActiveBox(to) || isRunningMode);
            linkState.glow.classList.toggle('beam-active', active);
            linkState.path.classList.toggle('beam-active', active);
        });
    };

    const formatNumber = (value, digits = 2) => {
        if (value === undefined || value === null) return '--';
        const num = Number(value);
        if (!Number.isFinite(num)) return '--';
        return digits === null ? String(num) : num.toFixed(digits);
    };

    const formatPercent = (value, digits = 0) => {
        if (value === undefined || value === null) return '--';
        let num = Number(value);
        if (!Number.isFinite(num)) return '--';
        if (num > 0 && num <= 1) num *= 100;
        return `${num.toFixed(digits)}%`;
    };
    const voteAnalysis = decision?.vote_analysis || {};
    const adxFallback = decision?.regime?.adx ?? decision?.four_layer_status?.adx;

    const resetFramework = (options = {}) => {
        const { forceRunning = false } = options;
        const outputIds = [
            'out-tf-1', 'out-tf-2', 'out-tf-3', 'out-oi',
            'out-selector-mode', 'out-selector-symbol', 'out-selector-bias', 'out-selector-score',
            'out-ema', 'out-rsi', 'out-macd', 'out-bb',
            'out-regime', 'out-adx', 'out-regime-conf',
            'out-pattern', 'out-trigger-signal', 'out-trigger-score',
            'out-zone', 'out-sr', 'out-range',
            'out-pup', 'out-pdown', 'out-signal',
            'out-trend-1h', 'out-trend-bias', 'out-trend-conf',
            'out-fire', 'out-entry-type', 'out-fire-conf',
            'out-ai-status', 'out-ai-veto', 'out-ai-reason',
            'out-bull', 'out-bear',
            'out-risk', 'out-size', 'out-sl', 'out-tp',
            'out-trades-count', 'out-win-rate', 'out-insight'
        ];
        outputIds.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.textContent = '--';
            el.classList.remove('bullish', 'bearish');
        });

        const decisionEl = document.getElementById('out-decision');
        if (decisionEl) {
            const actionSpan = decisionEl.querySelector('.decision-action');
            const confSpan = decisionEl.querySelector('.decision-conf');
            if (actionSpan) {
                actionSpan.textContent = 'WAIT';
                actionSpan.className = 'decision-action';
            }
            if (confSpan) confSpan.textContent = '--';
        }

        const finalEl = document.getElementById('out-final');
        if (finalEl) {
            const finalAction = finalEl.querySelector('.final-action');
            if (finalAction) {
                finalAction.textContent = '--';
                finalAction.className = 'final-action';
            }
        }
        const finalSymbol = document.getElementById('final-symbol');
        if (finalSymbol) finalSymbol.textContent = '--';
        const finalSize = document.getElementById('final-size');
        if (finalSize) finalSize.textContent = '--';

        const setIdleOrOff = (id, key, summaryId, idleText, offText, runningText) => {
            const enabled = key ? isEnabled(key) : true;
            if (enabled) {
                const showRunning = forceRunning && isRunningMode;
                setAgentStatus(id, showRunning ? 'Running' : 'Idle');
                setSummary(summaryId, showRunning ? runningText : idleText);
            } else {
                setAgentStatus(id, 'Off');
                setSummary(summaryId, offText);
            }
        };

        const dataSummary = isPausedMode
            ? 'Feed paused.'
            : (isStoppedMode ? 'Feed stopped.' : (isRunningMode ? 'Feed running.' : 'Feed idle.'));

        const runningSummary = isRunningMode ? 'Cycle running.' : 'Cycle idle.';

        setIdleOrOff('flow-datasync', null, 'sum-datasync', dataSummary, dataSummary, 'Feed running.');
        setIdleOrOff('flow-symbol-selector', 'symbol_selector_agent', 'sum-symbol-selector', 'Selector idle.', 'Selector off.', 'Selector running.');
        setIdleOrOff('flow-quant', null, 'sum-quant', 'Indicators pending.', 'Indicators pending.', 'Quant running.');
        setIdleOrOff('flow-regime', 'regime_detector_agent', 'sum-regime', 'Regime pending.', 'Regime off.', 'Regime running.');
        setIdleOrOff('flow-trigger-detector', 'trigger_detector_agent', 'sum-trigger-detector', 'Trigger detector idle.', 'Trigger detector off.', 'Trigger detector running.');
        setIdleOrOff('flow-position-analyzer', 'position_analyzer_agent', 'sum-position-analyzer', 'Position pending.', 'Position off.', 'Position running.');
        setIdleOrOff('flow-predict', 'predict_agent', 'sum-predict', 'Predict pending.', 'Predict off.', 'Predict running.');
        setIdleOrOff('flow-trend-agent', 'trend_agent', 'sum-trend-agent', 'Trend idle.', 'Trend agent off.', 'Trend running.');
        setIdleOrOff('flow-trigger-agent', 'trigger_agent', 'sum-trigger-agent', 'Trigger idle.', 'Trigger agent off.', 'Trigger running.');
        setIdleOrOff('flow-ai-filter', 'ai_prediction_filter_agent', 'sum-ai-filter', 'AI filter idle.', 'AI filter off.', 'AI filter running.');
        setIdleOrOff('flow-decision', null, 'sum-decision', 'Decision pending.', 'Decision pending.', 'Decision running.');
        setIdleOrOff('flow-risk', null, 'sum-risk', 'Risk idle.', 'Risk idle.', 'Risk running.');
        setIdleOrOff('flow-output', null, 'sum-output', 'Output pending.', 'Output pending.', runningSummary);
        setIdleOrOff('flow-reflection', 'reflection_agent', 'sum-reflection', 'Reflection idle.', 'Reflection off.', 'Reflection running.');

        updateFlowConnectors();
        updateFlowBeams();
    };

    const updateSymbolSelectorCard = () => {
        const selectorInfo = agents?.symbol_selector || {};
        if (!isEnabled('symbol_selector_agent')) {
            setAgentStatus('flow-symbol-selector', 'Off');
            setOutput('out-selector-mode', '--');
            setOutput('out-selector-symbol', '--');
            setOutput('out-selector-bias', '--');
            setOutput('out-selector-score', '--');
            setSummary('sum-symbol-selector', 'Selector off.');
            return;
        }

        const lang = window.currentLang === 'zh' ? 'zh' : 'en';
        const biasLabels = {
            en: {
                up: 'Bullish',
                down: 'Bearish',
                flat: 'Neutral'
            },
            zh: {
                up: '看涨',
                down: '看跌',
                flat: '中性'
            }
        };

        const selectorSymbols = Array.isArray(system?.symbols) ? system.symbols : [];
        const selectorMode = selectorInfo.mode
            || (selectorSymbols.length > 1 ? 'AUTO' : 'MANUAL');
        const selectorSymbol = selectorInfo.symbol
            || system?.current_symbol
            || decision?.symbol
            || (selectorSymbols.length > 0 ? selectorSymbols[0] : '--');
        const selectorChange = selectorInfo.change_pct;
        const selectorVolume = selectorInfo.volume_ratio;
        const selectorScore = selectorInfo.score;
        let selectorBias = '--';
        if (selectorInfo.direction) {
            const dir = String(selectorInfo.direction).toUpperCase();
            if (dir === 'UP' || dir === 'BULL' || dir === 'BULLISH') selectorBias = biasLabels[lang].up;
            else if (dir === 'DOWN' || dir === 'BEAR' || dir === 'BEARISH') selectorBias = biasLabels[lang].down;
            else if (dir === 'FLAT' || dir === 'NEUTRAL') selectorBias = biasLabels[lang].flat;
        }

        if (isRunningMode) {
            setAgentStatus('flow-symbol-selector', 'Done');
        } else {
            setAgentStatus('flow-symbol-selector', 'Idle');
        }

        setOutput('out-selector-mode', selectorMode);
        setOutput('out-selector-symbol', selectorSymbol);
        setOutput('out-selector-bias', selectorBias);
        let scoreText = '--';
        if (selectorChange !== undefined && selectorChange !== null) {
            scoreText = `${formatNumber(selectorChange, 2)}%`;
        } else if (selectorScore !== undefined && selectorScore !== null) {
            scoreText = formatNumber(selectorScore, 2);
        }
        setOutput('out-selector-score', scoreText);
        const biasPart = selectorBias !== '--' ? ` ${selectorBias}` : '';
        const changePart = selectorChange !== undefined && selectorChange !== null
            ? ` ${formatNumber(selectorChange, 2)}%`
            : '';
        const volPart = selectorVolume !== undefined && selectorVolume !== null
            ? ` | RVOL ${formatNumber(selectorVolume, 2)}x`
            : '';
        setSummary('sum-symbol-selector', `${selectorMode} -> ${selectorSymbol}${biasPart}${changePart}${volPart}.`);

        // Chart updates are handled in updateDashboard to avoid auto-refresh.
    };

    const currentCycle = system?.cycle_counter;
    const hasCycle = currentCycle !== undefined && currentCycle !== null;
    const decisionCycle = decision?.cycle_number;
    const decisionHasCycle = decisionCycle !== undefined && decisionCycle !== null;
    const decisionIsCurrent = !hasCycle || !decisionHasCycle
        ? true
        : Number(decisionCycle) === Number(currentCycle);

    if (hasCycle && window.lastFrameworkCycle === undefined) {
        window.lastFrameworkCycle = currentCycle;
    }

    if (hasCycle && window.lastFrameworkCycle !== currentCycle) {
        window.lastFrameworkCycle = currentCycle;
        if (window.frameworkCycleTimer) {
            clearTimeout(window.frameworkCycleTimer);
        }
        resetFramework({ forceRunning: true });
        updateSymbolSelectorCard();
        connectorMap.forEach((connector, index) => {
            pulseConnector(connector.id, index * 220, 900);
        });
        window.frameworkCycleTimer = setTimeout(() => {
            if (window.lastFrameworkCycle === currentCycle && window.lastDecisionCycle !== currentCycle) {
                resetFramework({ forceRunning: false });
            }
        }, 1000);
        if (!decisionIsCurrent) {
            updateFlowConnectors();
            updateFlowBeams();
            return;
        }
    }

    // Update Agent Statuses and Outputs based on decision data
    if (!decision || (hasCycle && decisionHasCycle && !decisionIsCurrent)) {
        if (hasCycle && window.latestDecisionHistory && window.latestDecisionHistory.length > 0) {
            const fallbackDecision = window.latestDecisionHistory.find(
                (entry) => entry && entry.cycle_number !== undefined && Number(entry.cycle_number) === Number(currentCycle)
            );
            if (fallbackDecision) {
                decision = fallbackDecision;
            } else {
                resetFramework({ forceRunning: false });
                updateSymbolSelectorCard();
                updateFlowConnectors();
                updateFlowBeams();
                return;
            }
        } else {
            resetFramework({ forceRunning: false });
            updateSymbolSelectorCard();
            updateFlowConnectors();
            updateFlowBeams();
            return;
        }
    }

    if (hasCycle) {
        const resolvedCycle = decision?.cycle_number !== undefined && decision?.cycle_number !== null
            ? Number(decision.cycle_number)
            : Number(currentCycle);
        window.lastDecisionCycle = resolvedCycle;
    }

    // DataSync Agent - Always show as completed when we have data
    if (isRunningMode) {
        setAgentStatus('flow-datasync', 'Done');
        // Update data outputs if available
        setOutput('out-tf-1', '✓');
        setOutput('out-tf-2', '✓');
        setOutput('out-tf-3', '✓');
        const oiChange = decision.four_layer_status?.oi_change ?? decision.vote_details?.oi_fuel?.oi_change_24h;
        setOutput('out-oi', oiChange !== undefined && oiChange !== null ? `${formatNumber(oiChange, 1)}%` : '✓');
    }
    const oiSummary = decision.four_layer_status?.oi_change ?? decision.vote_details?.oi_fuel?.oi_change_24h;
    let dataSummary = 'Feed idle.';
    if (isRunningMode) {
        const oiPart = oiSummary !== undefined && oiSummary !== null ? ` | OI ${formatNumber(oiSummary, 1)}%` : '';
        const tfs = updateDataSyncLabels(window.strategyTimeframes);
        dataSummary = `Feed ${tfs.join('/')}${oiPart}.`;
    } else if (isPausedMode) {
        dataSummary = 'Feed paused.';
    } else if (isStoppedMode) {
        dataSummary = 'Feed stopped.';
    }
    setSummary('sum-datasync', dataSummary);

    // Quant Analyst - Show indicators from decision
    const indicatorSnapshot = decision.indicator_snapshot || null;
    if (indicatorSnapshot || decision.vote_details) {
        setAgentStatus('flow-quant', 'Done');
        if (indicatorSnapshot) {
            const emaStatusMap = {
                bullish: 'Bullish',
                bearish: 'Bearish',
                bullish_bias: 'Bullish Bias',
                bearish_bias: 'Bearish Bias',
                mixed: 'Mixed'
            };
            const bbMap = {
                upper: 'Upper',
                lower: 'Lower',
                middle: 'Middle'
            };
            const emaLabel = emaStatusMap[indicatorSnapshot.ema_status] || '--';
            const rsiValue = formatNumber(indicatorSnapshot.rsi, 1);
            const macdValue = formatNumber(indicatorSnapshot.macd_diff, 2);
            const bbLabel = bbMap[indicatorSnapshot.bb_position] || '--';

            setOutput('out-ema', emaLabel);
            setOutput('out-rsi', rsiValue);
            setOutput('out-macd', macdValue);
            setOutput('out-bb', bbLabel);
            setSummary('sum-quant', `EMA ${emaLabel} | RSI ${rsiValue} | MACD ${macdValue} | BB ${bbLabel}.`);
        } else {
            setOutput('out-ema', '--');
            setOutput('out-rsi', '--');
            setOutput('out-macd', '--');
            setOutput('out-bb', '--');
            setSummary('sum-quant', 'Indicators pending.');
        }
    } else {
        setSummary('sum-quant', 'Quant idle.');
    }

    // Regime Detector
    if (!isEnabled('regime_detector_agent')) {
        setAgentStatus('flow-regime', 'Off');
        setOutput('out-regime', '--');
        setOutput('out-adx', '--');
        setOutput('out-regime-conf', '--');
        setSummary('sum-regime', 'Regime off.');
    } else {
        const regimeData = decision.regime || decision.four_layer_status || null;
        if (regimeData) {
            setAgentStatus('flow-regime', 'Done');
            const regime = regimeData.regime || 'Unknown';
            const adxValue = regimeData.adx;
            const adx = adxValue !== undefined && adxValue !== null ? formatNumber(adxValue, 1) : '--';
            const conf = decision.regime?.confidence !== undefined && decision.regime?.confidence !== null
                ? formatPercent(decision.regime.confidence, 0)
                : '--';
            const confPart = conf !== '--' ? ` | Conf ${conf}` : '';

            setOutput('out-regime', regime);
            setOutput('out-adx', adx);
            setOutput('out-regime-conf', conf);
            setSummary('sum-regime', `Regime ${regime} | ADX ${adx}${confPart}.`);
        } else {
            setAgentStatus('flow-regime', 'Idle');
            setOutput('out-regime', '--');
            setOutput('out-adx', '--');
            setOutput('out-regime-conf', '--');
            setSummary('sum-regime', 'Regime pending.');
        }
    }

    // Predict Agent
    if (!isEnabled('predict_agent')) {
        setAgentStatus('flow-predict', 'Off');
        setOutput('out-pup', '--');
        setOutput('out-pdown', '--');
        setOutput('out-signal', '--');
        setSummary('sum-predict', 'Predict off.');
    } else if (decision.prophet_probability !== undefined || decision.vote_details?.prophet !== undefined) {
        setAgentStatus('flow-predict', 'Done');
        let prob = decision.prophet_probability ?? decision.vote_details?.prophet;
        if (typeof prob === 'number' && prob > 1) prob = prob / 100;
        const pUp = (prob * 100).toFixed(0);
        const pDown = ((1 - prob) * 100).toFixed(0);
        setOutput('out-pup', `${pUp}%`);
        setOutput('out-pdown', `${pDown}%`);
        const signal = prob > 0.55 ? 'LONG' :
            (prob < 0.45 ? 'SHORT' : 'NEUTRAL');
        setOutput('out-signal', signal);
        setSummary('sum-predict', `P(Up) ${pUp}% | ${signal}.`);
    } else {
        setAgentStatus('flow-predict', 'Idle');
        setOutput('out-pup', '--');
        setOutput('out-pdown', '--');
        setOutput('out-signal', '--');
        setSummary('sum-predict', 'Predict pending.');
    }

    // Decision Core
    if (decision.action) {
        setAgentStatus('flow-decision', 'Done');
        const action = decision.action.toUpperCase();
        const confValue = decision.confidence;
        const conf = confValue ? `${(confValue > 1 ? confValue : confValue * 100).toFixed(0)}%` : '0%';

        const decisionEl = document.getElementById('out-decision');
        if (decisionEl) {
            const actionSpan = decisionEl.querySelector('.decision-action');
            const confSpan = decisionEl.querySelector('.decision-conf');
            if (actionSpan) actionSpan.textContent = action;
            if (confSpan) confSpan.textContent = conf;
        }

        // Bull/Bear votes
        if (decision.vote_details) {
            const bullConf = decision.vote_details.bull_confidence;
            const bearConf = decision.vote_details.bear_confidence;
            const bullStance = decision.vote_details.bull_stance || '';
            const bearStance = decision.vote_details.bear_stance || '';

            const bullPct = bullConf !== undefined && bullConf !== null ? formatPercent(bullConf, 0) : '--';
            const bearPct = bearConf !== undefined && bearConf !== null ? formatPercent(bearConf, 0) : '--';
            const bullDisplay = bullPct !== '--' ? `${bullPct} ${bullStance}` : '--';
            const bearDisplay = bearPct !== '--' ? `${bearPct} ${bearStance}` : '--';
            setOutput('out-bull', bullDisplay);
            setOutput('out-bear', bearDisplay);

            const bullText = bullPct !== '--' ? `BULL ${bullPct}` : 'BULL --';
            const bearText = bearPct !== '--' ? `BEAR ${bearPct}` : 'BEAR --';
            setSummary('sum-decision', `DECISION ${action} ${conf} | ${bullText} | ${bearText}.`);
        } else {
            setSummary('sum-decision', `DECISION ${action} ${conf}.`);
        }
    } else {
        setAgentStatus('flow-decision', 'Idle');
        setSummary('sum-decision', t('summary.decision.pending'));
    }

    updateFlowConnectors();
    updateFlowBeams();

    // Risk Audit
    if (decision.guardian_passed !== undefined) {
        setAgentStatus('flow-risk', 'Done');
        const riskLevel = decision.risk_level || 'unknown';
        setOutput('out-risk', riskLevel.toUpperCase());
        const params = decision.order_params || decision.params || decision.details || null;
        const entry = params ? (params.entry_price ?? params.price) : null;
        const sl = params ? (params.stop_loss_price ?? params.stop_loss) : null;
        const tp = params ? (params.take_profit_price ?? params.take_profit) : null;
        const qty = params ? params.quantity : null;

        let sizeLabel = '--';
        if (qty !== undefined && qty !== null && decision.symbol) {
            const base = decision.symbol.replace(/(USDT|BUSD|USDC)$/i, '');
            sizeLabel = `${formatNumber(qty, 4)} ${base || decision.symbol}`;
        } else if (qty !== undefined && qty !== null) {
            sizeLabel = formatNumber(qty, 4);
        }

        const slPct = entry && sl ? -Math.abs(((sl - entry) / entry) * 100) : null;
        const tpPct = entry && tp ? Math.abs(((tp - entry) / entry) * 100) : null;

        const fmtPct = (value) => {
            if (value === undefined || value === null || !Number.isFinite(value)) return '--';
            const sign = value > 0 ? '+' : value < 0 ? '' : '';
            return `${sign}${value.toFixed(1)}%`;
        };

        setOutput('out-size', sizeLabel);
        setOutput('out-sl', fmtPct(slPct));
        setOutput('out-tp', fmtPct(tpPct));

        if (decision.guardian_passed === false) {
            const rawReason = decision.guardian_reason || t('summary.blocked.reason');
            const reason = translateReason(rawReason);
            setSummary('sum-risk', `${t('summary.risk.blocked')} ${reason}.`);
        } else {
            const fmt = t('summary.risk.format')
                .replace('{level}', riskLevel.toUpperCase())
                .replace('{size}', sizeLabel)
                .replace('{sl}', fmtPct(slPct))
                .replace('{tp}', fmtPct(tpPct));
            setSummary('sum-risk', fmt);
        }
    } else {
        setAgentStatus('flow-risk', 'Idle');
        setSummary('sum-risk', t('summary.risk.idle'));
    }

    // Final Output
    const finalEl = document.getElementById('out-final');
    if (finalEl && decision.action) {
        setAgentStatus('flow-output', 'Done');
        const actionDiv = finalEl.querySelector('.final-action');
        const symbolSpan = document.getElementById('final-symbol');
        const sizeSpan = document.getElementById('final-size');
        const params = decision.order_params || decision.params || decision.details || null;
        const qty = params ? params.quantity : null;
        const isBlocked = decision.guardian_passed === false;
        let sizeLabel = '--';
        if (qty !== undefined && qty !== null && decision.symbol) {
            const base = decision.symbol.replace(/(USDT|BUSD|USDC)$/i, '');
            sizeLabel = `${formatNumber(qty, 4)} ${base || decision.symbol}`;
        } else if (qty !== undefined && qty !== null) {
            sizeLabel = formatNumber(qty, 4);
        }

        const actionLower = String(decision.action || '').toLowerCase();
        const finalActionText = isBlocked ? 'BLOCKED' : decision.action.toUpperCase();
        if (actionDiv) {
            actionDiv.textContent = finalActionText;
            actionDiv.className = 'final-action';
            if (isBlocked) {
                actionDiv.classList.add('blocked');
            } else if (actionLower.includes('long')) {
                actionDiv.classList.add('long');
            } else if (actionLower.includes('short')) {
                actionDiv.classList.add('short');
            }
        }
        if (symbolSpan) symbolSpan.textContent = decision.symbol || '--';
        if (sizeSpan) sizeSpan.textContent = isBlocked ? '--' : sizeLabel;

        const symbolText = decision.symbol || '--';
        if (isBlocked) {
            const rawReason = decision.guardian_reason || t('summary.blocked.reason');
            const reason = translateReason(rawReason);
            setSummary('sum-output', `${t('summary.output.blocked')} ${symbolText}. ${reason}.`);
        } else {
            const fmt = t('summary.output.format')
                .replace('{action}', decision.action.toUpperCase())
                .replace('{symbol}', symbolText)
                .replace('{size}', sizeLabel);
            setSummary('sum-output', fmt);
        }
    } else {
        setAgentStatus('flow-output', 'Idle');
        setSummary('sum-output', t('summary.output.pending'));
    }

    // 🆕 Symbol Selector Agent
    updateSymbolSelectorCard();

    // 🆕 Trigger Detector Agent
    if (!isEnabled('trigger_detector_agent')) {
        setAgentStatus('flow-trigger-detector', 'Off');
        setOutput('out-pattern', '--');
        setOutput('out-trigger-signal', '--');
        setOutput('out-trigger-score', '--');
        setSummary('sum-trigger-detector', 'Trigger detector off.');
    } else if (decision.action) {
        setAgentStatus('flow-trigger-detector', 'Done');
        setOutput('out-pattern', decision.trigger_pattern || '--');
        setOutput('out-trigger-signal', decision.action || '--');
        const rvol = decision.trigger_rvol;
        setOutput('out-trigger-score', rvol !== undefined && rvol !== null ? `${rvol.toFixed(1)}x` : '--');
        const pattern = decision.trigger_pattern || 'None';
        const rvolText = rvol !== undefined && rvol !== null ? `${rvol.toFixed(1)}x` : '--';
        setSummary('sum-trigger-detector', `Pattern ${pattern} | RVOL ${rvolText} | ${decision.action}.`);
    } else {
        setAgentStatus('flow-trigger-detector', 'Idle');
        setOutput('out-pattern', '--');
        setOutput('out-trigger-signal', '--');
        setOutput('out-trigger-score', '--');
        setSummary('sum-trigger-detector', 'Trigger detector idle.');
    }

    // 🆕 Position Analyzer Agent
    if (!isEnabled('position_analyzer_agent')) {
        setAgentStatus('flow-position-analyzer', 'Off');
        setOutput('out-zone', '--');
        setOutput('out-sr', '--');
        setOutput('out-range', '--');
        setSummary('sum-position-analyzer', 'Position off.');
    } else {
        const positionInfo = decision.order_params?.position_1h || decision.position || null;
        if (decision.position_zone !== undefined || positionInfo) {
            setAgentStatus('flow-position-analyzer', 'Done');
            const zone = decision.position_zone || positionInfo?.location || '--';
            const rangeLow = positionInfo?.range_low;
            const rangeHigh = positionInfo?.range_high;
            const rangeSize = positionInfo?.range_size;
            const posPct = positionInfo?.position_pct;

            const srLabel = (rangeLow !== undefined && rangeLow !== null && rangeHigh !== undefined && rangeHigh !== null)
                ? `${formatNumber(rangeLow, 2)} - ${formatNumber(rangeHigh, 2)}`
                : '--';

            let rangeLabel = '--';
            if (rangeSize !== undefined && rangeSize !== null) {
                rangeLabel = formatNumber(rangeSize, 2);
            } else if (posPct !== undefined && posPct !== null) {
                rangeLabel = `${formatNumber(posPct, 0)}%`;
            }

            setOutput('out-zone', zone);
            setOutput('out-sr', srLabel);
            setOutput('out-range', rangeLabel);
            const pctLabel = posPct !== undefined && posPct !== null ? `${formatNumber(posPct, 0)}%` : '--';
            setSummary('sum-position-analyzer', `Zone ${zone} | Range ${srLabel} | Pos ${pctLabel}.`);
        } else {
            setAgentStatus('flow-position-analyzer', 'Idle');
            setOutput('out-zone', '--');
            setOutput('out-sr', '--');
            setOutput('out-range', '--');
            setSummary('sum-position-analyzer', 'Position pending.');
        }
    }

    // 🆕 Trend Agent (LLM)
    if (!isEnabled('trend_agent')) {
        setAgentStatus('flow-trend-agent', 'Off');
        setOutput('out-trend-1h', '--');
        setOutput('out-trend-bias', '--');
        setOutput('out-trend-conf', '--');
        setSummary('sum-trend-agent', 'Trend agent off.');
    } else if (decision.semantic_analyses && decision.semantic_analyses.trend) {
        setAgentStatus('flow-trend-agent', 'Done');
        const trend = decision.semantic_analyses.trend;
        setOutput('out-trend-1h', trend.stance || '--');
        setOutput('out-trend-bias', trend.metadata?.strength || '--');
        setOutput('out-trend-conf', trend.metadata?.adx !== undefined ? `${trend.metadata.adx}` : '--');
        const stance = trend.stance || 'neutral';
        const strength = trend.metadata?.strength || 'neutral';
        const adxVal = trend.metadata?.adx;
        const adxText = adxVal !== undefined && adxVal !== null ? formatNumber(adxVal, 1) : '--';
        setSummary('sum-trend-agent', `Trend ${stance} | ${strength} | ADX ${adxText}.`);
    } else if (voteAnalysis.trend_1h || voteAnalysis.trend_15m || adxFallback !== undefined) {
        setAgentStatus('flow-trend-agent', 'Done');
        const stance = voteAnalysis.trend_1h || 'neutral';
        const strength = voteAnalysis.trend_15m || '--';
        const adxText = adxFallback !== undefined && adxFallback !== null ? formatNumber(adxFallback, 1) : '--';
        setOutput('out-trend-1h', stance);
        setOutput('out-trend-bias', strength);
        setOutput('out-trend-conf', adxText);
        setSummary('sum-trend-agent', `Trend ${stance} | ${strength} | ADX ${adxText}.`);
    } else {
        setAgentStatus('flow-trend-agent', 'Idle');
        setOutput('out-trend-1h', '--');
        setOutput('out-trend-bias', '--');
        setOutput('out-trend-conf', '--');
        setSummary('sum-trend-agent', 'Trend idle.');
    }

    // 🆕 Trigger Agent (LLM)
    if (!isEnabled('trigger_agent')) {
        setAgentStatus('flow-trigger-agent', 'Off');
        setOutput('out-fire', '--');
        setOutput('out-entry-type', '--');
        setOutput('out-fire-conf', '--');
        setSummary('sum-trigger-agent', 'Trigger agent off.');
    } else if (decision.semantic_analyses && decision.semantic_analyses.trigger) {
        setAgentStatus('flow-trigger-agent', 'Done');
        const trigger = decision.semantic_analyses.trigger;
        setOutput('out-fire', trigger.stance || '--');
        setOutput('out-entry-type', trigger.metadata?.pattern || '--');
        setOutput('out-fire-conf', trigger.metadata?.rvol !== undefined ? `${trigger.metadata.rvol}x` : '--');
        const stance = trigger.stance || 'neutral';
        const pattern = trigger.metadata?.pattern || 'None';
        const rvol = trigger.metadata?.rvol;
        const rvolText = rvol !== undefined && rvol !== null ? `${formatNumber(rvol, 1)}x` : '--';
        setSummary('sum-trigger-agent', `Trigger ${stance} | ${pattern} | RVOL ${rvolText}.`);
    } else if (decision.trigger_pattern || decision.trigger_rvol !== undefined || decision.action) {
        setAgentStatus('flow-trigger-agent', 'Done');
        const action = decision.action ? decision.action.toUpperCase() : 'NEUTRAL';
        const pattern = decision.trigger_pattern || 'None';
        const rvol = decision.trigger_rvol;
        const rvolText = rvol !== undefined && rvol !== null ? `${formatNumber(rvol, 1)}x` : '--';
        setOutput('out-fire', action);
        setOutput('out-entry-type', pattern);
        setOutput('out-fire-conf', rvolText);
        setSummary('sum-trigger-agent', `Trigger ${action} | ${pattern} | RVOL ${rvolText}.`);
    } else {
        setAgentStatus('flow-trigger-agent', 'Idle');
        setOutput('out-fire', '--');
        setOutput('out-entry-type', '--');
        setOutput('out-fire-conf', '--');
        setSummary('sum-trigger-agent', 'Trigger idle.');
    }

    // 🆕 AI Prediction Filter
    if (!isEnabled('ai_prediction_filter_agent')) {
        setAgentStatus('flow-ai-filter', 'Off');
        setOutput('out-ai-status', '--');
        setOutput('out-ai-veto', '--');
        setOutput('out-ai-reason', '--');
        setSummary('sum-ai-filter', 'AI filter off.');
    } else if (decision.ai_filter_passed !== undefined) {
        setAgentStatus('flow-ai-filter', 'Done');
        const aiStatus = decision.ai_filter_passed === false ? '🚫 Blocked' : '✓ Pass';
        setOutput('out-ai-status', aiStatus);
        setOutput('out-ai-veto', decision.ai_filter_passed === false ? 'Yes' : 'No');
        setOutput('out-ai-reason', decision.ai_filter_reason || '--');
        const aiSignal = decision.ai_filter_signal || 'N/A';
        const conf = decision.ai_filter_confidence !== undefined && decision.ai_filter_confidence !== null
            ? formatPercent(decision.ai_filter_confidence, 0)
            : '--';
        setSummary('sum-ai-filter', `AI ${decision.ai_filter_passed ? 'PASS' : 'BLOCK'} | SIG ${aiSignal} | ${conf}.`);
    } else {
        setAgentStatus('flow-ai-filter', 'Idle');
        setOutput('out-ai-status', '--');
        setOutput('out-ai-veto', '--');
        setOutput('out-ai-reason', '--');
        setSummary('sum-ai-filter', 'AI filter idle.');
    }

    // 🆕 Reflection Agent
    if (!isEnabled('reflection_agent')) {
        setAgentStatus('flow-reflection', 'Off');
        setOutput('out-trades-count', '--');
        setOutput('out-win-rate', '--');
        setOutput('out-insight', '--');
        setSummary('sum-reflection', lang === 'zh' ? '复盘关闭。' : 'Reflection off.');
    } else if (decision.reflection) {
        setAgentStatus('flow-reflection', 'Done');
        const tradesCount = decision.reflection.trades;
        const winRate = decision.reflection.win_rate;
        const insightRaw = decision.reflection.text || '';
        const insight = insightRaw ? `${insightRaw}`.split('\n')[0].slice(0, 80) : '--';
        setOutput('out-trades-count', tradesCount !== undefined && tradesCount !== null ? `${tradesCount}` : '--');
        setOutput('out-win-rate', winRate !== undefined && winRate !== null ? `${winRate.toFixed(1)}%` : '--');
        setOutput('out-insight', insight || '--');
        const count = decision.reflection.count !== undefined && decision.reflection.count !== null
            ? ` #${decision.reflection.count}`
            : '';
        const winText = winRate !== undefined && winRate !== null ? `${winRate.toFixed(1)}%` : '--';
        const tradesText = tradesCount !== undefined && tradesCount !== null ? `${tradesCount}` : '--';
        setSummary('sum-reflection', lang === 'zh'
            ? `复盘${count} | 交易 ${tradesText} | 胜率 ${winText}`
            : `Reflection${count} | Trades ${tradesText} | WR ${winText}.`);
    } else {
        setAgentStatus('flow-reflection', 'Idle');
        setOutput('out-trades-count', '--');
        setOutput('out-win-rate', '--');
        setOutput('out-insight', '--');
        setSummary('sum-reflection', lang === 'zh' ? '复盘待命。' : 'Reflection idle.');
    }

    // 🆕 [NEW] Render Multi-Agent Chatroom
    const renderChatroom = (messages) => {
        const chatContainer = document.getElementById('chatroom-messages');
        if (!chatContainer) return;

        if (!messages || messages.length === 0) {
            if (!chatContainer.querySelector('.chatroom-empty')) {
                chatContainer.innerHTML = `
                    <div class="chatroom-empty">
                        <div class="icon">💬</div>
                        <p>${lang === 'zh' ? '等待代理开始分析...' : 'Waiting for agents to start...'}</p>
                    </div>
                `;
            }
            return;
        }

        // Check if update is needed (content-aware)
        const lastMsg = messages[messages.length - 1];
        const sig = lastMsg ? `${messages.length}|${lastMsg.timestamp}|${lastMsg.agent}|${lastMsg.content}` : `${messages.length}`;
        if (chatContainer.dataset.lastSig === sig) return;

        const translateChatText = (text) => {
            if (!text) return text;
            let out = String(text);
            if (lang === 'zh') {
                const rulesZh = [
                    { re: /Action:/g, out: '动作:' },
                    { re: /Conf:/g, out: '置信度:' },
                    { re: /Confidence:/g, out: '置信度:' },
                    { re: /Reason:/g, out: '原因:' },
                    { re: /Source:/g, out: '来源:' },
                    { re: /Weighted score/g, out: '加权得分' },
                    { re: /Alignment/g, out: '周期对齐' },
                    { re: /Misaligned/g, out: '多周期分歧' },
                    { re: /Waiting for 1h confirmation/g, out: '等待1h确认' },
                    { re: /Choppy market wait/g, out: '震荡市观望' },
                    { re: /Oscillator/g, out: '震荡指标' },
                    { re: /strongly oversold/g, out: '强烈超卖' },
                    { re: /strongly overbought/g, out: '强烈超买' },
                    { re: /avoid chasing short/g, out: '避免追低做空' },
                    { re: /avoid chasing long/g, out: '避免追高做多' },
                    { re: /Pos=/g, out: '位置=' },
                    { re: /bullish/g, out: '多头' },
                    { re: /bearish/g, out: '空头' },
                    { re: /trend/gi, out: '趋势' },
                    { re: /Stance:/g, out: '立场:' },
                    { re: /Strength:/g, out: '强度:' },
                    { re: /ADX:/g, out: 'ADX:' },
                    { re: /OI Fuel:/g, out: 'OI动能:' },
                    { re: /Pattern:/g, out: '形态:' },
                    { re: /RVOL:/g, out: '相对成交量:' },
                    { re: /Trigger:/g, out: '触发:' },
                    { re: /Mode:/g, out: '模式:' },
                    { re: /Symbols:/g, out: '币种:' },
                    { re: /Probability Up:/g, out: '上涨概率:' },
                    { re: /Analysis Complete/g, out: '分析完成' },
                    { re: /Insight:/g, out: '洞察:' },
                    { re: /\bFAST\b/g, out: '快速' },
                    { re: /\bFORCED\b/g, out: '强制' },
                    { re: /\bHOLD\b/g, out: '观望' },
                    { re: /\bWAIT\b/g, out: '等待' },
                    { re: /\bLONG\b/g, out: '做多' },
                    { re: /\bSHORT\b/g, out: '做空' },
                    { re: /\bOPEN_LONG\b/g, out: '开多' },
                    { re: /\bOPEN_SHORT\b/g, out: '开空' },
                    { re: /\bCLOSE_POSITION\b/g, out: '平仓' },
                    { re: /\bNEUTRAL\b/g, out: '中性' },
                    { re: /\bERROR\b/g, out: '错误' },
                    { re: /\bRULE\b/g, out: '规则' },
                    { re: /\bLLM\b/g, out: '大模型' },
                    { re: /\bDecision Core\b/g, out: '决策核心' },
                    { re: /\bRisk Audit\b/g, out: '风险审计' },
                    { re: /\bTrend Agent\b/g, out: '趋势代理' },
                    { re: /\bTrigger Agent\b/g, out: '触发代理' },
                    { re: /\bSetup Agent\b/g, out: '形态代理' },
                    { re: /\bReflection Agent\b/g, out: '复盘代理' },
                    { re: /Decision/g, out: '决策' }
                ];
                rulesZh.forEach(({ re, out: rep }) => {
                    out = out.replace(re, rep);
                });
                if (!out || !out.trim()) {
                    out = '（内容为空）';
                }
                return out;
            }

            // English mode: convert Chinese fragments to English, hide remaining Chinese
            let outEn = out;
            const rulesEn = [
                { re: /加权得分/g, out: 'Weighted score' },
                { re: /周期对齐/g, out: 'Alignment' },
                { re: /多周期分歧/g, out: 'Misaligned' },
                { re: /等待1h确认/g, out: 'Waiting for 1h confirmation' },
                { re: /震荡市观望/g, out: 'Choppy market wait' },
                { re: /震荡指标强烈超卖\(([^)]+)\)，避免追低做空/g, out: 'Strong oversold ($1), avoid chasing short' },
                { re: /震荡指标强烈超买\(([^)]+)\)，避免追高做多/g, out: 'Strong overbought ($1), avoid chasing long' },
                { re: /震荡指标/g, out: 'Oscillator' },
                { re: /强烈超卖/g, out: 'strongly oversold' },
                { re: /强烈超买/g, out: 'strongly overbought' },
                { re: /避免追低做空/g, out: 'avoid chasing short' },
                { re: /避免追高做多/g, out: 'avoid chasing long' },
                { re: /位置=/g, out: 'Pos=' },
                { re: /多头/g, out: 'bullish' },
                { re: /空头/g, out: 'bearish' },
                { re: /趋势/g, out: 'trend' }
            ];
            rulesEn.forEach(({ re, out: rep }) => {
                outEn = outEn.replace(re, rep);
            });
            if (/[\u4e00-\u9fa5]/.test(outEn)) {
                outEn = 'Details available (non-English content hidden)';
            }
            return outEn;
        };

        chatContainer.innerHTML = '';
        const currentCycle = Number(document.getElementById('framework-cycle')?.textContent?.replace(/\D/g, '') || '');
        const visibleMessages = Number.isFinite(currentCycle)
            ? messages.filter(m => Number(m.cycle) === currentCycle)
            : messages;

        const orderedMessages = visibleMessages
            .map((msg, idx) => ({ msg, idx }))
            .sort((a, b) => {
                const aFirst = a.msg.agent === 'symbol_selector';
                const bFirst = b.msg.agent === 'symbol_selector';
                if (aFirst && !bFirst) return -1;
                if (!aFirst && bFirst) return 1;
                return a.idx - b.idx;
            })
            .map(item => item.msg);

        orderedMessages.forEach(msg => {
            const bubble = document.createElement('div');
            bubble.className = `chat-bubble ${msg.agent} chat-level-${msg.level || 'info'}`;

            const agentName = titleMap[lang]?.[msg.agent] || msg.agent.replace('_', ' ').toUpperCase();
            const timeStr = msg.timestamp ? (msg.timestamp.includes(' ') ? msg.timestamp.split(' ')[1] : msg.timestamp) : '--:--:--';
            const content = translateChatText(msg.content);

            bubble.innerHTML = `
                <div class="chat-header">
                    <span class="chat-agent-name">${agentName}</span>
                    <span class="chat-timestamp">${timeStr}</span>
                </div>
                <div class="chat-content">${content}</div>
            `;
            chatContainer.appendChild(bubble);
        });
        chatContainer.dataset.lastSig = sig;

        // Auto-scroll to bottom
        setTimeout(() => {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }, 50);
    };

    // Initialize/Update Chatroom
    if (agents && agents.agent_messages) {
        renderChatroom(agents.agent_messages);
    }
}

// 🆕 Update K-Line Symbol Selector dynamically
function updateSymbolSelector(symbols) {
    const selector = document.getElementById('symbol-selector');
    if (!selector || !symbols || symbols.length === 0) return;

    // Get current selection
    const currentSymbol = selector.value;

    // Store symbols globally for reference
    window.activeSymbols = symbols;

    // Build new options
    const options = symbols.map(symbol => {
        // Format display name (e.g., BTCUSDT -> BTC/USDT)
        const displayName = symbol.replace('USDT', '/USDT');
        return `<option value="${symbol}">${displayName}</option>`;
    }).join('');

    // Update selector
    selector.innerHTML = options;

    // Restore previous selection if it still exists
    if (symbols.includes(currentSymbol)) {
        selector.value = currentSymbol;
        // Still load chart on first call even if symbol was preserved
        if (!window.chartSymbolInitialized && typeof loadTradingViewChart === 'function') {
            loadTradingViewChart(currentSymbol);
            window.chartSymbolInitialized = true;
        }
    } else {
        // Default to first symbol and reload chart
        selector.value = symbols[0];
        if (typeof loadTradingViewChart === 'function') {
            loadTradingViewChart(symbols[0]);
            window.chartSymbolInitialized = true;
        }
    }
}

// 🆕 Update Decision Filter Symbol Selector dynamically
function updateDecisionFilter(symbols) {
    const filterSelector = document.getElementById('filter-symbol');
    if (!filterSelector || !symbols || symbols.length === 0) return;

    // Get current selection
    const currentFilter = filterSelector.value;

    // Build new options (always keep "All Symbols" as first option)
    const options = ['<option value="all">All Symbols</option>'];

    symbols.forEach(symbol => {
        // Format display name (e.g., BTCUSDT -> BTC)
        const displayName = symbol.replace('USDT', '');
        options.push(`<option value="${symbol}">${displayName}</option>`);
    });

    // Update selector
    filterSelector.innerHTML = options.join('');

    // Restore previous selection if it still exists
    if (currentFilter === 'all' || symbols.includes(currentFilter)) {
        filterSelector.value = currentFilter;
    } else {
        // Default to "all"
        filterSelector.value = 'all';
    }
}

function renderLogs(logs, simplifiedLogs) {
    const container = document.getElementById('logs-container');
    if (!container) return;

    const safeLogs = Array.isArray(logs) ? logs : [];
    const safeSimplifiedLogs = Array.isArray(simplifiedLogs) ? simplifiedLogs : [];

    // Smart Scroll: Check if user is near bottom before update
    const isScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 100;
    const previousScrollTop = container.scrollTop;

    // Get current log mode from global state (default: simplified)
    const logMode = window.logMode || 'simplified';

    const hasSimplifiedLogs = safeSimplifiedLogs.length > 0;
    const sourceLogs = (logMode === 'simplified' && hasSimplifiedLogs) ? safeSimplifiedLogs : safeLogs;

    // Filter logs based on mode (skip if pre-filtered by server)
    const filteredLogs = (logMode === 'simplified' && !(hasSimplifiedLogs && sourceLogs === safeSimplifiedLogs))
        ? sourceLogs.filter(logLine => {
            // Strip ANSI colors for filtering
            const cleanLine = logLine.replace(/\x1b\[[0-9;]*m/g, '');

            // 🎯 Simplified Mode: Show only Agent Summaries + Warnings/Errors

            // 1. Always show WARNING and ERROR
            if (cleanLine.includes('WARNING') ||
                cleanLine.includes('ERROR') ||
                /\bwarn\b/i.test(cleanLine) ||
                /\berror\b/i.test(cleanLine) ||
                cleanLine.includes('⚠️') ||
                cleanLine.includes('❌')) {
                return true;
            }

            // 2. Show Agent Summary Lines
            const hasAgentTag = (
                cleanLine.includes('[📊 SYSTEM]') ||
                cleanLine.includes('[🔄 CONFIG]') ||
                cleanLine.includes('[🎯 SYSTEM]') ||
                cleanLine.includes('[🕵️ ORACLE]') ||
                cleanLine.includes('[👨‍🔬 STRATEGIST]') ||
                cleanLine.includes('[🔮 PROPHET]') ||
                cleanLine.includes('[🐂 Long Case]') ||
                cleanLine.includes('[🐻 Short Case]') ||
                cleanLine.includes('[⚖️ CRITIC]') ||
                cleanLine.includes('[⚖️ Final Decision]') ||
                cleanLine.includes('[🛡️ GUARDIAN]') ||
                cleanLine.includes('[🚀 EXECUTOR]') ||
                cleanLine.includes('[Execution]') ||
                cleanLine.includes('[🧠 REFLECTION]')
            );

            const hasAgentKeyword = (
                cleanLine.includes('DataSyncAgent') ||
                cleanLine.includes('QuantAnalystAgent') ||
                cleanLine.includes('PredictAgent') ||
                cleanLine.includes('DecisionCoreAgent') ||
                cleanLine.includes('RiskAuditAgent') ||
                cleanLine.includes('ExecutionEngine') ||
                cleanLine.includes('StrategyEngine') ||
                cleanLine.includes('ReflectionAgent') ||
                cleanLine.includes('ReflectionAgentLLM') ||
                cleanLine.includes('TrendAgent') ||
                cleanLine.includes('TrendAgentLLM') ||
                cleanLine.includes('SetupAgent') ||
                cleanLine.includes('SetupAgentLLM') ||
                cleanLine.includes('TriggerAgent') ||
                cleanLine.includes('TriggerAgentLLM')
            );

            if (hasAgentTag || hasAgentKeyword) {
                return true;
            }

            // 3. Show System Status Changes
            if (cleanLine.includes('⏹️') ||  // Stopped
                cleanLine.includes('⏸️') ||  // Paused
                cleanLine.includes('▶️') ||  // Started
                cleanLine.includes('STOPPED') ||
                cleanLine.includes('PAUSED') ||
                cleanLine.includes('RESUMED') ||
                cleanLine.includes('START')) {
                return true;
            }

            // 4. Show Cycle Separators
            if (cleanLine.includes('━━━') ||
                cleanLine.includes('Cycle #')) {
                return true;
            }

            return false;
        })
        : sourceLogs; // Show all logs in detailed mode

    container.innerHTML = filteredLogs.map(logLine => {
        // Strip ANSI colors
        let cleanLine = logLine.replace(/\x1b\[[0-9;]*m/g, '');

        // Parse log line format: "2025-12-28 08:59:04 | INFO | src.agents.xxx:func - Message"
        let content = cleanLine;
        let time = '';

        // In simplified mode, strip file path and function name
        if (logMode === 'simplified') {
            // Match: "YYYY-MM-DD HH:MM:SS | LEVEL | module:function - message"
            const logMatch = cleanLine.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*\|\s*\w+\s*\|\s*[\w\._:]+\s*-\s*(.*)/);
            if (logMatch) {
                time = `<span class="log-time">${logMatch[1]}</span>`;
                content = logMatch[2];
            } else {
                // Fallback: try original format "[time] message"
                const timeMatch = cleanLine.match(/^\[(.*?)\]\s*(.*)/);
                if (timeMatch) {
                    time = `<span class="log-time">${timeMatch[1]}</span>`;
                    content = timeMatch[2];
                }
            }
        } else {
            // Detailed mode: keep full format
            const timeMatch = cleanLine.match(/^\[(.*?)\]\s*(.*)/);
            if (timeMatch) {
                time = `<span class="log-time">${timeMatch[1]}</span>`;
                content = timeMatch[2];
            }
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
    if (isScrolledToBottom || previousScrollTop === 0) {
        container.scrollTop = container.scrollHeight;
    } else {
        container.scrollTop = previousScrollTop;
    }
}

// Initialize log mode toggle
window.logMode = 'simplified'; // Default mode

// Add event listener for log mode toggle button
document.addEventListener('DOMContentLoaded', function () {
    const logModeToggle = document.getElementById('log-mode-toggle');
    const logModeIcon = document.getElementById('log-mode-icon');
    const logModeText = document.getElementById('log-mode-text');

    if (logModeToggle) {
        logModeToggle.addEventListener('click', function () {
            // Toggle mode
            window.logMode = window.logMode === 'simplified' ? 'detailed' : 'simplified';

            // Update button appearance
            if (window.logMode === 'detailed') {
                logModeToggle.classList.add('detailed');
                logModeIcon.textContent = '📄';
                logModeText.textContent = 'Detailed';
            } else {
                logModeToggle.classList.remove('detailed');
                logModeIcon.textContent = '📋';
                logModeText.textContent = 'Simplified';
            }

            // Force re-render of logs
            updateDashboard();
        });
    }
});

// 🚀 MAIN INITIALIZATION
document.addEventListener('DOMContentLoaded', function () {
    console.log('🚀 App Initializing...');

    // 1. Language Init (Priority)
    try {
        console.log('🌐 Init Language:', window.currentLang);
        if (typeof applyTranslations === 'function') {
            applyTranslations(window.currentLang);
            updateLanguageButton();
        }
    } catch (e) { console.error('Language Init Error:', e); }

    // 2. Chart Init
    try {
        initChart();
    } catch (e) { console.error('Chart Init Error:', e); }

    // 3. Event Listeners
    try {
        setupEventListeners();
    } catch (e) { console.error('EventListeners Init Error:', e); }

    // 4. Role Restrictions (if defined)
    try {
        if (typeof applyRoleRestrictions === 'function') applyRoleRestrictions();
    } catch (e) { console.error('Role Restrictions Error:', e); }

    // 5. Start Polling
    setInterval(updateDashboard, 2000);
    updateDashboard();

    // 6. Symbol Ranking Update (less frequent - every 10 seconds)
    fetchAndRenderSymbolRanking();
    setInterval(fetchAndRenderSymbolRanking, 10000);

    console.log('✅ App Initialization Complete');
});

function setControl(action, payload = {}) {
    if (!verifyRole()) return;

    // For 'start' action, check demo mode and show warning if needed
    // REMOVED per user request: No API warnings for Admin. verifyRole blocks Users.
    sendControlRequest(action, payload);
}

function sendControlRequest(action, payload = {}) {
    apiFetch('/api/control', {
        method: 'POST',
        body: JSON.stringify({
            action: action,
            ...payload
        })
    })
        .then(res => {
            if (res.status === 403) {
                // Demo expired
                return res.json().then(data => {
                    alert(data.detail || 'Demo 时间已用尽');
                    throw new Error('Demo expired');
                });
            }
            return res.json();
        })
        .then(data => {
            console.log(`Command ${action} sent.`, data);
            setTimeout(updateDashboard, 200);
        })
        .catch(err => console.error('Control request failed:', err));
}

function showDemoWarningModal(onConfirm) {
    const modal = document.createElement('div');
    modal.id = 'demo-warning-modal';
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
        z-index: 10001;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        background: linear-gradient(135deg, #1e1e2e 0%, #2a2a3e 100%);
        border: 2px solid #ff8c00;
        border-radius: 12px;
        padding: 30px;
        max-width: 480px;
        box-shadow: 0 10px 40px rgba(255, 140, 0, 0.3);
    `;

    content.innerHTML = `
        <div style="text-align: center;">
            <div style="font-size: 48px; margin-bottom: 15px;">⚠️</div>
            <h2 style="color: #ff8c00; margin: 0 0 15px 0; font-size: 22px;">Demo Mode Notice</h2>
            <p style="color: #e0e6ed; margin: 0 0 20px 0; line-height: 1.6; font-size: 15px;">
                You are using the <strong style="color: #ff8c00;">default LLM API</strong>,<br>
                which is limited to <strong style="color: #ff8c00;">20 minutes</strong> of usage.
            </p>
            <div style="background: rgba(255, 140, 0, 0.1); border-left: 3px solid #ff8c00; padding: 12px; margin-bottom: 20px; text-align: left;">
                <p style="margin: 0; color: #94a3b8; font-size: 13px; line-height: 1.5;">
                    💡 For unlimited usage, please configure your own API Key in <strong>Settings > API Keys</strong>
                </p>
            </div>
            <div style="display: flex; gap: 15px; justify-content: center;">
                <button id="demo-warning-cancel" style="
                    background: #4a5568;
                    color: white;
                    border: none;
                    padding: 10px 25px;
                    border-radius: 6px;
                    font-size: 14px;
                    cursor: pointer;
                ">Cancel</button>
                <button id="demo-warning-confirm" style="
                    background: linear-gradient(135deg, #00ff9d 0%, #00cc7e 100%);
                    color: #1a202c;
                    border: none;
                    padding: 10px 25px;
                    border-radius: 6px;
                    font-size: 14px;
                    font-weight: bold;
                    cursor: pointer;
                ">Continue</button>
            </div>
        </div>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    document.getElementById('demo-warning-cancel').addEventListener('click', () => {
        modal.remove();
    });

    document.getElementById('demo-warning-confirm').addEventListener('click', () => {
        modal.remove();
        if (onConfirm) onConfirm();
    });
}

// Expose setControl globally for inline HTML access
window.setControl = setControl;

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

// Demo Mode Handling (20-minute limit for default API)
// Note: demoExpiredShown is now declared at the top of the file to avoid TDZ error

function handleDemoMode(demo) {
    const btnStart = document.getElementById('btn-start');

    // Update timer display if demo is active
    if (demo.demo_mode_active && !demo.demo_expired) {
        updateDemoTimer(demo.demo_time_remaining);
    } else {
        // Hide timer when not in demo mode
        const timerEl = document.getElementById('demo-timer');
        if (timerEl) timerEl.style.display = 'none';
    }

    // Handle expired state
    if (demo.demo_expired) {
        // Disable start button
        if (btnStart) {
            btnStart.disabled = true;
            btnStart.title = 'Demo time expired. Please configure your own API Key';
            btnStart.style.opacity = '0.5';
            btnStart.style.cursor = 'not-allowed';
        }

        // Show expired modal once
        if (!demoExpiredShown) {
            showDemoExpiredModal();
            demoExpiredShown = true;
        }
    } else {
        // Re-enable start button if not expired
        if (btnStart) {
            btnStart.disabled = false;
            btnStart.title = 'Start Trading';
            btnStart.style.opacity = '1';
            btnStart.style.cursor = 'pointer';
        }
        demoExpiredShown = false;
    }
}

function updateDemoTimer(secondsRemaining) {
    let timerEl = document.getElementById('demo-timer');

    // Create timer element if it doesn't exist
    if (!timerEl) {
        timerEl = document.createElement('div');
        timerEl.id = 'demo-timer';
        timerEl.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: linear-gradient(135deg, #ff8c00, #ff4500);
            color: white;
            padding: 10px 15px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: bold;
            box-shadow: 0 4px 15px rgba(255, 69, 0, 0.4);
            z-index: 9999;
        `;
        document.body.appendChild(timerEl);
    }

    const minutes = Math.floor(secondsRemaining / 60);
    const seconds = secondsRemaining % 60;
    timerEl.innerHTML = `⏱️ Demo: ${minutes}:${seconds.toString().padStart(2, '0')}`;
    timerEl.style.display = 'block';

    // Change color when time is running low
    if (secondsRemaining < 300) { // Less than 5 minutes
        timerEl.style.background = 'linear-gradient(135deg, #ff0000, #cc0000)';
    }
}

function showDemoExpiredModal() {
    const modal = document.createElement('div');
    modal.id = 'demo-expired-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        background: linear-gradient(135deg, #1e1e2e 0%, #2a2a3e 100%);
        border: 2px solid #ff8c00;
        border-radius: 12px;
        padding: 30px;
        max-width: 500px;
        box-shadow: 0 10px 40px rgba(255, 140, 0, 0.3);
    `;

    content.innerHTML = `
        <div style="text-align: center;">
            <div style="font-size: 48px; margin-bottom: 20px;">⏰</div>
            <h2 style="color: #ff8c00; margin: 0 0 15px 0; font-size: 24px;">Demo Time Expired</h2>
            <p style="color: #94a3b8; margin: 0 0 10px 0; line-height: 1.6;">
                You have used the default API for <strong style="color: #ff8c00;">20 minutes</strong>
            </p>
            <p style="color: #64748b; margin: 0 0 25px 0; font-size: 14px;">
                Please configure your own API Key to continue
            </p>
            <div style="background: rgba(255, 140, 0, 0.1); border-left: 3px solid #ff8c00; padding: 15px; margin-bottom: 25px; text-align: left;">
                <p style="margin: 0; color: #e0e6ed; font-size: 14px; line-height: 1.5;">
                    <strong>How to unlock:</strong><br>
                    1. Click <strong>⚙️ Settings</strong> in the top right<br>
                    2. Enter your DeepSeek/OpenAI API Key in <strong>API Keys</strong> tab<br>
                    3. Click <strong>Save Changes</strong><br>
                    4. Restart the bot to use without limits
                </p>
            </div>
            <button id="close-demo-expired-btn" style="
                background: linear-gradient(135deg, #ff8c00 0%, #ff4500 100%);
                color: white;
                border: none;
                padding: 12px 30px;
                border-radius: 6px;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                transition: all 0.3s;
            ">
                Got it
            </button>
        </div>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    document.getElementById('close-demo-expired-btn').addEventListener('click', () => {
        modal.remove();
    });
}

function setupEventListeners() {
    const btnStart = document.getElementById('btn-start');
    if (btnStart) btnStart.addEventListener('click', () => setControl('start'));

    const btnPause = document.getElementById('btn-pause');
    if (btnPause) btnPause.addEventListener('click', () => setControl('pause'));

    const btnStop = document.getElementById('btn-stop');
    if (btnStop) btnStop.addEventListener('click', () => setControl('stop'));

    // Initialize Settings
    if (typeof initSettings === 'function') {
        initSettings();
    }

    // Custom Prompt Upload Logic
    const btnUpload = document.getElementById('btn-upload');
    const fileInput = document.getElementById('file-upload');

    if (btnUpload && fileInput) {
        btnUpload.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('file', file);

            try {
                // Show loading state
                const originalText = btnUpload.textContent;
                btnUpload.textContent = '⏳';
                btnUpload.disabled = true;

                const response = await fetch('/api/upload_prompt', {
                    method: 'POST',
                    body: formData,
                    credentials: 'include'
                });

                const result = await response.json();

                if (result.status === 'success') {
                    // Success feedback
                    btnUpload.textContent = '✅';
                    btnUpload.title = "Custom Prompt Loaded: " + file.name;
                    btnUpload.classList.add('success');

                    // Reset after 3 seconds
                    setTimeout(() => {
                        btnUpload.textContent = originalText;
                        btnUpload.disabled = false;
                        btnUpload.classList.remove('success');
                    }, 3000);
                } else {
                    throw new Error(result.detail || 'Upload failed');
                }
            } catch (err) {
                console.error(err);
                btnUpload.textContent = '❌';
                alert('Failed to upload prompt: ' + err.message);

                setTimeout(() => {
                    btnUpload.textContent = '📤';
                    btnUpload.disabled = false;
                }, 3000);
            }
        });
    }



    const intervalSel = document.getElementById('interval-selector');
    if (intervalSel) {
        intervalSel.addEventListener('change', (e) => {
            const val = parseFloat(e.target.value);
            setControl('set_interval', { interval: val });
        });
    }

    // 🆕 Log Mode Toggle
    const logModeToggle = document.getElementById('log-mode-toggle');
    if (logModeToggle) {
        // Initialize log mode from localStorage or default to 'simplified'
        window.logMode = localStorage.getItem('logMode') || 'simplified';
        updateLogModeUI();

        logModeToggle.addEventListener('click', () => {
            // Toggle between simplified and detailed
            window.logMode = window.logMode === 'simplified' ? 'detailed' : 'simplified';
            localStorage.setItem('logMode', window.logMode);
            updateLogModeUI();
            // Force refresh logs
            updateDashboard();
        });
    }

    // 🌐 Language Toggle
    const langToggle = document.getElementById('btn-language');
    if (langToggle) {
        console.log('✅ Language toggle button found, attaching listener');
        langToggle.addEventListener('click', toggleLanguage);
    } else {
        console.error('❌ Language toggle button NOT found');
    }
}

// Update log mode UI elements
function updateLogModeUI() {
    const iconEl = document.getElementById('log-mode-icon');
    const textEl = document.getElementById('log-mode-text');

    if (window.logMode === 'simplified') {
        if (iconEl) iconEl.textContent = '📋';
        if (textEl) textEl.textContent = 'Simplified';
    } else {
        if (iconEl) iconEl.textContent = '📜';
        if (textEl) textEl.textContent = 'Detailed';
    }
}

function updateLlmProviderKeyFields(provider) {
    const activeProvider = provider || 'none';
    const fields = document.querySelectorAll('.llm-key-field');
    fields.forEach((field) => {
        const fieldProvider = field.getAttribute('data-provider');
        field.style.display = fieldProvider === activeProvider ? '' : 'none';
    });
}

function initLlmProviderSelector() {
    const providerSel = document.getElementById('cfg-llm-provider');
    if (!providerSel) return;
    providerSel.onchange = () => updateLlmProviderKeyFields(providerSel.value);
    updateLlmProviderKeyFields(providerSel.value);
}

/* Settings Modal Logic */
function initSettings() {
    const modal = document.getElementById('settings-modal');
    const btnSettings = document.getElementById('btn-settings');
    const btnClose = document.getElementById('close-settings');
    const btnSave = document.getElementById('btn-save-settings');

    // Open Modal
    if (btnSettings) {
        btnSettings.addEventListener('click', async () => {
            modal.style.display = 'flex';
            await loadSettings();
        });
    }

    // Close Modal
    if (btnClose) {
        btnClose.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    // Save Settings
    if (btnSave) {
        // Remove existing listeners by cloning (simple way to prevent duplicate listeners if init called twice)
        // const newBtn = btnSave.cloneNode(true);
        // btnSave.parentNode.replaceChild(newBtn, btnSave);
        // Note: cloning removes event listeners but might break specific bindings if not careful.
        // Instead, we just ensure we only adding it once? or just accept it logging twice if added twice.

        btnSave.onclick = async (e) => {
            console.log('💾 Save Button Clicked');
            e.preventDefault();

            const originalText = btnSave.textContent;
            btnSave.textContent = 'Saving...';
            btnSave.disabled = true;
            try {
                await saveSettings();
                await savePrompt();
                modal.style.display = 'none';
                alert('Configuration saved! Please restart the bot if you updated API keys.');
            } catch (e) {
                console.error(e);
                alert('Error saving settings: ' + e.message);
            } finally {
                btnSave.textContent = originalText;
                btnSave.disabled = false;
            }
        }; // End of onclick

        // Expose global handler for HTML onclick fallback
        window.triggerSaveConfig = async (e) => {
            if (e) e.preventDefault();
            console.log("Trigger Save Called");

            const btn = document.getElementById('btn-save-settings');
            const originalText = btn ? btn.textContent : 'Save';

            if (btn) {
                btn.textContent = 'Saving...';
                btn.disabled = true;
            }

            try {
                // Direct call logic to bypass potential stale listeners
                await saveSettings();
                await savePrompt();

                // Success UI
                const modal = document.getElementById('settings-modal');
                if (modal) modal.style.display = 'none';

                // Using browser confirm is safer than alert sometimes in async flows
                // But alert is fine here.
                alert('✅ CORRECTLY SAVED!\nConfiguration and Prompt updated.');

            } catch (err) {
                console.error(err);
                alert('❌ SAVE FAILED:\n' + err.message);
            } finally {
                if (btn) {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }
            }
        };

    } else {
        console.error('❌ Save Button not found in Init');
    }

    // Tab Switching
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active
            document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

            // Add active
            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });

    initLlmProviderSelector();

    // Prompt Upload Logic
    const btnPromptUpload = document.getElementById('btn-prompt-upload');
    const promptInput = document.getElementById('prompt-file');
    if (btnPromptUpload && promptInput) {
        btnPromptUpload.addEventListener('click', () => promptInput.click());
        promptInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                document.getElementById('cfg-prompt').value = e.target.result;
            };
            reader.readAsText(file);
        });
    }

    // Reset Prompt Logic
    const btnReset = document.getElementById('btn-prompt-reset');
    if (btnReset) {
        btnReset.addEventListener('click', async () => {
            if (confirm('Are you sure you want to reset the System Prompt to default? This will overwrite your current edits.')) {
                try {
                    const res = await apiFetch('/api/config/default_prompt');
                    if (res.ok) {
                        const data = await res.json();
                        document.getElementById('cfg-prompt').value = data.content;
                    } else {
                        alert('Failed to fetch default prompt');
                    }
                } catch (e) {
                    console.error('Reset failed:', e);
                }
            }
        });
    }
}

async function loadSettings() {
    try {
        const res = await apiFetch('/api/config');
        const config = await res.json();

        // Fill Form
        const safeVal = (v) => v || '';
        document.getElementById('cfg-binance-key').value = safeVal(config.api_keys.binance_api_key);
        document.getElementById('cfg-binance-secret').value = safeVal(config.api_keys.binance_secret_key);
        document.getElementById('cfg-deepseek-key').value = safeVal(config.api_keys.deepseek_api_key);

        // Multi-LLM Provider Keys
        const setIfExists = (id, val) => { const el = document.getElementById(id); if (el) el.value = safeVal(val); };
        setIfExists('cfg-openai-key', config.api_keys.openai_api_key);
        setIfExists('cfg-claude-key', config.api_keys.claude_api_key);
        setIfExists('cfg-qwen-key', config.api_keys.qwen_api_key);
        setIfExists('cfg-gemini-key', config.api_keys.gemini_api_key);
        setIfExists('cfg-kimi-key', config.api_keys.kimi_api_key);
        setIfExists('cfg-minimax-key', config.api_keys.minimax_api_key);
        setIfExists('cfg-glm-key', config.api_keys.glm_api_key);
        setIfExists('cfg-openrouter-key', config.api_keys.openrouter_api_key);

        // LLM Provider Selection
        const llmProvider = config.llm?.provider || 'none';
        setIfExists('cfg-llm-provider', llmProvider);

        // Trigger provider change to show correct API key field
        const providerSel = document.getElementById('cfg-llm-provider');
        if (providerSel) {
            providerSel.value = llmProvider;
            providerSel.dispatchEvent(new Event('change'));
        }

        // Load Trading Mode if present
        const runModeEl = document.getElementById('cfg-run-mode');
        if (runModeEl) {
            runModeEl.value = safeVal(config.trading.run_mode || 'test');
        }

    } catch (e) {
        console.error('Failed to load settings:', e);
        // Do not alert here to avoid spamming on open
    }
}

async function saveSettings() {
    if (!verifyRole()) return;

    // Debug Point 1
    // alert('Starting saveSettings()...'); 

    // Validate Elements exist
    const elBinanceKey = document.getElementById('cfg-binance-key');
    const elBinanceSecret = document.getElementById('cfg-binance-secret');
    const elDeepseekKey = document.getElementById('cfg-deepseek-key');
    const elOpenaiKey = document.getElementById('cfg-openai-key');
    const elClaudeKey = document.getElementById('cfg-claude-key');
    const elQwenKey = document.getElementById('cfg-qwen-key');
    const elGeminiKey = document.getElementById('cfg-gemini-key');
    const elKimiKey = document.getElementById('cfg-kimi-key');
    const elMinimaxKey = document.getElementById('cfg-minimax-key');
    const elGlmKey = document.getElementById('cfg-glm-key');
    const elOpenrouterKey = document.getElementById('cfg-openrouter-key');
    const elLlmProvider = document.getElementById('cfg-llm-provider');

    if (!elBinanceKey || !elDeepseekKey) {
        throw new Error("Critical Form Elements missing! Refresh page.");
    }

    const data = {
        api_keys: {
            binance_api_key: elBinanceKey.value,
            binance_secret_key: elBinanceSecret ? elBinanceSecret.value : '',
            deepseek_api_key: elDeepseekKey.value,
            openai_api_key: elOpenaiKey ? elOpenaiKey.value : '',
            claude_api_key: elClaudeKey ? elClaudeKey.value : '',
            qwen_api_key: elQwenKey ? elQwenKey.value : '',
            gemini_api_key: elGeminiKey ? elGeminiKey.value : '',
            kimi_api_key: elKimiKey ? elKimiKey.value : '',
            minimax_api_key: elMinimaxKey ? elMinimaxKey.value : '',
            glm_api_key: elGlmKey ? elGlmKey.value : '',
            openrouter_api_key: elOpenrouterKey ? elOpenrouterKey.value : ''
        },
        llm: {
            llm_provider: elLlmProvider ? elLlmProvider.value : 'deepseek'
        }
    };
    const runModeEl = document.getElementById('cfg-run-mode');
    if (runModeEl) {
        data.trading = {
            run_mode: runModeEl.value
        };
    }

    const res = await apiFetch('/api/config', {
        method: 'POST',
        body: JSON.stringify(data)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error('Failed to save config: ' + errText);
    }
}

async function savePrompt() {
    const promptEl = document.getElementById('cfg-prompt');
    if (!promptEl) return;
    const content = promptEl.value;
    const res = await apiFetch('/api/config/prompt', {
        method: 'POST',
        body: JSON.stringify({ content })
    });

    if (!res.ok) throw new Error('Failed to save prompt');
}

// FALLBACK DEBUG & HANDLER
document.addEventListener('DOMContentLoaded', function () {
    console.log('🎯 Fallback Handler Loaded');

    // Initialize TradingView chart (fallback)
    if (!window.chartInitialized && typeof loadTradingViewChart === 'function') {
        loadTradingViewChart();
    }
    const btn = document.getElementById('btn-settings');
    const modal = document.getElementById('settings-modal');
    console.log('Btn:', btn, 'Modal:', modal);

    // Initialize Settings Logic
    if (typeof initSettings === 'function') {
        initSettings();
        console.log('✅ initSettings() called');
    } else {
        console.error('❌ initSettings function missing');
    }

    if (btn) {
        btn.addEventListener('click', (e) => {
            console.log('⚙️ Settings Clicked (Fallback)');
            e.preventDefault(); // Prevent any default behavior
            if (modal) {
                modal.style.display = 'flex';
                // Try load settings
                if (typeof loadSettings === 'function') {
                    loadSettings().catch(err => console.error(err));
                }
                // Load accounts when opening settings
                if (typeof loadAccounts === 'function') {
                    loadAccounts().catch(err => console.error(err));
                }
            } else {
                alert('Error: Settings Modal not found in DOM');
            }
        });
    } else {
        console.error('Settings Button not found in DOM during fallback init');
    }
});

// ============================================================================
// Multi-Account Management Functions
// ============================================================================

async function loadAccounts() {
    const container = document.getElementById('accounts-list');
    if (!container) return;

    container.innerHTML = '<p style="color: #718096; text-align: center;">Loading...</p>';

    try {
        const res = await apiFetch('/api/accounts');
        const data = await res.json();

        if (data.accounts && data.accounts.length > 0) {
            container.innerHTML = data.accounts.map(acc => `
                <div class="account-item" style="display: flex; justify-content: space-between; align-items: center; padding: 10px; margin-bottom: 8px; background: rgba(255,255,255,0.05); border-radius: 4px; border-left: 3px solid ${acc.enabled ? '#00ff9d' : '#718096'};">
                    <div>
                        <span style="font-weight: 600; color: #e0e6ed;">${acc.account_name}</span>
                        <span style="color: #718096; font-size: 0.8em; margin-left: 10px;">${acc.exchange_type}</span>
                        ${acc.testnet ? '<span style="background: #ecc94b; color: #1a202c; padding: 1px 6px; border-radius: 3px; font-size: 0.7em; margin-left: 8px;">TESTNET</span>' : ''}
                        ${acc.has_api_key ? '<span style="color: #00ff9d; font-size: 0.75em; margin-left: 8px;">✓ API Key</span>' : '<span style="color: #e53e3e; font-size: 0.75em; margin-left: 8px;">✗ No API Key</span>'}
                    </div>
                    <button onclick="deleteAccount('${acc.id}')" style="background: #e53e3e; color: white; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 0.8em;">Remove</button>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<p style="color: #718096; text-align: center;">No accounts configured.<br>Add one below or create config/accounts.json</p>';
        }
    } catch (e) {
        console.error('Failed to load accounts:', e);
        container.innerHTML = '<p style="color: #e53e3e; text-align: center;">Failed to load accounts</p>';
    }
}

async function deleteAccount(accountId) {
    if (!confirm(`Are you sure you want to remove this account?`)) return;

    try {
        const res = await apiFetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
        if (res.ok) {
            await loadAccounts();
        } else {
            const err = await res.json();
            alert('Failed to remove account: ' + (err.detail || 'Unknown error'));
        }
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

// Add Account Button Handler
document.addEventListener('DOMContentLoaded', () => {
    const addBtn = document.getElementById('btn-add-account');
    const refreshBtn = document.getElementById('btn-refresh-accounts');

    if (addBtn) {
        addBtn.addEventListener('click', async () => {
            const id = document.getElementById('new-account-id')?.value?.trim();
            const name = document.getElementById('new-account-name')?.value?.trim();
            const exchange = document.getElementById('new-account-exchange')?.value || 'binance';
            const testnet = document.getElementById('new-account-testnet')?.checked ?? true;

            if (!id || !name) {
                alert('Please enter both Account ID and Display Name');
                return;
            }

            try {
                const res = await apiFetch('/api/accounts', {
                    method: 'POST',
                    body: JSON.stringify({ id, name, exchange, testnet, enabled: true })
                });

                if (res.ok) {
                    // Clear form
                    document.getElementById('new-account-id').value = '';
                    document.getElementById('new-account-name').value = '';
                    // Reload list
                    await loadAccounts();
                    alert('✅ Account added successfully!\\nRemember to set API keys in .env file.');
                } else {
                    const err = await res.json();
                    alert('Failed to add account: ' + (err.detail || 'Unknown error'));
                }
            } catch (e) {
                alert('Error: ' + e.message);
            }
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadAccounts);
    }
});

// ============================================================================
// Trade History Rendering (Backend Data)
// ============================================================================

// Helper to format datetime to MM-DD HH:MM:SS
function formatDateTime(datetime) {
    if (!datetime || datetime === '-') return '-';
    if (datetime.includes(' ')) {
        const parts = datetime.split(' ');
        if (parts.length >= 2) {
            // 提取日期的月-日部分和时间
            const datePart = parts[0].split('-').slice(1).join('-'); // 提取 MM-DD
            const timePart = parts[1]; // HH:MM:SS
            return `${datePart} ${timePart}`;
        }
    }
    return datetime;
}

// Helper to format cycle ID (cycle_0013_...) -> #13
function formatCycle(cycleId) {
    if (!cycleId || cycleId === '-') return '-';
    // If it's a full cycle ID string "cycle_0013_123456"
    if (typeof cycleId === 'string' && cycleId.startsWith('cycle_')) {
        const parts = cycleId.split('_');
        if (parts.length >= 2) {
            return '#' + parseInt(parts[1], 10);
        }
    }
    return '#' + cycleId;
}

function renderTradeHistory(trades) {
    const tbody = document.querySelector('#trade-table tbody');
    if (!tbody) return;

    if (!trades || trades.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text-muted);">No trades yet</td></tr>';
        return;
    }

    tbody.innerHTML = trades.map(trade => {
        const time = trade.recorded_at || trade.timestamp || trade.record_time || '-';
        const openCycleRaw = trade.cycle !== undefined ? trade.cycle : trade.open_cycle;
        const openCycle = formatCycle(openCycleRaw === 0 || openCycleRaw === '0' ? '-' : openCycleRaw);
        const closeCycleRaw = trade.close_cycle;
        const closeCycle = formatCycle(closeCycleRaw === 0 || closeCycleRaw === '0' ? '-' : closeCycleRaw);
        const symbol = trade.symbol || '-';
        const sideRaw = String(
            trade.side
            || trade.position_side
            || trade.direction
            || trade.position
            || trade.action
            || ''
        ).toUpperCase();
        let direction = '-';
        if (sideRaw.includes('LONG') || sideRaw === 'BUY') direction = 'LONG';
        else if (sideRaw.includes('SHORT') || sideRaw === 'SELL') direction = 'SHORT';
        const directionClass = direction === 'LONG' ? 'pos' : (direction === 'SHORT' ? 'neg' : 'neutral');
        const entryPriceValue = trade.entry_price !== undefined ? trade.entry_price : trade.price;
        const entryPrice = entryPriceValue ? `$${Number(entryPriceValue).toLocaleString()}` : '-';
        const posValue = trade.quantity && entryPriceValue ? `$${(trade.quantity * entryPriceValue).toFixed(2)}` : '-';
        const exitPrice = trade.exit_price ? `$${Number(trade.exit_price).toLocaleString()}` : '-';

        // PnL formatting
        let pnlHtml = '-';
        let pnlPctHtml = '-';
        if (trade.pnl !== undefined && trade.pnl !== null) {
            const pnl = Number(trade.pnl);
            const pnlClass = pnl > 0 ? 'pos' : (pnl < 0 ? 'neg' : 'neutral');
            const pnlSign = pnl > 0 ? '+' : '';
            pnlHtml = `<span class="val ${pnlClass}">${pnlSign}$${pnl.toFixed(2)}</span>`;

            // Calculate PnL %
            if (entryPriceValue && trade.quantity) {
                const posValue = entryPriceValue * trade.quantity;
                const pnlPct = (pnl / posValue * 100).toFixed(2);
                pnlPctHtml = `<span class="val ${pnlClass}">${pnlSign}${pnlPct}%</span>`;
            }
        }

        // Action indicator
        const action = (trade.action || '').toUpperCase();
        let actionIcon = '';
        if (action.includes('OPEN') && action.includes('LONG')) actionIcon = '🟢';
        else if (action.includes('OPEN') && action.includes('SHORT')) actionIcon = '🔴';
        else if (action.includes('CLOSE')) actionIcon = '⚪';

        return `
            <tr>
                <td>${formatDateTime(time)}</td>
                <td>${actionIcon} ${openCycle}</td>
                <td>${closeCycle}</td>
                <td>${symbol}</td>
                <td><span class="val ${directionClass}">${direction}</span></td>
                <td>${entryPrice}</td>
                <td>${posValue}</td>
                <td>${exitPrice}</td>
                <td>${pnlHtml}</td>
                <td>${pnlPctHtml}</td>
            </tr>
        `;
    }).join('');
}

// ============================================================
// 🎯 Agent Box Drag & Drop Functionality
// ============================================================

(function initAgentDragDrop() {
    let draggedElement = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let elementStartX = 0;
    let elementStartY = 0;

    // Wait for DOM to be ready
    document.addEventListener('DOMContentLoaded', function () {
        initDraggableAgents();
    });

    // Also try to init immediately if DOM is already loaded
    if (document.readyState !== 'loading') {
        setTimeout(initDraggableAgents, 100);
    }

    function initDraggableAgents() {
        const agentBoxes = document.querySelectorAll('.agent-box');

        agentBoxes.forEach(box => {
            // Mouse events
            box.addEventListener('mousedown', handleDragStart);

            // Touch events for mobile
            box.addEventListener('touchstart', handleTouchStart, { passive: false });
        });

        // Global move and end handlers
        document.addEventListener('mousemove', handleDragMove);
        document.addEventListener('mouseup', handleDragEnd);
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', handleTouchEnd);

        console.log('🎯 Agent drag & drop initialized:', agentBoxes.length, 'agents');

        // Load saved positions
        loadAgentPositions();
    }

    function handleDragStart(e) {
        if (e.button !== 0) return; // Only left mouse button

        draggedElement = e.currentTarget;
        draggedElement.classList.add('dragging');

        const rect = draggedElement.getBoundingClientRect();
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        elementStartX = rect.left;
        elementStartY = rect.top;

        // Set position to fixed for free movement
        draggedElement.style.position = 'fixed';
        draggedElement.style.left = rect.left + 'px';
        draggedElement.style.top = rect.top + 'px';
        draggedElement.style.width = rect.width + 'px';
        draggedElement.style.zIndex = '9999';

        e.preventDefault();
    }

    function handleDragMove(e) {
        if (!draggedElement) return;

        const deltaX = e.clientX - dragStartX;
        const deltaY = e.clientY - dragStartY;

        draggedElement.style.left = (elementStartX + deltaX) + 'px';
        draggedElement.style.top = (elementStartY + deltaY) + 'px';
    }

    function handleDragEnd(e) {
        if (!draggedElement) return;

        draggedElement.classList.remove('dragging');

        // Keep the new position
        const finalLeft = draggedElement.style.left;
        const finalTop = draggedElement.style.top;

        // Save position
        saveAgentPosition(draggedElement.id, finalLeft, finalTop);

        draggedElement = null;
    }

    // Touch event handlers
    function handleTouchStart(e) {
        if (e.touches.length !== 1) return;

        const touch = e.touches[0];
        draggedElement = e.currentTarget;
        draggedElement.classList.add('dragging');

        const rect = draggedElement.getBoundingClientRect();
        dragStartX = touch.clientX;
        dragStartY = touch.clientY;
        elementStartX = rect.left;
        elementStartY = rect.top;

        draggedElement.style.position = 'fixed';
        draggedElement.style.left = rect.left + 'px';
        draggedElement.style.top = rect.top + 'px';
        draggedElement.style.width = rect.width + 'px';
        draggedElement.style.zIndex = '9999';

        e.preventDefault();
    }

    function handleTouchMove(e) {
        if (!draggedElement || e.touches.length !== 1) return;

        const touch = e.touches[0];
        const deltaX = touch.clientX - dragStartX;
        const deltaY = touch.clientY - dragStartY;

        draggedElement.style.left = (elementStartX + deltaX) + 'px';
        draggedElement.style.top = (elementStartY + deltaY) + 'px';

        e.preventDefault();
    }

    function handleTouchEnd(e) {
        handleDragEnd(e);
    }

    // Save agent positions to localStorage
    function saveAgentPosition(id, left, top) {
        if (!id) return;

        const positions = JSON.parse(localStorage.getItem('agentPositions') || '{}');
        positions[id] = { left, top };
        localStorage.setItem('agentPositions', JSON.stringify(positions));
        console.log('💾 Saved position for', id);
    }

    // Load agent positions from localStorage
    function loadAgentPositions() {
        const positions = JSON.parse(localStorage.getItem('agentPositions') || '{}');
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        const safePositions = {};

        Object.entries(positions).forEach(([id, pos]) => {
            const element = document.getElementById(id);
            if (element && pos.left && pos.top) {
                element.style.position = 'fixed';
                element.style.left = pos.left;
                element.style.top = pos.top;
                element.style.zIndex = '100';

                const rect = element.getBoundingClientRect();
                const outside = rect.right < 0 || rect.bottom < 0 || rect.left > viewportW || rect.top > viewportH;
                if (outside) {
                    element.style.position = '';
                    element.style.left = '';
                    element.style.top = '';
                    element.style.width = '';
                    element.style.zIndex = '';
                } else {
                    safePositions[id] = pos;
                }
            }
        });

        if (Object.keys(positions).length !== Object.keys(safePositions).length) {
            localStorage.setItem('agentPositions', JSON.stringify(safePositions));
        }

        if (Object.keys(positions).length > 0) {
            console.log('📂 Loaded', Object.keys(positions).length, 'agent positions');
        }
    }

    // Expose reset function globally
    window.resetAgentPositions = function () {
        localStorage.removeItem('agentPositions');
        location.reload();
        console.log('🔄 Agent positions reset');
    };
})();

// ========================================
// Test/Live Mode Toggle
// ========================================
function syncTradingModeButtons(isTestMode) {
    const btnTest = document.getElementById('btn-mode-test');
    const btnLive = document.getElementById('btn-mode-live');
    if (!btnTest || !btnLive) return;

    window.tradingMode = isTestMode ? 'test' : 'live';
    btnTest.classList.toggle('active', isTestMode);
    btnLive.classList.toggle('active', !isTestMode);
}

(function () {
    const btnTest = document.getElementById('btn-mode-test');
    const btnLive = document.getElementById('btn-mode-live');

    if (!btnTest || !btnLive) return;

    // Current mode state
    window.tradingMode = 'test'; // Default to test

    const requestModeSwitch = async (mode) => {
        try {
            const response = await apiFetch('/api/control', {
                method: 'POST',
                body: JSON.stringify({ action: 'set_mode', mode })
            });
            const payload = await response.json().catch(() => ({}));

            if (!response.ok || payload.status !== 'success') {
                throw new Error(payload.detail || `Mode switch failed (HTTP ${response.status})`);
            }

            const backendIsTest = payload.is_test_mode !== undefined
                ? Boolean(payload.is_test_mode)
                : mode === 'test';
            window.backendIsTestMode = backendIsTest;
            syncTradingModeButtons(backendIsTest);
            console.log(`✅ Switched to ${backendIsTest ? 'TEST' : 'LIVE'} mode`);
        } catch (err) {
            console.error('Mode switch failed:', err);
            syncTradingModeButtons(Boolean(window.backendIsTestMode));
            alert(err.message || 'Mode switch failed. Please restart in the desired mode.');
        }
    };

    // Test mode click
    btnTest.addEventListener('click', function () {
        if (window.tradingMode === 'test') return;

        requestModeSwitch('test');
    });

    // Live mode click
    btnLive.addEventListener('click', function () {
        if (window.tradingMode === 'live') return;

        // Show warning
        const confirmed = confirm(
            '⚠️ WARNING: Live Trading Mode\n\n' +
            'You are about to enable LIVE trading with REAL money.\n\n' +
            '• Real funds will be at risk\n' +
            '• Ensure API keys are configured correctly\n' +
            '• Start with small position sizes\n\n' +
            'Do you want to continue and configure your account?'
        );

        if (!confirmed) return;

        // Open settings modal for configuration
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) {
            settingsModal.style.display = 'flex';
            // Switch to Trading tab
            const tradingTab = document.querySelector('[data-tab="trading"]');
            if (tradingTab) tradingTab.click();
        }

        requestModeSwitch('live');
    });

    syncTradingModeButtons(Boolean(window.backendIsTestMode));
    console.log('✅ Mode toggle initialized');
})();

// ========================================
// Agent Selection Panel
// ========================================
(function () {
    const btnApply = document.getElementById('btn-apply-agents');
    const llmToggleBtn = document.getElementById('btn-llm-toggle');

    // Map checkbox IDs to agent box IDs for visibility toggle
    const agentBoxMap = {
        'predict_agent': 'flow-predict',
        'ai_prediction_filter_agent': 'flow-ai-filter',
        'regime_detector_agent': 'flow-regime',
        'position_analyzer_agent': 'flow-position-analyzer',
        'trigger_detector_agent': 'flow-trigger-detector',
        'trend_agent': 'flow-trend-agent',
        'trend_agent_llm': 'flow-trend-agent',
        'setup_agent_llm': 'flow-trend-agent',
        'trend_agent_local': 'flow-trend-agent',
        'setup_agent_local': 'flow-trend-agent',
        'trigger_agent': 'flow-trigger-agent',
        'trigger_agent_llm': 'flow-trigger-agent',
        'trigger_agent_local': 'flow-trigger-agent',
        'reflection_agent': 'flow-reflection',
        'reflection_agent_llm': 'flow-reflection',
        'reflection_agent_local': 'flow-reflection',
        'symbol_selector_agent': 'flow-symbol-selector'
    };

    const isLlmEnabled = (config) => Boolean(
        config.trend_agent_llm ||
        config.setup_agent_llm ||
        config.trigger_agent_llm ||
        config.reflection_agent_llm
    );

    const providerKeyMap = {
        deepseek: 'deepseek_api_key',
        openai: 'openai_api_key',
        claude: 'claude_api_key',
        qwen: 'qwen_api_key',
        gemini: 'gemini_api_key',
        kimi: 'kimi_api_key',
        minimax: 'minimax_api_key',
        glm: 'glm_api_key',
        openrouter: 'openrouter_api_key'
    };

    const resolveProvider = (config) => {
        const cfgProvider = config?.llm?.provider;
        if (cfgProvider && cfgProvider !== 'none' && cfgProvider !== 'disabled') return cfgProvider;
        const select = document.getElementById('cfg-llm-provider');
        const selected = select ? select.value : null;
        if (selected && selected !== 'none' && selected !== 'disabled') return selected;
        return 'deepseek';
    };

    const hasMaskedKey = (val) => typeof val === 'string' && val !== '******' && val.includes('...');

    async function ensureLlmApiKey() {
        try {
            const res = await apiFetch('/api/config');
            const cfg = await res.json();
            const provider = resolveProvider(cfg);
            const keyField = providerKeyMap[provider] || 'deepseek_api_key';
            const currentKey = cfg?.api_keys?.[keyField];
            if (hasMaskedKey(currentKey)) {
                return provider;
            }

            const promptLabel = provider.toUpperCase();
            const keyInput = window.prompt(`Enable LLM: enter ${promptLabel} API key`);
            if (!keyInput || !keyInput.trim()) return null;

            const payload = {
                api_keys: {
                    [keyField]: keyInput.trim()
                },
                llm: {
                    llm_provider: provider
                }
            };
            const saveRes = await apiFetch('/api/config', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            if (!saveRes.ok) {
                const errText = await saveRes.text();
                alert(`Failed to save API key: ${errText}`);
                return null;
            }
            return provider;
        } catch (err) {
            console.error('Failed to verify/save LLM key:', err);
            return null;
        }
    }

    function syncAgentToggles(config) {
        document.querySelectorAll('input[name="agent-toggle"]').forEach(cb => {
            if (config[cb.value] !== undefined) {
                cb.checked = Boolean(config[cb.value]);
            }
        });
    }

    // Function to toggle agent box visibility
    function updateAgentVisibility() {
        const boxStates = {};
        document.querySelectorAll('input[name="agent-toggle"]').forEach(cb => {
            const boxId = agentBoxMap[cb.value];
            if (!boxId) return;
            boxStates[boxId] = boxStates[boxId] || cb.checked;
        });
        Object.entries(boxStates).forEach(([boxId, enabled]) => {
            const box = document.getElementById(boxId);
            if (box) {
                // Keep cards visible but show disabled state (dimmed, not hidden)
                box.classList.remove('hidden');
                box.style.opacity = enabled ? '1' : '0.4';
                box.style.filter = enabled ? 'none' : 'grayscale(80%)';
                box.style.pointerEvents = 'auto';  // Always allow interaction
            }
        });
    }

    function updateLlmToggleButton(config) {
        if (!llmToggleBtn) return;
        const enabled = isLlmEnabled(config);
        llmToggleBtn.textContent = enabled ? 'LLM: ON' : 'LLM: OFF';
        llmToggleBtn.classList.toggle('on', enabled);
    }

    async function persistAgentConfig(agents) {
        const merged = { ...(window.agentConfig || {}), ...agents };
        const normalized = normalizeAgentConfig(merged);
        window.agentConfig = normalized;
        syncAgentToggles(normalized);
        updateAgentVisibility();
        updateLlmToggleButton(normalized);

        const payload = { ...normalized };
        ['trend_agent', 'setup_agent', 'trigger_agent', 'reflection_agent'].forEach((key) => {
            delete payload[key];
        });

        const response = await apiFetch('/api/agents/config', {
            method: 'POST',
            body: JSON.stringify({ agents: payload })
        });

        return response;
    }

    // Update visibility on checkbox change
    document.querySelectorAll('input[name="agent-toggle"]').forEach(cb => {
        cb.addEventListener('change', updateAgentVisibility);
    });

    if (btnApply) {
        btnApply.addEventListener('click', async function () {
            // Collect all agent states
            const agents = {};
            document.querySelectorAll('input[name="agent-toggle"]').forEach(cb => {
                agents[cb.value] = cb.checked;
            });

            console.log('🔧 Applying agent config:', agents);

            // Send to backend
            try {
                const response = await persistAgentConfig(agents);

                // Visual feedback
                btnApply.textContent = '✅ Applied!';
                btnApply.style.background = 'var(--nofx-success)';
                setTimeout(() => {
                    btnApply.textContent = 'Apply Changes';
                    btnApply.style.background = 'var(--nofx-gold)';
                }, 2000);

                console.log('✅ Agent config saved:', response);

            } catch (err) {
                console.error('Failed to apply agent config:', err);
                btnApply.textContent = '❌ Failed';
                setTimeout(() => {
                    btnApply.textContent = 'Apply Changes';
                }, 2000);
            }
        });
    }

    if (llmToggleBtn) {
        llmToggleBtn.addEventListener('click', async function () {
            if (!window.agentConfig || Object.keys(window.agentConfig).length === 0) {
                await loadAgentConfig();
            }
            if (!window.agentConfig || Object.keys(window.agentConfig).length === 0) {
                console.warn('LLM toggle aborted: agent config not loaded');
                return;
            }
            const current = normalizeAgentConfig(window.agentConfig || {});
            const enableLlm = !isLlmEnabled(current);
            if (enableLlm) {
                const okProvider = await ensureLlmApiKey();
                if (!okProvider) {
                    console.warn('LLM toggle aborted: API key missing');
                    return;
                }
            }
            const next = {
                ...current,
                trend_agent_llm: enableLlm,
                setup_agent_llm: enableLlm,
                trigger_agent_llm: enableLlm,
                reflection_agent_llm: enableLlm,
                trend_agent_local: !enableLlm,
                setup_agent_local: !enableLlm,
                trigger_agent_local: !enableLlm,
                reflection_agent_local: !enableLlm
            };

            try {
                llmToggleBtn.disabled = true;
                await persistAgentConfig(next);
            } catch (err) {
                console.error('Failed to toggle LLM mode:', err);
            } finally {
                llmToggleBtn.disabled = false;
            }
        });
    }

    // Load initial agent config from backend
    async function loadAgentConfig() {
        try {
            const response = await apiFetch('/api/agents/config');
            const data = await response.json();
            if (data && data.agents) {
                const normalized = normalizeAgentConfig(data.agents);
                window.agentConfig = normalized;
                syncAgentToggles(normalized);
                updateAgentVisibility();
                updateLlmToggleButton(normalized);
                console.log('📋 Agent config loaded from backend');
            }
        } catch (err) {
            console.log('Could not load agent config:', err);
        }
    }

    // Load config on page load
    setTimeout(loadAgentConfig, 1000);

    console.log('✅ Agent selection panel initialized');
})();

// ========================================
// Agent Configuration Modal
// ========================================
(function () {
    function initAgentConfigModal() {
        const btnViewPrompts = document.getElementById('btn-view-prompts');
        const promptsModal = document.getElementById('prompts-modal');
        const closePrompts = document.getElementById('close-prompts');
        const tabsContainer = document.getElementById('agent-config-tabs');
        const panelContainer = document.getElementById('agent-config-panel');
        const saveBtn = document.getElementById('agent-config-save');
        const toastEl = document.getElementById('agent-config-toast');
        const llmInfoBadge = document.getElementById('llm-info-badge');
        const llmProviderText = document.getElementById('llm-provider-text');
        const llmModelText = document.getElementById('llm-model-text');

        const AGENT_DEFS = [
            { id: 'symbol_selector', label: '🎯 Symbol Selector', hasPrompt: false },
            { id: 'trend_agent', label: '📊 Trend Agent (1h)', hasPrompt: true },
            { id: 'setup_agent', label: '📉 Setup Agent (15m)', hasPrompt: true },
            { id: 'trigger_agent', label: '⚡ Trigger Agent (5m)', hasPrompt: true },
            { id: 'multi_period', label: '🧭 Multi-Period Parser', hasPrompt: false },
            { id: 'reflection_agent', label: '🧠 Reflection Agent', hasPrompt: true },
            { id: 'risk_audit', label: '🛡️ Risk Audit', hasPrompt: false },
            { id: 'decision_core', label: '⚖️ Decision Core', hasPrompt: true, required: true }
        ];

        let agentSettings = { agents: {} };
        let draftInputs = {};
        let activeAgentId = AGENT_DEFS[0]?.id || null;
        let agentEnabled = {};

        // Initialize tabs/panel immediately to avoid blank modal on fetch failure
        renderAgentTabs();
        renderAgentPanel(activeAgentId);

        if (btnViewPrompts) {
            btnViewPrompts.addEventListener('click', async function () {
                if (!promptsModal) return;
                promptsModal.style.display = 'flex';
                await loadAgentSettings();
            });
        }

        if (closePrompts) {
            closePrompts.addEventListener('click', function () {
                if (!promptsModal) return;
                promptsModal.style.display = 'none';
            });
        }

        // Close modal when clicking outside
        window.addEventListener('click', function (event) {
            if (event.target === promptsModal) {
                promptsModal.style.display = 'none';
            }
        });

        if (saveBtn) {
            saveBtn.addEventListener('click', async function () {
                try {
                    stashDraft(activeAgentId);
                    const { settings, enabled } = buildSettingsPayload();
                    saveBtn.disabled = true;
                    showAgentToast('Saving...', 'info');
                    await apiFetch('/api/agents/settings', {
                        method: 'POST',
                        body: JSON.stringify(settings)
                    });
                    if (enabled && Object.keys(enabled).length > 0) {
                        const allowedKeys = new Set(Object.keys(agentEnabled || {}));
                        const filteredEnabled = Object.fromEntries(
                            Object.entries(enabled).filter(([key]) => allowedKeys.has(key))
                        );
                        if (Object.keys(filteredEnabled).length > 0) {
                            await apiFetch('/api/agents/config', {
                                method: 'POST',
                                body: JSON.stringify({ agents: filteredEnabled })
                            });
                            agentEnabled = { ...(agentEnabled || {}), ...filteredEnabled };
                        }
                    }
                    agentSettings = settings;
                    showAgentToast('Saved', 'success');
                } catch (err) {
                    console.error('Failed to save agent settings:', err);
                    showAgentToast(`Save failed: ${err.message}`, 'error');
                } finally {
                    saveBtn.disabled = false;
                }
            });
        }

        async function loadAgentSettings() {
            if (!panelContainer || !tabsContainer) return;
            panelContainer.innerHTML = '<p style="color: #718096; text-align: center; padding: 20px;">Loading agent settings...</p>';
            try {
                const response = await apiFetch('/api/agents/settings');
                const data = await response.json();
                agentSettings = normalizeSettings(data);
                agentEnabled = await loadAgentEnabled();
                renderAgentTabs();
                renderAgentPanel(activeAgentId);
                updateLlmBadge(data?.llm_info);
                updateLlmMetrics(data?.llm_info, data?.llm_metrics);
                updateLlmMetrics(data?.llm_info, data?.llm_metrics);
            } catch (err) {
                console.error('Failed to load agent settings:', err);
                renderAgentTabs();
                renderAgentPanel(activeAgentId);
                panelContainer.insertAdjacentHTML(
                    'afterbegin',
                    `<p style="color: #ff5b5b; text-align: center; padding: 10px 0;">Error: ${err.message}</p>`
                );
            }
        }

        async function loadAgentEnabled() {
            try {
                const res = await apiFetch('/api/agents/config');
                const data = await res.json();
                return data?.agents || {};
            } catch (err) {
                console.warn('Failed to load agent config:', err);
                return {};
            }
        }

    function normalizeSettings(data) {
        const agents = data && data.agents && typeof data.agents === 'object' ? data.agents : {};
        const normalized = {};
        Object.entries(agents).forEach(([key, value]) => {
            if (!value || typeof value !== 'object') return;
            normalized[key] = {
                params: value.params && typeof value.params === 'object' ? value.params : {},
                system_prompt: typeof value.system_prompt === 'string' ? value.system_prompt : ''
            };
        });
        return { agents: normalized };
    }

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value ?? {}));
    }

    function ensureAgentConfig(agentId) {
        if (!agentSettings.agents[agentId]) {
            agentSettings.agents[agentId] = { params: {}, system_prompt: '' };
        }
    }

    function toParamLabel(path) {
        const key = path.split('.').pop() || path;
        return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    function flattenParamLeaves(obj, prefix = '', out = []) {
        if (!obj || typeof obj !== 'object') return out;
        Object.entries(obj).forEach(([key, value]) => {
            const path = prefix ? `${prefix}.${key}` : key;
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                flattenParamLeaves(value, path, out);
                return;
            }
            out.push({ path, value });
        });
        return out;
    }

    function setNestedValue(target, path, value) {
        const keys = String(path || '').split('.');
        if (!keys.length) return;
        let ref = target;
        for (let i = 0; i < keys.length - 1; i += 1) {
            const k = keys[i];
            if (!ref[k] || typeof ref[k] !== 'object' || Array.isArray(ref[k])) {
                ref[k] = {};
            }
            ref = ref[k];
        }
        ref[keys[keys.length - 1]] = value;
    }

    function getSliderSpec(agentId, path, value) {
        const key = path.split('.').pop() || '';
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return { min: 0, max: 100, step: 1 };
        }

        if (key === 'temperature') return { min: 0, max: 1, step: 0.01 };
        if (key === 'max_tokens') return { min: 64, max: 4096, step: 16 };
        if (agentId === 'decision_core') return { min: 0, max: 1, step: 0.01 };
        if (path.startsWith('trend_thresholds.')) return { min: 0, max: 100, step: 1 };
        if (key.includes('leverage')) return { min: 1, max: 125, step: 1 };
        if (key.includes('interval') && key.includes('hours')) return { min: 1, max: 48, step: 1 };
        if (key.includes('lookback') && key.includes('hours')) return { min: 1, max: 240, step: 1 };
        if (key.includes('window') && key.includes('minutes')) return { min: 5, max: 240, step: 5 };
        if (key.includes('threshold') || key.includes('pct') || key.includes('ratio')) {
            const max = numericValue <= 1 ? 1 : Math.max(5, Math.ceil(numericValue * 2));
            const step = numericValue < 0.1 ? 0.001 : 0.01;
            return { min: 0, max, step };
        }
        if (numericValue >= 1000) {
            const max = Math.max(numericValue * 2, 1000000);
            return { min: 0, max, step: Math.max(1, Math.floor(max / 500)) };
        }
        if (Number.isInteger(numericValue)) {
            return { min: 0, max: Math.max(10, numericValue * 3), step: 1 };
        }
        return { min: 0, max: Math.max(1, Math.ceil(numericValue * 3 * 100) / 100), step: 0.01 };
    }

    function readParamsFromPanel(agentId) {
        const base = deepClone(draftInputs[agentId]?.paramsObj ?? agentSettings.agents[agentId]?.params ?? {});
        const sourceInputs = panelContainer.querySelectorAll('[data-param-source="true"][data-param-path]');
        sourceInputs.forEach(el => {
            const path = el.dataset.paramPath;
            const type = el.dataset.paramType || 'string';
            if (!path) return;
            let value;
            if (type === 'number') {
                const n = Number(el.value);
                if (!Number.isFinite(n)) return;
                value = n;
            } else if (type === 'boolean') {
                value = Boolean(el.checked);
            } else if (type === 'json') {
                try {
                    value = JSON.parse(el.value || 'null');
                } catch (_) {
                    value = el.value || '';
                }
            } else {
                value = el.value ?? '';
            }
            setNestedValue(base, path, value);
        });
        return base;
    }

    function renderParamControls(agentId, paramsObj) {
        const container = panelContainer.querySelector('[data-field="params-controls"]');
        if (!container) return;
        const leaves = flattenParamLeaves(paramsObj);
        if (!leaves.length) {
            container.innerHTML = '<p class="agent-config-param-empty">No parameters available.</p>';
            return;
        }

        const html = leaves.map(({ path, value }) => {
            const safePath = path.replace(/"/g, '&quot;');
            const label = toParamLabel(path);
            if (typeof value === 'number' && Number.isFinite(value)) {
                const spec = getSliderSpec(agentId, path, value);
                return `
                    <div class="agent-config-param-item">
                        <div class="agent-config-param-head">
                            <span class="agent-config-param-name">${label}</span>
                            <span class="agent-config-param-value" data-param-display="${safePath}">${value}</span>
                        </div>
                        <div class="agent-config-param-controls">
                            <input type="range" data-param-range="${safePath}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${value}" />
                            <input type="number" data-param-source="true" data-param-type="number" data-param-path="${safePath}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${value}" />
                        </div>
                    </div>
                `;
            }
            if (typeof value === 'boolean') {
                return `
                    <div class="agent-config-param-item agent-config-param-inline">
                        <label class="agent-config-param-name">${label}</label>
                        <input type="checkbox" data-param-source="true" data-param-type="boolean" data-param-path="${safePath}" ${value ? 'checked' : ''} />
                    </div>
                `;
            }
            const stringValue = typeof value === 'string' ? value : JSON.stringify(value ?? '');
            const type = typeof value === 'string' ? 'string' : 'json';
            return `
                <div class="agent-config-param-item">
                    <label class="agent-config-param-name">${label}</label>
                    <input type="text" data-param-source="true" data-param-type="${type}" data-param-path="${safePath}" value="${String(stringValue).replace(/"/g, '&quot;')}" />
                </div>
            `;
        }).join('');
        container.innerHTML = `<div class="agent-config-param-list">${html}</div>`;

        container.querySelectorAll('input[data-param-range]').forEach(rangeEl => {
            const path = rangeEl.dataset.paramRange;
            const numberEl = Array.from(
                container.querySelectorAll('input[data-param-source="true"][data-param-path]')
            ).find(el => el.dataset.paramPath === path);
            const displayEl = Array.from(
                container.querySelectorAll('[data-param-display]')
            ).find(el => el.dataset.paramDisplay === path);
            const sync = (nextValue) => {
                if (numberEl) numberEl.value = nextValue;
                if (displayEl) displayEl.textContent = nextValue;
            };
            rangeEl.addEventListener('input', () => sync(rangeEl.value));
            if (numberEl) {
                numberEl.addEventListener('input', () => {
                    const n = Number(numberEl.value);
                    if (!Number.isFinite(n)) return;
                    const min = Number(rangeEl.min);
                    const max = Number(rangeEl.max);
                    const clamped = Math.min(max, Math.max(min, n));
                    rangeEl.value = String(clamped);
                    if (displayEl) displayEl.textContent = String(clamped);
                });
            }
        });
    }

    function renderAgentTabs() {
        tabsContainer.innerHTML = '';
        AGENT_DEFS.forEach(def => {
            const btn = document.createElement('button');
            btn.className = `agent-config-tab${def.id === activeAgentId ? ' active' : ''}`;
            btn.textContent = def.label;
            btn.addEventListener('click', () => {
                if (def.id === activeAgentId) return;
                stashDraft(activeAgentId);
                activeAgentId = def.id;
                renderAgentTabs();
                renderAgentPanel(activeAgentId);
            });
            tabsContainer.appendChild(btn);
        });
    }

    function renderAgentPanel(agentId) {
        if (!agentId) return;
        ensureAgentConfig(agentId);
        const def = AGENT_DEFS.find(item => item.id === agentId);
        const draft = draftInputs[agentId];
        const paramsObj = deepClone(draft?.paramsObj ?? (agentSettings.agents[agentId].params || {}));
        const promptText = draft?.promptText ?? (agentSettings.agents[agentId].system_prompt || '');
        const enabledValue = draft?.enabled ?? agentEnabled?.[agentId];
        const isEnabled = enabledValue === undefined ? true : Boolean(enabledValue);
        const isRequired = Boolean(def?.required);

        panelContainer.innerHTML = `
            <div class="agent-config-section">
                <h4>${def?.label || agentId}</h4>
                <div class="agent-config-row agent-config-toggle-row">
                    <label>Enable Agent${isRequired ? ' (Required)' : ''}</label>
                    <input type="checkbox" data-field="enabled" ${isEnabled ? 'checked' : ''} ${isRequired ? 'disabled' : ''} />
                </div>
                <div class="agent-config-row agent-config-row-params">
                    <label>Parameters</label>
                    <div data-field="params-controls"></div>
                </div>
                ${def?.hasPrompt ? `
                <div class="agent-config-row agent-config-row-prompt">
                    <label>System Prompt (applies only when LLM is enabled)</label>
                    <textarea data-field="system_prompt" rows="6" spellcheck="false"></textarea>
                </div>` : ''}
            </div>
        `;

        const promptEl = panelContainer.querySelector('textarea[data-field="system_prompt"]');
        if (promptEl) promptEl.value = promptText;
        renderParamControls(agentId, paramsObj);
    }

    function stashDraft(agentId) {
        if (!agentId) return;
        const promptEl = panelContainer.querySelector('textarea[data-field="system_prompt"]');
        const enabledEl = panelContainer.querySelector('input[data-field="enabled"]');
        draftInputs[agentId] = {
            paramsObj: readParamsFromPanel(agentId),
            promptText: promptEl ? promptEl.value : '',
            enabled: enabledEl ? enabledEl.checked : undefined
        };
    }

    function buildSettingsPayload() {
        const payload = {
            agents: deepClone(agentSettings.agents || {})
        };
        const enabledPayload = {};
        const applyEnableChange = (localKey, llmKey, enabled) => {
            if (enabled === true) {
                enabledPayload[localKey] = true;
            } else if (enabled === false) {
                enabledPayload[localKey] = false;
                if (llmKey) enabledPayload[llmKey] = false;
            }
        };
        AGENT_DEFS.forEach(def => {
            const draft = draftInputs[def.id];
            const base = agentSettings.agents[def.id] || { params: {}, system_prompt: '' };
            const paramsObj = deepClone(draft?.paramsObj ?? base.params ?? {});
            const promptRaw = (draft?.promptText ?? base.system_prompt) || '';
            if (draft?.enabled !== undefined && !def.required) {
                if (def.id === 'symbol_selector') {
                    applyEnableChange('symbol_selector_agent', null, draft.enabled);
                } else if (def.id === 'trend_agent') {
                    applyEnableChange('trend_agent_local', 'trend_agent_llm', draft.enabled);
                } else if (def.id === 'setup_agent') {
                    applyEnableChange('setup_agent_local', 'setup_agent_llm', draft.enabled);
                } else if (def.id === 'trigger_agent') {
                    applyEnableChange('trigger_agent_local', 'trigger_agent_llm', draft.enabled);
                } else if (def.id === 'reflection_agent') {
                    applyEnableChange('reflection_agent_local', 'reflection_agent_llm', draft.enabled);
                }
            }
            payload.agents[def.id] = {
                params: paramsObj,
                system_prompt: promptRaw || ''
            };
        });
        return { settings: payload, enabled: enabledPayload };
    }

        function updateLlmBadge(llmInfo) {
        if (!llmInfoBadge || !llmProviderText || !llmModelText) return;
        if (llmInfo && llmInfo.provider && llmInfo.provider !== 'None') {
            llmProviderText.textContent = llmInfo.provider.toUpperCase();
            llmModelText.textContent = llmInfo.model || '';
            llmInfoBadge.style.display = 'inline-flex';
        } else {
            llmInfoBadge.style.display = 'none';
        }
    }

        function updateLlmMetrics(llmInfo, metrics) {
            const elTokens = document.getElementById('llm-metrics-tokens');
            const elTotal = document.getElementById('llm-metrics-total');
            const elSpeed = document.getElementById('llm-metrics-speed');
            const elLatency = document.getElementById('llm-metrics-latency');
            if (!elTokens && !elTotal && !elSpeed && !elLatency) return;

            if (!llmInfo || !llmInfo.provider || llmInfo.provider === 'None') {
                if (elTokens) elTokens.textContent = '--/--';
                if (elTotal) elTotal.textContent = '--';
                if (elSpeed) elSpeed.textContent = '-- tps';
                if (elLatency) elLatency.textContent = '--/--/-- ms';
                return;
            }
            const providerKey = (llmInfo.provider || '').toLowerCase();
            const providerStats = metrics?.providers?.[providerKey];
            if (!providerStats) {
                if (elTokens) elTokens.textContent = '--/--';
                if (elTotal) elTotal.textContent = '--';
                if (elSpeed) elSpeed.textContent = '-- tps';
                if (elLatency) elLatency.textContent = '--/--/-- ms';
                return;
            }
            const inTok = providerStats.total_input_tokens ?? 0;
            const outTok = providerStats.total_output_tokens ?? 0;
            const totalTok = providerStats.total_tokens ?? (inTok + outTok);
            const tps = providerStats.token_speed_tps ?? 0;
            const minMs = providerStats.min_latency_ms ?? 0;
            const avgMs = providerStats.avg_latency_ms ?? 0;
            const maxMs = providerStats.max_latency_ms ?? 0;
            if (elTokens) elTokens.textContent = `${inTok}/${outTok}`;
            if (elTotal) elTotal.textContent = `${totalTok}`;
            if (elSpeed) elSpeed.textContent = `${tps} tps`;
            if (elLatency) elLatency.textContent = `${minMs}/${avgMs}/${maxMs} ms`;
        }

        function updateLlmMetrics(llmInfo, metrics) {
            const elTokens = document.getElementById('llm-metrics-tokens');
            const elTotal = document.getElementById('llm-metrics-total');
            const elSpeed = document.getElementById('llm-metrics-speed');
            const elLatency = document.getElementById('llm-metrics-latency');
            if (!elTokens && !elTotal && !elSpeed && !elLatency) return;

            if (!llmInfo || !llmInfo.provider || llmInfo.provider === 'None') {
                if (elTokens) elTokens.textContent = '--/--';
                if (elTotal) elTotal.textContent = '--';
                if (elSpeed) elSpeed.textContent = '-- tps';
                if (elLatency) elLatency.textContent = '--/--/-- ms';
                return;
            }
            const providerKey = (llmInfo.provider || '').toLowerCase();
            const providerStats = metrics?.providers?.[providerKey];
            if (!providerStats) {
                if (elTokens) elTokens.textContent = '--/--';
                if (elTotal) elTotal.textContent = '--';
                if (elSpeed) elSpeed.textContent = '-- tps';
                if (elLatency) elLatency.textContent = '--/--/-- ms';
                return;
            }
            const inTok = providerStats.total_input_tokens ?? 0;
            const outTok = providerStats.total_output_tokens ?? 0;
            const totalTok = providerStats.total_tokens ?? (inTok + outTok);
            const tps = providerStats.token_speed_tps ?? 0;
            const minMs = providerStats.min_latency_ms ?? 0;
            const avgMs = providerStats.avg_latency_ms ?? 0;
            const maxMs = providerStats.max_latency_ms ?? 0;
            if (elTokens) elTokens.textContent = `${inTok}/${outTok}`;
            if (elTotal) elTotal.textContent = `${totalTok}`;
            if (elSpeed) elSpeed.textContent = `${tps} tps`;
            if (elLatency) elLatency.textContent = `${minMs}/${avgMs}/${maxMs} ms`;
        }

        async function refreshLlmBadge() {
            try {
                const res = await fetch('/api/agents/settings', { credentials: 'include' });
                const data = await res.json();
                updateLlmBadge(data?.llm_info);
                updateLlmMetrics(data?.llm_info, data?.llm_metrics);
                updateLlmMetrics(data?.llm_info, data?.llm_metrics);
            } catch (err) {
                console.warn('Failed to update LLM badge:', err);
            }
        }

        function showAgentToast(message, level) {
            if (!toastEl) return;
            toastEl.textContent = message;
            toastEl.classList.remove('success', 'error');
            if (level === 'success') toastEl.classList.add('success');
            if (level === 'error') toastEl.classList.add('error');
            toastEl.classList.add('show');
            clearTimeout(showAgentToast._timer);
            showAgentToast._timer = setTimeout(() => {
                toastEl.classList.remove('show');
            }, 2400);
        }

        refreshLlmBadge();
        setInterval(refreshLlmBadge, 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAgentConfigModal);
    } else {
        initAgentConfigModal();
    }
})();

// ========================================
// Update Current Symbol Display
// ========================================
(function () {
    // Override or extend existing update logic
    const originalUpdate = window.handleStateUpdate;
    window.handleStateUpdate = function (data) {
        // Call original if exists
        if (originalUpdate) originalUpdate(data);

        // Update symbol display
        if (data && data.decision && data.decision.symbol) {
            const symbolText = document.getElementById('symbol-display-text');
            if (symbolText) {
                symbolText.textContent = data.decision.symbol;
            }
        }
    };
})();
