
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

const { io } = require("socket.io-client");

const socket = io("http://127.0.0.1:5000", {
    auth: {
        token: process.env.PLAYER1_SOCKET_TOKEN
    },
    transports: ["websocket", "polling"]
});

const matchId = process.env.TEST_MATCH_ID;

const positions = [
    { x: 455.34, y: 100, z: 4 },
    { x: 455.34, y: 100, z: 5 },
    { x: 455.34, y: 100, z: 6 },
    { x: 455.34, y: 100, z: 7 },
    { x: 455.34, y: 100, z: 8 }
];

let currentIndex = 0;

socket.on("connect", () => {
    console.log("Player 1 connected:", socket.id);
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

    console.log("Player 1 joined match.");
    sendNextMovement();
});

function sendNextMovement() {
    if (currentIndex >= positions.length) {
        console.log("\nAll five movements sent successfully.");
        socket.disconnect();
        return;
    }

    const position = positions[currentIndex];

    console.log(`Sending movement ${currentIndex + 1}:`, position);

    socket.emit("player-move", { position });
}

socket.on("player-move-ack", response => {
    console.log("Movement acknowledgement:", response);

    if (!response.success) {
        console.log("Movement rejected. Stopping test.");
        socket.disconnect();
        return;
    }

    currentIndex++;

    setTimeout(sendNextMovement, 150);
});

socket.on("game-error", error => {
    console.log("Game error:", error);
});
