// INDIAN BATTLE FIELDS - Unity client
// Dresses a character in its equipped cosmetics:
// character outfit (Monsoon Ranger, Desert Falcon, Himalayan
// Sentinel), parachute (Peacock Canopy, Lotus Bloom) and
// weapon finish (Brass Inlay, Midnight Indigo, Sunfire).
//
// Two ways to use it on your character prefab:
//  1. Overrides: give a skin its own model and/or material.
//  2. Fallback: list the outfit / accent / weapon / parachute
//     renderers and they are tinted with the skin's colours.

using System;
using UnityEngine;

namespace BBF
{
    public class SkinApplier : MonoBehaviour
    {
        [Serializable]
        public class SkinOverride
        {
            public string skinId;                // e.g. "char_desert_falcon"
            public GameObject modelPrefab;       // optional full model swap
            public Material material;            // optional material for outfitRenderers
        }

        [Header("Renderers tinted by the skin colours")]
        public Renderer[] outfitRenderers;       // primary colour
        public Renderer[] accentRenderers;       // secondary colour
        public Renderer[] weaponRenderers;
        public Renderer[] parachuteRenderers;

        [Header("Optional per-skin art")]
        public Transform modelRoot;              // parent for swapped models
        public SkinOverride[] overrides;

        string appliedCharacter, appliedParachute, appliedWeapon;
        GameObject swappedModel;

        public string CharacterName { get; private set; } = Cosmetics.DefaultCharacter.Name;

        public void Apply(string characterSkin, string parachuteSkin, string weaponSkin)
        {
            if (characterSkin != appliedCharacter)
            {
                appliedCharacter = characterSkin;
                var skin = Cosmetics.Character(characterSkin);
                CharacterName = skin.Name;

                var custom = Find(characterSkin);

                if (custom?.modelPrefab != null && modelRoot != null)
                {
                    if (swappedModel) Destroy(swappedModel);
                    swappedModel = Instantiate(custom.modelPrefab, modelRoot);
                }

                if (custom?.material != null) SetMaterial(outfitRenderers, custom.material);
                else Tint(outfitRenderers, skin.Primary, false);

                Tint(accentRenderers, skin.Secondary, false);
            }

            if (parachuteSkin != appliedParachute)
            {
                appliedParachute = parachuteSkin;
                var chute = Cosmetics.Parachute(parachuteSkin);
                Tint(parachuteRenderers, chute.Primary, false);
            }

            if (weaponSkin != appliedWeapon)
            {
                appliedWeapon = weaponSkin;
                var finish = Cosmetics.Weapon(weaponSkin);
                Tint(weaponRenderers, finish.Primary, finish.Glow);
            }
        }

        SkinOverride Find(string skinId)
        {
            if (overrides == null || skinId == null) return null;
            foreach (var o in overrides) if (o != null && o.skinId == skinId) return o;
            return null;
        }

        static void SetMaterial(Renderer[] renderers, Material material)
        {
            if (renderers == null) return;
            foreach (var r in renderers) if (r) r.sharedMaterial = material;
        }

        static void Tint(Renderer[] renderers, Color color, bool glow)
        {
            if (renderers == null) return;

            foreach (var r in renderers)
            {
                if (!r) continue;
                var m = r.material;               // per-instance copy
                if (m.HasProperty("_BaseColor")) m.SetColor("_BaseColor", color);   // URP / HDRP
                if (m.HasProperty("_Color")) m.SetColor("_Color", color);           // Built-in

                if (glow && m.HasProperty("_EmissionColor"))
                {
                    m.EnableKeyword("_EMISSION");
                    m.SetColor("_EmissionColor", color * 1.5f);
                }
            }
        }
    }
}
