
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

const { io } = require("socket.io-client");

const SERVER = "http://127.0.0.1:5000";
const matchId = process.env.TEST_MATCH_ID;

let player1;
let player2;

let player2Received = 0;
let player1Received = 0;

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
            reject(new Error(`${name} connection failed: ${error.message}`));
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

function sendAndVerify(sender, receiver, position, number, senderName, receiverName, direction) {
    return new Promise((resolve, reject) => {
        let acknowledged = false;
        let received = false;

        const timer = setTimeout(() => {
            cleanup();
            reject(
                new Error(`${direction} movement ${number} timed out`)
            );
        }, 5000);

        function cleanup() {
            clearTimeout(timer);
            sender.off("player-move-ack", onAck);
            receiver.off("player-moved", onMovement);
        }

        function finishIfComplete() {
            if (acknowledged && received) {
                cleanup();

                console.log(
                    `SUCCESS: ${senderName} movement ${number} received by ${receiverName}\n`
                );

                resolve();
            }
        }

        function onAck(response) {
            console.log(`${senderName} movement ${number} ACK:`, response);

            if (!response.success) {
                cleanup();
                reject(
                    new Error(response.message || "Movement rejected")
                );
                return;
            }

            if (response.recipients < 1) {
                cleanup();
                reject(
                    new Error("Backend reports zero movement recipients")
                );
                return;
            }

            acknowledged = true;
            finishIfComplete();
        }

        function onMovement(data) {
            if (data.matchId !== matchId) return;

            if (
                !data.position ||
                Number(data.position.x) !== Number(position.x) ||
                Number(data.position.y) !== Number(position.y) ||
                Number(data.position.z) !== Number(position.z)
            ) {
                return;
            }

            received = true;

            console.log(
                `${receiverName} received movement ${number}:`,
                data.position
            );

            finishIfComplete();
        }

        sender.once("player-move-ack", onAck);
        receiver.on("player-moved", onMovement);

        sender.emit("player-move", { position });
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
                "Missing TEST_MATCH_ID or player tokens in .env"
            );
        }

        console.log("\n======================================");
        console.log(" INDIAN BATTLE FIELDS");
        console.log(" BIDIRECTIONAL MOVEMENT TEST");
        console.log("======================================\n");

        // Connect Player 2.
        player2 = await connectPlayer(
            process.env.PLAYER2_SOCKET_TOKEN,
            "Player 2"
        );

        await joinMatch(player2, "Player 2");

        // Connect Player 1.
        player1 = await connectPlayer(
            process.env.PLAYER1_SOCKET_TOKEN,
            "Player 1"
        );

        await joinMatch(player1, "Player 1");

        console.log("\nBoth players connected successfully.\n");

        // Listen for Player 1 receiving Player 2 movements.
        // The actual count is updated in sendAndVerify.
        
        console.log("========== DIRECTION 1 ==========");
        console.log("Player 1 -> Player 2\n");

        const player1Positions = [
            { x: 455.34, y: 100, z: 4 },
            { x: 455.34, y: 100, z: 5 },
            { x: 455.34, y: 100, z: 6 },
            { x: 455.34, y: 100, z: 7 },
            { x: 455.34, y: 100, z: 8 }
        ];

        for (let i = 0; i < player1Positions.length; i++) {
            await sendAndVerify(
                player1,
                player2,
                player1Positions[i],
                i + 1,
                "Player 1",
                "Player 2",
                "Player 1 -> Player 2"
            );

            player2Received++;
            await new Promise(resolve => setTimeout(resolve, 150));
        }

        console.log("\n========== DIRECTION 2 ==========");
        console.log("Player 2 -> Player 1\n");

        const player2Positions = [
            { x: 455.34, y: 100, z: 11 },
            { x: 455.34, y: 100, z: 10 },
            { x: 455.34, y: 100, z: 9 },
            { x: 455.34, y: 100, z: 8 },
            { x: 455.34, y: 100, z: 7 }
        ];

        for (let i = 0; i < player2Positions.length; i++) {
            await sendAndVerify(
                player2,
                player1,
                player2Positions[i],
                i + 1,
                "Player 2",
                "Player 1",
                "Player 2 -> Player 1"
            );

            player1Received++;
            await new Promise(resolve => setTimeout(resolve, 150));
        }

        console.log("\n======================================");
        console.log(" BIDIRECTIONAL TEST RESULT");
        console.log("======================================");

        console.log("Player 1 -> Player 2:", player2Received, "/ 5");
        console.log("Player 2 -> Player 1:", player1Received, "/ 5");

        if (player1Received === 5 && player2Received === 5) {
            console.log("\nSUCCESS: Bidirectional movement works!");
        } else {
            console.log("\nFAILED: Movement synchronization incomplete.");
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
