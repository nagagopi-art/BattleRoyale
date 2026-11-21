// INDIAN BATTLE FIELDS - Unity client
// Shooting, reloading, weapons, throwables, healing, revive,
// looting. Put on the local player next to
// LocalPlayerController.
//
// Shots: the crosshair ray must hit a remote player's HitZone;
// the shot is sent toward the server's hitbox height for that
// zone, so what you aim at is what the server checks.

using System.Linq;
using UnityEngine;

namespace BBF
{
    public class CombatController : MonoBehaviour
    {
        public ThirdPersonCamera cameraRig;
        public float fireInterval = 0.1f;        // client cap; server enforces weapon fire rate
        public float aimAssistDegrees = 1.2f;
        public LayerMask aimMask = ~0;

        float nextFire;

        MatchState S => MatchManager.Instance.State;
        void Emit(string e, object payload = null) => MatchManager.Instance.Emit(e, payload);

        void Update()
        {
            if (S.Phase != Phase.Ground || !S.Alive) return;

            if (!S.Knocked && Input.GetMouseButton(0) && Cursor.lockState == CursorLockMode.Locked && Time.time >= nextFire)
            {
                nextFire = Time.time + fireInterval;
                TryFire();
            }

            if (Input.GetKeyDown(KeyCode.R)) Emit("reload-weapon");

            for (int i = 0; i < 3; i++)
            {
                if (Input.GetKeyDown(KeyCode.Alpha1 + i))
                {
                    var weapon = S.Inventory?["weapons"]?.ElementAtOrDefault(i);
                    if (weapon != null) Emit("equip-weapon", new { weaponId = weapon["weaponId"].ToString() });
                }
            }

            if (Input.GetKeyDown(KeyCode.F)) PickupNearest(Input.GetKey(KeyCode.LeftShift));
            if (Input.GetKeyDown(KeyCode.G)) ThrowAtCrosshair("frag");
            if (Input.GetKeyDown(KeyCode.T)) ThrowAtCrosshair("smoke");
            if (Input.GetKeyDown(KeyCode.Y)) ThrowAtCrosshair("flash");
            if (Input.GetKeyDown(KeyCode.Q)) GlooWall();
            if (Input.GetKeyDown(KeyCode.H)) Emit("use-healing-item", new { itemId = "bandage" });
            if (Input.GetKeyDown(KeyCode.J)) Emit("use-healing-item", new { itemId = "medkit" });
            if (Input.GetKeyDown(KeyCode.E)) ReviveNearest();
            if (Input.GetKeyDown(KeyCode.X)) { Emit("cancel-healing"); Emit("cancel-revive"); }
        }

        // ---------------- shooting ----------------

        void TryFire()
        {
            if (S.ActiveWeapon == null) { S.AddFeed("No weapon — find one and press F"); return; }
            if (S.Reloading) return;

            var aim = FindAimTarget();
            if (aim == null) return;

            var origin = transform.position + Vector3.up * BBFConfig.EyeHeight;
            var direction = aim.Value.point - origin;

            Emit("fire-weapon", new
            {
                targetId = aim.Value.playerId,
                direction = MatchState.Dto(direction)
            });
        }

        public (long playerId, Vector3 point)? FindAimTarget()
        {
            if (cameraRig == null) return null;
            var ray = cameraRig.AimRay;

            // 1. Direct hit on a remote player's hit zone.
            var hits = Physics.RaycastAll(ray, 1000f, aimMask, QueryTriggerInteraction.Collide)
                .OrderBy(h => h.distance);

            foreach (var hit in hits)
            {
                if (hit.transform.IsChildOf(transform)) continue;

                var zone = hit.collider.GetComponent<HitZone>();
                if (zone == null)
                {
                    // A wall or other solid object is in the way.
                    if (!hit.collider.isTrigger) break;
                    continue;
                }

                if (!IsEnemy(zone.Owner)) continue;
                return (zone.Owner.PlayerId, zone.Owner.ServerPosition + Vector3.up * zone.ServerHeight);
            }

            // 2. Small assist: an enemy chest within a degree or so.
            (long, Vector3)? best = null;
            var bestAngle = aimAssistDegrees;
            foreach (var rp in MatchManager.Instance.Remotes)
            {
                if (rp == null || !IsEnemy(rp)) continue;
                var chest = rp.ServerPosition + Vector3.up * BBFConfig.BodyHeight;
                var angle = Vector3.Angle(ray.direction, chest - ray.origin);
                if (angle < bestAngle) { bestAngle = angle; best = (rp.PlayerId, chest); }
            }
            return best;
        }

        bool IsEnemy(RemotePlayer rp) =>
            rp != null && rp.IsAlive && !rp.IsHidden && !S.IsTeammate(rp.PlayerId);

        // ---------------- throwables ----------------

        Vector3 CrosshairGroundPoint(float maxDistance)
        {
            var ray = cameraRig.AimRay;
            var plane = new Plane(Vector3.up, new Vector3(0, transform.position.y, 0));
            Vector3 point = plane.Raycast(ray, out var enter) && enter < 300f
                ? ray.GetPoint(enter)
                : transform.position + Quaternion.Euler(0, cameraRig.Yaw, 0) * Vector3.forward * maxDistance;

            var flat = point - transform.position;
            flat.y = 0;
            if (flat.magnitude > maxDistance) flat = flat.normalized * maxDistance;
            return transform.position + flat;
        }

        void ThrowAtCrosshair(string type)
        {
            Emit("throw-grenade", new { type, target = MatchState.Dto(CrosshairGroundPoint(BBFConfig.MaxThrowDistance)) });
        }

        void GlooWall()
        {
            var forward = Quaternion.Euler(0, cameraRig.Yaw, 0) * Vector3.forward;
            var position = transform.position + forward * BBFConfig.GlooWallDistance;
            // facing (degrees): 0 = +Z, 90 = +X, same as Unity yaw.
            Emit("deploy-gloo-wall", new { position = MatchState.Dto(position), facing = cameraRig.Yaw });
        }

        // ---------------- looting & revive ----------------

        void PickupNearest(bool swap)
        {
            LootInfo best = null;
            var bestDistance = BBFConfig.PickupDistance;

            foreach (var item in S.Loot.Values)
            {
                var d = Vector3.Distance(new Vector3(item.Position.x, 0, item.Position.z),
                                         new Vector3(transform.position.x, 0, transform.position.z));
                if (d < bestDistance) { best = item; bestDistance = d; }
            }

            if (best == null) { S.AddFeed("Nothing within reach"); return; }

            if (swap && S.ActiveWeapon != null)
                Emit("pickup-loot", new { lootId = best.LootId, swapWeaponId = S.ActiveWeapon });
            else
                Emit("pickup-loot", new { lootId = best.LootId });
        }

        void ReviveNearest()
        {
            foreach (var p in S.Players.Values)
            {
                if (p.Id == ApiClient.PlayerId || !p.Knocked || !p.Position.HasValue || !S.IsTeammate(p.Id)) continue;
                if (Vector3.Distance(p.Position.Value, transform.position) <= BBFConfig.ReviveDistance)
                {
                    Emit("revive-teammate", new { targetId = p.Id });
                    return;
                }
            }
            S.AddFeed("No knocked teammate within reach");
        }
    }
}
