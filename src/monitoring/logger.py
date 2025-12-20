"""
日志与监控模块
"""
import json
import sqlite3
from typing import Dict, List
from pathlib import Path
from datetime import datetime
from src.utils.logger import log


class TradingLogger:
    """交易日志记录器"""
    
    def __init__(self, db_path: str = "logs/trading.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        
        self._init_database()
        log.info("交易日志系统初始化完成")
    
    def _init_database(self):
        """初始化数据库"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 决策记录表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS decisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                action TEXT NOT NULL,
                confidence INTEGER,
                leverage INTEGER,
                position_size_pct REAL,
                stop_loss_pct REAL,
                take_profit_pct REAL,
                reasoning TEXT,
                market_context TEXT,
                llm_raw_output TEXT,
                risk_validated BOOLEAN,
                risk_message TEXT
            )
        ''')
        
        # 执行记录表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS executions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                symbol TEXT NOT NULL,
                action TEXT NOT NULL,
                success BOOLEAN,
                entry_price REAL,
                quantity REAL,
                stop_loss REAL,
                take_profit REAL,
                orders_data TEXT,
                message TEXT
            )
        ''')
        
        # 交易记录表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                open_time TEXT NOT NULL,
                close_time TEXT,
                symbol TEXT NOT NULL,
                side TEXT NOT NULL,
                entry_price REAL,
                exit_price REAL,
                quantity REAL,
                leverage INTEGER,
                pnl REAL,
                pnl_pct REAL,
                status TEXT
            )
        ''')
        
        # 性能指标表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS performance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                total_trades INTEGER,
                winning_trades INTEGER,
                losing_trades INTEGER,
                win_rate REAL,
                total_pnl REAL,
                sharpe_ratio REAL,
                max_drawdown_pct REAL,
                account_balance REAL
            )
        ''')
        
        conn.commit()
        conn.close()
    
    def log_decision(self, decision: Dict, market_context: Dict, risk_result: tuple):
        """记录决策"""
        is_valid, modified_decision, risk_message = risk_result
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO decisions (
                timestamp, symbol, action, confidence, leverage,
                position_size_pct, stop_loss_pct, take_profit_pct,
                reasoning, market_context, llm_raw_output,
                risk_validated, risk_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            decision.get('timestamp'),
            decision.get('symbol'),
            decision.get('action'),
            decision.get('confidence'),
            decision.get('leverage'),
            decision.get('position_size_pct'),
            decision.get('stop_loss_pct'),
            decision.get('take_profit_pct'),
            decision.get('reasoning'),
            json.dumps(market_context),
            decision.get('raw_response', ''),
            is_valid,
            risk_message
        ))
        
        conn.commit()
        conn.close()
        
        log.info(f"决策已记录: {decision.get('action')}")
    
    def log_execution(self, execution_result: Dict):
        """记录执行结果"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO executions (
                timestamp, symbol, action, success,
                entry_price, quantity, stop_loss, take_profit,
                orders_data, message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            execution_result.get('timestamp'),
            execution_result.get('symbol', ''),
            execution_result.get('action'),
            execution_result.get('success'),
            execution_result.get('entry_price'),
            execution_result.get('quantity'),
            execution_result.get('stop_loss'),
            execution_result.get('take_profit'),
            json.dumps(execution_result.get('orders', [])),
            execution_result.get('message')
        ))
        
        conn.commit()
        conn.close()
        
        log.info(f"执行结果已记录: {execution_result.get('action')}")
    
    def open_trade(self, trade_info: Dict):
        """开启新交易"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO trades (
                open_time, symbol, side, entry_price, quantity, leverage, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            trade_info.get('timestamp'),
            trade_info.get('symbol'),
            trade_info.get('side'),
            trade_info.get('entry_price'),
            trade_info.get('quantity'),
            trade_info.get('leverage', 1),
            'OPEN'
        ))
        
        conn.commit()
        conn.close()
    
    def close_trade(self, symbol: str, exit_price: float, pnl: float):
        """关闭交易"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 查找最近的未关闭交易
        cursor.execute('''
            SELECT id, entry_price, quantity FROM trades
            WHERE symbol = ? AND status = 'OPEN'
            ORDER BY id DESC LIMIT 1
        ''', (symbol,))
        
        row = cursor.fetchone()
        if row:
            trade_id, entry_price, quantity = row
            
            pnl_pct = ((exit_price - entry_price) / entry_price) * 100
            
            cursor.execute('''
                UPDATE trades
                SET close_time = ?, exit_price = ?, pnl = ?, pnl_pct = ?, status = 'CLOSED'
                WHERE id = ?
            ''', (datetime.now().isoformat(), exit_price, pnl, pnl_pct, trade_id))
            
            conn.commit()
        
        conn.close()
    
    def log_performance(self, performance: Dict):
        """记录性能指标"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO performance (
                timestamp, total_trades, winning_trades, losing_trades,
                win_rate, total_pnl, sharpe_ratio, max_drawdown_pct, account_balance
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            datetime.now().isoformat(),
            performance.get('total_trades', 0),
            performance.get('winning_trades', 0),
            performance.get('losing_trades', 0),
            performance.get('win_rate', 0),
            performance.get('total_pnl', 0),
            performance.get('sharpe_ratio', 0),
            performance.get('max_drawdown_pct', 0),
            performance.get('account_balance', 0)
        ))
        
        conn.commit()
        conn.close()
    
    def get_recent_decisions(self, limit: int = 10) -> List[Dict]:
        """获取最近的决策"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT * FROM decisions
            ORDER BY id DESC LIMIT ?
        ''', (limit,))
        
        rows = cursor.fetchall()
        conn.close()
        
        return [dict(row) for row in rows]
    
    def get_trade_statistics(self) -> Dict:
        """获取交易统计"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 总交易数
        cursor.execute('SELECT COUNT(*) FROM trades WHERE status = "CLOSED"')
        total_trades = cursor.fetchone()[0]
        
        # 盈利交易
        cursor.execute('SELECT COUNT(*) FROM trades WHERE status = "CLOSED" AND pnl > 0')
        winning_trades = cursor.fetchone()[0]
        
        # 亏损交易
        cursor.execute('SELECT COUNT(*) FROM trades WHERE status = "CLOSED" AND pnl < 0')
        losing_trades = cursor.fetchone()[0]
        
        # 总盈亏
        cursor.execute('SELECT SUM(pnl) FROM trades WHERE status = "CLOSED"')
        total_pnl = cursor.fetchone()[0] or 0
        
        # 胜率
        win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0
        
        conn.close()
        
        return {
            'total_trades': total_trades,
            'winning_trades': winning_trades,
            'losing_trades': losing_trades,
            'win_rate': win_rate,
            'total_pnl': total_pnl
        }
