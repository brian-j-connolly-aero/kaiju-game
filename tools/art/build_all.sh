#!/usr/bin/env bash
# Rebuilds all art from its generator scripts, then validates every exported model.
#
#   tools/art/build_all.sh               build everything (previews re-render only when a model changed)
#   tools/art/build_all.sh --force       re-render every preview too
#   tools/art/build_all.sh --no-previews export and validate only (fast)
#   tools/art/build_all.sh --no-concept  contact sheets but no concept shots
#   tools/art/build_all.sh --list        print the generator scripts in build order and stop
#
# A generator script is any tools/art/*.py or tools/art/<folder>/*.py that carries, in its
# first lines, the marker comment
#       # mb-family: <family> [order=N]
# Scripts run in order (default 50, lower first: give texture and atlas generators order=10
# so they run before the models that preview with them). Nothing else needs to be registered:
# add your script with the marker and it is part of the build.
set -uo pipefail
cd "$(dirname "$0")/../.."
PY=/opt/mbtools/venv/bin/python
if [ ! -x "$PY" ]; then
  echo "Missing $PY. Run tools/setup-asset-tools.sh first." >&2
  exit 1
fi

list_only=0
for arg in "$@"; do
  case "$arg" in
    --force) export MB_FORCE=1 ;;
    --no-previews) export MB_NO_PREVIEWS=1 ;;
    --no-concept) export MB_NO_CONCEPT=1 ;;
    --list) list_only=1 ;;
    *) echo "unknown option: $arg (see the top of this file)" >&2; exit 2 ;;
  esac
done

# find marked scripts and sort them by their order, then by path
scripts=$(
  for f in tools/art/*.py tools/art/*/*.py; do
    [ -f "$f" ] || continue
    case "$f" in tools/art/lib/*|tools/art/tests/*) continue ;; esac
    line=$(head -n 8 "$f" | grep -m1 -E '^# mb-family:' || true)
    [ -n "$line" ] || continue
    order=$(printf '%s\n' "$line" | sed -n 's/.*order=\([0-9][0-9]*\).*/\1/p')
    printf '%05d %s\n' "${order:-50}" "$f"
  done | sort | cut -d' ' -f2
)

if [ "$list_only" = 1 ]; then
  printf '%s\n' "$scripts"
  exit 0
fi
if [ -z "$scripts" ]; then
  echo "No generator scripts found (looking for '# mb-family:' markers under tools/art)." >&2
  exit 1
fi

failed=""
for f in $scripts; do
  echo "=== $f"
  if ! "$PY" "$f"; then
    failed="$failed $f"
  fi
done

echo "=== validating every exported model"
if ! "$PY" tools/art/validate.py --all --quiet; then
  failed="$failed validate"
fi

# Refresh the merged manifest.json. That script belongs to the code side; if it is missing
# or fails, the art itself is still built and valid, so this only warns.
if [ -f package.json ] && grep -q '"assets:manifest"' package.json; then
  echo "=== npm run assets:manifest"
  mkdir -p /tmp/mb-scratch/art-build
  if ! npm run --silent assets:manifest >/tmp/mb-scratch/art-build/assets-manifest.log 2>&1; then
    echo "WARNING: 'npm run assets:manifest' failed, so manifest.json was not refreshed." >&2
    echo "         Run it again once it works (log: /tmp/mb-scratch/art-build/assets-manifest.log)." >&2
  fi
fi

if [ -n "$failed" ]; then
  echo "BUILD FAILED:$failed" >&2
  exit 1
fi
echo "Art build complete."
