// INDIAN BATTLE FIELDS - Unity client
// Visuals driven by match state: loot, safe zone, smoke,
// gloo walls, grenades, aircraft, tracers and explosions.
// Every prefab is optional; simple shapes are used otherwise.

using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace BBF
{
    public class WorldViews : MonoBehaviour
    {
        [Header("Optional prefabs")]
        public GameObject lootPrefab;
        public GameObject aircraftPrefab;
        public GameObject smokePrefab;          // e.g. a particle system
        public GameObject glooWallPrefab;       // modelled as a 1x1x1 box
        public GameObject grenadePrefab;
        public GameObject explosionPrefab;      // e.g. a particle system

        [Header("Materials")]
        public Material zoneMaterial;           // transparent, double-sided
        public Material tracerMaterial;

        readonly Dictionary<string, GameObject> loot = new();
        readonly Dictionary<string, GameObject> smokes = new();
        readonly Dictionary<string, GameObject> walls = new();
        readonly Dictionary<string, (GameObject go, float explodesAt)> grenades = new();

        GameObject zoneWall;
        GameObject aircraft;

        // ---------------- per frame ----------------

        public void Sync(MatchState s)
        {
            SyncLoot(s);
            SyncZone(s);
            SyncAircraft(s);
        }

        void SyncLoot(MatchState s)
        {
            var stale = new List<string>();
            foreach (var id in loot.Keys) if (!s.Loot.ContainsKey(id)) stale.Add(id);
            foreach (var id in stale) { Destroy(loot[id]); loot.Remove(id); }

            foreach (var item in s.Loot.Values)
            {
                if (!loot.TryGetValue(item.LootId, out var go))
                {
                    go = lootPrefab ? Instantiate(lootPrefab) : GameObject.CreatePrimitive(PrimitiveType.Cube);
                    go.name = $"Loot {item.Name}";
                    if (!lootPrefab)
                    {
                        go.transform.localScale = Vector3.one * 0.6f;
                        Destroy(go.GetComponent<Collider>());
                        go.GetComponent<Renderer>().material.color = LootColor(item.ItemType);
                    }
                    loot[item.LootId] = go;
                }

                go.transform.position = item.Position + Vector3.up * (0.45f + Mathf.Sin(Time.time * 2f + item.Position.x) * 0.1f);
                go.transform.Rotate(0, 90f * Time.deltaTime, 0);
            }
        }

        static Color LootColor(string type) => type switch
        {
            "weapon" => new Color(0.95f, 0.65f, 0.25f),
            "ammunition" => new Color(0.8f, 0.7f, 0.35f),
            "helmet" or "vest" => new Color(0.3f, 0.7f, 1f),
            "throwable" => new Color(0.9f, 0.33f, 0.3f),
            "healing" => new Color(0.3f, 0.77f, 0.54f),
            "attachment" => new Color(0.7f, 0.55f, 0.68f),
            _ => Color.gray
        };

        void SyncZone(MatchState s)
        {
            if (s.Zone == null) return;

            if (!zoneWall)
            {
                zoneWall = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                zoneWall.name = "Safe Zone";
                Destroy(zoneWall.GetComponent<Collider>());
                if (zoneMaterial) zoneWall.GetComponent<Renderer>().sharedMaterial = zoneMaterial;
            }

            var current = s.Zone["current"];
            var center = current["center"];
            var radius = Mathf.Max(0.1f, current["radius"].Value<float>());

            // Unity cylinder: radius 0.5, height 2.
            zoneWall.transform.position = new Vector3(center["x"].Value<float>(), BBFConfig.GroundY + 300f, center["z"].Value<float>());
            zoneWall.transform.localScale = new Vector3(radius * 2f, 300f, radius * 2f);
        }

        void SyncAircraft(MatchState s)
        {
            var visible = AircraftPosition(out var position, out var yaw);

            if (visible && !aircraft)
            {
                aircraft = aircraftPrefab ? Instantiate(aircraftPrefab) : BuildPlaceholderAircraft();
            }

            if (aircraft)
            {
                aircraft.SetActive(visible);
                if (visible) aircraft.transform.SetPositionAndRotation(position, Quaternion.Euler(0, yaw, 0));
            }
        }

        GameObject BuildPlaceholderAircraft()
        {
            var root = new GameObject("Aircraft");
            var body = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            body.transform.SetParent(root.transform, false);
            body.transform.localRotation = Quaternion.Euler(90, 0, 0);
            body.transform.localScale = new Vector3(4, 13, 4);
            var wings = GameObject.CreatePrimitive(PrimitiveType.Cube);
            wings.transform.SetParent(root.transform, false);
            wings.transform.localScale = new Vector3(34, 0.5f, 5);
            foreach (var c in root.GetComponentsInChildren<Collider>()) Destroy(c);
            return root;
        }

        public bool AircraftPosition(out Vector3 position) => AircraftPosition(out position, out _);

        public bool AircraftPosition(out Vector3 position, out float yaw)
        {
            position = Vector3.zero;
            yaw = 0;

            var s = MatchManager.Instance.State;
            if (s.Flight == null) return false;

            var path = s.Flight["flightPath"];
            var duration = (s.Flight["flightDurationMs"]?.Value<float>() ?? 20000f) / 1000f;
            var t = (Time.time - s.FlightStartedAt) / duration;
            if (t > 1.05f) return false;

            var start = MatchState.Vec(path["start"]);
            var end = MatchState.Vec(path["end"]);
            position = Vector3.Lerp(start, end, Mathf.Clamp01(t));
            yaw = Quaternion.LookRotation(end - start).eulerAngles.y;
            return true;
        }

        // ---------------- events ----------------

        public void AddSmoke(JObject s)
        {
            var id = s["id"].ToString();
            if (smokes.ContainsKey(id)) return;

            var position = MatchState.Vec(s["position"]);
            var radius = s["radius"]?.Value<float>() ?? 8f;

            GameObject go;
            if (smokePrefab) go = Instantiate(smokePrefab, position, Quaternion.identity);
            else
            {
                go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                Destroy(go.GetComponent<Collider>());
                go.transform.position = position + Vector3.up * radius * 0.4f;
                go.transform.localScale = new Vector3(radius * 2f, radius * 1.2f, radius * 2f);
                go.GetComponent<Renderer>().material.color = new Color(0.85f, 0.86f, 0.88f);
            }
            smokes[id] = go;
        }

        public void RemoveSmoke(string id)
        {
            if (smokes.TryGetValue(id, out var go)) { Destroy(go); smokes.Remove(id); }
        }

        public void AddGlooWall(JObject w)
        {
            var id = w["id"].ToString();
            if (walls.ContainsKey(id)) return;

            var size = w["size"];
            var width = size?["width"]?.Value<float>() ?? 4f;
            var height = size?["height"]?.Value<float>() ?? 3f;
            var thickness = size?["thickness"]?.Value<float>() ?? 0.5f;
            var position = MatchState.Vec(w["position"]);

            var go = glooWallPrefab ? Instantiate(glooWallPrefab) : GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = "Gloo Wall";
            go.transform.SetPositionAndRotation(
                position + Vector3.up * height / 2f,
                Quaternion.Euler(0, w["facing"]?.Value<float>() ?? 0f, 0));
            go.transform.localScale = new Vector3(width, height, thickness);
            if (!glooWallPrefab) go.GetComponent<Renderer>().material.color = new Color(0.62f, 0.86f, 1f);
            walls[id] = go;
        }

        public void RemoveGlooWall(string id)
        {
            if (walls.TryGetValue(id, out var go)) { Destroy(go); walls.Remove(id); }
        }

        public void AddGrenade(JObject g)
        {
            var go = grenadePrefab ? Instantiate(grenadePrefab) : GameObject.CreatePrimitive(PrimitiveType.Sphere);
            if (!grenadePrefab)
            {
                Destroy(go.GetComponent<Collider>());
                go.transform.localScale = Vector3.one * 0.3f;
                go.GetComponent<Renderer>().material.color = new Color(0.25f, 0.3f, 0.18f);
            }
            go.transform.position = MatchState.Vec(g["position"]) + Vector3.up * 0.15f;
            grenades[g["id"].ToString()] = (go, Time.time + 5f);
        }

        public void Explode(JObject ex)
        {
            if (grenades.TryGetValue(ex["grenadeId"].ToString(), out var g))
            {
                Destroy(g.go);
                grenades.Remove(ex["grenadeId"].ToString());
            }

            var position = MatchState.Vec(ex["position"]);
            if (explosionPrefab) Destroy(Instantiate(explosionPrefab, position, Quaternion.identity), 4f);
            else
            {
                var sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                Destroy(sphere.GetComponent<Collider>());
                sphere.transform.position = position;
                sphere.transform.localScale = Vector3.one * (ex["type"]?.ToString() == "frag" ? 4f : 2f);
                sphere.GetComponent<Renderer>().material.color = ex["type"]?.ToString() == "frag" ? new Color(1f, 0.5f, 0.1f) : Color.white;
                Destroy(sphere, 0.35f);
            }
        }

        public void Tracer(Vector3 from, Vector3 to, Color color)
        {
            var go = new GameObject("Tracer");
            var line = go.AddComponent<LineRenderer>();
            line.positionCount = 2;
            line.SetPosition(0, from);
            line.SetPosition(1, to);
            line.startWidth = line.endWidth = 0.04f;
            if (tracerMaterial) line.sharedMaterial = tracerMaterial;
            line.startColor = line.endColor = color;
            Destroy(go, 0.08f);
        }

        public void Ping(Vector3 position)
        {
            // Hook for a gunshot indicator on the HUD/minimap.
            Debug.DrawLine(position, position + Vector3.up * 30f, Color.yellow, 0.7f);
        }

        public void Clear()
        {
            foreach (var go in loot.Values) if (go) Destroy(go);
            foreach (var go in smokes.Values) if (go) Destroy(go);
            foreach (var go in walls.Values) if (go) Destroy(go);
            foreach (var g in grenades.Values) if (g.go) Destroy(g.go);
            loot.Clear(); smokes.Clear(); walls.Clear(); grenades.Clear();
            if (zoneWall) Destroy(zoneWall);
            if (aircraft) Destroy(aircraft);
        }
    }
}
