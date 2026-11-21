
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

const { io } = require("socket.io-client");

const SERVER = "http://127.0.0.1:5000";
const matchId = process.env.TEST_MATCH_ID;

let player1;
let player2;
let receivedCount = 0;

function connectPlayer(token, name) {
    return new Promise((resolve, reject) => {
        const socket = io(SERVER, {
            auth: { token },
            transports: ["websocket", "polling"],
            reconnection: false
        });

        const timer = setTimeout(() => {
            if (!socket.connected) {
                socket.disconnect();
                reject(new Error(`${name} connection timed out`));
            }
        }, 10000);

        socket.once("connect", () => {
            clearTimeout(timer);
            console.log(`${name} connected:`, socket.id);
            resolve(socket);
        });

        socket.once("connect_error", error => {
            clearTimeout(timer);
            reject(
                new Error(`${name} connection failed: ${error.message}`)
            );
        });
    });
}

function joinMatch(socket, name) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${name} match join timed out`));
        }, 10000);

        socket.once("joined-match", response => {
            clearTimeout(timer);

            if (!response.success) {
                reject(new Error(`${name} failed to join match`));
                return;
            }

            console.log(`${name} joined match:`, response.matchId);
            resolve();
        });

        socket.emit("join-match", { matchId });
    });
}

function sendMovement(position, number) {
    return new Promise((resolve, reject) => {
        let movementReceived = false;
        let acknowledged = false;

        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Movement ${number} timed out`));
        }, 5000);

        function cleanup() {
            clearTimeout(timer);
            player1.off("player-move-ack", onAck);
            player2.off("player-moved", onMovement);
        }

        function finishIfComplete() {
            if (acknowledged && movementReceived) {
                cleanup();

                console.log(
                    `Movement ${number}: ACK and received by Player 2`
                );

                resolve();
            }
        }

        function onAck(response) {
            console.log(`Movement ${number} ACK:`, response);

            if (!response.success) {
                cleanup();

                reject(
                    new Error(response.message || "Movement rejected")
                );

                return;
            }

            acknowledged = true;
            finishIfComplete();
        }

        function onMovement(data) {
            if (
                Number(data.playerId) !== 1 ||
                data.matchId !== matchId
            ) {
                return;
            }

            movementReceived = true;
            receivedCount++;

            console.log(
                `Player 2 received movement ${number}:`,
                data.position
            );

            finishIfComplete();
        }

        player1.once("player-move-ack", onAck);
        player2.on("player-moved", onMovement);

        player1.emit("player-move", { position });
    });
}

async function runTest() {
    try {
        if (
            !matchId ||
            !process.env.PLAYER1_SOCKET_TOKEN ||
            !process.env.PLAYER2_SOCKET_TOKEN
        ) {
            throw new Error(
                "Required test configuration is missing from .env"
            );
        }

        console.log("\n==================================");
        console.log("   INDIAN BATTLE FIELDS");
        console.log("   TWO PLAYER MOVEMENT TEST");
        console.log("==================================\n");

        // STEP 1: Connect Player 2.
        player2 = await connectPlayer(
            process.env.PLAYER2_SOCKET_TOKEN,
            "Player 2"
        );

        player2.on("game-error", error => {
            console.log("Player 2 game error:", error);
        });

        await joinMatch(player2, "Player 2");

        // STEP 2: Connect Player 1.
        player1 = await connectPlayer(
            process.env.PLAYER1_SOCKET_TOKEN,
            "Player 1"
        );

        player1.on("game-error", error => {
            console.log("Player 1 game error:", error);
        });

        await joinMatch(player1, "Player 1");

        console.log("\nBoth players are connected.");
        console.log("Sending five movements...\n");

        // STEP 3: Five consecutive movements.
        const positions = [
            { x: 455.34, y: 100, z: 4 },
            { x: 455.34, y: 100, z: 5 },
            { x: 455.34, y: 100, z: 6 },
            { x: 455.34, y: 100, z: 7 },
            { x: 455.34, y: 100, z: 8 }
        ];

        for (let i = 0; i < positions.length; i++) {
            console.log(`Sending movement ${i + 1}:`, positions[i]);

            await sendMovement(positions[i], i + 1);

            await new Promise(resolve => setTimeout(resolve, 150));
        }

        // STEP 4: Final result.
        console.log("\n========== TEST RESULT ==========");
        console.log("Movements sent:", positions.length);
        console.log("Movements received by Player 2:", receivedCount);

        if (receivedCount === positions.length) {
            console.log(
                "\nSUCCESS: Continuous movement synchronization works!"
            );
        } else {
            console.log(
                "\nFAILED: Movement synchronization needs investigation."
            );
        }

    } catch (error) {
        console.log("\nTEST ERROR:", error.message);
    } finally {
        if (player1) {
            player1.disconnect();
            console.log("Player 1 disconnected.");
        }

        if (player2) {
            player2.disconnect();
            console.log("Player 2 disconnected.");
        }
    }
}

runTest();
