# Tests

All tests live in this folder. Run them from the backend root.

| Folder | What | Touches the database? |
|---|---|---|
| `unit/` | Game logic (geometry, zone, healing, attachments, levels, teams, knockdown). `npm test` | No |
| `e2e/` | Full matches against a running server (see below) | Yes, creates test accounts and deletes them after |
| `load/` | Many players at once: `npm run test:load -- 20 60 5055` | Yes, cleans up after |
| `legacy/` | Older manual scripts kept for reference | Some do |

## End-to-end tests

Start a test server first, usually:

```bash
PORT=5055 ENABLE_DEV_TEST_EVENTS=true node server.js
```

| Command | Covers | Extra server settings |
|---|---|---|
| `node tests/e2e/match.e2e.js 5055` | 2-player match: combat, reload, gloo wall, grenade, results, coins, cosmetics, maps | |
| `node tests/e2e/features.e2e.js 5055` | 4-player duo: parachute, smoke, flash, attachments, knockdown, revive, reconnect, headshot, team win | |
| `node tests/e2e/items.e2e.js 5055` | Attachments, dropping, pickup, weapon swap | |
| `node tests/e2e/api.e2e.js 5055` | Accounts, profile, leaderboard, parties, quick match, auto-start, disconnect | `RECONNECT_GRACE_MS=5000` |
| `node tests/e2e/recovery.e2e.js setup 5055`, restart the server, then `... verify 5055` | Crash recovery | |
| `node tests/e2e/bots.e2e.js 5055 --fill=6 --timeout-min=20 --delete-bots` | Bots fill and play a match | `BOTS_ENABLED=true BOT_FILL_TARGET=6` |
| `node tests/e2e/cluster.e2e.js` | Two servers with match hosting | two servers, see the file header; needs migration 005 |

Only one backend should be connected to the database while e2e tests run
(another server would also pick up the test matches).

## Legacy scripts

`legacy/` holds the original hand-run scripts (`test-*.js`) and
`refresh-test-tokens.ps1`. Most need `PLAYER1_SOCKET_TOKEN`,
`PLAYER2_SOCKET_TOKEN` and `TEST_MATCH_ID` in `.env`, which
`refresh-test-tokens.ps1` fills in. The e2e tests above replace them.
