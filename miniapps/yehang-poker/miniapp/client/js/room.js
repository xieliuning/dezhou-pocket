/* ============================================================
   room.js — 同桌联机客户端
   规则由服务器上的 poker.js 权威运行；这里只负责：
   连接管理、渲染服务器状态、发送行动、断线重连、风格切换。
   复用 base.css / s*.css 的牌桌骨架，与单机页同一套视觉。
   ============================================================ */
(function () {
  "use strict";

  var P = window.Poker;
  var RING = 119.38;                 // 2πr, r = 19
  var STYLE_LS_KEY = "holdem.style";
  var NICK_LS_KEY = "holdem.nick";
  var AVATAR_LS_KEY = "holdem.avatar";
  var STICKER_MAX = 18;
  var STICKER_EMOJI = ["\uD83D\uDCA9", "\uD83D\uDCA3"]; // 💩 💣
  var CODE_LEN = 4;

  var AVATAR_FILES = [
    // 水果头像（SVG 自绘，剪影风）：苹果 葡萄 西瓜 草莓 柠檬 橙子 菠萝 桃子 梨 樱桃
    "apple.svg", "grape.svg", "watermelon.svg", "strawberry.svg", "lemon.svg",
    "orange.svg", "pineapple.svg", "peach.svg", "pear.svg", "cherry.svg"
  ];

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

  /* 九人桌固定布局：对手按相对座位序 1–8 落到 a–h 锚点（自己永远在底部） */
  var ANCHORS8 = ["a", "b", "c", "d", "e", "f", "g", "h"];

  /* ---------------- DOM ---------------- */

  /* Mini App 里同一个页面同时存在联机牌桌与单机牌桌两套骨架，
     所以这里的查找全部限定在联机视图作用域内，避免拿到另一套的元素。 */
  var ROOM_SCOPE = '[data-view="room"] ';

  var lobbyEl = document.querySelector(".js-lobby");
  var gamewrapEl = document.querySelector(".js-gamewrap");
  var app = document.getElementById("app-room");
  var lobbyEls = {
    nick: document.querySelector(".js-nick"),
    avatars: document.querySelector(".js-avatars"),
    code: document.querySelector(".js-code-input"),
    sb: document.querySelector(".js-sb"),
    bbLink: document.querySelector(".js-bb-link"),
    blindMins: document.querySelector(".js-blind-mins"),
    stack: document.querySelector(".js-stack"),
    err: document.querySelector(".js-lobby-err"),
    join: document.querySelector(".js-join"),
    create: document.querySelector(".js-create")
  };

  var els = {
    room: app.querySelector(".js-room"),
    meta: app.querySelector(".js-meta"),
    blindClock: app.querySelector(".blind-clock"),
    blindTime: app.querySelector(".js-blind-time"),
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
    rebuy: app.querySelector(".js-rebuy"),
    stand: app.querySelector(".js-stand"),
    toast: app.querySelector(".js-toast"),
    stickers: app.querySelector(".js-stickers"),
    menu: app.querySelector(".js-menu"),
    picker: document.querySelector(ROOM_SCOPE + ".js-picker"),
    pickerGrid: document.querySelector(ROOM_SCOPE + ".js-picker-grid"),
    pickerClose: document.querySelector(ROOM_SCOPE + ".js-picker-close"),
    openPicker: document.querySelector(ROOM_SCOPE + ".js-open-picker"),
    styleNow: document.querySelector(ROOM_SCOPE + ".js-style-now"),
    reset: document.querySelector(ROOM_SCOPE + ".js-reset"),
    code: document.querySelector(ROOM_SCOPE + ".js-code"),
    invite: document.querySelector(ROOM_SCOPE + ".js-invite"),
    roster: document.querySelector(ROOM_SCOPE + ".js-roster"),
    spec: document.querySelector(ROOM_SCOPE + ".js-spec")
  };

  /* 供 Mini App 外壳（桌主控制台）复用头像清单 */
  window.YEHANG_AVATARS = AVATAR_FILES;

  /* ---------------- 状态 ---------------- */

  var S = null;              // 服务器最近一次状态
  var stateAt = 0;           // 收到状态的时间
  var ws = null;
  var code = "";
  var token = "";
  var left = false;          // 主动退出，不再重连
  var retryDelay = 1500;
  var pendingJoin = null;    // 连接建立后要发的第一条消息
  var lastServerMsgAt = 0;   // 客户端 watchdog：太久没有服务器消息就重连
  var myAvatar = 0;
  var layoutKey = "";
  var boardKey = "";
  var prevBoard = 0;
  var holeKey = "";
  var turnKey = "";
  var raiseTo = 0;
  var currentStyle = "s-felt";
  var toastTimer = null;
  var lastToastId = 0;
  var stickerLive = [];
  var stickerPool = [];
  var viaProxy = false;        // 直连失败后改走 Mini App 本地 /ws 代理
  var proxyTried = false;      // 本轮是否已经试过代理
  var reconnecting = false;    // 主动重连（切换服务器地址），不当作断线

  /* ---------------- 小工具 ---------------- */

  function fmt(n) { return Math.round(n).toLocaleString("en-US"); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function two(n) { return (n < 10 ? "0" : "") + n; }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove("is-on"); }, 2000);
  }

  function cardHTML(c, extra) {
    var red = c.s === 1 || c.s === 2;
    return '<div class="card' + (extra || "") + (red ? " is-red" : "") + '">'
      + '<span class="c-rank">' + P.rankOf(c) + '</span>'
      + '<span class="c-suit">' + P.suitOf(c) + "\uFE0E" + '</span></div>';
  }

  function streets() {
    return S && ["preflop", "flop", "turn", "river"].indexOf(S.phase) >= 0;
  }

  function myPlayer() {
    if (!S || S.you.seat < 0) return null;
    return S.seats[S.you.seat];
  }

  function turnPlayer() {
    if (!streets() || S.turn < 0) return null;
    return S.seats[S.turn];
  }

  function seatedCount() {
    return S ? S.seats.filter(function (p) { return p.occupied; }).length : 0;
  }

  /* ---------------- 连接 ---------------- */

  function wsUrl() {
    // 优先直连公网牌局服务器；直连不通时改走 Mini App 本地代理
    // （本地 /ws 会把帧反代到同一台牌局服务器）。
    if (!viaProxy) {
      var base = (window.YEHANG && window.YEHANG.upstream) || "";
      if (base) {
        try {
          var u = new URL(base);
          u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
          u.pathname = (window.YEHANG && window.YEHANG.wsPath) || "/ws";
          u.search = "";
          u.hash = "";
          return u.toString();
        } catch (e) { /* 地址不可解析则走本地代理 */ }
      }
    }
    var secure = location.protocol === "https:";
    return (secure ? "wss://" : "ws://") + location.host + "/ws";
  }

  function signalConn(isConnected) {
    try {
      document.dispatchEvent(new CustomEvent("holdem:conn", { detail: { connected: !!isConnected } }));
    } catch (e) { /* ignore */ }
  }

  function serverUnreachableText() {
    var base = (window.YEHANG && window.YEHANG.upstream) || "";
    return base
      ? "连不上牌局服务器 " + base + "，请到「服务器」页检查地址"
      : "连接断开了，请重新加入房间";
  }

  function connect() {
    if (left) return;
    try { ws = new WebSocket(wsUrl()); } catch (e) { return scheduleReconnect(); }
    ws.onopen = function () {
      retryDelay = 1500;
      viaProxy = false;
      proxyTried = false;
      signalConn(true);
      if (pendingJoin) {
        var msg = pendingJoin;
        pendingJoin = null;
        send(msg);
      } else if (code && token) {
        // 断线重连（同一页面会话内）
        send({ t: "join", code: code, token: token, name: savedNick(), avatar: myAvatar });
      } else {
        // 页面刚加载：有历史令牌就静默回到原房间（刷新/断网恢复）
        var rejoin = savedSession();
        if (rejoin) {
          code = rejoin.code;
          token = rejoin.token;
          send({ t: "join", code: rejoin.code, token: rejoin.token, name: savedNick(), avatar: myAvatar });
        }
      }
    };
    ws.onmessage = function (ev) {
      lastServerMsgAt = Date.now();
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.t === "state") onState(msg);
      else if (msg.t === "joined") onJoined(msg);
      else if (msg.t === "err") onErr(msg);
      else if (msg.t === "replaced") onReplaced();
      else if (msg.t === "sticker") onSticker(msg);
    };
    ws.onclose = function () {
      if (left) return;
      if (reconnecting) {          // 服务器地址变更触发的重连，不算断线
        reconnecting = false;
        scheduleReconnect();
        return;
      }
      if (!proxyTried) {           // 直连不通：先改走 Mini App 本地代理再试一次
        proxyTried = true;
        viaProxy = true;
        scheduleReconnect();
        return;
      }
      signalConn(false);
      if (!token) {                       // 观战或还没入座：回大厅重新加入
        lobbyEl.hidden = false;
        gamewrapEl.hidden = true;
        lobbyEls.err.textContent = serverUnreachableText();
        lobbyEls.err.hidden = false;
        if (code) lobbyEls.code.value = code;
        return;
      }
      toast("连接断开，正在重连…");
      scheduleReconnect();
    };
  }

  /* 服务器地址变更后重连：沿用当前房间令牌，服务端会把你放回原座位 */
  document.addEventListener("holdem:reconfigure", function () {
    if (left) return;
    reconnecting = true;
    viaProxy = false;
    proxyTried = false;
    try { if (ws) ws.close(); } catch (e) { /* ignore */ }
  });

  function scheduleReconnect() {
    if (left) return;
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 1.7, 8000);
  }

  /* 应用层心跳：防半开连接。20s 一发 ping，55s 没有任何服务器消息就强断重连 */
  setInterval(function () {
    if (ws && ws.readyState === 1) {
      if (lastServerMsgAt && Date.now() - lastServerMsgAt > 55000) {
        try { ws.close(); } catch (e) { /* onclose 走重连 */ }
        return;
      }
      send({ t: "ping" });
    }
  }, 20000);

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function onJoined(msg) {
    code = msg.code;
    token = msg.token || "";
    try {
      // token 存 sessionStorage：同一浏览器开多个标签互不串号，刷新本标签仍可回到原座位
      sessionStorage.setItem("holdem.token." + code, token);
      sessionStorage.setItem("holdem.lastCode", code);
      localStorage.setItem(NICK_LS_KEY, lobbyEls.nick.value.trim());
      localStorage.setItem(AVATAR_LS_KEY, String(myAvatar));
    } catch (e) { /* ignore */ }
    lobbyEl.hidden = true;
    gamewrapEl.hidden = false;
    applyStyle(currentStyle, false);
  }

  function onErr(msg) {
    if (!lobbyEl.hidden) {
      lobbyEls.err.textContent = msg.msg || "出错了";
      lobbyEls.err.hidden = false;
    } else {
      toast(msg.msg || "出错了");
    }
  }

  /* 同一房间在另一个页面被打开，本页面让位 */
  function onReplaced() {
    left = true;
    token = "";
    try { ws.close(); } catch (e) { /* ignore */ }
    lobbyEl.hidden = false;
    gamewrapEl.hidden = true;
    lobbyEls.err.textContent = "这个房间已在另一个页面打开，本页面已退出";
    lobbyEls.err.hidden = false;
  }

  function onState(state) {
    S = state;
    stateAt = Date.now();
    lobbyEl.hidden = true;
    gamewrapEl.hidden = false;
    if (state.toast && state.toast.id && state.toast.id !== lastToastId) {
      lastToastId = state.toast.id;
      toast(state.toast.msg);
    }
    renderAll();
    // 通知 Mini App 外壳：桌主控制台据此刷新席位与邀请信息
    try {
      document.dispatchEvent(new CustomEvent("holdem:state", { detail: S }));
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 渲染 ---------------- */

  function anchorFor(rel) {
    return ANCHORS8[clamp(rel - 1, 0, 7)];
  }

  /* 座位：9 个位置。
     rel=0 是「你的位置」，固定钉在牌桌底部正中，入座后这里直接显示你自己；
     rel=1..8 是另外 8 个位置，顺时针绕桌排开。
     观战时 rel=0 显示「点此入座」，点它就是坐 0 号位。 */
  function buildSeats() {
    var mySeat = S.you.seat;                     // -1 = 观战
    var base = mySeat < 0 ? 0 : mySeat;
    var html = "";
    for (var rel = 0; rel <= 8; rel++) {
      var seat = (base + rel) % 9;
      var p = S.seats[seat];
      var anchor = rel === 0 ? "me" : anchorFor(rel);
      var empty = !p.occupied;
      var mine = !empty && !!p.me;
      var av = empty
        ? '<button class="seat-av seat-av--empty" type="button" aria-label="空座位 · 点此入座">＋</button>'
        : '<button class="seat-av" type="button" aria-label="' + escapeHTML(p.name) + (mine ? " · 你" : " · 轻点扔表情") + '">'
          + '<img src="assets/avatars/' + AVATAR_FILES[p.avatar % 10] + '" alt="" draggable="false">'
          + '</button>';
      html += '<div class="seat seat--' + anchor + '" data-seat="' + seat + '" data-state="' + (empty ? "empty" : "active") + (mine ? " is-me" : "") + '">'
        + av
        + '<div class="seat-info"><div class="seat-name">' + (empty ? "空位" : "") + '</div>'
        + '<div class="seat-stack">—</div></div>'
        + (mine ? '<span class="seat-you">你</span>' : '')
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
    var showCards = S.phase === "handover" && S.result && S.result.showdown;
    var winners = (S.result && S.result.winners) || [];
    var showdown = (S.result && S.result.showdown) || [];
    var inStreets = streets();

    for (var i = 0; i < 9; i++) {
      var p = S.seats[i];
      var seat = p.seat;
      var el = seatEl(seat);
      if (!el) continue;

      if (!p.occupied) {                            // 空位
        el.dataset.state = "empty";
        el.classList.remove("is-turn", "is-winner", "is-offline");
        el.querySelector(".seat-name").textContent = "空位";
        el.querySelector(".seat-stack").textContent = "点此入座";
        el.querySelector(".seat-dealer").classList.add("is-hidden");
        var emptyBet = el.querySelector(".seat-bet");
        emptyBet.textContent = "";
        emptyBet.classList.add("is-hidden");
        var emptyCards = el.querySelector(".seat-cards");
        emptyCards.innerHTML = "";
        emptyCards.classList.add("is-hidden");
        continue;
      }

      var state = p.out ? "out" : p.folded ? "folded" : p.allIn ? "allin" : "active";
      el.dataset.state = state;
      el.classList.toggle("is-offline", !p.online);

      el.querySelector(".seat-name").textContent = p.name;
      el.querySelector(".seat-stack").textContent = p.out ? "出局" : fmt(p.stack);

      el.classList.toggle("is-turn", inStreets && S.turn === seat);
      el.classList.toggle("is-winner", winners.some(function (w) { return w.seat === seat; }));

      var dealer = el.querySelector(".seat-dealer");
      dealer.classList.toggle("is-hidden", !(inStreets && S.dealer === seat));

      var bet = el.querySelector(".seat-bet");
      var betText = "";
      if (S.phase === "handover") {
        betText = p.folded ? "弃牌" : "";
      } else if (inStreets) {
        if (p.bet > 0) betText = fmt(p.bet);
        else if (p.folded) betText = "弃牌";
        else if (p.lastAction === "过牌") betText = "过牌";
      }
      bet.textContent = betText;
      bet.classList.toggle("is-hidden", !betText);
      bet.classList.toggle("seat-bet--text", !!betText && p.bet === 0);

      var cards = el.querySelector(".seat-cards");
      var row = showCards ? showdown.filter(function (x) { return x.seat === seat && !x.folded; })[0] : null;
      // 自己的底牌由底部手牌区展示，座位格里不重复画
      var shown = p.me ? null
        : (row && row.hole && row.hole.length ? row.hole : (p.hole && p.hole.length ? p.hole : null));
      if (shown && shown.length) {
        cards.innerHTML = shown.map(function (c) { return cardHTML(c, " card--mini"); }).join("");
        cards.classList.remove("is-hidden");
      } else {
        cards.innerHTML = "";
        cards.classList.add("is-hidden");
      }
    }
  }

  function renderBoard() {
    var cards = S.board || [];
    var n = cards.length;
    var key = n + ":" + cards.map(function (c) { return c.r + "-" + c.s; }).join(",");
    if (key !== boardKey) {
      var html = "";
      for (var i = 0; i < 5; i++) {
        if (i < n) html += cardHTML(cards[i], i >= prevBoard ? " is-dealing" : "");
        else html += '<div class="card card--empty"></div>';
      }
      els.board.innerHTML = html;
      boardKey = key;
      prevBoard = n;
    }
    if (S.phase === "lobby") els.boardLabel.textContent = "等待开局";
    else if (S.phase === "handover") els.boardLabel.textContent = "摊牌";
    else els.boardLabel.textContent = n ? "公共牌" : "等待发牌";
  }

  function holeLabel(hole) {
    if (!hole || hole.length < 2) return "—";
    var a = P.rankOf(hole[0]), b = P.rankOf(hole[1]);
    if (hole[0].r === hole[1].r) return "对 " + a;
    return a + b + (hole[0].s === hole[1].s ? " 同花" : "");
  }

  function myHandLabel() {
    var me = myPlayer();
    if (!me || !me.hole || me.hole.length < 2) return "—";
    if ((S.board || []).length >= 3) {
      return P.scoreLabel(P.evaluate7(me.hole.concat(S.board)));
    }
    return holeLabel(me.hole);
  }

  function renderHero() {
    var me = myPlayer();
    if (!me) {                                       // 观战
      els.hand.innerHTML = "";
      els.strength.textContent = "观战中";
      els.stackLine.innerHTML = "底牌保密 · 摊牌后可见";
      els.heroPos.classList.add("is-hidden");
      return;
    }
    var key = S.handNo + ":" + (me.hole || []).map(function (c) { return c.r + "-" + c.s; }).join(",");
    if (key !== holeKey) {
      els.hand.innerHTML = (me.hole || []).map(function (c) {
        return cardHTML(c, " card--lg is-dealing");
      }).join("");
      holeKey = key;
    }

    els.heroPos.classList.toggle("is-hidden", !(streets() && S.dealer === S.you.seat));
    els.strength.textContent = S.phase === "lobby" ? "—" : myHandLabel();

    var extra = "";
    if (streets()) {
      if (me.bet > 0) extra += " · 本轮 " + fmt(me.bet);
      if (me.allIn) extra += " · 全下";
      if (me.folded) extra += " · 已弃牌";
    }
    els.stackLine.innerHTML = "筹码 <b class=\"js-stack\">" + fmt(me.stack) + "</b>" + extra;
  }

  function renderTop() {
    var def = STYLES.filter(function (s) { return s.key === currentStyle; })[0] || STYLES[0];
    els.room.textContent = "房间 " + S.code;
    els.code.textContent = S.code;
    if (els.styleNow) els.styleNow.textContent = def.name;
    els.meta.textContent = S.phase === "lobby"
      ? "已连接 · 盲注 " + S.cfg.sb + " / " + S.cfg.bb
      : "第 " + Math.max(1, S.handNo) + " 手 · 盲注 " + S.cfg.sb + " / " + S.cfg.bb;

    var v = S.phase === "handover" && S.result ? (S.result.pot || 0) : S.pot;
    els.pot.textContent = fmt(v);
  }

  function renderActions() {
    var me = myPlayer();
    var myTurn = !!(S.you.legal && me && !me.folded && !me.out);

    els.strengthLabel.textContent = myTurn ? "轮到你 · 牌力" : (streets() ? "等待行动" : "牌力");

    var cls = "app " + currentStyle;
    if (S.phase === "handover" || S.phase === "lobby") cls += " is-done";
    else if (myTurn) { /* 完整行动 UI */ }
    else cls += " is-waiting";
    if (S.phase !== "lobby") {
      if (S.you.seat < 0 || (me && me.out)) cls += " is-out";
      else if (me && me.folded) cls += " is-outofhand";
    }
    if (app.className !== cls) app.className = cls;

    var L = S.you.legal;
    els.fold.disabled = !myTurn;
    els.call.disabled = !myTurn;
    els.raiseBtn.disabled = !myTurn || !L || !L.canRaise;

    if (myTurn) {
      els.call.textContent = L.canCheck ? "过牌" : (L.toCall >= me.stack ? "全下跟注" : "跟注 " + fmt(L.toCall));
      initRaise();
    } else {
      els.call.textContent = "跟注";
      var tp = turnPlayer();
      els.resultTitle.textContent = tp ? tp.name + " 思考中" : "等待行动";
      els.resultSub.textContent = tp ? "轮到 " + tp.name + " 行动" : "";
    }
  }

  function renderResult() {
    var me = myPlayer();
    var isOver = S.phase === "handover";
    var isLobby = S.phase === "lobby";
    if (!isOver && !isLobby) {
      els.next.classList.add("is-hidden");
      els.rebuy.classList.add("is-hidden");
      return;
    }

    if (isLobby) {
      els.resultTitle.textContent = "等待开局";
      els.resultSub.textContent = seatedCount() < 2
        ? "至少两位玩家入座才能开局（已坐 " + seatedCount() + "/9），点空位入座或围观"
        : seatedCount() + "/9 位玩家已入座";
    } else {
      var r = S.result || { winners: [], pot: 0, type: "fold" };
      var winners = r.winners || [];
      var mine = me && winners.filter(function (w) { return w.seat === S.you.seat; })[0];
      var alive = S.seats.filter(function (p) { return p.occupied && p.stack > 0; }).length;

      if (r.type === "gameover") {
        els.resultTitle.textContent = "本桌结束";
        els.resultSub.textContent = "筹码打光了，重新买入后可继续";
      } else if (me && me.stack <= 0) {
        els.resultTitle.textContent = "你输光了这一桌的筹码";
        els.resultSub.textContent = "点「重新买入」再战";
      } else if (me && alive <= 1) {
        els.resultTitle.textContent = "你赢下了整桌";
        els.resultSub.textContent = "其他人全部出局，点「下一手」继续守擂";
      } else if (mine) {
        els.resultTitle.textContent = "你赢得 " + fmt(mine.amount);
        els.resultSub.textContent = resultSub(r);
      } else if (winners[0]) {
        els.resultTitle.textContent = (winners.length > 1 ? "分池 · " : "") + winners[0].name + " 赢得 " + fmt(winners[0].amount);
        els.resultSub.textContent = resultSub(r);
      } else {
        els.resultTitle.textContent = "本手结束";
        els.resultSub.textContent = "底池 " + fmt(r.pot);
      }
    }

    els.rebuy.classList.toggle("is-hidden", !(isOver && S.you.rebuyOk));
    // 去围观：坐着且在手间/未开局时可用；围观后点空位随时回来
    els.stand.classList.toggle("is-hidden", !(isOver && S.you.seat >= 0));

    // 下一手 / 开始牌局：庄家专属
    var hostLabel = isLobby ? "开始牌局" : "下一手";
    if (S.you.host) {
      els.next.textContent = hostLabel;
      els.next.disabled = !S.canStart;
      els.next.classList.remove("is-hidden");
    } else {
      els.next.textContent = isLobby ? "等庄家开局" : "等庄家开下一手";
      els.next.disabled = true;
      els.next.classList.remove("is-hidden");
    }
  }

  function resultSub(r) {
    var winners = r.winners || [];
    if (r.type === "fold" && winners.length) {
      return "其他人都弃牌 · 底池 " + fmt(r.pot);
    }
    var parts = winners.slice(0, 3).map(function (w) { return w.name + " " + w.label; });
    var me = myPlayer();
    if (me && mineIn(winners)) {
      var youLabel = myHandLabel();
      if (youLabel && youLabel !== "—") parts.push("你的牌 " + youLabel);
    }
    return parts.join(" · ") + " · 底池 " + fmt(r.pot);
  }

  function mineIn(winners) {
    return winners.some(function (w) { return w.seat === S.you.seat; });
  }

  function renderRoster() {
    var html = "";
    for (var i = 0; i < 9; i++) {
      var p = S.seats[i];
      if (!p.occupied) {
        html += '<div class="roster-row is-empty"><span class="roster-seat-no">' + (i + 1) + '</span>'
          + '<span class="roster-name">空位</span>'
          + '<span class="roster-stack">点此入座</span></div>';
        continue;
      }
      html += '<div class="roster-row' + (p.online ? "" : " is-offline") + '">'
        + '<img src="assets/avatars/' + AVATAR_FILES[p.avatar % 10] + '" alt="">'
        + '<span class="roster-name">' + escapeHTML(p.name) + (p.host ? '<i class="roster-host">庄</i>' : "")
        + (p.me ? '<i class="roster-me">你</i>' : "") + '</span>'
        + '<span class="roster-stack">' + (p.out ? "出局" : fmt(p.stack)) + '</span>'
        + '</div>';
    }
    els.roster.innerHTML = html;
    els.spec.textContent = S.spectators > 0 ? "另有 " + S.spectators + " 人围观。" : "";
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function renderAll() {
    if (!S) return;
    var sig = S.seats.map(function (p) { return p.occupied ? "1" : "0"; }).join("");
    var key = S.you.seat + ":" + S.phase + ":" + sig;
    if (key !== layoutKey) {
      layoutKey = key;
      boardKey = "";
      holeKey = "";
      prevBoard = 0;
      buildSeats();
    }
    renderTop();
    renderBoard();
    renderSeats();
    renderHero();
    renderActions();
    renderResult();
    renderRoster();
  }

  /* ---------------- 行动 ---------------- */

  function snapRaise(v, L) {
    var step = S.cfg.sb;
    if (v >= L.maxTo) return L.maxTo;
    var lo = Math.ceil(L.minTo / step) * step;
    var hi = Math.floor(L.maxTo / step) * step;
    if (lo > hi) return L.maxTo;
    return clamp(Math.round(v / step) * step, lo, hi);
  }

  function initRaise() {
    var L = S.you.legal;
    var me = myPlayer();
    if (!L || !me) return;
    var key = S.handNo + ":" + S.turn + ":" + S.currentBet;
    if (key === turnKey) { paintRaise(); return; }
    turnKey = key;
    var target = S.currentBet + Math.max(S.cfg.bb, Math.round((S.pot + L.toCall) * 0.6));
    raiseTo = snapRaise(clamp(target, L.minTo, L.maxTo), L);
    els.range.min = String(L.minTo);
    els.range.max = String(L.maxTo);
    els.range.step = String(S.cfg.sb);
    els.range.value = String(raiseTo);
    paintRaise();
  }

  function paintRaise() {
    var L = S.you.legal;
    var me = myPlayer();
    if (!L || !me) return;
    els.raiseAmts.forEach(function (n) { n.textContent = fmt(raiseTo); });
    els.potFinal.textContent = fmt(S.pot + Math.max(0, raiseTo - me.bet));
    els.raiseBtn.textContent = L.canRaise ? "加注 " + fmt(raiseTo) : "加注";
  }

  function doFold() { send({ t: "act", type: "fold" }); }
  function doCall() {
    var L = S.you.legal;
    if (!L) return;
    send({ t: "act", type: L.canCheck ? "check" : "call" });
  }
  function doRaise() {
    var L = S.you.legal;
    if (!L || !L.canRaise) return;
    send({ t: "act", type: "raise", to: raiseTo });
  }

  /* ---------------- 倒计时（升盲 + 自己的行动环） ---------------- */

  function tick() {
    if (!S) return;
    // 顶栏升盲倒计时
    if (S.blindLeft != null) {
      var bLeft = Math.max(0, S.blindLeft - (Date.now() - stateAt) / 1000);
      var bSecs = Math.ceil(bLeft);
      els.blindTime.textContent = two(Math.floor(bSecs / 60)) + ":" + two(bSecs % 60);
      els.blindClock.classList.toggle("is-soon", bSecs <= 10);
    } else {
      els.blindTime.textContent = "02:00";
      els.blindClock.classList.remove("is-soon");
    }
    // 行动环：只在自己回合走秒
    if (!streets() || S.turn < 0) {
      els.timerNum.textContent = "·";
      els.timer.style.strokeDashoffset = RING;
      return;
    }
    var left = Math.max(0, S.turnLeft - (Date.now() - stateAt) / 1000);
    var secs = Math.ceil(left);
    if (S.you.legal != null) {
      els.timerNum.textContent = secs;
      els.timer.style.strokeDashoffset = String(RING * (1 - clamp(left / 60, 0, 1)));
    } else {
      els.timerNum.textContent = "·";
      els.timer.style.strokeDashoffset = RING;
    }
  }
  setInterval(tick, 250);

  /* ---------------- 扔表情（点头像，全场可见） ---------------- */

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

  /* fromSeat/toSeat 为服务端座位号；来源是自己时从手牌位置起飞 */
  function throwSticker(fromSeat, toSeat) {
    if (!els.stickers) return;
    var fromEl = fromSeat === S.you.seat ? els.hand
      : (seatEl(fromSeat) ? seatEl(fromSeat).querySelector(".seat-av") : els.hand);
    var toEl = toSeat === S.you.seat ? els.hand
      : (seatEl(toSeat) ? seatEl(toSeat).querySelector(".seat-av") : null);
    if (!fromEl || !toEl) return;
    var av = toEl;

    while (stickerLive.length >= STICKER_MAX) {
      var oldest = stickerLive[0];
      oldest.anim.cancel();
      dropSticker(oldest);
    }

    var layer = els.stickers.getBoundingClientRect();
    var from = fromEl.getBoundingClientRect();
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

  function onSticker(msg) {
    if (!S) return;
    throwSticker(msg.from, msg.to);
  }

  /* ---------------- 复制战绩 / 邀请 ---------------- */

  function inviteLink() {
    // 朋友必须能直接打开，所以链接指向公网牌局服务器，不是 Mini App 的本地地址
    var base = (window.YEHANG && window.YEHANG.upstream) || "";
    if (base) return base.replace(/\/+$/, "") + "/room.html?room=" + code;
    return location.origin + location.pathname + "?room=" + code;
  }

  function shareText() {
    if (!S) return "";
    if (S.phase === "lobby") {
      return "夜航俱乐部开桌了 · 房间 " + code + " · 盲注 " + S.cfg.sb + "/" + S.cfg.bb +
        " · 点链接上桌：" + inviteLink();
    }
    var me = myPlayer();
    var alive = S.seats.filter(function (p) { return p.occupied && p.stack > 0; }).length;
    var head = !me || me.stack <= 0 ? "我出局了" : (alive <= 1 ? "我赢下了整桌" : "还在桌上");
    return "夜航俱乐部联机桌 · " + head +
      " · 第 " + Math.max(1, S.handNo) + " 手 · 盲注 " + S.cfg.sb + "/" + S.cfg.bb +
      (me ? " · 我的筹码 " + fmt(me.stack) : "") +
      " · 房间 " + code + "，来同桌：" + inviteLink();
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

  function copyText(text, okMsg) {
    var fail = function () { toast("复制失败，请长按房间号手动复制"); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fail);
      return;
    }
    if (legacyCopy(text)) toast(okMsg);
    else fail();
  }

  /* ---------------- 大厅（创建 / 加入 / 个人游戏） ---------------- */

  function savedNick() {
    try { return localStorage.getItem(NICK_LS_KEY) || ""; } catch (e) { return ""; }
  }

  /* 上一次会话的房间与令牌（仅本标签的 sessionStorage），供刷新后静默回座 */
  function savedSession() {
    try {
      var fromUrl = (new URLSearchParams(location.search).get("room") || "").replace(/[^0-9]/g, "").slice(0, CODE_LEN);
      var codeSaved = (fromUrl || sessionStorage.getItem("holdem.lastCode") || "");
      if (!/^[0-9]{4}$/.test(codeSaved)) return null;
      var tk = sessionStorage.getItem("holdem.token." + codeSaved) || "";
      if (!tk) return null;
      return { code: codeSaved, token: tk };
    } catch (e) { return null; }
  }

  function avatarButtonHTML(index, active) {
    return '<button class="lobby-av' + (index === active ? " is-active" : "") + '" type="button" data-av="' + index + '">'
      + '<img src="assets/avatars/' + AVATAR_FILES[index] + '" alt=""></button>';
  }

  function initLobby() {
    try { lobbyEls.nick.value = savedNick() || ""; } catch (e) { /* ignore */ }
    try { myAvatar = Number(localStorage.getItem(AVATAR_LS_KEY)) || 0; } catch (e) { myAvatar = 0; }
    myAvatar = clamp(myAvatar, 0, AVATAR_FILES.length - 1);

    var html = "";
    for (var i = 0; i < AVATAR_FILES.length; i++) html += avatarButtonHTML(i, myAvatar);
    lobbyEls.avatars.innerHTML = html;
    lobbyEls.avatars.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".lobby-av") : null;
      if (btn) selectAvatar(Number(btn.dataset.av) || 0);
    });

    function selectAvatar(idx) {
      myAvatar = idx;
      document.querySelectorAll(".lobby-av").forEach(function (b) {
        b.classList.toggle("is-active", Number(b.dataset.av) === myAvatar);
      });
    }

    // 大小盲联动 + 强制 10 的倍数：失焦自动向下取整，用户设置不了个位数
    function snapSB() {
      var n = Math.round(Number(lobbyEls.sb.value));
      if (!Number.isFinite(n) || n < 10) n = 10;
      n = Math.min(1000, Math.floor(n / 10) * 10);
      lobbyEls.sb.value = String(n);
      paintBB();
    }
    function paintBB() {
      var sb = Math.round(Number(lobbyEls.sb.value));
      lobbyEls.bbLink.textContent = Number.isFinite(sb) && sb > 0
        ? "大盲 " + (sb * 2)
        : "大盲 = 2 × 小盲";
    }
    lobbyEls.sb.addEventListener("input", paintBB);
    lobbyEls.sb.addEventListener("change", snapSB);
    lobbyEls.sb.addEventListener("blur", snapSB);
    snapSB();

    var fromUrl = "";
    try {
      fromUrl = (new URLSearchParams(location.search).get("room") || "").replace(/[^0-9]/g, "").slice(0, CODE_LEN);
    } catch (e) { /* ignore */ }
    if (fromUrl) lobbyEls.code.value = fromUrl;

    function requireNick() {
      var name = lobbyEls.nick.value.trim();
      if (!name) {
        lobbyEls.err.textContent = "先给自己起个昵称";
        lobbyEls.err.hidden = false;
        lobbyEls.nick.focus();
        return null;
      }
      lobbyEls.err.hidden = true;
      return name;
    }

    function requireCfg() {
      var sb = Math.round(Number(lobbyEls.sb.value));
      if (!Number.isFinite(sb) || sb < 10 || sb > 1000 || sb % 10 !== 0) {
        lobbyEls.err.textContent = "小盲必须是 10 的倍数（10～1000）";
        lobbyEls.err.hidden = false;
        return null;
      }
      var stack = Math.round(Number(lobbyEls.stack.value));
      if (!Number.isFinite(stack) || stack < 100 || stack > 100000) {
        lobbyEls.err.textContent = "初始筹码请在 100 ～ 100,000 之间";
        lobbyEls.err.hidden = false;
        return null;
      }
      return { sb: sb, stack: stack, blindMins: Math.round(Number(lobbyEls.blindMins.value)) || 2 };
    }

    function queueHello(msg) {
      if (ws && ws.readyState === 1) { send(msg); return; }
      pendingJoin = msg;
      lobbyEls.err.textContent = "正在连接服务器，连上后自动发送…";
      lobbyEls.err.hidden = false;
    }

    lobbyEls.create.addEventListener("click", function () {
      var name = requireNick();
      var cfg = requireCfg();
      if (!name || !cfg) return;
      token = "";
      queueHello({
        t: "create", name: name, avatar: myAvatar,
        sb: cfg.sb, stack: cfg.stack, blindMins: cfg.blindMins
      });
    });

    lobbyEls.join.addEventListener("click", function () {
      var name = requireNick();
      var roomCode = lobbyEls.code.value.trim();
      if (!name) return;
      if (!/^[0-9]{4}$/.test(roomCode)) {
        lobbyEls.err.textContent = "房间号是 4 位数字";
        lobbyEls.err.hidden = false;
        return;
      }
      lobbyEls.err.hidden = true;
      var savedToken = "";
      try { savedToken = sessionStorage.getItem("holdem.token." + roomCode) || ""; } catch (e) { /* ignore */ }
      token = "";
      code = roomCode;
      queueHello({
        t: "join", code: roomCode, name: name, avatar: myAvatar, token: savedToken
      });
    });
  }

  /* ---------------- 风格切换 ---------------- */

  function buildPicker() {
    var html = "";
    for (var i = 0; i < STYLES.length; i++) {
      var s = STYLES[i];
      html += '<button class="style-chip" type="button" data-key="' + s.key + '">'
        + '<span class="chip-no">' + s.no + '</span>'
        + '<span class="chip-name">' + s.name + '</span>'
        + '<span class="chip-colors"><i style="background:' + s.a + '"></i><i style="background:' + s.b + '"></i></span>'
        + '</button>';
    }
    els.pickerGrid.innerHTML = html;
    markActiveStyle();
  }

  function markActiveStyle() {
    var chips = els.pickerGrid.querySelectorAll(".style-chip");
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle("is-active", chips[i].dataset.key === currentStyle);
    }
  }

  function applyStyle(key, persist) {
    var def = STYLES.filter(function (s) { return s.key === key; })[0] || STYLES[0];
    currentStyle = def.key;
    if (S) { renderAll(); } else { app.className = "app " + currentStyle; }
    if (els.styleNow) els.styleNow.textContent = def.name;
    if (persist) {
      try { localStorage.setItem(STYLE_LS_KEY, def.key); } catch (e) { /* ignore */ }
    }
    markActiveStyle();
  }

  /* ---------------- 事件绑定 ---------------- */

  function bind() {
    els.fold.addEventListener("click", doFold);
    els.call.addEventListener("click", doCall);
    els.raiseBtn.addEventListener("click", doRaise);
    els.range.addEventListener("input", function () {
      var L = S && S.you.legal;
      if (!L) return;
      raiseTo = snapRaise(Number(els.range.value), L);
      paintRaise();
    });
    Array.prototype.forEach.call(document.querySelectorAll(".js-quick"), function (chip) {
      chip.addEventListener("click", function () {
        var L = S && S.you.legal;
        if (!L || !L.canRaise) return;
        var q = chip.dataset.q;
        var frac = q === "half" ? 0.5 : q === "three" ? 2 / 3 : 1;
        var target = q === "all" ? L.maxTo
          : S.currentBet + Math.round((S.pot + L.toCall) * frac);
        raiseTo = snapRaise(target, L);
        els.range.value = String(raiseTo);
        paintRaise();
      });
    });

    els.next.addEventListener("click", function () { if (S.you.host) send({ t: "start" }); });
    els.rebuy.addEventListener("click", function () { send({ t: "rebuy" }); });
    els.stand.addEventListener("click", function () { send({ t: "stand" }); });
    els.copy.addEventListener("click", function () {
      copyText(shareText(), "已复制，粘贴到微信群里吧");
    });
    els.invite.addEventListener("click", function () {
      copyText(shareText(), "邀请链接已复制，发到微信群里即可");
    });

    els.openPicker.addEventListener("click", function () { els.picker.classList.add("is-open"); });
    els.menu.addEventListener("click", function () { els.picker.classList.add("is-open"); });
    els.pickerClose.addEventListener("click", function () { els.picker.classList.remove("is-open"); });
    els.picker.addEventListener("click", function (e) {
      if (e.target === els.picker) els.picker.classList.remove("is-open");
    });
    els.pickerGrid.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".style-chip") : null;
      if (!btn) return;
      applyStyle(btn.dataset.key, true);
      els.picker.classList.remove("is-open");
    });
    // 点座位：空位 → 入座/换座；有人的头像 → 扔表情
    els.seats.addEventListener("click", function (e) {
      var av = e.target.closest ? e.target.closest(".seat-av") : null;
      if (!av) return;
      var seatElm = av.closest(".seat");
      if (!seatElm || !S) return;
      var seat = Number(seatElm.dataset.seat);
      if (!Number.isInteger(seat)) return;
      if (av.classList.contains("seat-av--empty")) {
        send({ t: "sit", seat: seat });
        return;
      }
      if (seat === S.you.seat) return;
      send({ t: "sticker", to: seat });
    });
    els.pickerGrid.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".style-chip") : null;
      if (!btn) return;
      applyStyle(btn.dataset.key, true);
      els.picker.classList.remove("is-open");
    });
    els.reset.addEventListener("click", function () {
      left = true;
      try {   // 清掉本房间的会话令牌，否则刷新后自动回座等于没退出
        if (code) sessionStorage.removeItem("holdem.token." + code);
        sessionStorage.removeItem("holdem.lastCode");
      } catch (e) { /* ignore */ }
      if (ws) ws.close();
      location.reload();
    });
  }

  /* ---------------- 启动 ---------------- */

  try { currentStyle = localStorage.getItem(STYLE_LS_KEY) || "s-felt"; } catch (e) { currentStyle = "s-felt"; }
  if (!STYLES.some(function (s) { return s.key === currentStyle; })) currentStyle = "s-felt";

  initLobby();
  buildPicker();
  bind();
  els.timer.style.strokeDashoffset = RING;
  connect();
})();
