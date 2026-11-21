// INDIAN BATTLE FIELDS - Unity client
// Socket.IO connection to the game server (SocketIOUnity).
// All event callbacks run on Unity's main thread.

using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using SocketIOClient;
using SocketIOClient.Newtonsoft.Json;
using UnityEngine;

namespace BBF
{
    public class GameConnection : MonoBehaviour
    {
        public static GameConnection Instance { get; private set; }

        SocketIOUnity socket;
        readonly Dictionary<string, List<Action<JObject>>> handlers = new();

        public bool Connected => socket != null && socket.Connected;
        public event Action OnConnected;

        void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        public void Connect(string serverUrl)
        {
            Disconnect();

            socket = new SocketIOUnity(new Uri(serverUrl), new SocketIOOptions
            {
                Auth = new Dictionary<string, string> { { "token", ApiClient.AccessToken } },
                Transport = SocketIOClient.Transport.TransportProtocol.WebSocket,
                ReconnectionAttempts = 10
            });

            socket.JsonSerializer = new NewtonsoftJsonSerializer();
            socket.OnConnected += (_, _) => UnityMainThread(() => OnConnected?.Invoke());

            foreach (var name in handlers.Keys) Bind(name);

            socket.Connect();
        }

        public void Disconnect()
        {
            if (socket == null) return;
            socket.Disconnect();
            socket.Dispose();
            socket = null;
        }

        // Register a handler for a server event (payload as JObject).
        public void On(string eventName, Action<JObject> handler)
        {
            if (!handlers.TryGetValue(eventName, out var list))
            {
                list = new List<Action<JObject>>();
                handlers[eventName] = list;
                if (socket != null) Bind(eventName);
            }
            list.Add(handler);
        }

        void Bind(string eventName)
        {
            socket.OnUnityThread(eventName, response =>
            {
                JObject data;
                try
                {
                    var token = response.GetValue<JToken>();
                    data = token as JObject ?? new JObject { ["value"] = token };
                }
                catch
                {
                    data = new JObject();
                }

                foreach (var h in handlers[eventName])
                {
                    try { h(data); }
                    catch (Exception e) { Debug.LogException(e); }
                }
            });
        }

        public void Emit(string eventName, object payload = null)
        {
            if (!Connected) return;
            if (payload == null) socket.Emit(eventName);
            else socket.Emit(eventName, payload);
        }

        void UnityMainThread(Action action) => MainThread.Run(action);

        void OnDestroy() => Disconnect();
    }
}
