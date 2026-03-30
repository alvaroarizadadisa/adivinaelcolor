const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const CLIENT_URL = process.env.CLIENT_URL || "*";

const MIN_PLAYERS = 2;
const MAX_SCORE = 25;
const BOARD_ROWS = 16;
const BOARD_COLS = 30;
const TARGET_OPTIONS_COUNT = 4;
const RECONNECT_GRACE_MS = 60_000;

const FORBIDDEN_CLUE_WORDS = new Set([
    "rojo", "roja", "rojos", "rojas",
    "azul", "azules",
    "verde", "verdes",
    "amarillo", "amarilla", "amarillos", "amarillas",
    "naranja", "naranjas",
    "rosa", "rosado", "rosada", "rosas", "rosados", "rosadas",
    "morado", "morada", "morados", "moradas",
    "violeta", "violetas",
    "lila", "lilas",
    "fucsia",
    "magenta",
    "cian",
    "turquesa",
    "celeste",
    "marron", "marrón", "marrones",
    "beige",
    "ocre",
    "gris", "grises",
    "negro", "negra", "negros", "negras",
    "blanco", "blanca", "blancos", "blancas",
    "dorado", "dorada", "dorados", "doradas",
    "plateado", "plateada", "plateados", "plateadas",
    "claro", "clara", "claros", "claras",
    "oscuro", "oscura", "oscuros", "oscuras",
    "izquierda", "derecha",
    "arriba", "abajo",
    "superior", "inferior",
    "esquina", "centro",
    "norte", "sur", "este", "oeste"
]);

function normalizeWord(word) {
    return String(word || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function splitWords(text) {
    return String(text || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function validateClue(clue, expectedWordCount) {
    const words = splitWords(clue);

    if (words.length !== expectedWordCount) {
        return {
            ok: false,
            message:
                expectedWordCount === 1
                    ? "La primera pista debe tener exactamente 1 palabra."
                    : "La segunda pista debe tener exactamente 2 palabras."
        };
    }

    for (const word of words) {
        const normalized = normalizeWord(word);
        if (FORBIDDEN_CLUE_WORDS.has(normalized)) {
            return {
                ok: false,
                message: `La palabra "${word}" no está permitida como pista.`
            };
        }
    }

    return { ok: true };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function randomToken() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildBoard() {
    const board = [];

    for (let y = 0; y < BOARD_ROWS; y += 1) {
        const row = [];

        for (let x = 0; x < BOARD_COLS; x += 1) {
            const hue = Math.round((x / (BOARD_COLS - 1)) * 300 + 20);
            const saturation = Math.round(86 - (y / (BOARD_ROWS - 1)) * 36);
            const lightness = Math.round(31 + ((BOARD_ROWS - 1 - y) / (BOARD_ROWS - 1)) * 43);

            row.push({
                x,
                y,
                color: `hsl(${hue} ${saturation}% ${lightness}%)`
            });
        }

        board.push(row);
    }

    return board;
}

function createPlayer({ id, nickname, sessionToken }) {
    return {
        id,
        nickname,
        sessionToken,
        ready: false,
        score: 0,
        connected: true,
        disconnectTimer: null
    };
}

function createEmptyRound() {
    return {
        clueGiverId: null,
        targetOptions: [],
        target: null,
        clue1: "",
        clue2: "",
        guesses: {},
        scoring: null
    };
}

function createResetVote() {
    return {
        requestedById: null,
        votesYes: {}
    };
}

const room = {
    phase: "lobby",
    gameStarted: false,
    board: buildBoard(),
    players: [],
    currentClueGiverIndex: 0,
    roundNumber: 0,
    round: null,
    resetVote: createResetVote()
};

function activePlayers() {
    return room.players.filter((player) => player.connected);
}

function findPlayerBySocketId(id) {
    return room.players.find((player) => player.id === id);
}

function findPlayerBySessionToken(sessionToken) {
    return room.players.find((player) => player.sessionToken === sessionToken);
}

function findPlayerByNickname(nickname) {
    return room.players.find(
        (player) => player.nickname.toLowerCase() === String(nickname).toLowerCase()
    );
}

function getClueGiver() {
    const players = activePlayers();
    if (!players.length) return null;
    return players[room.currentClueGiverIndex] || players[0];
}

function everyoneReadyInLobby() {
    const players = activePlayers();
    return players.length >= MIN_PLAYERS && players.every((player) => player.ready);
}

function everyoneGuessedOnce() {
    if (!room.round) return false;
    const players = activePlayers().filter((p) => p.id !== room.round.clueGiverId);
    if (!players.length) return false;

    return players.every((player) => {
        const guess = room.round.guesses[player.id];
        return guess && guess.firstLocked;
    });
}

function everyoneLockedFinalGuess() {
    if (!room.round) return false;
    const players = activePlayers().filter((p) => p.id !== room.round.clueGiverId);
    if (!players.length) return false;

    return players.every((player) => {
        const guess = room.round.guesses[player.id];
        return guess && guess.finalLocked;
    });
}

function everyoneAcceptedReset() {
    const players = activePlayers();
    if (!players.length) return false;

    return players.every((player) => room.resetVote.votesYes[player.id] === true);
}

function distanceScore(target, guess) {
    const dx = Math.abs(target.x - guess.x);
    const dy = Math.abs(target.y - guess.y);
    const dist = Math.max(dx, dy);

    if (dist === 0) return 3;
    if (dist === 1) return 2;
    if (dist === 2) return 1;
    return 0;
}

function isInside3x3(target, guess) {
    const dx = Math.abs(target.x - guess.x);
    const dy = Math.abs(target.y - guess.y);
    return dx <= 1 && dy <= 1;
}

function buildRoundScoring() {
    const target = room.round.target;
    const clueGiver = room.players.find((player) => player.id === room.round.clueGiverId);

    if (!target || !clueGiver) return null;

    const players = activePlayers().filter((player) => player.id !== clueGiver.id);
    const results = [];
    let clueGiverPoints = 0;

    for (const player of players) {
        const guess = room.round.guesses[player.id];
        if (!guess || !guess.final) continue;

        const playerPoints = distanceScore(target, guess.final);

        if (isInside3x3(target, guess.final)) {
            clueGiverPoints += 1;
        }

        player.score += playerPoints;

        results.push({
            playerId: player.id,
            nickname: player.nickname,
            guess: guess.final,
            points: playerPoints
        });
    }

    clueGiver.score += clueGiverPoints;

    return {
        target,
        clueGiverId: clueGiver.id,
        clueGiverNickname: clueGiver.nickname,
        clueGiverPoints,
        results
    };
}

function getWinner() {
    return activePlayers().find((player) => player.score >= MAX_SCORE) || null;
}

function resetResetVote() {
    room.resetVote = createResetVote();
}

function startResetVote(requestedById) {
    room.resetVote = createResetVote();
    room.resetVote.requestedById = requestedById;
    room.resetVote.votesYes[requestedById] = true;
}

function fullResetToLobbyKeepPlayers() {
    room.phase = "lobby";
    room.gameStarted = false;
    room.currentClueGiverIndex = 0;
    room.roundNumber = 0;
    room.round = null;
    resetResetVote();

    for (const player of room.players) {
        player.ready = false;
        player.score = 0;
    }
}

function removePlayerPermanently(playerId) {
    const index = room.players.findIndex((player) => player.id === playerId);
    if (index === -1) return;

    const wasClueGiver = room.round && room.round.clueGiverId === playerId;
    room.players.splice(index, 1);

    const players = activePlayers();

    if (!players.length) {
        fullResetToLobbyKeepPlayers();
        room.players = [];
        return;
    }

    if (room.currentClueGiverIndex >= players.length) {
        room.currentClueGiverIndex = 0;
    }

    if (room.gameStarted && wasClueGiver) {
        startNextRound();
        return;
    }

    if (room.phase === "guess1" && everyoneGuessedOnce()) {
        room.phase = "clue2";
    }

    if (room.phase === "guess2" && everyoneLockedFinalGuess()) {
        finishRoundAndMaybeContinue();
        return;
    }

    if (room.resetVote.requestedById && everyoneAcceptedReset()) {
        fullResetToLobbyKeepPlayers();
    }
}

function pickTargetOptions() {
    const allCells = [];
    for (let y = 0; y < BOARD_ROWS; y += 1) {
        for (let x = 0; x < BOARD_COLS; x += 1) {
            allCells.push({ x, y });
        }
    }
    return shuffle(allCells).slice(0, TARGET_OPTIONS_COUNT);
}

function resetScoresAndReadyForNewGame() {
    for (const player of room.players) {
        player.score = 0;
        player.ready = false;
    }
}

function startNextRound() {
    const players = activePlayers();

    if (players.length < MIN_PLAYERS) {
        fullResetToLobbyKeepPlayers();
        emitStateToAll();
        return;
    }

    const clueGiver = getClueGiver();
    if (!clueGiver) {
        fullResetToLobbyKeepPlayers();
        emitStateToAll();
        return;
    }

    room.roundNumber += 1;
    room.round = createEmptyRound();
    room.round.clueGiverId = clueGiver.id;
    room.round.targetOptions = pickTargetOptions();
    room.phase = "chooseTarget";

    emitStateToAll();
}

function startGame() {
    room.gameStarted = true;
    room.phase = "chooseTarget";
    room.currentClueGiverIndex = 0;
    room.roundNumber = 0;
    resetScoresAndReadyForNewGame();
    resetResetVote();
    startNextRound();
}

function advanceClueGiver() {
    const players = activePlayers();
    if (!players.length) return;
    room.currentClueGiverIndex = (room.currentClueGiverIndex + 1) % players.length;
}

function finishRoundAndMaybeContinue() {
    room.round.scoring = buildRoundScoring();
    room.phase = "scoring";
    emitStateToAll();

    const winner = getWinner();
    if (winner) {
        room.phase = "finished";
        emitStateToAll();
        return;
    }

    setTimeout(() => {
        if (room.phase !== "scoring") return;
        advanceClueGiver();
        startNextRound();
    }, 7000);
}

function serializePlayer(player) {
    return {
        id: player.id,
        nickname: player.nickname,
        ready: player.ready,
        score: player.score,
        connected: player.connected
    };
}

function getPublicRoundFor(socketId) {
    if (!room.round) return null;

    const isClueGiver = socketId === room.round.clueGiverId;
    const publicGuesses = {};

    for (const player of activePlayers()) {
        if (player.id === room.round.clueGiverId) continue;

        const guess = room.round.guesses[player.id];
        if (!guess) continue;

        publicGuesses[player.id] = {
            nickname: player.nickname,
            visible:
                room.phase === "scoring" || room.phase === "finished"
                    ? guess.final || guess.current || null
                    : guess.current || null
        };
    }

    return {
        clueGiverId: room.round.clueGiverId,
        clueGiverNickname:
            room.players.find((player) => player.id === room.round.clueGiverId)?.nickname || "",
        targetOptions: isClueGiver ? room.round.targetOptions : [],
        target:
            room.phase === "scoring" || room.phase === "finished"
                ? room.round.target
                : null,
        clue1: room.round.clue1,
        clue2: room.round.clue2,
        guesses: publicGuesses,
        scoring: room.round.scoring
    };
}

function getResetVoteFor(socketId) {
    if (!room.resetVote.requestedById) return null;

    const requestedBy =
        room.players.find((player) => player.id === room.resetVote.requestedById)?.nickname || "Alguien";

    const acceptedIds = Object.keys(room.resetVote.votesYes);
    const players = activePlayers();

    return {
        active: true,
        requestedById: room.resetVote.requestedById,
        requestedByNickname: requestedBy,
        acceptedByMe: room.resetVote.votesYes[socketId] === true,
        yesCount: acceptedIds.length,
        totalCount: players.length
    };
}

function getPublicState(socketId = null) {
    const players = activePlayers();
    const readyCount = players.filter((p) => p.ready).length;
    const totalCount = players.length;
    const winner = getWinner();

    return {
        phase: room.phase,
        gameStarted: room.gameStarted,
        players: players.map(serializePlayer),
        readyCount,
        totalCount,
        canStart: totalCount >= MIN_PLAYERS && readyCount === totalCount,
        board: room.board,
        roundNumber: room.roundNumber,
        currentClueGiverId: room.round?.clueGiverId || null,
        meId: socketId,
        maxScore: MAX_SCORE,
        winner: winner
            ? {
                id: winner.id,
                nickname: winner.nickname,
                score: winner.score
            }
            : null,
        round: getPublicRoundFor(socketId),
        resetVote: getResetVoteFor(socketId)
    };
}

function emitStateToAll() {
    for (const socket of io.sockets.sockets.values()) {
        socket.emit("state", getPublicState(socket.id));
    }
}

io.on("connection", (socket) => {
    socket.emit("state", getPublicState(socket.id));

    socket.on("join_room", ({ nickname, sessionToken }) => {
        const cleanNickname = String(nickname || "").trim().slice(0, 20);
        const cleanToken = String(sessionToken || "").trim();

        if (!cleanNickname) {
            socket.emit("join_error", { message: "Tienes que escribir un mote válido." });
            return;
        }

        if (cleanToken) {
            const existingByToken = findPlayerBySessionToken(cleanToken);

            if (existingByToken) {
                if (existingByToken.disconnectTimer) {
                    clearTimeout(existingByToken.disconnectTimer);
                    existingByToken.disconnectTimer = null;
                }

                existingByToken.id = socket.id;
                existingByToken.connected = true;

                socket.emit("joined_ok", {
                    id: socket.id,
                    sessionToken: existingByToken.sessionToken,
                    reconnected: true
                });

                emitStateToAll();
                return;
            }
        }

        if (room.gameStarted) {
            socket.emit("join_error", {
                message: "La partida ya ha empezado. Espera al reinicio de la partida."
            });
            return;
        }

        const repeated = activePlayers().some(
            (player) => player.nickname.toLowerCase() === cleanNickname.toLowerCase()
        );

        if (repeated) {
            socket.emit("join_error", { message: "Ese mote ya está en uso." });
            return;
        }

        const token = cleanToken || randomToken();
        const player = createPlayer({
            id: socket.id,
            nickname: cleanNickname,
            sessionToken: token
        });

        room.players.push(player);

        socket.emit("joined_ok", {
            id: socket.id,
            sessionToken: token,
            reconnected: false
        });

        emitStateToAll();
    });

    socket.on("toggle_ready", () => {
        if (room.gameStarted) return;

        const player = findPlayerBySocketId(socket.id);
        if (!player) return;

        player.ready = !player.ready;
        emitStateToAll();

        if (everyoneReadyInLobby()) {
            startGame();
        }
    });

    socket.on("select_target", ({ x, y }) => {
        if (room.phase !== "chooseTarget" || !room.round) return;
        if (socket.id !== room.round.clueGiverId) return;

        const valid = room.round.targetOptions.some((option) => option.x === x && option.y === y);
        if (!valid) return;

        room.round.target = { x, y };
        room.phase = "clue1";
        emitStateToAll();
    });

    socket.on("submit_clue1", ({ clue }) => {
        if (room.phase !== "clue1" || !room.round) return;
        if (socket.id !== room.round.clueGiverId) return;

        const cleanClue = String(clue || "").trim().slice(0, 30);
        const validation = validateClue(cleanClue, 1);

        if (!validation.ok) {
            socket.emit("clue_error", { message: validation.message });
            return;
        }

        room.round.clue1 = cleanClue;
        room.phase = "guess1";
        emitStateToAll();
    });

    socket.on("submit_clue2", ({ clue }) => {
        if (room.phase !== "clue2" || !room.round) return;
        if (socket.id !== room.round.clueGiverId) return;

        const cleanClue = String(clue || "").trim().slice(0, 50);
        const validation = validateClue(cleanClue, 2);

        if (!validation.ok) {
            socket.emit("clue_error", { message: validation.message });
            return;
        }

        room.round.clue2 = cleanClue;
        room.phase = "guess2";
        emitStateToAll();
    });

    socket.on("submit_guess", ({ x, y }) => {
        if (!room.round) return;
        if (socket.id === room.round.clueGiverId) return;
        if (room.phase !== "guess1" && room.phase !== "guess2") return;

        const player = findPlayerBySocketId(socket.id);
        if (!player || !player.connected) return;

        const safeX = clamp(Number(x), 0, BOARD_COLS - 1);
        const safeY = clamp(Number(y), 0, BOARD_ROWS - 1);

        if (!room.round.guesses[player.id]) {
            room.round.guesses[player.id] = {
                current: null,
                first: null,
                final: null,
                firstLocked: false,
                finalLocked: false
            };
        }

        const guess = room.round.guesses[player.id];

        if (room.phase === "guess1" && guess.firstLocked) return;
        if (room.phase === "guess2" && guess.finalLocked) return;

        guess.current = { x: safeX, y: safeY };
        emitStateToAll();
    });

    socket.on("lock_first_guess", () => {
        if (room.phase !== "guess1" || !room.round) return;
        if (socket.id === room.round.clueGiverId) return;

        const guess = room.round.guesses[socket.id];
        if (!guess || !guess.current) return;

        guess.first = { ...guess.current };
        guess.firstLocked = true;

        emitStateToAll();

        if (everyoneGuessedOnce()) {
            room.phase = "clue2";
            emitStateToAll();
        }
    });

    socket.on("lock_final_guess", () => {
        if (room.phase !== "guess2" || !room.round) return;
        if (socket.id === room.round.clueGiverId) return;

        const guess = room.round.guesses[socket.id];
        if (!guess || !guess.current) return;

        guess.final = { ...guess.current };
        guess.finalLocked = true;

        emitStateToAll();

        if (everyoneLockedFinalGuess()) {
            finishRoundAndMaybeContinue();
        }
    });

    socket.on("request_reset_game", () => {
        const player = findPlayerBySocketId(socket.id);
        if (!player || !room.gameStarted) return;

        startResetVote(player.id);
        emitStateToAll();
    });

    socket.on("accept_reset_game", () => {
        const player = findPlayerBySocketId(socket.id);
        if (!player || !room.resetVote.requestedById) return;

        room.resetVote.votesYes[player.id] = true;

        if (everyoneAcceptedReset()) {
            fullResetToLobbyKeepPlayers();
        }

        emitStateToAll();
    });

    socket.on("disconnect", () => {
        const player = findPlayerBySocketId(socket.id);
        if (!player) return;

        player.connected = false;

        player.disconnectTimer = setTimeout(() => {
            removePlayerPermanently(player.id);
            emitStateToAll();
        }, RECONNECT_GRACE_MS);

        emitStateToAll();
    });
});

server.listen(PORT, () => {
    console.log(`Servidor iniciado en http://localhost:${PORT}`);
    console.log(`CLIENT_URL permitido: ${CLIENT_URL}`);
});