// ==========================================
// REST API client (same origin as the backend)
// ==========================================

const Api = (() => {
    const KEY = "bbf-session";

    let session = null;

    try {
        session = JSON.parse(sessionStorage.getItem(KEY) || "null");
    } catch {
        session = null;
    }

    function save(next) {
        session = next;
        try {
            if (next) sessionStorage.setItem(KEY, JSON.stringify(next));
            else sessionStorage.removeItem(KEY);
        } catch {
            // Storage unavailable: session lasts until reload.
        }
    }

    async function raw(method, path, body, token) {
        const res = await fetch(path, {
            method,
            headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: body ? JSON.stringify(body) : undefined
        });

        let json = null;
        try { json = await res.json(); } catch { /* empty body */ }

        return { status: res.status, ok: res.ok, json };
    }

    async function refresh() {
        if (!session?.refresh) return false;

        const r = await raw("POST", "/api/auth/refresh", { refresh_token: session.refresh });
        if (!r.ok) return false;

        save({ ...session, token: r.json.access_token, refresh: r.json.refresh_token });
        return true;
    }

    // Authenticated request; refreshes the token once on 401.
    async function call(method, path, body) {
        let r = await raw(method, path, body, session?.token);

        if (r.status === 401 && (await refresh())) {
            r = await raw(method, path, body, session?.token);
        }

        return r;
    }

    async function login(email, password) {
        const r = await raw("POST", "/api/auth/login", { email, password });

        if (r.ok) {
            save({
                token: r.json.access_token,
                refresh: r.json.refresh_token,
                player: r.json.player
            });
        }

        return r;
    }

    async function logout() {
        if (session) await call("POST", "/api/auth/logout").catch(() => {});
        save(null);
    }

    return {
        get session() { return session; },
        get token() { return session?.token; },
        refresh,
        call,
        login,
        logout,
        register: body => raw("POST", "/api/auth/register", body)
    };
})();
