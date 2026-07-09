const STORAGE_KEY = "pickleball-court-stack-v1";

const defaultState = {
  tab: "players",
  courtCount: 3,
  schedule: {
    startTime: "18:00",
    endTime: "20:00",
    fallbackMinutes: 15,
  },
  players: [],
  pairRequests: [],
  pairDraft: {
    a: "",
    b: "",
  },
  rounds: [],
  bulkDraft: "",
  toast: "",
};

let state = loadState();
let toastTimer = null;

const app = document.querySelector("#app");

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved) return { ...defaultState };

    return {
      ...defaultState,
      ...saved,
      schedule: {
        ...defaultState.schedule,
        ...(saved.schedule || {}),
      },
      players: Array.isArray(saved.players) ? saved.players : [],
      pairRequests: Array.isArray(saved.pairRequests) ? saved.pairRequests : [],
      pairDraft: {
        ...defaultState.pairDraft,
        ...(saved.pairDraft || {}),
      },
      rounds: Array.isArray(saved.rounds)
        ? saved.rounds.map((round) => ({
            ...round,
            completedAt: round.completedAt || null,
          }))
        : [],
      bulkDraft: saved.bulkDraft || "",
      toast: "",
    };
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

function playersById() {
  return new Map(state.players.map((player) => [player.id, player]));
}

function activePairMap(playerIds = new Set(activePlayers().map((player) => player.id))) {
  const map = new Map();

  for (const pair of state.pairRequests) {
    if (!playerIds.has(pair.a) || !playerIds.has(pair.b)) continue;
    if (map.has(pair.a) || map.has(pair.b)) continue;
    map.set(pair.a, pair.b);
    map.set(pair.b, pair.a);
  }

  return map;
}

function partnerForPlayer(playerId) {
  const pair = state.pairRequests.find((request) => request.a === playerId || request.b === playerId);
  if (!pair) return null;
  return pair.a === playerId ? pair.b : pair.a;
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

function addBulkPlayers() {
  const names = state.bulkDraft
    .split(/[\n,;]+/)
    .map((name) => name.trim())
    .filter(Boolean);

  if (!names.length) {
    showToast("Type or paste at least one name");
    return;
  }

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
    pairRequests: current.pairRequests.filter(
      (pair) => pair.a !== playerId && pair.b !== playerId,
    ),
  }));
}

function addPairRequest() {
  const a = state.pairDraft.a;
  const b = state.pairDraft.b;

  if (!a || !b) {
    showToast("Choose two players to pair");
    return;
  }

  if (a === b) {
    showToast("Choose two different players");
    return;
  }

  const existing = state.pairRequests.find(
    (pair) => pair.a === a || pair.b === a || pair.a === b || pair.b === b,
  );

  if (existing) {
    showToast("Each player can have one requested partner");
    return;
  }

  setState((current) => ({
    ...current,
    pairDraft: { ...defaultState.pairDraft },
    pairRequests: [
      ...current.pairRequests,
      {
        id: uid("pair"),
        a,
        b,
      },
    ],
  }));
  showToast(`${playerName(a)} and ${playerName(b)} paired`);
}

function removePairRequest(pairId) {
  setState((current) => ({
    ...current,
    pairRequests: current.pairRequests.filter((pair) => pair.id !== pairId),
  }));
}

function updatePairDraft(field, value) {
  setState((current) => ({
    ...current,
    pairDraft: {
      ...current.pairDraft,
      [field]: value,
    },
  }));
}

function playerPower(player, stats) {
  const record = stats[player.id];
  const lastWeight = record.last === "win" ? 2 : record.last === "loss" ? 0 : 1;
  return (record.wins - record.losses) * 4 + lastWeight - record.played * 0.1;
}

function unitRank(unit, stats) {
  const records = unit.ids.map((id) => stats[id]);
  const avg = (values) => values.reduce((total, value) => total + value, 0) / values.length;
  return [
    -Math.max(...records.map((record) => record.rests)),
    avg(records.map((record) => record.played)),
    avg(records.map((record) => record.wins - record.losses)),
    unit.names,
  ];
}

function compareUnitRank(a, b, stats) {
  const left = unitRank(a, stats);
  const right = unitRank(b, stats);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function buildSelectionUnits(players, stats) {
  const activeIds = new Set(players.map((player) => player.id));
  const pairMap = activePairMap(activeIds);
  const byId = new Map(players.map((player) => [player.id, player]));
  const used = new Set();
  const units = [];

  const ordered = [...players].sort((a, b) => compareRank(a, b, rankForPlay, stats));

  for (const player of ordered) {
    if (used.has(player.id)) continue;

    const partnerId = pairMap.get(player.id);
    const partner = partnerId ? byId.get(partnerId) : null;

    if (partner && !used.has(partner.id)) {
      used.add(player.id);
      used.add(partner.id);
      units.push({
        ids: [player.id, partner.id],
        names: [player.name, partner.name].sort().join(" "),
      });
      continue;
    }

    used.add(player.id);
    units.push({
      ids: [player.id],
      names: player.name,
    });
  }

  return units.sort((a, b) => compareUnitRank(a, b, stats));
}

function canFillUnits(units, startIndex, target) {
  if (target === 0) return true;
  const possible = new Set([0]);

  for (let index = startIndex; index < units.length; index += 1) {
    const size = units[index].ids.length;
    for (const value of [...possible]) {
      const next = value + size;
      if (next === target) return true;
      if (next < target) possible.add(next);
    }
  }

  return false;
}

function selectPlayersForRound(players, slots, stats) {
  const byId = new Map(players.map((player) => [player.id, player]));
  const units = buildSelectionUnits(players, stats);
  const selectedIds = [];

  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    const targetAfterUnit = slots - selectedIds.length - unit.ids.length;

    if (targetAfterUnit >= 0 && canFillUnits(units, index + 1, targetAfterUnit)) {
      selectedIds.push(...unit.ids);
    }
  }

  if (selectedIds.length < slots) {
    const ordered = [...players].sort((a, b) => compareRank(a, b, rankForPlay, stats));
    for (const player of ordered) {
      if (selectedIds.length >= slots) break;
      if (!selectedIds.includes(player.id)) selectedIds.push(player.id);
    }
  }

  return selectedIds.slice(0, slots).map((id) => byId.get(id)).filter(Boolean);
}

function makeTeams(selected, stats) {
  const byId = new Map(selected.map((player) => [player.id, player]));
  const selectedIds = new Set(selected.map((player) => player.id));
  const pairMap = activePairMap(selectedIds);
  const ordered = [...selected].sort((a, b) => compareRank(a, b, rankForCourt, stats));
  const used = new Set();
  const singles = [];
  const teams = [];

  for (const player of ordered) {
    if (used.has(player.id)) continue;

    const partnerId = pairMap.get(player.id);
    const partner = partnerId ? byId.get(partnerId) : null;

    if (partner && !used.has(partner.id)) {
      used.add(player.id);
      used.add(partner.id);
      teams.push({
        ids: [player.id, partner.id],
        requested: true,
        power: playerPower(player, stats) + playerPower(partner, stats),
      });
      continue;
    }

    used.add(player.id);
    singles.push(player);
  }

  for (let left = 0, right = singles.length - 1; left < right; left += 1, right -= 1) {
    teams.push({
      ids: [singles[left].id, singles[right].id],
      requested: false,
      power: playerPower(singles[left], stats) + playerPower(singles[right], stats),
    });
  }

  return teams.sort((a, b) => b.power - a.power);
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
  const selected = selectPlayersForRound(players, slots, stats);

  const selectedIds = new Set(selected.map((player) => player.id));
  const restIds = players
    .filter((player) => !selectedIds.has(player.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((player) => player.id);

  const teams = makeTeams(selected, stats);
  const matches = [];

  for (let index = 0; index < teams.length; index += 2) {
    matches.push({
      id: uid("match"),
      court: matches.length + 1,
      teamA: teams[index].ids,
      teamB: teams[index + 1].ids,
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
        completedAt: null,
        restIds,
        matches,
      },
    ],
  }));
}

function recordWinner(matchId, winner) {
  const completedAt = new Date().toISOString();

  setState((current) => ({
    ...current,
    rounds: current.rounds.map((round, roundIndex) => {
      if (roundIndex !== current.rounds.length - 1) return round;

      const matches = round.matches.map((match) =>
        match.id === matchId ? { ...match, winner } : match,
      );

      return {
        ...round,
        matches,
        completedAt: matches.every((match) => match.winner)
          ? round.completedAt || completedAt
          : null,
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

function resetSession() {
  const hasSessionData =
    state.players.length || state.rounds.length || state.pairRequests.length || state.bulkDraft.trim();
  if (!hasSessionData) {
    showToast("Session is already empty");
    return;
  }

  if (!window.confirm("Reset for a new day? This clears players and rounds.")) return;

  setState((current) => ({
    ...defaultState,
    courtCount: current.courtCount,
    schedule: current.schedule,
  }));
}

function updateScheduleField(field, value) {
  setState((current) => ({
    ...current,
    schedule: {
      ...current.schedule,
      [field]: value,
    },
  }));
}

function clampFallbackMinutes(value) {
  return Math.max(5, Math.min(60, Number(value) || defaultState.schedule.fallbackMinutes));
}

function dateFromTime(value) {
  const [hours, minutes] = String(value || "00:00")
    .split(":")
    .map((part) => Number(part));
  const date = new Date();
  date.setHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return date;
}

function scheduleWindow() {
  const now = new Date();
  const start = dateFromTime(state.schedule.startTime);
  const end = dateFromTime(state.schedule.endTime);
  if (end <= start) end.setDate(end.getDate() + 1);
  if (now > end && state.schedule.endTime <= state.schedule.startTime) {
    start.setDate(start.getDate() - 1);
  }

  const remainingMinutes = Math.max(0, (end.getTime() - now.getTime()) / 60000);
  return { now, start, end, remainingMinutes };
}

function completedRoundDurations() {
  return state.rounds
    .filter((round) => roundComplete(round) && round.createdAt && round.completedAt)
    .map((round) => {
      const started = new Date(round.createdAt).getTime();
      const finished = new Date(round.completedAt).getTime();
      return Math.max(1, (finished - started) / 60000);
    })
    .filter((minutes) => Number.isFinite(minutes) && minutes > 0);
}

function computeForecast() {
  const durations = completedRoundDurations();
  const fallbackMinutes = clampFallbackMinutes(state.schedule.fallbackMinutes);
  const averageMinutes = durations.length
    ? durations.reduce((total, minutes) => total + minutes, 0) / durations.length
    : fallbackMinutes;

  const round = currentRound();
  const activeCount = activePlayers().length;
  const possibleCourts = Math.min(state.courtCount, Math.floor(activeCount / 4));
  const courtGamesPerRound = round?.matches.length || possibleCourts;
  const openGames = round && !roundComplete(round)
    ? round.matches.filter((match) => !match.winner).length
    : 0;
  const { remainingMinutes, start, end } = scheduleWindow();
  const futureWindow = openGames
    ? Math.max(0, remainingMinutes - averageMinutes)
    : remainingMinutes;
  const futureRounds = courtGamesPerRound
    ? Math.floor(futureWindow / averageMinutes)
    : 0;
  const gamesLeft = openGames + futureRounds * courtGamesPerRound;

  return {
    averageMinutes,
    durationCount: durations.length,
    remainingMinutes,
    futureRounds,
    gamesLeft,
    openGames,
    courtGamesPerRound,
    start,
    end,
    source: durations.length ? "from completed rounds" : "starting estimate",
  };
}

function formatMinutes(value) {
  if (!Number.isFinite(value)) return "-";
  const rounded = Math.max(0, Math.round(value));
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function roundDurationLabel(round) {
  if (!round.completedAt) return "in progress";
  const minutes = (new Date(round.completedAt).getTime() - new Date(round.createdAt).getTime()) / 60000;
  return formatMinutes(minutes);
}

function render() {
  const stats = computeStats();
  const activeCount = activePlayers().length;
  const round = currentRound();

  app.innerHTML = `
    <header class="topbar">
      <div class="brand-row">
        <div class="brand-lockup">
          <img class="brand-icon" src="./icon.svg" alt="" />
          <div class="brand">
            <h1 class="brand-title">Pickleball Court Stack</h1>
            <p class="brand-subtitle">${state.courtCount} court${state.courtCount === 1 ? "" : "s"} - ${state.rounds.length} round${state.rounds.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        <div class="top-actions">
          <div class="session-pill">
            <strong>${activeCount}</strong>
            <span>active</span>
          </div>
          <button class="secondary compact" id="reset-session" type="button">Reset Day</button>
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
    <section class="panel hero-panel">
      <div class="section-head">
        <h2>Add Players</h2>
        <span class="small">${state.players.length} total</span>
      </div>
      <textarea class="bulk-input roster-input" id="bulk-names" placeholder="Ana&#10;Ben&#10;Carlo">${escapeHtml(state.bulkDraft)}</textarea>
      <div class="actions split-actions">
        <button class="primary" id="add-bulk" type="button">Add to Roster</button>
        <button class="danger" id="reset-session-secondary" type="button">Reset Day</button>
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

    ${renderPairRequests(players)}
  `;
}

function renderPlayer(player, record) {
  const partnerId = partnerForPlayer(player.id);
  return `
    <article class="player-row">
      <div class="player-main">
        <span class="player-name">${escapeHtml(player.name)}</span>
        <div class="player-meta">
          <span class="badge blue">${record.played} played</span>
          <span class="badge win">${record.wins} win${record.wins === 1 ? "" : "s"}</span>
          <span class="badge loss">${record.losses} loss${record.losses === 1 ? "" : "es"}</span>
          <span class="badge rest">${record.rests} rest${record.rests === 1 ? "" : "s"}</span>
          ${partnerId ? `<span class="badge partner">with ${escapeHtml(playerName(partnerId))}</span>` : ""}
          ${player.active ? "" : `<span class="badge">inactive</span>`}
        </div>
      </div>
      <div class="player-actions">
        <button class="mini-button" data-toggle-player="${player.id}" type="button">${player.active ? "Off" : "On"}</button>
        <button class="mini-button danger-mini" data-remove-player="${player.id}" type="button">X</button>
      </div>
    </article>
  `;
}

function renderPairRequests(players) {
  const selectablePlayers = players.filter((player) => player.active);
  return `
    <section class="panel partner-panel">
      <div class="section-head">
        <h3>Partner Requests</h3>
        <span class="small">${state.pairRequests.length} pair${state.pairRequests.length === 1 ? "" : "s"}</span>
      </div>
      ${
        selectablePlayers.length >= 2
          ? `
            <div class="pair-form">
              <select class="select-input" id="pair-a" aria-label="First partner">
                <option value="">Player 1</option>
                ${renderPlayerOptions(selectablePlayers, state.pairDraft.a)}
              </select>
              <select class="select-input" id="pair-b" aria-label="Second partner">
                <option value="">Player 2</option>
                ${renderPlayerOptions(selectablePlayers, state.pairDraft.b)}
              </select>
              <button class="secondary" id="add-pair" type="button">Pair Together</button>
            </div>
          `
          : `<div class="empty-state">Add at least 2 active players to set partner requests</div>`
      }
      <div class="pair-list">
        ${
          state.pairRequests.length
            ? state.pairRequests.map((pair) => renderPairRequest(pair)).join("")
            : `<div class="subtle-note">Requested partners are kept together when both players are active and selected for the round.</div>`
        }
      </div>
    </section>
  `;
}

function renderPlayerOptions(players, selectedId) {
  return players
    .map(
      (player) =>
        `<option value="${player.id}" ${player.id === selectedId ? "selected" : ""}>${escapeHtml(player.name)}</option>`,
    )
    .join("");
}

function renderPairRequest(pair) {
  return `
    <div class="pair-row">
      <span>${escapeHtml(playerName(pair.a))}</span>
      <strong>+</strong>
      <span>${escapeHtml(playerName(pair.b))}</span>
      <button class="mini-button danger-mini" data-remove-pair="${pair.id}" type="button">X</button>
    </div>
  `;
}

function renderCourts(stats, round) {
  return `
    ${renderSchedule()}

    <section class="panel court-control-panel">
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
          <span>${round ? `${round.matches.length} court game${round.matches.length === 1 ? "" : "s"}` : `${activePlayers().length} active players`}</span>
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

function renderSchedule() {
  const forecast = computeForecast();
  return `
    <section class="panel schedule-panel">
      <div class="section-head">
        <h2>Schedule</h2>
        <span class="small">${formatTime(forecast.start)} to ${formatTime(forecast.end)}</span>
      </div>
      <div class="schedule-form">
        <label class="field">
          <span>Start</span>
          <input class="time-input" id="schedule-start" type="time" value="${escapeHtml(state.schedule.startTime)}" />
        </label>
        <label class="field">
          <span>End</span>
          <input class="time-input" id="schedule-end" type="time" value="${escapeHtml(state.schedule.endTime)}" />
        </label>
        <label class="field">
          <span>Estimate</span>
          <input class="time-input" id="fallback-minutes" type="number" min="5" max="60" value="${clampFallbackMinutes(state.schedule.fallbackMinutes)}" />
        </label>
      </div>
      <div class="forecast-grid">
        ${summaryStat("Avg round", formatMinutes(forecast.averageMinutes), "teal", forecast.source)}
        ${summaryStat("Time left", formatMinutes(forecast.remainingMinutes), "blue", "until scheduled end")}
        ${summaryStat("Games left", forecast.gamesLeft, "amber", `${forecast.openGames} open now`)}
        ${summaryStat("Future rounds", forecast.futureRounds, "coral", `${forecast.courtGamesPerRound || 0} games per round`)}
      </div>
    </section>
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
        ${summaryStat("Played", Object.values(stats).reduce((sum, record) => sum + record.played, 0), "blue")}
        ${summaryStat("Wins", Object.values(stats).reduce((sum, record) => sum + record.wins, 0), "teal")}
        ${summaryStat("Rests", Object.values(stats).reduce((sum, record) => sum + record.rests, 0), "amber")}
        ${summaryStat("Open", round.matches.filter((match) => !match.winner).length, "coral")}
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

function summaryStat(label, value, tone = "", note = "") {
  return `
    <div class="stat ${tone ? `stat-${tone}` : ""}">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
      ${note ? `<small>${escapeHtml(note)}</small>` : ""}
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
      <div class="history-head">
        <h3>Round ${round.number}</h3>
        <span>${roundDurationLabel(round)}</span>
      </div>
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
      Court ${match.court}: ${escapeHtml(teamA)} vs ${escapeHtml(teamB)} - ${winner}
    </div>
  `;
}

function bindEvents() {
  app.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => setState({ tab: button.dataset.tab }));
  });

  const bulkInput = app.querySelector("#bulk-names");
  if (bulkInput) {
    bulkInput.addEventListener("input", (event) => {
      state.bulkDraft = event.target.value;
      saveState();
    });
  }

  const addBulk = app.querySelector("#add-bulk");
  if (addBulk) addBulk.addEventListener("click", addBulkPlayers);

  const resetButtons = app.querySelectorAll("#reset-session, #reset-session-secondary");
  resetButtons.forEach((button) => button.addEventListener("click", resetSession));

  const pairA = app.querySelector("#pair-a");
  if (pairA) {
    pairA.addEventListener("change", (event) => updatePairDraft("a", event.target.value));
  }

  const pairB = app.querySelector("#pair-b");
  if (pairB) {
    pairB.addEventListener("change", (event) => updatePairDraft("b", event.target.value));
  }

  const addPair = app.querySelector("#add-pair");
  if (addPair) addPair.addEventListener("click", addPairRequest);

  app.querySelectorAll("[data-remove-pair]").forEach((button) => {
    button.addEventListener("click", () => removePairRequest(button.dataset.removePair));
  });

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

  const scheduleStart = app.querySelector("#schedule-start");
  if (scheduleStart) {
    scheduleStart.addEventListener("change", (event) =>
      updateScheduleField("startTime", event.target.value || defaultState.schedule.startTime),
    );
  }

  const scheduleEnd = app.querySelector("#schedule-end");
  if (scheduleEnd) {
    scheduleEnd.addEventListener("change", (event) =>
      updateScheduleField("endTime", event.target.value || defaultState.schedule.endTime),
    );
  }

  const fallbackMinutes = app.querySelector("#fallback-minutes");
  if (fallbackMinutes) {
    fallbackMinutes.addEventListener("change", (event) =>
      updateScheduleField("fallbackMinutes", clampFallbackMinutes(event.target.value)),
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
