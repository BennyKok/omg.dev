#!/usr/bin/env python3
"""Compatibility entry point. The canonical SVG and renderer live at the repo root."""
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
subprocess.run(["bun", "run", "scripts/generate-icons.ts", *sys.argv[1:]], cwd=root, check=True)
