"""
🔮 Prophet ML Model
===========================================

基于 LightGBM 的价格预测模型
Label: 未来 30 分钟价格是否上涨 (涨幅 > 0.1%)

Author: AI Trader Team
Date: 2025-12-21
"""

import os
import pickle
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import numpy as np
import pandas as pd

from src.agents.predict import PredictAgent
from src.utils.logger import log

# 尝试导入 LightGBM
try:
    import lightgbm as lgb
    HAS_LIGHTGBM = True
except (ImportError, OSError):
    HAS_LIGHTGBM = False
    log.warning("LightGBM not installed, will use rule-based scoring mode")


class ProphetMLModel:
    """
    Prophet 价格预测 ML 模型
    
    特点:
    - 使用 LightGBM 二分类模型
    - Label: 未来 30 分钟价格上涨 (涨幅 > 0.1%)
    - 输出: 上涨概率 P(up)
    """
    
    # 默认模型参数
    DEFAULT_PARAMS = {
        'objective': 'binary',
        'metric': 'binary_logloss',
        'boosting_type': 'gbdt',
        
        # 🔧 Balanced Model Complexity (Improved from too simple)
        'num_leaves': 20,              # Increased from 10 (allow more patterns)
        'max_depth': 6,                # Increased from 4 (deeper trees for complex patterns)
        'min_child_samples': 20,       # Keep at 20 (good balance)
        'min_child_weight': 0.001,     # Keep (prevents overfitting on outliers)
        
        # 🔧 Moderate Regularization (Reduced from too strong)
        'lambda_l1': 0.1,              # Reduced from 0.5 (less penalty)
        'lambda_l2': 0.1,              # Reduced from 0.5 (less penalty)
        'min_gain_to_split': 0.01,    # Reduced from 0.02 (easier to split)
        
        # 🔧 Learning Rate & Iterations (Optimized)
        'learning_rate': 0.05,         # Increased from 0.02 (faster learning)
        'n_estimators': 200,           # Increased from 100 (more trees for better fit)
        
        # 🔧 Sampling (Moderate)
        'feature_fraction': 0.8,       # Increased from 0.7 (use more features)
        'bagging_fraction': 0.8,       # Increased from 0.7 (use more samples)
        'bagging_freq': 5,
        
        # Training
        'early_stopping_rounds': 30,   # Keep at 30
        'verbose': -1,
        
        # 🔧 Additional boosting parameters for better performance
        'max_bin': 255,                # Default, good for most cases
        'min_data_in_bin': 3,          # Minimum data in one bin
    }
    
    # 预测所需的核心特征列表
    REQUIRED_FEATURES = [
        'rsi',
        'bb_position',
        'trend_confirmation_score',
        'ema_cross_strength',
        'sma_cross_strength',
        'volume_ratio',
        'momentum_acceleration',
        'atr_normalized',
        'price_to_sma20_pct',
        'macd_momentum_5',
        'rsi_momentum_5',
        'obv_trend',
        'volatility_20',
    ]
    
    # Label 定义 (Multi-class Trend Direction)
    PREDICTION_HORIZON_MINUTES = 180  # 3 hours (clearer trends)
    STRONG_THRESHOLD = 0.015  # 1.5% for strong moves
    WEAK_THRESHOLD = 0.005    # 0.5% for weak moves
    def __init__(self, model_path: Optional[str] = None, symbol: str = 'BTCUSDT'):
        """
        初始化 Prophet ML 模型
        
        Args:
            model_path: 预训练模型路径 (可选)
            symbol: 交易对符号 (用于生成模型文件名)
        """
        self.model = None
        self.symbol = symbol
        # 生成 symbol-specific 模型路径
        default_path = f'models/prophet_lgb_{symbol}.pkl'
        self.model_path = model_path or default_path
        self.feature_names: List[str] = []
        self.is_trained = False
        
        # 尝试加载预训练模型
        if model_path and os.path.exists(model_path):
            self.load(model_path)
        elif os.path.exists(self.model_path):
            self.load(self.model_path)
    
    def train(
        self,
        X_train: pd.DataFrame,
        y_train: pd.Series,
        X_val: Optional[pd.DataFrame] = None,
        y_val: Optional[pd.Series] = None,
        params: Optional[Dict] = None
    ) -> Dict:
        """
        训练模型
        
        Args:
            X_train: 训练特征 DataFrame
            y_train: 训练标签 Series (0 或 1)
            X_val: 验证特征 (可选)
            y_val: 验证标签 (可选)
            params: 模型参数 (可选)
        
        Returns:
            训练指标字典
        """
        if not HAS_LIGHTGBM:
            raise ImportError("LightGBM not installed, please run: pip install lightgbm")
        
        # 使用默认参数或自定义参数
        model_params = {**self.DEFAULT_PARAMS, **(params or {})}
        
        # 保存特征名
        self.feature_names = list(X_train.columns)
        
        log.info(f"🔮 开始训练 Prophet ML 模型...")
        log.info(f"   训练样本: {len(X_train)}, 特征数: {len(self.feature_names)}")
        
        # 处理验证集
        eval_set = None
        if X_val is not None and y_val is not None:
            eval_set = [(X_val, y_val)]
            log.info(f"   验证样本: {len(X_val)}")
        
        # 训练 LightGBM 模型
        self.model = lgb.LGBMClassifier(**model_params)
        
        if eval_set:
            self.model.fit(
                X_train, y_train,
                eval_set=eval_set,
            )
        else:
            self.model.fit(X_train, y_train)
        
        self.is_trained = True
        
        # 计算训练指标
        train_pred = self.model.predict_proba(X_train)[:, 1]
        train_auc = self._calculate_auc(y_train, train_pred)
        
        metrics = {
            'train_samples': len(X_train),
            'train_auc': train_auc,
            'n_features': len(self.feature_names),
            'model_type': 'lightgbm',
        }
        
        if X_val is not None and y_val is not None:
            val_pred = self.model.predict_proba(X_val)[:, 1]
            val_auc = self._calculate_auc(y_val, val_pred)
            metrics['val_samples'] = len(X_val)
            metrics['val_auc'] = val_auc
            self.val_auc_score = val_auc  # Store for runtime usage
        else:
            self.val_auc_score = 0.5
        
        log.info(f"   ✅ 训练完成! AUC: {train_auc:.4f}")
        
        return metrics

    @property
    def val_auc(self) -> float:
        """获取验证集 AUC 分数"""
        return getattr(self, 'val_auc_score', 0.5)
    
    def predict_proba(self, features: Dict[str, float]) -> Dict[str, float]:
        """
        预测多分类概率 (Multi-class Trend Direction)
        
        Args:
            features: 特征字典
        
        Returns:
            Dict with probabilities for each class:
            {
                'strong_down': float,  # P(class=-2)
                'weak_down': float,    # P(class=-1)
                'neutral': float,      # P(class=0)
                'weak_up': float,      # P(class=1)
                'strong_up': float,    # P(class=2)
            }
        """
        if not self.is_trained or self.model is None:
            raise ValueError("模型未训练，请先调用 train() 或 load()")
        
        # 构建特征向量
        feature_vector = self._prepare_features(features)
        
        # 预测概率 (5 classes)
        probs = self.model.predict_proba(feature_vector)[0]
        
        # Map to class names
        # LightGBM multiclass uses 0-indexed classes, but our labels are -2 to 2
        # We need to map: class 0 → -2, class 1 → -1, class 2 → 0, class 3 → 1, class 4 → 2
        return {
            'strong_down': float(probs[0]),  # class -2 → index 0
            'weak_down': float(probs[1]),    # class -1 → index 1
            'neutral': float(probs[2]),      # class 0 → index 2
            'weak_up': float(probs[3]),      # class 1 → index 3
            'strong_up': float(probs[4]),    # class 2 → index 4
        }
    
    def _prepare_features(self, features: Dict[str, float]) -> pd.DataFrame:
        """
        准备特征向量
        
        Args:
            features: 原始特征字典
        
        Returns:
            DataFrame 格式的特征向量
        """
        # 使用训练时的特征顺序
        feature_names = self.feature_names if self.feature_names else self.REQUIRED_FEATURES
        
        feature_values = []
        for name in feature_names:
            value = features.get(name, 0.0)
            # 处理异常值
            if value is None or (isinstance(value, float) and np.isnan(value)):
                value = 0.0
            elif isinstance(value, float) and np.isinf(value):
                value = 100.0 if value > 0 else -100.0
            feature_values.append(float(value))
        
        return pd.DataFrame([feature_values], columns=feature_names)
    
    def _calculate_auc(self, y_true: pd.Series, y_pred: np.ndarray) -> float:
        """计算 AUC 分数 (多分类使用 macro-average)"""
        try:
            from sklearn.metrics import roc_auc_score
            # For multiclass, use one-vs-rest with macro average
            # y_pred should be probabilities (n_samples, n_classes)
            return roc_auc_score(y_true, y_pred, multi_class='ovr', average='macro')
        except Exception as e:
            # Fallback: use accuracy as proxy
            try:
                from sklearn.metrics import accuracy_score
                y_pred_class = np.argmax(y_pred, axis=1) if len(y_pred.shape) > 1 else y_pred
                # Map back to original labels: 0→-2, 1→-1, 2→0, 3→1, 4→2
                y_pred_class = y_pred_class - 2
                return accuracy_score(y_true, y_pred_class)
            except:
                return 0.0
    
    def save(self, path: Optional[str] = None):
        """
        保存模型
        
        Args:
            path: 保存路径
        """
        save_path = path or self.model_path
        
        # 确保目录存在
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        
        # 保存模型和特征名
        model_data = {
            'model': self.model,
            'feature_names': self.feature_names,
            'is_trained': self.is_trained,
            'val_auc': getattr(self, 'val_auc_score', 0.5), # Persist AUC
            'saved_at': datetime.now().isoformat(),
        }
        
        with open(save_path, 'wb') as f:
            pickle.dump(model_data, f)
        
        log.info(f"✅ 模型已保存: {save_path}")
    
    def load(self, path: str):
        """
        加载模型
        
        Args:
            path: 模型文件路径
        """
        if not os.path.exists(path):
            raise FileNotFoundError(f"模型文件不存在: {path}")
        
        with open(path, 'rb') as f:
            model_data = pickle.load(f)
            
        self.model = model_data['model']
        self.feature_names = model_data['feature_names']
        self.is_trained = model_data.get('is_trained', True)
        self.val_auc_score = model_data.get('val_auc', 0.5) # Load AUC
        self.model_path = path
        log.info(f"✅ 模型已加载: {path}")
    
    def get_feature_importance(self) -> Dict[str, float]:
        """
        获取特征重要性
        
        Returns:
            特征名 -> 重要性分数
        """
        if not self.is_trained or self.model is None:
            return {}
        
        importance = self.model.feature_importances_
        return dict(zip(self.feature_names, importance))


class LabelGenerator:
    """
    标签生成器
    
    根据未来 30 分钟价格变化生成训练标签
    """
    
    def __init__(
        self,
        horizon_minutes: int = 30,
        up_threshold: float = 0.001
    ):
        """
        初始化标签生成器
        
        Args:
            horizon_minutes: 预测时间范围 (分钟)
            up_threshold: 上涨阈值 (0.001 = 0.1%)
        """
        self.horizon_minutes = horizon_minutes
        self.up_threshold = 0.001  # 0.1% threshold for binary classification
        self.up_threshold = up_threshold
    
    def generate_labels(self, df: pd.DataFrame, price_col: str = 'close') -> pd.Series:
        """
        生成二分类标签 (Binary Classification: UP vs DOWN)
        
        Args:
            df: 包含价格数据的 DataFrame (需要有时间索引)
            price_col: 价格列名
        
        Returns:
            标签 Series:
            0: DOWN (price decrease or neutral)
            1: UP (price increase > threshold)
        """
        # 计算未来价格 (向前移动 horizon 个周期)
        periods = self.horizon_minutes // 5  # 假设 5 分钟 K 线
        
        if periods < 1:
            periods = 1
        
        # 未来价格
        future_price = df[price_col].shift(-periods)
        
        # 计算收益率
        returns = (future_price - df[price_col]) / df[price_col]
        
        # 生成二分类标签 (UP = 1, DOWN = 0)
        # Threshold: 0.1% (same as original UP_THRESHOLD)
        labels = (returns > self.up_threshold).astype(int)
        
        return labels

    def prepare_training_data(
        self,
        features_df: pd.DataFrame,
        price_df: pd.DataFrame,
        price_col: str = 'close'
    ) -> Tuple[pd.DataFrame, pd.Series]:
        """
        准备训练数据
        
        Args:
            features_df: 特征 DataFrame
            price_df: 价格 DataFrame (用于生成标签)
            price_col: 价格列名
        
        Returns:
            (X, y) 元组
        """
        # 生成标签
        labels = self.generate_labels(price_df, price_col)
        
        # 对齐数据
        common_idx = features_df.index.intersection(labels.index)
        X = features_df.loc[common_idx]
        y = labels.loc[common_idx]
        
        # 移除 NaN
        valid_mask = ~(X.isna().any(axis=1) | y.isna())
        X = X[valid_mask]
        y = y[valid_mask]
        
        log.info(f"📊 训练数据准备完成: {len(X)} 样本")
        # Binary classification distribution
        up_count = (y == 1).sum()
        down_count = (y == 0).sum()
        log.info(f"   上涨样本: {up_count} ({up_count/len(y)*100:.1f}%)")
        log.info(f"   下跌样本: {down_count} ({down_count/len(y)*100:.1f}%)")

        return X, y


class ProphetAutoTrainer:
    """
    Prophet ML 模型自动训练器
    
    每隔指定时间自动重新训练模型
    """
    
    def __init__(
        self,
        binance_client,
        interval_hours: float = 2.0,
        training_days: int = 70,  # 10x samples (70 days)
    ):
        """
        初始化自动训练器
        
        Args:
            binance_client: BinanceClient 实例
            interval_hours: 训练间隔 (小时)
            training_days: 使用的历史数据天数
        """
        self.client = binance_client
        self.interval_hours = interval_hours
        self.training_days = training_days
        
        self._running = False
        self._thread = None
        self.last_train_time = None
        self.train_count = 0
        
    def start(
        self,
        predict_agent: PredictAgent,
        symbol: str = 'BTCUSDT'
    ):
        """启动自动训练线程"""
        import threading
        
        if self._running:
            log.warning("自动训练器已在运行")
            return
        
        self._running = True
        self._thread = threading.Thread(target=self._training_loop, args=(predict_agent, symbol), daemon=True)
        self._thread.start()
        log.info(f"🔄 Prophet 自动训练器已启动 | 间隔: {self.interval_hours}h | 数据: {self.training_days}天")
    
    def stop(self):
        """停止自动训练"""
        self._running = False
        log.info("🛑 Prophet 自动训练器已停止")
    
    def _training_loop(
        self,
        predict_agent: PredictAgent,
        symbol: str):
        """训练循环"""
        import time
        
        interval_seconds = self.interval_hours * 3600
        
        while self._running:
            try:
                # 执行训练
                self._do_train(predict_agent, symbol)
                self.train_count += 1
                self.last_train_time = datetime.now()
                
                # 等待下一次训练
                log.info(f"⏳ 下次自动训练: {self.interval_hours}h 后")
                
                # 分段睡眠以便及时响应停止信号
                for _ in range(int(interval_seconds)):
                    if not self._running:
                        break
                    time.sleep(1)
                    
            except Exception as e:
                log.error(f"❌ 自动训练失败: {e}")
                # 出错后等待 10 分钟再重试
                time.sleep(600)
    
    def _do_train(
        self,
        predict_agent: PredictAgent,
        symbol: str
    ):
        """执行训练"""
        log.info(f"🔮 开始自动训练 Prophet ML 模型...")
        
        model_path = f'models/prophet_lgb_{symbol}.pkl'
        
        # 1. 获取历史数据
        df = self._fetch_data(symbol)
        if df is None or len(df) < 500:
            log.warning(f"数据不足，跳过训练 (当前: {len(df) if df is not None else 0})")
            return
        
        # 2. 计算指标
        from src.data.processor import MarketDataProcessor
        processor = MarketDataProcessor()
        df_with_indicators = processor._calculate_indicators(df.copy())
        
        # 3. 构建特征
        from src.features.technical_features import TechnicalFeatureEngineer
        feature_engineer = TechnicalFeatureEngineer()
        features_df = feature_engineer.build_features(df_with_indicators)
        
        # 4. 生成标签
        label_generator = LabelGenerator(horizon_minutes=30, up_threshold=0.001)
        numeric_features = features_df.select_dtypes(include=[np.number])
        X, y = label_generator.prepare_training_data(numeric_features, df, 'close')
        
        if len(X) < 100:
            log.warning(f"有效样本不足，跳过训练 (当前: {len(X)})")
            return
        
        # 5. 分割数据
        split_idx = int(len(X) * 0.8)
        X_train, X_val = X.iloc[:split_idx], X.iloc[split_idx:]
        y_train, y_val = y.iloc[:split_idx], y.iloc[split_idx:]
        
        # 6. 训练模型
        model = ProphetMLModel()
        metrics = model.train(X_train, y_train, X_val, y_val)
        
        # 7. 保存模型
        model.save(model_path)
        
        # 8. 重新加载到 PredictAgent
        predict_agent.load_ml_model(model_path)
        
        log.info(f"✅ 自动训练完成! 训练次数: #{self.train_count + 1}")
        log.info(f"   训练 AUC: {metrics.get('train_auc', 0):.4f}")
        log.info(f"   验证 AUC: {metrics.get('val_auc', 0):.4f}")
    
    def _fetch_data(
        self,
        symbol: str
    ) -> pd.DataFrame:
        """获取历史数据"""
        try:
            limit = self.training_days * 24 * 12  # 5分钟K线
            
            all_klines = []
            remaining = limit
            end_time = None
            
            while remaining > 0:
                batch_size = min(remaining, 1000)
                klines = self.client.client.futures_klines(
                    symbol=symbol,
                    interval='5m',
                    limit=batch_size,
                    endTime=end_time
                )
                
                if not klines:
                    break
                
                all_klines = klines + all_klines
                end_time = klines[0][0] - 1
                remaining -= batch_size
            
            # 转换为 DataFrame
            df = pd.DataFrame(all_klines, columns=[
                'timestamp', 'open', 'high', 'low', 'close', 'volume',
                'close_time', 'quote_volume', 'trades', 'taker_buy_base',
                'taker_buy_quote', 'ignore'
            ])
            
            df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
            for col in ['open', 'high', 'low', 'close', 'volume']:
                df[col] = df[col].astype(float)
            
            df.set_index('timestamp', inplace=True)
            df = df.sort_index()
            
            log.info(f"📥 获取 {len(df)} 条历史 K 线")
            return df
            
        except Exception as e:
            log.error(f"获取历史数据失败: {e}")
            return None


# 导出
__all__ = ['ProphetMLModel', 'LabelGenerator', 'ProphetAutoTrainer', 'HAS_LIGHTGBM']
