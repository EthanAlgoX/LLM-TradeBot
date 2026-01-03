const API_URL = '/api/status';

// 🌐 Language Management (exposed to window for global access)
window.currentLang = localStorage.getItem('language') || 'en';

// 🎯 Demo Mode Tracking (moved to top to avoid TDZ error)
let demoExpiredShown = false;

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

// Toggle language between EN and ZH
function toggleLanguage() {
    console.log('🌐 Language toggle triggered');
    window.currentLang = window.currentLang === 'en' ? 'zh' : 'en';
    localStorage.setItem('language', window.currentLang);
    applyTranslations(window.currentLang);
    updateLanguageButton();
}


// Update language button text
function updateLanguageButton() {
    const langText = document.getElementById('lang-text');
    if (langText) {
        langText.textContent = window.currentLang === 'en' ? '中文' : 'EN';
    }
}

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
                    ticks: {
                        color: '#94a3b8',
                        maxRotation: 45,
                        minRotation: 0,
                        autoSkip: false,
                        callback: function (value, index, ticks) {
                            const totalLabels = ticks.length;

                            // Always show first label (first cycle time)
                            if (index === 0) return this.getLabelForValue(value);

                            // Always show last label
                            if (index === totalLabels - 1) return this.getLabelForValue(value);

                            // Calculate interval based on total labels
                            let interval;
                            if (totalLabels <= 10) interval = 1;        // Show all
                            else if (totalLabels <= 30) interval = 3;   // Show every 3rd
                            else if (totalLabels <= 60) interval = 5;   // Show every 5th
                            else if (totalLabels <= 120) interval = 10; // Show every 10th
                            else interval = 20;                          // Show every 20th

                            // Show label at intervals
                            if (index % interval === 0) {
                                return this.getLabelForValue(value);
                            }

                            return ''; // Hide this label
                        }
                    }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' },
                    beginAtZero: true
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
        fetch('/api/logout', { method: 'POST' })
            .then(() => window.location.href = '/login')
            .catch(err => console.error(err));
    }
};

function updateDashboard() {
    fetch(API_URL)
        .then(response => {
            if (response.status === 401 || response.status === 403) {
                // Session expired or unauthorized
                window.location.href = '/login';
                throw new Error("Unauthorized");
            }
            return response.json();
        })
        .then(data => {
            renderSystemStatus(data.system);
            renderMarketData(data.market);
            renderAgents(data.agents);
            renderDecision(data.decision);
            renderLogs(data.logs);

            // 🆕 Update K-Line symbol selector with active trading symbols
            if (data.system && data.system.symbols) {
                updateSymbolSelector(data.system.symbols);
                updateDecisionFilter(data.system.symbols);  // 🆕 Also update decision filter
            }

            // New Renderers
            // Account & Positions Logic
            let activeAccount = data.account;
            let activePositions = data.positions || [];

            if (data.system && data.system.is_test_mode && data.virtual_account) {
                // Construct account object compatible with renderAccount
                const va = data.virtual_account;
                const unrealized = va.total_unrealized_pnl || 0;
                activeAccount = {
                    total_equity: va.current_balance + unrealized,
                    wallet_balance: va.current_balance,
                    total_pnl: unrealized,
                    initial_balance: va.initial_balance // ✅ Explicitly pass Initial Balance
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

            if (data.chart_data && data.chart_data.equity) {
                renderChart(data.chart_data.equity, initialAmount);
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
        // 只显示时分秒 (HH:MM:SS)
        let time = d.timestamp || 'Just now';
        if (time.includes(' ')) {
            time = time.split(' ')[1] || time; // 提取时间部分
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
            const pattern = d.vote_details?.trigger_pattern || '';
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
    const totalPnl = account.total_pnl || 0;

    setTxt('acc-equity', fmt(totalEquity));
    setTxt('header-equity', fmt(totalEquity));
    setTxt('account-wallet-balance', fmt(walletBalance));
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

function renderChart(history, initialAmount = null) {
    if (!equityChart) return;

    // Use all history data - including cycle 0 (startup)
    const dataToShow = history;

    const times = dataToShow.map(h => h.time);
    const values = dataToShow.map(h => h.value);

    // Determine Initial Amount (Baseline)
    // If not provided, fallback to the first value in history, or 0
    const baseline = initialAmount !== null ? initialAmount : (values.length > 0 ? values[0] : 0);

    equityChart.data.labels = times;
    equityChart.data.datasets[0].data = values;

    // --- Add Dashed Line for Initial Amount ---
    // We create a constant array of the same length as data
    const baselineData = new Array(values.length).fill(baseline);

    // Check if second dataset exists (index 1), if not create it
    if (!equityChart.data.datasets[1]) {
        equityChart.data.datasets.push({
            label: 'Initial Capital',
            data: baselineData,
            borderColor: 'rgba(255, 255, 255, 0.3)', // Faint white
            borderWidth: 1,
            borderDash: [5, 5], // Dashed
            pointRadius: 0,
            fill: false,
            tension: 0
        });
    } else {
        equityChart.data.datasets[1].data = baselineData;
    }
    // ------------------------------------------

    // --- Axis Centering Logic ---
    if (values.length > 0) {
        // Find min and max equity in the current view
        const maxVal = Math.max(...values);
        const minVal = Math.min(...values);

        // Calculate the maximum deviation from the baseline
        const deltaUp = Math.abs(maxVal - baseline);
        const deltaDown = Math.abs(minVal - baseline);
        const maxDelta = Math.max(deltaUp, deltaDown);

        // Add some padding (e.g. 10%) so the curve doesn't touch the edges
        // Ensure even if flat, we have a small range (e.g. 10 USDT or 1%)
        const padding = maxDelta === 0 ? (baseline * 0.01) : (maxDelta * 0.2);

        const yMax = baseline + maxDelta + padding;
        const yMin = baseline - maxDelta - padding;

        equityChart.options.scales.y.min = yMin;
        equityChart.options.scales.y.max = yMax;
    }
    // ----------------------------

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

                // Calculate ROE %
                const leverage = pos.leverage || 1;
                // Margin = (Entry * Qty) / Leveage
                const margin = (pos.entry_price * pos.quantity) / leverage;
                let pnlPct = 0;
                if (margin > 0) pnlPct = (pos.pnl / margin) * 100;
                const pctClass = pnlPct > 0 ? 'pos' : (pnlPct < 0 ? 'neg' : 'neutral');

                const sideClass = (pos.side || 'LONG').toUpperCase() === 'LONG' ? 'pos' : 'neg';

                return `
                    <div style="display: flex; align-items: center; gap: 8px; padding: 4px 10px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                        <span class="${sideClass}" style="font-weight: 600;">${pos.symbol}</span>
                        <span class="val ${pnlClass}" style="font-size: 0.9em; font-weight: bold;">${fmt(pos.pnl)}</span>
                        <span class="val ${pctClass}" style="font-size: 0.9em; font-weight: bold;">${pnlPct.toFixed(2)}%</span>
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

function renderLogs(logs) {
    const container = document.getElementById('logs-container');
    if (!container) return;

    // Smart Scroll: Check if user is near bottom before update
    const isScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 100;
    const previousScrollTop = container.scrollTop;

    // Get current log mode from global state (default: simplified)
    const logMode = window.logMode || 'simplified';

    // Filter logs based on mode
    const filteredLogs = logMode === 'simplified'
        ? logs.filter(logLine => {
            // Strip ANSI colors for filtering
            const cleanLine = logLine.replace(/\x1b\[[0-9;]*m/g, '');

            // 🎯 Simplified Mode: Show only Agent Summaries + Warnings/Errors

            // 1. Always show WARNING and ERROR
            if (cleanLine.includes('WARNING') ||
                cleanLine.includes('ERROR') ||
                cleanLine.includes('⚠️') ||
                cleanLine.includes('❌')) {
                return true;
            }

            // 2. Show Agent Summary Lines (with result indicators)
            const hasAgentTag = (
                cleanLine.includes('[📊 SYSTEM]') ||
                cleanLine.includes('[🕵️ ORACLE]') ||
                cleanLine.includes('[👨‍🔬 STRATEGIST]') ||
                cleanLine.includes('[🔮 PROPHET]') ||
                cleanLine.includes('[🐂 BULL]') ||
                cleanLine.includes('[🐻 BEAR]') ||
                cleanLine.includes('[⚖️ CRITIC]') ||
                cleanLine.includes('[🛡️ GUARDIAN]') ||
                cleanLine.includes('[🚀 EXECUTOR]') ||
                cleanLine.includes('[🧠 REFLECTION]')
            );

            const hasResultIndicator = (
                cleanLine.includes('✅') ||
                cleanLine.includes('❌') ||
                cleanLine.includes('⚠️') ||
                cleanLine.includes('PASS') ||
                cleanLine.includes('FAIL') ||
                cleanLine.includes('BLOCK') ||
                cleanLine.includes('VETO')
            );

            // Show if it's an agent line with a result
            if (hasAgentTag && hasResultIndicator) {
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
        : logs; // Show all logs in detailed mode

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

    console.log('✅ App Initialization Complete');
});

function setControl(action, payload = {}) {
    if (!verifyRole()) return;

    // For 'start' action, check demo mode and show warning if needed
    // REMOVED per user request: No API warnings for Admin. verifyRole blocks Users.
    sendControlRequest(action, payload);
}

function sendControlRequest(action, payload = {}) {
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
                    body: formData
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
                    const res = await fetch('/api/config/default_prompt');
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
        const res = await fetch('/api/config');
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

        // LLM Provider Selection
        const llmProvider = config.llm?.provider || 'deepseek';
        setIfExists('cfg-llm-provider', llmProvider);

        // Trigger provider change to show correct API key field
        const providerSel = document.getElementById('cfg-llm-provider');
        if (providerSel) {
            providerSel.value = llmProvider;
            providerSel.dispatchEvent(new Event('change'));
        }

        // Load Symbols (Multi-select)
        const savedSymbols = (config.trading.symbol || '').split(',').map(s => s.trim());
        const checkboxes = document.querySelectorAll('input[name="cfg-symbol"]');
        let anyChecked = false;
        checkboxes.forEach(cb => {
            if (savedSymbols.includes(cb.value)) {
                cb.checked = true;
                anyChecked = true;
            } else {
                cb.checked = false;
            }
        });
        // Default to BTCUSDT if none saved or matches legacy default
        const isLegacyDefault = savedSymbols.length === 0 || (savedSymbols.length === 1 && (savedSymbols[0] === '' || savedSymbols[0] === 'BTCUSDT' || savedSymbols[0] === 'SOLUSDT'));

        if (!anyChecked || isLegacyDefault) {
            checkboxes.forEach(cb => {
                if (cb.value === 'BTCUSDT') cb.checked = true;
            });
        }
        document.getElementById('cfg-leverage').value = safeVal(config.trading.leverage);
        document.getElementById('cfg-run-mode').value = safeVal(config.trading.run_mode || 'test');

        // Load Prompt
        const promptRes = await fetch('/api/config/prompt');
        const promptData = await promptRes.json();

        // Auto-load default prompt if empty
        if (!promptData.content || promptData.content.trim().length === 0) {
            console.log("Empty prompt detected, fetching default...");
            try {
                const defaultRes = await fetch('/api/config/default_prompt');
                if (defaultRes.ok) {
                    const defaultData = await defaultRes.json();
                    document.getElementById('cfg-prompt').value = defaultData.content;
                }
            } catch (e) {
                console.error("Failed to fetch default prompt fallback", e);
            }
        } else {
            document.getElementById('cfg-prompt').value = promptData.content;
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
            gemini_api_key: elGeminiKey ? elGeminiKey.value : ''
        },
        trading: {
            symbol: Array.from(document.querySelectorAll('input[name="cfg-symbol"]:checked'))
                .map(cb => cb.value).join(','),
            leverage: document.getElementById('cfg-leverage').value,
            run_mode: document.getElementById('cfg-run-mode').value
        },
        llm: {
            llm_provider: elLlmProvider ? elLlmProvider.value : 'deepseek'
        }
    };

    const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error('Failed to save config: ' + errText);
    }
}

async function savePrompt() {
    const content = document.getElementById('cfg-prompt').value;
    const res = await fetch('/api/config/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    });

    if (!res.ok) throw new Error('Failed to save prompt');
}

// FALLBACK DEBUG & HANDLER
document.addEventListener('DOMContentLoaded', function () {
    console.log('🎯 Fallback Handler Loaded');

    // Initialize TradingView chart (fallback)
    if (!window.chartInitialized) {
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
        const res = await fetch('/api/accounts');
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
        const res = await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
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
                const res = await fetch('/api/accounts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
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
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);">No trades yet</td></tr>';
        return;
    }

    tbody.innerHTML = trades.map(trade => {
        const time = trade.recorded_at || trade.timestamp || '-';
        const openCycle = formatCycle(trade.cycle);
        const closeCycle = formatCycle(trade.close_cycle);
        const symbol = trade.symbol || '-';
        const entryPrice = trade.entry_price ? `$${Number(trade.entry_price).toLocaleString()}` : '-';
        const posValue = trade.quantity && trade.entry_price ? `$${(trade.quantity * trade.entry_price).toFixed(2)}` : '-';
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
            if (trade.entry_price && trade.quantity) {
                const posValue = trade.entry_price * trade.quantity;
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
                <td>${time.split(' ')[1] || time}</td>
                <td>${actionIcon} ${openCycle}</td>
                <td>${closeCycle}</td>
                <td>${symbol}</td>
                <td>${entryPrice}</td>
                <td>${posValue}</td>
                <td>${exitPrice}</td>
                <td>${pnlHtml}</td>
                <td>${pnlPctHtml}</td>
            </tr>
        `;
    }).join('');
}
