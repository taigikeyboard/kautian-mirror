#!/usr/bin/env bash
# Refreshes local inputs and verifies generated data without publishing or changing versions.
set -euo pipefail
npm run fetch:upstream
UPSTREAM_FETCHED=true npm run build
npm test
echo "Data refreshed locally; no commit, push, release or extension version change."
