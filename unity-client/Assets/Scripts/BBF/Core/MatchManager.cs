// INDIAN BATTLE FIELDS - Unity client
// Central match flow: joins the match socket, applies every
// server event to MatchState and drives the world views.

using System.Collections.Generic;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace BBF
{
    public class MatchManager : MonoBehaviour
    {
        public static MatchManager Instance { get; private set; }

        [Header("Scene references")]
        public LocalPlayerController localPlayer;
        public RemotePlayer remotePlayerPrefab;
        public MapBuilder mapBuilder;
        public WorldViews world;

        public MatchState State { get; private set; } = new MatchState();
        public string LobbyMessage = "";

        readonly Dictionary<long, RemotePlayer> remotes = new();
        GameConnection net;
        bool aircraftRequested;

        void Awake()
        {
            Instance = this;
            net = GameConnection.Instance != null
                ? GameConnection.Instance
                : new GameObject("[BBF GameConnection]").AddComponent<GameConnection>();

            BindEvents();
            net.OnConnected += () => net.Emit("join-match", new { matchId = State.MatchId });
        }

        // ---------------- lobby actions (called by GameHUD) ----------------

        public async Task EnterMatch(ApiResult r)
        {
            if (!r.Ok) { LobbyMessage = r.Message; return; }

            var matchId = r.Json["matchId"]?.ToString() ?? r.Json["match"]?["id"]?.ToString();
            if (string.IsNullOrEmpty(matchId)) { LobbyMessage = "No match id in the response"; return; }

            ResetMatch();
            State.MatchId = matchId;
            State.ServerUrl = r.Json["serverUrl"]?.Type == JTokenType.String ? r.Json["serverUrl"].ToString() : null;
            State.Phase = Phase.Waiting;

            await LoadUsernames();

            var layout = await ApiClient.GetLayout(matchId);
            if (layout.Ok)
            {
                var l = (JObject)layout.Json["layout"];
                State.MapInfo = l["map"] as JObject;
                State.Towns = l["towns"] as JArray;
                mapBuilder.Build(l);
            }

            net.Connect(State.ServerUrl ?? BBFConfig.ServerUrl);
        }

        async Task LoadUsernames()
        {
            var r = await ApiClient.GetMatchPlayers(State.MatchId);
            if (!r.Ok) return;
            foreach (var p in r.Json["players"])
            {
                var info = State.Player(p["player_id"].Value<long>());
                info.Username = p["players"]?["username"]?.ToString();
            }
        }

        public void LeaveToLobby()
        {
            net.Disconnect();
            ResetMatch();
            State.Phase = Phase.Lobby;
        }

        void ResetMatch()
        {
            foreach (var r in remotes.Values) if (r) Destroy(r.gameObject);
            remotes.Clear();
            world.Clear();
            State = new MatchState();
            aircraftRequested = false;
        }

        public void Emit(string e, object payload = null) => net.Emit(e, payload);

        string Name(long id) =>
            id == ApiClient.PlayerId ? "You" :
            State.Players.TryGetValue(id, out var p) && !string.IsNullOrEmpty(p.Username) ? p.Username : $"#{id}";

        // ---------------- server events ----------------

        void BindEvents()
        {
            var n = GameConnection.Instance ?? net;

            n.On("wrong-server", d => n.Connect(d["serverUrl"].ToString()));

            n.On("joined-match", d =>
            {
                State.MatchStatus = d["matchStatus"]?.ToString();
                State.GameMode = d["gameMode"]?.ToString();
                State.MatchCode = d["matchCode"]?.ToString();

                foreach (var m in d["members"])
                {
                    var p = State.Player(m["player_id"].Value<long>());
                    p.Team = m["team_number"]?.Type == JTokenType.Integer ? m["team_number"].Value<int>() : null;
                    p.Alive = m["is_alive"]?.Value<bool>() ?? true;
                    ReadCosmetics(p, m["cosmetics"]);
                    if (p.Id == ApiClient.PlayerId) { State.Team = p.Team; State.Alive = p.Alive; }
                }

                // Dress the local character in its equipped skin.
                var me = State.Player(ApiClient.PlayerId);
                var skin = localPlayer.GetComponent<SkinApplier>();
                if (skin) skin.Apply(me.CharacterSkin, me.ParachuteSkin, me.WeaponSkin);

                foreach (var pp in d["playerPositions"])
                {
                    var id = pp["playerId"].Value<long>();
                    var pos = MatchState.Vec(pp["position"]);
                    if (id == ApiClient.PlayerId) localPlayer.Teleport(pos);
                    else { var p = State.Player(id); p.Position = pos; p.SeenAt = Time.time; }
                }

                if (State.MatchStatus == "in_progress") StartGame();
            });

            n.On("player-joined", d =>
            {
                var p = State.Player(d["playerId"].Value<long>());
                p.Username = d["username"]?.ToString();
                ReadCosmetics(p, d["cosmetics"]);
            });
            n.On("match-countdown", d => LobbyMessage = $"Starting in {d["remainingSeconds"]}s");
            n.On("match-started", _ => net.Emit("join-match", new { matchId = State.MatchId }));
            n.On("match-cancelled", d => { State.AddFeed("Match cancelled: " + d["reason"]); LeaveToLobby(); });

            n.On("player-spawned", d =>
            {
                if (d["playerId"]?.Value<long>() == ApiClient.PlayerId && d["position"]?.Type == JTokenType.Object)
                    localPlayer.Teleport(MatchState.Vec(d["position"]));
            });

            // ----- aircraft & parachute -----
            n.On("aircraft-started", d =>
            {
                State.Flight = d;
                State.FlightStartedAt = Time.time;
                if (!State.Jumped && State.Alive) State.Phase = Phase.Aircraft;
            });

            n.On("jump-started", d =>
            {
                State.Jumped = true;
                State.Phase = Phase.Dropping;
                localPlayer.Teleport(MatchState.Vec(d["position"]));
            });

            n.On("parachute-deployed", _ => State.Parachute = true);

            n.On("player-drop-position", d =>
            {
                var id = d["playerId"].Value<long>();
                var pos = MatchState.Vec(d["position"]);

                if (id == ApiClient.PlayerId)
                {
                    localPlayer.ConfirmPosition(pos);
                    if (d["state"]?.ToString() == "landed")
                    {
                        State.Phase = Phase.Ground;
                        localPlayer.Teleport(pos);
                    }
                }
                else
                {
                    var p = State.Player(id);
                    p.Position = pos;
                    p.SeenAt = Time.time;
                }
            });

            n.On("drop-status", d =>
            {
                if (d.Count == 0 || d["position"] == null) return;
                State.Jumped = true;
                State.Parachute = d["parachuteDeployed"]?.Value<bool>() ?? false;
                localPlayer.Teleport(MatchState.Vec(d["position"]));
                State.Phase = d["state"]?.ToString() == "landed" ? Phase.Ground : Phase.Dropping;
            });

            // ----- movement -----
            n.On("player-moved", d =>
            {
                var p = State.Player(d["playerId"].Value<long>());
                p.Hidden = d["hidden"]?.Value<bool>() ?? false;
                if (d["position"]?.Type == JTokenType.Object)
                {
                    p.Position = MatchState.Vec(d["position"]);
                    p.SeenAt = Time.time;
                }
            });

            n.On("spectated-player-moved", d =>
            {
                var p = State.Player(d["playerId"].Value<long>());
                p.Position = MatchState.Vec(d["position"]);
                p.SeenAt = Time.time;
            });

            n.On("player-move-ack", d =>
            {
                if (d["success"]?.Value<bool>() == true) localPlayer.ConfirmPosition(MatchState.Vec(d["position"]));
                else localPlayer.RejectMove();
            });

            // ----- loot & inventory -----
            n.On("nearby-loot", d =>
            {
                State.Loot.Clear();
                foreach (var item in d["loot"]) AddLoot(item);
            });

            n.On("loot-collected", d =>
            {
                State.Loot.Remove(d["item"]["lootId"].ToString());
                State.Inventory = (JObject)d["inventory"];
                if (d["throwables"] is JObject t) State.Throwables = t;
                State.AddFeed("Picked up " + d["item"]["name"]);

                if (d["item"]["itemType"]?.ToString() == "weapon" && State.ActiveWeapon == null)
                    net.Emit("equip-weapon", new { weaponId = d["item"]["itemId"].ToString() });
            });

            n.On("loot-removed", d =>
            {
                if (d["lootIds"] is JArray ids) foreach (var id in ids) State.Loot.Remove(id.ToString());
                if (d["lootId"] != null) State.Loot.Remove(d["lootId"].ToString());
            });

            n.On("loot-dropped", d => { foreach (var item in d["items"]) AddLoot(item); });
            n.On("item-dropped", d => { State.Inventory = (JObject)d["inventory"]; if (d["throwables"] is JObject t) State.Throwables = t; });
            n.On("inventory-data", d => State.Inventory = (JObject)d["inventory"]);
            n.On("attachment-updated", d => { State.Inventory = (JObject)d["inventory"]; State.AddFeed(d["message"]?.ToString()); });
            n.On("throwable-inventory-updated", d => State.Throwables = d);

            n.On("weapon-equipped", d =>
            {
                State.ActiveWeapon = d["weapon"]?["id"]?.ToString();
                State.Magazine = d["weapon"]?["magazineAmmo"]?.Value<int>();
                State.Reloading = false;
            });

            n.On("combat-state-data", d =>
            {
                var c = d["combat"];
                if (c == null || c.Type != JTokenType.Object) return;
                State.Health = c["health"]?.Value<float>() ?? State.Health;
                State.Armor = c["armor"]?.Value<float>() ?? State.Armor;
                State.Kills = c["kills"]?.Value<int>() ?? 0;
                State.Alive = c["isAlive"]?.Value<bool>() ?? true;
                State.Knocked = c["knocked"]?.Value<bool>() ?? false;
                State.ActiveWeapon = c["activeWeapon"]?.Type == JTokenType.String ? c["activeWeapon"].ToString() : null;
                if (State.ActiveWeapon != null)
                    State.Magazine = c["weapons"]?[State.ActiveWeapon]?["magazineAmmo"]?.Value<int>();
            });

            // ----- combat -----
            n.On("shot-fired", d =>
            {
                State.Magazine = d["remainingAmmo"]?.Value<int>() ?? State.Magazine;
                var target = d["targetId"]?.Value<long>() ?? 0;
                if (State.Players.TryGetValue(target, out var p) && p.Position.HasValue)
                    world.Tracer(localPlayer.transform.position + Vector3.up * BBFConfig.EyeHeight,
                        p.Position.Value + Vector3.up * BBFConfig.BodyHeight,
                        d["blocked"]?.Value<bool>() == true ? Color.cyan : d["hit"]?.Value<bool>() == true ? Color.yellow : Color.gray);
            });

            n.On("damage-confirmed", d =>
            {
                if (d["alivePlayers"] != null) State.AlivePlayers = d["alivePlayers"].Value<int>();
                if (d["hit"]?.Value<bool>() == true)
                    State.AddFeed($"Hit {Name(d["targetId"].Value<long>())} for {d["damage"]}{(d["hitLocation"]?.ToString() == "head" ? " (head)" : "")}");
            });

            n.On("player-damaged", d =>
            {
                State.Health = d["health"]?.Value<float>() ?? State.Health;
                State.Armor = d["armor"]?.Value<float>() ?? State.Armor;
                State.AddFeed($"{Name(d["attackerId"].Value<long>())} hit you for {d["damage"]}");
            });

            n.On("player-knocked", d =>
            {
                var victim = d["victimId"].Value<long>();
                if (victim == ApiClient.PlayerId) { State.Knocked = true; State.KnockHealth = d["knockHealth"]?.Value<float>() ?? 100; }
                else State.Player(victim).Knocked = true;
                State.AddFeed($"{Name(d["attackerId"].Value<long>())} knocked {Name(victim)}");
            });

            n.On("bleeding", d => State.KnockHealth = d["knockHealth"].Value<float>());

            n.On("player-revived", d =>
            {
                var id = d["playerId"].Value<long>();
                if (id == ApiClient.PlayerId) { State.Knocked = false; State.Health = d["health"].Value<float>(); }
                else State.Player(id).Knocked = false;
                State.AddFeed($"{Name(d["reviverId"].Value<long>())} revived {Name(id)}");
            });

            n.On("player-eliminated", d =>
            {
                if (d["alivePlayers"] != null) State.AlivePlayers = d["alivePlayers"].Value<int>();
                var victim = d["victimId"].Value<long>();
                var attacker = d["attackerId"]?.Type == JTokenType.Integer ? d["attackerId"].Value<long>() : 0;
                State.AddFeed($"{(attacker != 0 ? Name(attacker) : d["cause"]?.ToString())} eliminated {Name(victim)}");

                if (attacker == ApiClient.PlayerId) State.Kills++;

                if (victim == ApiClient.PlayerId)
                {
                    State.Alive = false;
                    State.Knocked = false;
                    State.Phase = Phase.Dead;
                }
                else
                {
                    var p = State.Player(victim);
                    p.Alive = false;
                    p.Knocked = false;
                }
            });

            n.On("reload-started", _ => State.Reloading = true);
            n.On("reload-completed", d =>
            {
                State.Reloading = false;
                if (d["inventory"] is JObject inv) State.Inventory = inv;
                State.Magazine = d["combat"]?["weaponState"]?["magazineAmmo"]?.Value<int>() ?? State.Magazine;
            });

            n.On("gunshot-heard", d => world.Ping(MatchState.Vec(d["position"])));

            // ----- throwables -----
            n.On("grenade-thrown", d => world.AddGrenade((JObject)d["grenade"]));
            n.On("grenade-exploded", d => world.Explode(d));
            n.On("smoke-deployed", d => world.AddSmoke(d));
            n.On("smoke-cleared", d => world.RemoveSmoke(d["id"].ToString()));
            n.On("smoke-clouds-state", d => { foreach (var s in d["value"] ?? new JArray()) world.AddSmoke((JObject)s); });
            n.On("player-flashed", d => State.FlashedUntil = Time.time + d["durationMs"].Value<float>() / 1000f);
            n.On("gloo-wall-deployed", d => world.AddGlooWall(d));
            n.On("gloo-wall-damaged", d => { if (d["destroyed"]?.Value<bool>() == true) world.RemoveGlooWall(d["wallId"].ToString()); });
            n.On("gloo-walls-state", d => { foreach (var w in d["value"] ?? new JArray()) world.AddGlooWall((JObject)w); });

            // ----- healing & revive -----
            n.On("healing-started", d => { State.HealingItem = d["itemId"].ToString(); State.HealingEndsAt = Time.time + d["durationMs"].Value<float>() / 1000f; });
            n.On("healing-completed", d =>
            {
                State.HealingItem = null;
                State.Health = d["health"].Value<float>();
                if (d["inventory"] is JObject inv) State.Inventory = inv;
            });
            n.On("healing-cancelled", d => { State.HealingItem = null; State.AddFeed("Healing cancelled: " + d["reason"]); });
            n.On("healing-failed", _ => State.HealingItem = null);
            n.On("being-revived", d => State.AddFeed($"{Name(d["reviverId"].Value<long>())} is reviving you"));
            n.On("revive-cancelled", d => State.AddFeed("Revive cancelled: " + d["reason"]));

            // ----- zone & end -----
            n.On("zone-update", d => { State.Zone = d; State.ZoneReceivedAt = Time.time; });
            n.On("zone-damage", d => State.Health = d["health"].Value<float>());
            n.On("match-completed", d => { State.Results = d; State.Phase = Phase.Over; });
            n.On("progression-updated", d => State.Progression = d);
            n.On("spectate-started", d => State.Spectating = d["targetId"].Value<long>());
            n.On("player-reconnected", d => State.AddFeed(Name(d["playerId"].Value<long>()) + " reconnected"));
            n.On("player-disconnected", d => State.AddFeed(Name(d["playerId"].Value<long>()) + " disconnected"));
            n.On("left-match", _ => LeaveToLobby());

            n.On("game-error", d =>
            {
                var message = d["message"]?.ToString() ?? "";
                if (message.Contains("Magazine empty") && !State.Reloading) { net.Emit("reload-weapon"); return; }
                if (message.Contains("Aircraft drop has already started")) return;
                State.AddFeed(message);
            });
        }

        static void ReadCosmetics(PlayerInfo p, JToken cosmetics)
        {
            if (cosmetics == null || cosmetics.Type != JTokenType.Object) return;
            p.CharacterSkin = cosmetics["character"]?.ToString();
            p.ParachuteSkin = cosmetics["parachute"]?.ToString();
            p.WeaponSkin = cosmetics["weapon"]?.ToString();
        }

        // Named town the position is inside (e.g. "Fort Rudra"), or null.
        public JToken TownAt(Vector3 position)
        {
            if (State.Towns == null) return null;
            foreach (var t in State.Towns)
            {
                if (t["name"] == null || t["name"].Type == JTokenType.Null) continue;
                var c = t["center"];
                var dx = position.x - c["x"].Value<float>();
                var dz = position.z - c["z"].Value<float>();
                if (dx * dx + dz * dz <= Mathf.Pow(t["radius"].Value<float>(), 2)) return t;
            }
            return null;
        }

        void AddLoot(JToken item)
        {
            var info = new LootInfo
            {
                LootId = item["lootId"].ToString(),
                ItemType = item["itemType"]?.ToString(),
                ItemId = item["itemId"]?.ToString(),
                Name = item["name"]?.ToString(),
                Quantity = item["quantity"]?.Type == JTokenType.Integer ? item["quantity"].Value<int>() : 0,
                Position = MatchState.Vec(item["position"])
            };
            State.Loot[info.LootId] = info;
        }

        void StartGame()
        {
            if (!State.Alive) State.Phase = Phase.Dead;
            else if (State.Phase == Phase.Waiting || State.Phase == Phase.Lobby) State.Phase = Phase.Ground;

            foreach (var e in new[] { "get-drop-status", "get-inventory", "get-throwable-inventory", "get-zone-state", "get-gloo-walls", "get-smoke-clouds", "combat-state" })
                net.Emit(e);

            if (!aircraftRequested)
            {
                aircraftRequested = true;
                Invoke(nameof(RequestAircraft), 5f);
            }
        }

        void RequestAircraft()
        {
            if (State.Flight == null && State.Phase != Phase.Over) net.Emit("start-aircraft-drop");
        }

        // ---------------- per frame ----------------

        float nextLootPoll;

        void Update()
        {
            if (State.Phase == Phase.Ground && Time.time > nextLootPoll)
            {
                nextLootPoll = Time.time + 1f;
                net.Emit("get-nearby-loot");
            }

            SyncRemotePlayers();
            world.Sync(State);
        }

        void SyncRemotePlayers()
        {
            foreach (var p in State.Players.Values)
            {
                if (p.Id == ApiClient.PlayerId || !p.Position.HasValue) continue;

                if (!remotes.TryGetValue(p.Id, out var rp) || rp == null)
                {
                    rp = Instantiate(remotePlayerPrefab);
                    rp.Init(p.Id, p.Username);
                    remotes[p.Id] = rp;
                }

                rp.Apply(p, State.IsTeammate(p.Id));
            }
        }

        public RemotePlayer Remote(long id) => remotes.TryGetValue(id, out var r) ? r : null;
        public IEnumerable<RemotePlayer> Remotes => remotes.Values;
    }
}
