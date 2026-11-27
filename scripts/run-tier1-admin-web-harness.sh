#!/usr/bin/env bash
set -euo pipefail
# Run from repo root after services+fixture are ready. Requires Playwright browsers installed.
cd "$(dirname "$0")/.."
npx playwright test scripts/tier1-admin-web-harness.spec.ts --config=scripts/tier1-admin-web.playwright.config.ts
