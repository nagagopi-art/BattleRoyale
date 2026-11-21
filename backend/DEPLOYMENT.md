# Deploying the INDIAN BATTLE FIELDS backend

## 1. Database setup (once, in the Supabase SQL editor)

Run these in order. Each file is safe to run more than once.

| # | File | What it does |
|---|---|---|
| 1 | `database/maps.sql` | Creates `maps` and adds the 12 maps (the `/api/maps` routes return 503 until this runs). |
| 2 | `database/map_locations.sql` | Creates `map_locations`. |
| 3 | `database/migrations/001_match_state_snapshots.sql` | Crash recovery: saves live match state every 10s. |
| 4 | `database/migrations/002_progression.sql` | Adds `coins_earned` so coins are paid once per match. |
| 5 | `database/migrations/003_cosmetics.sql` | Cosmetics store tables, starter catalog and purchase function. |
| 6 | `database/migrations/004_lock_down_access.sql` | Blocks direct table/function access with the public key. **Read the note at the top first.** |
| 7 | `database/migrations/005_multi_server.sql` | Only for running 2+ servers: match hosting and server registry. |

`database/setup_all.sql` contains all seven in order.

The core tables and functions (`matches`, `players`, `match_players`,
`player_match_results`, `join_match`, `sync_combat_result`, …) were created
directly in Supabase and are not in this repo. `database/SCHEMA.md` lists them.
Export their SQL (`supabase db dump --schema public`) into
`database/migrations/000_base_schema.sql` so the database can be rebuilt.

Until migrations 001–003 are run, the matching features switch themselves off
and log one warning; nothing else breaks.

## 2. Production settings

Copy `.env.example` to `.env` and set at least:

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` |
| `CLIENT_URL` | Your game client URL(s), comma-separated. Required. |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY` | From Supabase → Project Settings → API. |
| `AUTO_CONFIRM_EMAIL` | `false` (players verify their email) |
| `PASSWORD_RESET_REDIRECT_URL` | Your client's password-reset page |
| `ENABLE_DEV_TEST_EVENTS` | `false` (ignored in production anyway) |

Serve the backend behind HTTPS (a load balancer or reverse proxy such as
Caddy or nginx terminating TLS). Socket.IO needs WebSocket upgrades allowed.

## 3. Running

**Docker**

```bash
docker build -t bbf-backend .
docker run -d --name bbf-backend --env-file .env -p 5000:5000 --restart unless-stopped bbf-backend
```

**Without Docker (PM2)**

```bash
npm ci --omit=dev
npx pm2 start server.js --name bbf-backend
npx pm2 save
```

On `SIGTERM` (normal stop/redeploy) the server saves every live match's state
before exiting, so players can rejoin after the restart.

## 4. One server or several

**One server (default):** leave `SERVER_ID` and `SERVER_PUBLIC_URL` empty. One
server comfortably runs several full matches; measure with
`tests/load/load-test.js` before adding more.

**Several servers:** live match state is kept in each server's memory, so every
match is *hosted* by exactly one server and all its players connect there.

1. Run migration 005.
2. On every server set a unique `SERVER_ID` and its public address in
   `SERVER_PUBLIC_URL` (for example `https://game-1.example.com`).
3. Any server can answer the REST API (put them behind one load balancer for
   `/api/...`). New matches go to the least busy live server.
4. `POST /api/matches/create`, both join routes and
   `POST /api/matchmaking/quick-join` return `serverUrl`. **The client must
   open its game socket to that URL.** If it connects elsewhere, `join-match`
   replies with a `wrong-server` event containing the right `serverUrl`.
5. Each server only runs countdowns, zones, bots and snapshots for the matches
   it hosts. Each server reports its load every 10 seconds; a server that stops
   reporting for 30 seconds gets no new matches.

Do not run two servers *without* these settings against the same database:
they would both process every match.

## 5. Monitoring

- **Health check:** `GET /api/health` returns uptime, memory, connected players
  and live matches. Point an uptime monitor at it (the Docker image already
  uses it as its `HEALTHCHECK`).
- **Logs to alert on:**
  - `UNCAUGHT EXCEPTION` / `UNHANDLED REJECTION` — bugs; the process restarts.
  - `Combat database synchronization error` / `Zone damage sync error` — saves failing.
  - `ANTI-CHEAT:` — repeated suspicious aim snaps or speed violations.
  - `SECURITY:` — production misconfiguration.
- **Error alerts:** set `ERROR_WEBHOOK_URL` (a Discord or Slack incoming
  webhook, or any endpoint accepting JSON). Crashes, unhandled rejections and
  failed combat/zone/healing/completion saves are posted there with the server
  ID and stack; each distinct error is sent at most once a minute.

## 5b. Bots

Set `BOTS_ENABLED=true` to fill quick matches that are short of players after
the 60-second lobby wait, up to `BOT_FILL_TARGET` players (default 8). Bots are
real accounts named `bot_...` (created on demand, kept off the leaderboard)
that the server plays over a normal socket connection, so they follow every
game rule.

## 6. Backups and recovery

- Turn on **Point-in-Time Recovery** in Supabase (paid plans) or at least check
  the daily backups under Database → Backups.
- Keep a periodic `supabase db dump` of the schema and data off-site.
- Test a restore into a separate project once, so the steps are known before
  they are needed.
- Live match state is not critical to back up: a lost match is cancelled
  automatically by the server after 60 minutes.

## 7. Tests

| Command | What it does |
|---|---|
| `npm test` | Unit tests for game logic (no database). |
| `npm run test:e2e -- 5055` | Full 2-player match against a running server (**writes to the database, cleans up after**). |
| `npm run test:load -- 20 60 5055` | 20 players for 60s; reports movement latency (**writes to the database, cleans up after**). |
| `node tests/e2e/features.e2e.js 5055` | 4-player duo match: parachute, smoke, flash, knockdown, revive, team win. |
| `node tests/e2e/api.e2e.js 5055` | Accounts, profile, parties, quick match, disconnect (start the server with `RECONNECT_GRACE_MS=5000`). |
| `node tests/e2e/items.e2e.js 5055` | Attachments, dropping, pickup and weapon swap. |
| `node tests/e2e/recovery.e2e.js setup|verify 5055` | Crash recovery across a server restart. |
| `node tests/e2e/bots.e2e.js 5055 --fill=6 --timeout-min=20 --delete-bots` | Bots fill and play a match (server with `BOTS_ENABLED=true`). |
| `node tests/e2e/cluster.e2e.js` | Two servers (5055, 5056) with match hosting. |

The e2e and load tests need the server started with
`ENABLE_DEV_TEST_EVENTS=true`.
