// ==========================================
// INDIAN BATTLE FIELDS
// PARTIES (DUO / SQUAD TEAM FORMATION)
// ==========================================
// In-memory parties. A party queues together through quick
// match and is placed on the same team when the match
// starts (see battlefieldService.assignTeams).

const crypto = require("crypto");

const PARTY_SIZES = { solo: 1, duo: 2, squad: 4 };

const parties = new Map();      // partyId -> party
const playerParty = new Map();  // playerId -> partyId
const matchGroups = new Map();  // matchId -> [[playerId, ...], ...]

function generateCode() {
    return "P-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

function publicParty(party) {
    return party
        ? {
            partyId: party.id,
            code: party.code,
            leaderId: party.leaderId,
            gameMode: party.gameMode,
            members: [...party.members],
            maxSize: PARTY_SIZES[party.gameMode]
        }
        : null;
}

function getPartyForPlayer(playerId) {
    const partyId = playerParty.get(String(playerId));
    return partyId ? parties.get(partyId) || null : null;
}

function createParty(playerId, gameMode) {
    if (!["duo", "squad"].includes(gameMode)) {
        return { success: false, message: "Parties are for duo or squad" };
    }

    if (getPartyForPlayer(playerId)) {
        return { success: false, message: "Leave your current party first" };
    }

    const party = {
        id: crypto.randomUUID(),
        code: generateCode(),
        leaderId: String(playerId),
        gameMode,
        members: [String(playerId)],
        createdAt: Date.now()
    };

    parties.set(party.id, party);
    playerParty.set(String(playerId), party.id);

    return { success: true, party: publicParty(party) };
}

function joinParty(playerId, code) {
    if (getPartyForPlayer(playerId)) {
        return { success: false, message: "Leave your current party first" };
    }

    const party = [...parties.values()].find(
        p => p.code === String(code || "").toUpperCase()
    );

    if (!party) return { success: false, message: "Party not found" };

    if (party.members.length >= PARTY_SIZES[party.gameMode]) {
        return { success: false, message: "Party is full" };
    }

    party.members.push(String(playerId));
    playerParty.set(String(playerId), party.id);

    return { success: true, party: publicParty(party) };
}

function leaveParty(playerId) {
    const party = getPartyForPlayer(playerId);
    if (!party) return { success: false, message: "You are not in a party" };

    party.members = party.members.filter(id => id !== String(playerId));
    playerParty.delete(String(playerId));

    if (party.members.length === 0) {
        parties.delete(party.id);
        return { success: true, party: null };
    }

    if (party.leaderId === String(playerId)) {
        party.leaderId = party.members[0];
    }

    return { success: true, party: publicParty(party) };
}

// Remember which players queued together for a match.
function recordMatchGroup(matchId, playerIds) {
    const groups = matchGroups.get(matchId) || [];
    groups.push(playerIds.map(String));
    matchGroups.set(matchId, groups);
}

function getMatchGroups(matchId) {
    return matchGroups.get(matchId) || [];
}

function clearMatchGroups(matchId) {
    matchGroups.delete(matchId);
}

module.exports = {
    PARTY_SIZES,
    publicParty,
    getPartyForPlayer,
    createParty,
    joinParty,
    leaveParty,
    recordMatchGroup,
    getMatchGroups,
    clearMatchGroups
};
