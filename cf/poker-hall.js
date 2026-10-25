/* ============================================================
   cf/poker-hall.js — Durable Object「牌局大厅」

   把 server/server.js 的房间逻辑整体搬上 Cloudflare Workers：
   - 协议一字不改（客户端 js/room.js 零改动）
   - 牌局引擎直接复用 js/poker.js
   - 计时器（回合 60s / 升盲）改用 Durable Object alarm
   - 房间状态落 SQLite 存储，进程重启后房间还在
   - 整个大厅跑在**单个** Durable Object 实例里：天然单线程串行，
     并发行动不会打架；家里几个人玩完全够用
   ============================================================ */
import { DurableObject } from "cloudflare:workers";
import * as PokerNS from "../js/poker.js";

const Poker = PokerNS.default || PokerNS.Poker || globalThis.Poker;
if (!Poker || typeof Poker.createTable !== "function") {
  throw new Error("牌局引擎 js/poker.js 加载失败");
}

/* ---------------- 常量（与 server/server.js 保持一致） ---------------- */

const TURN_SECONDS = 60;              // 每回合思考时间
const LOBBY_DROP_MS = 60 * 1000;      // 围观/大厅掉线宽限
const ROOM_IDLE_MS = 30 * 60 * 1000;  // 无人房间保留时长
const OFFLINE_DROP_MS = 5 * 60 * 1000;// 牌局中掉线座位保留时长
const HOST_OFFLINE_MS = 90 * 1000;    // 庄家掉线多久后转移庄家
const SEAT_COUNT = 9;
const SB_MIN = 10, SB_MAX = 1000;
const STACK_MIN = 100, STACK_MAX = 100000;
const BLIND_MINS = [1, 2, 3, 5, 10];
const AVATAR_COUNT = 10;
const CODE_LEN = 4;
const SWEEP_MS = 30 * 1000;           // 巡检 / 心跳间隔

/* ---------------- 小工具 ---------------- */

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
function randomInt(max) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}
function randomToken() {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------------- 房间序列化（落 SQLite） ---------------- */

function serializeRoom(room) {
  return {
    code: room.code,
    cfg: room.cfg,
    people: room.people,
    seats: room.seats.map((p) => (p ? p.token : null)),
    table: room.table,
    hostToken: room.hostToken,
    turnEndsAt: room.turnEndsAt,
    blindLevel: room.blindLevel,
    blindEndsAt: room.blindEndsAt,
    toastSeq: room.toastSeq,
    lastToast: room.lastToast,
    lastActivity: room.lastActivity
  };
}

function deserializeRoom(o) {
  const room = {
    code: o.code,
    cfg: o.cfg,
    people: o.people || [],
    seats: new Array(SEAT_COUNT).fill(null),
    table: o.table || null,
    hostToken: o.hostToken || null,
    turnEndsAt: o.turnEndsAt || 0,
    blindLevel: o.blindLevel || 1,
    blindEndsAt: o.blindEndsAt || 0,
    toastSeq: o.toastSeq || 0,
    lastToast: o.lastToast || null,
    lastActivity: o.lastActivity || Date.now()
  };
  (o.seats || []).forEach((tok, i) => {
    if (i >= SEAT_COUNT) return;
    if (tok) room.seats[i] = room.people.find((p) => p.token === tok) || null;
  });
  return room;
}

/* ============================================================
   PokerHall
   ============================================================ */

export class PokerHall extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.rooms = new Map();        // code -> room
    this.loaded = false;
    this._loadPromise = null;
    this.nextSweepAt = 0;
    this.alarmAt = 0;
  }

  /* ---------------- 生命周期 ---------------- */

  async fetch(request) {
    await this.ensureLoaded();
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const client = pair[0], server = pair[1];
      /* Hibernation：实例被回收时连接不会断，牌局中途不受影响 */
      this.ctx.acceptWebSocket(server, ["poker"]);
      try { server.serializeAttachment({ token: null, roomCode: null }); } catch (e) { /* ignore */ }
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("夜航俱乐部牌局大厅", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }

  async webSocketMessage(ws, message) {
    await this.ensureLoaded();
    let msg;
    try { msg = JSON.parse(typeof message === "string" ? message : String(message)); } catch (e) { return; }
    if (!msg || typeof msg.t !== "string") return;

    if (msg.t === "ping") return this.send(ws, { t: "pong" });

    const att = this.att(ws);
    const room = att.roomCode ? this.rooms.get(att.roomCode) : null;
    if (!room) {
      if (msg.t === "create") return this.createRoom(ws, msg);
      if (msg.t === "join") return this.joinRoom(ws, msg);
      return this.send(ws, { t: "err", msg: "先创建或加入房间" });
    }
    room.lastActivity = Date.now();

    switch (msg.t) {
      case "start": return this.hostStart(room, ws);
      case "act": return this.playerAct(room, ws, msg);
      case "rebuy": return this.playerRebuy(room, ws);
      case "sit": return this.playerSit(room, ws, msg);
      case "stand": return this.playerStand(room, ws);
      case "sticker": return this.relaySticker(room, ws, msg);
      case "leave": return this.leaveRoom(room, ws);
      default: return;
    }
  }

  async webSocketClose(ws) {
    await this.ensureLoaded();
    const att = this.att(ws);
    if (!att.roomCode) return;
    const room = this.rooms.get(att.roomCode);
    if (!room) return;
    const person = this.personByToken(room, att.token);
    if (person) person.lastSeen = Date.now();
    this.broadcast(room);
  }

  async webSocketError(ws) {
    /* 忽略：连接已由运行时接管 */
  }

  /* ---------------- 存储 ---------------- */

  async ensureLoaded() {
    if (this.loaded) return;
    if (!this._loadPromise) {
      this._loadPromise = (async () => {
        try {
          const all = await this.ctx.storage.list({ prefix: "room:" });
          for (const [, v] of all) {
            try {
              const room = deserializeRoom(v);
              this.rooms.set(room.code, room);
            } catch (e) { /* 坏数据跳过 */ }
          }
          if (this.rooms.size) console.log("已从存储恢复 " + this.rooms.size + " 个房间");
        } catch (e) {
          console.error("读取房间存储失败", e && e.message);
        }
        this.nextSweepAt = this.rooms.size ? Date.now() + SWEEP_MS : 0;
        this.loaded = true;
        this.arm();
      })();
    }
    return this._loadPromise;
  }

  persist(room) {
    if (!room) return;
    this.ctx.waitUntil(
      this.ctx.storage.put("room:" + room.code, serializeRoom(room)).catch((e) => {
        console.error("保存房间失败", e && e.message);
      })
    );
  }

  dropRoom(room) {
    this.rooms.delete(room.code);
    this.ctx.waitUntil(this.ctx.storage.delete("room:" + room.code).catch(() => {}));
  }

  /* ---------------- 计时器（Durable Object alarm） ---------------- */

  arm() {
    const now = Date.now();
    let next = Infinity;
    for (const room of this.rooms.values()) {
      if (room.turnEndsAt) next = Math.min(next, room.turnEndsAt);
      if (room.blindEndsAt) next = Math.min(next, room.blindEndsAt);
    }
    if (this.nextSweepAt) next = Math.min(next, this.nextSweepAt);
    if (!Number.isFinite(next)) {
      if (this.alarmAt) { this.ctx.waitUntil(this.ctx.storage.deleteAlarm().catch(() => {})); this.alarmAt = 0; }
      return;
    }
    const at = Math.max(now + 500, next);
    if (at === this.alarmAt) return;
    this.alarmAt = at;
    this.ctx.waitUntil(this.ctx.storage.setAlarm(at).catch((e) => {
      console.error("设置 alarm 失败", e && e.message);
    }));
  }

  async alarm() {
    await this.ensureLoaded();
    this.alarmAt = 0;
    const now = Date.now();

    for (const room of Array.from(this.rooms.values())) {
      if (room.turnEndsAt && now >= room.turnEndsAt) {
        room.turnEndsAt = 0;
        this.onTurnExpire(room);
        this.persist(room);
      }
      if (room.blindEndsAt && now >= room.blindEndsAt) {
        room.blindEndsAt = 0;
        this.onBlindUp(room);
        this.persist(room);
      }
    }

    if (this.nextSweepAt && now >= this.nextSweepAt) {
      this.sweep(now);
      this.nextSweepAt = this.rooms.size ? now + SWEEP_MS : 0;
    }
    this.arm();
  }

  /* ---------------- 连接与在场状态 ---------------- */

  /* 连接与玩家的对应关系存在 WebSocket attachment 里：
     Durable Object 实例被回收再拉起后，连接还在，身份也跟着在。 */
  att(ws) {
    try { return ws.deserializeAttachment() || {}; } catch (e) { return {}; }
  }

  sockets() {
    try { return this.ctx.getWebSockets(); } catch (e) { return []; }
  }

  connFor(token) {
    if (!token) return null;
    for (const ws of this.sockets()) {
      const a = this.att(ws);
      if (a.token === token) return ws;
    }
    return null;
  }

  isOnline(person) {
    return !!this.connFor(person.token);
  }

  send(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }

  broadcastRaw(room, obj) {
    const raw = JSON.stringify(obj);
    for (const person of room.people) {
      const ws = this.connFor(person.token);
      if (!ws) continue;
      try { ws.send(raw); } catch (e) { /* ignore */ }
    }
  }

  /* ---------------- 房间与人员 ---------------- */

  newCode() {
    for (;;) {
      let c = "";
      for (let i = 0; i < CODE_LEN; i++) c += randomInt(10);
      if (!this.rooms.has(c)) return c;
    }
  }

  newPerson(name, avatar) {
    return {
      token: randomToken(),
      name,
      avatar: Number.isInteger(avatar) && avatar >= 0 && avatar < AVATAR_COUNT ? avatar : randomInt(AVATAR_COUNT),
      lastSeen: Date.now(),
      bank: null
    };
  }

  personByToken(room, token) {
    if (!token) return null;
    return room.people.find((p) => p.token === token) || null;
  }

  personByConn(room, ws) {
    return this.personByToken(room, this.att(ws).token);
  }

  seatOf(room, person) {
    return room.seats.indexOf(person);
  }

  seatedCount(room) {
    return room.seats.filter(Boolean).length;
  }

  firstEmptySeat(room) {
    return room.seats.indexOf(null);
  }

  isHost(room, person) {
    return !!person && person.token === room.hostToken;
  }

  bindConn(ws, room, token) {
    try {
      ws.serializeAttachment({ token, roomCode: room ? room.code : null });
    } catch (e) { /* ignore */ }
  }

  createRoom(ws, msg) {
    const sb = cleanSb(msg.sb);
    if (!sb) return this.send(ws, { t: "err", msg: "小盲必须是 10 的倍数（10～1000）" });
    const stack = cleanStack(msg.stack);
    if (!stack) return this.send(ws, { t: "err", msg: "初始筹码请在 " + STACK_MIN + "～" + STACK_MAX + " 之间" });

    const room = {
      code: this.newCode(),
      cfg: { sb, bb: sb * 2, stack, blindMins: cleanBlindMins(msg.blindMins) },
      people: [],
      seats: new Array(SEAT_COUNT).fill(null),
      table: null,
      hostToken: null,
      turnEndsAt: 0,
      blindLevel: 1,
      blindEndsAt: 0,
      toastSeq: 0,
      lastToast: null,
      lastActivity: Date.now()
    };
    this.rooms.set(room.code, room);

    const person = this.newPerson(cleanName(msg.name) || "庄家", msg.avatar);
    room.people.push(person);
    room.seats[0] = person;
    room.hostToken = person.token;
    this.bindConn(ws, room, person.token);
    this.send(ws, { t: "joined", code: room.code, token: person.token, seat: 0 });
    this.persist(room);
    this.broadcast(room);
  }

  joinRoom(ws, msg) {
    const room = this.rooms.get(String(msg.code || ""));
    if (!room) return this.send(ws, { t: "err", msg: "房间不存在，检查一下房间号" });

    const existing = this.personByToken(room, msg.token);
    if (existing) {                          // 断线重连，回到原座位
      const oldWs = this.connFor(existing.token);
      if (oldWs && oldWs !== ws) {
        this.send(oldWs, { t: "replaced" });
        try { oldWs.close(); } catch (e) { /* ignore */ }
      }
      existing.lastSeen = Date.now();
      this.bindConn(ws, room, existing.token);
      this.send(ws, { t: "joined", code: room.code, token: existing.token, seat: this.seatOf(room, existing) });
      this.persist(room);
      this.broadcast(room);
      return;
    }

    const person = this.newPerson(cleanName(msg.name) || "玩家", msg.avatar);
    room.people.push(person);

    if (this.firstEmptySeat(room) < 0) {      // 九个座位都满了：默认围观
      this.bindConn(ws, room, person.token);
      this.send(ws, { t: "joined", code: room.code, token: person.token, seat: -1 });
      this.persist(room);
      this.broadcast(room);
      return;
    }

    const seat = this.firstEmptySeat(room);
    const r = this.sitDown(room, person, seat);
    if (!r.ok) {
      room.people.splice(room.people.indexOf(person), 1);
      return this.send(ws, { t: "err", msg: r.msg });
    }
    this.bindConn(ws, room, person.token);
    this.send(ws, { t: "joined", code: room.code, token: person.token, seat });
    this.persist(room);
    this.broadcast(room);
  }

  /* 入座 / 换座：仅限一手结束（或还没开局）时 */
  sitDown(room, person, seat) {
    if (!Number.isInteger(seat) || seat < 0 || seat >= SEAT_COUNT) {
      return { ok: false, msg: "座位号无效" };
    }
    if (room.table && !["lobby", "handover"].includes(room.table.phase)) {
      return { ok: false, msg: "这一手打完才能换座位" };
    }
    if (room.seats[seat] === person) return { ok: true };
    if (room.seats[seat]) return { ok: false, msg: "这个座位有人了" };

    const mySeat = this.seatOf(room, person);
    if (room.table) {
      const t = room.table;
      if (mySeat >= 0) {
        t.players[seat].stack = t.players[mySeat].stack;
        t.players[mySeat].stack = 0;
      } else {
        t.players[seat].stack = (person.bank != null && person.bank > 0) ? person.bank : room.cfg.stack;
        person.bank = null;
        this.toast(room, person.name + " 上桌了");
      }
      t.players[seat].name = person.name;
      if (mySeat >= 0) t.players[mySeat].name = "空位";
    }
    if (mySeat >= 0) room.seats[mySeat] = null;
    room.seats[seat] = person;
    return { ok: true };
  }

  playerSit(room, ws, msg) {
    const person = this.personByConn(room, ws);
    if (!person) return this.send(ws, { t: "err", msg: "先加入房间" });
    const r = this.sitDown(room, person, Number(msg.seat));
    if (!r.ok) return this.send(ws, { t: "err", msg: r.msg });
    this.persist(room);
    this.broadcast(room);
  }

  /* 起立去围观：筹码暂存到人身上，点空位随时回来 */
  playerStand(room, ws) {
    const person = this.personByConn(room, ws);
    if (!person) return this.send(ws, { t: "err", msg: "先加入房间" });
    const seat = this.seatOf(room, person);
    if (seat < 0) return this.send(ws, { t: "err", msg: "你已经在围观了" });
    if (room.table && !["lobby", "handover"].includes(room.table.phase)) {
      return this.send(ws, { t: "err", msg: "这一手打完才能去围观" });
    }
    if (room.table) {
      person.bank = room.table.players[seat].stack;
      room.table.players[seat].stack = 0;
      room.table.players[seat].name = "空位";
    }
    room.seats[seat] = null;
    this.toast(room, person.name + " 去围观了");
    this.persist(room);
    this.broadcast(room);
  }

  /* ---------------- 开局与行动 ---------------- */

  hostStart(room, ws) {
    const person = this.personByConn(room, ws);
    if (!this.isHost(room, person)) return this.send(ws, { t: "err", msg: "只有庄家能开局" });

    if (!room.table) {
      if (this.seatedCount(room) < 2) return this.send(ws, { t: "err", msg: "至少要两位玩家入座才能开局" });
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
      this.toast(room, "牌局开始，祝好运");
    } else if (room.table.phase === "handover") {
      if (Poker.alive(room.table).length < 2) {
        return this.send(ws, { t: "err", msg: "有玩家筹码为 0，等TA重新买入或换座后再开下一手" });
      }
    } else {
      return this.send(ws, { t: "err", msg: "这一手还没打完" });
    }

    const mul = Math.pow(2, room.blindLevel - 1);
    room.table.cfg.sb = room.cfg.sb * mul;
    room.table.cfg.bb = room.cfg.bb * mul;

    this.startBlindClock(room);
    Poker.startHand(room.table);
    this.scheduleTurn(room);
    this.persist(room);
    this.broadcast(room);
  }

  /* 升盲时钟：第一手开局启动，升级在下一手生效 */
  startBlindClock(room) {
    if (room.blindEndsAt) return;
    room.blindEndsAt = Date.now() + room.cfg.blindMins * 60 * 1000;
    this.arm();
  }

  onBlindUp(room) {
    if (!room.table) return;
    room.blindLevel += 1;
    const mul = Math.pow(2, room.blindLevel - 1);
    const sb = room.cfg.sb * mul, bb = room.cfg.bb * mul;
    this.toast(room, "升盲 · 下一手盲注 " + sb + "/" + bb);
    room.blindEndsAt = Date.now() + room.cfg.blindMins * 60 * 1000;
    this.arm();
    this.broadcast(room);
  }

  playerAct(room, ws, msg) {
    const t = room.table;
    const person = this.personByConn(room, ws);
    if (!t || !person) return this.send(ws, { t: "err", msg: "现在不能行动" });
    const seat = this.seatOf(room, person);
    if (t.turn !== seat) return this.send(ws, { t: "err", msg: "还没轮到你" });

    const action = { type: msg.type };
    if (action.type === "raise") action.to = Math.round(Number(msg.to) || 0);
    const r = Poker.act(t, seat, action);
    if (!r.ok) return this.send(ws, { t: "err", msg: r.error || "无法行动" });

    this.scheduleTurn(room);
    this.persist(room);
    this.broadcast(room);
  }

  playerRebuy(room, ws) {
    const t = room.table;
    const person = this.personByConn(room, ws);
    if (!t || !person) return this.send(ws, { t: "err", msg: "现在不能重新买入" });
    const seat = this.seatOf(room, person);
    if (seat < 0) return this.send(ws, { t: "err", msg: "先上桌再买入" });
    const p = t.players[seat];
    if (t.phase !== "handover" || p.stack >= t.cfg.bb) {
      return this.send(ws, { t: "err", msg: "筹码还够，不用买入" });
    }
    p.stack = room.cfg.stack;
    this.toast(room, person.name + " 重新买入 " + room.cfg.stack);
    this.persist(room);
    this.broadcast(room);
  }

  /* 表情：服务端只转发，动画各端本地播放 */
  relaySticker(room, ws, msg) {
    const person = this.personByConn(room, ws);
    if (!person || !room.table) return;
    const from = this.seatOf(room, person);
    if (from < 0) return;
    const to = Number(msg.to);
    if (!Number.isInteger(to) || to < 0 || to >= SEAT_COUNT || to === from || !room.seats[to]) return;
    this.broadcastRaw(room, { t: "sticker", from, to });
  }

  leaveRoom(room, ws) {
    const person = this.personByConn(room, ws);
    if (person) {
      const seat = this.seatOf(room, person);
      if (seat >= 0) this.freeSeat(room, seat, null);
      const i = room.people.indexOf(person);
      if (i >= 0) room.people.splice(i, 1);
      // 庄家走了就立刻换人，别等定时清扫，否则牌桌会卡在「没人能开局」
      if (room.hostToken === person.token) {
        const online = room.people.find((p) => this.isOnline(p));
        room.hostToken = online ? online.token : (room.people[0] ? room.people[0].token : null);
      }
    }
    this.persist(room);
    this.broadcast(room);          // 立刻告诉其他人：座位空出来了
    try { ws.close(); } catch (e) { /* ignore */ }
  }

  freeSeat(room, seat, reason) {
    const person = room.seats[seat];
    if (!person) return;
    room.seats[seat] = null;
    if (room.table) room.table.players[seat].stack = 0;
    if (reason) this.toast(room, person.name + " " + reason);
  }

  /* ---------------- 回合计时 ---------------- */

  scheduleTurn(room) {
    room.turnEndsAt = 0;
    const t = room.table;
    if (!t || t.turn < 0) { this.arm(); return; }
    if (!["preflop", "flop", "turn", "river"].includes(t.phase)) { this.arm(); return; }
    room.turnEndsAt = Date.now() + TURN_SECONDS * 1000;
    this.arm();
  }

  onTurnExpire(room) {
    const t = room.table;
    if (!t || t.turn < 0) return;
    const seat = t.turn;
    const legal = Poker.legalActions(t, seat);
    const action = legal.canCheck ? { type: "check" } : { type: "fold" };
    const r = Poker.act(t, seat, action);
    if (r.ok) this.toast(room, (t.players[seat] ? t.players[seat].name : "玩家") + " 超时，自动" + (legal.canCheck ? "过牌" : "弃牌"));
    this.scheduleTurn(room);
    this.broadcast(room);
  }

  /* ---------------- 状态广播 ---------------- */

  toast(room, msg) {
    room.lastToast = { id: ++room.toastSeq, msg, at: Date.now() };
  }

  streets(t) { return ["preflop", "flop", "turn", "river"].includes(t.phase); }

  buildState(room, token) {
    const t = room.table;
    const viewer = this.personByToken(room, token);
    const mySeat = viewer ? this.seatOf(room, viewer) : -1;
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
        online: p ? this.isOnline(p) : false,
        host: this.isHost(room, p),
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

    const you = {
      seat: mySeat,
      host: this.isHost(room, viewer),
      legal: t && mySeat >= 0 && t.turn === mySeat && this.streets(t) ? Poker.legalActions(t, mySeat) : null,
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
      spectators: room.people.filter((p) => this.seatOf(room, p) < 0).length,
      canStart: this.isHost(room, viewer) && (!t
        ? this.seatedCount(room) >= 2
        : t.phase === "handover" && Poker.alive(t).length >= 2),
      seats,
      you
    };
  }

  broadcast(room) {
    for (const person of room.people) {
      const ws = this.connFor(person.token);
      if (!ws) continue;
      this.send(ws, this.buildState(room, person.token));
    }
  }

  /* ---------------- 掉线与房间回收 ---------------- */

  sweep(now) {
    for (const [code, room] of Array.from(this.rooms)) {
      for (let i = room.people.length - 1; i >= 0; i--) {
        const p = room.people[i];
        if (this.isOnline(p)) continue;
        const away = now - p.lastSeen;
        const seat = this.seatOf(room, p);
        if (seat >= 0) {
          if (away > OFFLINE_DROP_MS) {
            this.freeSeat(room, seat, "长时间离线，已请离牌桌");
            room.people.splice(i, 1);
            this.persist(room);
          }
        } else if (away > LOBBY_DROP_MS) {
          room.people.splice(i, 1);
          this.persist(room);
        }
      }
      const hostPerson = this.personByToken(room, room.hostToken);
      if (!hostPerson || (!this.isOnline(hostPerson) && now - hostPerson.lastSeen > HOST_OFFLINE_MS)) {
        const online = room.people.find((p) => this.isOnline(p));
        room.hostToken = online ? online.token : (room.people[0] ? room.people[0].token : null);
        this.persist(room);
      }
      const anyOnline = room.people.some((p) => this.isOnline(p));
      if (!anyOnline && now - room.lastActivity > ROOM_IDLE_MS) {
        this.dropRoom(room);
      }
    }
  }
}
