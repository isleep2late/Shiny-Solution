#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 reference.py > vectors.json
node test.cjs vectors.json
if command -v dotnet >/dev/null 2>&1 || [ -x "$HOME/.dotnet/dotnet" ]; then
  export DOTNET_ROOT="$HOME/.dotnet"
  export PATH="$HOME/.dotnet:$PATH"
  dotnet run --project ../app/Tests -c Release -- --emit-gen4-vectors gen4-vectors.json
  node test-gen4.cjs gen4-vectors.json
  dotnet run --project ../app/Tests -c Release -- --check-timer-vectors timer-vectors.json
  dotnet run --project ../app/Tests -c Release -- --emit-timer-parity timer-parity.json 200
  node test-timers.cjs timer-vectors.json timer-parity.json
else
  echo "dotnet not found; skipping gen4 parity vectors and the JS/C# timer cross-check"
  node test-timers.cjs timer-vectors.json
fi
