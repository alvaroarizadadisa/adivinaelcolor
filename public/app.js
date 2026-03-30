const DEFAULT_LOCAL_BACKEND = "http://localhost:3000";
const PROD_BACKEND = "https://adivinaelcolor.onrender.com";

const IS_LOCAL =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

const SOCKET_URL = IS_LOCAL ? DEFAULT_LOCAL_BACKEND : PROD_BACKEND;

const socket = io(SOCKET_URL, {
    transports: ["websocket", "polling"]
});

const SESSION_KEY = "colors_y_clues_session_token";
const NICKNAME_KEY = "colors_y_clues_nickname";
const CHAT_OPEN_KEY = "colors_y_clues_chat_open";

const joinScreen = document.getElementById("joinScreen");
const mainScreen = document.getElementById("mainScreen");

const nicknameInput = document.getElementById("nicknameInput");
const joinBtn = document.getElementById("joinBtn");
const joinError = document.getElementById("joinError");

const playerCount = document.getElementById("playerCount");
const readyCount = document.getElementById("readyCount");
const roundNumber = document.getElementById("roundNumber");
const playersList = document.getElementById("playersList");
const scoreList = document.getElementById("scoreList");
const readyBtn = document.getElementById("readyBtn");
const lobbyControls = document.getElementById("lobbyControls");

const phaseTitle = document.getElementById("phaseTitle");
const phaseDescription = document.getElementById("phaseDescription");
const turnBadge = document.getElementById("turnBadge");

const clueBox = document.getElementById("clueBox");
const clue1Text = document.getElementById("clue1Text");
const clue2Text = document.getElementById("clue2Text");
const clueError = document.getElementById("clueError");

const controlPanel = document.getElementById("controlPanel");
const topCoords = document.getElementById("topCoords");
const leftCoords = document.getElementById("leftCoords");
const boardEl = document.getElementById("board");

const scoringPanel = document.getElementById("scoringPanel");
const winnerBanner = document.getElementById("winnerBanner");

const resetPanel = document.getElementById("resetPanel");
const resetPanelContent = document.getElementById("resetPanelContent");

const chatWindow = document.getElementById("chatWindow");
const chatToggleBtn = document.getElementById("chatToggleBtn");
const chatMinimizeBtn = document.getElementById("chatMinimizeBtn");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");
const chatError = document.getElementById("chatError");
const chatStatus = document.getElementById("chatStatus");

let myId = null;
let myPlayerKey = null;
let joined = false;
let latestState = null;
let localSelectedTarget = null;
let localGuess = null;
let attemptedAutoJoin = false;
let chatHistory = [];

nicknameInput.value = localStorage.getItem(NICKNAME_KEY) || "";

function escapeHtml(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function numberToLetters(n) {
    let num = n + 1;
    let result = "";

    while (num > 0) {
        num -= 1;
        result = String.fromCharCode(65 + (num % 26)) + result;
        num = Math.floor(num / 26);
    }

    return result;
}

function coordText(x, y) {
    return `${numberToLetters(x)}${y + 1}`;
}

function formatChatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function showJoin() {
    joinScreen.classList.remove("hidden");
    mainScreen.classList.add("hidden");
}

function showMain() {
    joinScreen.classList.add("hidden");
    mainScreen.classList.remove("hidden");
}

function getSessionToken() {
    return localStorage.getItem(SESSION_KEY) || "";
}

function saveSessionToken(token) {
    if (token) {
        localStorage.setItem(SESSION_KEY, token);
    }
}

function getStoredNickname() {
    return localStorage.getItem(NICKNAME_KEY) || "";
}

function getMe() {
    return latestState?.players?.find((p) => p.playerKey === myPlayerKey) || null;
}

function getRound() {
    return latestState?.round || null;
}

function isClueGiver() {
    return latestState?.currentClueGiverPlayerKey === myPlayerKey;
}

function getMyGuessData() {
    const round = getRound();
    if (!round) return null;
    return round.guesses?.[myPlayerKey] || null;
}

function showMarkerAlreadyAt(x, y, guesses) {
    return Object.values(guesses).some((guessInfo) => {
        return guessInfo.visible && guessInfo.visible.x === x && guessInfo.visible.y === y;
    });
}

function canClickBoardCell() {
    if (!latestState || !joined) return false;

    const phase = latestState.phase;

    if (phase === "chooseTarget" && isClueGiver()) return true;
    if ((phase === "guess1" || phase === "guess2") && !isClueGiver()) return true;

    return false;
}

function renderCoords() {
    if (!latestState?.board) return;

    topCoords.innerHTML = "";
    leftCoords.innerHTML = "";

    for (let x = 0; x < latestState.board[0].length; x += 1) {
        const div = document.createElement("div");
        div.className = "coord";
        div.textContent = numberToLetters(x);
        topCoords.appendChild(div);
    }

    for (let y = 0; y < latestState.board.length; y += 1) {
        const div = document.createElement("div");
        div.className = "coord";
        div.textContent = y + 1;
        leftCoords.appendChild(div);
    }
}

function getCellColor(x, y) {
    return latestState.board[y][x].color;
}

function handleBoardCellClick(x, y) {
    clueError.textContent = "";

    if (latestState.phase === "chooseTarget" && isClueGiver()) {
        localSelectedTarget = { x, y };
        renderControlPanel();
        return;
    }

    if ((latestState.phase === "guess1" || latestState.phase === "guess2") && !isClueGiver()) {
        localGuess = { x, y };
        socket.emit("submit_guess", { x, y });
        renderBoard();
        renderControlPanel();
    }
}

function renderBoard() {
    if (!latestState?.board) return;

    const round = getRound();
    const showTarget = round?.target;
    const guesses = round?.guesses || {};

    boardEl.innerHTML = "";

    for (let y = 0; y < latestState.board.length; y += 1) {
        for (let x = 0; x < latestState.board[y].length; x += 1) {
            const cell = document.createElement("div");
            cell.className = "cell";
            cell.style.background = latestState.board[y][x].color;
            cell.title = coordText(x, y);

            if (!canClickBoardCell()) {
                cell.classList.add("disabled");
            }

            cell.addEventListener("click", () => {
                if (!canClickBoardCell()) return;
                handleBoardCellClick(x, y);
            });

            if (showTarget && showTarget.x === x && showTarget.y === y) {
                const marker = document.createElement("div");
                marker.className = "marker target";
                cell.appendChild(marker);
            }

            Object.entries(guesses).forEach(([playerKey, guessInfo]) => {
                if (!guessInfo.visible) return;
                if (guessInfo.visible.x !== x || guessInfo.visible.y !== y) return;

                const marker = document.createElement("div");
                marker.className = "marker";
                marker.style.background =
                    playerKey === myPlayerKey ? "rgba(255,255,255,0.95)" : "rgba(17,17,17,0.85)";
                marker.title = `${guessInfo.nickname}: ${coordText(x, y)}`;
                cell.appendChild(marker);
            });

            if (
                localGuess &&
                localGuess.x === x &&
                localGuess.y === y &&
                !showMarkerAlreadyAt(x, y, guesses)
            ) {
                const marker = document.createElement("div");
                marker.className = "marker";
                marker.style.background = "rgba(255,255,255,0.95)";
                cell.appendChild(marker);
            }

            boardEl.appendChild(cell);
        }
    }
}

function renderPlayers(players, phase) {
    playersList.innerHTML = "";

    players.forEach((player) => {
        const li = document.createElement("li");
        li.className = "player-item";

        const left = document.createElement("div");
        left.className = "player-name";
        left.textContent = player.nickname + (player.playerKey === myPlayerKey ? " (tú)" : "");

        const right = document.createElement("div");
        right.className = "player-state";

        if (!player.connected) {
            right.classList.add("disconnected");
            right.textContent = "Reconectando";
        } else if (phase === "lobby") {
            right.classList.add(player.ready ? "ready" : "waiting");
            right.textContent = player.ready ? "Listo" : "Esperando";
        } else {
            right.classList.add("waiting");
            right.textContent = `${player.score} pts`;
        }

        li.appendChild(left);
        li.appendChild(right);
        playersList.appendChild(li);
    });
}

function renderScores(players) {
    scoreList.innerHTML = "";

    const ordered = [...players]
        .filter((p) => p.connected)
        .sort((a, b) => b.score - a.score);

    ordered.forEach((player) => {
        const li = document.createElement("li");
        li.className = "score-item";

        const left = document.createElement("div");
        left.className = "score-name";
        left.textContent = player.nickname + (player.playerKey === myPlayerKey ? " (tú)" : "");

        const right = document.createElement("div");
        right.className = "score-points";
        right.textContent = `${player.score} pts`;

        li.appendChild(left);
        li.appendChild(right);
        scoreList.appendChild(li);
    });
}

function renderClues() {
    const round = getRound();

    if (!round || (!round.clue1 && !round.clue2)) {
        clueBox.classList.add("hidden");
        clue1Text.textContent = "-";
        clue2Text.textContent = "-";
        return;
    }

    clueBox.classList.remove("hidden");
    clue1Text.textContent = round.clue1 || "-";
    clue2Text.textContent = round.clue2 || "-";
}

function renderPhaseTexts() {
    const phase = latestState.phase;
    const round = getRound();
    const clueGiverName = round?.clueGiverNickname || "—";

    if (phase === "lobby") {
        phaseTitle.textContent = "LOBBY";
        phaseDescription.textContent = "Esperando a que todos estén listos.";
        turnBadge.textContent = "SIN TURNO";
        return;
    }

    if (phase === "chooseTarget") {
        phaseTitle.textContent = "ELEGIR COLOR";
        phaseDescription.textContent = isClueGiver()
            ? "Te toca elegir 1 de los 4 colores secretos."
            : `Esperando a que ${clueGiverName} elija el color secreto.`;
        turnBadge.textContent = `TURNO DE ${clueGiverName.toUpperCase()}`;
        return;
    }

    if (phase === "clue1") {
        phaseTitle.textContent = "PRIMERA PISTA";
        phaseDescription.textContent = isClueGiver()
            ? "Escribe una pista de 1 palabra."
            : `Esperando la primera pista de ${clueGiverName}.`;
        turnBadge.textContent = `TURNO DE ${clueGiverName.toUpperCase()}`;
        return;
    }

    if (phase === "guess1") {
        phaseTitle.textContent = "PRIMERA ADIVINANZA";
        phaseDescription.textContent = isClueGiver()
            ? "Esperando la primera elección del resto."
            : "Haz clic en una casilla y confirma tu primera elección.";
        turnBadge.textContent = `PISTA DE ${clueGiverName.toUpperCase()}`;
        return;
    }

    if (phase === "clue2") {
        phaseTitle.textContent = "SEGUNDA PISTA";
        phaseDescription.textContent = isClueGiver()
            ? "Escribe una pista de 2 palabras."
            : `Esperando la segunda pista de ${clueGiverName}.`;
        turnBadge.textContent = `TURNO DE ${clueGiverName.toUpperCase()}`;
        return;
    }

    if (phase === "guess2") {
        phaseTitle.textContent = "ADIVINANZA FINAL";
        phaseDescription.textContent = isClueGiver()
            ? "Esperando los bloqueos finales."
            : "Puedes mover tu marcador y bloquear la elección final.";
        turnBadge.textContent = `PISTA DE ${clueGiverName.toUpperCase()}`;
        return;
    }

    if (phase === "scoring") {
        phaseTitle.textContent = "PUNTUACIÓN";
        phaseDescription.textContent = "Mostrando resultado de la ronda.";
        turnBadge.textContent = `RONDA ${latestState.roundNumber}`;
        return;
    }

    if (phase === "finished") {
        phaseTitle.textContent = "PARTIDA TERMINADA";
        phaseDescription.textContent = "Ya hay ganador.";
        turnBadge.textContent = "FIN";
    }
}

function renderTargetOptions(options, selectedTarget) {
    return `
    <div>
      <h3>ELIGE EL COLOR SECRETO</h3>
      <p class="info-text">Selecciona una de estas 4 opciones y confirma.</p>
      <div class="options-grid">
        ${options.map((option) => {
        const selected =
            selectedTarget &&
            selectedTarget.x === option.x &&
            selectedTarget.y === option.y;

        return `
            <button
              class="option-color ${selected ? "selected" : ""}"
              data-role="target-option"
              data-x="${option.x}"
              data-y="${option.y}"
              style="background:${escapeHtml(getCellColor(option.x, option.y))}"
              title="${coordText(option.x, option.y)}"
            ></button>
          `;
    }).join("")}
      </div>
      <div style="margin-top:12px">
        <button id="confirmTargetBtn" ${selectedTarget ? "" : "disabled"}>Confirmar color</button>
      </div>
    </div>
  `;
}

function renderControlPanel() {
    const phase = latestState.phase;
    const round = getRound();
    const myGuessData = getMyGuessData();

    controlPanel.innerHTML = "";

    if (phase === "lobby") {
        controlPanel.innerHTML = `
        <p class="info-text">Para comenzar la partida todos los jugadores de la sala deben pulsar "Estoy listo".</p>
    `;
        return;
    }

    if (phase === "chooseTarget") {
        if (isClueGiver()) {
            controlPanel.innerHTML = renderTargetOptions(round.targetOptions || [], localSelectedTarget);

            controlPanel.querySelectorAll('[data-role="target-option"]').forEach((btn) => {
                btn.addEventListener("click", () => {
                    localSelectedTarget = {
                        x: Number(btn.dataset.x),
                        y: Number(btn.dataset.y)
                    };
                    renderControlPanel();
                });
            });

            const confirmBtn = document.getElementById("confirmTargetBtn");
            if (confirmBtn) {
                confirmBtn.addEventListener("click", () => {
                    if (!localSelectedTarget) return;
                    socket.emit("select_target", localSelectedTarget);
                });
            }
        } else {
            controlPanel.innerHTML = `
        <p class="info-text">El jugador de la pista está eligiendo el color secreto.</p>
      `;
        }
        return;
    }

    if (phase === "clue1") {
        if (isClueGiver()) {
            controlPanel.innerHTML = `
        <div>
          <h3>PRIMERA PISTA</h3>
          <p class="info-text">Exactamente 1 palabra. No se permiten nombres de colores ni direcciones.</p>
          <div class="form-inline">
            <input id="clue1Input" maxlength="30" placeholder="Ejemplo: cereza" />
            <button id="sendClue1Btn">Enviar pista</button>
          </div>
        </div>
      `;

            const sendBtn = document.getElementById("sendClue1Btn");
            const input = document.getElementById("clue1Input");

            sendBtn.addEventListener("click", () => {
                clueError.textContent = "";
                socket.emit("submit_clue1", { clue: input.value.trim() });
            });

            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") sendBtn.click();
            });
        } else {
            controlPanel.innerHTML = `
        <p class="info-text">Espera a que llegue la primera pista.</p>
      `;
        }
        return;
    }

    if (phase === "guess1") {
        if (isClueGiver()) {
            controlPanel.innerHTML = `
        <p class="info-text">Esperando las primeras elecciones del resto de jugadores.</p>
      `;
        } else {
            controlPanel.innerHTML = `
        <div>
          <h3>TU PRIMERA ELECCIÓN</h3>
          <p class="info-text">Haz clic en una casilla del tablero y confírmala.</p>
          <div class="legend">
            <div class="legend-item">
              Selección actual: ${localGuess ? coordText(localGuess.x, localGuess.y) : "ninguna"}
            </div>
            <div class="legend-item">
              Bloqueada: ${myGuessData?.firstLocked ? "sí" : "no"}
            </div>
          </div>
          <div style="margin-top:12px">
            <button id="lockFirstBtn" ${localGuess ? "" : "disabled"} ${myGuessData?.firstLocked ? "disabled" : ""}>
              Confirmar primera elección
            </button>
          </div>
        </div>
      `;

            const btn = document.getElementById("lockFirstBtn");
            if (btn) {
                btn.addEventListener("click", () => {
                    socket.emit("lock_first_guess");
                });
            }
        }
        return;
    }

    if (phase === "clue2") {
        if (isClueGiver()) {
            controlPanel.innerHTML = `
        <div>
          <h3>SEGUNDA PISTA</h3>
          <p class="info-text">Exactamente 2 palabras. No se permiten nombres de colores ni direcciones.</p>
          <div class="form-inline">
            <input id="clue2Input" maxlength="50" placeholder="Ejemplo: fruta madura" />
            <button id="sendClue2Btn">Enviar pista</button>
          </div>
        </div>
      `;

            const sendBtn = document.getElementById("sendClue2Btn");
            const input = document.getElementById("clue2Input");

            sendBtn.addEventListener("click", () => {
                clueError.textContent = "";
                socket.emit("submit_clue2", { clue: input.value.trim() });
            });

            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") sendBtn.click();
            });
        } else {
            controlPanel.innerHTML = `
        <p class="info-text">Espera a la segunda pista para afinar la elección.</p>
      `;
        }
        return;
    }

    if (phase === "guess2") {
        if (isClueGiver()) {
            controlPanel.innerHTML = `
        <p class="info-text">Esperando a que todos bloqueen su elección final.</p>
      `;
        } else {
            controlPanel.innerHTML = `
        <div>
          <h3>ELECCIÓN FINAL</h3>
          <p class="info-text">Puedes mover tu marcador y bloquear la definitiva.</p>
          <div class="legend">
            <div class="legend-item">
              Selección actual: ${localGuess ? coordText(localGuess.x, localGuess.y) : "ninguna"}
            </div>
            <div class="legend-item">
              Final bloqueada: ${myGuessData?.finalLocked ? "sí" : "no"}
            </div>
          </div>
          <div style="margin-top:12px">
            <button id="lockFinalBtn" ${localGuess ? "" : "disabled"} ${myGuessData?.finalLocked ? "disabled" : ""}>
              Confirmar elección final
            </button>
          </div>
        </div>
      `;

            const btn = document.getElementById("lockFinalBtn");
            if (btn) {
                btn.addEventListener("click", () => {
                    socket.emit("lock_final_guess");
                });
            }
        }
        return;
    }

    if (phase === "scoring") {
        controlPanel.innerHTML = `
      <div>
        <p class="info-text">Mostrando puntuación. La siguiente ronda arrancará en unos segundos.</p>
        <button id="requestResetBtn">Solicitar reinicio de partida</button>
      </div>
    `;

        const btn = document.getElementById("requestResetBtn");
        btn.addEventListener("click", () => {
            socket.emit("request_reset_game");
        });
        return;
    }

    if (phase === "finished") {
        controlPanel.innerHTML = `
      <div>
        <p class="info-text">La partida ha terminado. Puedes solicitar reinicio para volver al lobby con los mismos jugadores.</p>
        <button id="requestResetBtn">Solicitar reinicio de partida</button>
      </div>
    `;

        const btn = document.getElementById("requestResetBtn");
        btn.addEventListener("click", () => {
            socket.emit("request_reset_game");
        });
    }
}

function renderScoring() {
    const round = getRound();
    const scoring = round?.scoring;

    if (!scoring || (latestState.phase !== "scoring" && latestState.phase !== "finished")) {
        scoringPanel.classList.add("hidden");
        scoringPanel.innerHTML = "";
        return;
    }

    scoringPanel.classList.remove("hidden");
    scoringPanel.innerHTML = `
    <h3>RESULTADO DE LA RONDA</h3>
    <p>
      <strong>${escapeHtml(scoring.clueGiverNickname)}</strong> gana
      <strong>${scoring.clueGiverPoints}</strong> punto(s) por jugadores dentro del área 3x3.
    </p>
    <ul class="scoring-list">
      ${scoring.results.map((result) => `
        <li class="scoring-item">
          <span>${escapeHtml(result.nickname)} → ${coordText(result.guess.x, result.guess.y)}</span>
          <strong>+${result.points} pts</strong>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderWinner() {
    if (!latestState.winner || latestState.phase !== "finished") {
        winnerBanner.classList.add("hidden");
        winnerBanner.innerHTML = "";
        return;
    }

    winnerBanner.classList.remove("hidden");
    winnerBanner.innerHTML = `
    Ganador: <strong>${escapeHtml(latestState.winner.nickname)}</strong>
    con <strong>${latestState.winner.score}</strong> puntos.
  `;
}

function renderResetVote() {
    const resetVote = latestState.resetVote;

    if (!resetVote || !resetVote.active) {
        resetPanel.classList.add("hidden");
        resetPanelContent.innerHTML = "";
        return;
    }

    resetPanel.classList.remove("hidden");

    if (resetVote.acceptedByMe) {
        resetPanelContent.innerHTML = `
      <div class="reset-box">
        <p>
          <strong>${escapeHtml(resetVote.requestedByNickname)}</strong> ha pedido reiniciar la partida.
        </p>
        <p>Has aceptado. Votos: <strong>${resetVote.yesCount}/${resetVote.totalCount}</strong></p>
      </div>
    `;
        return;
    }

    resetPanelContent.innerHTML = `
    <div class="reset-box">
      <p>
        <strong>${escapeHtml(resetVote.requestedByNickname)}</strong> ha pulsado reiniciar partida.
        ¿Estás de acuerdo?
      </p>
      <p>Votos: <strong>${resetVote.yesCount}/${resetVote.totalCount}</strong></p>
      <button id="acceptResetBtn" class="reset-yes">Sí, reiniciar</button>
    </div>
  `;

    const btn = document.getElementById("acceptResetBtn");
    btn.addEventListener("click", () => {
        socket.emit("accept_reset_game");
    });
}

function renderChatWindowState() {
    const isOpen = localStorage.getItem(CHAT_OPEN_KEY) !== "0";

    if (!chatWindow) return;

    chatWindow.classList.toggle("minimized", !isOpen);
    if (chatToggleBtn) {
        chatToggleBtn.textContent = isOpen ? "−" : "+";
        chatToggleBtn.title = isOpen ? "Minimizar chat" : "Abrir chat";
    }
}

function toggleChatWindow() {
    const isOpen = localStorage.getItem(CHAT_OPEN_KEY) !== "0";
    localStorage.setItem(CHAT_OPEN_KEY, isOpen ? "0" : "1");
    renderChatWindowState();
}

function renderChatStatus() {
    if (!chatStatus) return;

    if (!joined) {
        chatStatus.textContent = "Debes entrar en la sala para escribir.";
        return;
    }

    if (!socket.connected) {
        chatStatus.textContent = "Reconectando chat...";
        return;
    }

    chatStatus.textContent = "Conectado";
}

function renderChat() {
    if (!chatMessages) return;

    if (!chatHistory.length) {
        chatMessages.innerHTML = `<div class="chat-empty">Todavía no hay mensajes.</div>`;
        renderChatStatus();
        return;
    }

    chatMessages.innerHTML = chatHistory.map((message) => {
        const mine = message.playerKey === myPlayerKey;

        return `
        <article class="chat-message ${mine ? "mine" : ""}">
          <div class="chat-message-top">
            <strong class="chat-author">${escapeHtml(message.nickname)}${mine ? " (tú)" : ""}</strong>
            <span class="chat-time">${escapeHtml(formatChatTime(message.createdAt))}</span>
          </div>
          <div class="chat-message-text">${escapeHtml(message.text)}</div>
        </article>
      `;
    }).join("");

    chatMessages.scrollTop = chatMessages.scrollHeight;
    renderChatStatus();
}

function syncLocalSelectionsFromState() {
    const myGuess = getMyGuessData();

    if (myGuess?.current) {
        localGuess = { ...myGuess.current };
    }

    if (latestState.phase === "chooseTarget") {
        localGuess = null;
    }

    if (latestState.phase === "lobby") {
        localGuess = null;
        localSelectedTarget = null;
    }

    if (latestState.phase === "clue1" || latestState.phase === "clue2") {
        localSelectedTarget = null;
    }
}

function renderLobbyControls() {
    if (latestState.phase === "lobby") {
        lobbyControls.classList.remove("hidden");
        const me = getMe();

        if (me?.ready) {
            readyBtn.textContent = "Ya estoy listo";
            readyBtn.style.background = "var(--green)";
            readyBtn.style.color = "#111";
        } else {
            readyBtn.textContent = "Estoy listo";
            readyBtn.style.background = "";
            readyBtn.style.color = "";
        }
    } else {
        lobbyControls.classList.add("hidden");
    }
}

function renderState(state) {
    latestState = state;

    if (state.meId) {
        myId = state.meId;
    }

    if (state.mePlayerKey) {
        myPlayerKey = state.mePlayerKey;
    }

    if (joined) {
        showMain();
    }

    playerCount.textContent = state.totalCount;
    readyCount.textContent = `${state.readyCount}/${state.totalCount}`;
    readyCount.className = `pill ${state.canStart ? "green" : "dark"}`;
    roundNumber.textContent = state.roundNumber;

    renderPlayers(state.players, state.phase);
    renderScores(state.players);
    renderLobbyControls();
    renderPhaseTexts();
    renderClues();
    syncLocalSelectionsFromState();
    renderControlPanel();
    renderCoords();
    renderBoard();
    renderScoring();
    renderWinner();
    renderResetVote();
    renderChatStatus();
}

function joinWithNickname() {
    const nickname = nicknameInput.value.trim();
    joinError.textContent = "";

    if (!nickname) {
        joinError.textContent = "Escribe un mote.";
        return;
    }

    localStorage.setItem(NICKNAME_KEY, nickname);

    socket.emit("join_room", {
        nickname,
        sessionToken: getSessionToken()
    });
}

function tryAutoJoin() {
    if (attemptedAutoJoin) return;
    attemptedAutoJoin = true;

    const nickname = getStoredNickname();
    const sessionToken = getSessionToken();

    if (!nickname || !sessionToken) return;

    socket.emit("join_room", {
        nickname,
        sessionToken
    });
}

function sendChatMessage() {
    if (!joined) {
        chatError.textContent = "Primero tienes que entrar en la sala.";
        renderChatStatus();
        return;
    }

    if (!socket.connected) {
        chatError.textContent = "No hay conexión con el servidor.";
        renderChatStatus();
        return;
    }

    const text = chatInput.value.trim();
    chatError.textContent = "";

    if (!text) return;

    socket.emit("send_chat_message", { text });
    chatInput.value = "";
}

joinBtn.addEventListener("click", joinWithNickname);

nicknameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        joinWithNickname();
    }
});

readyBtn.addEventListener("click", () => {
    if (!joined || latestState?.phase !== "lobby") return;
    socket.emit("toggle_ready");
});

if (sendChatBtn) {
    sendChatBtn.addEventListener("click", sendChatMessage);
}

if (chatInput) {
    chatInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            sendChatMessage();
        }
    });
}

if (chatToggleBtn) {
    chatToggleBtn.addEventListener("click", toggleChatWindow);
}

if (chatMinimizeBtn) {
    chatMinimizeBtn.addEventListener("click", toggleChatWindow);
}

socket.on("connect", () => {
    attemptedAutoJoin = false;
    tryAutoJoin();
    renderChatStatus();
});

socket.on("disconnect", () => {
    renderChatStatus();
});

socket.on("joined_ok", ({ id, playerKey, sessionToken }) => {
    myId = id;
    myPlayerKey = playerKey;
    joined = true;
    saveSessionToken(sessionToken);
    showMain();
    renderChatStatus();
});

socket.on("join_error", ({ message }) => {
    joinError.textContent = message;
});

socket.on("clue_error", ({ message }) => {
    clueError.textContent = message;
});

socket.on("chat_error", ({ message }) => {
    chatError.textContent = message;
});

socket.on("chat_history", (messages) => {
    chatHistory = Array.isArray(messages) ? messages : [];
    renderChat();
});

socket.on("chat_message", (message) => {
    chatHistory.push(message);
    if (chatHistory.length > 50) {
        chatHistory = chatHistory.slice(-50);
    }
    renderChat();
});

socket.on("state", (state) => {
    renderState(state);
});

showJoin();
renderChatWindowState();
renderChat();