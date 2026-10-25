/* ============================================================
   single.js — 单机对局控制器
   规则在 poker.js，这里只负责：AI 决策、渲染、计时、风格切换。
   ============================================================ */
(function () {
  "use strict";

  var P = window.Poker;
  var TURN_SECONDS = 15;
  var RING = 119.38;            // 2πr, r = 19
  var STYLE_LS_KEY = "holdem.style";
  var BLIND_SECONDS = 120;      // 每两分钟升一次盲
  var BLIND_BASE_SB = 10;
  var BLIND_BASE_BB = 20;
  var LONG_PRESS_MS = 480;
  var STICKER_MAX = 18;
  var PEEK_MS = 4500;

  var STYLES = [
    { key: "s-felt",      no: "01", name: "皇家绒毡", a: "#0d2b20", b: "#c9a24e" },
    { key: "s-mono",      no: "02", name: "纸面印刷", a: "#f4f1e8", b: "#1a1a1a" },
    { key: "s-neon",      no: "03", name: "霓虹网格", a: "#0a0a16", b: "#3ff0ff" },
    { key: "s-pixel",     no: "04", name: "像素街机", a: "#12122a", b: "#7dff6b" },
    { key: "s-deco",      no: "05", name: "装饰艺术", a: "#0f1512", b: "#d8b25e" },
    { key: "s-bauhaus",   no: "06", name: "包豪斯",   a: "#f3efe3", b: "#d8341f" },
    { key: "s-toy",       no: "07", name: "立体玩具", a: "#ffd166", b: "#ef476f" },
    { key: "s-story",     no: "08", name: "绘本插画", a: "#fbf3e2", b: "#8ab6a2" },
    { key: "s-engraved",  no: "09", name: "雕版蚀刻", a: "#efe6d3", b: "#2f2a24" },
    { key: "s-lacquer",   no: "10", name: "漆器大漆", a: "#1a0d0b", b: "#c0392b" },
    { key: "s-ink",       no: "11", name: "水墨留白", a: "#f4f1e9", b: "#2b2b2b" },
    { key: "s-memphis",   no: "12", name: "孟菲斯",   a: "#fdf6e9", b: "#ff5a8a" },
    { key: "s-pop",       no: "13", name: "波普艺术", a: "#fff8e7", b: "#e63946" },
    { key: "s-construct", no: "14", name: "构成主义", a: "#e8e4d9", b: "#c1121f" },
    { key: "s-term",      no: "15", name: "终端命令行", a: "#05100a", b: "#4dff88" },
    { key: "s-cyber",     no: "16", name: "赛博朋克", a: "#0b0a18", b: "#ff2d95" },
    { key: "s-crt",       no: "17", name: "复古录像带", a: "#10160f", b: "#9dff6a" },
    { key: "s-steam",     no: "18", name: "蒸汽朋克", a: "#241a12", b: "#c08a4a" },
    { key: "s-clay",      no: "19", name: "陶土黏土", a: "#f0e2d2", b: "#d98555" },
    { key: "s-zen",       no: "20", name: "禅意留白", a: "#f6f3ec", b: "#8a8f7e" }
  ];

  /* 座位 1~8 顺时针：左下 → 左 → 左上 → 上左 → 上右 → 右上 → 右 → 右下 */
  var SEAT_META = {
    1: { anchor: "a", avatar: "long",   name: "龙哥",   aggr: 0.72, bluff: 0.22, temper: 1.02 },
    2: { anchor: "b", avatar: "fa",     name: "发条",   aggr: 0.42, bluff: 0.08, temper: 0.93 },
    3: { anchor: "c", avatar: "white",  name: "白噪音", aggr: 0.56, bluff: 0.15, temper: 1.00 },
    4: { anchor: "d", avatar: "lin",    name: "林深",   aggr: 0.64, bluff: 0.18, temper: 1.05 },
    5: { anchor: "e", avatar: "k",      name: "K先生",  aggr: 0.50, bluff: 0.26, temper: 0.97 },
    6: { anchor: "f", avatar: "lan",    name: "阿岚",   aggr: 0.68, bluff: 0.20, temper: 1.03 },
    7: { anchor: "g", avatar: "mai",    name: "老麦",   aggr: 0.38, bluff: 0.10, temper: 0.96 },
    8: { anchor: "h", avatar: "shisan", name: "十三",   aggr: 0.60, bluff: 0.24, temper: 0.99 }
  };
  var NPC_COUNT = 8;
  var NAMES = ["你", "龙哥", "发条", "白噪音", "林深", "K先生", "阿岚", "老麦", "十三"];

  /* Mini App 里同一个页面同时存在联机牌桌与单机牌桌两套骨架，
     所以这里的查找全部限定在单机视图作用域内，避免拿到另一套的元素。 */
  var PRACTICE_SCOPE = '[data-view="practice"] ';

  var app = document.getElementById("app-practice");
  var els = {
    room: app.querySelector(".js-room"),
    meta: app.querySelector(".js-meta"),
    blindClock: app.querySelector(".js-blind-clock"),
    pot: app.querySelector(".js-pot"),
    board: app.querySelector(".js-board"),
    boardLabel: app.querySelector(".js-board-label"),
    seats: app.querySelector(".js-seats"),
    hand: app.querySelector(".js-hand"),
    heroPos: app.querySelector(".js-hero-pos"),
    strength: app.querySelector(".js-strength"),
    strengthLabel: app.querySelector(".js-strength-label"),
    stackLine: app.querySelector(".js-stack-line"),
    timer: app.querySelector(".js-timer"),
    timerNum: app.querySelector(".js-timer-num"),
    fold: app.querySelector(".js-fold"),
    call: app.querySelector(".js-call"),
    raiseBtn: app.querySelector(".js-raise-btn"),
    range: app.querySelector(".js-raise-range"),
    raiseAmts: app.querySelectorAll(".js-raise-amt"),
    potFinal: app.querySelector(".js-pot-final"),
    resultTitle: app.querySelector(".js-result-title"),
    resultSub: app.querySelector(".js-result-sub"),
    next: app.querySelector(".js-next"),
    copy: app.querySelector(".js-copy"),
    toast: app.querySelector(".js-toast"),
    stickers: app.querySelector(".js-stickers"),
    menu: app.querySelector(".js-menu"),
    picker: document.querySelector(PRACTICE_SCOPE + ".js-picker"),
    pickerGrid: document.querySelector(PRACTICE_SCOPE + ".js-picker-grid"),
    pickerClose: document.querySelector(PRACTICE_SCOPE + ".js-picker-close"),
    openPicker: document.querySelector(PRACTICE_SCOPE + ".js-open-picker"),
    styleNow: document.querySelector(PRACTICE_SCOPE + ".js-style-now"),
    reset: document.querySelector(PRACTICE_SCOPE + ".js-reset")
  };

  /* 练习视图不可见时不消耗玩家的思考时间 */
  function practiceVisible() {
    var view = document.querySelector('[data-view="practice"]');
    return !!view && view.classList.contains("is-active");
  }

  var T = null;
  var clock = null;         // 玩家回合计时
  var botTimer = null;      // AI 行动延时
  var timeLeft = TURN_SECONDS;
  var raiseTo = 0;
  var raiseInit = false;
  var prevBoard = 0;
  var boardKey = "";
  var holeKey = "";
  var lastPot = 0;
  var toastTimer = null;
  var currentStyle = "s-felt";

  var blindLevel = 1;
  var blindLeft = BLIND_SECONDS;
  var blindTimer = null;
  var lastHoles = {};       // 出局玩家最后一手的底牌，供看牌使用
  var peek = { seat: -1, cards: [], timer: null };
  var press = null;         // 头像按压（区分轻点与长按）
  var stickerLive = [];
  var stickerPool = [];

  /* ---------------- 小工具 ---------------- */

  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }
  function two(n) { return (n < 10 ? "0" : "") + n; }
  function fmtClock(sec) { return two(Math.floor(sec / 60)) + ":" + two(sec % 60); }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove("is-on"); }, 1700);
  }

  function cardHTML(c, extra) {
    var red = c.s === 1 || c.s === 2;
    return '<div class="card' + (extra || "") + (red ? " is-red" : "") + '">'
      + '<span class="c-rank">' + P.rankOf(c) + '</span>'
      + '<span class="c-suit">' + P.suitOf(c) + "\uFE0E" + '</span></div>';
  }

  /* ---------------- 座位 ---------------- */

  function buildSeats() {
    var html = "";
    for (var s = 1; s <= NPC_COUNT; s++) {
      var m = SEAT_META[s];
      html += '<div class="seat seat--' + m.anchor + '" data-seat="' + s + '" data-state="active">'
        + '<button class="seat-av" type="button" aria-label="' + m.name + ' · 轻点扔表情，长按看牌">'
        + '<img src="assets/avatars/' + m.avatar + '.webp" alt="" draggable="false">'
        + '</button>'
        + '<div class="seat-info"><div class="seat-name">' + m.name + '</div>'
        + '<div class="seat-stack">0</div></div>'
        + '<div class="seat-bet is-hidden"></div>'
        + '<div class="seat-dealer is-hidden">D</div>'
        + '<div class="seat-cards is-hidden"></div>'
        + '</div>';
    }
    els.seats.innerHTML = html;
  }

  function seatEl(seat) {
    return els.seats.querySelector('[data-seat="' + seat + '"]');
  }

  function renderSeats() {
    var showCards = T.phase === "handover" && T.result && T.result.showdown;
    var winners = (T.result && T.result.winners) || [];
    var showdown = (T.result && T.result.showdown) || [];

    for (var s = 1; s <= NPC_COUNT; s++) {
      var el = seatEl(s);
      if (!el) continue;
      var p = T.players[s];

      var state = p.out ? "out" : p.folded ? "folded" : p.allIn ? "allin" : "active";
      el.dataset.state = state;

      el.querySelector(".seat-name").textContent = p.name;
      el.querySelector(".seat-stack").textContent = p.out ? "出局" : fmt(p.stack);

      el.classList.toggle("is-turn", T.phase !== "handover" && T.turn === s);
      el.classList.toggle("is-winner", winners.some(function (w) { return w.seat === s; }));

      var dealer = el.querySelector(".seat-dealer");
      dealer.classList.toggle("is-hidden", !(T.phase !== "idle" && T.phase !== "handover" && T.dealer === s));

      var bet = el.querySelector(".seat-bet");
      var betText = "";
      if (T.phase === "handover") {
        betText = p.folded ? "弃牌" : "";
      } else if (p.bet > 0) betText = fmt(p.bet);
      else if (p.folded) betText = "弃牌";
      else if (p.lastAction === "过牌") betText = "过牌";
      bet.textContent = betText;
      bet.classList.toggle("is-hidden", !betText);
      bet.classList.toggle("seat-bet--text", !!betText && p.bet === 0);

      var cards = el.querySelector(".seat-cards");
      var row = showCards ? showdown.filter(function (x) { return x.seat === s && !x.folded; })[0] : null;
      var peekThis = !row && peek.seat === s && peek.cards.length > 0;
      var shown = row && row.hole && row.hole.length ? row.hole : peekThis ? peek.cards : null;
      if (shown && shown.length) {
        cards.innerHTML = shown.map(function (c) { return cardHTML(c, " card--mini"); }).join("");
        cards.classList.remove("is-hidden");
      } else {
        cards.innerHTML = "";
        cards.classList.add("is-hidden");
      }
      cards.classList.toggle("is-peek", peekThis);
      el.classList.toggle("is-peek", peekThis);
    }
  }

  /* ---------------- 牌面 / 玩家区 ---------------- */

  function renderBoard() {
    var n = T.board.length;
    var key = n + ":" + T.board.map(function (c) { return c.r + "-" + c.s; }).join(",");
    if (key !== boardKey) {
      var html = "";
      for (var i = 0; i < 5; i++) {
        if (i < n) html += cardHTML(T.board[i], i >= prevBoard ? " is-dealing" : "");
        else html += '<div class="card card--empty"></div>';
      }
      els.board.innerHTML = html;
      boardKey = key;
      prevBoard = n;
    }
    els.boardLabel.textContent = T.phase === "handover" ? "摊牌" : n ? "公共牌" : "等待发牌";
  }

  function holeLabel(hole) {
    if (!hole || hole.length < 2) return "—";
    var a = P.rankOf(hole[0]), b = P.rankOf(hole[1]);
    if (hole[0].r === hole[1].r) return "对 " + a;
    return a + b + (hole[0].s === hole[1].s ? " 同花" : "");
  }

  function handLabel() {
    var you = T.players[0];
    if (!you.hole.length) return "—";
    if (T.board.length >= 3) {
      return P.scoreLabel(P.evaluate7(you.hole.concat(T.board)));
    }
    return holeLabel(you.hole);
  }

  function renderHero() {
    var you = T.players[0];
    var key = T.handNo + ":" + you.hole.map(function (c) { return c.r + "-" + c.s; }).join(",");

    if (key !== holeKey) {
      els.hand.innerHTML = you.hole.map(function (c) {
        return cardHTML(c, " card--lg is-dealing");
      }).join("");
      holeKey = key;
    }

    els.heroPos.classList.toggle("is-hidden", !(T.phase !== "idle" && T.phase !== "handover" && T.dealer === 0));

    els.strength.textContent = handLabel();

    var extra = "";
    if (T.phase !== "handover") {
      if (you.bet > 0) extra += " · 本轮 " + fmt(you.bet);
      if (you.allIn && !you.out) extra += " · 全下";
    }
    els.stackLine.innerHTML = "筹码 <b class=\"js-stack\">" + fmt(you.stack) + "</b>" + extra;
  }

  function renderPot() {
    // 结算时引擎已把底池清零，顶栏继续显示这一手的最终底池
    var v = T.phase === "handover" && T.result ? (T.result.pot || 0) : T.pot;
    els.pot.textContent = fmt(v);
    if (v !== lastPot && v > 0) {
      els.pot.classList.remove("is-bump");
      void els.pot.offsetWidth;
      els.pot.classList.add("is-bump");
    }
    lastPot = v;
  }

  function renderMeta() {
    els.meta.textContent = "第 " + Math.max(1, T.handNo) + " 回合 · 盲注 "
      + T.cfg.sb + " / " + T.cfg.bb;
  }

  /* ---------------- 行动区 ---------------- */

  function defaultRaise(L) {
    var target = T.currentBet + Math.max(T.cfg.bb, Math.round((T.pot + L.toCall) * 0.6));
    return clamp(target, L.minTo, L.maxTo);
  }

  // 加注额对齐到小盲的整数倍；全下保持精确值
  function snapRaise(v, L) {
    var step = T.cfg.sb;
    if (v >= L.maxTo) return L.maxTo;
    var lo = Math.ceil(L.minTo / step) * step;
    var hi = Math.floor(L.maxTo / step) * step;
    if (lo > hi) return L.maxTo;
    return clamp(Math.round(v / step) * step, lo, hi);
  }

  function paintRaise() {
    var you = T.players[0];
    els.raiseAmts.forEach(function (n) { n.textContent = fmt(raiseTo); });
    els.potFinal.textContent = fmt(T.pot + Math.max(0, raiseTo - you.bet));
    if (T.turn === 0 && T.phase !== "handover") {
      var L = P.legalActions(T, 0);
      els.raiseBtn.textContent = L.canRaise ? "加注 " + fmt(raiseTo) : "加注";
    }
  }

  function renderControls() {
    var my = T.phase !== "idle" && T.phase !== "handover" && T.turn === 0;
    var L = my ? P.legalActions(T, 0) : null;
    var you = T.players[0];

    app.classList.toggle("is-waiting", !my && T.phase !== "handover");

    els.fold.disabled = !my;
    els.call.disabled = !my;
    els.raiseBtn.disabled = !my || !L.canRaise;
    els.range.disabled = !my || !L.canRaise;

    els.fold.textContent = "弃牌";
    if (!my) {
      els.call.textContent = "等待";
      els.raiseBtn.textContent = "加注";
      els.strengthLabel.textContent = T.phase === "handover" ? "本手结束" : "等待行动";
    } else {
      var callLabel;
      if (L.canCheck) callLabel = "过牌";
      else if (L.toCall >= you.stack) callLabel = "全下 " + fmt(you.stack);
      else callLabel = "跟注 " + fmt(L.toCall);
      els.call.textContent = callLabel;
      els.raiseBtn.textContent = L.canRaise ? "加注 " + fmt(raiseTo) : "加注";
      els.strengthLabel.textContent = "轮到你 · 牌力";
    }

    if (my) {
      var step = T.cfg.sb;
      if (!raiseInit) { raiseTo = snapRaise(defaultRaise(L), L); raiseInit = true; }
      raiseTo = snapRaise(raiseTo, L);
      els.range.min = String(Math.min(L.maxTo, Math.ceil(L.minTo / step) * step));
      els.range.max = String(L.maxTo);
      els.range.step = String(step);
      els.range.value = String(raiseTo);
      paintRaise();
    }
  }

  function renderTimer() {
    var my = T.phase !== "handover" && T.phase !== "idle" && T.turn === 0;
    var ratio = my ? timeLeft / TURN_SECONDS : 0;
    els.timer.style.strokeDashoffset = String((1 - ratio) * RING);
    els.timer.style.stroke = my && timeLeft <= 5 ? "var(--danger)" : "";
    els.timerNum.textContent = my ? String(timeLeft) : "·";
  }

  function renderAll() {
    renderBoard();
    renderSeats();
    renderHero();
    renderPot();
    renderMeta();
    renderBlindClock();
    renderControls();
    renderTimer();
  }

  /* ---------------- 计时 ---------------- */

  function stopClock() {
    clearInterval(clock);
    clock = null;
  }

  /* ---------------- 升盲 ---------------- */

  // 10 / 20 → 20 / 40 → 40 / 80 …
  function blindFor(level) {
    var mul = Math.pow(2, Math.max(0, level - 1));
    return { sb: BLIND_BASE_SB * mul, bb: BLIND_BASE_BB * mul };
  }

  function applyBlinds() {
    var b = blindFor(blindLevel);
    T.cfg.sb = b.sb;
    T.cfg.bb = b.bb;
  }

  function gameHasNextHand() {
    if (!T || T.players[0].stack <= 0) return false;
    return T.players.filter(function (p) { return p.stack > 0; }).length > 1;
  }

  function renderBlindClock() {
    if (!els.blindClock) return;
    var live = gameHasNextHand();
    els.blindClock.textContent = live ? fmtClock(blindLeft) : "--:--";
    els.blindClock.parentNode.classList.toggle("is-soon", live && blindLeft <= 10);
  }

  function blindClockTick() {
    if (document.hidden) return;
    if (!practiceVisible()) return;       // 练习视图不可见时升盲时钟停表
    // 牌局结束后停表，避免结果页停留期间盲注持续跳级
    if (T && T.phase === "handover" && !gameHasNextHand()) return;
    blindLeft -= 1;
    if (blindLeft > 0) { renderBlindClock(); return; }
    blindLeft = BLIND_SECONDS;
    blindLevel += 1;
    var b = blindFor(blindLevel);
    toast("盲注升级 · 下一手 " + b.sb + " / " + b.bb);
    renderBlindClock();
  }

  function startBlindClock() {
    clearInterval(blindTimer);
    blindTimer = setInterval(blindClockTick, 1000);
    renderBlindClock();
  }

  function beginHumanTurn() {
    raiseInit = false;
    timeLeft = TURN_SECONDS;
    renderControls();
    renderTimer();
    stopClock();
    clock = setInterval(function () {
      if (els.picker.classList.contains("is-open")) return;
      if (document.hidden) return;          // 窗口不可见时不计时
      if (!practiceVisible()) return;       // 切到别的标签时不消耗思考时间
      timeLeft -= 1;
      renderTimer();
      if (timeLeft <= 0) {
        stopClock();
        humanAct({ type: "fold" }, true);
      }
    }, 1000);
  }

  /* ---------------- 玩家行动 ---------------- */

  function humanAct(action, timeout) {
    if (T.phase === "handover" || T.turn !== 0) return;
    var L = P.legalActions(T, 0);
    var you = T.players[0];
    var msg;

    if (action.type === "fold") msg = timeout ? "超时 · 自动弃牌" : "你弃牌了";
    else if (action.type === "check") msg = "过牌";
    else if (action.type === "call") msg = L.toCall >= you.stack ? "全下 " + fmt(you.stack) : "跟注 " + fmt(L.toCall);
    else msg = (action.to >= L.maxTo ? "全下 " : "加注到 ") + fmt(action.to);

    var res = P.act(T, 0, action);
    if (!res.ok) { toast(res.error); return; }

    stopClock();
    if (action.type === "fold") app.classList.add("is-out");
    toast(msg);
    afterAction();
  }

  function afterAction() {
    renderAll();
    if (T.phase === "handover") finishHand();
    else schedule();
  }

  /* ---------------- 调度 ---------------- */

  function schedule() {
    clearTimeout(botTimer);
    botTimer = null;
    stopClock();
    renderAll();

    if (T.phase === "handover") { finishHand(); return; }

    if (T.turn === 0) {
      beginHumanTurn();
    } else if (T.turn >= 0) {
      var seat = T.turn;
      botTimer = setTimeout(function () { botTurn(seat); }, 560 + Math.random() * 420);
    }
  }

  function botTurn(seat) {
    if (T.phase === "handover" || T.turn !== seat) return;
    var action = decide(seat);
    var res = P.act(T, seat, action);

    if (!res.ok) {
      var L = P.legalActions(T, seat);
      res = P.act(T, seat, L.canCheck ? { type: "check" } : { type: "fold" });
    }
    if (!res.ok) {
      P.act(T, seat, { type: "fold" });
    }
    afterAction();
  }

  /* ---------------- AI ---------------- */

  function preflopEquity(hole) {
    var a = hole[0], b = hole[1];
    var hi = Math.max(a.r, b.r), lo = Math.min(a.r, b.r);
    if (a.r === b.r) return clamp(0.46 + (hi / 12) * 0.5, 0.4, 0.97);
    var s = 0.12 + (hi / 12) * 0.3 + (lo / 12) * 0.1;
    if (a.s === b.s) s += 0.06;
    var gap = hi - lo;
    if (gap === 1) s += 0.05;
    else if (gap === 2) s += 0.02;
    else if (gap >= 6) s -= 0.06;
    return clamp(s, 0.06, 0.9);
  }

  function drawBonus(hole, board) {
    if (board.length >= 5) return 0;
    var all = hole.concat(board);
    var suits = [0, 0, 0, 0];
    var seen = {};
    all.forEach(function (c) { suits[c.s] += 1; seen[c.r] = true; });

    var bonus = 0;
    if (Math.max(suits[0], suits[1], suits[2], suits[3]) === 4) bonus += 0.1;

    var ranks = Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
    var best = 1, run = 1;
    for (var i = 1; i < ranks.length; i++) {
      if (ranks[i] === ranks[i - 1] + 1) { run += 1; if (run > best) best = run; }
      else run = 1;
    }
    if (best >= 4) bonus += 0.07;
    if (seen[12] && seen[0] && seen[1] && seen[2]) bonus += 0.06;
    return bonus;
  }

  function postflopEquity(hole, board) {
    var score = P.evaluate7(hole.concat(board));
    var base = [0.18, 0.42, 0.6, 0.72, 0.82, 0.88, 0.94, 0.975, 0.995][score.cat] || 0.18;
    var top = (score.tie && score.tie[0]) || 0;
    base += (top / 12) * 0.035;
    var shrink = board.length >= 5 ? 1 : board.length === 4 ? 0.92 : 0.84;
    var eq = 0.5 + (base - 0.5) * shrink;
    return clamp(eq + drawBonus(hole, board), 0.02, 0.99);
  }

  function targetRaise(L, frac) {
    var target = T.currentBet + Math.max(T.cfg.bb, Math.round((T.pot + L.toCall) * frac));
    return Math.round(clamp(target, L.minTo, L.maxTo));
  }

  function decide(seat) {
    var p = T.players[seat];
    var L = P.legalActions(T, seat);
    var meta = SEAT_META[seat];
    var pre = T.board.length === 0;
    var eq = pre ? preflopEquity(p.hole) : postflopEquity(p.hole, T.board);
    // 多人底池里同样的牌力要打折，否则九人桌会跟得太松
    var opp = 0;
    for (var i = 0; i < T.players.length; i++) {
      if (T.players[i].seat !== seat && !T.players[i].folded && !T.players[i].out) opp += 1;
    }
    eq = clamp(eq * (1 - 0.025 * Math.max(0, opp - 1)), 0.02, 0.99);
    eq = clamp(eq * meta.temper, 0.02, 0.99);
    var r = Math.random();

    if (L.toCall <= 0) {
      if (L.canRaise && (eq > 0.62 || r < meta.bluff * 0.55)) {
        return { type: "raise", to: targetRaise(L, 0.62 + Math.random() * 0.28) };
      }
      return { type: "check" };
    }

    var potOdds = L.toCall / (T.pot + L.toCall);
    var need = potOdds * (1 + (0.9 - meta.aggr) * 0.5);
    if (eq < need && r > meta.bluff * 0.4) return { type: "fold" };

    if (L.canRaise) {
      if (eq > 0.74 && r < meta.aggr) {
        return { type: "raise", to: targetRaise(L, 0.72 + Math.random() * 0.4) };
      }
      if (eq > 0.55 && r < meta.aggr * 0.35) {
        return { type: "raise", to: targetRaise(L, 0.5) };
      }
    }
    return { type: "call" };
  }

  /* ---------------- 结算 ---------------- */

  function finishHand() {
    clearTimeout(botTimer);
    botTimer = null;
    stopClock();
    T.players.forEach(function (p) {
      if (p.hole && p.hole.length) lastHoles[p.seat] = p.hole.slice();
    });
    renderAll();
    app.classList.add("is-done");
    app.classList.remove("is-waiting");

    var r = T.result || { winners: [], pot: 0, type: "fold" };
    var you = T.players[0];
    var winners = r.winners || [];
    var mine = winners.filter(function (w) { return w.seat === 0; })[0];
    var aliveCount = T.players.filter(function (p) { return p.stack > 0; }).length;
    var title, sub;

    if (you.stack <= 0) {
      title = "你输光了筹码";
      sub = "这一桌到此为止，重新开局再来";
    } else if (aliveCount <= 1) {
      title = "你赢下了整桌";
      sub = "其余八家全部出局，重新开局可以再战";
    } else if (mine) {
      title = "你赢得 " + fmt(mine.amount);
      sub = resultSub(r, true);
    } else if (winners[0]) {
      title = (winners.length > 1 ? "分池 · " : "") + winners[0].name + " 赢得 " + fmt(winners[0].amount);
      sub = resultSub(r, false);
    } else {
      title = "本手结束";
      sub = "底池 " + fmt(r.pot);
    }

    els.resultTitle.textContent = title;
    els.resultSub.textContent = sub;
    els.next.textContent = (you.stack <= 0 || aliveCount <= 1) ? "重新开局" : "下一手";
  }

  function resultSub(r, mine) {
    var winners = r.winners || [];
    if (r.type === "fold" && winners.length) {
      return "其他人都弃牌 · 底池 " + fmt(r.pot);
    }
    var parts = winners.slice(0, 3).map(function (w) { return w.name + " " + w.label; });
    if (mine) {
      var youLabel = handLabel();
      if (youLabel && youLabel !== "—") parts.push("你的牌 " + youLabel);
    }
    return parts.join(" · ") + " · 底池 " + fmt(r.pot);
  }

  /* ---------------- 战绩分享（微信群里比一比） ---------------- */

  function shareText() {
    var you = T.players[0];
    var alive = T.players.filter(function (p) { return p.stack > 0; }).length;
    var head = you.stack <= 0 ? "我出局了" : (alive <= 1 ? "我赢下了整桌" : "还在桌上");
    return "夜航俱乐部德州桌 · " + head +
      " · 第 " + Math.max(1, T.handNo) + " 回合 · 盲注 " + fmt(T.cfg.sb) + "/" + fmt(T.cfg.bb) +
      " · 我的筹码 " + fmt(you.stack) +
      " · 微信打开同款牌桌：" + location.href.split("#")[0];
  }

  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
    document.body.appendChild(ta);
    var sel = window.getSelection && window.getSelection();
    var prev = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
    document.body.removeChild(ta);
    if (prev && sel) { sel.removeAllRanges(); sel.addRange(prev); }
    return ok;
  }

  function copyResult() {
    var text = shareText();
    var fail = function () { toast("复制失败，请长按结果文字手动复制"); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () {
        toast("战绩已复制，粘贴到微信群里比一比");
      }, fail);
      return;
    }
    if (legacyCopy(text)) {
      toast("战绩已复制，粘贴到微信群里比一比");
    } else {
      fail();
    }
  }

  /* ---------------- 开局 ---------------- */

  function freshTable() {
    return P.createTable({ seats: NPC_COUNT + 1, stack: 2000, sb: 10, bb: 20, names: NAMES });
  }

  function startHand() {
    prevBoard = 0;
    boardKey = "";
    holeKey = "";
    lastPot = 0;
    raiseInit = false;
    app.classList.remove("is-done", "is-out", "is-waiting");
    els.hand.innerHTML = "";
    resetPeek();
    applyBlinds();
    P.startHand(T);
    renderAll();
    schedule();
  }

  function restart() {
    closePicker();
    stopClock();
    clearTimeout(botTimer);
    resetPeek();
    lastHoles = {};
    blindLevel = 1;
    blindLeft = BLIND_SECONDS;
    T = freshTable();
    startHand();
  }

  function nextHand() {
    clearTimeout(botTimer);
    stopClock();
    app.classList.remove("is-done", "is-out", "is-waiting");
    prevBoard = 0;
    boardKey = "";
    holeKey = "";
    raiseInit = false;
    resetPeek();
    applyBlinds();
    P.nextHand(T);
    if (T.phase === "handover") {
      renderAll();
      finishHand();
      return;
    }
    renderAll();
    schedule();
  }

  /* ---------------- 风格切换 ---------------- */

  function markActiveStyle() {
    var chips = els.pickerGrid.querySelectorAll(".style-chip");
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle("is-active", chips[i].dataset.key === currentStyle);
    }
  }

  function applyStyle(key, persist) {
    var def = STYLES.filter(function (s) { return s.key === key; })[0] || STYLES[0];
    STYLES.forEach(function (s) { app.classList.remove(s.key); });
    app.classList.add(def.key);
    currentStyle = def.key;
    els.room.textContent = def.name;
    if (els.styleNow) els.styleNow.textContent = def.name;
    if (persist) {
      try { localStorage.setItem(STYLE_LS_KEY, def.key); } catch (e) {}
    }
    markActiveStyle();
  }

  function buildPicker() {
    els.pickerGrid.innerHTML = STYLES.map(function (s) {
      return '<button class="style-chip" type="button" data-key="' + s.key + '"'
        + ' style="--sw-a:' + s.a + ';--sw-b:' + s.b + '">'
        + '<i></i><b>' + s.no + "</b><span>" + s.name + "</span></button>";
    }).join("");
    markActiveStyle();
  }

  function openPicker() { els.picker.classList.add("is-open"); }
  function closePicker() { els.picker.classList.remove("is-open"); }

  /* ---------------- 头像互动：扔表情 / 看牌 ---------------- */

  var STICKER_EMOJI = ["\uD83D\uDCA9", "\uD83D\uDCA3"];

  function canPeek(seat) {
    var p = T.players[seat];
    if (!p) return false;
    if (p.folded || p.out) return true;
    return T.phase === "handover" && p.stack <= 0;
  }

  function resetPeek() {
    clearTimeout(peek.timer);
    peek.timer = null;
    peek.seat = -1;
    peek.cards = [];
  }

  function clearPeek() {
    if (peek.seat < 0) return;
    resetPeek();
    renderSeats();
  }

  function requestPeek(seat) {
    var p = T.players[seat];
    if (!p) return;
    if (!canPeek(seat)) { toast("只能看已弃牌或离场玩家的牌"); return; }
    var hole = p.hole && p.hole.length === 2 ? p.hole : lastHoles[seat];
    if (!hole || hole.length < 2) { toast("暂时没有可看的底牌"); return; }
    resetPeek();
    peek.seat = seat;
    peek.cards = hole.slice();
    renderSeats();
    toast("已看到 " + p.name + " 的底牌");
    peek.timer = setTimeout(clearPeek, PEEK_MS);
  }

  function acquireSticker() {
    var node = stickerPool.pop();
    if (node) return node;
    node = document.createElement("span");
    node.className = "sticker";
    node.setAttribute("aria-hidden", "true");
    return node;
  }

  function dropSticker(entry) {
    if (entry.done) return;
    entry.done = true;
    var i = stickerLive.indexOf(entry);
    if (i >= 0) stickerLive.splice(i, 1);
    if (entry.node.parentNode) entry.node.parentNode.removeChild(entry.node);
    if (stickerPool.length < STICKER_MAX) stickerPool.push(entry.node);
  }

  function throwSticker(seat) {
    var el = seatEl(seat);
    var av = el && el.querySelector(".seat-av");
    if (!av || !els.stickers) return;

    // 连点限流：超出上限就回收最早起飞的一枚，节点进池复用
    while (stickerLive.length >= STICKER_MAX) {
      var oldest = stickerLive[0];
      oldest.anim.cancel();
      dropSticker(oldest);
    }

    var layer = els.stickers.getBoundingClientRect();
    var from = els.hand.getBoundingClientRect();
    var to = av.getBoundingClientRect();
    var sx = from.left + from.width / 2 - layer.left;
    var sy = from.top + from.height / 2 - layer.top;
    var tx = to.left + to.width / 2 - layer.left - 13;
    var ty = to.top + to.height / 2 - layer.top - 13;

    var dx = tx - sx;
    var dy = ty - sy;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    var lift = clamp(dist * 0.38, 50, 190);
    var mx = (sx + tx) / 2 - (dy / dist) * lift * 0.4 + (Math.random() - 0.5) * 40;
    var my = (sy + ty) / 2 - lift;

    var node = acquireSticker();
    node.textContent = STICKER_EMOJI[Math.random() < 0.5 ? 0 : 1];
    els.stickers.appendChild(node);

    var spin = 180 + Math.random() * 260;
    var anim = node.animate([
      { transform: "translate3d(" + sx + "px," + sy + "px,0) scale(0.55) rotate(0deg)", opacity: 0 },
      { transform: "translate3d(" + mx + "px," + my + "px,0) scale(1.15) rotate(" + (spin * 0.55) + "deg)", opacity: 1, offset: 0.58 },
      { transform: "translate3d(" + tx + "px," + ty + "px,0) scale(1) rotate(" + spin + "deg)", opacity: 1, offset: 0.9 },
      { transform: "translate3d(" + tx + "px," + ty + "px,0) scale(1.45) rotate(" + spin + "deg)", opacity: 0 }
    ], {
      duration: clamp(dist * 1.15, 520, 880),
      easing: "cubic-bezier(0.22, 0.61, 0.36, 1)"
    });

    var entry = { node: node, anim: anim, done: false };
    anim.onfinish = function () { dropSticker(entry); };
    anim.oncancel = function () { dropSticker(entry); };
    stickerLive.push(entry);
  }

  function cancelPress() {
    if (!press) return;
    clearTimeout(press.timer);
    press = null;
  }

  function onAvatarDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    var av = e.target.closest ? e.target.closest(".seat-av") : null;
    var seatElm = av && av.closest(".seat");
    if (!seatElm) return;
    var seat = Number(seatElm.dataset.seat);
    if (!seat) return;

    cancelPress();
    var p = {
      seat: seat,
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      long: false,
      timer: null
    };
    p.timer = setTimeout(function () {
      if (press !== p) return;
      p.long = true;
      requestPeek(p.seat);
    }, LONG_PRESS_MS);
    press = p;
    try { els.seats.setPointerCapture(e.pointerId); } catch (err) {}
  }

  function onAvatarMove(e) {
    if (!press || e.pointerId !== press.id) return;
    if (Math.abs(e.clientX - press.x) > 10 || Math.abs(e.clientY - press.y) > 10) cancelPress();
  }

  function onAvatarUp(e) {
    if (!press || e.pointerId !== press.id) return;
    var p = press;
    press = null;
    clearTimeout(p.timer);
    if (!p.long) throwSticker(p.seat);
  }

  /* ---------------- 绑定 ---------------- */

  els.range.addEventListener("input", function () {
    if (T.turn !== 0 || T.phase === "handover") return;
    raiseTo = snapRaise(+els.range.value, P.legalActions(T, 0));
    els.range.value = String(raiseTo);
    paintRaise();
  });

  els.fold.addEventListener("click", function () { humanAct({ type: "fold" }); });
  els.call.addEventListener("click", function () {
    if (T.phase === "handover" || T.turn !== 0) return;
    var L = P.legalActions(T, 0);
    humanAct(L.canCheck ? { type: "check" } : { type: "call" });
  });
  els.raiseBtn.addEventListener("click", function () {
    if (T.phase === "handover" || T.turn !== 0) return;
    humanAct({ type: "raise", to: raiseTo });
  });

  app.querySelectorAll(".js-quick").forEach(function (chip) {
    chip.addEventListener("click", function () {
      if (T.phase === "handover" || T.turn !== 0) return;
      var L = P.legalActions(T, 0);
      if (!L.canRaise) return;
      var q = chip.dataset.q;
      var frac = q === "half" ? 0.5 : q === "three" ? 2 / 3 : 1;
      var target = q === "all" ? L.maxTo
        : T.currentBet + Math.round((T.pot + L.toCall) * frac);
      raiseTo = snapRaise(target, L);
      els.range.value = String(raiseTo);
      paintRaise();
    });
  });

  els.next.addEventListener("click", function () {
    if (T.players[0].stack <= 0 || T.players.filter(function (p) { return p.stack > 0; }).length <= 1) {
      restart();
    } else {
      nextHand();
    }
  });

  els.copy.addEventListener("click", copyResult);

  els.menu.addEventListener("click", openPicker);
  els.pickerClose.addEventListener("click", closePicker);
  els.picker.addEventListener("click", function (e) {
    if (e.target === els.picker) closePicker();
  });
  els.pickerGrid.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest(".style-chip") : null;
    if (!btn) return;
    applyStyle(btn.dataset.key, true);
    closePicker();
  });
  if (els.openPicker) els.openPicker.addEventListener("click", openPicker);
  els.reset.addEventListener("click", restart);

  els.seats.addEventListener("pointerdown", onAvatarDown);
  els.seats.addEventListener("pointermove", onAvatarMove);
  els.seats.addEventListener("pointerup", onAvatarUp);
  els.seats.addEventListener("pointercancel", cancelPress);
  els.seats.addEventListener("contextmenu", function (e) {
    var av = e.target.closest ? e.target.closest(".seat-av") : null;
    if (av) e.preventDefault();
  });
  els.seats.addEventListener("click", function (e) {
    if (e.detail !== 0) return;
    var av = e.target.closest ? e.target.closest(".seat-av") : null;
    var seatElm = av && av.closest(".seat");
    if (seatElm) throwSticker(Number(seatElm.dataset.seat));
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closePicker();
  });

  /* ---------------- 启动 ---------------- */

  buildSeats();
  buildPicker();

  var initial = STYLES[0].key;
  try {
    var saved = localStorage.getItem(STYLE_LS_KEY);
    if (saved && STYLES.some(function (s) { return s.key === saved; })) initial = saved;
  } catch (e) {}
  applyStyle(initial, false);

  T = freshTable();
  startHand();
  startBlindClock();
})();
