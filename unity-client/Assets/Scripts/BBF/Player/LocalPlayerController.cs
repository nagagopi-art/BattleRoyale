// INDIAN BATTLE FIELDS - Unity client
// The player you control. Put this on your character prefab
// together with a CharacterController (height 1.8, radius 0.35,
// centre y 0.9). Movement is camera-relative and sent to the
// server 10 times a second; the server has the final say and
// rejected moves snap back to the last accepted position.

using UnityEngine;

namespace BBF
{
    [RequireComponent(typeof(CharacterController))]
    public class LocalPlayerController : MonoBehaviour
    {
        public ThirdPersonCamera cameraRig;
        public Animator animator;
        [Tooltip("Shown while descending (optional)")]
        public GameObject parachuteVisual;

        CharacterController controller;
        Vector3 lastConfirmed;
        bool hasConfirmed;
        float nextSend;
        float verticalSpeed;

        MatchState S => MatchManager.Instance.State;

        void Awake()
        {
            controller = GetComponent<CharacterController>();
            if (animator == null) animator = GetComponentInChildren<Animator>();
        }

        // Server-authoritative placement (spawn, jump, landing).
        public void Teleport(Vector3 position)
        {
            controller.enabled = false;
            transform.position = position;
            controller.enabled = true;
            lastConfirmed = position;
            hasConfirmed = true;
        }

        public void ConfirmPosition(Vector3 position)
        {
            lastConfirmed = position;
            hasConfirmed = true;
        }

        public void RejectMove()
        {
            if (hasConfirmed) Teleport(lastConfirmed);
        }

        void Update()
        {
            var phase = S.Phase;

            SetVisible(phase != Phase.Aircraft && phase != Phase.Lobby && phase != Phase.Waiting);
            if (parachuteVisual) parachuteVisual.SetActive(phase == Phase.Dropping && S.Parachute);

            switch (phase)
            {
                case Phase.Ground:
                    if (S.Alive) Walk();
                    break;
                case Phase.Dropping:
                    Descend();
                    break;
                case Phase.Aircraft:
                    if (Input.GetKeyDown(KeyCode.Space) && S.Flight != null)
                    {
                        var duration = S.Flight["flightDurationMs"]?.ToObject<float>() / 1000f ?? 20f;
                        var progress = Mathf.Clamp01((Time.time - S.FlightStartedAt) / duration);
                        MatchManager.Instance.Emit("jump-from-aircraft", new { progress });
                    }
                    break;
            }

            Animate(phase);
        }

        Vector3 MoveInput()
        {
            var input = new Vector3(Input.GetAxisRaw("Horizontal"), 0, Input.GetAxisRaw("Vertical"));
            if (input.sqrMagnitude < 0.01f) return Vector3.zero;

            var yaw = cameraRig != null ? cameraRig.Yaw : transform.eulerAngles.y;
            return Quaternion.Euler(0, yaw, 0) * input.normalized;
        }

        void Walk()
        {
            var move = MoveInput() * (S.Knocked ? BBFConfig.CrawlSpeed : BBFConfig.WalkSpeed);

            // After landing, keep feet on the flat ground (server
            // ground level). Before the aircraft leaves, players
            // stay at their spawn height.
            if (S.Jumped)
            {
                verticalSpeed = transform.position.y > BBFConfig.GroundY + 0.05f ? verticalSpeed - 20f * Time.deltaTime : 0f;
            }
            else
            {
                verticalSpeed = 0f;
            }

            controller.Move((move + Vector3.up * verticalSpeed) * Time.deltaTime);

            if (S.Jumped && transform.position.y < BBFConfig.GroundY)
            {
                var p = transform.position;
                Teleport(new Vector3(p.x, BBFConfig.GroundY, p.z));
            }

            // Face where the camera aims (third-person shooter).
            if (cameraRig != null)
                transform.rotation = Quaternion.Euler(0, cameraRig.Yaw, 0);

            SendPosition("player-move");
        }

        void Descend()
        {
            var speed = S.Parachute ? BBFConfig.ParachuteSpeed : BBFConfig.FreeFallSpeed;
            var steer = MoveInput() * (S.Parachute ? 10f : 4f);

            var p = transform.position + (steer + Vector3.down * speed) * Time.deltaTime;
            p.y = Mathf.Max(BBFConfig.GroundY, p.y);

            controller.enabled = false;
            transform.position = p;
            controller.enabled = true;

            if (!S.Parachute && p.y <= BBFConfig.ParachuteAltitude)
            {
                S.Parachute = true;
                MatchManager.Instance.Emit("deploy-parachute");
            }

            SendPosition("drop-position-update");
        }

        void SendPosition(string eventName)
        {
            if (Time.time < nextSend) return;
            nextSend = Time.time + BBFConfig.MoveSendInterval;

            if (hasConfirmed && (transform.position - lastConfirmed).sqrMagnitude < 0.0004f) return;

            MatchManager.Instance.Emit(eventName, new { position = MatchState.Dto(transform.position) });
        }

        void Animate(Phase phase)
        {
            if (animator == null) return;

            var horizontal = new Vector3(controller.velocity.x, 0, controller.velocity.z).magnitude;
            AnimatorParams.SetFloat(animator, "Speed", phase == Phase.Ground ? horizontal : 0f);
            AnimatorParams.SetBool(animator, "Airborne", phase == Phase.Dropping);
            AnimatorParams.SetBool(animator, "Knocked", S.Knocked);
            AnimatorParams.SetBool(animator, "Dead", !S.Alive);
        }

        void SetVisible(bool visible)
        {
            foreach (var r in GetComponentsInChildren<Renderer>(true))
                if (parachuteVisual == null || !r.transform.IsChildOf(parachuteVisual.transform))
                    r.enabled = visible;
        }
    }

    // Sets Animator parameters only if the controller has them,
    // so any humanoid Animator Controller works.
    public static class AnimatorParams
    {
        static bool Has(Animator a, string name, AnimatorControllerParameterType type)
        {
            if (a == null || a.runtimeAnimatorController == null) return false;
            foreach (var p in a.parameters) if (p.name == name && p.type == type) return true;
            return false;
        }

        public static void SetFloat(Animator a, string name, float v)
        {
            if (Has(a, name, AnimatorControllerParameterType.Float)) a.SetFloat(name, v, 0.1f, Time.deltaTime);
        }

        public static void SetBool(Animator a, string name, bool v)
        {
            if (Has(a, name, AnimatorControllerParameterType.Bool)) a.SetBool(name, v);
        }
    }
}
