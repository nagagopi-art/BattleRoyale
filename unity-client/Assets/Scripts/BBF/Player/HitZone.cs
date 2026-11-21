// INDIAN BATTLE FIELDS - Unity client

using UnityEngine;

namespace BBF
{
    // Marks a collider as part of a player's hitbox.
    public class HitZone : MonoBehaviour
    {
        public RemotePlayer Owner;
        public float ServerHeight;
    }
}
