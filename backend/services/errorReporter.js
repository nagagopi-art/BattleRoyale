// ==========================================
// INDIAN BATTLE FIELDS
// ERROR REPORTING (WEBHOOK)
// ==========================================
// If ERROR_WEBHOOK_URL is set, serious errors are POSTed
// there as JSON. Works with Discord and Slack incoming
// webhooks (message in "content" / "text") and with any
// service that accepts JSON. The same error is sent at most
// once per minute so a crash loop cannot flood the channel.

const os = require("os");

const WEBHOOK_URL = process.env.ERROR_WEBHOOK_URL || "";
const SERVER_ID = process.env.SERVER_ID || os.hostname();
const REPEAT_WINDOW_MS = 60000;

const lastSent = new Map(); // fingerprint -> time

function fingerprint(title, error) {
    const firstFrame = String(error?.stack || "").split("\n")[1] || "";
    return `${title}|${error?.message || error}|${firstFrame.trim()}`;
}

async function reportError(title, error, context = {}) {
    if (!WEBHOOK_URL) return false;

    const key = fingerprint(title, error);
    const now = Date.now();

    if (now - (lastSent.get(key) || 0) < REPEAT_WINDOW_MS) return false;
    lastSent.set(key, now);

    // Keep the map from growing forever.
    if (lastSent.size > 500) {
        for (const [k, t] of lastSent) {
            if (now - t > REPEAT_WINDOW_MS) lastSent.delete(k);
        }
    }

    const message = error?.message || String(error);
    const stack = String(error?.stack || "").split("\n").slice(0, 6).join("\n");
    const summary =
        `**${title}** on \`${SERVER_ID}\` (${process.env.NODE_ENV || "development"})\n` +
        `${message}` +
        (Object.keys(context).length ? `\nContext: ${JSON.stringify(context).slice(0, 300)}` : "") +
        (stack ? `\n\`\`\`\n${stack.slice(0, 1200)}\n\`\`\`` : "");

    try {
        const response = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                // Discord uses "content", Slack uses "text".
                content: summary.slice(0, 1900),
                text: summary.slice(0, 1900),
                title,
                message,
                server: SERVER_ID,
                environment: process.env.NODE_ENV || "development",
                context,
                timestamp: new Date().toISOString()
            }),
            signal: AbortSignal.timeout(5000)
        });

        return response.ok;
    } catch (sendError) {
        console.error("Error report could not be sent:", sendError.message);
        return false;
    }
}

module.exports = {
    reportError,
    isErrorReportingEnabled: () => Boolean(WEBHOOK_URL)
};
