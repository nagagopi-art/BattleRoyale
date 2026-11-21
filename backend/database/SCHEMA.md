# Database schema reference

Generated on 2026-11-19 from the live Supabase REST metadata (PostgREST OpenAPI).
It lists the tables, columns and database functions (RPCs) the backend uses.

**This is a reference, not a migration.** The SQL that created `matches`, `players`,
`match_players`, `player_match_results` and the RPCs below is not in this repo. To keep
it under version control, export it from Supabase (Dashboard → Database → Functions /
Tables, or `supabase db dump --schema public`) into `database/migrations/000_base_schema.sql`.

SQL files that are in the repo:

| File | Creates | Status on the live database (2026-11-19) |
|---|---|---|
| `database/maps.sql` | `maps` table + 12 maps | **Not applied** (table missing) |
| `database/map_locations.sql` | `map_locations` table | **Not applied** |
| `database/migrations/001_match_state_snapshots.sql` | `match_state_snapshots` (crash recovery) | **Not applied** |

## Tables

### `matches`

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | `gen_random_uuid()` | Note: This is a Primary Key.<pk/> |
| `match_code` | character varying | yes |  |  |
| `map_name` | character varying | yes |  |  |
| `game_mode` | character varying | yes |  |  |
| `max_players` | int32 | yes | `150` |  |
| `current_players` | int32 | yes | `1` |  |
| `status` | character varying | yes | `waiting` |  |
| `created_by` | int64 | yes |  | Note: This is a Foreign Key to `players.id`.<fk table='players' column='id'/> |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `start_at` | timestamp with time zone |  |  |  |
| `started_at` | timestamp with time zone |  |  |  |
| `battlefield_status` | character varying |  | `not_started` |  |
| `alive_players` | int32 | yes | `0` |  |
| `eliminated_players` | int32 | yes | `0` |  |
| `winner_team` | int32 |  |  |  |
| `completed_at` | timestamp with time zone |  |  |  |
| `winner_player_id` | int64 |  |  | Note: This is a Foreign Key to `players.id`.<fk table='players' column='id'/> |

### `players`

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int64 | yes |  | Note: This is a Primary Key.<pk/> |
| `player_uid` | character varying | yes |  |  |
| `username` | character varying | yes |  |  |
| `email` | character varying | yes |  |  |
| `password_hash` | text |  |  |  |
| `avatar_url` | text |  |  |  |
| `level` | int32 |  | `1` |  |
| `experience` | int32 |  | `0` |  |
| `coins` | int32 |  | `0` |  |
| `created_at` | timestamp with time zone |  | `now()` |  |
| `auth_user_id` | uuid |  |  |  |
| `rank_points` | int32 | yes | `0` |  |

### `match_players`

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int64 | yes |  | Note: This is a Primary Key.<pk/> |
| `match_id` | uuid | yes |  | Note: This is a Foreign Key to `matches.id`.<fk table='matches' column='id'/> |
| `player_id` | int64 | yes |  | Note: This is a Foreign Key to `players.id`.<fk table='players' column='id'/> |
| `joined_at` | timestamp with time zone |  | `now()` |  |
| `team_number` | int32 |  |  |  |
| `spawn_x` | double precision |  |  |  |
| `spawn_y` | double precision |  |  |  |
| `spawn_z` | double precision |  |  |  |
| `health` | int32 | yes | `100` |  |
| `armor` | int32 | yes | `0` |  |
| `kills` | int32 | yes | `0` |  |
| `is_alive` | boolean | yes | `true` |  |
| `eliminated_at` | timestamp with time zone |  |  |  |
| `current_x` | double precision |  |  |  |
| `current_y` | double precision |  |  |  |
| `current_z` | double precision |  |  |  |
| `position_updated_at` | timestamp with time zone |  |  |  |
| `helmet_level` | int32 | yes | `0` |  |
| `helmet_durability` | int32 | yes | `0` |  |
| `vest_level` | int32 | yes | `0` |  |
| `vest_durability` | int32 | yes | `0` |  |

### `player_match_results`

| Column | Type | Required | Default | Notes |
|---|---|---|---|---|
| `id` | int64 | yes |  | Note: This is a Primary Key.<pk/> |
| `match_id` | uuid | yes |  | Note: This is a Foreign Key to `matches.id`.<fk table='matches' column='id'/> |
| `player_id` | int64 | yes |  | Note: This is a Foreign Key to `players.id`.<fk table='players' column='id'/> |
| `game_mode` | text | yes |  |  |
| `map_name` | text |  |  |  |
| `kills` | int32 | yes | `0` |  |
| `deaths` | int32 | yes | `0` |  |
| `placement` | int32 |  |  |  |
| `is_winner` | boolean | yes | `false` |  |
| `xp_earned` | int32 | yes | `0` |  |
| `rank_points_earned` | int32 | yes | `0` |  |
| `completed_at` | timestamp with time zone | yes | `now()` |  |

## Database functions (RPCs)

Called with `supabaseAdmin.rpc(name, params)`. Only the parameters are visible through
the REST metadata; the function bodies live in Supabase.

### `leave_match`

| Parameter | Type | Required |
|---|---|---|
| `p_match_id` | uuid | yes |
| `p_player_id` | int64 | yes |

### `join_match`

| Parameter | Type | Required |
|---|---|---|
| `p_match_id` | uuid | yes |
| `p_player_id` | int64 | yes |

### `sync_combat_result`

| Parameter | Type | Required |
|---|---|---|
| `p_eliminated` | boolean | yes |
| `p_match_id` | uuid | yes |
| `p_shooter_id` | int64 | yes |
| `p_shooter_kills` | int32 | yes |
| `p_target_armor` | int32 | yes |
| `p_target_health` | int32 | yes |
| `p_target_helmet_durability` | int32 | yes |
| `p_target_helmet_level` | int32 | yes |
| `p_target_id` | int64 | yes |
| `p_target_is_alive` | boolean | yes |
| `p_target_vest_durability` | int32 | yes |
| `p_target_vest_level` | int32 | yes |

### `finalize_match_if_ready`

| Parameter | Type | Required |
|---|---|---|
| `p_match_id` | uuid | yes |

### `complete_match_start`

| Parameter | Type | Required |
|---|---|---|
| `p_match_id` | uuid | yes |

### `prepare_match_start`

| Parameter | Type | Required |
|---|---|---|
| `p_match_id` | uuid | yes |
| `p_player_id` | int64 | yes |
