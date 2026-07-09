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
      tab: saved.tab === "history" ? "ranking" : saved.tab || defaultState.tab,
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
            matches: Array.isArray(round.matches)
              ? round.matches.map((match) => ({
                  ...match,
                  startedAt: match.startedAt || round.createdAt || new Date().toISOString(),
                }))
              : [],
            completedMatches: Array.isArray(round.completedMatches)
              ? round.completedMatches.map((match) => ({
                  ...match,
                  startedAt: match.startedAt || round.createdAt || new Date().toISOString(),
                }))
              : [],
            partnerPairs: Array.isArray(round.partnerPairs)
              ? round.partnerPairs
              : partnerPairsFromMatches(round.matches || []),
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

function activePlayersFrom(appState) {
  return appState.players.filter((player) => player.active);
}

function playersById() {
  return new Map(state.players.map((player) => [player.id, player]));
}

function sessionPartnerPairs() {
  const round = currentRound();
  return Array.isArray(round?.partnerPairs) ? round.partnerPairs : [];
}

function pairSources(options = {}) {
  return [
    ...(options.includeSessionPairs === false ? [] : sessionPartnerPairs()),
    ...state.pairRequests,
  ];
}

function activePairMap(
  playerIds = new Set(activePlayers().map((player) => player.id)),
  options = {},
) {
  const map = new Map();

  for (const pair of pairSources(options)) {
    if (!playerIds.has(pair.a) || !playerIds.has(pair.b)) continue;
    if (map.has(pair.a) || map.has(pair.b)) continue;
    map.set(pair.a, pair.b);
    map.set(pair.b, pair.a);
  }

  return map;
}

function allPartnerMap(options = {}) {
  const map = new Map();

  for (const pair of pairSources(options)) {
    if (map.has(pair.a) || map.has(pair.b)) continue;
    map.set(pair.a, pair.b);
    map.set(pair.b, pair.a);
  }

  return map;
}

function partnerForPlayer(playerId) {
  return allPartnerMap().get(playerId) || null;
}

function pairFromIds(ids) {
  if (!Array.isArray(ids) || ids.length !== 2) return null;
  return {
    id: uid("session-pair"),
    a: ids[0],
    b: ids[1],
  };
}

function pairKey(pair) {
  return [pair.a, pair.b].sort().join("|");
}

function appendPartnerPairs(existingPairs, newPairs) {
  const pairs = [];
  const used = new Set();

  for (const pair of [...(existingPairs || []), ...(newPairs || [])]) {
    if (!pair?.a || !pair?.b || used.has(pair.a) || used.has(pair.b)) continue;
    pairs.push(pair);
    used.add(pair.a);
    used.add(pair.b);
  }

  return pairs;
}

function partnerPairsFromTeams(teams) {
  return appendPartnerPairs(
    [],
    teams.map((team) => pairFromIds(team.ids)).filter(Boolean),
  );
}

function partnerPairsFromMatches(matches) {
  const teams = [];
  for (const match of matches || []) {
    teams.push({ ids: match.teamA }, { ids: match.teamB });
  }
  return partnerPairsFromTeams(teams);
}

function computeStats() {
  return computeStatsFor(state);
}

function computeStatsFor(appState) {
  const stats = Object.fromEntries(
    appState.players.map((player) => [
      player.id,
      { played: 0, wins: 0, losses: 0, rests: 0, last: "new" },
    ]),
  );

  for (const round of appState.rounds) {
    for (const playerId of round.restIds || []) {
      if (stats[playerId]) {
        stats[playerId].rests += 1;
        if (stats[playerId].last === "new") {
          stats[playerId].last = "rest";
        }
      }
    }

    const matchRecords = [...(round.completedMatches || []), ...(round.matches || [])];

    for (const match of matchRecords) {
      for (const playerId of [...match.teamA, ...match.teamB]) {
        if (stats[playerId]) stats[playerId].played += 1;
      }

      if (!match.winner) continue;
      const winnerIds = match.winner === "A" ? match.teamA : match.teamB;
      const loserIds = match.winner === "A" ? match.teamB : match.teamA;

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
    record.played,
    -record.rests,
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
  return Boolean(round) && activeMatches(round).length === 0;
}

function activeMatches(round) {
  return (round?.matches || []).filter((match) => !match.winner);
}

function completedMatches(round) {
  return [...(round?.completedMatches || []), ...(round?.matches || []).filter((match) => match.winner)];
}

function activePlayerIdsOnCourts(round, exceptMatchId = "") {
  const ids = new Set();

  for (const match of activeMatches(round)) {
    if (match.id === exceptMatchId) continue;
    for (const playerId of [...match.teamA, ...match.teamB]) {
      ids.add(playerId);
    }
  }

  return ids;
}

function waitingPlayerIdsFor(appState, round) {
  const busyIds = activePlayerIdsOnCourts(round);
  return activePlayersFrom(appState)
    .filter((player) => !busyIds.has(player.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((player) => player.id);
}

function waitingPlayerIds(round) {
  return waitingPlayerIdsFor(state, round);
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

function removeLockedPartner(pairId) {
  const round = currentRound();
  const pair = round?.partnerPairs?.find((item) => item.id === pairId);
  if (!pair) return;

  setState((current) => {
    const roundIndex = current.rounds.length - 1;
    const key = pairKey(pair);

    return {
      ...current,
      pairRequests: current.pairRequests.filter((request) => pairKey(request) !== key),
      rounds: current.rounds.map((item, index) =>
        index === roundIndex
          ? {
              ...item,
              partnerPairs: (item.partnerPairs || []).filter((lockedPair) => lockedPair.id !== pairId),
            }
          : item,
      ),
    };
  });
  showToast(`${playerName(pair.a)} and ${playerName(pair.b)} can split next game`);
}

function assignPairDraft(playerId, requestedSlot = "") {
  if (!playerId || !state.players.some((player) => player.id === playerId && player.active)) {
    return;
  }

  if (partnerForPlayer(playerId)) {
    showToast("Remove the existing pair first");
    return;
  }

  setState((current) => {
    const draft = { ...current.pairDraft };
    const slot = requestedSlot || (!draft.a ? "a" : !draft.b ? "b" : "a");

    if (requestedSlot && draft[requestedSlot] === playerId) {
      draft[requestedSlot] = "";
      return {
        ...current,
        pairDraft: draft,
      };
    }

    if (draft.a === playerId) draft.a = "";
    if (draft.b === playerId) draft.b = "";

    draft[slot] = playerId;

    if (draft.a === draft.b) {
      draft[slot === "a" ? "b" : "a"] = "";
    }

    return {
      ...current,
      pairDraft: draft,
    };
  });
}

function clearPairDraft() {
  setState((current) => ({
    ...current,
    pairDraft: { ...defaultState.pairDraft },
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
    avg(records.map((record) => record.played)),
    -Math.max(...records.map((record) => record.rests)),
    -avg(records.map((record) => record.rests)),
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

function buildSelectionUnits(players, stats, options = {}) {
  const activeIds = new Set(players.map((player) => player.id));
  const pairMap = activePairMap(activeIds, options);
  const partnerMap = allPartnerMap(options);
  const byId = new Map(players.map((player) => [player.id, player]));
  const used = new Set();
  const units = [];

  const ordered = [...players].sort((a, b) => compareRank(a, b, rankForPlay, stats));

  for (const player of ordered) {
    if (used.has(player.id)) continue;

    const partnerId = partnerMap.get(player.id);
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

    if (partnerId && !pairMap.has(player.id)) {
      used.add(player.id);
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

function selectPlayersForRound(players, slots, stats, options = {}) {
  const byId = new Map(players.map((player) => [player.id, player]));
  const units = buildSelectionUnits(players, stats, options);
  const selectedIds = [];

  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    const targetAfterUnit = slots - selectedIds.length - unit.ids.length;

    if (targetAfterUnit >= 0 && canFillUnits(units, index + 1, targetAfterUnit)) {
      selectedIds.push(...unit.ids);
    }
  }

  if (selectedIds.length < slots) {
    for (const unit of units) {
      if (selectedIds.length + unit.ids.length > slots) continue;
      if (unit.ids.some((id) => selectedIds.includes(id))) continue;
      selectedIds.push(...unit.ids);
    }
  }

  return selectedIds.slice(0, slots).map((id) => byId.get(id)).filter(Boolean);
}

function makeTeams(selected, stats, options = {}) {
  const byId = new Map(selected.map((player) => [player.id, player]));
  const selectedIds = new Set(selected.map((player) => player.id));
  const pairMap = activePairMap(selectedIds, options);
  const partnerMap = allPartnerMap(options);
  const ordered = [...selected].sort((a, b) => compareRank(a, b, rankForCourt, stats));
  const used = new Set();
  const singles = [];
  const teams = [];

  for (const player of ordered) {
    if (used.has(player.id)) continue;

    const partnerId = partnerMap.get(player.id);
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

    if (partnerId && !pairMap.has(player.id)) {
      used.add(player.id);
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

function buildRoundPlan(stats = computeStats(), options = {}) {
  const excludedIds = options.excludedIds || new Set();
  const maxMatches = Math.max(1, Number(options.maxMatches || state.courtCount) || 1);
  const players = activePlayers().filter((player) => !excludedIds.has(player.id));
  const maxSlots = Math.max(0, Math.floor(players.length / 4) * 4);
  const slots = Math.min(maxMatches * 4, maxSlots);

  if (slots < 4) {
    return {
      matches: [],
      restIds: players.map((player) => player.id),
      slots,
    };
  }

  const selected = selectPlayersForRound(players, slots, stats, options);
  const selectedIds = new Set(selected.map((player) => player.id));
  const restIds = players
    .filter((player) => !selectedIds.has(player.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((player) => player.id);
  const teams = makeTeams(selected, stats, options);

  return {
    matches: teamsToMatches(teams, { startedAt: options.startedAt }),
    restIds,
    slots,
  };
}

function teamsToMatches(teams, options = {}) {
  const matches = [];
  const startedAt = options.startedAt || new Date().toISOString();
  const courtStart = options.courtStart || 1;

  for (let index = 0; index < teams.length; index += 2) {
    if (!teams[index] || !teams[index + 1]) continue;
    matches.push({
      id: uid("match"),
      court: courtStart + matches.length,
      teamA: teams[index].ids,
      teamB: teams[index + 1].ids,
      winner: null,
      startedAt,
    });
  }

  return matches;
}

function buildCourtMatchFromState(appState, court, stats, excludedIds = new Set(), options = {}) {
  const availablePlayers = activePlayersFrom(appState).filter((player) => !excludedIds.has(player.id));
  if (availablePlayers.length < 4) return null;

  const selected = selectPlayersForRound(availablePlayers, 4, stats, options);
  if (selected.length < 4) return null;

  const teams = makeTeams(selected, stats, options);
  return teamsToMatches(teams, {
    courtStart: court,
    startedAt: new Date().toISOString(),
  })[0] || null;
}

function sortMatchesByLikelyFinish(matches) {
  return [...matches].sort((a, b) => {
    const left = new Date(a.startedAt || 0).getTime();
    const right = new Date(b.startedAt || 0).getTime();
    return left - right;
  });
}

function buildUpNextPlan(stats) {
  const round = currentRound();
  const targetMatches = Math.max(1, state.courtCount > 2 ? state.courtCount - 1 : 1);
  if (!round) return buildRoundPlan(stats, { maxMatches: targetMatches });

  const simRound = {
    ...round,
    matches: activeMatches(round),
    completedMatches: completedMatches(round),
    partnerPairs: round.partnerPairs || [],
  };
  const matches = [];
  let restIds = waitingPlayerIds(simRound);

  while (matches.length < targetMatches) {
    let busyIds = activePlayerIdsOnCourts(simRound);
    let availableCount = activePlayers().filter((player) => !busyIds.has(player.id)).length;

    if (availableCount < 4) {
      const finishCandidates = sortMatchesByLikelyFinish(simRound.matches).filter(
        (match) => !matches.some((queued) => queued.id === match.id),
      );
      const freeingMatch = finishCandidates[0];
      if (!freeingMatch) break;
      simRound.matches = simRound.matches.filter((match) => match.id !== freeingMatch.id);
      busyIds = activePlayerIdsOnCourts(simRound);
      availableCount = activePlayers().filter((player) => !busyIds.has(player.id)).length;
    }

    if (availableCount < 4) break;

    const simState = {
      ...state,
      rounds: state.rounds.map((item, index) =>
        index === state.rounds.length - 1 ? simRound : item,
      ),
    };
    const nextMatch = buildCourtMatchFromState(
      simState,
      matches.length + 1,
      stats,
      activePlayerIdsOnCourts(simRound),
    );

    if (!nextMatch) break;

    matches.push(nextMatch);
    simRound.matches = [...simRound.matches, nextMatch];
    simRound.partnerPairs = appendPartnerPairs(
      simRound.partnerPairs,
      partnerPairsFromMatches([nextMatch]),
    );
    restIds = waitingPlayerIdsFor(simState, simRound);
  }

  return {
    matches,
    restIds,
    slots: matches.length * 4,
  };
}

function startRound() {
  if (state.rounds.length) {
    showToast("Reset Day before starting a new session");
    return;
  }

  const startedAt = new Date().toISOString();
  const plan = buildRoundPlan(computeStats(), { startedAt });

  if (plan.slots < 4) {
    showToast("At least 4 active players are needed");
    setState({ tab: "players" });
    return;
  }

  setState((current) => ({
    ...current,
    tab: "courts",
    rounds: [
      ...current.rounds,
      {
        id: uid("round"),
        number: current.rounds.length + 1,
        createdAt: startedAt,
        completedAt: null,
        restIds: plan.restIds,
        matches: plan.matches,
        completedMatches: [],
        partnerPairs: partnerPairsFromMatches(plan.matches),
      },
    ],
  }));
}

function recordWinner(matchId, winner) {
  const completedAt = new Date().toISOString();

  setState((current) => {
    const roundIndex = current.rounds.length - 1;
    if (roundIndex < 0) return current;

    const round = current.rounds[roundIndex];
    const match = activeMatches(round).find((item) => item.id === matchId);
    if (!match) return current;

    const completedMatch = {
      ...match,
      winner,
      completedAt,
    };

    const remainingMatches = activeMatches(round).filter((item) => item.id !== matchId);
    const baseRound = {
      ...round,
      completedAt: null,
      completedMatches: [...(round.completedMatches || []), completedMatch],
      matches: remainingMatches,
      partnerPairs: round.partnerPairs || [],
    };
    const tempState = {
      ...current,
      rounds: current.rounds.map((item, index) => (index === roundIndex ? baseRound : item)),
    };
    const statsAfterResult = computeStatsFor(tempState);
    const busyIds = activePlayerIdsOnCourts(baseRound);
    const nextMatch = buildCourtMatchFromState(tempState, match.court, statsAfterResult, busyIds);
    const nextMatches = nextMatch ? [...remainingMatches, nextMatch] : remainingMatches;
    const nextPartnerPairs = nextMatch ? partnerPairsFromMatches([nextMatch]) : [];
    const partnerPairs = nextMatch
      ? appendPartnerPairs(baseRound.partnerPairs, nextPartnerPairs)
      : baseRound.partnerPairs;
    const updatedRound = {
      ...baseRound,
      completedAt: nextMatches.length ? null : completedAt,
      matches: nextMatches.sort((a, b) => a.court - b.court),
      partnerPairs,
    };
    updatedRound.restIds = waitingPlayerIdsFor(
      {
        ...tempState,
        rounds: tempState.rounds.map((item, index) => (index === roundIndex ? updatedRound : item)),
      },
      updatedRound,
    );

    return {
      ...current,
      rounds: current.rounds.map((item, index) => (index === roundIndex ? updatedRound : item)),
    };
  });
}

function reshufflePartners() {
  const round = currentRound();
  if (!round) return;

  const waitingIds = waitingPlayerIds(round);
  if (waitingIds.length < 2) {
    showToast("Need waiting players to reshuffle");
    return;
  }

  if (!window.confirm("Reshuffle partners for waiting players? Active court teams stay together until their game ends.")) {
    return;
  }

  setState((current) => {
    const roundIndex = current.rounds.length - 1;
    if (roundIndex < 0) return current;

    const activeRound = current.rounds[roundIndex];
    const busyIds = activePlayerIdsOnCourts(activeRound);
    const waitingPlayers = activePlayersFrom(current).filter((player) => !busyIds.has(player.id));
    const waitingTeams = makeTeams(waitingPlayers, computeStatsFor(current), {
      includeSessionPairs: false,
    });
    const activeCourtPairs = partnerPairsFromMatches(activeMatches(activeRound));
    const waitingPairs = partnerPairsFromTeams(waitingTeams);
    const updatedRound = {
      ...activeRound,
      partnerPairs: appendPartnerPairs(activeCourtPairs, waitingPairs),
    };
    updatedRound.restIds = waitingPlayerIdsFor(
      {
        ...current,
        rounds: current.rounds.map((item, index) => (index === roundIndex ? updatedRound : item)),
      },
      updatedRound,
    );

    return {
      ...current,
      rounds: current.rounds.map((item, index) => (index === roundIndex ? updatedRound : item)),
    };
  });

  showToast("Waiting partners reshuffled");
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

  if (!window.confirm("Reset for a new day? This clears games but keeps the roster names.")) return;

  setState((current) => ({
    ...defaultState,
    players: current.players,
    pairRequests: current.pairRequests,
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

function completedGameCount() {
  return state.rounds.reduce(
    (total, round) => total + completedMatches(round).filter((match) => match.winner).length,
    0,
  );
}

function completedCourtGameDurations() {
  return state.rounds
    .flatMap((round) => completedMatches(round))
    .filter((match) => match.startedAt && match.completedAt)
    .map((match) => {
      const started = new Date(match.startedAt).getTime();
      const finished = new Date(match.completedAt).getTime();
      return Math.max(1, (finished - started) / 60000);
    })
    .filter((minutes) => Number.isFinite(minutes) && minutes > 0);
}

function computeForecast() {
  const durations = completedCourtGameDurations();
  const fallbackMinutes = clampFallbackMinutes(state.schedule.fallbackMinutes);
  const averageMinutes = durations.length
    ? durations.reduce((total, minutes) => total + minutes, 0) / durations.length
    : fallbackMinutes;

  const round = currentRound();
  const activeCount = activePlayers().length;
  const possibleCourts = Math.min(state.courtCount, Math.floor(activeCount / 4));
  const runningGames = round ? activeMatches(round).length : 0;
  const { remainingMinutes, start, end } = scheduleWindow();
  const gamesLeft = averageMinutes ? Math.floor(remainingMinutes / averageMinutes) : 0;
  const courtCapacity = gamesLeft * Math.max(1, possibleCourts || state.courtCount);

  return {
    averageMinutes,
    durationCount: durations.length,
    remainingMinutes,
    courtCapacity,
    gamesLeft,
    runningGames,
    possibleCourts,
    start,
    end,
    source: durations.length ? "from completed court games" : "starting estimate",
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

function currentRoundElapsedLabel(round) {
  if (!round) return "0 min";
  const end = round.completedAt ? new Date(round.completedAt).getTime() : Date.now();
  const started = new Date(round.createdAt).getTime();
  return formatMinutes((end - started) / 60000);
}

function matchElapsedLabel(match) {
  if (!match?.startedAt) return "0 min";
  const started = new Date(match.startedAt).getTime();
  return formatMinutes((Date.now() - started) / 60000);
}

function courtToneClass(court) {
  return `court-tone-${((court - 1) % 6) + 1}`;
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
            <p class="brand-subtitle">${state.courtCount} court${state.courtCount === 1 ? "" : "s"} - ${completedGameCount()} finished</p>
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
        ${tabButton("players", "Game Info")}
        ${tabButton("courts", "Courts")}
        ${tabButton("ranking", "Player Ranking")}
      </nav>
    </header>
    <section class="content">
      ${state.tab === "players" ? renderPlayers(stats) : ""}
      ${state.tab === "courts" ? renderCourts(stats, round) : ""}
      ${state.tab === "ranking" ? renderRanking(stats) : ""}
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
  const players = [...state.players].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return `
    ${renderSchedule()}

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

    ${renderPairRequests(players)}

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

function renderUpNext(stats) {
  const round = currentRound();
  const plan = buildUpNextPlan(stats);

  return `
    <section class="panel up-next-panel">
      <div class="section-head">
        <h2>Up Next</h2>
        <span class="small">${plan.matches.length ? `${plan.matches.length} queued` : "not ready"}</span>
      </div>
      ${
        plan.matches.length
          ? `<div class="up-next-list">${plan.matches.map((match) => renderUpNextMatch(match)).join("")}</div>`
          : `<div class="empty-state">${round ? "Waiting for enough available players" : "Add at least 4 active players to see who plays next"}</div>`
      }
      ${
        plan.restIds.length
          ? `<div class="up-next-rest"><span>Waiting:</span> ${plan.restIds
              .map((id) => `<strong>${escapeHtml(playerName(id))}</strong>`)
              .join("")}</div>`
          : ""
      }
    </section>
  `;
}

function renderUpNextMatch(match) {
  return `
    <article class="up-next-card ${courtToneClass(match.court)}">
      <div class="up-next-court">
        <strong>Next Game ${match.court}</strong>
        <span>first open court</span>
      </div>
      <div class="up-next-teams">
        <span>${match.teamA.map((id) => escapeHtml(playerName(id))).join(" / ")}</span>
        <em>vs</em>
        <span>${match.teamB.map((id) => escapeHtml(playerName(id))).join(" / ")}</span>
      </div>
    </article>
  `;
}

function renderPlayer(player, record) {
  const partnerId = partnerForPlayer(player.id);
  const canPair = player.active && !partnerId;
  return `
    <article class="player-row ${canPair ? "draggable-player" : ""}" ${
      canPair ? `draggable="true" data-drag-player="${player.id}"` : ""
    }>
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
  const lockedPairs = sessionPartnerPairs();
  const lockedKeys = new Set(lockedPairs.map(pairKey));
  const requestedPairs = state.pairRequests.filter((pair) => !lockedKeys.has(pairKey(pair)));
  const pairRows = [
    ...lockedPairs.map((pair) => renderLockedPair(pair)),
    ...requestedPairs.map((pair) => renderPairRequest(pair)),
  ];

  return `
    <section class="panel partner-panel">
      <div class="section-head">
        <h3>Partner Requests</h3>
        <span class="small">${pairRows.length} pair${pairRows.length === 1 ? "" : "s"}</span>
      </div>
      ${
        selectablePlayers.length >= 2
          ? `
            <div class="pair-builder">
              ${renderPairDropSlot("a", "Partner 1")}
              ${renderPairDropSlot("b", "Partner 2")}
            </div>
            <div class="pair-actions">
              <button class="secondary" id="add-pair" type="button">Pair Together</button>
              <button class="ghost" id="clear-pair-draft" type="button">Clear Slots</button>
            </div>
            <div class="active-roster">
              <span class="active-roster-label">Active roster</span>
              <div class="chip-list">
                ${selectablePlayers.map((player) => renderPlayerChip(player)).join("")}
              </div>
            </div>
          `
          : `<div class="empty-state">Add at least 2 active players to set partner requests</div>`
      }
      <div class="pair-list">
        ${
          pairRows.length
            ? pairRows.join("")
            : `<div class="subtle-note">Requested partners are kept together when both players are active and selected for the round.</div>`
        }
      </div>
    </section>
  `;
}

function renderPairDropSlot(slot, label) {
  const playerId = state.pairDraft[slot];
  return `
    <button class="drop-slot ${playerId ? "filled" : ""}" data-drop-slot="${slot}" type="button">
      <span>${label}</span>
      <strong>${playerId ? escapeHtml(playerName(playerId)) : "Drop or tap a player"}</strong>
    </button>
  `;
}

function renderPlayerChip(player) {
  const lockedPartner = partnerForPlayer(player.id);
  const selected = state.pairDraft.a === player.id || state.pairDraft.b === player.id;
  return `
    <button class="player-chip ${selected ? "selected" : ""}" ${
      lockedPartner ? "disabled" : `draggable="true" data-drag-player="${player.id}" data-draft-player="${player.id}"`
    } type="button">
      ${escapeHtml(player.name)}
      ${lockedPartner ? `<small>paired</small>` : ""}
    </button>
  `;
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

function renderLockedPair(pair) {
  return `
    <div class="pair-row locked-pair">
      <span>${escapeHtml(playerName(pair.a))} <small>locked</small></span>
      <strong>+</strong>
      <span>${escapeHtml(playerName(pair.b))}</span>
      <button class="mini-button danger-mini" data-remove-locked-pair="${pair.id}" type="button">X</button>
    </div>
  `;
}

function renderCourts(stats, round) {
  const playingCount = round ? activeMatches(round).length : 0;
  return `
    <section class="panel live-courts-panel">
      <div class="round-header">
        <div class="round-title">
          <h2>${round ? "Live Courts" : "No Active Session"}</h2>
          <span>${round ? `${playingCount} court${playingCount === 1 ? "" : "s"} playing` : `${activePlayers().length} active players`}</span>
        </div>
        <div class="actions">
          ${round ? "" : `<button class="primary" id="start-round" type="button">Start Session</button>`}
          ${round ? `<button class="secondary" id="reshuffle-partners" type="button">Reshuffle Waiting</button>` : ""}
          <button class="secondary" id="undo-round" type="button" ${state.rounds.length ? "" : "disabled"}>Undo</button>
        </div>
      </div>
    </section>

    ${renderUpNext(stats)}

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
          <span>Courts</span>
          <div class="court-settings inline-courts">
            <button class="mini-button" id="court-minus" type="button">-</button>
            <input class="number-input" id="court-count" min="1" max="12" inputmode="numeric" value="${state.courtCount}" />
            <button class="mini-button" id="court-plus" type="button">+</button>
          </div>
        </label>
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
        ${summaryStat("Avg court game", formatMinutes(forecast.averageMinutes), "teal", forecast.source)}
        ${summaryStat("Time left", formatMinutes(forecast.remainingMinutes), "blue", "until scheduled end")}
        ${summaryStat("Games left", forecast.gamesLeft, "amber", "based on court game time")}
        ${summaryStat("Running now", forecast.runningGames, "coral", `${forecast.possibleCourts || state.courtCount} usable court${(forecast.possibleCourts || state.courtCount) === 1 ? "" : "s"}`)}
      </div>
    </section>
  `;
}

function renderNoRound() {
  return `
    <section class="empty-state">
      ${activePlayers().length < 4 ? "Add at least 4 active players" : "Ready to start"}
    </section>
  `;
}

function renderRound(round, stats) {
  const waitingIds = waitingPlayerIds(round);
  const courtNumbers = Array.from({ length: state.courtCount }, (_, index) => index + 1);
  return `
    <section class="court-list">
      ${courtNumbers.map((court) => renderCourtSlot(round, court)).join("")}
    </section>
    <section class="panel rest-panel">
      <div class="section-head">
        <h3>Waiting / Available</h3>
        <span class="small">${waitingIds.length} player${waitingIds.length === 1 ? "" : "s"}</span>
      </div>
      <div class="rest-list">
        ${
          waitingIds.length
            ? waitingIds
                .map((playerId) => `<span class="badge rest">${escapeHtml(playerName(playerId))}</span>`)
                .join("")
            : `<span class="badge win">Everyone is on court</span>`
        }
      </div>
    </section>
  `;
}

function renderCourtSlot(round, court) {
  const match = activeMatches(round).find((item) => item.court === court);
  if (match) return renderMatch(match);

  return `
    <article class="match-card court-idle ${courtToneClass(court)}">
      <div class="match-title">
        <strong>Court ${court}</strong>
        <span>open</span>
      </div>
      <div class="court-idle-body">
        <strong>Waiting for 4 available players</strong>
        <span>The next game will load here after enough players are free.</span>
      </div>
    </article>
  `;
}

function renderMatch(match) {
  return `
    <article class="match-card ${courtToneClass(match.court)}">
      <div class="match-title">
        <strong>Court ${match.court}</strong>
        <span>${matchElapsedLabel(match)} elapsed</span>
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

function rankedPlayers(stats) {
  return [...state.players].sort((a, b) => {
    const left = stats[a.id];
    const right = stats[b.id];
    const leftPct = left.played ? left.wins / left.played : 0;
    const rightPct = right.played ? right.wins / right.played : 0;
    const leftDiff = left.wins - left.losses;
    const rightDiff = right.wins - right.losses;

    if (right.wins !== left.wins) return right.wins - left.wins;
    if (rightPct !== leftPct) return rightPct - leftPct;
    if (rightDiff !== leftDiff) return rightDiff - leftDiff;
    if (right.played !== left.played) return right.played - left.played;
    if (left.rests !== right.rests) return left.rests - right.rests;
    return a.name.localeCompare(b.name);
  });
}

function renderRanking(stats) {
  const players = rankedPlayers(stats);
  const completedGames = completedGameCount();

  return `
    <section class="panel ranking-panel">
      <div class="section-head">
        <h2>Player Ranking</h2>
        <span class="small">${completedGames} completed game${completedGames === 1 ? "" : "s"}</span>
      </div>
      <div class="ranking-list">
        ${
          players.length
            ? players.map((player, index) => renderRankingRow(player, stats[player.id], index + 1)).join("")
            : `<div class="empty-state">No players yet</div>`
        }
      </div>
    </section>
  `;
}

function renderRankingRow(player, record, rank) {
  const winPct = record.played ? Math.round((record.wins / record.played) * 100) : 0;
  const partnerId = partnerForPlayer(player.id);

  return `
    <article class="ranking-card">
      <div class="rank-number">${rank}</div>
      <div class="rank-player">
        <strong>${escapeHtml(player.name)}</strong>
        <span>${player.active ? "Active" : "Inactive"}${partnerId ? ` - paired with ${escapeHtml(playerName(partnerId))}` : ""}</span>
      </div>
      <div class="rank-stats">
        <span><strong>${record.wins}</strong> W</span>
        <span><strong>${record.losses}</strong> L</span>
        <span><strong>${winPct}%</strong> Win</span>
        <span><strong>${record.played}</strong> Played</span>
        <span><strong>${record.rests}</strong> Rest</span>
      </div>
    </article>
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

  const addPair = app.querySelector("#add-pair");
  if (addPair) addPair.addEventListener("click", addPairRequest);

  const clearPair = app.querySelector("#clear-pair-draft");
  if (clearPair) clearPair.addEventListener("click", clearPairDraft);

  app.querySelectorAll("[data-draft-player]").forEach((button) => {
    button.addEventListener("click", () => assignPairDraft(button.dataset.draftPlayer));
  });

  app.querySelectorAll("[data-drag-player]").forEach((element) => {
    element.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", element.dataset.dragPlayer);
      event.dataTransfer.effectAllowed = "copy";
      element.classList.add("dragging");
    });

    element.addEventListener("dragend", () => {
      element.classList.remove("dragging");
    });
  });

  app.querySelectorAll("[data-drop-slot]").forEach((slot) => {
    slot.addEventListener("click", () => {
      const currentPlayer = state.pairDraft[slot.dataset.dropSlot];
      if (currentPlayer) assignPairDraft(currentPlayer, slot.dataset.dropSlot);
    });

    slot.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      slot.classList.add("drag-over");
    });

    slot.addEventListener("dragleave", () => {
      slot.classList.remove("drag-over");
    });

    slot.addEventListener("drop", (event) => {
      event.preventDefault();
      slot.classList.remove("drag-over");
      assignPairDraft(event.dataTransfer.getData("text/plain"), slot.dataset.dropSlot);
    });
  });

  app.querySelectorAll("[data-remove-pair]").forEach((button) => {
    button.addEventListener("click", () => removePairRequest(button.dataset.removePair));
  });

  app.querySelectorAll("[data-remove-locked-pair]").forEach((button) => {
    button.addEventListener("click", () => removeLockedPartner(button.dataset.removeLockedPair));
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

  const reshuffleButton = app.querySelector("#reshuffle-partners");
  if (reshuffleButton) reshuffleButton.addEventListener("click", reshufflePartners);

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

window.setInterval(() => {
  if (state.tab === "courts" && currentRound()) render();
}, 30000);
