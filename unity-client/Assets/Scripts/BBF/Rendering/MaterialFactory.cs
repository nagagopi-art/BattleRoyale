// INDIAN BATTLE FIELDS - Unity client
// One place that creates materials, so the world, characters
// and VFX look consistent and work in both URP (recommended)
// and the Built-in pipeline. Shaders are looked up by name;
// make sure the BBF shaders are included in the build
// (Project Settings > Graphics > Always Included Shaders, or
// keep a material that uses them in Resources).

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace BBF
{
    public static class MaterialFactory
    {
        static readonly Dictionary<string, Shader> shaders = new();
        static readonly Dictionary<string, Material> cache = new();

        public static bool IsURP => GraphicsSettings.currentRenderPipeline != null;

        public static Shader Find(params string[] names)
        {
            foreach (var n in names)
            {
                if (shaders.TryGetValue(n, out var cached)) return cached;
                var s = Shader.Find(n);
                if (s != null) { shaders[n] = s; return s; }
            }
            return null;
        }

        static Shader LitShader => IsURP
            ? Find("Universal Render Pipeline/Lit", "Standard")
            : Find("Standard", "Universal Render Pipeline/Lit");

        static Shader UnlitShader => IsURP
            ? Find("Universal Render Pipeline/Unlit", "Unlit/Color")
            : Find("Unlit/Color", "Universal Render Pipeline/Unlit");

        static Shader ParticleShader => IsURP
            ? Find("Universal Render Pipeline/Particles/Unlit", "Particles/Standard Unlit", "Legacy Shaders/Particles/Additive")
            : Find("Particles/Standard Unlit", "Legacy Shaders/Particles/Additive", "Universal Render Pipeline/Particles/Unlit");

        public static void SetColor(Material m, Color c)
        {
            if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", c);
            if (m.HasProperty("_Color")) m.SetColor("_Color", c);
        }

        public static void SetTexture(Material m, Texture t)
        {
            if (t == null) return;
            if (m.HasProperty("_BaseMap")) m.SetTexture("_BaseMap", t);
            if (m.HasProperty("_MainTex")) m.SetTexture("_MainTex", t);
        }

        public static void SetTiling(Material m, Vector2 tiling)
        {
            if (m.HasProperty("_BaseMap")) m.SetTextureScale("_BaseMap", tiling);
            if (m.HasProperty("_MainTex")) m.SetTextureScale("_MainTex", tiling);
            if (m.HasProperty("_BumpMap")) m.SetTextureScale("_BumpMap", tiling);
        }

        public static void SetEmission(Material m, Color c)
        {
            if (!m.HasProperty("_EmissionColor")) return;
            m.EnableKeyword("_EMISSION");
            m.SetColor("_EmissionColor", c);
            m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
        }

        // Physically based surface (walls, roads, rocks, metal).
        public static Material Lit(Color color, Texture2D albedo = null, Texture2D normal = null,
            float smoothness = 0.2f, float metallic = 0f, string key = null)
        {
            if (key != null && cache.TryGetValue(key, out var hit)) return hit;

            var m = new Material(LitShader);
            SetColor(m, color);
            SetTexture(m, albedo);
            if (normal != null && m.HasProperty("_BumpMap"))
            {
                m.SetTexture("_BumpMap", normal);
                m.EnableKeyword("_NORMALMAP");
            }
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", smoothness);
            if (m.HasProperty("_Glossiness")) m.SetFloat("_Glossiness", smoothness);
            if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", metallic);
            m.enableInstancing = true;

            if (key != null) cache[key] = m;
            return m;
        }

        public static Material Unlit(Color color, string key = null)
        {
            if (key != null && cache.TryGetValue(key, out var hit)) return hit;
            var m = new Material(UnlitShader);
            SetColor(m, color);
            if (key != null) cache[key] = m;
            return m;
        }

        // Additive particles (fire, sparks, muzzle flash, glow).
        public static Material Additive(Color color, Texture2D texture = null, string key = null)
        {
            if (key != null && cache.TryGetValue(key, out var hit)) return hit;
            var m = new Material(ParticleShader);
            SetColor(m, color);
            SetTexture(m, texture);
            MakeTransparent(m, additive: true);
            if (key != null) cache[key] = m;
            return m;
        }

        // Alpha-blended particles (smoke, dust).
        public static Material AlphaBlended(Color color, Texture2D texture = null, string key = null)
        {
            if (key != null && cache.TryGetValue(key, out var hit)) return hit;
            var m = new Material(ParticleShader);
            SetColor(m, color);
            SetTexture(m, texture);
            MakeTransparent(m, additive: false);
            if (key != null) cache[key] = m;
            return m;
        }

        // Transparent lit surface (glass).
        public static Material Glass(Color tint, float smoothness = 0.95f, string key = null)
        {
            if (key != null && cache.TryGetValue(key, out var hit)) return hit;
            var m = Lit(tint, smoothness: smoothness, metallic: 0.1f);
            MakeTransparent(m, additive: false);
            if (key != null) cache[key] = m;
            return m;
        }

        // Anime cel shading (BBF/Toon); falls back to Lit.
        public static Material Toon(Color color, Color shadowColor, Texture2D albedo = null,
            float outlineWidth = 0.004f, Color? outline = null, string key = null)
        {
            if (key != null && cache.TryGetValue(key, out var hit)) return hit;

            var shader = Find("BBF/Toon");
            Material m;
            if (shader != null)
            {
                m = new Material(shader);
                SetColor(m, color);
                SetTexture(m, albedo);
                if (m.HasProperty("_ShadeColor")) m.SetColor("_ShadeColor", shadowColor);
                if (m.HasProperty("_OutlineWidth")) m.SetFloat("_OutlineWidth", outlineWidth);
                if (m.HasProperty("_OutlineColor")) m.SetColor("_OutlineColor", outline ?? new Color(0.08f, 0.06f, 0.1f));
            }
            else
            {
                m = Lit(color, albedo, smoothness: 0.35f);
            }

            if (key != null) cache[key] = m;
            return m;
        }

        // Transparent setup for URP Lit/Particles and Built-in Standard.
        public static void MakeTransparent(Material m, bool additive)
        {
            if (m.HasProperty("_Surface"))          // URP
            {
                m.SetFloat("_Surface", 1);
                m.SetFloat("_Blend", additive ? 2 : 0);
                m.SetOverrideTag("RenderType", "Transparent");
                m.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            }
            if (m.HasProperty("_Mode")) m.SetFloat("_Mode", 3);   // Built-in Standard: Transparent

            m.SetInt("_SrcBlend", (int)(additive ? BlendMode.One : BlendMode.SrcAlpha));
            m.SetInt("_DstBlend", (int)(additive ? BlendMode.One : BlendMode.OneMinusSrcAlpha));
            m.SetInt("_ZWrite", 0);
            m.DisableKeyword("_ALPHATEST_ON");
            m.EnableKeyword(additive ? "_ALPHAPREMULTIPLY_ON" : "_ALPHABLEND_ON");
            m.renderQueue = (int)RenderQueue.Transparent;
        }
    }
}
