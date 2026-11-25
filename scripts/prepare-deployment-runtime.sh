#!/usr/bin/env bash
set -euo pipefail

if [[ "${CI:-}" != "true" ]]; then
  echo "Deployment cleanup must only run in the publishing build."
  exit 1
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

api_dist="artifacts/api-server/dist/index.mjs"
if [[ ! -f "$api_dist" ]]; then
  echo "Production API build is missing: $api_dist"
  exit 1
fi

api_runtime="artifacts/api-server/runtime"
rm -rf "$api_runtime"
pnpm --filter @workspace/api-server deploy --prod --legacy "$api_runtime"

# Keep only production dependencies; static artifacts and the Expo server do
# not require the development workspace's packages at runtime.
rm -rf \
  "$api_runtime/dist" \
  "$api_runtime/src" \
  "$api_runtime/test" \
  "$api_runtime/build.mjs" \
  "$api_runtime/tsconfig.json" \
  "$api_runtime/.replit-artifact" \
  "$api_runtime/.env.example" \
  "$api_runtime/.tsbuildinfo"

rm -rf node_modules
find artifacts -mindepth 3 -maxdepth 3 -type d -name node_modules \
  -prune -exec rm -rf {} +
rm -rf artifacts/api-server/node_modules
ln -s runtime/node_modules artifacts/api-server/node_modules

# These directories are build/editor state, not production runtime inputs.
pnpm store prune
rm -rf \
  .cache \
  .git \
  .local \
  .pythonlibs \
  generated-artifacts \
  artifacts/worky-mobile/android \
  artifacts/worky-mobile/.expo \
  artifacts/worky-mobile/test-results \
  artifacts/worky-publicidad-vertical/hyperframes/.hyperframes

echo "Prepared a production-only runtime and removed development build data."
