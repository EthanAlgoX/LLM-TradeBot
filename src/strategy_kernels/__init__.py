"""Trusted built-in strategy kernels.

Each kernel exposes the same single-argument ``run(context)`` entrypoint used
by uploaded packages.  A kernel may delegate to several internal modules; the
single function is the platform boundary, not a requirement to place an
entire strategy in one source file.
"""

from src.strategy_kernels.catalog import builtin_kernel_catalog

__all__ = ["builtin_kernel_catalog"]
