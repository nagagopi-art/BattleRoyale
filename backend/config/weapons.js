
// ==============================================
// BHARAT BATTLEGROUNDS
// WEAPON CONFIGURATION
// ==============================================

const WEAPONS = {
    // ASSAULT RIFLES
    vajra: {
        id: "vajra",
        name: "Vajra AR",
        category: "assault_rifle",
        damage: 32,
        headshotMultiplier: 2,
        fireRate: 700,
        magazineSize: 30,
        reloadTime: 2.4,
        range: 300,
        bulletSpeed: 750,
        automatic: true
    },

    trishul: {
        id: "trishul",
        name: "Trishul 762",
        category: "assault_rifle",
        damage: 42,
        headshotMultiplier: 2,
        fireRate: 600,
        magazineSize: 30,
        reloadTime: 2.7,
        range: 350,
        bulletSpeed: 800,
        automatic: true
    },

    garuda: {
        id: "garuda",
        name: "Garuda AR",
        category: "assault_rifle",
        damage: 29,
        headshotMultiplier: 2,
        fireRate: 850,
        magazineSize: 40,
        reloadTime: 2.8,
        range: 280,
        bulletSpeed: 720,
        automatic: true
    },

    // SUBMACHINE GUNS
    agni: {
        id: "agni",
        name: "Agni SMG",
        category: "smg",
        damage: 23,
        headshotMultiplier: 1.8,
        fireRate: 1000,
        magazineSize: 35,
        reloadTime: 2,
        range: 150,
        bulletSpeed: 600,
        automatic: true
    },

    nagini: {
        id: "nagini",
        name: "Nagini SMG",
        category: "smg",
        damage: 20,
        headshotMultiplier: 1.8,
        fireRate: 1150,
        magazineSize: 45,
        reloadTime: 2.2,
        range: 120,
        bulletSpeed: 550,
        automatic: true
    },

    // SNIPER RIFLES
    brahmastra: {
        id: "brahmastra",
        name: "Brahmastra Sniper",
        category: "sniper",
        damage: 95,
        headshotMultiplier: 2.5,
        fireRate: 45,
        magazineSize: 5,
        reloadTime: 3.5,
        range: 800,
        bulletSpeed: 1200,
        automatic: false
    },

    drishti: {
        id: "drishti",
        name: "Drishti DMR",
        category: "dmr",
        damage: 58,
        headshotMultiplier: 2,
        fireRate: 180,
        magazineSize: 10,
        reloadTime: 2.8,
        range: 600,
        bulletSpeed: 1000,
        automatic: false
    },

    // SHOTGUNS
    vajram: {
        id: "vajram",
        name: "Vajram Shotgun",
        category: "shotgun",
        damage: 12,
        pellets: 8,
        headshotMultiplier: 1.5,
        fireRate: 75,
        magazineSize: 6,
        reloadTime: 3,
        range: 60,
        bulletSpeed: 400,
        automatic: false
    },

    // PISTOLS
    surya: {
        id: "surya",
        name: "Surya Pistol",
        category: "pistol",
        damage: 35,
        headshotMultiplier: 2,
        fireRate: 300,
        magazineSize: 15,
        reloadTime: 1.5,
        range: 100,
        bulletSpeed: 500,
        automatic: false
    }
};

// ==============================================
// AMMUNITION CONFIGURATION
// ==============================================

const AMMUNITION = {
    rifle_ammo: {
        id: "rifle_ammo",
        name: "Rifle Ammunition",
        stackLimit: 200
    },

    smg_ammo: {
        id: "smg_ammo",
        name: "SMG Ammunition",
        stackLimit: 200
    },

    sniper_ammo: {
        id: "sniper_ammo",
        name: "Sniper Ammunition",
        stackLimit: 100
    },

    shotgun_ammo: {
        id: "shotgun_ammo",
        name: "Shotgun Shells",
        stackLimit: 50
    },

    pistol_ammo: {
        id: "pistol_ammo",
        name: "Pistol Ammunition",
        stackLimit: 100
    }
};

// ==============================================
// HELPER FUNCTIONS
// ==============================================

function getWeapon(weaponId) {
    return WEAPONS[weaponId] || null;
}

function getWeaponsByCategory(category) {
    return Object.values(WEAPONS).filter(
        weapon => weapon.category === category
    );
}

function getAmmunition(ammoId) {
    return AMMUNITION[ammoId] || null;
}

module.exports = {
    WEAPONS,
    AMMUNITION,
    getWeapon,
    getWeaponsByCategory,
    getAmmunition
};
