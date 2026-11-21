// ==============================================
// INDIAN BATTLE FIELDS
// WEAPON ATTACHMENTS & HANDLING
// ==============================================

const { WEAPONS } = require("./weapons");

const ATTACHMENT_SLOTS = ["sight", "magazine", "grip", "muzzle"];

// Effects (all optional):
//   rangeMultiplier, magazineMultiplier, reloadMultiplier,
//   spreadMultiplier, recoilMultiplier, pelletSpreadMultiplier,
//   suppressed (true = gunshots heard from much closer only)
const ATTACHMENTS = {
    // ---------- SIGHTS ----------
    red_dot: {
        id: "red_dot",
        name: "Red Dot Sight",
        slot: "sight",
        categories: ["assault_rifle", "smg", "dmr", "shotgun", "pistol"],
        effects: { spreadMultiplier: 0.9 }
    },
    scope_2x: {
        id: "scope_2x",
        name: "2x Scope",
        slot: "sight",
        categories: ["assault_rifle", "smg", "dmr"],
        effects: { rangeMultiplier: 1.1, spreadMultiplier: 0.95 }
    },
    scope_4x: {
        id: "scope_4x",
        name: "4x Scope",
        slot: "sight",
        categories: ["assault_rifle", "dmr", "sniper"],
        effects: { rangeMultiplier: 1.2 }
    },
    scope_8x: {
        id: "scope_8x",
        name: "8x Scope",
        slot: "sight",
        categories: ["dmr", "sniper"],
        effects: { rangeMultiplier: 1.35 }
    },

    // ---------- MAGAZINES ----------
    extended_mag: {
        id: "extended_mag",
        name: "Extended Magazine",
        slot: "magazine",
        categories: ["assault_rifle", "smg", "dmr", "sniper", "pistol"],
        effects: { magazineMultiplier: 1.4 }
    },
    quick_mag: {
        id: "quick_mag",
        name: "Quickdraw Magazine",
        slot: "magazine",
        categories: ["assault_rifle", "smg", "dmr", "sniper", "pistol"],
        effects: { reloadMultiplier: 0.7 }
    },

    // ---------- GRIPS ----------
    vertical_grip: {
        id: "vertical_grip",
        name: "Vertical Grip",
        slot: "grip",
        categories: ["assault_rifle", "smg"],
        effects: { recoilMultiplier: 0.75 }
    },
    angled_grip: {
        id: "angled_grip",
        name: "Angled Grip",
        slot: "grip",
        categories: ["assault_rifle", "smg"],
        effects: { spreadMultiplier: 0.85 }
    },

    // ---------- MUZZLES ----------
    compensator: {
        id: "compensator",
        name: "Compensator",
        slot: "muzzle",
        categories: ["assault_rifle", "smg", "dmr"],
        effects: { recoilMultiplier: 0.75 }
    },
    suppressor: {
        id: "suppressor",
        name: "Suppressor",
        slot: "muzzle",
        categories: ["assault_rifle", "smg", "dmr", "sniper", "pistol"],
        effects: { suppressed: true }
    },
    choke: {
        id: "choke",
        name: "Shotgun Choke",
        slot: "muzzle",
        categories: ["shotgun"],
        effects: { pelletSpreadMultiplier: 0.7 }
    }
};

// ==============================================
// HANDLING (SPREAD, RECOIL, FALLOFF)
// ==============================================
// spread / recoil values are cone half-angles in degrees.
// Recoil builds with each shot fired in quick succession
// and resets after `recoilResetMs` without firing.

const WEAPON_HANDLING = {
    assault_rifle: { spread: 0.8, recoilPerShot: 0.25, maxRecoil: 3, pelletSpread: 0 },
    smg: { spread: 1.3, recoilPerShot: 0.2, maxRecoil: 3.5, pelletSpread: 0 },
    sniper: { spread: 0.05, recoilPerShot: 0, maxRecoil: 0, pelletSpread: 0 },
    dmr: { spread: 0.25, recoilPerShot: 0.5, maxRecoil: 2, pelletSpread: 0 },
    shotgun: { spread: 0.5, recoilPerShot: 0, maxRecoil: 0, pelletSpread: 5 },
    pistol: { spread: 0.9, recoilPerShot: 0.4, maxRecoil: 2.5, pelletSpread: 0 }
};

const HANDLING_CONFIG = {
    recoilResetMs: 450,
    // Damage is full up to this fraction of range, then
    // falls linearly to minDamageFraction at max range.
    falloffStartFraction: 0.5,
    minDamageFraction: 0.6,
    // Players further away than this hear the gunshot only
    // if unsuppressed.
    gunshotHearingRange: 250,
    suppressedHearingRange: 40
};

// Can this attachment go on this weapon?
function isAttachmentCompatible(attachmentId, weaponId) {
    const attachment = ATTACHMENTS[attachmentId];
    const weapon = WEAPONS[weaponId];

    return Boolean(
        attachment &&
        weapon &&
        attachment.categories.includes(weapon.category)
    );
}

// Base weapon stats with attachment effects applied.
// attachments: { sight, magazine, grip, muzzle } of ids/null.
function getEffectiveWeapon(weaponId, attachments = {}) {
    const base = WEAPONS[weaponId];
    if (!base) return null;

    const handling = WEAPON_HANDLING[base.category] || WEAPON_HANDLING.assault_rifle;

    let rangeMultiplier = 1;
    let magazineMultiplier = 1;
    let reloadMultiplier = 1;
    let spreadMultiplier = 1;
    let recoilMultiplier = 1;
    let pelletSpreadMultiplier = 1;
    let suppressed = false;

    const equipped = {};

    for (const slot of ATTACHMENT_SLOTS) {
        const id = attachments?.[slot];
        const attachment = id ? ATTACHMENTS[id] : null;

        if (!attachment || !attachment.categories.includes(base.category)) {
            equipped[slot] = null;
            continue;
        }

        equipped[slot] = attachment.id;

        const e = attachment.effects;
        rangeMultiplier *= e.rangeMultiplier || 1;
        magazineMultiplier *= e.magazineMultiplier || 1;
        reloadMultiplier *= e.reloadMultiplier || 1;
        spreadMultiplier *= e.spreadMultiplier || 1;
        recoilMultiplier *= e.recoilMultiplier || 1;
        pelletSpreadMultiplier *= e.pelletSpreadMultiplier || 1;
        if (e.suppressed) suppressed = true;
    }

    return {
        ...base,
        attachments: equipped,
        range: Math.round(base.range * rangeMultiplier),
        magazineSize: Math.max(1, Math.round(base.magazineSize * magazineMultiplier)),
        reloadTime: Number((base.reloadTime * reloadMultiplier).toFixed(2)),
        spread: handling.spread * spreadMultiplier,
        recoilPerShot: handling.recoilPerShot * recoilMultiplier,
        maxRecoil: handling.maxRecoil * recoilMultiplier,
        pelletSpread: handling.pelletSpread * pelletSpreadMultiplier,
        suppressed
    };
}

module.exports = {
    ATTACHMENT_SLOTS,
    ATTACHMENTS,
    WEAPON_HANDLING,
    HANDLING_CONFIG,
    isAttachmentCompatible,
    getEffectiveWeapon
};
