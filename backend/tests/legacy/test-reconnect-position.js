
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

const { io } = require("socket.io-client");

const SERVER = "http://127.0.0.1:5000";
const matchId = process.env.TEST_MATCH_ID;
const token = process.env.PLAYER1_SOCKET_TOKEN;

// A small movement from Player 1's previously tested position.
const testPosition = {
    x: 455.34,
    y: 100,
    z: 9
};

function connectPlayer() {
    return new Promise((resolve, reject) => {
        const socket = io(SERVER, {
            auth: { token },
            transports: ["websocket", "polling"],
            reconnection: false
        });

        const timer = setTimeout(() => {
            socket.disconnect();
            reject(new Error("Connection timed out"));
        }, 10000);

        socket.once("connect", () => {
            clearTimeout(timer);
            console.log("Player 1 connected:", socket.id);
            resolve(socket);
        });

        socket.once("connect_error", error => {
            clearTimeout(timer);
            reject(error);
        });
    });
}

function joinMatch(socket) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error("Match join timed out"));
        }, 10000);

        socket.once("joined-match", response => {
            clearTimeout(timer);

            if (!response.success) {
                reject(new Error("Failed to join match"));
                return;
            }

            console.log("Joined match:", response.matchId);
            console.log(
                "Position snapshot:",
                JSON.stringify(response.playerPositions, null, 2)
            );

            resolve(response);
        });

        socket.emit("join-match", { matchId });
    });
}

function movePlayer(socket) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error("Movement ACK timed out"));
        }, 10000);

        socket.once("player-move-ack", response => {
            clearTimeout(timer);

            console.log("Movement ACK:", response);

            if (!response.success) {
                reject(new Error(response.message || "Movement rejected"));
                return;
            }

            resolve();
        });

        socket.emit("player-move", {
            position: testPosition
        });
    });
}

async function runTest() {
    let socket;

    try {
        if (!matchId || !token) {
            throw new Error("Missing TEST_MATCH_ID or PLAYER1_SOCKET_TOKEN in .env");
        }

        console.log("\n====================================");
        console.log(" PLAYER POSITION RECONNECT TEST");
        console.log("====================================\n");

        // First connection
        console.log("STEP 1: Connect Player 1");
        socket = await connectPlayer();

        console.log("\nSTEP 2: Join match");
        await joinMatch(socket);

        console.log("\nSTEP 3: Move Player 1");
        await movePlayer(socket);

        console.log("Test position:", testPosition);

        // Disconnect
        console.log("\nSTEP 4: Disconnect Player 1");
        socket.disconnect();
        socket = null;

        await new Promise(resolve => setTimeout(resolve, 1000));

        // Reconnect with the same player token
        console.log("\nSTEP 5: Reconnect Player 1");
        socket = await connectPlayer();

        console.log("\nSTEP 6: Join the same match again");
        const response = await joinMatch(socket);

        // Check snapshot
        console.log("\nSTEP 7: Verify saved position");

        const savedPlayer = (response.playerPositions || []).find(
            item => String(item.playerId) === "1"
        );

        if (!savedPlayer) {
            throw new Error("Player 1 position not found in snapshot");
        }

        const actual = savedPlayer.position;

        console.log("Expected:", testPosition);
        console.log("Received:", actual);

        const passed =
            Number(actual.x) === testPosition.x &&
            Number(actual.y) === testPosition.y &&
            Number(actual.z) === testPosition.z;

        if (passed) {
            console.log("\nSUCCESS: Player 1 retained the previous position!");
        } else {
            console.log("\nFAILED: Player 1 position did not match.");
        }

    } catch (error) {
        console.log("\nTEST ERROR:", error.message);
    } finally {
        if (socket) {
            socket.disconnect();
        }

        console.log("\nReconnect test finished.");
    }
}

runTest();
