
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

const { io } = require("socket.io-client");

const SERVER_URL = "http://127.0.0.1:5000";

const token = process.env.PLAYER1_SOCKET_TOKEN;
const matchId = process.env.TEST_MATCH_ID;

if (!token || !matchId) {
    console.error("Missing PLAYER1_SOCKET_TOKEN or TEST_MATCH_ID in .env");
    process.exit(1);
}

const socket = io(SERVER_URL, {
    transports: ["websocket", "polling"],
    reconnection: false,
    timeout: 10000,
    auth: {
        token
    }
});

let joined = false;
let movementSent = false;

const timeout = setTimeout(() => {
    console.log("\nMovement test timed out.");
    finish();
}, 20000);

function finish() {
    clearTimeout(timeout);
    socket.disconnect();
}

socket.on("connect", () => {
    console.log("Player 1 connected:", socket.id);
});

socket.on("connect_error", error => {
    console.error("Connection failed:", error.message);
});

socket.on("connection-success", data => {
    console.log("Authenticated:", data.username);
    console.log("Player ID:", data.playerId);

    console.log("\nJoining match:", matchId);

    socket.emit("join-match", { matchId });
});

socket.on("joined-match", data => {
    console.log("\nMatch join response:");
    console.log(JSON.stringify(data, null, 2));

    if (!data.success) {
        console.error("Match joining failed.");
        return finish();
    }

    joined = true;

    // Give the server a moment to complete room registration.
    setTimeout(() => {
        const position = {
            x: 455.34,
            y: 100,
            z: 3
        };

        console.log("\nSending player-move event:");
        console.log(position);

        socket.emit("player-move", {
            position
        });

        movementSent = true;
        console.log("Movement event emitted by Player 1.");

        console.log(
            "\nWaiting for server acknowledgement..."
        );
    }, 1000);
});

socket.on("player-move-ack", data => {
    console.log("\nSERVER MOVEMENT ACKNOWLEDGEMENT:");
    console.log(JSON.stringify(data, null, 2));
});

socket.on("game-error", data => {
    console.error("\nSERVER GAME ERROR:");
    console.error(JSON.stringify(data, null, 2));
});

socket.on("disconnect", reason => {
    console.log("\nPlayer 1 disconnected:", reason);
});

socket.on("connect", () => {
    console.log("Waiting for authentication...");
});

socket.on("player-moved", data => {
    console.log("\nPlayer 1 received movement broadcast:");
    console.log(JSON.stringify(data, null, 2));
});

socket.on("disconnect", () => {
    console.log("Movement test finished.");
});
