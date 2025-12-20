"""
日志工具模块 - 增强版，支持彩色输出和 LLM 专用日志
"""
import sys
import json
from pathlib import Path
from loguru import logger
from src.config import config


class ColoredLogger:
    """彩色日志包装器"""
    
    def __init__(self, logger_instance):
        self._logger = logger_instance
    
    def __getattr__(self, name):
        """转发其他方法到原始 logger"""
        return getattr(self._logger, name)
    
    def llm_input(self, message: str, context: str = None):
        """记录 LLM 输入（青色背景）"""
        self._logger.opt(colors=True).info(
            f"<bold><cyan>{'=' * 60}</cyan></bold>\n"
            f"<bold><cyan>🤖 LLM 输入</cyan></bold>\n"
            f"<bold><cyan>{'=' * 60}</cyan></bold>"
        )
        if context:
            # 截断过长的上下文
            if len(context) > 1000:
                display_context = context[:500] + "\n... (省略中间部分) ...\n" + context[-500:]
            else:
                display_context = context
            self._logger.opt(colors=True).info(f"<cyan>{display_context}</cyan>")
        self._logger.opt(colors=True).info(f"<bold><cyan>{'=' * 60}</cyan></bold>\n")
    
    def llm_output(self, message: str, decision: dict = None):
        """记录 LLM 输出（浅黄色背景）"""
        self._logger.opt(colors=True).info(
            f"<bold><light-yellow>{'=' * 60}</light-yellow></bold>\n"
            f"<bold><light-yellow>🧠 LLM 输出</light-yellow></bold>\n"
            f"<bold><light-yellow>{'=' * 60}</light-yellow></bold>"
        )
        if decision:
            formatted_json = json.dumps(decision, indent=2, ensure_ascii=False)
            self._logger.opt(colors=True).info(f"<light-yellow>{formatted_json}</light-yellow>")
        self._logger.opt(colors=True).info(f"<bold><light-yellow>{'=' * 60}</light-yellow></bold>\n")
    
    def llm_decision(self, action: str, confidence: int, reasoning: str = None):
        """记录 LLM 决策（浅色调高亮）"""
        # 根据动作类型选择颜色（使用浅色调）
        action_colors = {
            'open_long': 'light-green',
            'add_position': 'light-green',
            'open_short': 'light-red',
            'close_position': 'light-yellow',
            'reduce_position': 'light-yellow',
            'hold': 'light-blue'
        }
        color = action_colors.get(action, 'white')
        
        self._logger.opt(colors=True).info(
            f"<bold><{color}>{'=' * 60}</{color}></bold>\n"
            f"<bold><{color}>📊 交易决策</{color}></bold>\n"
            f"<bold><{color}>{'=' * 60}</{color}></bold>\n"
            f"<bold><{color}>动作: {action.upper()}</{color}></bold>\n"
            f"<bold><{color}>置信度: {confidence}%</{color}></bold>"
        )
        if reasoning:
            # 截断过长的理由
            if len(reasoning) > 500:
                display_reasoning = reasoning[:500] + "..."
            else:
                display_reasoning = reasoning
            self._logger.opt(colors=True).info(
                f"<{color}>理由: {display_reasoning}</{color}>"
            )
        self._logger.opt(colors=True).info(
            f"<bold><{color}>{'=' * 60}</{color}></bold>\n"
        )
    
    def market_data(self, message: str):
        """记录市场数据（蓝色）"""
        self._logger.opt(colors=True).info(f"<blue>📈 {message}</blue>")
    
    def trade_execution(self, message: str, success: bool = True):
        """记录交易执行（成功浅绿色/失败浅红色）"""
        color = 'light-green' if success else 'light-red'
        icon = '✅' if success else '❌'
        self._logger.opt(colors=True).info(f"<bold><{color}>{icon} {message}</{color}></bold>")
    
    def risk_alert(self, message: str):
        """记录风险警报（浅红色）"""
        self._logger.opt(colors=True).warning(
            f"<bold><light-red>⚠️  风险警报: {message}</light-red></bold>"
        )


def setup_logger():
    """配置日志系统"""
    # 移除默认处理器
    logger.remove()
    
    # 控制台输出 - 启用彩色
    logger.add(
        sys.stdout,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan> - <level>{message}</level>",
        level=config.logging.get('level', 'INFO'),
        colorize=True
    )
    
    # 文件输出 - 不使用彩色代码
    log_file = config.logging.get('file', 'logs/trading.log')
    log_path = Path(log_file)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    
    logger.add(
        log_file,
        format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function} - {message}",
        level=config.logging.get('level', 'INFO'),
        rotation="100 MB",
        retention="30 days",
        compression="zip"
    )
    
    return ColoredLogger(logger)


# 全局logger实例
log = setup_logger()
