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
  var SERVER_LS_KEY = "holdem.server";
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

  /* 九个座位在牌桌上的固定位置（绝对锚点，不随自己换座而重排）。
     0 号在牌桌底部正中，1–8 顺时针绕桌排开。
     用固定锚点而不是「按自己的座位重排」：
     点哪个空位，头像就落到哪个位置，换座时整桌不会跟着旋转。 */
  var SEAT_SLOTS = ["bottom", "h", "g", "f", "e", "d", "c", "b", "a"];

  /* ---------------- DOM ---------------- */

  var lobbyEl = document.querySelector(".js-lobby");
  var gamewrapEl = document.querySelector(".js-gamewrap");
  var app = document.getElementById("app");
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
    create: document.querySelector(".js-create"),
    serverInput: document.querySelector(".js-server-input"),
    serverSave: document.querySelector(".js-server-save"),
    serverNow: document.querySelector(".js-server-now")
  };

  var els = {
    room: app.querySelector(".js-room"),
    meta: app.querySelector(".js-meta"),
    blindClock: app.querySelector(".blind-clock"),
    blindTime: app.querySelector(".js-blind-time"),
    pot: app.querySelector(".js-pot"),
    board: app.querySelector(".js-board"),
    boardLabel: app.querySelector(".js-board-label"),
    table: app.querySelector(".table"),
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
    vote: app.querySelector(".js-vote"),
    voteName: app.querySelector(".js-vote-name"),
    voteCount: app.querySelector(".js-vote-count"),
    voteMsg: app.querySelector(".js-vote-msg"),
    voteYes: app.querySelector(".js-vote-yes"),
    voteNo: app.querySelector(".js-vote-no"),
    settle: app.querySelector(".js-settle"),
    settleList: app.querySelector(".js-settle-list"),
    toast: app.querySelector(".js-toast"),
    stickers: app.querySelector(".js-stickers"),
    menu: app.querySelector(".js-menu"),
    back: app.querySelector(".js-back"),
    picker: document.querySelector(".js-picker"),
    pickerGrid: document.querySelector(".js-picker-grid"),
    pickerClose: document.querySelector(".js-picker-close"),
    openPicker: document.querySelector(".js-open-picker"),
    styleNow: document.querySelector(".js-style-now"),
    reset: document.querySelector(".js-reset"),
    code: document.querySelector(".js-code"),
    invite: document.querySelector(".js-invite"),
    roster: document.querySelector(".js-roster"),
    spec: document.querySelector(".js-spec")
  };

  /* ---------------- 状态 ---------------- */

  var S = null;              // 服务器最近一次状态
  var stateAt = 0;           // 收到状态的时间
  var ws = null;
  var code = "";
  var token = "";
  var left = false;          // 主动退出，不再重连
  var leaving = false;       // 正在返回大厅：断线回调不要自动重连，等我们重开一条
  var retryDelay = 1500;
  var connectedOnce = false; // 本页是否成功连上过服务器
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
  var voteLeftSec = 0;       // 重新买入表决的剩余秒数（本地倒计时）
  var voteLeftAt = 0;
  var voteKey = "";          // 表决状态指纹，变了才重画
  var toastTimer = null;
  var lastToastId = 0;
  var stickerLive = [];
  var stickerPool = [];

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

  /* ---------------- 牌局服务器地址 ----------------
     网页版可能被托管在静态站上，而真正跑牌局的是另一台机器。
     取值优先级：链接里的 ?server= > 本机记住的 > 页面注入的默认 > 同源（location.origin）。
     一个地址都没配过时行为与从前完全一致：连同源的 /ws。 */

  function normalizeServer(raw) {
    var text = String(raw == null ? "" : raw).trim();
    if (!text) return "";
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
      var host = text.split("/")[0].split(":")[0].toLowerCase();
      var isLocal = host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
      text = (isLocal ? "http://" : "https://") + text;
    }
    var u;
    try { u = new URL(text); } catch (e) { return ""; }
    if (u.protocol === "ws:") u.protocol = "http:";
    else if (u.protocol === "wss:") u.protocol = "https:";
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (!u.hostname) return "";
    return u.origin;
  }

  function savedServer() {
    try { return localStorage.getItem(SERVER_LS_KEY) || ""; } catch (e) { return ""; }
  }

  function urlServer() {
    try { return new URLSearchParams(location.search).get("server") || ""; } catch (e) { return ""; }
  }

  /* 生效的牌局服务器 origin；没有配置时等于当前站点 */
  function serverOrigin() {
    return normalizeServer(urlServer()) || normalizeServer(savedServer()) ||
      normalizeServer(window.YEHANG_SERVER) || location.origin;
  }

  /* 是否配了「不是当前站点」的服务器：决定邀请链接要不要带 ?server= */
  function hasCustomServer() {
    var o = serverOrigin();
    return !!o && o !== location.origin;
  }

  function paintServerStatus(state) {
    if (!lobbyEls.serverNow) return;
    lobbyEls.serverNow.textContent = serverOrigin() + (state ? "（" + state + "）" : "");
  }

  /* ---------------- 连接 ---------------- */

  function wsUrl() {
    var origin = serverOrigin();
    var secure = origin.indexOf("https://") === 0;
    return (secure ? "wss://" : "ws://") + origin.replace(/^https?:\/\//i, "") + "/ws";
  }

  function connect() {
    if (left) return;
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;   // 已经连上/正在连，别开第二条
    paintServerStatus("连接中…");
    try { ws = new WebSocket(wsUrl()); } catch (e) { return scheduleReconnect(); }
    ws.onopen = function () {
      retryDelay = 1500;
      connectedOnce = true;
      paintServerStatus("已连接");
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
      if (leaving) {                     // 主动返回大厅：关掉旧连接后重开一条干净的
        leaving = false;
        ws = null;
        connect();
        return;
      }
      if (!token) {                       // 观战或还没入座：回大厅重新加入
        lobbyEl.hidden = false;
        gamewrapEl.hidden = true;
        lobbyEls.err.textContent = connectedOnce
          ? "连接断开了，请重新加入房间"
          : "连不上牌局服务器 " + serverOrigin() + "，请检查地址或网络";
        lobbyEls.err.hidden = false;
        paintServerStatus("连不上");
        if (code) lobbyEls.code.value = code;
        scheduleReconnect();              // 后台继续重试，服务器起来后自动接上
        return;
      }
      toast("连接断开，正在重连…");
      scheduleReconnect();
    };
  }

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
    pushRoomUrl(code);
  }

  /* ---------- 返回大厅 ---------- */

  /* 地址栏带上 ?room=房间号：既是邀请链接，也让手机上的「返回」手势能退回大厅 */
  function pushRoomUrl(roomCode) {
    try {
      var q = new URLSearchParams(location.search);
      q.set("room", roomCode);
      history.pushState({ room: roomCode }, "", location.pathname + "?" + q.toString());
    } catch (e) { /* ignore */ }
  }

  function cleanRoomUrl() {
    try {
      var q = new URLSearchParams(location.search);
      if (!q.get("room")) return;
      q.delete("room");
      var s = q.toString();
      history.replaceState(null, "", location.pathname + (s ? "?" + s : ""));
    } catch (e) { /* ignore */ }
  }

  /* 离开这张桌子回大厅。
     先发 leave 让服务端立刻释放座位（否则会留一个离线幽灵占着位置，
     别人坐下时看到的位置也不对），再清掉本地令牌、切回大厅。 */
  function backToLobby() {
    leaving = true;
    if (ws && ws.readyState === 1) send({ t: "leave" });
    try {
      if (code) sessionStorage.removeItem("holdem.token." + code);
      sessionStorage.removeItem("holdem.lastCode");
    } catch (e) { /* ignore */ }
    S = null;
    code = "";
    token = "";
    pendingJoin = null;
    layoutKey = "";
    boardKey = "";
    holeKey = "";
    turnKey = "";
    els.seats.innerHTML = "";
    lobbyEl.hidden = false;
    gamewrapEl.hidden = true;
    lobbyEls.err.hidden = true;
    lobbyEls.code.value = "";
    cleanRoomUrl();
    if (ws) { try { ws.close(); } catch (e) { /* ignore */ } }
    // 万一 close 事件不来（连接本来就断了），兜底重开一条
    setTimeout(function () {
      if (!leaving) return;
      leaving = false;
      ws = null;
      connect();
    }, 900);
  }

  /* 手机键盘弹起时，把大厅底部的「创建房间 / 加入房间」整行抬到键盘上沿，
     否则按钮正好被键盘盖住，看着像点不动。 */
  function bindKeyboardSafeActions() {
    var row = document.querySelector(".lobby-actions");
    var vv = window.visualViewport;
    if (!row || !vv) return;
    var sync = function () {
      var overlap = Math.max(0, (window.innerHeight || 0) - vv.height - vv.offsetTop);
      row.style.transform = overlap > 0 ? "translateY(" + (-overlap) + "px)" : "";
    };
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    sync();
  }

  function onErr(msg) {
    clearSeatPending();
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
    clearSeatPending();
    if (state.toast && state.toast.id && state.toast.id !== lastToastId) {
      lastToastId = state.toast.id;
      toast(state.toast.msg);
    }
    renderAll();
  }

  /* ---------------- 渲染 ---------------- */

  /* 座位：9 个固定位置。
     座位号与位置一一对应：0 号在牌桌底部正中，1–8 顺时针绕桌排开。
     点哪个空位就坐到哪个位置，头像出现在被点的那个格子里。 */
  function buildSeats() {
    var html = "";
    for (var seat = 0; seat <= 8; seat++) {
      var p = S.seats[seat];
      var anchor = SEAT_SLOTS[seat];
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
    syncBottomSeat();
  }

  /* 底部正中那个座位（0 号）得坐在桌布上。
     桌布是各皮肤自己画的（.table::before），形状大小都不一样，
     写死 bottom 一定掉到桌布外头去，所以运行时量一次桌布下沿再定位。
     量不到（单色/装饰风没有桌布伪元素）就沿用 CSS 里的默认值。 */
  function syncBottomSeat() {
    var slot = els.seats.querySelector(".seat--bottom");
    if (!slot || !els.table) return;
    var stage = els.seats.getBoundingClientRect();
    var cs = window.getComputedStyle(els.table, "::before");
    var feltH = parseFloat(cs.height);
    var feltTop = parseFloat(cs.top);
    if (!isFinite(feltH) || !isFinite(feltTop) || feltH <= 0) return;
    var m = /matrix\(([^)]*)\)/.exec(cs.transform || "");
    var ty = 0;
    if (m) {
      var parts = m[1].split(",");
      ty = parseFloat(parts[5]) || 0;
    }
    // 桌布下沿（与座位同一坐标系：.table 与 .seats 都是舞台铺满）
    var feltBottom = feltTop + ty + feltH;
    var chipH = slot.offsetHeight || 40;
    var center = feltBottom - chipH / 2 - 6;      // 往里收一点，座位坐在桌沿内侧
    var maxCenter = stage.height - chipH / 2 - 4; // 别掉出舞台
    center = Math.max(0, Math.min(center, maxCenter));
    slot.style.top = Math.round(center - chipH / 2) + "px";
    slot.style.bottom = "auto";
  }

  function seatEl(seat) {
    return els.seats.querySelector('[data-seat="' + seat + '"]');
  }

  /* 点空位后先给个即时反馈（变灰 = 已提交，等服务器回话）。
     手机上网络一来一回有延迟，没这个反馈用户会以为没点上，连点好几次。
     服务端广播新状态或返回错误后自动撤销。 */
  function markSeatPending(seat) {
    clearSeatPending();
    var el = seatEl(seat);
    if (el) el.classList.add("is-pending");
  }

  function clearSeatPending() {
    var list = els.seats.querySelectorAll(".seat.is-pending");
    for (var i = 0; i < list.length; i++) list[i].classList.remove("is-pending");
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
    // 台面样式只在「牌局进行中」跟着状态变：
    // 手间/结算期把台面固定住，不要因为弃牌或出局突然整块变灰。
    if (streets()) {
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
    var req = S.rebuyReq || null;
    if (!isOver && !isLobby) {
      els.next.classList.add("is-hidden");
      els.rebuy.classList.add("is-hidden");
      els.stand.classList.add("is-hidden");
      els.vote.classList.add("is-hidden");
      els.settle.classList.add("is-hidden");
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

    // 重新买入：现在是「申请 + 全员同意」，所以按钮有三种状态
    if (req && req.mine) {
      els.rebuy.textContent = "撤回申请";
      els.rebuy.classList.remove("is-hidden");
    } else {
      els.rebuy.textContent = "重新买入";
      // 别人已经在申请了，就不能再发起第二条
      els.rebuy.classList.toggle("is-hidden", !(isOver && S.you.rebuyOk && !req));
    }
    // 去围观：坐着就能用（大厅阶段、手间都行）；牌局进行中不行
    els.stand.classList.toggle("is-hidden", !(S.you.seat >= 0 && (isOver || isLobby)));

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

  /* ---------------- 重新买入表决 ----------------
     筹码打光的人点「重新买入」只是提出申请，
     要在场所有人都点头才真的加筹码。 */

  function renderVote() {
    var req = S.rebuyReq;
    if (!req) {
      els.vote.classList.add("is-hidden");
      voteKey = "";
      return;
    }
    var key = [req.seat, req.yes, req.need, req.myVote, req.mine].join(":");
    if (key !== voteKey) {
      voteKey = key;
      voteLeftSec = req.left || 0;
      voteLeftAt = Date.now();
      paintVote(req);
    }
    els.vote.classList.remove("is-hidden");
  }

  function paintVote(req) {
    els.voteName.textContent = req.name + " 申请重新买入";
    els.voteCount.textContent = "同意 " + req.yes + "/" + req.need;

    var msg = "";
    var canVote = false;
    if (req.mine) {
      msg = "等待其他人同意，全员点头才生效";
    } else if (req.myVote === 1) {
      msg = "你已同意，等其他人表态";
    } else if (req.myVote === -1) {
      msg = "你已拒绝，这次申请作废";
    } else if (S.you.seat < 0) {
      msg = "围观者不参与表决";
    } else {
      msg = "需要在场所有人同意才生效";
      canVote = true;
    }
    els.voteMsg.textContent = msg;
    els.voteYes.classList.toggle("is-hidden", !canVote);
    els.voteNo.classList.toggle("is-hidden", !canVote);
  }

  /* 表决倒计时：服务器给的是快照，这里本地走秒，免得一直停在旧数字 */
  function tickVote() {
    if (!S || !S.rebuyReq || els.vote.classList.contains("is-hidden")) return;
    var left = Math.max(0, voteLeftSec - (Date.now() - voteLeftAt) / 1000);
    els.voteCount.textContent = "同意 " + S.rebuyReq.yes + "/" + S.rebuyReq.need
      + " · 剩 " + Math.ceil(left) + " 秒";
  }

  /* ---------------- 摊牌牌型明细 ----------------
     摊牌比大小，光有一句「阿信 两对 K/8」不够看，
     这里把每个人的底牌和牌型列出来，赢家高亮。 */

  function renderSettle() {
    var r = S.result;
    var show = (r && r.showdown) || [];
    if (!show.length) {
      els.settle.classList.add("is-hidden");
      els.settleList.innerHTML = "";
      return;
    }
    var winners = (r && r.winners) || [];
    var html = "";
    for (var i = 0; i < show.length; i++) {
      var row = show[i];
      var win = winners.filter(function (w) { return w.seat === row.seat; })[0];
      var cards = (row.hole || []).map(function (c) {
        return cardHTML(c, " card--mini");
      }).join("");
      html += '<div class="settle-row' + (win ? " is-winner" : "") + '">'
        + '<div class="settle-cards">' + cards + '</div>'
        + '<div class="settle-info">'
        + '<span class="settle-name">' + escapeHTML(row.name) + (row.seat === S.you.seat ? "（你）" : "") + '</span>'
        + '<span class="settle-label">' + escapeHTML(row.label || "") + '</span>'
        + '</div>'
        + '<span class="settle-amt">' + (win ? "+" + fmt(win.amount) : "—") + '</span>'
        + '</div>';
    }
    els.settleList.innerHTML = html;
    els.settle.classList.remove("is-hidden");
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
    renderVote();
    renderSettle();
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
    tickVote();
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
    var link = location.origin + location.pathname + "?room=" + code;
    // 网页版与牌局服务器不同源时，邀请链接必须带上服务器地址，朋友点开才知道连哪儿
    if (hasCustomServer()) link += "&server=" + encodeURIComponent(serverOrigin());
    return link;
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

    /* 牌局服务器地址：默认连同源；链接带 ?server= 或本机记住过就填上 */
    if (lobbyEls.serverInput) {
      var preset = normalizeServer(urlServer()) || "";
      if (!preset && serverOrigin() !== location.origin) preset = serverOrigin();
      lobbyEls.serverInput.value = preset;
      paintServerStatus("");
    }
    if (lobbyEls.serverSave) {
      lobbyEls.serverSave.addEventListener("click", function () {
        var origin = normalizeServer(lobbyEls.serverInput.value);
        if (!origin) {
          lobbyEls.err.textContent = "服务器地址要写成 http:// 或 https:// 开头";
          lobbyEls.err.hidden = false;
          return;
        }
        try { localStorage.setItem(SERVER_LS_KEY, origin); } catch (e) { /* ignore */ }
        location.reload();   // 换服务器要重连；重载会保留 ?room= 与 ?server=
      });
    }

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
    syncBottomSeat();                     // 换皮肤后桌布形状变了，底部座位要重新贴桌沿
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
    if (els.voteYes) els.voteYes.addEventListener("click", function () { send({ t: "rebuy_vote", vote: true }); });
    if (els.voteNo) els.voteNo.addEventListener("click", function () { send({ t: "rebuy_vote", vote: false }); });
    els.copy.addEventListener("click", function () {
      copyText(shareText(), "已复制，粘贴到微信群里吧");
    });
    els.invite.addEventListener("click", function () {
      copyText(shareText(), "邀请链接已复制，发到微信群里即可");
    });

    els.openPicker.addEventListener("click", function () { els.picker.classList.add("is-open"); });
    els.menu.addEventListener("click", function () { els.picker.classList.add("is-open"); });
    // 顶栏返回：离开牌桌回大厅
    if (els.back) els.back.addEventListener("click", backToLobby);
    // 手机上的返回手势/键盘：同样是退回大厅
    window.addEventListener("popstate", function () {
      if (!gamewrapEl.hidden) backToLobby();
    });
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
    // 空位整块都能点（手指戳在「点此入座」那行字上也算数，手机上尤其重要）；
    // 有人时仍然只有点头像才发表情，避免误触。
    els.seats.addEventListener("click", function (e) {
      var seatElm = e.target.closest ? e.target.closest(".seat") : null;
      if (!seatElm || !S) return;
      var seat = Number(seatElm.dataset.seat);
      if (!Number.isInteger(seat)) return;

      var emptyAv = seatElm.querySelector(".seat-av--empty");
      if (emptyAv) {
        send({ t: "sit", seat: seat });
        markSeatPending(seat);
        return;
      }
      var av = e.target.closest(".seat-av");
      if (!av) return;
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
    // 屏幕尺寸变了，桌布下沿也跟着变，底部座位重新贴一次
    window.addEventListener("resize", function () {
      if (S) syncBottomSeat();
    });
  }

  /* ---------------- 启动 ---------------- */

  try { currentStyle = localStorage.getItem(STYLE_LS_KEY) || "s-felt"; } catch (e) { currentStyle = "s-felt"; }
  if (!STYLES.some(function (s) { return s.key === currentStyle; })) currentStyle = "s-felt";

  initLobby();
  buildPicker();
  bind();
  bindKeyboardSafeActions();
  els.timer.style.strokeDashoffset = RING;
  connect();
})();
