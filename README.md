# INDIAN BATTLE FIELDS — Backend

Game server for a battle royale: REST API (accounts, matches, matchmaking,
store) and a real-time Socket.IO server (movement, combat, safe zone, loot),
backed by Supabase (Postgres + Auth).

## Quick start

```bash
npm install
cp .env.example .env        # fill in Supabase keys
npm run dev                 # or: npm start
```

First-time database setup: paste `database/setup_all.sql` into the Supabase
SQL Editor and run it. Production setup, multiple servers, monitoring and
backups: see [DEPLOYMENT.md](DEPLOYMENT.md).

## Project layout

```
server.js            Express + Socket.IO entry point, match countdown,
                     lobby auto-start, cleanup, shutdown
config/              Static game data and clients
  supabase.js          Supabase admin + auth clients
  weapons.js           Weapons and ammunition
  attachments.js       Attachments, spread / recoil / falloff
middleware/
  authMiddleware.js    Bearer-token check for REST routes
routes/              REST API (/api/...)
  auth.js              register, login, refresh, logout, password reset
  players.js           profile, stats, rank
  matches.js           create, join, leave, start, results
  matchmaking.js       quick join, parties
  leaderboard.js       top players (bots excluded)
  maps.js              maps and landing locations
  cosmetics.js         store: catalog, buy, equip
sockets/
  gameSocket.js        Socket.IO entry: login check, background loops,
                       registers the handlers below
  handlers/            Socket events, one file per feature
    match.js             join, leave, disconnect, combat state
    aircraft.js          aircraft, jump, parachute
    movement.js          player-move (+ smoke / flash / range filtering)
    items.js             loot pickup, inventory, drop, attachments
    equipment.js         equip weapons and armor
    combat.js            fire, reload
    throwables.js        grenades, gloo walls, smoke
    healing.js           healing items, revive
    spectate.js          spectating, zone state
    dev.js               test-only events (off in production)
  game/                Shared match state and logic (each file only
                       uses the ones listed before it)
    state.js             in-memory maps and settings
    utils.js             validation and small helpers
    persistence.js       database saves (batched positions, combat)
    drops.js             dropped items, death loot, gunshots
    lifecycle.js         match completion and cleanup
    teams.js             teams, bleed-out, team wipe
    aircraft.js          ejecting players at flight end
    zone.js              zone damage and time limit
    explosions.js        frag and flash effects
    disconnect.js        reconnect grace period
    recovery.js          crash-recovery snapshots
services/            Game logic, mostly pure and in-memory
  combatService.js       shooting, damage, armor, knockdown
  hitDetectionService.js ray / hitbox / gloo-wall checks
  inventoryService.js    weapons, ammo, armor, healing, attachments
  lootService.js         loot spawning, pickup, drops
  throwableService.js    grenades, smoke, flash, gloo walls
  safeZoneService.js     shrinking circle
  healingService.js      bandages and medkits
  knockdownService.js    knock / revive (duo, squad)
  parachuteService.js    aircraft, jump, parachute
  battlefieldService.js  spawn positions and teams
  matchCompletionService.js / progressionService.js   results, levels, coins
  matchStateService.js   crash-recovery snapshots
  partyService.js        parties for quick match
  botService.js          server-controlled bots
  clusterService.js      multi-server match hosting
  rateLimiter.js / antiCheatService.js / errorReporter.js
  geometry.js            shared 3D math
database/
  setup_all.sql        Everything below, in order (run this)
  maps.sql, map_locations.sql, migrations/00X_*.sql
  SCHEMA.md            Reference of tables and database functions
tests/               See tests/README.md
archive/             Old backup copies of earlier code (not loaded)
```

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Run the server |
| `npm run dev` | Run with auto-restart on file changes |
| `npm test` | Unit tests (no database) |
| `npm run test:e2e -- 5055` | Full match against a running test server |
| `npm run test:load -- 20 60 5055` | Load test |

## Configuration

Every setting is documented in [.env.example](.env.example).
"# BattleRoyale" 
