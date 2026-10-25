#!/usr/bin/env node
/* ============================================================
   server.js — 夜航俱乐部 · 同桌联机服务器
   零依赖：Node 自带模块 + js/poker.js 权威引擎。
   提供：
   1) 静态文件（默认服务项目根目录，room.html 即联机入口）
   2) WebSocket 房间制牌局：建房/加入/入座换座/围观/行动/摊牌/
      重新买入/断线重连

   座位模型：房间固定 9 个座位，空位任何人可坐（仅限一手结束后）；
   围观者随时可以点空位上桌。底牌在摊牌前不会离开服务器。

   启动：node server/server.js   （PORT 可用环境变量覆盖）
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Poker = require(path.join(__dirname, "..", "js", "poker.js"));
const { upgrade } = require("./ws-lite.js");

const PORT = Number(process.env.PORT || 8080);
const ROOT = process.env.WEB_ROOT
  ? path.resolve(process.env.WEB_ROOT)
  : path.resolve(__dirname, "..");

const TURN_SECONDS = 60;              // 每回合思考时间
const LOBBY_DROP_MS = 60 * 1000;      // 围观/大厅掉线宽限
const ROOM_IDLE_MS = 30 * 60 * 1000;  // 无人房间保留时长
const OFFLINE_DROP_MS = 5 * 60 * 1000;// 牌局中掉线座位保留时长
const HOST_OFFLINE_MS = 90 * 1000;    // 庄家掉线多久后转移庄家
const SEAT_COUNT = 9;
const MAX_MESSAGE = 1 << 20;

const SB_MIN = 10, SB_MAX = 1000;      // 小盲：10 的倍数
const STACK_MIN = 100, STACK_MAX = 100000;
const BLIND_MINS = [1, 2, 3, 5, 10];   // 升盲时间选项（分钟）
const AVATAR_COUNT = 10;
const CODE_LEN = 4;

/* ---------------- 房间 ---------------- */

const rooms = new Map();

function newCode() {
  for (;;) {
    let c = "";
    for (let i = 0; i < CODE_LEN; i++) c += crypto.randomInt(10);
    if (!rooms.has(c)) return c;
  }
}

function cleanName(raw) {
  const s = String(raw == null ? "" : raw).replace(/[\u0000-\u001f<>]/g, "").trim();
  return s.slice(0, 8);
}

function cleanSb(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < SB_MIN || n > SB_MAX || n % 10 !== 0) return null;
  return n;
}

function cleanStack(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < STACK_MIN || n > STACK_MAX) return null;
  return n;
}

function cleanBlindMins(v) {
  const n = Math.round(Number(v));
  return BLIND_MINS.includes(n) ? n : 2;
}

function newPerson(name, avatar, conn) {
  return {
    token: crypto.randomBytes(12).toString("hex"),
    name,
    avatar: Number.isInteger(avatar) && avatar >= 0 && avatar < AVATAR_COUNT ? avatar : crypto.randomInt(AVATAR_COUNT),
    conn,
    lastSeen: Date.now(),
    bank: null             // 去围观时暂存的筹码；上桌时带回
  };
}

function createRoom(conn, msg) {
  const sb = cleanSb(msg.sb);
  if (!sb) return send(conn, { t: "err", msg: "小盲必须是 10 的倍数（10～1000）" });
  const stack = cleanStack(msg.stack);
  if (!stack) return send(conn, { t: "err", msg: "初始筹码请在 " + STACK_MIN + "～" + STACK_MAX + " 之间" });

  const room = {
    code: newCode(),
    cfg: { sb, bb: sb * 2, stack, blindMins: cleanBlindMins(msg.blindMins) },
    people: [],           // 所有进过房间的连接者（含围观）
    seats: new Array(SEAT_COUNT).fill(null),
    table: null,
    hostToken: null,
    turnTimer: null,
    turnEndsAt: 0,
    blindLevel: 1,
    blindEndsAt: 0,       // 第一手开局才开始计升盲
    blindTimer: null,
    toastSeq: 0,
    lastToast: null,
    lastActivity: Date.now()
  };
  rooms.set(room.code, room);

  const person = newPerson(cleanName(msg.name) || "庄家", msg.avatar, conn);
  room.people.push(person);
  room.seats[0] = person;
  room.hostToken = person.token;
  bindConn(conn, room, person.token);
  send(conn, { t: "joined", code: room.code, token: person.token, seat: 0 });
  broadcast(room);
}

function bindConn(conn, room, token) {
  conn.roomCode = room.code;
  conn.token = token;
}

function personByToken(room, token) {
  if (!token) return null;
  return room.people.find((p) => p.token === token) || null;
}

function seatOf(room, person) {
  return room.seats.indexOf(person);
}

function seatedCount(room) {
  return room.seats.filter(Boolean).length;
}

function firstEmptySeat(room) {
  return room.seats.indexOf(null);
}

/* 入座 / 换座：仅限一手结束（或还没开局）时 */
function sitDown(room, person, seat) {
  if (!Number.isInteger(seat) || seat < 0 || seat >= SEAT_COUNT) {
    return { ok: false, msg: "座位号无效" };
  }
  if (room.table && !["lobby", "handover"].includes(room.table.phase)) {
    return { ok: false, msg: "这一手打完才能换座位" };
  }
  if (room.seats[seat] === person) return { ok: true };
  if (room.seats[seat]) return { ok: false, msg: "这个座位有人了" };

  const mySeat = seatOf(room, person);
  if (room.table) {
    const t = room.table;
    if (mySeat >= 0) {
      // 换座：筹码跟着人走
      t.players[seat].stack = t.players[mySeat].stack;
      t.players[mySeat].stack = 0;
    } else {
      // 围观者/重新上桌：带上自己暂存的筹码，或按初始筹码买入
      t.players[seat].stack = (person.bank != null && person.bank > 0) ? person.bank : room.cfg.stack;
      person.bank = null;
      toast(room, person.name + " 上桌了");
    }
    t.players[seat].name = person.name;
    if (mySeat >= 0) t.players[mySeat].name = "空位";
  }
  if (mySeat >= 0) room.seats[mySeat] = null;
  room.seats[seat] = person;
  return { ok: true };
}

/* 起立去围观：筹码暂存到人身上，点空位随时回来 */
function playerStand(room, conn) {
  const person = personByConn(room, conn);
  if (!person) return send(conn, { t: "err", msg: "先加入房间" });
  const seat = seatOf(room, person);
  if (seat < 0) return send(conn, { t: "err", msg: "你已经在围观了" });
  if (room.table && !["lobby", "handover"].includes(room.table.phase)) {
    return send(conn, { t: "err", msg: "这一手打完才能去围观" });
  }
  if (room.table) {
    person.bank = room.table.players[seat].stack;
    room.table.players[seat].stack = 0;
    room.table.players[seat].name = "空位";
  }
  room.seats[seat] = null;
  toast(room, person.name + " 去围观了");
  broadcast(room);
}

function joinRoom(conn, msg) {  const room = rooms.get(String(msg.code || ""));
  if (!room) return send(conn, { t: "err", msg: "房间不存在，检查一下房间号" });
  const person = personByToken(room, msg.token);

  if (person) {                         // 断线重连，回到原座位
    if (person.conn && person.conn !== conn && !person.conn.closed) {
      send(person.conn, { t: "replaced" });
      person.conn.close();
    }
    person.conn = conn;
    person.lastSeen = Date.now();
    bindConn(conn, room, person.token);
    send(conn, { t: "joined", code: room.code, token: person.token, seat: seatOf(room, person) });
    broadcast(room);
    return;
  }

  const isNew = {
    token: crypto.randomBytes(12).toString("hex"),
    name: cleanName(msg.name) || "玩家",
    avatar: Number.isInteger(msg.avatar) && msg.avatar >= 0 && msg.avatar < AVATAR_COUNT ? msg.avatar : crypto.randomInt(AVATAR_COUNT),
    conn,
    lastSeen: Date.now()
  };

  if (firstEmptySeat(room) < 0) {
    // 九个座位都满了：默认围观，点空位随时上桌
    room.people.push(isNew);    bindConn(conn, room, isNew.token);
    send(conn, { t: "joined", code: room.code, token: isNew.token, seat: -1 });
    broadcast(room);
    return;
  }

  const seat = firstEmptySeat(room);
  room.people.push(isNew);
  const r = sitDown(room, isNew, seat);
  if (!r.ok) {                          // 理论上不会发生（座位刚判定为空）
    room.people.splice(room.people.indexOf(isNew), 1);
    return send(conn, { t: "err", msg: r.msg });
  }
  bindConn(conn, room, isNew.token);
  send(conn, { t: "joined", code: room.code, token: isNew.token, seat });
  broadcast(room);
}

/* ---------------- 消息路由 ---------------- */

function onMessage(conn, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (e) { return; }
  if (!msg || typeof msg.t !== "string") return;

  // 心跳不依赖房间，先于房间校验处理
  if (msg.t === "ping") return send(conn, { t: "pong" });

  const room = conn.roomCode ? rooms.get(conn.roomCode) : null;
  if (!room) {
    if (msg.t === "create") return createRoom(conn, msg);
    if (msg.t === "join") return joinRoom(conn, msg);
    return send(conn, { t: "err", msg: "先创建或加入房间" });
  }
  room.lastActivity = Date.now();

  switch (msg.t) {
    case "start": return hostStart(room, conn);
    case "act": return playerAct(room, conn, msg);
    case "rebuy": return playerRebuy(room, conn);
    case "sit": return playerSit(room, conn, msg);
    case "stand": return playerStand(room, conn);
    case "sticker": return relaySticker(room, conn, msg);
    case "leave": return leaveRoom(room, conn);
    default: return;
  }
}

function personByConn(room, conn) {
  return personByToken(room, conn.token);
}

function isHost(room, person) {
  return person && person.token === room.hostToken;
}

function hostStart(room, conn) {
  const person = personByConn(room, conn);
  if (!isHost(room, person)) return send(conn, { t: "err", msg: "只有庄家能开局" });

  if (!room.table) {
    if (seatedCount(room) < 2) return send(conn, { t: "err", msg: "至少要两位玩家入座才能开局" });
    room.table = Poker.createTable({
      seats: SEAT_COUNT,
      stack: room.cfg.stack,
      sb: room.cfg.sb,
      bb: room.cfg.bb,
      names: room.seats.map((p) => (p ? p.name : "空位"))
    });
    for (let i = 0; i < SEAT_COUNT; i++) {
      if (!room.seats[i]) room.table.players[i].stack = 0;   // 空位不参与
    }
    toast(room, "牌局开始，祝好运");
  } else if (room.table.phase === "handover") {
    if (Poker.alive(room.table).length < 2) {
      return send(conn, { t: "err", msg: "有玩家筹码为 0，等TA重新买入或换座后再开下一手" });
    }
  } else {
    return send(conn, { t: "err", msg: "这一手还没打完" });
  }

  // 按当前盲注等级设置本手盲注（升级在下一手生效）
  const mul = Math.pow(2, room.blindLevel - 1);
  room.table.cfg.sb = room.cfg.sb * mul;
  room.table.cfg.bb = room.cfg.bb * mul;

  startBlindClock(room);
  Poker.startHand(room.table);
  scheduleTurn(room);
  broadcast(room);
}

/* 升盲时钟：第一手开局启动，按房主设定的时间升一级，升级在下一手生效 */
function startBlindClock(room) {
  if (room.blindTimer) return;
  const ms = room.cfg.blindMins * 60 * 1000;
  room.blindEndsAt = Date.now() + ms;
  room.blindTimer = setTimeout(() => onBlindUp(room), ms + 200);
}

function onBlindUp(room) {
  room.blindTimer = null;
  if (!room.table) return;
  room.blindLevel += 1;
  const mul = Math.pow(2, room.blindLevel - 1);
  const sb = room.cfg.sb * mul, bb = room.cfg.bb * mul;
  toast(room, "升盲 · 下一手盲注 " + sb + "/" + bb);
  room.blindEndsAt = Date.now() + room.cfg.blindMins * 60 * 1000;
  room.blindTimer = setTimeout(() => onBlindUp(room), room.cfg.blindMins * 60 * 1000 + 200);
  broadcast(room);
}

function playerAct(room, conn, msg) {
  const t = room.table;
  const person = personByConn(room, conn);
  if (!t || !person) return send(conn, { t: "err", msg: "现在不能行动" });
  const seat = seatOf(room, person);
  if (t.turn !== seat) return send(conn, { t: "err", msg: "还没轮到你" });

  const action = { type: msg.type };
  if (action.type === "raise") action.to = Math.round(Number(msg.to) || 0);
  const r = Poker.act(t, seat, action);
  if (!r.ok) return send(conn, { t: "err", msg: r.error || "无法行动" });

  scheduleTurn(room);
  broadcast(room);
}

function playerRebuy(room, conn) {
  const t = room.table;
  const person = personByConn(room, conn);
  if (!t || !person) return send(conn, { t: "err", msg: "现在不能重新买入" });
  const seat = seatOf(room, person);
  if (seat < 0) return send(conn, { t: "err", msg: "先上桌再买入" });
  const p = t.players[seat];
  if (t.phase !== "handover" || p.stack >= t.cfg.bb) {
    return send(conn, { t: "err", msg: "筹码还够，不用买入" });
  }
  p.stack = room.cfg.stack;
  toast(room, person.name + " 重新买入 " + room.cfg.stack);
  broadcast(room);
}

function playerSit(room, conn, msg) {
  const person = personByConn(room, conn);
  if (!person) return send(conn, { t: "err", msg: "先加入房间" });
  const r = sitDown(room, person, Number(msg.seat));
  if (!r.ok) return send(conn, { t: "err", msg: r.msg });
  broadcast(room);
}

/* 表情：服务端只转发，动画各端本地播放（发送者也会收到，走同一条动画路径） */
function relaySticker(room, conn, msg) {
  const person = personByConn(room, conn);
  if (!person || !room.table) return;
  const from = seatOf(room, person);
  if (from < 0) return;
  const to = Number(msg.to);
  if (!Number.isInteger(to) || to < 0 || to >= SEAT_COUNT || to === from || !room.seats[to]) return;
  broadcastRaw(room, { t: "sticker", from, to });
}

function leaveRoom(room, conn) {
  const person = personByConn(room, conn);
  if (person) {
    const seat = seatOf(room, person);
    if (seat >= 0) freeSeat(room, seat, null);
    room.people.splice(room.people.indexOf(person), 1);
    // 庄家走了就立刻换人，别等定时清扫，否则牌桌会卡在「没人能开局」
    if (room.hostToken === person.token) {
      const online = room.people.find((p) => p.conn && !p.conn.closed);
      room.hostToken = online ? online.token : (room.people[0] ? room.people[0].token : null);
    }
    broadcast(room);          // 立刻告诉其他人：座位空出来了
  }
  conn.close();
}

function freeSeat(room, seat, reason) {
  const person = room.seats[seat];
  if (!person) return;
  room.seats[seat] = null;
  if (room.table) room.table.players[seat].stack = 0;   // 下手开始自动出局
  if (reason) toast(room, person.name + " " + reason);
}

/* ---------------- 回合计时 ---------------- */

function scheduleTurn(room) {
  if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
  const t = room.table;
  if (!t || t.turn < 0) return;
  if (!["preflop", "flop", "turn", "river"].includes(t.phase)) return;
  room.turnEndsAt = Date.now() + TURN_SECONDS * 1000;
  room.turnTimer = setTimeout(() => onTurnExpire(room), TURN_SECONDS * 1000 + 300);
}

function onTurnExpire(room) {
  const t = room.table;
  if (!t || t.turn < 0) return;
  const seat = t.turn;
  const legal = Poker.legalActions(t, seat);
  const action = legal.canCheck ? { type: "check" } : { type: "fold" };
  const r = Poker.act(t, seat, action);
  if (r.ok) toast(room, (t.players[seat] ? t.players[seat].name : "玩家") + " 超时，自动" + (legal.canCheck ? "过牌" : "弃牌"));
  scheduleTurn(room);
  broadcast(room);
}

/* ---------------- 掉线与房间回收 ---------------- */

function onConnClose(conn) {
  const room = conn.roomCode ? rooms.get(conn.roomCode) : null;
  if (!room) return;
  const person = personByConn(room, conn);
  if (!person) return broadcast(room);
  person.conn = null;
  person.lastSeen = Date.now();
  // 座位暂时保留（宽限期内刷新可回座）；庄家身份不因临时断线转移
  broadcast(room);
}

function sweep() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    for (let i = room.people.length - 1; i >= 0; i--) {
      const p = room.people[i];
      if (p.conn) continue;
      const away = now - p.lastSeen;
      const seat = room.seats.indexOf(p);
      if (seat >= 0) {
        if (away > OFFLINE_DROP_MS) {
          freeSeat(room, seat, "长时间离线，已请离牌桌");
          room.people.splice(i, 1);
        }
      } else if (away > LOBBY_DROP_MS) {
        room.people.splice(i, 1);
      }
    }
    // 庄家长时间掉线才转移庄家，刷新页面不会丢庄家
    const hostPerson = personByToken(room, room.hostToken);
    if (!hostPerson || (!hostPerson.conn && now - hostPerson.lastSeen > HOST_OFFLINE_MS)) {
      const online = room.people.find((p) => p.conn);
      room.hostToken = online ? online.token : (room.people[0] ? room.people[0].token : null);
    }
    const anyOnline = room.people.some((p) => p.conn);
    if (!anyOnline && now - room.lastActivity > ROOM_IDLE_MS) {
      if (room.turnTimer) clearTimeout(room.turnTimer);
      if (room.blindTimer) clearTimeout(room.blindTimer);
      rooms.delete(code);
    }
  }
}
setInterval(sweep, 60 * 1000).unref();

// 心跳：每 30s ping 一次，70s 没收到 pong 才断开（浏览器会自动回 pong）
setInterval(() => {
  for (const room of rooms.values()) {
    for (const p of room.people) {
      if (!p.conn) continue;
      if (Date.now() - p.conn.lastPong > 70000) p.conn._terminate();
      else p.conn.ping();
    }
  }
}, 30 * 1000).unref();

/* ---------------- 状态广播 ---------------- */

function toast(room, msg) {
  room.lastToast = { id: ++room.toastSeq, msg, at: Date.now() };
}

function send(conn, obj) {
  try { conn.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
}

/* 同一条消息发给房间里的所有连接 */
function broadcastRaw(room, obj) {
  const raw = JSON.stringify(obj);
  room.people.forEach((p) => { if (p.conn) { try { p.conn.send(raw); } catch (e) { /* ignore */ } } });
}

function streets(t) { return ["preflop", "flop", "turn", "river"].includes(t.phase); }

function buildState(room, conn) {
  const t = room.table;
  const viewer = personByConn(room, conn);
  const mySeat = viewer ? seatOf(room, viewer) : -1;
  const show = t && t.result && t.result.showdown ? t.result.showdown : [];
  const showdownHoles = {};
  show.forEach((s) => { showdownHoles[s.seat] = s.hole; });

  const seats = room.seats.map((p, i) => {
    const tp = t ? t.players[i] : null;
    return {
      seat: i,
      occupied: !!p,
      name: p ? p.name : "空位",
      avatar: p ? p.avatar : -1,
      online: p ? !!p.conn : false,
      host: isHost(room, p),
      me: !!p && viewer === p,
      stack: tp ? tp.stack : (p ? room.cfg.stack : 0),
      bet: tp ? tp.bet : 0,
      folded: tp ? tp.folded : false,
      allIn: tp ? tp.allIn : false,
      out: tp ? tp.out : false,
      lastAction: tp ? tp.lastAction : "",
      hole: t && tp ? (i === mySeat ? tp.hole : showdownHoles[i] || null) : []
    };
  });

  const turnLeft = t && t.turn >= 0 && room.turnEndsAt
    ? Math.max(0, Math.ceil((room.turnEndsAt - Date.now()) / 1000))
    : 0;
  const blindLeft = room.blindEndsAt
    ? Math.max(0, Math.ceil((room.blindEndsAt - Date.now()) / 1000))
    : null;

  const myPerson = viewer;
  const you = {
    seat: mySeat,
    host: isHost(room, viewer),
    legal: t && mySeat >= 0 && t.turn === mySeat && streets(t) ? Poker.legalActions(t, mySeat) : null,
    rebuyOk: !!(t && mySeat >= 0 && t.phase === "handover" && t.players[mySeat].stack < t.cfg.bb)
  };

  return {
    t: "state",
    code: room.code,
    phase: t ? t.phase : "lobby",
    cfg: t ? t.cfg : room.cfg,
    handNo: t ? t.handNo : 0,
    blindLevel: room.blindLevel,
    blindLeft,
    dealer: t ? t.dealer : -1,
    pot: t ? (t.phase === "handover" && t.result ? t.result.pot : t.pot) : 0,
    board: t ? t.board : [],
    currentBet: t ? t.currentBet : 0,
    turn: t ? t.turn : -1,
    turnLeft,
    toast: room.lastToast,
    result: t && t.result
      ? { type: t.result.type, pot: t.result.pot, winners: t.result.winners, showdown: show }
      : null,
    spectators: room.people.filter((p) => seatOf(room, p) < 0).length,
    canStart: isHost(room, viewer) && (!t
      ? seatedCount(room) >= 2
      : t.phase === "handover" && Poker.alive(t).length >= 2),
    seats,
    you
  };
}

function broadcast(room) {
  room.people.forEach((p) => {
    if (p.conn) send(p.conn, buildState(room, p.conn));
  });
}

/* ---------------- 静态文件 ---------------- */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function serveStatic(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || "/").split("?")[0]); } catch (e) { urlPath = "/"; }
  if (urlPath === "/" || urlPath === "") urlPath = "/index.html";
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("404 Not Found"); }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(data);
  });
}

/* ---------------- HTTP + WS 入口 ---------------- */

const server = http.createServer((req, res) => {
  if ((req.headers.upgrade || "").toLowerCase() === "websocket") return; // 交给 upgrade 事件
  serveStatic(req, res);
});

server.on("upgrade", (req, socket) => {
  const conn = upgrade(req, socket);
  if (!conn) return;
  conn.onmessage = (raw) => onMessage(conn, raw);
  conn.onclose = () => onConnClose(conn);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("夜航俱乐部联机服务器已启动：http://0.0.0.0:" + PORT);
  console.log("联机入口 /room.html · 静态根目录 " + ROOT);
});
