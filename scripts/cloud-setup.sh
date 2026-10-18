#!/usr/bin/env bash
set -euo pipefail
cd /workspace/StoneTravelingTool
export NEXT_TELEMETRY_DISABLED=1
npm ci
if [[ ! -x .local/bin/supabase ]] || [[ "$(.local/bin/supabase --version 2>/dev/null)" != "2.76.8" ]]; then
  npm run tools:setup
fi
npm run db:start
if [[ ! -f .env.local ]] || rg -q '^# Generated local development settings for StoneTravelingTool$' .env.local; then
  npm run local:env
else
  echo 'Preserving user-managed .env.local; local settings were not overwritten.'
fi
npm run typecheck
npm run lint
npm test
npm run build
