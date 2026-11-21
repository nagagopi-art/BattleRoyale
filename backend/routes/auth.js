
const express = require("express");
const crypto = require("crypto");
const { supabaseAdmin, supabaseAuth } = require("../config/supabase");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// Generate a unique public game player ID
function generatePlayerUID() {
    return `BR-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

// ============================================
// REGISTER NEW PLAYER
// POST /api/auth/register
// ============================================

router.post("/register", async (req, res) => {
    let createdAuthUserId = null;

    try {
        const username = String(req.body.username || "").trim();
        const email = String(req.body.email || "").trim().toLowerCase();
        const password = String(req.body.password || "");

        // Validate username
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
            return res.status(400).json({
                status: "error",
                message: "Username must be 3-20 characters using letters, numbers or underscores"
            });
        }

        // "bot_" names are reserved for server-controlled bots.
        if (/^bot_/i.test(username)) {
            return res.status(400).json({
                status: "error",
                message: "Usernames starting with bot_ are reserved"
            });
        }

        // Validate email
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                status: "error",
                message: "Please provide a valid email address"
            });
        }

        // Validate password
        if (password.length < 8) {
            return res.status(400).json({
                status: "error",
                message: "Password must contain at least 8 characters"
            });
        }

        // Check whether username already exists
        const { data: existingUsername, error: usernameError } =
            await supabaseAdmin
                .from("players")
                .select("id")
                .eq("username", username)
                .maybeSingle();

        if (usernameError) {
            throw usernameError;
        }

        if (existingUsername) {
            return res.status(409).json({
                status: "error",
                message: "Username is already taken"
            });
        }

        // Check whether email already exists in game profiles
        const { data: existingEmail, error: emailError } =
            await supabaseAdmin
                .from("players")
                .select("id")
                .eq("email", email)
                .maybeSingle();

        if (emailError) {
            throw emailError;
        }

        if (existingEmail) {
            return res.status(409).json({
                status: "error",
                message: "An account with this email already exists"
            });
        }

        // Create Supabase Authentication account
        const { data: authData, error: authError } =
            await supabaseAdmin.auth.admin.createUser({
                email,
                password,
                email_confirm:
                    process.env.AUTO_CONFIRM_EMAIL === "true"
            });

        if (authError) {
            return res.status(400).json({
                status: "error",
                message: authError.message
            });
        }

        createdAuthUserId = authData.user.id;

        // Create game profile using existing BIGINT identity ID
        const { data: player, error: playerError } =
            await supabaseAdmin
                .from("players")
                .insert({
                    auth_user_id: createdAuthUserId,
                    player_uid: generatePlayerUID(),
                    username,
                    email,
                    password_hash: null,
                    level: 1,
                    experience: 0,
                    coins: 1000
                })
                .select(
                    "id, player_uid, username, email, level, experience, coins, created_at"
                )
                .single();

        if (playerError) {
            // Remove the Auth account if profile creation fails
            await supabaseAdmin.auth.admin.deleteUser(
                createdAuthUserId
            );

            createdAuthUserId = null;
            throw playerError;
        }

        return res.status(201).json({
            status: "success",
            message: "Player registered successfully",
            player
        });

    } catch (error) {
        console.error("Registration error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to register player"
        });
    }
});

// ============================================
// PLAYER LOGIN
// POST /api/auth/login
// ============================================

router.post("/login", async (req, res) => {
    try {
        if (!supabaseAuth) {
            return res.status(500).json({
                status: "error",
                message: "Supabase Authentication client is not configured"
            });
        }

        const email = String(req.body.email || "")
            .trim()
            .toLowerCase();

        const password = String(req.body.password || "");

        if (!email || !password) {
            return res.status(400).json({
                status: "error",
                message: "Email and password are required"
            });
        }

        // Authenticate with Supabase
        const { data: authData, error: authError } =
            await supabaseAuth.auth.signInWithPassword({
                email,
                password
            });

        if (authError || !authData.user) {
            return res.status(401).json({
                status: "error",
                message: "Invalid email or password"
            });
        }

        // Find game profile using Supabase Auth UUID
        const { data: player, error: playerError } =
            await supabaseAdmin
                .from("players")
                .select(
                    "id, player_uid, username, email, avatar_url, level, experience, coins, created_at"
                )
                .eq("auth_user_id", authData.user.id)
                .single();

        if (playerError || !player) {
            return res.status(404).json({
                status: "error",
                message: "Game player profile not found"
            });
        }

        return res.status(200).json({
            status: "success",
            message: "Login successful",
            access_token: authData.session.access_token,
            refresh_token: authData.session.refresh_token,
            expires_in: authData.session.expires_in,
            player
        });

    } catch (error) {
        console.error("Login error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to login"
        });
    }
});

// ============================================
// REFRESH SESSION
// POST /api/auth/refresh   { refresh_token }
// ============================================
// Access tokens expire (Supabase default: 1 hour). Clients
// call this with the refresh token from login to get a new
// access token without asking for the password again.

router.post("/refresh", async (req, res) => {
    try {
        if (!supabaseAuth) {
            return res.status(500).json({
                status: "error",
                message: "Supabase Authentication client is not configured"
            });
        }

        const refreshToken = String(req.body.refresh_token || "").trim();

        if (!refreshToken) {
            return res.status(400).json({
                status: "error",
                message: "refresh_token is required"
            });
        }

        const { data, error } = await supabaseAuth.auth.refreshSession({
            refresh_token: refreshToken
        });

        if (error || !data.session) {
            return res.status(401).json({
                status: "error",
                message: "Session expired. Please log in again"
            });
        }

        return res.status(200).json({
            status: "success",
            message: "Session refreshed",
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_in: data.session.expires_in
        });

    } catch (error) {
        console.error("Refresh error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to refresh session"
        });
    }
});

// ============================================
// LOGOUT
// POST /api/auth/logout   (Authorization: Bearer <token>)
// ============================================
// Revokes this session's refresh token. The current access
// token stays valid until it expires, so clients should
// also discard it.

router.post("/logout", authMiddleware, async (req, res) => {
    try {
        const { error } = await supabaseAdmin.auth.admin.signOut(
            req.accessToken,
            "local"
        );

        if (error) {
            console.error("Logout error:", error.message);

            return res.status(500).json({
                status: "error",
                message: "Unable to log out"
            });
        }

        return res.status(200).json({
            status: "success",
            message: "Logged out"
        });

    } catch (error) {
        console.error("Logout error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to log out"
        });
    }
});

// ============================================
// FORGOT PASSWORD
// POST /api/auth/forgot-password   { email }
// ============================================
// Always answers the same way, so it cannot be used to
// discover which emails have accounts.

router.post("/forgot-password", async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
            status: "error",
            message: "Please provide a valid email address"
        });
    }

    try {
        if (supabaseAuth) {
            const { error } = await supabaseAuth.auth.resetPasswordForEmail(
                email,
                process.env.PASSWORD_RESET_REDIRECT_URL
                    ? { redirectTo: process.env.PASSWORD_RESET_REDIRECT_URL }
                    : undefined
            );

            if (error) {
                console.error("Password reset email error:", error.message);
            }
        }
    } catch (error) {
        console.error("Password reset error:", error.message);
    }

    return res.status(200).json({
        status: "success",
        message: "If an account exists for this email, a reset link has been sent"
    });
});

// ============================================
// RESET PASSWORD
// POST /api/auth/reset-password   { new_password }
// (Authorization: Bearer <recovery access token>)
// ============================================
// The reset link from the email signs the player in with a
// short-lived recovery session; the client sends that
// access token here with the new password.

router.post("/reset-password", authMiddleware, async (req, res) => {
    try {
        const password = String(req.body.new_password || "");

        if (password.length < 8) {
            return res.status(400).json({
                status: "error",
                message: "Password must contain at least 8 characters"
            });
        }

        const { error } = await supabaseAdmin.auth.admin.updateUserById(
            req.user.id,
            { password }
        );

        if (error) {
            console.error("Password update error:", error.message);

            return res.status(400).json({
                status: "error",
                message: "Unable to update password"
            });
        }

        // Sign out other sessions that used the old password.
        await supabaseAdmin.auth.admin.signOut(req.accessToken, "others");

        return res.status(200).json({
            status: "success",
            message: "Password updated"
        });

    } catch (error) {
        console.error("Reset password error:", error.message);

        return res.status(500).json({
            status: "error",
            message: "Unable to update password"
        });
    }
});

// ============================================
// RESEND VERIFICATION EMAIL
// POST /api/auth/resend-verification   { email }
// ============================================
// Only needed when AUTO_CONFIRM_EMAIL is not "true".

router.post("/resend-verification", async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
            status: "error",
            message: "Please provide a valid email address"
        });
    }

    try {
        if (supabaseAuth && process.env.AUTO_CONFIRM_EMAIL !== "true") {
            const { error } = await supabaseAuth.auth.resend({
                type: "signup",
                email
            });

            if (error) {
                console.error("Resend verification error:", error.message);
            }
        }
    } catch (error) {
        console.error("Resend verification error:", error.message);
    }

    return res.status(200).json({
        status: "success",
        message: "If this account needs verification, an email has been sent"
    });
});

module.exports = router;
