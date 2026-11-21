require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL?.trim();
const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();

if (!url || !secretKey) {
    throw new Error("Supabase URL or secret key is missing");
}

const supabaseAdmin = createClient(url, secretKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

const supabaseAuth = publishableKey
    ? createClient(url, publishableKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    })
    : null;

console.log("Supabase URL:", url);
console.log("Secret key loaded:", true);
console.log("Publishable key loaded:", Boolean(publishableKey));

module.exports = {
    supabaseAdmin,
    supabaseAuth
};
