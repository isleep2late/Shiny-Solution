#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 reference.py > vectors.json
node test.cjs vectors.json
node test-data.cjs
if command -v dotnet >/dev/null 2>&1 || [ -x "$HOME/.dotnet/dotnet" ]; then
  export DOTNET_ROOT="$HOME/.dotnet"
  export PATH="$HOME/.dotnet:$PATH"
  dotnet run --project ../app/Tests -c Release -- --emit-gen4-vectors gen4-vectors.json
  node test-gen4.cjs gen4-vectors.json
  dotnet run --project ../app/Tests -c Release -- --generators generators-vectors.json generators-cross.json
  node test-generators.cjs generators-vectors.json generators-cross.json
else
  echo "dotnet not found; skipping gen4 parity vectors"
  node test-generators.cjs generators-vectors.json
fi
