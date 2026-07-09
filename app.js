const STORAGE_KEY = "pickleball-court-stack-v1";

const defaultState = {
  tab: "players",
  courtCount: 3,
  players: [],
  rounds: [],
  playerDraft: "",
  bulkDraft: "",
  toast: "",
};

let state = loadState();
let toastTimer = null;

const app = document.querySelector("#app");

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return { ...defaultState, ...saved, toast: "" };
  } catch {
    return { ...defaultState };
  }
}

function saveState() {
  const { toast, ...saved } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

function setState(next) {
  state = typeof next === "function" ? next(state) : { ...state, ...next };
  saveState();
  render();
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  state.toast = message;
  render();
  toastTimer = window.setTimeout(() => {
    state.toast = "";
    render();
  }, 2200);
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function playerName(playerId) {
  return state.players.find((player) => player.id === playerId)?.name || "Removed player";
}

function activePlayers() {
  return state.players.filter((player) => player.active);
}

function computeStats() {
  const stats = Object.fromEntries(
    state.players.map((player) => [
      player.id,
      { played: 0, wins: 0, losses: 0, rests: 0, last: "new" },
    ]),
  );

  for (const round of state.rounds) {
    for (const playerId of round.restIds) {
      if (stats[playerId]) {
        stats[playerId].rests += 1;
        if (stats[playerId].last === "new") {
          stats[playerId].last = "rest";
        }
      }
    }

    for (const match of round.matches) {
      if (!match.winner) continue;
      const winnerIds = match.winner === "A" ? match.teamA : match.teamB;
      const loserIds = match.winner === "A" ? match.teamB : match.teamA;

      for (const playerId of [...match.teamA, ...match.teamB]) {
        if (stats[playerId]) stats[playerId].played += 1;
      }

      for (const playerId of winnerIds) {
        if (stats[playerId]) {
          stats[playerId].wins += 1;
          stats[playerId].last = "win";
        }
      }

      for (const playerId of loserIds) {
        if (stats[playerId]) {
          stats[playerId].losses += 1;
          stats[playerId].last = "loss";
        }
      }
    }
  }

  return stats;
}

function rankForPlay(player, stats) {
  const record = stats[player.id];
  return [
    -record.rests,
    record.played,
    record.wins - record.losses,
    player.name.toLowerCase(),
  ];
}

function rankForCourt(player, stats) {
  const record = stats[player.id];
  const lastWeight = record.last === "win" ? 2 : record.last === "loss" ? 0 : 1;
  return [
    -(record.wins - record.losses) * 4 - lastWeight,
    record.played,
    player.name.toLowerCase(),
  ];
}

function compareRank(a, b, ranker, stats) {
  const left = ranker(a, stats);
  const right = ranker(b, stats);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function currentRound() {
  return state.rounds[state.rounds.length - 1] || null;
}

function roundComplete(round) {
  return Boolean(round?.matches.length) && round.matches.every((match) => match.winner);
}

function addPlayer(name) {
  const trimmed = name.trim();
  if (!trimmed) return;

  setState((current) => ({
    ...current,
    playerDraft: "",
    players: [
      ...current.players,
      {
        id: uid("player"),
        name: trimmed,
        active: true,
      },
    ],
  }));
}

function addBulkPlayers() {
  const names = state.bulkDraft
    .split(/[\n,;]+/)
    .map((name) => name.trim())
    .filter(Boolean);

  if (!names.length) return;

  setState((current) => ({
    ...current,
    bulkDraft: "",
    players: [
      ...current.players,
      ...names.map((name) => ({
        id: uid("player"),
        name,
        active: true,
      })),
    ],
  }));
  showToast(`${names.length} player${names.length === 1 ? "" : "s"} added`);
}

function togglePlayer(playerId) {
  setState((current) => ({
    ...current,
    players: current.players.map((player) =>
      player.id === playerId ? { ...player, active: !player.active } : player,
    ),
  }));
}

function removePlayer(playerId) {
  if (!window.confirm(`Remove ${playerName(playerId)} from the roster?`)) return;
  setState((current) => ({
    ...current,
    players: current.players.filter((player) => player.id !== playerId),
  }));
}

function startRound() {
  const lastRound = currentRound();
  if (lastRound && !roundComplete(lastRound)) {
    showToast("Finish the current round first");
    return;
  }

  const players = activePlayers();
  const maxSlots = Math.max(0, Math.floor(players.length / 4) * 4);
  const slots = Math.min(state.courtCount * 4, maxSlots);

  if (slots < 4) {
    showToast("At least 4 active players are needed");
    setState({ tab: "players" });
    return;
  }

  const stats = computeStats();
  const selected = [...players]
    .sort((a, b) => compareRank(a, b, rankForPlay, stats))
    .slice(0, slots);

  const selectedIds = new Set(selected.map((player) => player.id));
  const restIds = players
    .filter((player) => !selectedIds.has(player.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((player) => player.id);

  const courtOrdered = selected.sort((a, b) => compareRank(a, b, rankForCourt, stats));
  const matches = [];

  for (let index = 0; index < courtOrdered.length; index += 4) {
    const group = courtOrdered.slice(index, index + 4);
    matches.push({
      id: uid("match"),
      court: matches.length + 1,
      teamA: [group[0].id, group[3].id],
      teamB: [group[1].id, group[2].id],
      winner: null,
    });
  }

  setState((current) => ({
    ...current,
    tab: "courts",
    rounds: [
      ...current.rounds,
      {
        id: uid("round"),
        number: current.rounds.length + 1,
        createdAt: new Date().toISOString(),
        restIds,
        matches,
      },
    ],
  }));
}

function recordWinner(matchId, winner) {
  setState((current) => ({
    ...current,
    rounds: current.rounds.map((round, roundIndex) => {
      if (roundIndex !== current.rounds.length - 1) return round;
      return {
        ...round,
        matches: round.matches.map((match) =>
          match.id === matchId ? { ...match, winner } : match,
        ),
      };
    }),
  }));
}

function clearRounds() {
  if (!state.rounds.length) return;
  if (!window.confirm("Clear all rounds and keep the player list?")) return;
  setState((current) => ({ ...current, rounds: [] }));
}

function undoLastRound() {
  if (!state.rounds.length) return;
  if (!window.confirm("Remove the latest round?")) return;
  setState((current) => ({ ...current, rounds: current.rounds.slice(0, -1) }));
}

function clearEverything() {
  if (!window.confirm("Clear players, courts, and rounds?")) return;
  setState({ ...defaultState });
}

function render() {
  const stats = computeStats();
  const activeCount = activePlayers().length;
  const round = currentRound();

  app.innerHTML = `
    <header class="topbar">
      <div class="brand-row">
        <div class="brand">
          <h1 class="brand-title">Pickleball Court Stack</h1>
          <p class="brand-subtitle">${state.courtCount} court${state.courtCount === 1 ? "" : "s"} · ${state.rounds.length} round${state.rounds.length === 1 ? "" : "s"}</p>
        </div>
        <div class="session-pill">
          <strong>${activeCount}</strong>
          <span>active</span>
        </div>
      </div>
      <nav class="tabs" aria-label="App sections">
        ${tabButton("players", "Players")}
        ${tabButton("courts", "Courts")}
        ${tabButton("history", "History")}
      </nav>
    </header>
    <section class="content">
      ${state.tab === "players" ? renderPlayers(stats) : ""}
      ${state.tab === "courts" ? renderCourts(stats, round) : ""}
      ${state.tab === "history" ? renderHistory() : ""}
    </section>
    ${state.toast ? `<div class="toast" role="status">${escapeHtml(state.toast)}</div>` : ""}
  `;

  bindEvents();
}

function tabButton(tab, label) {
  return `
    <button class="tab-button ${state.tab === tab ? "active" : ""}" data-tab="${tab}" type="button">
      ${label}
    </button>
  `;
}

function renderPlayers(stats) {
  const players = [...state.players].sort((a, b) => a.name.localeCompare(b.name));

  return `
    <section class="panel">
      <div class="section-head">
        <h2>Players</h2>
        <span class="small">${state.players.length} total</span>
      </div>
      <form class="input-row" id="add-player-form">
        <input class="name-input" id="player-name" autocomplete="off" placeholder="Player name" value="${escapeHtml(state.playerDraft)}" />
        <button class="primary" type="submit">Add</button>
      </form>
    </section>

    <section class="panel">
      <div class="section-head">
        <h3>Paste List</h3>
        <span class="small">comma or line break</span>
      </div>
      <textarea class="bulk-input" id="bulk-names" placeholder="Ana&#10;Ben&#10;Carlo">${escapeHtml(state.bulkDraft)}</textarea>
      <div class="actions">
        <button class="secondary" id="add-bulk" type="button">Add Names</button>
        <button class="danger" id="clear-everything" type="button">Clear All</button>
      </div>
    </section>

    <section class="panel">
      <div class="section-head">
        <h3>Roster</h3>
        <span class="small">${activePlayers().length} active</span>
      </div>
      <div class="player-list">
        ${
          players.length
            ? players.map((player) => renderPlayer(player, stats[player.id])).join("")
            : `<div class="empty-state">No players yet</div>`
        }
      </div>
    </section>
  `;
}

function renderPlayer(player, record) {
  return `
    <article class="player-row">
      <div class="player-main">
        <span class="player-name">${escapeHtml(player.name)}</span>
        <div class="player-meta">
          <span class="badge blue">${record.played} played</span>
          <span class="badge win">${record.wins} win${record.wins === 1 ? "" : "s"}</span>
          <span class="badge loss">${record.losses} loss${record.losses === 1 ? "" : "es"}</span>
          <span class="badge rest">${record.rests} rest${record.rests === 1 ? "" : "s"}</span>
          ${player.active ? "" : `<span class="badge">inactive</span>`}
        </div>
      </div>
      <div class="player-actions">
        <button class="mini-button" data-toggle-player="${player.id}" type="button">${player.active ? "Off" : "On"}</button>
        <button class="mini-button" data-remove-player="${player.id}" type="button">X</button>
      </div>
    </article>
  `;
}

function renderCourts(stats, round) {
  return `
    <section class="panel">
      <div class="section-head">
        <h2>Courts</h2>
        <span class="small">${Math.max(0, state.courtCount * 4)} slots</span>
      </div>
      <div class="court-settings">
        <button class="mini-button" id="court-minus" type="button">-</button>
        <input class="number-input" id="court-count" min="1" max="12" inputmode="numeric" value="${state.courtCount}" />
        <button class="mini-button" id="court-plus" type="button">+</button>
      </div>
    </section>

    <section class="panel">
      <div class="round-header">
        <div class="round-title">
          <h2>${round ? `Round ${round.number}` : "No Active Round"}</h2>
          <span>${round ? `${round.matches.length} court${round.matches.length === 1 ? "" : "s"}` : `${activePlayers().length} active players`}</span>
        </div>
        <div class="actions">
          <button class="primary" id="start-round" type="button">${round && roundComplete(round) ? "Next Round" : "Start Round"}</button>
          <button class="secondary" id="undo-round" type="button" ${state.rounds.length ? "" : "disabled"}>Undo</button>
          <button class="danger" id="clear-rounds" type="button" ${state.rounds.length ? "" : "disabled"}>Clear Rounds</button>
        </div>
      </div>
    </section>

    ${round ? renderRound(round, stats) : renderNoRound()}
  `;
}

function renderNoRound() {
  return `
    <section class="empty-state">
      ${activePlayers().length < 4 ? "Add at least 4 active players" : "Ready for round 1"}
    </section>
  `;
}

function renderRound(round, stats) {
  return `
    <section class="court-list">
      ${round.matches.map((match) => renderMatch(match)).join("")}
    </section>
    <section class="panel rest-panel">
      <div class="section-head">
        <h3>Rest / Bye</h3>
        <span class="small">${round.restIds.length} player${round.restIds.length === 1 ? "" : "s"}</span>
      </div>
      <div class="rest-list">
        ${
          round.restIds.length
            ? round.restIds
                .map((playerId) => `<span class="badge rest">${escapeHtml(playerName(playerId))}</span>`)
                .join("")
            : `<span class="badge win">Everyone plays</span>`
        }
      </div>
    </section>
    <section class="panel">
      <div class="stats-grid">
        ${summaryStat("Played", Object.values(stats).reduce((sum, record) => sum + record.played, 0))}
        ${summaryStat("Wins", Object.values(stats).reduce((sum, record) => sum + record.wins, 0))}
        ${summaryStat("Rests", Object.values(stats).reduce((sum, record) => sum + record.rests, 0))}
        ${summaryStat("Open", round.matches.filter((match) => !match.winner).length)}
      </div>
    </section>
  `;
}

function renderMatch(match) {
  return `
    <article class="match-card">
      <div class="match-title">
        <strong>Court ${match.court}</strong>
        <span>${match.winner ? "winner entered" : "waiting"}</span>
      </div>
      <div class="teams">
        ${renderTeam(match, "A", match.teamA)}
        ${renderTeam(match, "B", match.teamB)}
      </div>
    </article>
  `;
}

function renderTeam(match, teamKey, playerIds) {
  const isWinner = match.winner === teamKey;
  return `
    <div class="team ${isWinner ? "winner" : ""}">
      <div class="team-name">
        <span class="team-label">Team ${teamKey}</span>
        <span class="team-players">${playerIds.map((id) => escapeHtml(playerName(id))).join(" / ")}</span>
      </div>
      <button class="winner-button" data-winner="${teamKey}" data-match="${match.id}" type="button">
        ${isWinner ? "Won" : "Win"}
      </button>
    </div>
  `;
}

function summaryStat(label, value) {
  return `
    <div class="stat">
      <strong>${value}</strong>
      <span>${label}</span>
    </div>
  `;
}

function renderHistory() {
  return `
    <section class="panel">
      <div class="section-head">
        <h2>History</h2>
        <span class="small">${state.rounds.length} round${state.rounds.length === 1 ? "" : "s"}</span>
      </div>
      <div class="history-list">
        ${
          state.rounds.length
            ? [...state.rounds].reverse().map((round) => renderHistoryRound(round)).join("")
            : `<div class="empty-state">No rounds yet</div>`
        }
      </div>
    </section>
  `;
}

function renderHistoryRound(round) {
  return `
    <article class="history-card">
      <h3>Round ${round.number}</h3>
      <div class="history-matches">
        ${round.matches.map((match) => renderHistoryMatch(match)).join("")}
        <div class="history-line">Rest: ${
          round.restIds.length ? round.restIds.map((id) => escapeHtml(playerName(id))).join(", ") : "none"
        }</div>
      </div>
    </article>
  `;
}

function renderHistoryMatch(match) {
  const teamA = match.teamA.map((id) => playerName(id)).join(" / ");
  const teamB = match.teamB.map((id) => playerName(id)).join(" / ");
  const winner = match.winner ? `Team ${match.winner}` : "open";
  return `
    <div class="history-line">
      Court ${match.court}: ${escapeHtml(teamA)} vs ${escapeHtml(teamB)} · ${winner}
    </div>
  `;
}

function bindEvents() {
  app.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => setState({ tab: button.dataset.tab }));
  });

  const playerForm = app.querySelector("#add-player-form");
  if (playerForm) {
    playerForm.addEventListener("submit", (event) => {
      event.preventDefault();
      addPlayer(state.playerDraft);
    });
  }

  const playerInput = app.querySelector("#player-name");
  if (playerInput) {
    playerInput.addEventListener("input", (event) => {
      state.playerDraft = event.target.value;
      saveState();
    });
  }

  const bulkInput = app.querySelector("#bulk-names");
  if (bulkInput) {
    bulkInput.addEventListener("input", (event) => {
      state.bulkDraft = event.target.value;
      saveState();
    });
  }

  const addBulk = app.querySelector("#add-bulk");
  if (addBulk) addBulk.addEventListener("click", addBulkPlayers);

  const clearEverythingButton = app.querySelector("#clear-everything");
  if (clearEverythingButton) clearEverythingButton.addEventListener("click", clearEverything);

  app.querySelectorAll("[data-toggle-player]").forEach((button) => {
    button.addEventListener("click", () => togglePlayer(button.dataset.togglePlayer));
  });

  app.querySelectorAll("[data-remove-player]").forEach((button) => {
    button.addEventListener("click", () => removePlayer(button.dataset.removePlayer));
  });

  const courtInput = app.querySelector("#court-count");
  if (courtInput) {
    courtInput.addEventListener("change", (event) => {
      const value = Math.max(1, Math.min(12, Number(event.target.value) || 1));
      setState({ courtCount: value });
    });
  }

  const courtMinus = app.querySelector("#court-minus");
  if (courtMinus) {
    courtMinus.addEventListener("click", () =>
      setState((current) => ({ ...current, courtCount: Math.max(1, current.courtCount - 1) })),
    );
  }

  const courtPlus = app.querySelector("#court-plus");
  if (courtPlus) {
    courtPlus.addEventListener("click", () =>
      setState((current) => ({ ...current, courtCount: Math.min(12, current.courtCount + 1) })),
    );
  }

  const startRoundButton = app.querySelector("#start-round");
  if (startRoundButton) startRoundButton.addEventListener("click", startRound);

  const clearRoundsButton = app.querySelector("#clear-rounds");
  if (clearRoundsButton) clearRoundsButton.addEventListener("click", clearRounds);

  const undoRoundButton = app.querySelector("#undo-round");
  if (undoRoundButton) undoRoundButton.addEventListener("click", undoLastRound);

  app.querySelectorAll("[data-match][data-winner]").forEach((button) => {
    button.addEventListener("click", () => recordWinner(button.dataset.match, button.dataset.winner));
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

render();
