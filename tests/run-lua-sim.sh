#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x luasim-venv/bin/python ]; then
  python3 -m venv luasim-venv
  luasim-venv/bin/pip -q install lupa
fi
luasim-venv/bin/python lua-sim.py
