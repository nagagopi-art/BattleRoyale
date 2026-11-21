// INDIAN BATTLE FIELDS - Unity client
// Builds the map from GET /api/matches/:id/layout.
// Every obstacle is an axis-aligned box the server collides
// with; each gets a BoxCollider of exactly that size, so the
// local player is stopped by the same walls as on the server.
// Assign art prefabs per kind (or leave empty for grey boxes).

using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace BBF
{
    public class MapBuilder : MonoBehaviour
    {
        [Header("Optional art prefabs (scaled to each box)")]
        public GameObject houseWallPrefab;
        public GameObject roofPrefab;
        public GameObject wallPrefab;
        public GameObject rockPrefab;
        public GameObject cratePrefab;

        [Header("Fallback materials for plain boxes")]
        public Material houseMaterial;
        public Material roofMaterial;
        public Material rockMaterial;
        public Material crateMaterial;

        [Header("Ground")]
        public Material groundMaterial;
        public bool createGround = true;

        [Header("Sun (a Directional Light in the scene)")]
        public Light sun;

        public string BuiltMap { get; private set; }
        public MapTheme Theme { get; private set; }

        // Sky, fog and sunlight for the map's environment.
        void ApplyTheme(MapTheme theme)
        {
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogColor = theme.Fog;
            RenderSettings.fogDensity = theme.FogDensity;
            RenderSettings.ambientLight = Color.Lerp(theme.Sky, Color.gray, 0.4f);

            if (Camera.main != null && Camera.main.clearFlags == CameraClearFlags.SolidColor)
                Camera.main.backgroundColor = theme.Sky;

            if (sun == null) sun = RenderSettings.sun;
            if (sun != null)
            {
                sun.color = theme.SunColor;
                sun.intensity = theme.SunIntensity;
                sun.transform.rotation = Quaternion.Euler(theme.SunPitch, -35f, 0);
            }
        }

        // Plain boxes (no art prefab / material) use theme colours.
        void TintByTheme(GameObject go, string kind)
        {
            if (Theme == null) return;
            var r = go.GetComponent<Renderer>();
            if (r == null) return;

            var color = kind switch
            {
                "roof" => Theme.Roof,
                "rock" => Theme.Rock,
                "crate" => Color.Lerp(Theme.Building, new Color(0.45f, 0.32f, 0.2f), 0.6f),
                "wall" => Color.Lerp(Theme.Building, Theme.Rock, 0.5f),
                _ => Theme.Building
            };

            var m = r.material;
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", color);
            if (m.HasProperty("_Color")) m.SetColor("_Color", color);
        }

        readonly List<GameObject> spawned = new();

        public void Build(JObject layout)
        {
            if (layout == null) return;

            var mapName = layout["mapName"]?.ToString() + ":" + layout["version"];
            if (mapName == BuiltMap) return;   // already built

            Clear();
            BuiltMap = mapName;

            var root = new GameObject("Map " + layout["mapName"]);
            root.transform.SetParent(transform, false);
            spawned.Add(root);

            // Look of this map's environment (forest, desert, snow...).
            Theme = MapThemes.For(layout["map"]?["environment"]?.ToString());
            ApplyTheme(Theme);

            if (createGround) BuildGround(root.transform, layout["worldHalf"]?.Value<float>() ?? 1000f);

            foreach (var o in layout["obstacles"])
            {
                var min = MatchState.Vec(o["min"]);
                var max = MatchState.Vec(o["max"]);
                var kind = o["kind"]?.ToString();

                var center = (min + max) / 2f;
                var size = max - min;

                var go = CreateVisual(kind, root.transform);
                go.name = o["id"]?.ToString();
                go.transform.position = center;
                go.transform.localScale = size;
                go.isStatic = true;

                // Exact server collision shape.
                var col = go.GetComponent<BoxCollider>() ?? go.AddComponent<BoxCollider>();
                col.center = Vector3.zero;
                col.size = Vector3.one;
            }
        }

        GameObject CreateVisual(string kind, Transform parent)
        {
            GameObject prefab = kind switch
            {
                "house-wall" => houseWallPrefab,
                "roof" => roofPrefab,
                "wall" => wallPrefab,
                "rock" => rockPrefab,
                "crate" => cratePrefab,
                _ => null
            };

            if (prefab != null)
            {
                // Prefabs should be modelled as a 1x1x1 box centred on
                // the origin so scaling fits the server box exactly.
                var instance = Instantiate(prefab, parent);
                foreach (var c in instance.GetComponentsInChildren<Collider>()) Destroy(c);
                return instance;
            }

            var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube.transform.SetParent(parent, false);
            var r = cube.GetComponent<Renderer>();
            var mat = kind switch
            {
                "roof" => roofMaterial,
                "rock" => rockMaterial,
                "crate" => crateMaterial,
                _ => houseMaterial
            };
            if (mat != null) r.sharedMaterial = mat;
            else TintByTheme(cube, kind);
            return cube;
        }

        void BuildGround(Transform parent, float half)
        {
            var ground = GameObject.CreatePrimitive(PrimitiveType.Plane);
            ground.name = "Ground";
            ground.transform.SetParent(parent, false);
            // A Unity plane is 10x10 units.
            ground.transform.position = new Vector3(0, BBFConfig.GroundY, 0);
            ground.transform.localScale = new Vector3(half * 2.6f / 10f, 1, half * 2.6f / 10f);
            var groundRenderer = ground.GetComponent<Renderer>();
            if (groundMaterial != null) groundRenderer.sharedMaterial = groundMaterial;
            else if (Theme != null)
            {
                var m = groundRenderer.material;
                if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", Theme.Ground);
                if (m.HasProperty("_Color")) m.SetColor("_Color", Theme.Ground);
            }
        }

        public void Clear()
        {
            foreach (var go in spawned) if (go) Destroy(go);
            spawned.Clear();
            BuiltMap = null;
        }
    }
}
