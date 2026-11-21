// INDIAN BATTLE FIELDS - Unity client

using System;
using System.Collections.Generic;
using UnityEngine;

namespace BBF
{
    // Runs actions queued from other threads on the main thread.
    public class MainThread : MonoBehaviour
    {
        static readonly Queue<Action> queue = new();
        static MainThread instance;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Create()
        {
            var go = new GameObject("[BBF MainThread]");
            instance = go.AddComponent<MainThread>();
            DontDestroyOnLoad(go);
        }

        public static void Run(Action action)
        {
            lock (queue) queue.Enqueue(action);
        }

        void Update()
        {
            while (true)
            {
                Action next;
                lock (queue)
                {
                    if (queue.Count == 0) break;
                    next = queue.Dequeue();
                }
                next();
            }
        }
    }
}
