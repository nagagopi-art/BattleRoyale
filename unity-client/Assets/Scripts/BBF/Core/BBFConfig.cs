// INDIAN BATTLE FIELDS - Unity client
// Server address and shared constants (must match the backend).

namespace BBF
{
    public static class BBFConfig
    {
        // REST API + default Socket.IO address. In multi-server
        // mode the match responses return the socket server to use.
        public static string ServerUrl = "http://localhost:5000";

        // Mirrors backend settings (sockets/game/state.js,
        // services/parachuteService.js, mapLayout.js).
        public const float GroundY = 5f;
        public const float WalkSpeed = 10f;          // server limit 12 units/s
        public const float CrawlSpeed = 2.5f;        // server limit 3 units/s (knocked)
        public const float MoveSendInterval = 0.1f;  // 10 updates/s (server rate limit 25/s)
        public const float DropSendInterval = 0.1f;
        public const float FreeFallSpeed = 80f;      // server allows 200 per update
        public const float ParachuteSpeed = 25f;
        public const float ParachuteAltitude = 500f;
        public const float PickupDistance = 5f;
        public const float ReviveDistance = 2.5f;
        public const float MaxThrowDistance = 38f;   // server limit 40
        public const float GlooWallDistance = 4f;    // server limit 8

        // Server hitbox centres above the feet (hitDetectionService.js).
        public const float HeadHeight = 1.65f;
        public const float BodyHeight = 1.05f;
        public const float LegsHeight = 0.33f;
        public const float EyeHeight = 1.5f;
    }
}
