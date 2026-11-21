require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
    process.env.SUPABASE_URL.trim(),
    process.env.SUPABASE_SECRET_KEY.trim()
);

async function testConnection() {
    console.log("Testing Supabase connection...");

    const { data, error } = await supabase
        .from("players")
        .select("id")
        .limit(1);

    if (error) {
        console.log("FAILED:", error.message);
        console.log("ERROR CODE:", error.code);
        console.log("ERROR STATUS:", error.status);
    } else {
        console.log("SUCCESS: Supabase connection working!");
        console.log("Records returned:", data.length);
    }
}

testConnection();