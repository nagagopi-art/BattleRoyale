
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

const { supabaseAdmin } = require("../../config/supabase");

async function testCombatRPC() {
    console.log("Testing combat RPC availability...");

    const { data, error } = await supabaseAdmin.rpc(
        "sync_combat_result",
        {
            p_match_id: "00000000-0000-0000-0000-000000000000",
            p_shooter_id: 1,
            p_target_id: 2,
            p_target_health: 90,
            p_target_armor: 0,
            p_target_is_alive: true,
            p_shooter_kills: 0,
            p_eliminated: false
        }
    );

    if (error) {
        console.log("RPC response:", error.message);
        return;
    }

    console.log("Unexpected success:", data);
}

testCombatRPC().catch(error => {
    console.error("Test failed:", error.message);
});
