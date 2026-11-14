#!/usr/bin/env bash
# Runs the art pipeline's own tests: builders, axis conventions, rigs, buildings, validator.
# Test models go to /tmp/mb-scratch/art-tests/, never into the game's assets.
set -uo pipefail
cd "$(dirname "$0")/../../.."
PY=/opt/mbtools/venv/bin/python
failed=""
for t in test_builders test_conventions test_rig test_structure test_validator; do
  echo "=== $t"
  "$PY" "tools/art/tests/$t.py" || failed="$failed $t"
done
echo "=== three_check (the same files, read by the game's own loader)"
if (cd tools/art/tests && node -e "import('three').then(() => process.exit(0), () => process.exit(1))" 2>/dev/null); then
  node tools/art/tests/three_check.mjs || failed="$failed three_check"
else
  echo "skipped: the three package is not installed yet (run 'npm install' once the client depends on it)"
fi
if [ -n "$failed" ]; then
  echo "TESTS FAILED:$failed" >&2
  exit 1
fi
echo "All art pipeline tests passed."
