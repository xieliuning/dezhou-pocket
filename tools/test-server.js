/* ============================================================
   test-server.js — 联机服务器集成测试
   用 Node 内置 WebSocket 客户端模拟玩家，覆盖：
   三模式建房/加入、9 座位模型、换座、围观与上桌、数字房间号、
   可配置盲注、打完整手到摊牌、全下对博、重新买入、断线重连、参数校验。
   运行：node tools/test-server.js
   ============================================================ */
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const PORT = 8917;
const URL = "ws://127.0.0.1:" + PORT + "/ws";

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log("  ok  " + label); }
  else { failed++; console.log("  FAIL " + label); }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function inStreets(s) { return ["preflop", "flop", "turn", "river"].includes(s.phase); }
function occupied(s) { return s.seats.filter((p) => p.occupied).length; }

/* 一个最小化的玩家客户端：收集状态，提供等条件/发消息 */
function makeClient(label) {
  const c = {
    label,
    ws: null,
    lastState: null,
    joined: null,
    errs: [],
    stickers: [],
    closed: false
  };
  c.connect = () => new Promise((resolve, reject) => {
    c.ws = new WebSocket(URL);
    const timer = setTimeout(() => reject(new Error(label + " 连接超时")), 4000);
    c.ws.onopen = () => { clearTimeout(timer); resolve(); };
    c.ws.onerror = () => { clearTimeout(timer); reject(new Error(label + " 连接失败")); };
    c.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.t === "state") c.lastState = msg;
      else if (msg.t === "joined") c.joined = msg;
      else if (msg.t === "err") c.errs.push(msg.msg);
      else if (msg.t === "sticker") c.stickers.push(msg);
    };
    c.ws.onclose = () => { c.closed = true; };
  });
  c.send = (obj) => { if (!c.closed) c.ws.send(JSON.stringify(obj)); };
  c.waitState = (pred, what, timeoutMs) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const check = () => {
      if (c.lastState && pred(c.lastState)) return resolve(c.lastState);
      if (Date.now() - t0 > (timeoutMs || 6000)) return reject(new Error(label + " 等待超时: " + what));
      setTimeout(check, 40);
    };
    check();
  });
  c.close = () => new Promise((r) => {
    if (c.closed) return r();
    c.ws.onclose = () => r();
    c.ws.close();
  });
  return c;
}

/*
 * 轮询驱动：只要谁有行动权就让 decide(c, L) 决定行动，直到双方都到达 untilPred。
 * opts.autoStart：卡在结算阶段时，庄家自动开下一手。
 */
async function drive(a, b, decide, untilPred, what, timeoutMs, autoStart) {
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > (timeoutMs || 15000)) throw new Error("驱动超时: " + what);
    const active = [a, b].find((c) => c.lastState && c.lastState.you.legal && inStreets(c.lastState));
    if (active) {
      const L = active.lastState.you.legal;
      const action = decide(active, L);
      if (action) active.send(Object.assign({ t: "act" }, action));
      await sleep(80);
      continue;
    }
    if (autoStart && a.lastState && a.lastState.phase === "handover" &&
        a.lastState.canStart && !untilPred(a.lastState)) {
      a.send({ t: "start" });
      await sleep(120);
      continue;
    }
    if (a.lastState && b.lastState && untilPred(a.lastState) && untilPred(b.lastState)) {
      return a.lastState;
    }
    await sleep(80);
  }
}

const callOrCheck = () => (c, L) => ({ type: L.canCheck ? "check" : "call" });

async function main() {
  console.log("启动联机服务器 :" + PORT + " …");
  const server = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
  await sleep(700);

  try {
    /* ---- 1. 建房 / 加入（9 座位模型 + 数字房间号） ---- */
    console.log("[1] 建房与加入");
    const a = makeClient("A");
    const b = makeClient("B");
    await a.connect();
    a.send({ t: "create", name: "庄家A", avatar: 0, sb: 20, blindMins: 2, stack: 2000 });
    await a.waitState((s) => s.phase === "lobby", "建房", 4000);
    assert(a.joined && /^[0-9]{4}$/.test(a.joined.code), "房间号是 4 位数字");
    assert(a.joined.seat === 0, "建房者坐 0 号位");
    assert(a.lastState.seats.length === 9, "座位固定 9 个");
    assert(occupied(a.lastState) === 1, "大厅里只有 A 入座");
    assert(a.lastState.you.host === true, "建房者就是庄家");
    assert(a.lastState.cfg.sb === 20 && a.lastState.cfg.bb === 40, "盲注 20/40 联动生效");

    await b.connect();
    b.send({ t: "join", code: a.joined.code, name: "玩家B", avatar: 5 });
    await b.waitState((s) => s.phase === "lobby" && occupied(s) === 2, "B 加入", 4000);
    await a.waitState((s) => occupied(s) === 2, "A 看到 B 入座", 4000);
    assert(b.joined.seat === 1, "B 自动坐第一个空位（1 号位）");
    assert(a.lastState.seats[1].name === "玩家B", "A 看到 玩家B 的昵称");
    assert(a.lastState.seats[8].occupied === false, "空位标记正确");

    /* ---- 2. 换座 / 围观 ---- */
    console.log("[2] 换座与围观");
    a.send({ t: "sit", seat: 5 });
    await a.waitState((s) => s.you.seat === 5, "A 换到 5 号位", 4000);
    const aSeat = 5;
    const bSeat = 1;
    assert(a.lastState.seats[0].occupied === false && a.lastState.seats[5].me === true, "换座后原座位空出");
    assert(b.lastState.seats[5].name === "庄家A", "B 端同步 A 的新座位");

    const sp = makeClient("SP");
    await sp.connect();
    sp.send({ t: "join", code: a.joined.code, name: "围观群众", avatar: 6 });
    await sp.waitState((s) => s.you.seat >= 0 && s.phase === "lobby", "SP 加入默认上桌", 4000);
    assert(occupied(sp.lastState) === 3, "SP 上桌后占座 3/9");
    sp.send({ t: "stand" });
    await sp.waitState((s) => s.you.seat === -1 && s.phase === "lobby", "SP 起立去围观", 4000);
    assert(occupied(sp.lastState) === 2, "起立后座位空出");
    sp.send({ t: "sit", seat: 3 });
    await sp.waitState((s) => s.you.seat === 3 && s.phase === "lobby", "SP 再上桌", 4000);
    sp.send({ t: "stand" });   // 先围观，等结算间隙再回来
    await sp.waitState((s) => s.you.seat === -1, "SP 再去围观", 4000);
    assert(occupied(sp.lastState) === 2, "围观不占座");

    /* ---- 3. 开局与隐私 ---- */
    console.log("[3] 开局与底牌隐私");
    a.send({ t: "start" });
    await a.waitState((s) => s.phase === "preflop" && s.handNo === 1, "A 进入翻前", 4000);
    await b.waitState((s) => s.phase === "preflop" && s.handNo === 1, "B 进入翻前", 4000);
    assert(a.lastState.turn >= 0, "翻前有人行动");
    assert(a.lastState.seats[aSeat].hole.length === 2, "A 看到自己的两张底牌");
    assert(!a.lastState.seats[bSeat].hole, "A 看不到 B 的底牌");
    assert(a.lastState.seats[0].occupied === false && (a.lastState.seats[0].hole || []).length === 0, "空位没有底牌");
    assert(a.lastState.pot === 60, "盲注 20/40 入池 60，实际 " + a.lastState.pot);
    assert(a.lastState.blindLevel === 1 && a.lastState.blindLeft > 0 && a.lastState.blindLeft <= 120,
      "升盲时钟已启动（第 1 级，剩余 " + a.lastState.blindLeft + "s）");

    /* ---- 3.5 表情转发 ---- */
    a.send({ t: "sticker", to: bSeat });
    await sleep(400);
    assert(a.stickers.some((s) => s.from === aSeat && s.to === bSeat), "发送者自己收到表情消息（本地播放动画）");
    assert(b.stickers.some((s) => s.from === aSeat && s.to === bSeat), "对方收到表情消息");
    a.send({ t: "sticker", to: aSeat }); // 自己扔自己应被拒绝
    await sleep(300);
    assert(!b.stickers.some((s) => s.to === aSeat), "自己扔自己被服务端拒绝");

    /* ---- 4. 全员 check/call 打到摊牌 ---- */
    console.log("[4] 第 1 手：全跟注到摊牌");
    const r1 = await drive(a, b, callOrCheck(), (s) => s.phase === "handover" && s.handNo === 1, "第1手结算");
    console.log("  [debug] result=", JSON.stringify(r1.result), "phase=", r1.phase,
      "stacks=", JSON.stringify(r1.seats.map((p) => [p.seat, p.occupied, p.stack, p.folded, p.out])));
    assert(r1.result && r1.result.type === "showdown", "全跟注 → 摊牌结算");
    assert(r1.result.showdown.length === 2, "摊牌亮出两人底牌");
    const sum = r1.seats.reduce((n, p) => n + p.stack, 0);
    assert(sum === 4000, "筹码守恒（两人合计 4,000），实际 " + sum);
    assert(r1.board.length === 5, "公共牌发满 5 张，实际 " + r1.board.length);
    assert(b.lastState.result.showdown.length === 2, "B 端同样看到摊牌");

    /* ---- 5. 牌局进行中不能换座/上桌 ---- */
    console.log("[5] 牌局进行中不能换座");
    a.send({ t: "start" });
    await a.waitState((s) => s.phase === "preflop" && s.handNo === 2, "进入第 2 手", 4000);
    b.send({ t: "sit", seat: 7 });
    await sleep(400);
    assert(b.errs.some((m) => m.includes("打完")), "牌局进行中换座被拒绝");
    b.send({ t: "stand" });
    await sleep(400);
    assert(b.errs.filter((m) => m.includes("打完")).length >= 2, "牌局进行中去围观被拒绝");
    const emptyMid = b.lastState.seats.find((p) => !p.occupied).seat;
    sp.send({ t: "sit", seat: emptyMid });
    await sleep(400);
    assert(sp.errs.some((m) => m.includes("打完")), "围观者牌局中上桌被拒绝");

    /* ---- 6. 全下对博，直到有人出局 + 重新买入 + 围观者上桌 ---- */
    console.log("[6] 全下对博与重新买入");
    const allinDecide = (c, L) => (c.lastState.you.host ? { type: "raise", to: L.maxTo } : { type: L.canCheck ? "check" : "call" });
    let busted = false;
    for (let hand = 2; hand <= 20 && !busted; hand++) {
      await drive(a, b, allinDecide, (s) => s.phase === "handover" && s.handNo >= hand, "第" + hand + "手(全下)", 20000, true);
      const stacks = [a, b].map((c) => c.lastState.seats[c.lastState.you.seat].stack);
      if (stacks.some((n) => n <= 0)) {
        busted = true;
        assert(a.lastState.result.winners.length >= 1, "有人被淘汰，产生赢家");
        const loser = stacks[0] <= 0 ? a : b;
        const loserSeat = loser.lastState.you.seat;
        assert(a.lastState.seats[loserSeat].stack === 0, "出局者筹码为 0");
        loser.send({ t: "rebuy" });
        await loser.waitState((s) => s.rebuyReq && s.rebuyReq.mine, "重新买入申请已发出", 4000);
        assert(loser.lastState.rebuyReq.need === 2, "重新买入需要场上 2 人（含申请人）同意");
        await sleep(250);
        assert(loser.lastState.seats[loserSeat].stack === 0, "没人同意前不加筹码");
        // 其他在场的人点头后才真的加筹码
        const other = loser === a ? b : a;
        other.send({ t: "rebuy_vote", vote: true });
        await loser.waitState((s) => s.seats[loserSeat].stack === 2000, "重新买入", 4000);
        assert(loser.lastState.seats[loserSeat].stack === 2000, "全员同意后筹码回到 2,000");
        assert(loser.lastState.rebuyReq === null, "申请通过后申请状态清除");
        assert(loser.lastState.seats[loserSeat].out === false, "重新买入后不再是出局状态（台面样式恢复正常）");
      }
    }
    assert(busted, "全下对博触发了淘汰与重新买入");

    // 结算间隙：围观者点空位上桌，并带回起立前暂存的筹码
    sp.send({ t: "sit", seat: 7 });
    await sp.waitState((s) => s.you.seat === 7, "围观者在结算间隙上桌", 4000);
    assert(occupied(sp.lastState) === 3, "上桌后占座 3/9");
    assert(sp.lastState.seats[7].stack === 2000, "暂存筹码带回（2,000）");

    /* ---- 7. 断线重连（座位与庄家保持） ---- */
    console.log("[7] 断线重连");
    const codeB = a.joined.code;
    const tokenB = b.joined.token;
    await b.close();
    await sleep(300);
    const b2 = makeClient("B2");
    await b2.connect();
    b2.send({ t: "join", code: codeB, name: "玩家B", avatar: 5, token: tokenB });
    await b2.waitState((s) => s.seats[bSeat] && s.seats[bSeat].online, "B 重连回原座位", 4000);
    assert(b2.lastState.you.seat === bSeat, "重连后座位不变");
    assert(b2.lastState.seats[aSeat].host === true, "A 的庄家身份不受 B 掉线影响");
    assert(occupied(b2.lastState) === 3, "重连后人数不变");

    /* ---- 8. 错误处理与观战 ---- */
    console.log("[8] 错误处理与观战");
    const c3 = makeClient("C3");
    await c3.connect();
    c3.send({ t: "join", code: "1234", name: "路人" });
    await sleep(400);
    assert(c3.errs.some((m) => m.includes("不存在")), "不存在的房间号有提示");
    // 开局后加入默认上桌（新需求）：坐进第一个空位
    c3.send({ t: "join", code: codeB, name: "路人丙" });
    await c3.waitState((s) => s.phase !== "lobby" && s.you.seat >= 0, "开局后加入默认上桌", 4000);
    assert(c3.lastState.seats[c3.lastState.you.seat].me === true, "C3 已入座");
    assert(occupied(c3.lastState) === 4, "上桌后占座 4/9");
    // 勾选围观才不占座
    const c3b = makeClient("C3B");
    await c3b.connect();
    c3b.send({ t: "join", code: codeB, name: "围观第二人" });
    await c3b.waitState((s) => s.you.seat >= 0, "第二位新朋友默认上桌", 4000);
    assert(occupied(c3b.lastState) === 5, "上桌后占座 5/9");
    c3b.send({ t: "stand" });
    await c3b.waitState((s) => s.you.seat === -1, "起立去围观", 4000);
    assert(c3b.lastState.spectators >= 1, "围观者计数生效");

    /* ---- 9. 建房参数校验 ---- */
    console.log("[9] 建房参数校验");
    const c4 = makeClient("C4");
    await c4.connect();
    c4.send({ t: "create", name: "坏参数", sb: 15, stack: 2000 });
    await sleep(400);
    assert(c4.errs.some((m) => m.includes("10 的倍数")), "小盲非 10 的倍数被拒绝");
    c4.send({ t: "create", name: "坏参数", sb: 20, stack: 50 });
    await sleep(400);
    assert(c4.errs.some((m) => m.includes("初始筹码")), "初始筹码越界被拒绝");

    /* ---- 10. 离开房间：座位释放 + 庄家立刻转移 ---- */
    console.log("[10] 离开房间");
    const h = makeClient("庄家");
    await h.connect();
    h.send({ t: "create", name: "庄家", sb: 20, stack: 60000 });
    await h.waitState((s) => s.you.seat >= 0 && s.you.host, "庄家入座", 4000);
    const room10 = h.joined.code;
    const g = makeClient("客人");
    await g.connect();
    g.send({ t: "join", code: room10, name: "客人", avatar: 2 });
    await g.waitState((s) => s.you.seat >= 0 && occupied(s) === 2, "客人入座", 4000);
    assert(g.lastState.seats[h.lastState.you.seat].host === true, "庄家标记在庄家身上");

    h.send({ t: "leave" });
    await sleep(500);
    await g.waitState((s) => occupied(s) === 1, "庄家离开后座位立刻释放", 4000);
    assert(g.lastState.seats[h.joined.seat].occupied === false, "庄家座位变空位");
    assert(g.lastState.seats[g.lastState.you.seat].host === true, "庄家身份立刻转给在场的人");
    assert(g.lastState.you.host === true, "在场的人可以开局（canStart 前提）");

    /* ---- 11. 重新买入：申请 + 在场全员同意 ---- */
    console.log("[11] 重新买入表决");
    const va = makeClient("庄A");
    await va.connect();
    va.send({ t: "create", name: "庄A", sb: 10, stack: 100 });
    await va.waitState((s) => s.you.seat >= 0 && s.you.host, "庄A入座", 4000);
    const room11 = va.joined.code;
    const vb = makeClient("客B");
    await vb.connect();
    vb.send({ t: "join", code: room11, name: "客B", avatar: 1 });
    await vb.waitState((s) => s.you.seat >= 0, "客B入座", 4000);
    const vc = makeClient("客C");
    await vc.connect();
    vc.send({ t: "join", code: room11, name: "客C", avatar: 2 });
    await vc.waitState((s) => s.you.seat >= 0, "客C入座", 4000);
    const vd = makeClient("围观D");
    await vd.connect();
    vd.send({ t: "join", code: room11, name: "围观D", avatar: 3 });
    await vd.waitState((s) => s.you.seat >= 0, "围观D入座", 4000);
    vd.send({ t: "stand" });                       // 变成纯围观者
    await vd.waitState((s) => s.you.seat === -1, "围观D起立", 4000);
    assert(occupied(vd.lastState) === 3, "3 人入座，围观者不占座");

    va.send({ t: "start" });
    await va.waitState((s) => s.phase === "preflop", "开局", 4000);

    // 三个人全部全下，打到摊牌
    const allIn = (c, L) => (L.canRaise ? { type: "raise", to: L.maxTo } : { type: L.canCheck ? "check" : "call" });
    const t0 = Date.now();
    for (;;) {
      if (Date.now() - t0 > 20000) throw new Error("全下对局超时");
      const act = [va, vb, vc].find((c) => c.lastState && c.lastState.you.legal && inStreets(c.lastState));
      if (act) {
        const L = act.lastState.you.legal;
        act.send({ t: "act", type: allIn(act, L).type, to: allIn(act, L).to });
        await sleep(120);
        continue;
      }
      if (va.lastState && va.lastState.phase === "handover") break;
      await sleep(120);
    }
    const bustedList = [vb, vc].filter((c) => c.lastState.seats[c.lastState.you.seat].stack === 0);
    assert(bustedList.length >= 1, "全下对局后有人出局");
    const X = bustedList[0];
    const XSeat = X.lastState.you.seat;
    const others = [va, vb, vc].filter((c) => c !== X);
    assert(X.lastState.you.rebuyOk === true, "筹码打光的人可以申请重新买入");

    // 1) 发起申请：只是申请，筹码没动
    X.send({ t: "rebuy" });
    await X.waitState((s) => s.rebuyReq && s.rebuyReq.mine, "申请已发出", 4000);
    assert(X.lastState.rebuyReq.need === 3, "需要场上 3 人同意（申请人算一票）");
    assert(X.lastState.rebuyReq.myVote === 1, "申请人自动算同意");
    assert(X.lastState.seats[XSeat].stack === 0, "没人同意前不加筹码");
    assert(others[0].lastState.rebuyReq && others[0].lastState.rebuyReq.mine === false,
      "其他在场玩家也能看到这条申请");

    // 2) 围观者不参与表决
    vd.send({ t: "rebuy_vote", vote: true });
    await sleep(400);
    assert(vd.errs.some((m) => m.includes("围观者")), "围观者表决被拒绝");

    // 3) 申请人可以撤回
    X.send({ t: "rebuy" });
    await X.waitState((s) => !s.rebuyReq, "撤回申请", 4000);
    assert(X.lastState.rebuyReq === null, "撤回后申请消失");

    // 4) 有人拒绝 → 整条申请作废
    X.send({ t: "rebuy" });
    await X.waitState((s) => s.rebuyReq && s.rebuyReq.mine, "再次申请", 4000);
    others[0].send({ t: "rebuy_vote", vote: false });
    await X.waitState((s) => !s.rebuyReq, "拒绝后申请作废", 4000);
    assert(X.lastState.seats[XSeat].stack === 0, "被拒绝不加筹码");

    // 5) 全员同意才真的加筹码
    X.send({ t: "rebuy" });
    await X.waitState((s) => s.rebuyReq && s.rebuyReq.mine, "第三次申请", 4000);
    others[0].send({ t: "rebuy_vote", vote: true });
    await sleep(300);
    assert(X.lastState.rebuyReq.yes === 2, "同意数 2/3");
    assert(X.lastState.seats[XSeat].stack === 0, "还有人没表态时仍然不加筹码");
    others[1].send({ t: "rebuy_vote", vote: true });
    await X.waitState((s) => s.seats[XSeat].stack === 100, "全员同意后加筹码", 4000);
    assert(X.lastState.seats[XSeat].stack === 100, "重新买入 100 筹码");
    assert(X.lastState.rebuyReq === null, "通过后申请清除");
    assert(X.lastState.seats[XSeat].out === false, "重买后不再是出局状态（台面样式恢复正常）");
    assert(X.lastState.you.rebuyOk === false, "筹码够了就不再显示重新买入");

    /* ---- 12. lobby 阶段可以起立去围观 ---- */
    console.log("[12] lobby 阶段去围观");
    const vl = makeClient("庄L");
    await vl.connect();
    vl.send({ t: "create", name: "庄L", sb: 20, stack: 60000 });
    await vl.waitState((s) => s.you.seat >= 0 && s.phase === "lobby", "庄L入座", 4000);
    vl.send({ t: "stand" });
    await vl.waitState((s) => s.you.seat === -1 && s.phase === "lobby", "lobby 阶段起立去围观", 4000);
    assert(vl.lastState.you.seat === -1, "lobby 阶段也能去围观");
    assert(vl.lastState.spectators >= 1, "围观人数统计正确");

    console.log("\n结果：" + passed + " 通过，" + failed + " 失败");
  } finally {
    server.kill();
  }
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("测试异常：", e.message); process.exit(2); });
