import functools

from src.utils.logger import log

def log_run(func):
    @functools.wraps(func)
    def wrapper(self, *args, **kwargs):
        log.debug(f"{self.__class__.__name__} started")
        try:
            result = func(self, *args, **kwargs)
            log.debug(f"{self.__class__.__name__} finished")
            return result
        except Exception as e:
            log.critic(f"{self.__class__.__name__} errored")
            raise
    return wrapper