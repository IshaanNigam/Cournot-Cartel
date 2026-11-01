const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const ADMIN_KEY = process.env.ADMIN_KEY || 'gts-admin-2026';

app.use(express.static(path.join(__dirname, 'public')));

// Direct route for the Admin Dashboard
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

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
    desc: 'Reduce your operational production cost this quarter by 6 tokens (minimum 0).'
  },
  {
    id: 'EMBARGO',
    name: 'Supply Chain Embargo',
    desc: 'Pay 3 tokens to blockade a rival: reduces their effective output by 2B (minimum 1B) while they still pay full production cost.'
  },
  {
    id: 'RECON',
    name: 'Satellite Reconnaissance',
    desc: 'Use during Summit: privately inspect this quarter’s Demand Shock Card before locking in your output.'
  }
];

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
    for (let i = 0; i < 3; i++) deck.push({ ...t, uid: `${t.id}_${Math.random().toString(36).slice(2, 7)}` });
  });
  return shuffle(deck);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const rooms = new Map();
const adminSockets = new Set();

function drawOutput(room) {
  if (room.outputDeck.length === 0) room.outputDeck = buildOutputDeck();
  return room.outputDeck.pop();
}

function drawTech(room) {
  if (room.techDeck.length === 0) room.techDeck = buildTechDeck();
  return room.techDeck.pop();
}

function getPublicRoomState(room, forSocketId = null) {
  return {
    code: room.code,
    phase: room.phase,
    quarter: room.quarter,
    maxQuarters: room.maxQuarters,
    quota: room.quota,
    currentDemand: (room.phase === 'RESULTS' || room.phase === 'GAME_OVER') ? room.currentDemand : null,
    reconDemand: (forSocketId && room.reconRevealedTo.includes(forSocketId)) ? room.currentDemand : null,
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
      handCount: p.outputHand.length,
      techCount: p.techHand.length,
      outputHand: p.id === forSocketId ? p.outputHand : undefined,
      techHand: p.id === forSocketId ? p.techHand : undefined,
      submission: p.id === forSocketId ? p.submission : undefined
    }))
  };
}

function getAdminSnapshot() {
  const roomList = [];
  const globalLeaderboard = [];

  for (const room of rooms.values()) {
    roomList.push({
      code: room.code,
      phase: room.phase,
      quarter: room.quarter,
      maxQuarters: room.maxQuarters,
      quota: room.quota,
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
        techHand: p.techHand.map(t => t.name),
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

function broadcastAdmin() {
  if (adminSockets.size === 0) return;
  const snapshot = getAdminSnapshot();
  adminSockets.forEach(sid => {
    io.to(sid).emit('adminState', snapshot);
  });
}

function broadcastRoom(room) {
  room.sockets.forEach(sid => {
    io.to(sid).emit('roomState', getPublicRoomState(room, sid));
  });
  broadcastAdmin();
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

    let chosenTechId = null;
    let targetId = null;
    if (bot.techHand.length > 0 && Math.random() < 0.5) {
      const t = bot.techHand[0];
      if (t.id !== 'RECON') {
        chosenTechId = t.uid;
        if (t.id === 'WHISTLEBLOWER' || t.id === 'EMBARGO') {
          const rivals = room.players.filter(r => r.id !== bot.id && !r.eliminated);
          if (rivals.length > 0) targetId = rivals[Math.floor(Math.random() * rivals.length)].id;
        }
      }
    }

    bot.submission = {
      cardIndex: chosenIdx,
      barrels: hand[chosenIdx],
      releaseStored: bot.storedBarrels > 0 ? bot.storedBarrels : 0,
      techUid: chosenTechId,
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
    // Auto-pick card index 0 if force-resolved by Admin before player locked in
    const sub = p.submission || { cardIndex: 0, releaseStored: 0, techUid: null, targetId: null };
    const safeIdx = Math.min(sub.cardIndex, p.outputHand.length - 1);
    const baseBarrels = p.outputHand[safeIdx] || 1;
    p.outputHand.splice(safeIdx, 1);

    let techCard = null;
    if (sub.techUid) {
      const tIdx = p.techHand.findIndex(t => t.uid === sub.techUid);
      if (tIdx !== -1) {
        techCard = p.techHand[tIdx];
        p.techHand.splice(tIdx, 1);
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

  const Q_total = Object.values(results).reduce((sum, r) => sum + r.effectiveBarrels, 0);
  let P = Math.max(demand.Pmin, Math.floor(demand.A - demand.k * Q_total));
  if (demand.cap && Q_total > demand.cap) {
    P = demand.Pmin;
    logs.push(`⚠️ REFINERY BOTTLENECK TRIGGERED! Total Supply (${Q_total}B) exceeded cap (${demand.cap}B). Price crashed to ${P}!`);
  }

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
      logs.push(`🛢️ ${p.name} diverted ${withhold}B into their Strategic Petroleum Reserve because P <= 6.`);
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
        logs.push(`🚨 ${p.name} blew the whistle on ${target.name}! Regulators seized ${seized}B excess output and fined ${target.name} 6 tokens.`);
      } else {
        logs.push(`🔍 ${p.name} audited ${target.name}, but ${target.name} complied with quota (${target.baseBarrels}B <= ${threshold}B).`);
      }
    }
  });

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
          logs.push(`🏦 ${p.name} went insolvent! Emergency Bailout reset tokens to 5 and permanently reduced hand size.`);
        }
      } else {
        p.tokens = 0;
        logs.push(`🛡️ ${p.name} was shielded from insolvency by their State Energy Subsidy!`);
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

    room.players.filter(p => !p.eliminated).forEach(p => {
      while (p.outputHand.length < p.maxHandSize) {
        p.outputHand.push(drawOutput(room));
      }
      if (p.techHand.length < 3) {
        p.techHand.push(drawTech(room));
      }
    });
  }
}

io.on('connection', socket => {
  // --- ADMIN EVENTS ---
  socket.on('adminAuth', ({ key }) => {
    if (key === ADMIN_KEY) {
      adminSockets.add(socket.id);
      socket.isAdmin = true;
      socket.emit('adminAuthSuccess', getAdminSnapshot());
    } else {
      socket.emit('adminAuthError', 'Invalid Admin Passkey.');
    }
  });

  socket.on('adminAdjustTokens', ({ roomCode, playerId, delta }) => {
    if (!socket.isAdmin) return;
    const room = rooms.get(roomCode);
    if (!room) return;
    const p = room.players.find(pl => pl.id === playerId);
    if (p) {
      p.tokens += Number(delta) || 0;
      broadcastRoom(room);
    }
  });

  socket.on('adminForceAction', ({ roomCode, action }) => {
    if (!socket.isAdmin) return;
    const room = rooms.get(roomCode);
    if (!room) return;

    if (action === 'FORCE_RESOLVE' && room.phase === 'PLAYING') {
      lockBotMoves(room);
      resolveQuarter(room);
      broadcastRoom(room);
    } else if (action === 'FORCE_NEXT' && room.phase === 'RESULTS') {
      advanceRoomQuarter(room);
      broadcastRoom(room);
    } else if (action === 'DELETE_ROOM') {
      rooms.delete(roomCode);
      broadcastAdmin();
    }
  });

  // --- PLAYER EVENTS ---
  socket.on('createRoom', ({ playerName, isProjector }) => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    const room = {
      code,
      phase: 'LOBBY',
      quarter: 1,
      maxQuarters: 5,
      quota: 2,
      createdAt: new Date().toLocaleTimeString(),
      outputDeck: buildOutputDeck(),
      demandDeck: buildDemandDeck(),
      techDeck: buildTechDeck(),
      currentDemand: null,
      reconRevealedTo: [],
      lastRoundSummary: null,
      players: [],
      sockets: [socket.id]
    };

    if (!isProjector) {
      room.players.push({
        id: socket.id,
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

    rooms.set(code, room);
    socket.join(code);
    socket.roomCode = code;
    broadcastRoom(room);
  });

  socket.on('joinRoom', ({ code, playerName, isProjector }) => {
    const cleanCode = (code || '').toUpperCase().trim();
    const room = rooms.get(cleanCode);
    if (!room) return socket.emit('errorMsg', 'Room code not found.');

    if (!room.sockets.includes(socket.id)) room.sockets.push(socket.id);
    socket.join(cleanCode);
    socket.roomCode = cleanCode;

    if (!isProjector && room.phase === 'LOBBY' && room.players.length < 6) {
      if (!room.players.some(p => p.id === socket.id)) {
        room.players.push({
          id: socket.id,
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
      }
    }
    broadcastRoom(room);
  });

  socket.on('addBot', ({ persona }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'LOBBY' || room.players.length >= 6) return;
    const names = { COOPERATOR: 'OPEC Loyalists AI', DEFECTOR: 'Rogue Shale AI', BALANCED: 'Nash Quant AI' };
    room.players.push({
      id: `bot_${Math.random().toString(36).slice(2, 7)}`,
      name: names[persona] || 'Cournot Bot',
      isBot: true,
      persona: persona || 'BALANCED',
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
    broadcastRoom(room);
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.players.length < 2) return;

    room.quarter = 1;
    room.phase = 'PLAYING';
    room.currentDemand = room.demandDeck.pop();
    room.reconRevealedTo = [];

    room.players.forEach(p => {
      p.outputHand = Array.from({ length: 5 }, () => drawOutput(room));
      p.techHand = [drawTech(room), drawTech(room)];
    });

    broadcastRoom(room);
  });

  socket.on('setQuota', ({ quota }) => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    room.quota = Number(quota) || 2;
    broadcastRoom(room);
  });

  socket.on('useRecon', ({ techUid }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'PLAYING') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const idx = player.techHand.findIndex(t => t.uid === techUid && t.id === 'RECON');
    if (idx !== -1) {
      player.techHand.splice(idx, 1);
      room.reconRevealedTo.push(socket.id);
      broadcastRoom(room);
    }
  });

  socket.on('lockMove', ({ cardIndex, releaseStored, techUid, targetId }) => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'PLAYING') return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.eliminated) return;

    player.submission = {
      cardIndex: Number(cardIndex) || 0,
      releaseStored: Number(releaseStored) || 0,
      techUid: techUid || null,
      targetId: targetId || null
    };

    lockBotMoves(room);

    const allReady = room.players.filter(p => !p.eliminated).every(p => !!p.submission);
    if (allReady) {
      resolveQuarter(room);
    }
    broadcastRoom(room);
  });

  socket.on('nextQuarter', () => {
    const room = rooms.get(socket.roomCode);
    if (!room || room.phase !== 'RESULTS') return;
    advanceRoomQuarter(room);
    broadcastRoom(room);
  });

  socket.on('disconnect', () => {
    adminSockets.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Cournot Cartel server running on http://localhost:${PORT}`);
  console.log(`Admin Dashboard available at http://localhost:${PORT}/admin (Key: ${ADMIN_KEY})`);
});