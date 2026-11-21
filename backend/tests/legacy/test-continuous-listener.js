
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

const { io } = require("socket.io-client");

const socket = io("http://127.0.0.1:5000", {
    auth: {
        token: process.env.PLAYER2_SOCKET_TOKEN
    },
    transports: ["websocket", "polling"]
});

const matchId = process.env.TEST_MATCH_ID;
let receivedCount = 0;

socket.on("connect", () => {
    console.log("Player 2 connected:", socket.id);
    socket.emit("join-match", { matchId });
});

socket.on("connect_error", error => {
    console.log("Connection failed:", error.message);
});

socket.on("joined-match", response => {
    if (!response.success) {
        console.log("Match join failed:", response);
        socket.disconnect();
        return;
    }

    console.log("Player 2 joined match:", response.matchId);
    console.log("Waiting for Player 1 movements for 60 seconds...\n");
});

socket.on("player-moved", data => {
    receivedCount++;

    console.log(`Movement ${receivedCount} received:`);
    console.log(data.position);
    console.log("--------------------------------");
});

socket.on("game-error", error => {
    console.log("Game error:", error);
});

setTimeout(() => {
    console.log("\nContinuous listener finished.");
    console.log("Total movements received:", receivedCount);
    socket.disconnect();
    process.exit(0);
}, 60000);
