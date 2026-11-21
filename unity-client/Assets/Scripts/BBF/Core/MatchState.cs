// INDIAN BATTLE FIELDS - Unity client
// What this client knows about the current match.

using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace BBF
{
    public enum Phase { Lobby, Waiting, Ground, Aircraft, Dropping, Dead, Over }

    public class PlayerInfo
    {
        public long Id;
        public string Username;
        public int? Team;
        public bool Alive = true;
        public bool Knocked;
        public bool Hidden;
        public Vector3? Position;
        public float SeenAt;

        // Equipped cosmetics (ids from the cosmetics store).
        public string CharacterSkin, ParachuteSkin, WeaponSkin;
    }

    public class LootInfo
    {
        public string LootId;
        public string ItemType;
        public string ItemId;
        public string Name;
        public int Quantity;
        public Vector3 Position;
    }

    public class MatchState
    {
        public string MatchId;
        public string MatchCode;
        public string GameMode;
        public string ServerUrl;
        public string MatchStatus;
        public Phase Phase = Phase.Lobby;

        // Self
        public Vector3? Position;
        public int? Team;
        public float Health = 100, Armor, KnockHealth;
        public bool Alive = true, Knocked, Parachute, Jumped;
        public int Kills;
        public float FlashedUntil;
        public long? Spectating;

        // Inventory
        public JObject Inventory;
        public JObject Throwables;
        public string ActiveWeapon;
        public int? Magazine;
        public bool Reloading;
        public string HealingItem;
        public float HealingEndsAt;

        // World
        public readonly Dictionary<long, PlayerInfo> Players = new();
        public readonly Dictionary<string, LootInfo> Loot = new();
        public JObject Zone;
        public float ZoneReceivedAt;
        public JObject Flight;
        public float FlightStartedAt;
        public int? AlivePlayers;
        public readonly List<string> Feed = new();
        public JObject Results;
        public JObject Progression;

        // Map: catalog info (name, subtitle, region, environment)
        // and named towns (Fort Rudra, Raj Fort, ...).
        public JObject MapInfo;
        public JArray Towns;

        public PlayerInfo Player(long id)
        {
            if (!Players.TryGetValue(id, out var p))
            {
                p = new PlayerInfo { Id = id };
                Players[id] = p;
            }
            return p;
        }

        public bool IsTeammate(long id)
        {
            if (GameMode == "solo" || Team == null) return false;
            return Players.TryGetValue(id, out var p) && p.Team == Team;
        }

        public void AddFeed(string text)
        {
            Feed.Insert(0, text);
            if (Feed.Count > 10) Feed.RemoveAt(Feed.Count - 1);
        }

        public static Vector3 Vec(JToken t) =>
            t == null || t.Type == JTokenType.Null
                ? Vector3.zero
                : new Vector3(t["x"]?.Value<float>() ?? 0, t["y"]?.Value<float>() ?? 0, t["z"]?.Value<float>() ?? 0);

        public static object Dto(Vector3 v) => new { x = v.x, y = v.y, z = v.z };
    }
}
