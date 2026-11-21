// INDIAN BATTLE FIELDS - Unity client
// REST API: login, sign-up, matchmaking, match info, layout.

using System;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace BBF
{
    public class ApiResult
    {
        public long Status;
        public JObject Json;
        public bool Ok => Status >= 200 && Status < 300;
        public string Message => Json?["message"]?.ToString() ?? $"HTTP {Status}";
    }

    public static class ApiClient
    {
        public static string AccessToken;
        public static string RefreshToken;
        public static long PlayerId;
        public static string Username;

        static async Task<ApiResult> Send(string method, string path, object body, bool auth)
        {
            using var request = new UnityWebRequest(BBFConfig.ServerUrl + path, method);
            request.downloadHandler = new DownloadHandlerBuffer();

            if (body != null)
            {
                var bytes = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(body));
                request.uploadHandler = new UploadHandlerRaw(bytes);
            }

            request.SetRequestHeader("Content-Type", "application/json");
            if (auth && !string.IsNullOrEmpty(AccessToken))
                request.SetRequestHeader("Authorization", "Bearer " + AccessToken);

            var op = request.SendWebRequest();
            while (!op.isDone) await Task.Yield();

            JObject json = null;
            try { json = JObject.Parse(request.downloadHandler.text); }
            catch { /* empty or non-JSON body */ }

            return new ApiResult { Status = request.responseCode, Json = json };
        }

        // Authenticated call; refreshes the access token once on 401.
        public static async Task<ApiResult> Call(string method, string path, object body = null)
        {
            var result = await Send(method, path, body, true);

            if (result.Status == 401 && await Refresh())
                result = await Send(method, path, body, true);

            return result;
        }

        public static async Task<ApiResult> Login(string email, string password)
        {
            var r = await Send("POST", "/api/auth/login", new { email, password }, false);
            if (r.Ok)
            {
                AccessToken = r.Json["access_token"]?.ToString();
                RefreshToken = r.Json["refresh_token"]?.ToString();
                PlayerId = r.Json["player"]?["id"]?.Value<long>() ?? 0;
                Username = r.Json["player"]?["username"]?.ToString();
            }
            return r;
        }

        public static Task<ApiResult> Register(string username, string email, string password) =>
            Send("POST", "/api/auth/register", new { username, email, password }, false);

        public static async Task<bool> Refresh()
        {
            if (string.IsNullOrEmpty(RefreshToken)) return false;

            var r = await Send("POST", "/api/auth/refresh", new { refresh_token = RefreshToken }, false);
            if (!r.Ok) return false;

            AccessToken = r.Json["access_token"]?.ToString();
            RefreshToken = r.Json["refresh_token"]?.ToString();
            return true;
        }

        public static Task<ApiResult> QuickJoin(string gameMode) =>
            Call("POST", "/api/matchmaking/quick-join", new { game_mode = gameMode });

        public static Task<ApiResult> CreateRoom(string mapName, string gameMode) =>
            Call("POST", "/api/matches/create", new { map_name = mapName, game_mode = gameMode });

        public static Task<ApiResult> JoinByCode(string code) =>
            Call("POST", "/api/matches/join/code/" + Uri.EscapeDataString(code));

        public static Task<ApiResult> StartMatch(string matchId) =>
            Call("POST", $"/api/matches/{matchId}/start");

        public static Task<ApiResult> GetMatch(string matchId) =>
            Call("GET", $"/api/matches/{matchId}");

        public static Task<ApiResult> GetMatchPlayers(string matchId) =>
            Call("GET", $"/api/matches/{matchId}/players");

        public static Task<ApiResult> GetLayout(string matchId) =>
            Call("GET", $"/api/matches/{matchId}/layout");

        // The 12 maps (name, subtitle, region, environment).
        public static Task<ApiResult> GetMaps() =>
            Call("GET", "/api/maps");

        public static Task<ApiResult> LeaveMatch(string matchId) =>
            Call("POST", $"/api/matches/{matchId}/leave");
    }
}
