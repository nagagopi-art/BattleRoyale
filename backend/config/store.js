// ==========================================
// INDIAN BATTLE FIELDS - in-match store
// ==========================================
// Prices in match coins. Every player starts each match with
// 1000 (see config/matchTypes.js). Purchases are only allowed
// during a buy phase. Each entry becomes a normal inventory
// item, exactly as if it had been picked up.

const STORE_ITEMS = [
    // Weapons (each comes with spare ammunition).
    { key: "vajra", category: "Assault rifles", name: "Vajra AR", price: 500, item: { itemType: "weapon", itemId: "vajra" }, ammo: ["rifle_ammo", 60] },
    { key: "garuda", category: "Assault rifles", name: "Garuda AR", price: 550, item: { itemType: "weapon", itemId: "garuda" }, ammo: ["rifle_ammo", 60] },
    { key: "trishul", category: "Assault rifles", name: "Trishul 762", price: 600, item: { itemType: "weapon", itemId: "trishul" }, ammo: ["rifle_ammo", 60] },
    { key: "agni", category: "SMGs", name: "Agni SMG", price: 350, item: { itemType: "weapon", itemId: "agni" }, ammo: ["smg_ammo", 70] },
    { key: "nagini", category: "SMGs", name: "Nagini SMG", price: 400, item: { itemType: "weapon", itemId: "nagini" }, ammo: ["smg_ammo", 70] },
    { key: "vajram", category: "Shotguns", name: "Vajram Shotgun", price: 450, item: { itemType: "weapon", itemId: "vajram" }, ammo: ["shotgun_ammo", 16] },
    { key: "drishti", category: "Snipers", name: "Drishti DMR", price: 600, item: { itemType: "weapon", itemId: "drishti" }, ammo: ["sniper_ammo", 20] },
    { key: "brahmastra", category: "Snipers", name: "Brahmastra Sniper", price: 750, item: { itemType: "weapon", itemId: "brahmastra" }, ammo: ["sniper_ammo", 15] },
    { key: "surya", category: "Pistols", name: "Surya Pistol", price: 100, item: { itemType: "weapon", itemId: "surya" }, ammo: ["pistol_ammo", 36] },

    // Ammunition.
    { key: "rifle_ammo", category: "Ammo", name: "Rifle ammo x60", price: 60, item: { itemType: "ammunition", itemId: "rifle_ammo", quantity: 60 } },
    { key: "smg_ammo", category: "Ammo", name: "SMG ammo x70", price: 50, item: { itemType: "ammunition", itemId: "smg_ammo", quantity: 70 } },
    { key: "shotgun_ammo", category: "Ammo", name: "Shotgun shells x16", price: 50, item: { itemType: "ammunition", itemId: "shotgun_ammo", quantity: 16 } },
    { key: "sniper_ammo", category: "Ammo", name: "Sniper ammo x20", price: 70, item: { itemType: "ammunition", itemId: "sniper_ammo", quantity: 20 } },
    { key: "pistol_ammo", category: "Ammo", name: "Pistol ammo x36", price: 30, item: { itemType: "ammunition", itemId: "pistol_ammo", quantity: 36 } },

    // Armour.
    { key: "helmet_1", category: "Armour", name: "Level 1 Helmet", price: 150, item: { itemType: "helmet", itemId: "helmet_level_1", level: 1 } },
    { key: "helmet_2", category: "Armour", name: "Level 2 Helmet", price: 250, item: { itemType: "helmet", itemId: "helmet_level_2", level: 2 } },
    { key: "helmet_3", category: "Armour", name: "Level 3 Helmet", price: 400, item: { itemType: "helmet", itemId: "helmet_level_3", level: 3 } },
    { key: "vest_1", category: "Armour", name: "Level 1 Vest", price: 150, item: { itemType: "vest", itemId: "vest_level_1", level: 1 } },
    { key: "vest_2", category: "Armour", name: "Level 2 Vest", price: 300, item: { itemType: "vest", itemId: "vest_level_2", level: 2 } },
    { key: "vest_3", category: "Armour", name: "Level 3 Vest", price: 450, item: { itemType: "vest", itemId: "vest_level_3", level: 3 } },

    // Throwables and gloo walls.
    { key: "frag", category: "Throwables", name: "Frag Grenade", price: 150, item: { itemType: "throwable", itemId: "frag", quantity: 1 } },
    { key: "smoke", category: "Throwables", name: "Smoke Grenade", price: 100, item: { itemType: "throwable", itemId: "smoke", quantity: 1 } },
    { key: "flash", category: "Throwables", name: "Flash Grenade", price: 100, item: { itemType: "throwable", itemId: "flash", quantity: 1 } },
    { key: "gloo", category: "Throwables", name: "Gloo Wall", price: 120, item: { itemType: "throwable", itemId: "gloo", quantity: 1 } },

    // Healing.
    { key: "bandage", category: "Healing", name: "Bandages x5", price: 60, item: { itemType: "healing", itemId: "bandage", quantity: 5 } },
    { key: "medkit", category: "Healing", name: "Medkit", price: 200, item: { itemType: "healing", itemId: "medkit", quantity: 1 } }
];

const STORE_BY_KEY = new Map(STORE_ITEMS.map(entry => [entry.key, entry]));

// What the client shows (no internal item details).
function publicCatalog() {
    return STORE_ITEMS.map(({ key, category, name, price, item }) => ({
        key,
        category,
        name,
        price,
        itemType: item.itemType,
        itemId: item.itemId
    }));
}

module.exports = {
    STORE_ITEMS,
    STORE_BY_KEY,
    publicCatalog
};
