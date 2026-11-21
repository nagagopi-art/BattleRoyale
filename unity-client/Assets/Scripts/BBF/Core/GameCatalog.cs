// INDIAN BATTLE FIELDS - Unity client
// Names and looks for this game's own content:
//  - map environments (from database/maps.sql "environment")
//  - character skins, parachutes and weapon finishes
//    (from database/migrations/003_cosmetics.sql)
// Colours are the placeholder look; give each entry a real
// model or material in SkinApplier / MapBuilder when ready.

using System.Collections.Generic;
using UnityEngine;

namespace BBF
{
    // ---------------- maps ----------------

    public class MapTheme
    {
        public string Environment;
        public Color Sky, Fog, Ground, Rock, Building, Roof, SunColor;
        public float FogDensity, SunIntensity, SunPitch;
    }

    public static class MapThemes
    {
        static Color C(string hex) => ColorUtility.TryParseHtmlString(hex, out var c) ? c : Color.magenta;

        static readonly Dictionary<string, MapTheme> themes = new()
        {
            ["Tropical Forest"] = new MapTheme { Sky = C("#9fc8e0"), Fog = C("#a8c9b8"), Ground = C("#4f7d3a"), Rock = C("#6f7466"), Building = C("#b89a74"), Roof = C("#8b4a32"), SunColor = C("#fff1d6"), FogDensity = 0.0018f, SunIntensity = 1.2f, SunPitch = 50 },
            ["Desert"] = new MapTheme { Sky = C("#e9d3a6"), Fog = C("#e6cfa0"), Ground = C("#d2b27a"), Rock = C("#a9875a"), Building = C("#d9b98a"), Roof = C("#b3753c"), SunColor = C("#ffe2b0"), FogDensity = 0.0012f, SunIntensity = 1.6f, SunPitch = 65 },
            ["Mangrove"] = new MapTheme { Sky = C("#a7c2c4"), Fog = C("#9fb8ad"), Ground = C("#4b6b45"), Rock = C("#5d655a"), Building = C("#9a8c74"), Roof = C("#5d4636"), SunColor = C("#f3ead2"), FogDensity = 0.0028f, SunIntensity = 1.0f, SunPitch = 40 },
            ["Snow"] = new MapTheme { Sky = C("#cfdbe8"), Fog = C("#dfe7ef"), Ground = C("#eef3f7"), Rock = C("#8d96a0"), Building = C("#a8835f"), Roof = C("#5f6f7f"), SunColor = C("#f4f8ff"), FogDensity = 0.0024f, SunIntensity = 1.3f, SunPitch = 30 },
            ["Island"] = new MapTheme { Sky = C("#8fd0ef"), Fog = C("#b7e1ef"), Ground = C("#5e9c48"), Rock = C("#7d7a70"), Building = C("#e8d7b9"), Roof = C("#c2553b"), SunColor = C("#fff4dc"), FogDensity = 0.0010f, SunIntensity = 1.5f, SunPitch = 60 },
            ["Urban"] = new MapTheme { Sky = C("#b8c4cf"), Fog = C("#b9bfc5"), Ground = C("#6d6f6b"), Rock = C("#7a7a78"), Building = C("#c9c2b6"), Roof = C("#5c5f63"), SunColor = C("#fff0dc"), FogDensity = 0.0020f, SunIntensity = 1.25f, SunPitch = 45 },
            ["Urban Coastal"] = new MapTheme { Sky = C("#9fb3c2"), Fog = C("#a9b6bf"), Ground = C("#6a6e68"), Rock = C("#787a78"), Building = C("#d6cdbd"), Roof = C("#4f5a63"), SunColor = C("#e9eef5"), FogDensity = 0.0030f, SunIntensity = 0.95f, SunPitch = 35 },
            ["Salt Desert"] = new MapTheme { Sky = C("#dfe8ef"), Fog = C("#eef2f4"), Ground = C("#ece9e1"), Rock = C("#b6b0a4"), Building = C("#d8cbb3"), Roof = C("#9a7b5a"), SunColor = C("#ffffff"), FogDensity = 0.0010f, SunIntensity = 1.7f, SunPitch = 70 },
            ["Backwaters"] = new MapTheme { Sky = C("#a9cfd7"), Fog = C("#b3d1c8"), Ground = C("#3f7d3c"), Rock = C("#6a6f62"), Building = C("#e0c9a0"), Roof = C("#a3462f"), SunColor = C("#fff3da"), FogDensity = 0.0022f, SunIntensity = 1.2f, SunPitch = 45 }
        };

        public static MapTheme For(string environment)
        {
            if (environment != null && themes.TryGetValue(environment, out var theme))
            {
                theme.Environment = environment;
                return theme;
            }
            var fallback = themes["Tropical Forest"];
            fallback.Environment = environment ?? "Tropical Forest";
            return fallback;
        }
    }

    // ---------------- cosmetics ----------------

    public class Skin
    {
        public string Id, Name;
        public Color Primary, Secondary;
        public bool Glow;
    }

    public static class Cosmetics
    {
        static Color C(string hex) => ColorUtility.TryParseHtmlString(hex, out var c) ? c : Color.magenta;

        // Character outfits (slot "character").
        public static readonly Skin DefaultCharacter = new() { Id = "default", Name = "Recruit", Primary = C("#5b6b3a"), Secondary = C("#3b3f36") };

        static readonly Dictionary<string, Skin> skins = new()
        {
            ["char_monsoon_ranger"] = new Skin { Id = "char_monsoon_ranger", Name = "Monsoon Ranger", Primary = C("#1f6f6b"), Secondary = C("#173a3f") },
            ["char_desert_falcon"] = new Skin { Id = "char_desert_falcon", Name = "Desert Falcon", Primary = C("#d8b47a"), Secondary = C("#f39c34") },
            ["char_himalayan_sentinel"] = new Skin { Id = "char_himalayan_sentinel", Name = "Himalayan Sentinel", Primary = C("#e9eef2"), Secondary = C("#7d8b99") },

            // Parachutes (slot "parachute").
            ["chute_peacock"] = new Skin { Id = "chute_peacock", Name = "Peacock Canopy", Primary = C("#1aa39a"), Secondary = C("#2a6fdb") },
            ["chute_lotus"] = new Skin { Id = "chute_lotus", Name = "Lotus Bloom", Primary = C("#f28cb2"), Secondary = C("#fbe3ec") },

            // Weapon finishes (slot "weapon").
            ["weapon_brass_inlay"] = new Skin { Id = "weapon_brass_inlay", Name = "Brass Inlay", Primary = C("#b08d57"), Secondary = C("#3a2f22") },
            ["weapon_midnight_indigo"] = new Skin { Id = "weapon_midnight_indigo", Name = "Midnight Indigo", Primary = C("#2e2a6b"), Secondary = C("#15132e") },
            ["weapon_sunfire"] = new Skin { Id = "weapon_sunfire", Name = "Sunfire", Primary = C("#f2a541"), Secondary = C("#c4471f"), Glow = true }
        };

        public static readonly Skin DefaultParachute = new() { Id = "default", Name = "Standard", Primary = C("#f2a541"), Secondary = C("#ffffff") };
        public static readonly Skin DefaultWeapon = new() { Id = "default", Name = "Factory", Primary = C("#2b2f33"), Secondary = C("#1a1c1f") };

        public static Skin Character(string id) => id != null && skins.TryGetValue(id, out var s) ? s : DefaultCharacter;
        public static Skin Parachute(string id) => id != null && skins.TryGetValue(id, out var s) ? s : DefaultParachute;
        public static Skin Weapon(string id) => id != null && skins.TryGetValue(id, out var s) ? s : DefaultWeapon;
    }
}
