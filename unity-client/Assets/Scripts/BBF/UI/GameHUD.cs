// INDIAN BATTLE FIELDS - Unity client
// Login, lobby and in-game HUD using Unity's immediate-mode
// GUI, so the game works without building any UI first.
// Replace with your own designed UI (uGUI / UI Toolkit) later;
// all data comes from MatchManager.Instance.State.

using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace BBF
{
    public class GameHUD : MonoBehaviour
    {
        public string serverUrl = "http://localhost:5000";
        public Texture2D crosshair;
        public CombatController combat;

        string email = "player_one@example.com", password = "", username = "";
        string roomCode = "";
        string message = "";

        // The 12 maps from GET /api/maps.
        JArray maps;
        int selectedMap, roomMode;
        bool mapsRequested;
        Vector2 mapScroll;
        bool busy, signUp;

        MatchManager M => MatchManager.Instance;
        MatchState S => M.State;

        void Awake() => BBFConfig.ServerUrl = serverUrl;

        void OnGUI()
        {
            GUI.skin.label.fontSize = 14;
            GUI.skin.button.fontSize = 14;

            if (string.IsNullOrEmpty(ApiClient.AccessToken)) { LoginWindow(); return; }

            switch (S.Phase)
            {
                case Phase.Lobby: Lobby(); break;
                case Phase.Waiting: Waiting(); break;
                default: InGame(); break;
            }
        }

        // ---------------- login ----------------

        void LoginWindow()
        {
            GUILayout.BeginArea(new Rect(Screen.width / 2 - 170, Screen.height / 2 - 140, 340, 300), GUI.skin.box);
            GUILayout.Label("<b>INDIAN BATTLE FIELDS</b>", Rich(20));
            signUp = GUILayout.Toolbar(signUp ? 1 : 0, new[] { "Log in", "Sign up" }) == 1;

            if (signUp) { GUILayout.Label("Username"); username = GUILayout.TextField(username); }
            GUILayout.Label("Email");
            email = GUILayout.TextField(email);
            GUILayout.Label("Password");
            password = GUILayout.PasswordField(password, '*');

            GUI.enabled = !busy;
            if (GUILayout.Button(signUp ? "Create account" : "Log in", GUILayout.Height(32))) _ = Login();
            GUI.enabled = true;

            GUILayout.Label(message);
            GUILayout.EndArea();
        }

        async System.Threading.Tasks.Task Login()
        {
            busy = true;
            message = "…";

            if (signUp)
            {
                var reg = await ApiClient.Register(username, email, password);
                if (!reg.Ok) { message = reg.Message; busy = false; return; }
            }

            var r = await ApiClient.Login(email, password);
            message = r.Ok ? "" : r.Message;
            busy = false;
        }

        // ---------------- lobby ----------------

        void Lobby()
        {
            if (!mapsRequested) { mapsRequested = true; _ = LoadMaps(); }

            GUILayout.BeginArea(new Rect(Screen.width / 2 - 260, Screen.height / 2 - 270, 520, 540), GUI.skin.box);
            GUILayout.Label($"<b>Welcome, {ApiClient.Username}</b>", Rich(18));
            GUILayout.Label("Quick match");

            GUI.enabled = !busy;
            GUILayout.BeginHorizontal();
            foreach (var mode in new[] { "solo", "duo", "squad" })
                if (GUILayout.Button(mode.ToUpper(), GUILayout.Height(34))) _ = Enter(ApiClient.QuickJoin(mode));
            GUILayout.EndHorizontal();

            GUILayout.Space(10);
            GUILayout.Label("Join a room by code");
            GUILayout.BeginHorizontal();
            roomCode = GUILayout.TextField(roomCode, GUILayout.Width(220));
            if (GUILayout.Button("Join")) _ = Enter(ApiClient.JoinByCode(roomCode.Trim().ToUpper()));
            GUILayout.EndHorizontal();

            MapPicker();
            GUI.enabled = true;

            GUILayout.Label(M.LobbyMessage);
            GUILayout.EndArea();
        }

        async System.Threading.Tasks.Task LoadMaps()
        {
            var r = await ApiClient.GetMaps();
            if (r.Ok) maps = r.Json["maps"] as JArray;
        }

        // Create a private room on one of the 12 maps.
        void MapPicker()
        {
            GUILayout.Space(10);
            GUILayout.Label("<b>Create a room</b>", Rich(15));

            if (maps == null || maps.Count == 0) { GUILayout.Label("Loading maps…"); return; }

            mapScroll = GUILayout.BeginScrollView(mapScroll, GUILayout.Height(150));
            for (int i = 0; i < maps.Count; i += 3)
            {
                GUILayout.BeginHorizontal();
                for (int j = i; j < Mathf.Min(i + 3, maps.Count); j++)
                {
                    var label = (j == selectedMap ? "> " : "") + maps[j]["map_name"];
                    if (GUILayout.Button(label, GUILayout.Width(158))) selectedMap = j;
                }
                GUILayout.EndHorizontal();
            }
            GUILayout.EndScrollView();

            var map = maps[Mathf.Clamp(selectedMap, 0, maps.Count - 1)];
            GUILayout.Label($"<b>{map["map_name"]}</b> — {map["subtitle"]}\n<size=12>{map["region"]} · {map["environment"]}</size>", Rich(14));

            GUILayout.BeginHorizontal();
            roomMode = GUILayout.Toolbar(roomMode, new[] { "Solo", "Duo", "Squad" });
            if (GUILayout.Button("Create room", GUILayout.Width(130)))
                _ = Enter(ApiClient.CreateRoom(map["map_name"].ToString(), new[] { "solo", "duo", "squad" }[roomMode]));
            GUILayout.EndHorizontal();
        }

        async System.Threading.Tasks.Task Enter(System.Threading.Tasks.Task<ApiResult> request)
        {
            busy = true;
            M.LobbyMessage = "Finding a match…";
            await M.EnterMatch(await request);
            busy = false;
        }

        void Waiting()
        {
            GUILayout.BeginArea(new Rect(Screen.width / 2 - 200, Screen.height / 2 - 100, 400, 200), GUI.skin.box);
            GUILayout.Label("<b>Waiting for the match</b>", Rich(18));
            GUILayout.Label($"Room {S.MatchCode} · {S.GameMode}");
            if (S.MapInfo != null)
                GUILayout.Label($"<b>{S.MapInfo["name"]}</b> — {S.MapInfo["subtitle"]} ({S.MapInfo["region"]})", Rich(14));
            GUILayout.Label($"{S.Players.Count} player(s) · {M.LobbyMessage}");
            if (GUILayout.Button("Start match (room host)")) _ = ApiClient.StartMatch(S.MatchId);
            if (GUILayout.Button("Leave")) { _ = ApiClient.LeaveMatch(S.MatchId); M.LeaveToLobby(); }
            GUILayout.EndArea();
        }

        // ---------------- in game ----------------

        void InGame()
        {
            // Crosshair (red when on an enemy).
            if (S.Phase == Phase.Ground)
            {
                var onTarget = combat != null && combat.FindAimTarget().HasValue;
                var size = 22f;
                var rect = new Rect(Screen.width / 2 - size / 2, Screen.height / 2 - size / 2, size, size);
                var old = GUI.color;
                GUI.color = onTarget ? Color.red : Color.white;
                if (crosshair) GUI.DrawTexture(rect, crosshair);
                else GUI.Label(rect, "+", Rich(22));
                GUI.color = old;
            }

            // Flash blindness.
            if (Time.time < S.FlashedUntil)
            {
                var old = GUI.color;
                GUI.color = new Color(1, 1, 1, Mathf.Clamp01((S.FlashedUntil - Time.time) / 1.5f));
                GUI.DrawTexture(new Rect(0, 0, Screen.width, Screen.height), Texture2D.whiteTexture);
                GUI.color = old;
            }

            // Top: phase, zone, alive.
            GUI.Label(new Rect(Screen.width / 2 - 300, 10, 600, 24), $"<b>{PhaseText()}</b>   {ZoneText()}   {S.AlivePlayers?.ToString() ?? "-"} alive · {S.Kills} kills", Rich(15, TextAnchor.UpperCenter));

            // Map and the named location you are in (Fort Rudra...).
            var mapLine = S.MapInfo != null ? $"{S.MapInfo["name"].ToString().ToUpper()} · {S.MapInfo["subtitle"]}" : "";
            var town = M.localPlayer ? M.TownAt(M.localPlayer.transform.position) : null;
            if (town != null)
                mapLine += $"   @ <b>{town["name"]}</b>{(town["hotDrop"]?.Value<bool>() == true ? " · hot drop" : "")} · {town["lootTier"]} loot";
            GUI.Label(new Rect(Screen.width / 2 - 300, 34, 600, 22), mapLine, Rich(13, TextAnchor.UpperCenter));

            // Your character (equipped skin).
            S.Players.TryGetValue(ApiClient.PlayerId, out var me);
            GUI.Label(new Rect(14, Screen.height - 120, 300, 22), $"<b>{ApiClient.Username}</b> · {Cosmetics.Character(me?.CharacterSkin).Name}", Rich(13));

            // Bottom left: health / armor / status.
            var hp = S.Knocked ? S.KnockHealth : S.Health;
            Bar(new Rect(14, Screen.height - 70, 240, 20), hp / 100f, S.Knocked ? new Color(0.95f, 0.65f, 0.25f) : new Color(0.3f, 0.77f, 0.54f), S.Knocked ? $"Knocked {hp:0}" : $"Health {hp:0}");
            Bar(new Rect(14, Screen.height - 44, 240, 20), S.Armor / 100f, new Color(0.3f, 0.7f, 1f), $"Armor {S.Armor:0}");
            if (S.HealingItem != null)
                GUI.Label(new Rect(14, Screen.height - 96, 240, 22), $"Healing… {Mathf.Max(0, S.HealingEndsAt - Time.time):0.0}s");

            // Bottom right: weapons, ammo, items.
            GUI.Label(new Rect(Screen.width - 420, Screen.height - 96, 406, 86), WeaponText(), Rich(15, TextAnchor.LowerRight));

            // Kill feed.
            GUI.Label(new Rect(Screen.width - 360, 40, 346, 220), string.Join("\n", S.Feed), Rich(13, TextAnchor.UpperRight));

            if (S.Phase == Phase.Dead) DeadWindow();
            if (S.Phase == Phase.Over) ResultsWindow();
        }

        string PhaseText() => S.Phase switch
        {
            Phase.Aircraft => "In the aircraft — SPACE to jump",
            Phase.Dropping => S.Parachute ? "Parachuting" : "Free fall",
            Phase.Ground => "On the ground",
            Phase.Dead => "Eliminated",
            Phase.Over => "Match over",
            _ => ""
        };

        string ZoneText()
        {
            var z = S.Zone;
            if (z == null) return "Zone —";
            if (z["shrinkStartsAt"]?.Type != JTokenType.Integer && z["shrinkStartsAt"]?.Type != JTokenType.Float)
                return $"Zone {z["phase"]}/{z["totalPhases"]} final";

            var serverNow = z["serverTime"].Value<double>() + (Time.time - S.ZoneReceivedAt) * 1000.0;
            var toShrink = (z["shrinkStartsAt"].Value<double>() - serverNow) / 1000.0;
            return toShrink > 0
                ? $"Zone {z["phase"]}/{z["totalPhases"]}: shrinks in {toShrink:0}s"
                : $"Zone {z["phase"]}/{z["totalPhases"]}: shrinking";
        }

        string WeaponText()
        {
            var weapons = S.Inventory?["weapons"] as JArray;
            var slots = weapons == null || weapons.Count == 0
                ? "No weapon"
                : string.Join("  ", weapons.Select((w, i) =>
                    (w["weaponId"].ToString() == S.ActiveWeapon ? "<b><color=#f2a541>" : "") + $"{i + 1} {w["name"]}" +
                    (w["weaponId"].ToString() == S.ActiveWeapon ? "</color></b>" : "")));

            var active = weapons?.FirstOrDefault(w => w["weaponId"].ToString() == S.ActiveWeapon);
            var reserve = active != null ? S.Inventory["ammunition"]?[active["ammoType"]?.ToString() ?? ""]?.Value<int>() ?? 0 : 0;
            var ammo = active == null ? "" : S.Reloading ? "Reloading…" : $"<size=22><b>{S.Magazine}</b></size> / {reserve}";

            var t = S.Throwables;
            var h = S.Inventory?["healing"];
            var items = $"Frag {t?["frag"] ?? 0} · Smoke {t?["smoke"] ?? 0} · Flash {t?["flash"] ?? 0} · Gloo {t?["gloo"] ?? 0} · Bandage {h?["bandage"] ?? 0} · Medkit {h?["medkit"] ?? 0}";

            return $"{slots}\n{ammo}\n<size=12>{items}</size>";
        }

        void DeadWindow()
        {
            GUILayout.BeginArea(new Rect(Screen.width / 2 - 170, Screen.height / 2 - 90, 340, 180), GUI.skin.box);
            GUILayout.Label("<b>You were eliminated</b>", Rich(18));
            GUILayout.Label("Spectate:");
            foreach (var p in S.Players.Values.Where(p => p.Alive && p.Id != ApiClient.PlayerId).Take(6))
                if (GUILayout.Button(p.Username ?? "#" + p.Id)) M.Emit("spectate-player", new { targetId = p.Id });
            if (GUILayout.Button("Back to lobby")) M.LeaveToLobby();
            GUILayout.EndArea();
        }

        void ResultsWindow()
        {
            var results = S.Results?["results"] as JArray;
            GUILayout.BeginArea(new Rect(Screen.width / 2 - 220, Screen.height / 2 - 170, 440, 340), GUI.skin.box);

            var won = S.Results?["winnerPlayerId"]?.Type == JTokenType.Integer && S.Results["winnerPlayerId"].Value<long>() == ApiClient.PlayerId;
            GUILayout.Label(won ? "<b><color=#f2a541>WINNER</color></b>" : "<b>Match over</b>", Rich(22));

            if (results != null)
                foreach (var r in results.OrderBy(r => r["placement"]?.Value<int>() ?? 999).Take(10))
                    GUILayout.Label($"#{r["placement"]}  {r["username"]}  ·  {r["kills"]} kills  ·  +{r["xpEarned"]} XP");

            if (S.Progression != null)
                GUILayout.Label($"Level {S.Progression["level"]} · +{S.Progression["coinsEarned"]} coins");

            if (GUILayout.Button("Back to lobby", GUILayout.Height(30))) M.LeaveToLobby();
            GUILayout.EndArea();
        }

        // ---------------- helpers ----------------

        static void Bar(Rect r, float fill, Color color, string text)
        {
            var old = GUI.color;
            GUI.color = new Color(0, 0, 0, 0.6f);
            GUI.DrawTexture(r, Texture2D.whiteTexture);
            GUI.color = color;
            GUI.DrawTexture(new Rect(r.x, r.y, r.width * Mathf.Clamp01(fill), r.height), Texture2D.whiteTexture);
            GUI.color = old;
            GUI.Label(new Rect(r.x + 6, r.y + 1, r.width, r.height), text);
        }

        static GUIStyle Rich(int size, TextAnchor anchor = TextAnchor.UpperLeft) =>
            new(GUI.skin.label) { richText = true, fontSize = size, alignment = anchor, wordWrap = true };
    }
}
