// INDIAN BATTLE FIELDS - Unity client
// Another player. Put on a prefab with your character model
// (any humanoid + Animator). Smoothly follows the positions
// the server sends, faces its movement, plays Speed / Knocked
// / Dead / Airborne animations, and builds invisible hit
// zones at the server's hitbox heights for aiming.

using UnityEngine;

namespace BBF
{
    public class RemotePlayer : MonoBehaviour
    {
        public Animator animator;
        public TextMesh nameLabel;               // optional world-space label
        public GameObject parachuteVisual;       // optional
        public SkinApplier skin;                 // optional: equipped cosmetics
        // Teammates / enemies are told apart by the name label.
        public Color teamColor = new(0.35f, 0.7f, 1f);
        public Color enemyColor = new(1f, 0.4f, 0.35f);

        public long PlayerId { get; private set; }
        public bool IsAlive { get; private set; } = true;
        public bool IsHidden { get; private set; }

        // Latest position from the server (feet).
        public Vector3 ServerPosition { get; private set; }

        Vector3 lastPosition;
        float speed;

        public void Init(long playerId, string username)
        {
            PlayerId = playerId;
            name = "Player " + (username ?? playerId.ToString());
            if (nameLabel) nameLabel.text = username ?? "#" + playerId;
            if (animator == null) animator = GetComponentInChildren<Animator>();
            CreateHitZones();
        }

        // Invisible trigger colliders matching the server hitboxes
        // (legs 0-0.65, body 0.65-1.45, head 1.45-1.85).
        void CreateHitZones()
        {
            Zone("Head", new Vector3(0, BBFConfig.HeadHeight, 0), new Vector3(0.44f, 0.4f, 0.44f), BBFConfig.HeadHeight);
            Zone("Body", new Vector3(0, BBFConfig.BodyHeight, 0), new Vector3(0.7f, 0.8f, 0.7f), BBFConfig.BodyHeight);
            Zone("Legs", new Vector3(0, BBFConfig.LegsHeight, 0), new Vector3(0.6f, 0.65f, 0.6f), BBFConfig.LegsHeight);
        }

        void Zone(string label, Vector3 center, Vector3 size, float serverHeight)
        {
            var go = new GameObject("HitZone " + label);
            go.transform.SetParent(transform, false);
            go.transform.localPosition = center;
            var box = go.AddComponent<BoxCollider>();
            box.size = size;
            box.isTrigger = true;
            var zone = go.AddComponent<HitZone>();
            zone.Owner = this;
            zone.ServerHeight = serverHeight;
        }

        public void Apply(PlayerInfo info, bool teammate)
        {
            ServerPosition = info.Position ?? ServerPosition;
            IsAlive = info.Alive;
            IsHidden = info.Hidden || Time.time - info.SeenAt > 6f;

            if (skin == null) skin = GetComponent<SkinApplier>();
            if (skin) skin.Apply(info.CharacterSkin, info.ParachuteSkin, info.WeaponSkin);

            if (nameLabel)
            {
                if (info.Username != null)
                    nameLabel.text = skin ? $"{info.Username}\n<size=20>{skin.CharacterName}</size>" : info.Username;
                nameLabel.color = !info.Alive ? Color.gray : teammate ? teamColor : enemyColor;
            }

            foreach (var r in GetComponentsInChildren<Renderer>(true))
                if (nameLabel == null || r.gameObject != nameLabel.gameObject) r.enabled = !IsHidden;

            var airborne = ServerPosition.y > BBFConfig.GroundY + 2f && ServerPosition.y < 1400f;
            if (parachuteVisual) parachuteVisual.SetActive(airborne && ServerPosition.y < 520f);

            AnimatorParams.SetBool(animator, "Knocked", info.Knocked);
            AnimatorParams.SetBool(animator, "Dead", !info.Alive);
            AnimatorParams.SetBool(animator, "Airborne", airborne);
            AnimatorParams.SetFloat(animator, "Speed", speed);
        }

        void Update()
        {
            // Smooth toward the server position (updates arrive ~10/s).
            var k = 1f - Mathf.Exp(-Time.deltaTime * 12f);
            transform.position = Vector3.Lerp(transform.position, ServerPosition, k);

            var delta = transform.position - lastPosition;
            delta.y = 0;
            speed = Time.deltaTime > 0 ? delta.magnitude / Time.deltaTime : 0;

            if (delta.sqrMagnitude > 0.0001f)
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(delta), k);

            lastPosition = transform.position;

            if (nameLabel && Camera.main)
                nameLabel.transform.rotation = Quaternion.LookRotation(nameLabel.transform.position - Camera.main.transform.position);
        }
    }
}
