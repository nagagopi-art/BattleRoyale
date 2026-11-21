# Web clients

Browser clients for playing and testing the backend, served by the backend
(development only):

| URL | View |
|---|---|
| `http://localhost:<PORT>/play/3d.html` | **3D**: third-person characters, crosshair aiming (three.js) |
| `http://localhost:<PORT>/play` | 2D top-down map |

No build step: plain HTML, CSS and JavaScript. The 3D page loads three.js
0.160.0 from jsDelivr, so it needs an internet connection.

### 3D view

`js/render3d.js` draws the world (ground, trees, rocks, zone wall, loot,
smoke, gloo walls, grenades, aircraft) and original low-poly characters with
walk animation, team colours, held weapon, parachute and knocked/eliminated
poses. Click the game to capture the mouse (Esc releases it). Shots go where
the crosshair points; it turns red when it is on an enemy. Trees and rocks are
decoration only — the server has no collision for them.

| File | Purpose |
|---|---|
| `index.html` | Screens: login, lobby, waiting room, game |
| `css/style.css` | Styles |
| `js/api.js` | REST calls, login session, token refresh |
| `js/state.js` | What the client knows about the match |
| `js/render.js` | 2D canvas map: zone, players, loot, smoke, walls |
| `3d.html`, `js/render3d.js`, `css/style3d.css` | 3D view (three.js) |
| `js/game.js` | Socket events, controls, movement / parachute / fire loops |
| `js/ui.js` | Lobby, waiting room, HUD, results |

## Controls

| Key | Action |
|---|---|
| WASD | Move (steer while parachuting) |
| Mouse / click | Aim; fire at the enemy nearest the cursor (hold for automatic) |
| Space | Jump from the aircraft / open parachute |
| R | Reload |
| 1-3 | Switch weapon |
| F / Shift+F | Pick up nearest loot / swap with current weapon |
| G / T / Y | Frag / smoke / flash grenade toward the cursor |
| Q | Gloo wall toward the cursor |
| H / J | Bandage / medkit |
| X | Cancel healing or revive |
| E | Revive a knocked teammate |
| Mouse wheel | Zoom |

## Playing against bots

Start the backend with bots, then quick-join; after the 60-second lobby the
match fills with bots and starts:

```bash
BOTS_ENABLED=true BOT_FILL_TARGET=6 npm start
```
