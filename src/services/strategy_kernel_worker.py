"""Minimal JSON stdin/stdout worker for an uploaded strategy function.

The parent process performs archive, AST, dependency and schema validation
before starting this worker.  This module intentionally imports no project
code so ``python -I`` cannot give uploaded code access to application secrets.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        raise RuntimeError("strategy worker requires a package directory")
    package_dir = Path(sys.argv[1]).resolve()
    module_path = package_dir / "strategy.py"
    context = json.load(sys.stdin)
    spec = importlib.util.spec_from_file_location("uploaded_strategy", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load strategy.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    entrypoint = getattr(module, "run", None)
    if not callable(entrypoint):
        raise RuntimeError("strategy.py does not expose run(context)")
    result = entrypoint(context)
    if not isinstance(result, dict):
        raise TypeError("run(context) must return a JSON object")
    sys.stdout.write(json.dumps(result, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # The parent converts this single safe line.
        sys.stderr.write(f"{type(exc).__name__}: {exc}\n")
        raise SystemExit(1)
