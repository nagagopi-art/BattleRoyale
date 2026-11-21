# INDIAN BATTLE FIELDS: Unity client

A third-person 3D client for the backend in `../backend`. It uses the same REST API and Socket.IO events as the web test client. The server decides everything that matters: movement checks, hits, damage, the zone, loot and cover. The client draws the game and sends input.

## What it uses from the game

| Game data | Where it shows up |
|---|---|
| **12 maps** (`/api/maps`): Sahyadri, Deccan Strike, Himshikhar, Rann of Kutch… | Lobby map picker (name, subtitle, region, environment). The waiting room and in-game banner show the map. |
| **Named locations** (`map_locations.sql`): Fort Rudra, … | Towns in the layout. The HUD shows `@ Fort Rudra · hot drop · high loot` while you are inside one. |
| **Map environment** (Tropical Forest, Desert, Snow, Mangrove, Urban…) | Sky, fog, sunlight, and the colours of ground, rock and buildings (`GameCatalog.cs → MapThemes`). |
| **Characters** (Monsoon Ranger, Desert Falcon, Himalayan Sentinel) | Each player is dressed in their equipped skin (`SkinApplier`). Name labels show `username / character`. |
| **Parachutes** (Peacock, Lotus) and **weapon finishes** (Brass Inlay, Midnight Indigo, Sunfire) | Tints, with an optional model or material swap for each skin. |

## Requirements

- Unity **2022.3 LTS** (2021.3 also works), with the URP or Built-in render pipeline.
- Packages (Window → Package Manager → **+** → *Add package from git URL*):
  - `https://github.com/itisnajim/SocketIOUnity.git`: Socket.IO client (MIT).
  - `com.unity.nuget.newtonsoft-json`: JSON.

## Setup

1. Copy `Assets/Scripts/BBF` into your Unity project's `Assets`.
2. Start the backend (`npm run dev` in `backend`). Note its port (5000 by default).
3. Build a scene:

| GameObject | Components | Notes |
|---|---|---|
| **Game** | `MatchManager`, `MapBuilder`, `WorldViews`, `GameHUD` | Set **GameHUD → Server Url** to your backend, e.g. `http://localhost:5000`. |
| **Directional Light** | Light | Drag it into **MapBuilder → Sun**. The map theme sets its colour and angle. |
| **Player** | `CharacterController` (height 1.8, radius 0.35, center y 0.9), `LocalPlayerController`, `CombatController`, `SkinApplier`, your character model + `Animator` | Drag it into **MatchManager → Local Player**. |
| **Main Camera** | `ThirdPersonCamera` | Target = Player. Drag it into the controller's and the combat script's **Camera Rig**. |
| **RemotePlayer prefab** | `RemotePlayer`, `SkinApplier`, model + `Animator`, optional `TextMesh` name label | Drag it into **MatchManager → Remote Player Prefab**. Don't add colliders; hit zones are created at runtime. |

4. Press Play. Log in with a backend account, then use **Quick match** or pick a map and **Create room**.

## Controls

| Key | Action |
|---|---|
| WASD / mouse | Move / aim (click to lock the mouse, Esc to free it) |
| Space | Jump from the aircraft. The parachute opens on its own at 500 m. |
| Left mouse | Fire |
| R · 1–3 | Reload · switch weapon |
| F / Shift+F | Pick up / swap loot |
| G · T · Y | Frag · smoke · flash grenade |
| Q | Gloo wall |
| H · J | Medkit · bandage |
| E · X | Revive a teammate · cancel |

## Art and prefab conventions

The plain build uses grey boxes tinted by the map's theme. To make it look real, add art; the game logic doesn't change.

- **MapBuilder prefabs** (house wall, roof, wall, rock, crate) must be modelled as a **1×1×1 box centred on the origin**. Each one is scaled to the server's box. The collider is always the exact server box, so whatever you see matches what you collide with. Colliders inside prefabs are removed.
- **Animator parameters** (each one is optional and used only if it exists): `Speed` (float), `Airborne`, `Knocked`, `Dead` (bools).
- **SkinApplier**:
  - list your renderers under *Outfit / Accent / Weapon / Parachute*;
  - add an **Override** for each skin id (for example `char_desert_falcon`) with a model prefab or material;
  - skins without an override get the catalogue tint.
- **WorldViews**: loot, aircraft, smoke, gloo wall (1×1×1), grenade, explosion prefabs and zone/tracer materials. All are optional.

Free assets that fit: Unity's *Starter Assets – Third Person* (character and animations), Mixamo animations, and Quaternius / Kenney low-poly buildings, rocks and crates (CC0). Use your own art, or assets licensed for this. Don't use models from other games.

## Layout and coordinates

`GET /api/matches/:id/layout` returns the map's towns, buildings and obstacles. The same map always produces the same layout. Coordinates are in metres. The ground is at y = 5, and a yaw of 0° faces +Z, the same as Unity. The server blocks movement, bullets, grenades and line of sight using these boxes.
