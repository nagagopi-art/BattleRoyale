// INDIAN BATTLE FIELDS - Unity client
// Over-the-shoulder third-person camera. Mouse look while the
// cursor is locked (click to lock, Esc to release). Follows
// the aircraft, your character, or the spectated player.

using UnityEngine;

namespace BBF
{
    public class ThirdPersonCamera : MonoBehaviour
    {
        public Transform target;                 // the local player
        public float distance = 4.5f;
        public float minDistance = 1.8f, maxDistance = 12f;
        public Vector3 shoulderOffset = new(0.7f, 1.6f, 0);
        public float sensitivity = 2.5f;
        public LayerMask collisionMask = ~0;

        public float Yaw { get; private set; }
        public float Pitch { get; private set; } = 8f;

        Camera cam;

        void Awake()
        {
            cam = GetComponent<Camera>() ?? GetComponentInChildren<Camera>();
        }

        void Update()
        {
            if (Input.GetMouseButtonDown(0) && Cursor.lockState != CursorLockMode.Locked &&
                MatchManager.Instance.State.Phase != Phase.Lobby)
            {
                Cursor.lockState = CursorLockMode.Locked;
                Cursor.visible = false;
            }

            if (Input.GetKeyDown(KeyCode.Escape))
            {
                Cursor.lockState = CursorLockMode.None;
                Cursor.visible = true;
            }

            if (Cursor.lockState == CursorLockMode.Locked)
            {
                Yaw += Input.GetAxis("Mouse X") * sensitivity;
                Pitch = Mathf.Clamp(Pitch - Input.GetAxis("Mouse Y") * sensitivity, -70f, 75f);
            }

            distance = Mathf.Clamp(distance - Input.mouseScrollDelta.y * 0.8f, minDistance, maxDistance);
        }

        void LateUpdate()
        {
            var s = MatchManager.Instance.State;
            Vector3 focus;
            float dist = distance;
            Vector3 shoulder = shoulderOffset;

            if (s.Phase == Phase.Aircraft && MatchManager.Instance.world.AircraftPosition(out var plane))
            {
                focus = plane;
                dist = 45f;
                shoulder = Vector3.zero;
            }
            else if (s.Spectating.HasValue && MatchManager.Instance.Remote(s.Spectating.Value) is RemotePlayer rp && rp)
            {
                focus = rp.transform.position + Vector3.up * 1.6f;
                shoulder = Vector3.zero;
            }
            else if (target != null)
            {
                focus = target.position;
                if (s.Phase == Phase.Dropping) { dist = 14f; shoulder = new Vector3(0, 1.6f, 0); }
            }
            else return;

            var rotation = Quaternion.Euler(Pitch, Yaw, 0);
            var pivot = focus + rotation * new Vector3(shoulder.x, 0, 0) + Vector3.up * shoulder.y;
            var desired = pivot - rotation * Vector3.forward * dist;

            // Pull in front of walls so the camera never clips through.
            if (Physics.SphereCast(pivot, 0.2f, desired - pivot, out var hit, dist, collisionMask, QueryTriggerInteraction.Ignore)
                && (target == null || !hit.transform.IsChildOf(target)))
            {
                desired = pivot + (desired - pivot).normalized * Mathf.Max(0.3f, hit.distance - 0.1f);
            }

            transform.SetPositionAndRotation(desired, rotation);
        }

        // Ray through the centre of the screen (the crosshair).
        public Ray AimRay => (cam != null ? cam : Camera.main).ViewportPointToRay(new Vector3(0.5f, 0.5f, 0));
    }
}
