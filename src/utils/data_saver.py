"""
数据保存工具模块 - 按日期组织数据文件 (Multi-Agent Refactor)
"""
import os
import json
import pandas as pd
from datetime import datetime
from typing import List, Dict, Optional
from src.utils.logger import log


class DataSaver:
    """数据保存工具类 - 按业务领域和日期自动组织文件
    
    目录结构 (Adversarial Intelligence Framework - AIF):
    data/
      the_oracle/        (数据先知 - DataSync)
      the_strategist/    (量化策略师 - QuantAnalyst)
      the_critic/        (对抗评论员 - DecisionCore)
      the_guardian/      (风控守护者 - RiskAudit)
      the_executor/      (执行指挥官 - ExecutionEngine)
    """
    
    def __init__(self, base_dir: str = 'data'):
        self.base_dir = base_dir
        
        # 定义业务目录映射 (Unified AIF Hierarchy)
        self.dirs = {
            # 1. 采样层 - 数据先知 (The Oracle)
            'market_data': os.path.join(base_dir, 'the_oracle', 'market_data'),
            
            # 2. 假设层 - 量化策略师 (The Strategist)
            'indicators': os.path.join(base_dir, 'the_strategist', 'indicators'),
            'features': os.path.join(base_dir, 'the_strategist', 'features'),
            'analytics': os.path.join(base_dir, 'the_strategist', 'analytics'),
            
            # 2b. 预测层 - 预测预言家 (The Prophet)
            'predictions': os.path.join(base_dir, 'the_prophet', 'predictions'),
            
            # 3. 对抗层 - 对抗评论员 (The Critic)
            'llm_logs': os.path.join(base_dir, 'the_critic', 'llm_logs'),
            'decisions': os.path.join(base_dir, 'the_critic', 'decisions'),
            
            # 4. 审计层 - 风控守护者 (The Guardian)
            'risk_audits': os.path.join(base_dir, 'the_guardian', 'audits'),
            
            # 5. 执行层 - 执行指挥官 (The Executor)
            'orders': os.path.join(base_dir, 'the_executor', 'orders'),
            'trades': os.path.join(base_dir, 'the_executor', 'trades'),
            'backtest': os.path.join(base_dir, 'the_executor', 'backtests')
        }
        
        # 兼容旧路径映射 (Alias for legacy methods)
        self.dirs['agent_context'] = self.dirs['analytics']
        self.dirs['executions'] = self.dirs['orders']
            
    def _get_date_folder(self, category: str, date: Optional[str] = None) -> str:
        """获取或创建指定类别的日期文件夹"""
        if date is None:
            date = datetime.now().strftime('%Y%m%d')
        
        category_dir = self.dirs.get(category)
        if not category_dir:
            # Fallback for unknown categories
            category_dir = os.path.join(self.base_dir, category)
            os.makedirs(category_dir, exist_ok=True)
            
        date_folder = os.path.join(category_dir, date)
        os.makedirs(date_folder, exist_ok=True)
        return date_folder
    
    def save_market_data(
        self,
        klines: List[Dict],
        symbol: str,
        timeframe: str,
        save_formats: List[str] = ['json', 'csv', 'parquet'],
        cycle_id: str = None
    ) -> Dict[str, str]:
        """保存原始K线数据 (原 save_step1_klines)"""
        if not klines:
            log.warning("K线数据为空，跳过保存")
            return {}
        
        date_folder = self._get_date_folder('market_data')
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # 元数据
        df = pd.DataFrame(klines)
        try:
            first_ts = pd.to_datetime(klines[0]['timestamp'], unit='ms')
            last_ts = pd.to_datetime(klines[-1]['timestamp'], unit='ms')
        except:
            first_ts = "unknown"
            last_ts = "unknown"
            
        metadata = {
            'symbol': symbol,
            'timeframe': timeframe,
            'count': len(klines),
            'timestamp': timestamp
        }
        
        saved_files = {}
        if cycle_id:
            filename_base = f'market_data_{symbol}_{timeframe}_{timestamp}_cycle_{cycle_id}'
        else:
            filename_base = f'market_data_{symbol}_{timeframe}_{timestamp}'
        
        if 'json' in save_formats:
            path = os.path.join(date_folder, f'{filename_base}.json')
            with open(path, 'w', encoding='utf-8') as f:
                json.dump({'metadata': metadata, 'klines': klines}, f, indent=2)
            saved_files['json'] = path
            
        if 'csv' in save_formats:
            path = os.path.join(date_folder, f'{filename_base}.csv')
            df.to_csv(path, index=False)
            saved_files['csv'] = path
            
        if 'parquet' in save_formats:
            path = os.path.join(date_folder, f'{filename_base}.parquet')
            df.to_parquet(path, index=False)
            saved_files['parquet'] = path
            
        log.debug(f"保存市场数据: {symbol} {timeframe}")
        return saved_files

    def save_indicators(
        self,
        df: pd.DataFrame,
        symbol: str,
        timeframe: str,
        snapshot_id: str,
        cycle_id: str = None
    ) -> Dict[str, str]:
        """保存技术指标数据 (原 save_step2_indicators)"""
        date_folder = self._get_date_folder('indicators')
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        if cycle_id:
            filename = f'indicators_{symbol}_{timeframe}_{timestamp}_cycle_{cycle_id}_snap_{snapshot_id}.parquet'
        else:
            filename = f'indicators_{symbol}_{timeframe}_{timestamp}_{snapshot_id}.parquet'
        path = os.path.join(date_folder, filename)
        
        df.to_parquet(path)
        log.debug(f"保存技术指标: {path}")
        return {'parquet': path}

    def save_features(
        self,
        features: pd.DataFrame,
        symbol: str,
        timeframe: str,
        snapshot_id: str,
        version: str = 'v1',
        cycle_id: str = None
    ) -> Dict[str, str]:
        """保存特征数据 (原 save_step3_features)"""
        date_folder = self._get_date_folder('features')
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        if cycle_id:
            filename = f'features_{symbol}_{timeframe}_{timestamp}_cycle_{cycle_id}_snap_{snapshot_id}_{version}.parquet'
        else:
            filename = f'features_{symbol}_{timeframe}_{timestamp}_{snapshot_id}_{version}.parquet'
        path = os.path.join(date_folder, filename)
        
        features.to_parquet(path)
        log.debug(f"保存特征数据: {path}")
        return {'parquet': path}

    def save_context(
        self,
        context: Dict,
        symbol: str,
        identifier: str,
        snapshot_id: str,
        cycle_id: str = None
    ) -> Dict[str, str]:
        """保存Agent上下文/分析结果 (原 save_step4_context)"""
        date_folder = self._get_date_folder('agent_context')
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        if cycle_id:
            filename = f'context_{symbol}_{identifier}_{timestamp}_cycle_{cycle_id}_snap_{snapshot_id}.json'
        else:
            filename = f'context_{symbol}_{identifier}_{timestamp}_{snapshot_id}.json'
        path = os.path.join(date_folder, filename)
        
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(context, f, indent=2, ensure_ascii=False)
            
        log.debug(f"保存Agent上下文: {path}")
        return {'json': path}

    def save_llm_log(
        self,
        content: str,
        symbol: str,
        snapshot_id: str,
        cycle_id: str = None
    ) -> Dict[str, str]:
        """保存LLM交互日志 (按币种分文件夹)
        
        路径结构: data/the_critic/llm_logs/{SYMBOL}/{YYYYMMDD}/llm_log_{timestamp}_{snapshot_id}.md
        """
        # Get base llm_logs directory
        base_llm_dir = self.dirs.get('llm_logs')
        
        # Create symbol-specific subfolder
        date_str = datetime.now().strftime('%Y%m%d')
        symbol_date_folder = os.path.join(base_llm_dir, symbol, date_str)
        os.makedirs(symbol_date_folder, exist_ok=True)
        
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        # Include cycle_id in filename if provided
        if cycle_id:
            filename = f'llm_log_{timestamp}_cycle_{cycle_id}_snap_{snapshot_id}.md'
        else:
            filename = f'llm_log_{timestamp}_snap_{snapshot_id}.md'
        path = os.path.join(symbol_date_folder, filename)
        
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
            
        log.debug(f"保存LLM日志: {path}")
        return {'md': path}

    def save_decision(
        self,
        decision: Dict,
        symbol: str,
        snapshot_id: str,
        cycle_id: str = None
    ) -> Dict[str, str]:
        """保存决策结果 (原 save_step6_decision)"""
        date_folder = self._get_date_folder('decisions')
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        # Use cycle_id if provided, otherwise fall back to snapshot_id
        if cycle_id:
            filename = f'decision_{symbol}_{cycle_id}_{timestamp}.json'
            decision['cycle_id'] = cycle_id  # Ensure it's in the content too
        else:
            filename = f'decision_{symbol}_{timestamp}_{snapshot_id}.json'
        path = os.path.join(date_folder, filename)
        
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(decision, f, indent=2, ensure_ascii=False)
            
        log.debug(f"保存决策结果: {path}")
        return {'json': path}

    def save_execution(
        self,
        record: Dict,
        symbol: str,
        cycle_id: str = None
    ) -> Dict[str, str]:
        """保存执行记录"""
        date_folder = self._get_date_folder('orders')
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        if cycle_id:
            filename = f'order_{symbol}_{timestamp}_cycle_{cycle_id}.json'
            record['cycle_id'] = cycle_id
        else:
            filename = f'order_{symbol}_{timestamp}.json'
        path = os.path.join(date_folder, filename)
        
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(record, f, indent=2, ensure_ascii=False)
        
        # 追加CSV
        csv_path = os.path.join(date_folder, f'orders_{symbol}.csv')
        df = pd.DataFrame([record])
        if os.path.exists(csv_path):
            df.to_csv(csv_path, mode='a', header=False, index=False)
        else:
            df.to_csv(csv_path, index=False)
            
        log.debug(f"保存执行记录: {path}")
        return {'json': path, 'csv': csv_path}

    def save_risk_audit(
        self,
        audit_result: Dict,
        symbol: str,
        snapshot_id: str,
        cycle_id: str = None
    ) -> Dict[str, str]:
        """保存风控审计结果"""
        date_folder = self._get_date_folder('risk_audits')
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        if cycle_id:
            filename = f'audit_{symbol}_{timestamp}_cycle_{cycle_id}_snap_{snapshot_id}.json'
            audit_result['cycle_id'] = cycle_id
        else:
            filename = f'audit_{symbol}_{timestamp}_{snapshot_id}.json'
        path = os.path.join(date_folder, filename)
        
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(audit_result, f, indent=2, ensure_ascii=False)
            
        log.debug(f"保存风控审计记录: {path}")
        return {'json': path}

    def save_prediction(
        self,
        prediction: Dict,
        symbol: str,
        snapshot_id: str,
        cycle_id: str = None
    ) -> Dict[str, str]:
        """保存预测预言家(The Prophet)的预测结果"""
        date_folder = self._get_date_folder('predictions')
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        
        if cycle_id:
            filename = f'prediction_{symbol}_{timestamp}_cycle_{cycle_id}_snap_{snapshot_id}.json'
            prediction['cycle_id'] = cycle_id
        else:
            filename = f'prediction_{symbol}_{timestamp}_snap_{snapshot_id}.json'
        path = os.path.join(date_folder, filename)
        
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(prediction, f, indent=2, ensure_ascii=False)
            
        log.debug(f"保存预测结果: {path}")
        return {'json': path}

    def list_files(self, category: str, date: str = None) -> List[str]:
        """列出文件"""
        folder = self._get_date_folder(category, date)
        if not os.path.exists(folder):
            return []
        return [os.path.join(folder, f) for f in os.listdir(folder)]

    # 兼容性别名 (Adapters for old code if any remains)
    save_step1_klines = save_market_data
    save_step2_indicators = save_indicators
    save_step3_features = save_features
    save_step4_context = save_context
    save_step5_markdown = save_llm_log
    save_step6_decision = save_decision
    save_step7_execution = save_execution

    # --- 交易历史记录扩展 ---
    TRADE_COLUMNS = [
        'record_time', 'open_cycle', 'close_cycle', 'action', 'symbol', 'price', 'quantity', 
        'cost', 'exit_price', 'pnl', 'confidence', 'status'
    ]

    def save_trade(self, trade_data: Dict):
        """保存交易记录（持久化追加至单一CSV，标准化 Schema）"""
        try:
            category = 'trades'
            base_path = self.dirs.get(category)
            if not os.path.exists(base_path):
                os.makedirs(base_path, exist_ok=True)
            
            file_path = os.path.join(base_path, 'all_trades.csv')
            
            # 1. 完善基础字段
            trade_data['record_time'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            if 'cycle_id' not in trade_data and 'cycle' in trade_data:
                trade_data['cycle_id'] = trade_data['cycle']
            
            # 2. 补全缺失字段 (Schema 稳定性)
            for col in self.TRADE_COLUMNS:
                if col not in trade_data:
                    trade_data[col] = 0.0 if col in ['cost', 'pnl', 'exit_price', 'price', 'quantity'] else 'N/A'
            
            # 3. 按标准顺序转换为 DataFrame
            df = pd.DataFrame([{col: trade_data[col] for col in self.TRADE_COLUMNS}])
            
            # 4. 保存
            if os.path.exists(file_path):
                df.to_csv(file_path, mode='a', header=False, index=False)
            else:
                df.to_csv(file_path, mode='w', header=True, index=False)
            
            log.debug(f"交易记录已保存 (标准化): {file_path}")
        except Exception as e:
            log.error(f"保存标准化交易记录失败: {e}")

    def get_recent_trades(self, limit: int = 10) -> List[Dict]:
        """获取最近的交易记录"""
        try:
            file_path = os.path.join(self.dirs.get('trades'), 'all_trades.csv')
            if not os.path.exists(file_path):
                return []
            
            df = pd.read_csv(file_path)
            # 获取最后N条并按时间反序（或者保持原序由展示层决定）
            recent = df.tail(limit).to_dict('records')
            return recent
        except Exception as e:
            log.error(f"获取最近交易记录失败: {e}")
            return []

    def update_trade_exit(
        self,
        symbol: str,
        exit_price: float,
        pnl: float,
        exit_time: str,
        close_cycle: int = 0
    ) -> bool:
        """
        更新交易记录的平仓信息 (原地更新)
        
        查找该 symbol 最近一条非 CLOSED 状态的记录，更新其 Exit Price 和 PnL。
        这样可以保持 Trade History 表格的一致性（Round-Trip View）。
        """
        try:
            file_path = os.path.join(self.dirs.get('trades'), 'all_trades.csv')
            if not os.path.exists(file_path):
                log.warning("交易记录文件不存在，无法更新平仓信息")
                return False
            
            df = pd.read_csv(file_path)
            if df.empty:
                return False
            
            # 反向查找该 symbol 的 Open 记录
            # 假设 Open 记录的 status 通常为 SENT, EXECUTED, SIMULATED 等，且 exit_price 为 0 或 NaN
            # 我们查找 exit_price <= 0 或 NaN 的行
            
            # convert exit_price to numeric just in case
            df['exit_price'] = pd.to_numeric(df['exit_price'], errors='coerce').fillna(0)
            
            # Find matching rows: symbol match AND (exit_price is 0)
            mask = (df['symbol'] == symbol) & (df['exit_price'] == 0)
            
            if not mask.any():
                log.warning(f"未找到 {symbol} 的活跃持仓记录，无法更新平仓")
                return False
            
            # Get index of the LAST matching row
            target_idx = df[mask].index[-1]
            
            # Update values
            df.at[target_idx, 'exit_price'] = exit_price
            df.at[target_idx, 'pnl'] = pnl
            df.at[target_idx, 'close_cycle'] = close_cycle
            df.at[target_idx, 'status'] = 'CLOSED'
            
            # Save back
            df.to_csv(file_path, index=False)
            log.info(f"✅ 已更新交易记录: {symbol} Closed @ ${exit_price:.2f}, PnL: ${pnl:.2f}, Cycle: {close_cycle}")
            return True
            
        except Exception as e:
            log.error(f"更新交易记录失败: {e}")
            return False
            
        except Exception as e:
            log.error(f"更新交易记录失败: {e}")
            return False
