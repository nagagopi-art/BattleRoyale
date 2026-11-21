
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

const { io } = require("socket.io-client");

const token = process.env.PLAYER2_SOCKET_TOKEN;
const matchId = process.env.TEST_MATCH_ID;

if (!token || !matchId) {
    console.error("Missing PLAYER2_SOCKET_TOKEN or TEST_MATCH_ID in .env");
    process.exit(1);
}

const socket = io("http://127.0.0.1:5000", {
    auth: { token },
    transports: ["websocket", "polling"],
    reconnection: false
});

let joined = false;

socket.on("connect", () => {
    console.log("Player 2 connected:", socket.id);
});

socket.on("connection-success", (data) => {
    console.log("Player 2 authenticated:", data.player?.username || data.username || data);
});

socket.on("joined-match", (data) => {
    console.log("\nPlayer 2 joined match:");
    console.log(JSON.stringify(data, null, 2));
    joined = true;
    console.log("\nListening for Player 1 movement...");
});

socket.on("player-moved", (data) => {
    console.log("\nPLAYER 2 RECEIVED MOVEMENT:");
    console.log(JSON.stringify(data, null, 2));
});

socket.on("game-error", (data) => {
    console.log("Game error:", data);
});

socket.on("connect_error", (error) => {
    console.log("Connection error:", error.message);
});

socket.on("disconnect", (reason) => {
    console.log("Player 2 disconnected:", reason);
});

socket.emit("join-match", { matchId });

setTimeout(() => {
    console.log("\nListener test finished.");
    console.log("Joined match:", joined);
    socket.disconnect();
    process.exit(0);
}, 60000);
