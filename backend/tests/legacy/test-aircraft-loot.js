
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });

const { io } = require("socket.io-client");
const { supabaseAdmin } = require("../../config/supabase");

const SERVER = "http://127.0.0.1:5000";
const matchId = process.env.TEST_MATCH_ID;

let player1;
let player2;

const TIMEOUT = 15000;

function connectPlayer(token, name) {
    return new Promise((resolve, reject) => {
        const socket = io(SERVER, {
            auth: { token },
            transports: ["websocket", "polling"],
            reconnection: false
        });

        const timer = setTimeout(() => {
            socket.disconnect();
            reject(new Error(`${name} connection timed out`));
        }, TIMEOUT);

        socket.once("connect", () => {
            clearTimeout(timer);
            console.log(`${name} connected`);
            resolve(socket);
        });

        socket.once("connect_error", error => {
            clearTimeout(timer);
            reject(new Error(`${name}: ${error.message}`));
        });
    });
}

function waitForEvent(socket, eventName) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Timeout waiting for ${eventName}`));
        }, TIMEOUT);

        function handleEvent(data) {
            cleanup();
            resolve(data);
        }

        function handleError(error) {
            cleanup();
            reject(new Error(error.message || "Game error"));
        }

        function cleanup() {
            clearTimeout(timer);
            socket.off(eventName, handleEvent);
            socket.off("game-error", handleError);
        }

        socket.once(eventName, handleEvent);
        socket.once("game-error", handleError);
    });
}

async function joinMatch(socket, name) {
    const event = waitForEvent(socket, "joined-match");

    socket.emit("join-match", { matchId });

    const response = await event;

    if (!response.success) {
        throw new Error(`${name} failed to join match`);
    }

    console.log(`${name} joined match successfully`);
}

async function startAircraft() {
    const event1 = waitForEvent(player1, "aircraft-started");
    const event2 = waitForEvent(player2, "aircraft-started");

    player1.emit("start-aircraft-drop");

    const [result1, result2] = await Promise.all([
        event1,
        event2
    ]);

    if (
        !result1.success ||
        !result2.success ||
        result1.matchId !== matchId ||
        result2.matchId !== matchId ||
        result1.lootCount !== 300 ||
        result2.lootCount !== 300
    ) {
        throw new Error("Aircraft start verification failed");
    }

    console.log("Aircraft started successfully");
    console.log("Player 1 received 300 loot");
    console.log("Player 2 received 300 loot");

    return result1;
}

async function jumpPlayer(socket, name, progress) {
    const event = waitForEvent(socket, "jump-started");

    socket.emit("jump-from-aircraft", { progress });

    const result = await event;

    if (!result.success || result.state !== "falling") {
        throw new Error(`${name} jump failed`);
    }

    console.log(`${name} jumped successfully`);
    return result;
}

async function deployPlayerParachute(socket, name) {
    const event = waitForEvent(socket, "parachute-deployed");

    socket.emit("deploy-parachute");

    const result = await event;

    if (!result.success || result.state !== "parachuting") {
        throw new Error(`${name} parachute deployment failed`);
    }

    console.log(`${name} deployed parachute successfully`);
}

async function movePlayer(socket, name, position, expectedState) {
    const event = waitForEvent(socket, "player-drop-position");

    socket.emit("drop-position-update", { position });

    const result = await event;

    if (
        result.playerId === undefined ||
        result.position.y !== position.y ||
        result.state !== expectedState
    ) {
        throw new Error(
            `${name} drop position verification failed at altitude ${position.y}`
        );
    }

    console.log(
        `${name}: altitude ${result.position.y}, state ${result.state}`
    );

    return result;
}

async function testPlayerDrop(socket, name, progress) {
    console.log(`\n--- ${name} DROP TEST ---`);

    const jump = await jumpPlayer(socket, name, progress);

    const x = jump.position.x;
    const z = jump.position.z;

    // Controlled descent: maximum 200 vertical units per update.
    for (const y of [1300, 1100, 900, 700, 500]) {
        await movePlayer(
            socket,
            name,
            { x, y, z },
            "falling"
        );
    }

    await deployPlayerParachute(socket, name);

    for (const y of [300, 100]) {
        await movePlayer(
            socket,
            name,
            { x, y, z },
            "parachuting"
        );
    }

    const landing = await movePlayer(
        socket,
        name,
        { x, y: 5, z },
        "landed"
    );

    console.log(`${name} landed successfully`);

    return landing;
}

async function verifyDatabase() {
    const { data, error } = await supabaseAdmin
        .from("match_players")
        .select(
            "player_id,current_x,current_y,current_z,is_alive"
        )
        .eq("match_id", matchId)
        .in("player_id", [1, 2]);

    if (error) {
        throw error;
    }

    console.log("\n--- SUPABASE LANDING POSITIONS ---");
    console.table(data);

    if (!data || data.length !== 2) {
        throw new Error("Expected two player records in Supabase");
    }

    for (const playerId of [1, 2]) {
        const row = data.find(p => Number(p.player_id) === playerId);

        if (!row || Number(row.current_y) !== 5) {
            throw new Error(
                `Player ${playerId} landing position was not saved correctly`
            );
        }
    }

    console.log("Both landing positions verified in Supabase");
}

async function runTest() {
    try {
        if (
            !matchId ||
            !process.env.PLAYER1_SOCKET_TOKEN ||
            !process.env.PLAYER2_SOCKET_TOKEN
        ) {
            throw new Error("Required configuration missing in .env");
        }

        console.log("\n==================================");
        console.log(" INDIAN BATTLE FIELDS");
        console.log(" TWO PLAYER AIRCRAFT DROP TEST");
        console.log("==================================\n");

        player1 = await connectPlayer(
            process.env.PLAYER1_SOCKET_TOKEN,
            "Player 1"
        );

        player2 = await connectPlayer(
            process.env.PLAYER2_SOCKET_TOKEN,
            "Player 2"
        );

        await joinMatch(player1, "Player 1");
        await joinMatch(player2, "Player 2");

        console.log("\nBoth players joined.");

        await startAircraft();

        await testPlayerDrop(player1, "Player 1", 0.45);
        await testPlayerDrop(player2, "Player 2", 0.55);

        await verifyDatabase();

        console.log("\n==================================");
        console.log(" ALL AIRCRAFT DROP TESTS PASSED");
        console.log("==================================");

    } catch (error) {
        console.error("\nTEST FAILED:", error.message);
    } finally {
        if (player1) player1.disconnect();
        if (player2) player2.disconnect();

        console.log("\nTest connections closed.");
    }
}

runTest();
