# Multiplayer Voronoi

A mobile-friendly multiplayer Voronoi canvas game. Players place colored points, everyone sees the shared Voronoi diagram update over WebSockets, and a game locks when every connected player says they are happy with the result.

## Run locally

```bash
npm install --prefix frontend
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
