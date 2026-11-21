require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

async function test() {
    const url = process.env.SUPABASE_URL.trim();
    const key = process.env.SUPABASE_SECRET_KEY.trim();

    const response = await fetch(
        `${url}/rest/v1/players?select=id&limit=1`,
        {
            headers: {
                apikey: key,
                "User-Agent": "battle-royale-backend/1.0"
            }
        }
    );

    console.log("HTTP Status:", response.status);
    console.log("Response:", await response.text());
}

test().catch(console.error);