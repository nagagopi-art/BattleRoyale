
const { supabaseAdmin } = require("../config/supabase");

async function authMiddleware(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                status: "error",
                message: "Authorization token is required"
            });
        }

        const token = authHeader.substring(7).trim();

        if (!token) {
            return res.status(401).json({
                status: "error",
                message: "Invalid authorization token"
            });
        }

        const { data, error } = await supabaseAdmin.auth.getUser(token);

        if (error || !data.user) {
            console.error("Supabase authentication error:", error?.message);

            return res.status(401).json({
                status: "error",
                message: "Invalid or expired token"
            });
        }

        req.user = data.user;
        req.accessToken = token;

        next();

    } catch (error) {
        console.error("Authentication error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Authentication failed"
        });
    }
}

module.exports = authMiddleware;
