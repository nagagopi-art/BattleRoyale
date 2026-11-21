
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

const { io } = require("socket.io-client");

const token = process.env.SOCKET_TEST_TOKEN;
const matchId = process.env.TEST_MATCH_ID;

if (!token || !matchId) {
    console.error("Missing SOCKET_TEST_TOKEN or TEST_MATCH_ID in .env");
    process.exit(1);
}

const socket = io("http://127.0.0.1:5000", {
    auth: { token },
    transports: ["websocket", "polling"],
    timeout: 15000,
    reconnection: false
});

let authenticated = false;
let joined = false;
let spawnReceived = false;

const timeout = setTimeout(() => {
    console.log("\n========== TEST SUMMARY ==========");
    console.log("Authenticated:", authenticated);
    console.log("Joined match:", joined);
    console.log("Spawn event received:", spawnReceived);
    console.log("==================================");

    socket.disconnect();
    process.exit(joined ? 0 : 1);
}, 15000);

socket.on("connect", () => {
    console.log("SUCCESS: Socket.IO connected");
    console.log("Socket ID:", socket.id);
});

socket.on("connection-success", (data) => {
    authenticated = true;

    console.log("\nAUTHENTICATION SUCCESS:");
    console.log(JSON.stringify(data, null, 2));

    console.log("\nRequesting match join:", matchId);
    socket.emit("join-match", { matchId });
});

socket.on("joined-match", (data) => {
    console.log("\nJOIN MATCH RESPONSE:");
    console.log(JSON.stringify(data, null, 2));

    if (data && data.success) {
        joined = true;
        console.log("SUCCESS: Joined multiplayer match");
    }
});

socket.on("player-spawned", (data) => {
    spawnReceived = true;

    console.log("\nPLAYER SPAWN EVENT RECEIVED:");
    console.log(JSON.stringify(data, null, 2));
});

socket.on("match-started", (data) => {
    console.log("\nMATCH STARTED EVENT:");
    console.log(JSON.stringify(data, null, 2));
});

socket.on("battlefield-error", (data) => {
    console.error("\nBATTLEFIELD ERROR:");
    console.error(JSON.stringify(data, null, 2));
});

socket.on("connect_error", (error) => {
    console.error("CONNECTION FAILED:", error.message);
    clearTimeout(timeout);
    process.exit(1);
});

socket.on("disconnect", (reason) => {
    console.log("Disconnected:", reason);
});
