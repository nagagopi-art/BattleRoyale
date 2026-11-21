
const { io } = require("socket.io-client");

// Player 2's Supabase access token, from the environment (never commit tokens).
require("dotenv").config();
const ACCESS_TOKEN = process.env.PLAYER2_SOCKET_TOKEN;

const MATCH_ID = "be426c78-82fe-4993-b039-1925f0abfab7";

const socket = io("http://localhost:5000", {
    auth: {
        token: ACCESS_TOKEN
    },
    transports: ["websocket", "polling"],
    reconnection: false,
    timeout: 10000
});

let joined = false;

socket.on("connect", () => {
    console.log("SUCCESS: Socket.IO connected");
    console.log("Socket ID:", socket.id);
});

socket.on("connection-success", (data) => {
    console.log("\nAuthenticated player:");
    console.log(JSON.stringify(data, null, 2));

    console.log("\nRequesting match room...");
    socket.emit("join-match", {
        matchId: MATCH_ID
    });
});

socket.on("joined-match", (data) => {
    joined = true;

    console.log("\nSUCCESS: Joined multiplayer match!");
    console.log(JSON.stringify(data, null, 2));
});

socket.on("player-spawned", (data) => {
    console.log("\nPlayer spawn information:");
    console.log(JSON.stringify(data, null, 2));

    setTimeout(() => {
        socket.disconnect();
    }, 1000);
});

socket.on("player-joined", (data) => {
    console.log("\nAnother player joined:");
    console.log(data);
});

socket.on("game-error", (data) => {
    console.log("\nGAME ERROR:");
    console.log(data);
    socket.disconnect();
});

socket.on("connect_error", (error) => {
    console.log("\nCONNECTION ERROR:", error.message);
});

socket.on("disconnect", (reason) => {
    console.log("\nDisconnected:", reason);

    if (joined) {
        console.log("Socket.IO match join test completed.");
    }

    process.exitCode = joined ? 0 : 1;
});

setTimeout(() => {
    if (!joined) {
        console.log("\nTIMEOUT: No joined-match response received.");
        socket.disconnect();
        process.exitCode = 1;
    }
}, 15000);
