const fs = require('fs');
const path = require('path');

const ADMIN_KEY = process.env.ADMIN_KEY || 'gts-admin-2026';
const TMP_FILE = path.join('/tmp', 'cournot_cartel_rooms.json');

const OUTPUT_COSTS = { 1: 0, 2: 2, 3: 5, 4: 9, 5: 14 };

const DEMAND_CARDS = [
  { name: 'Global Boom', A: 42, k: 1.0, Pmin: 2, cap: null, desc: 'Strong consumer demand and mild price sensitivity.' },
  { name: 'Steady Expansion', A: 36, k: 1.2, Pmin: 2, cap: null, desc: 'Balanced macroeconomic growth.' },
  { name: 'Stagnant Economy', A: 34, k: 1.5, Pmin: 2, cap: null, desc: 'Standard baseline market conditions.' },
  { name: 'Industrial Slowdown', A: 30, k: 1.5, Pmin: 2, cap: null, desc: 'Tightening margins punish overproduction.' },
  { name: 'Global Recession', A: 22, k: 1.5, Pmin: 1, cap: null, desc: 'Severe contraction; high output risks negative margins.' },
  { name: 'War Super-Cycle', A: 48, k: 0.5, Pmin: 4, cap: null, desc: 'Inelastic surge demand absorbs heavy supply.' },
  { name: 'Refinery Bottleneck', A: 38, k: 1.2, Pmin: 1, cap: 12, desc: 'HARD CAP: If Total Supply > 12B, price crashes to 1!' }
];

const TECH_TYPES = [
  {
    id: 'SPR',
    name: 'Strategic Petroleum Reserve',
    desc: 'If clearing price P <= 6, withhold up to 2 produced barrels into private storage to release in a future round for 0 cost.'
  },
  {
    id: 'WHISTLEBLOWER',
    name: 'Regulatory Whistleblower',
    desc: 'Target a rival. If they produced > agreed quota (or >= 4B if no quota), their excess barrels earn 0 revenue, they pay a 6-token fine, and you gain +3 tokens.'
  },
  {
    id: 'SUBSIDY',
    name: 'State Energy Subsidy',
    desc: 'Reduce your operational production cost this quarter by 6 tokens (minimum 0). Grants insolvency immunity if playing 4B or 5B.'
  },
  {
    id: 'EMBARGO',
    name: 'Supply Chain Embargo',
    desc: 'Pay 3 tokens to blockade a rival: reduces their effective output by 2B (minimum 1B) while they still pay full production cost.'
  },
  {
    id: 'RECON',
    name: 'Satellite Reconnaissance',
    desc: 'Activate before locking in: privately inspect this quarter’s Demand Shock Card before choosing your output.'
  }
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildOutputDeck() {
  const deck = [];
  const counts = { 1: 7, 2: 8, 3: 8, 4: 6, 5: 6 };
  for (const [barrels, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) deck.push(Number(barrels));
  }
  return shuffle(deck);
}

function buildDemandDeck() {
  const deck = [];
  for (let i = 0; i < 3; i++) {
    DEMAND_CARDS.forEach(card => deck.push({ ...card }));
  }
  return shuffle(deck.slice(0, 20));
}

function buildTechDeck() {
  const deck = [];
  TECH_TYPES.forEach(t => {
    for (let i = 0; i < 3; i++) {
      deck.push({
        ...t,
        uid: `${t.id}_${Math.random().toString(36).slice(2, 7)}`,
        used: false,
        usedInQuarter: null
      });
    }
  });
  return shuffle(deck);
}

// Multi-layer Serverless Store (Memory + /tmp disk persistence)
if (!globalThis.__COURNOT_ROOMS__) {
  globalThis.__COURNOT_ROOMS__ = {};
  try {
    if (fs.existsSync(TMP_FILE)) {
      globalThis.__COURNOT_ROOMS__ = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'));
    }
  } catch (e) {
    globalThis.__COURNOT_ROOMS__ = {};
  }
}

function getStore() {
  try {
    if (fs.existsSync(TMP_FILE)) {
      const diskData = JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'));
      for (const [code, diskRoom] of Object.entries(diskData)) {
        const memRoom = globalThis.__COURNOT_ROOMS__[code];
        if (!memRoom || (diskRoom.version || 0) > (memRoom.version || 0)) {
          globalThis.__COURNOT_ROOMS__[code] = diskRoom;
        }
      }
    }
  } catch (e) {}
  return globalThis.__COURNOT_ROOMS__;
}

function saveStore() {
  try {
    fs.writeFileSync(TMP_FILE, JSON.stringify(globalThis.__COURNOT_ROOMS__), 'utf8');
  } catch (e) {}
}

function drawOutput(room) {
  if (!room.outputDeck || room.outputDeck.length === 0) room.outputDeck = buildOutputDeck();
  return room.outputDeck.pop();
}

function drawTech(room) {
  if (!room.techDeck || room.techDeck.length === 0) room.techDeck = buildTechDeck();
  return room.techDeck.pop();
}

function lockBotMoves(room) {
  room.players.filter(p => p.isBot && !p.eliminated && !p.submission).forEach(bot => {
    const hand = bot.outputHand;
    let chosenIdx = 0;
    if (bot.persona === 'COOPERATOR') {
      chosenIdx = hand.reduce((best, val, idx) =>
        Math.abs(val - room.quota) < Math.abs(hand[best] - room.quota) ? idx : best, 0);
    } else if (bot.persona === 'DEFECTOR') {
      chosenIdx = hand.reduce((best, val, idx) => (val > hand[best] ? idx : best), 0);
    } else {
      chosenIdx = hand.reduce((best, val, idx) =>
        Math.abs(val - 3) < Math.abs(hand[best] - 3) ? idx : best, 0);
    }

    let chosenTechUid = null;
    let targetId = null;
    const availableTech = bot.techHand.filter(t => (room.techReusable || !t.used) && t.id !== 'RECON');
    if (availableTech.length > 0 && Math.random() < 0.45) {
      const t = availableTech[0];
      chosenTechUid = t.uid;
      if (t.id === 'WHISTLEBLOWER' || t.id === 'EMBARGO') {
        const rivals = room.players.filter(r => r.id !== bot.id && !r.eliminated);
        if (rivals.length > 0) targetId = rivals[Math.floor(Math.random() * rivals.length)].id;
      }
    }

    bot.submission = {
      cardIndex: chosenIdx,
      barrels: hand[chosenIdx],
      releaseStored: bot.storedBarrels > 0 ? bot.storedBarrels : 0,
      techUid: chosenTechUid,
      targetId
    };
  });
}

function resolveQuarter(room) {
  const demand = room.currentDemand;
  const activePlayers = room.players.filter(p => !p.eliminated);
  const logs = [];
  const results = {};

  activePlayers.forEach(p => {
    const sub = p.submission || { cardIndex: 0, releaseStored: 0, techUid: null, targetId: null };
    const safeIdx = Math.min(sub.cardIndex, p.outputHand.length - 1);
    const baseBarrels = p.outputHand[safeIdx] || 1;
    p.outputHand.splice(safeIdx, 1);

    let techCard = null;
    if (sub.techUid) {
      const found = p.techHand.find(t => t.uid === sub.techUid && (room.techReusable || !t.used));
      if (found) {
        techCard = { ...found };
        if (!room.techReusable) {
          found.used = true;
          found.usedInQuarter = room.quarter;
        }
      }
    }

    const released = Math.min(p.storedBarrels, Number(sub.releaseStored) || 0);
    p.storedBarrels -= released;

    results[p.id] = {
      id: p.id,
      name: p.name,
      baseBarrels,
      releasedBarrels: released,
      effectiveBarrels: baseBarrels + released,
      seizedBarrels: 0,
      withheldSPR: 0,
      baseCost: OUTPUT_COSTS[baseBarrels] || 0,
      techCard,
      targetId: sub.targetId,
      fines: 0,
      bounties: 0,
      revenue: 0,
      netProfit: 0
    };
  });

  // 1. Supply Chain Embargoes
  activePlayers.forEach(p => {
    const r = results[p.id];
    if (r.techCard && r.techCard.id === 'EMBARGO' && r.targetId && results[r.targetId]) {
      const target = results[r.targetId];
      r.fines += 3;
      const reduction = Math.min(2, Math.max(0, target.effectiveBarrels - 1));
      target.effectiveBarrels -= reduction;
      logs.push(`⚓ ${p.name} imposed a Supply Chain Embargo on ${target.name} (-${reduction}B effective output).`);
    }
  });

  // 2. Market Clearing Price
  const Q_total = Object.values(results).reduce((sum, r) => sum + r.effectiveBarrels, 0);
  let P = Math.max(demand.Pmin, Math.floor(demand.A - demand.k * Q_total));
  if (demand.cap && Q_total > demand.cap) {
    P = demand.Pmin;
    logs.push(`⚠️ REFINERY BOTTLENECK! Total Supply (${Q_total}B) exceeded cap (${demand.cap}B). Price crashed to ${P}!`);
  }

  // 3. Subsidies, SPR, and Whistleblowers
  activePlayers.forEach(p => {
    const r = results[p.id];
    if (!r.techCard) return;

    if (r.techCard.id === 'SUBSIDY') {
      const saved = Math.min(6, r.baseCost);
      r.baseCost -= saved;
      logs.push(`🏛️ ${p.name} used State Energy Subsidy (-${saved} operational cost).`);
    }

    if (r.techCard.id === 'SPR' && P <= 6) {
      const withhold = Math.min(2, r.effectiveBarrels);
      r.effectiveBarrels -= withhold;
      r.withheldSPR = withhold;
      p.storedBarrels += withhold;
      logs.push(`🛢️ ${p.name} diverted ${withhold}B into their Strategic Petroleum Reserve (P <= 6).`);
    }

    if (r.techCard.id === 'WHISTLEBLOWER' && r.targetId && results[r.targetId]) {
      const target = results[r.targetId];
      const threshold = room.quota > 0 ? room.quota : 3;
      if (target.baseBarrels > threshold) {
        const excess = target.baseBarrels - threshold;
        const seized = Math.min(target.effectiveBarrels, excess);
        target.effectiveBarrels -= seized;
        target.seizedBarrels += seized;
        target.fines += 6;
        r.bounties += 3;
        logs.push(`🚨 ${p.name} blew the whistle on ${target.name}! Seized ${seized}B excess output and fined ${target.name} 6 tokens.`);
      } else {
        logs.push(`🔍 ${p.name} audited ${target.name}, but ${target.name} complied with quota (${target.baseBarrels}B <= ${threshold}B).`);
      }
    }
  });

  // 4. Net Profit & Insolvency
  activePlayers.forEach(p => {
    const r = results[p.id];
    r.revenue = r.effectiveBarrels * P;
    r.netProfit = r.revenue - r.baseCost - r.fines + r.bounties;
    p.tokens += r.netProfit;
    p.totalBarrelsSold += r.effectiveBarrels;

    if (p.tokens < 0) {
      const immune = r.techCard && r.techCard.id === 'SUBSIDY' && r.baseBarrels >= 4;
      if (!immune) {
        p.insolvencies += 1;
        if (p.insolvencies >= 2) {
          p.eliminated = true;
          logs.push(`💀 ${p.name} suffered a second insolvency and has been liquidated!`);
        } else {
          p.tokens = 5;
          p.maxHandSize = Math.max(2, p.maxHandSize - 1);
          logs.push(`🏦 ${p.name} went insolvent! Emergency Bailout reset tokens to 5 and reduced hand size.`);
        }
      } else {
        p.tokens = 0;
        logs.push(`🛡️ ${p.name} was shielded from insolvency by State Energy Subsidy!`);
      }
    }
    p.submission = null;
  });

  room.lastRoundSummary = {
    quarter: room.quarter,
    demand,
    Q_total,
    P,
    results: Object.values(results),
    logs
  };

  room.phase = 'RESULTS';
}

function advanceRoomQuarter(room) {
  if (room.quarter >= room.maxQuarters || room.players.filter(p => !p.eliminated).length <= 1) {
    room.phase = 'GAME_OVER';
    room.players.forEach(p => {
      if (p.insolvencies > 0 && !p.eliminated) p.tokens -= 5;
    });
  } else {
    room.quarter += 1;
    room.phase = 'PLAYING';
    room.currentDemand = room.demandDeck.pop();
    room.reconRevealedTo = [];

    // ONLY Output cards replenish; the 2 Tech cards dealt in Q1 remain constant!
    room.players.filter(p => !p.eliminated).forEach(p => {
      while (p.outputHand.length < p.maxHandSize) {
        p.outputHand.push(drawOutput(room));
      }
    });
  }
}

function formatRoomForPlayer(room, playerId) {
  return {
    code: room.code,
    version: room.version,
    phase: room.phase,
    quarter: room.quarter,
    maxQuarters: room.maxQuarters,
    quota: room.quota,
    techReusable: !!room.techReusable,
    currentDemand: (room.phase === 'RESULTS' || room.phase === 'GAME_OVER') ? room.currentDemand : null,
    reconDemand: (playerId && room.reconRevealedTo.includes(playerId)) ? room.currentDemand : null,
    lastRoundSummary: room.lastRoundSummary,
    backup: room, // Used for automatic client-assisted cold-start recovery on serverless
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      tokens: p.tokens,
      storedBarrels: p.storedBarrels,
      totalBarrelsSold: p.totalBarrelsSold,
      insolvencies: p.insolvencies,
      eliminated: p.eliminated,
      locked: !!p.submission,
      outputHand: p.id === playerId ? p.outputHand : undefined,
      techHand: p.id === playerId ? p.techHand : undefined,
      techRemaining: p.techHand.filter(t => room.techReusable || !t.used).length
    }))
  };
}

function getAdminSnapshot(store) {
  const roomList = [];
  const globalLeaderboard = [];

  for (const room of Object.values(store)) {
    roomList.push({
      code: room.code,
      phase: room.phase,
      quarter: room.quarter,
      maxQuarters: room.maxQuarters,
      quota: room.quota,
      techReusable: !!room.techReusable,
      createdAt: room.createdAt,
      currentDemand: room.currentDemand,
      lastRoundSummary: room.lastRoundSummary,
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        tokens: p.tokens,
        storedBarrels: p.storedBarrels,
        totalBarrelsSold: p.totalBarrelsSold,
        insolvencies: p.insolvencies,
        eliminated: p.eliminated,
        locked: !!p.submission,
        outputHand: p.outputHand,
        techHand: p.techHand.map(t => `${t.name}${t.used && !room.techReusable ? ' (USED)' : ''}`),
        lockedPreview: p.submission ? `${p.outputHand[p.submission.cardIndex]}B` : null
      }))
    });

    room.players.forEach(p => {
      globalLeaderboard.push({
        playerId: p.id,
        name: p.name,
        isBot: p.isBot,
        roomCode: room.code,
        phase: room.phase,
        quarter: `${room.quarter}/${room.maxQuarters}`,
        tokens: p.tokens,
        storedBarrels: p.storedBarrels,
        totalBarrelsSold: p.totalBarrelsSold,
        insolvencies: p.insolvencies,
        eliminated: p.eliminated
      });
    });
  }

  globalLeaderboard.sort((a, b) => (b.tokens - a.tokens) || (a.totalBarrelsSold - b.totalBarrelsSold));

  return {
    totalRooms: roomList.length,
    totalPlayers: globalLeaderboard.length,
    rooms: roomList,
    leaderboard: globalLeaderboard
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'Cournot Cartel Serverless API Ready' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const store = getStore();
  const { action, code, playerId, playerName, isProjector, backup } = body;
  const cleanCode = (code || '').toUpperCase().trim();

  // Serverless Cold-Start Fail-Safe Hydration
  if (cleanCode && !store[cleanCode] && backup && backup.code === cleanCode) {
    store[cleanCode] = backup;
    saveStore();
  }

  // --- ADMIN ACTIONS ---
  if (action === 'ADMIN_POLL') {
    if (body.key !== ADMIN_KEY) {
      return res.status(401).json({ error: 'Invalid Admin Passkey.' });
    }
    return res.status(200).json(getAdminSnapshot(store));
  }

  if (action === 'ADMIN_ADJUST') {
    if (body.key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const room = store[cleanCode];
    if (room) {
      const p = room.players.find(pl => pl.id === body.targetPlayerId);
      if (p) {
        p.tokens += Number(body.delta) || 0;
        room.version = (room.version || 1) + 1;
        saveStore();
      }
    }
    return res.status(200).json(getAdminSnapshot(store));
  }

  if (action === 'ADMIN_FORCE') {
    if (body.key !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const room = store[cleanCode];
    if (room) {
      if (body.subAction === 'FORCE_RESOLVE' && room.phase === 'PLAYING') {
        lockBotMoves(room);
        resolveQuarter(room);
      } else if (body.subAction === 'FORCE_NEXT' && room.phase === 'RESULTS') {
        advanceRoomQuarter(room);
      } else if (body.subAction === 'DELETE_ROOM') {
        delete store[cleanCode];
      }
      if (store[cleanCode]) room.version = (room.version || 1) + 1;
      saveStore();
    }
    return res.status(200).json(getAdminSnapshot(store));
  }

  // --- PLAYER & ROOM ACTIONS ---
  if (action === 'CREATE_ROOM') {
    const newCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    const room = {
      code: newCode,
      version: 1,
      phase: 'LOBBY',
      quarter: 1,
      maxQuarters: 5,
      quota: 2,
      techReusable: false, // Default: 2 cards dealt at start for the whole 5 rounds (1 use each)
      createdAt: new Date().toLocaleTimeString(),
      outputDeck: buildOutputDeck(),
      demandDeck: buildDemandDeck(),
      techDeck: buildTechDeck(),
      currentDemand: null,
      reconRevealedTo: [],
      lastRoundSummary: null,
      players: []
    };

    if (!isProjector) {
      room.players.push({
        id: playerId,
        name: playerName || 'Firm Alpha',
        isBot: false,
        tokens: 20,
        storedBarrels: 0,
        totalBarrelsSold: 0,
        insolvencies: 0,
        maxHandSize: 5,
        eliminated: false,
        outputHand: [],
        techHand: [],
        submission: null
      });
    }

    store[newCode] = room;
    saveStore();
    return res.status(200).json({ room: formatRoomForPlayer(room, playerId) });
  }

  const room = store[cleanCode];
  if (!room) {
    return res.status(404).json({ error: 'Room code not found.' });
  }

  if (action === 'JOIN_ROOM') {
    if (!isProjector && room.phase === 'LOBBY' && room.players.length < 6) {
      if (!room.players.some(p => p.id === playerId)) {
        room.players.push({
          id: playerId,
          name: playerName || `Firm ${room.players.length + 1}`,
          isBot: false,
          tokens: 20,
          storedBarrels: 0,
          totalBarrelsSold: 0,
          insolvencies: 0,
          maxHandSize: 5,
          eliminated: false,
          outputHand: [],
          techHand: [],
          submission: null
        });
        room.version += 1;
        saveStore();
      }
    }
    return res.status(200).json({ room: formatRoomForPlayer(room, playerId) });
  }

  if (action === 'POLL') {
    return res.status(200).json({ room: formatRoomForPlayer(room, playerId) });
  }

  if (action === 'ADD_BOT') {
    if (room.phase === 'LOBBY' && room.players.length < 6) {
      const names = { COOPERATOR: 'OPEC Loyalists AI', DEFECTOR: 'Rogue Shale AI', BALANCED: 'Nash Quant AI' };
      room.players.push({
        id: `bot_${Math.random().toString(36).slice(2, 7)}`,
        name: names[body.persona] || 'Cournot Bot',
        isBot: true,
        persona: body.persona || 'BALANCED',
        tokens: 20,
        storedBarrels: 0,
        totalBarrelsSold: 0,
        insolvencies: 0,
        maxHandSize: 5,
        eliminated: false,
        outputHand: [],
        techHand: [],
        submission: null
      });
      room.version += 1;
      saveStore();
    }
    return res.status(200).json({ room: formatRoomForPlayer(room, playerId) });
  }

  if (action === 'TOGGLE_TECH_MODE') {
    room.techReusable = !!body.techReusable;
    room.version += 1;
    saveStore();
    return res.status(200).json({ room: formatRoomForPlayer(room, playerId) });
  }

  if (action === 'START_GAME') {
    if (room.players.length >= 2) {
      room.quarter = 1;
      room.phase = 'PLAYING';
      room.outputDeck = buildOutputDeck();
      room.demandDeck = buildDemandDeck();
      room.techDeck = buildTechDeck();
      room.currentDemand = room.demandDeck.pop();
      room.reconRevealedTo = [];
      room.lastRoundSummary = null;

      room.players.forEach(p => {
        p.tokens = 20;
        p.storedBarrels = 0;
        p.totalBarrelsSold = 0;
        p.insolvencies = 0;
        p.maxHandSize = 5;
        p.eliminated = false;
        p.submission = null;
        p.outputHand = Array.from({ length: 5 }, () => drawOutput(room));
        // Exactly 2 Tech Cards dealt at the start of the game for all 5 rounds
        p.techHand = [drawTech(room), drawTech(room)];
      });

      room.version += 1;
      saveStore();
    }
    return res.status(200).json({ room: formatRoomForPlayer(room, playerId) });
  }

  if (action === 'SET_QUOTA') {
    room.quota = Number(body.quota) || 2;
    room.version += 1;
    saveStore();
    return res.status(200).json({ room: formatRoomForPlayer(room, playerId) });
  }

  if (action === 'USE_RECON') {
    const player = room.players.find(p => p.id === playerId);
    if (player && room.phase === 'PLAYING') {
      const card = player.techHand.find(t => t.uid === body.techUid && t.id === 'RECON' && (room.techReusable || !t.used));
      if (card) {
        if (!room.techReusable) {
          card.used = true;
          card.usedInQuarter = room.quarter;
        }
        if (!room.reconRevealedTo.includes(playerId)) {
          room.reconRevealedTo.push(playerId);
        }
        room.version += 1;
        saveStore();
      }
    }
    return res.status(200).json({ room: formatRoomForPlayer(room, playerId) });
  }

  if (action === 'LOCK_MOVE') {
    const player = room.players.find(p => p.id === playerId);
    if (player && !player.eliminated && room.phase === 'PLAYING') {
      player.submission = {
        cardIndex: Number(body.cardIndex) || 0,
        releaseStored: Number(body.releaseStored) || 0,
        techUid: body.techUid || null,
        targetId: body.targetId || null
      };

      lockBotMoves(room);

      const allReady = room.players.filter(p => !p.eliminated).every(p => !!p.submission);
      if (allReady) {
        resolveQuarter(room);
      }
      room.version += 1;
      saveStore();
    }
    return res.status(200).json({ room: formatRoomForPlayer(room, playerId) });
  }

  if (action === 'NEXT_QUARTER') {
    if (room.phase === 'RESULTS') {
      advanceRoomQuarter(room);
      room.version += 1;
      saveStore();
    }
    return res.status(200).json({ room: formatRoomForPlayer(room, playerId) });
  }

  return res.status(400).json({ error: 'Unknown action' });
};