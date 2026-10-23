#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION_NAME="${SESSION_NAME:-voronoi}"
BACKEND_PORT="${BACKEND_PORT:-8100}"
FRONTEND_PORT="${FRONTEND_PORT:-3100}"

cd "$APP_DIR"

node --input-type=module -e '
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  const supported = (major === 24 && (minor > 22 || (minor === 22 && patch >= 1)))
    || (major === 26 && (minor > 12 || (minor === 12 && patch >= 1)));
  if (!supported) {
    console.error(`Node.js ${process.versions.node} is unsupported. Use 24.22.1+ LTS or 26.12.1+ within those major versions (CVE-2026-111497).`);
    process.exit(1);
  }
'

npm --prefix frontend ci
npm --prefix frontend run build

cd "$APP_DIR/backend"
uv sync --frozen --no-dev

tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
tmux new-session -d -s "$SESSION_NAME" -n backend \
  "cd '$APP_DIR/backend' && uv run --no-dev uvicorn app.main:app --host 127.0.0.1 --port '$BACKEND_PORT'"
tmux new-window -t "$SESSION_NAME" -n frontend \
  "cd '$APP_DIR' && npm --prefix frontend run preview -- --host 127.0.0.1 --port '$FRONTEND_PORT'"

tmux list-sessions
printf 'Voronoi is running in tmux session %s: backend 127.0.0.1:%s, frontend 127.0.0.1:%s\n' \
  "$SESSION_NAME" "$BACKEND_PORT" "$FRONTEND_PORT"
