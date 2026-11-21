
const express = require("express");
const { supabaseAdmin } = require("../config/supabase");

const router = express.Router();

// ============================================
// MAPS TABLE SETUP CHECK
// ============================================
// If database/maps.sql has not been run yet, answer with a
// clear 503 instead of a generic server error.

let mapsTableReady = false;

router.use(async (req, res, next) => {
    if (mapsTableReady) return next();

    const { error } = await supabaseAdmin
        .from("maps")
        .select("id")
        .limit(1);

    if (error && (error.code === "PGRST205" || error.code === "42P01")) {
        return res.status(503).json({
            status: "error",
            message: "Maps are not set up yet. Run database/maps.sql and database/map_locations.sql in Supabase."
        });
    }

    if (!error) mapsTableReady = true;

    next();
});

// ============================================
// GET ALL ACTIVE MAPS
// GET /api/maps
// ============================================

router.get("/", async (req, res) => {
    try {
        const { data: maps, error } = await supabaseAdmin
            .from("maps")
            .select(`
                id,
                map_code,
                map_name,
                subtitle,
                region,
                description,
                environment,
                max_players,
                supported_modes,
                is_active
            `)
            .eq("is_active", true)
            .order("map_name", { ascending: true });

        if (error) {
            throw error;
        }

        return res.status(200).json({
            status: "success",
            message: "Maps fetched successfully",
            total: maps.length,
            maps
        });

    } catch (error) {
        console.error("Fetch maps error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to fetch maps"
        });
    }
});

// ============================================
// GET LOCATIONS FOR A MAP
// GET /api/maps/:mapCode/locations
// ============================================

router.get("/:mapCode/locations", async (req, res) => {
    try {
        const mapCode = String(req.params.mapCode)
            .trim()
            .toUpperCase();

        const { data: map, error: mapError } = await supabaseAdmin
            .from("maps")
            .select("id, map_code, map_name, subtitle")
            .eq("map_code", mapCode)
            .eq("is_active", true)
            .maybeSingle();

        if (mapError) {
            throw mapError;
        }

        if (!map) {
            return res.status(404).json({
                status: "error",
                message: "Map not found"
            });
        }

        const { data: locations, error: locationError } =
            await supabaseAdmin
                .from("map_locations")
                .select(`
                    id,
                    location_code,
                    location_name,
                    location_type,
                    loot_tier,
                    risk_level,
                    position_x,
                    position_y,
                    is_hot_drop,
                    description
                `)
                .eq("map_id", map.id)
                .eq("is_active", true)
                .order("location_name", { ascending: true });

        if (locationError) {
            throw locationError;
        }

        return res.status(200).json({
            status: "success",
            message: "Map locations fetched successfully",
            map,
            total: locations.length,
            locations
        });

    } catch (error) {
        console.error("Fetch map locations error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to fetch map locations"
        });
    }
});

// ============================================
// GET MAP DETAILS
// GET /api/maps/:mapCode
// ============================================

router.get("/:mapCode", async (req, res) => {
    try {
        const mapCode = String(req.params.mapCode)
            .trim()
            .toUpperCase();

        const { data: map, error } = await supabaseAdmin
            .from("maps")
            .select(`
                id,
                map_code,
                map_name,
                subtitle,
                region,
                description,
                environment,
                max_players,
                supported_modes,
                is_active
            `)
            .eq("map_code", mapCode)
            .eq("is_active", true)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!map) {
            return res.status(404).json({
                status: "error",
                message: "Map not found"
            });
        }

        return res.status(200).json({
            status: "success",
            message: "Map details fetched successfully",
            map
        });

    } catch (error) {
        console.error("Fetch map details error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to fetch map details"
        });
    }
});

module.exports = router;
