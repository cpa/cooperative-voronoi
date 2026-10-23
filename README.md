# Multiplayer Voronoi

A mobile-friendly multiplayer Voronoi canvas game. Players place colored points, everyone sees the shared Voronoi diagram update over WebSockets, and a game locks when every connected player says they are happy with the result.

Live deployment: [voronoi.charlespierre.fr](https://voronoi.charlespierre.fr)

## Concept / Help Text

A multiplayer hommage to Jean-Michel Sanejouand's [Jeu de Topo (1963)](https://www.sanejouand.com/fr/art/jeu-de-topo/index.php), a game with no winner or loser where partners arrange stones until both points of view are satisfied.

Here, stones become colored points in a game based on [Voronoi diagrams](https://en.wikipedia.org/wiki/Voronoi_diagram). The original opposing points of view become each player's screen: everyone shares the same points, but phones, tablets, and browser windows frame the space differently, so each player is likely seeing a different Voronoi view.

When two screens are too similar, the game may mirror one board so the points of view diverge.

[by charlespierre.fr](https://charlespierre.fr)

## Run locally

Use Node.js 24.22.1 LTS (pinned in `.nvmrc`), or a newer patched release in
the 24.x or 26.x line (26.12.1 minimum). Node.js 20 is end of life.
The minimum versions include the [Node2Shell / CVE-2026-111497 Brotli decoder fix](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).
Python 3.13.17 (pinned in `backend/.python-version`) and `uv` are also required.

```bash
npm ci --prefix frontend
cd backend && uv sync
```

In two terminals:

```bash
npm run dev:backend
npm run dev:frontend
```

Open `http://127.0.0.1:5173`.

## Tests

```bash
npm test --prefix frontend -- --run
cd backend && uv run pytest
```

Or run the full suite from the repo root:

```bash
npm test
```

## Deploy

Production runs on `ubuntu@57.128.27.117`.

- Public URL: `https://voronoi.charlespierre.fr`
- Remote app directory: `/home/ubuntu/voronoi/repo`
- Production entrypoint: `start.sh`
- Process manager: tmux session named `voronoi`
- Backend: `127.0.0.1:8100`
- Frontend preview server: `127.0.0.1:3100`
- Reverse proxy: Caddy proxies `/api/*` and `/ws/*` to `8100`, and the rest to `3100`.

`start.sh` is the production deploy script that must be copied to the server with the rest of the repo. It installs frontend dependencies with `npm ci`, builds the frontend, syncs backend dependencies with `uv sync --frozen --no-dev`, then restarts the `voronoi` tmux session.

The script rejects Node.js versions below the patched minimum before installing
dependencies or stopping the running application. Production uses Node.js 24 LTS.
When upgrading the server runtime, restart every service using that runtime;
existing processes retain the old executable until restarted.

From the repo root, deploy the current working tree:

```bash
rsync -az --delete \
  --exclude ".git/" \
  --exclude ".env" \
  --exclude "frontend/node_modules/" \
  --exclude "frontend/dist/" \
  --exclude "backend/.venv/" \
  --exclude "backend/data/" \
  ./ ubuntu@57.128.27.117:/home/ubuntu/voronoi/repo/

ssh ubuntu@57.128.27.117 'cd /home/ubuntu/voronoi/repo && ./start.sh'
```

Verify after deploy:

```bash
ssh ubuntu@57.128.27.117 'tmux ls'
ssh ubuntu@57.128.27.117 'ss -ltnp | grep -E "(:8100|:3100)"'
curl -I https://voronoi.charlespierre.fr
```

Useful production logs:

```bash
ssh ubuntu@57.128.27.117 'tmux capture-pane -pt voronoi:backend -S -120'
ssh ubuntu@57.128.27.117 'tmux capture-pane -pt voronoi:frontend -S -120'
```
