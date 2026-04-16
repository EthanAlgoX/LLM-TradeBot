import logging

class HeadlessFilter(logging.Filter):
    """Filter to suppress verbose logs only in headless mode"""
    def filter(self, record):
        # Only suppress INFO level logs from specific modules
        if record.levelno == logging.INFO:
            suppressed_modules = [
                'src.features.technical_features',
                'src.utils.logger',
                'src.agents..data_syncdata_sync_agent',
                'src.agents.trend.trend_agent',
                'src.agents.setup.setup_agent',
                'src.agents.trigger.trigger_agent',
                'src.strategy.llm_engine',
                'src.models.prophet_model',
                'src.server.state',
                '__main__'
            ]
            return record.name not in suppressed_modules
        return True  # Allow WARNING and above