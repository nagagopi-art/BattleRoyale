
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

const { io } = require("socket.io-client");

const SERVER = "http://127.0.0.1:5000";
const MATCH_ID = process.env.TEST_MATCH_ID;
const PLAYER1_TOKEN = process.env.PLAYER1_SOCKET_TOKEN;
const PLAYER2_TOKEN = process.env.PLAYER2_SOCKET_TOKEN;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function connectPlayer(token) {
    return new Promise((resolve, reject) => {
        const socket = io(SERVER, {
            auth: { token },
            transports: ["websocket"],
            reconnection: false,
            timeout: 10000
        });

        const timer = setTimeout(() => {
            socket.disconnect();
            reject(new Error("Connection timeout"));
        }, 10000);

        socket.once("connect", () => {
            clearTimeout(timer);
            console.log("Connected:", socket.id);
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
            reject(new Error("Join match timeout"));
        }, 10000);

        socket.once("joined-match", response => {
            clearTimeout(timer);

            if (!response.success) {
                reject(new Error("Could not join match"));
                return;
            }

            resolve(response);
        });

        socket.emit("join-match", { matchId: MATCH_ID });
    });
}

function movePlayer(socket, position) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error("Movement ACK timeout"));
        }, 10000);

        socket.once("player-move-ack", response => {
            clearTimeout(timer);

            if (!response.success) {
                reject(new Error("Movement rejected"));
                return;
            }

            resolve(response);
        });

        socket.emit("player-move", { position });
    });
}

async function runTest() {
    let player1;
    let player2;
    let reconnectedPlayer1;

    try {
        if (!MATCH_ID || !PLAYER1_TOKEN || !PLAYER2_TOKEN) {
            throw new Error("Missing test environment variables");
        }

        console.log("\n--- POSITION RECONNECT TEST ---\n");

        // Keep Player 2 connected as the other match member.
        player2 = await connectPlayer(PLAYER2_TOKEN);
        await joinMatch(player2);
        console.log("Player 2 joined.");

        // Connect Player 1.
        player1 = await connectPlayer(PLAYER1_TOKEN);
        const firstJoin = await joinMatch(player1);
        console.log("Player 1 joined.");

        const playerId = firstJoin.members.find(
            member => String(member.player_id) === "1"
        )?.player_id ?? 1;

        // Move Player 1 to a known position.
        const expectedPosition = {
            x: 455.34,
            y: 100,
            z: 8
        };

        const movement = await movePlayer(player1, expectedPosition);

        console.log("Movement ACK:", movement);
        console.log("Expected position:", expectedPosition);

        await wait(500);

        // Disconnect Player 1 only.
        player1.disconnect();
        player1 = null;

        console.log("\nPlayer 1 disconnected.");
        await wait(1000);

        // Reconnect Player 1 using the same token.
        reconnectedPlayer1 = await connectPlayer(PLAYER1_TOKEN);

        const reconnectResponse = await joinMatch(reconnectedPlayer1);

        console.log("\nPlayer 1 rejoined.");
        console.log(
            "Received position snapshot:",
            reconnectResponse.playerPositions
        );

        const restored = (reconnectResponse.playerPositions || []).find(
            item => String(item.playerId) === String(playerId)
        );

        if (!restored) {
            throw new Error("Player 1 position missing from snapshot");
        }

        const actual = restored.position;

        const passed =
            actual.x === expectedPosition.x &&
            actual.y === expectedPosition.y &&
            actual.z === expectedPosition.z;

        console.log("\nExpected:", expectedPosition);
        console.log("Restored:", actual);

        if (!passed) {
            throw new Error("Position did not persist after reconnect");
        }

        console.log("\nSUCCESS: Player position survived reconnect!");

    } catch (error) {
        console.error("\nTEST FAILED:", error.message);
    } finally {
        if (player1) player1.disconnect();
        if (reconnectedPlayer1) reconnectedPlayer1.disconnect();
        if (player2) player2.disconnect();

        console.log("\nTest connections closed.");
    }
}

runTest();
