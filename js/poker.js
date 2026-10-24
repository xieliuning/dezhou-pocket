/* ============================================================
   poker.js — 德州扑克规则引擎（无 DOM 依赖）
   浏览器挂到 window.Poker，node 里可 require 做测试。
   只做规则：洗牌、发牌、盲注、四条街下注、全下与边池、摊牌分池。
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Poker = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var RANK_CHARS = "23456789TJQKA";
  var SUIT_CHARS = ["♠", "♥", "♦", "♣"];
  var CAT_NAMES = ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"];

  /* ---------------- 牌 ---------------- */

  function makeDeck() {
    var d = [];
    for (var r = 0; r < 13; r++) for (var s = 0; s < 4; s++) d.push({ r: r, s: s });
    return d;
  }

  function shuffle(deck, rng) {
    rng = rng || Math.random;
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    return deck;
  }

  function rankOf(c) { return RANK_CHARS[c.r]; }
  function suitOf(c) { return SUIT_CHARS[c.s]; }
  function isRed(c) { return c.s === 1 || c.s === 2; }
  function cardText(c) { return rankOf(c) + suitOf(c); }

  /* ---------------- 牌型评估 ---------------- */

  // 返回 { cat, tie, label }，cat 越大越强；tie 用于同类型比较。
  function evaluate5(cs) {
    var ranks = cs.map(function (c) { return c.r; }).sort(function (a, b) { return b - a; });
    var counts = {};
    ranks.forEach(function (r) { counts[r] = (counts[r] || 0) + 1; });
    // 先按张数、再按点数排序：四条 → 三条 → 对子
    var groups = Object.keys(counts).map(Number).sort(function (a, b) {
      return counts[b] - counts[a] || b - a;
    });
    var flush = cs.every(function (c) { return c.s === cs[0].s; });
    var uniq = [];
    ranks.forEach(function (r) { if (uniq.indexOf(r) < 0) uniq.push(r); });

    var straightHigh = -1;
    if (uniq.length === 5) {
      if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
      else if (uniq[0] === 12 && uniq[1] === 3) straightHigh = 3; // A2345，5 高
    }

    if (flush && straightHigh >= 0) return { cat: 8, tie: [straightHigh] };
    if (counts[groups[0]] === 4) return { cat: 7, tie: [groups[0], groups[1]] };
    if (counts[groups[0]] === 3 && counts[groups[1]] === 2) return { cat: 6, tie: [groups[0], groups[1]] };
    if (flush) return { cat: 5, tie: ranks };
    if (straightHigh >= 0) return { cat: 4, tie: [straightHigh] };
    if (counts[groups[0]] === 3) return { cat: 3, tie: groups };
    if (counts[groups[0]] === 2 && counts[groups[1]] === 2) return { cat: 2, tie: groups };
    if (counts[groups[0]] === 2) return { cat: 1, tie: groups };
    return { cat: 0, tie: ranks };
  }

  function compareScore(a, b) {
    if (a.cat !== b.cat) return a.cat - b.cat;
    var n = Math.max(a.tie.length, b.tie.length);
    for (var i = 0; i < n; i++) {
      var x = a.tie[i] == null ? -1 : a.tie[i];
      var y = b.tie[i] == null ? -1 : b.tie[i];
      if (x !== y) return x - y;
    }
    return 0;
  }

  // 7 张取最优 5 张（21 种组合）
  function evaluate7(cards) {
    if (cards.length < 5) return { cat: 0, tie: cards.map(function (c) { return c.r; }).sort(function (a, b) { return b - a; }), best: cards.slice() };
    var best = null, bestCards = null, n = cards.length;
    for (var a = 0; a < n - 4; a++)
      for (var b = a + 1; b < n - 3; b++)
        for (var c = b + 1; c < n - 2; c++)
          for (var d = c + 1; d < n - 1; d++)
            for (var e = d + 1; e < n; e++) {
              var five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
              var s = evaluate5(five);
              if (!best || compareScore(s, best) > 0) { best = s; bestCards = five; }
            }
    best.best = bestCards;
    return best;
  }

  function scoreLabel(score) {
    var t = score.tie || [];
    var R = function (i) { return RANK_CHARS[t[i]] || "?"; };
    switch (score.cat) {
      case 8: return t[0] === 12 ? "皇家同花顺" : "同花顺 到 " + R(0);
      case 7: return "四条 " + R(0);
      case 6: return "葫芦 " + R(0) + " 带 " + R(1);
      case 5: return "同花 " + R(0) + " 高";
      case 4: return "顺子 到 " + R(0);
      case 3: return "三条 " + R(0);
      case 2: return "两对 " + R(0) + " / " + R(1);
      case 1: return "一对 " + R(0);
      default: return "高牌 " + R(0);
    }
  }

  /* ---------------- 牌桌 ---------------- */

  var DEFAULTS = { seats: 6, stack: 2000, sb: 10, bb: 20, names: null };

  function createTable(opts) {
    opts = opts || {};
    var cfg = {
      seats: opts.seats || DEFAULTS.seats,
      stack: opts.stack || DEFAULTS.stack,
      sb: opts.sb || DEFAULTS.sb,
      bb: opts.bb || DEFAULTS.bb
    };
    var names = opts.names || [];
    var players = [];
    for (var i = 0; i < cfg.seats; i++) {
      players.push({
        seat: i,
        name: names[i] || "玩家" + (i + 1),
        isHuman: i === 0,
        stack: cfg.stack,
        bet: 0,
        totalBet: 0,
        folded: false,
        allIn: false,
        out: false,
        hole: [],
        lastAction: "",
        acted: false,
        canRaise: true
      });
    }
    return {
      cfg: cfg,
      players: players,
      handNo: 0,
      dealer: cfg.seats - 1,
      phase: "idle",      // idle | preflop | flop | turn | river | showdown | handover
      board: [],
      deck: [],
      pot: 0,
      currentBet: 0,
      minRaise: cfg.bb,
      turn: -1,
      lastAggressor: -1,
      result: null,
      log: []
    };
  }

  function alive(t) { return t.players.filter(function (p) { return !p.out && p.stack > 0; }); }
  function inHand(t) { return t.players.filter(function (p) { return !p.folded && !p.out; }); }
  function actionable(t) {
    return t.players.filter(function (p) { return !p.folded && !p.out && !p.allIn && p.stack > 0; });
  }

  function nextSeat(t, from, pred) {
    var n = t.cfg.seats;
    for (var k = 1; k <= n; k++) {
      var s = (from + k) % n;
      var p = t.players[s];
      if (!p.out && pred(p)) return s;
    }
    return -1;
  }

  function pay(t, p, amount) {
    var paid = Math.max(0, Math.min(amount, p.stack));
    p.stack -= paid;
    p.bet += paid;
    p.totalBet += paid;
    t.pot += paid;
    if (p.stack === 0 && !p.folded) p.allIn = true;
    return paid;
  }

  function startHand(t) {
    var live = alive(t);
    if (live.length < 2) {
      t.phase = "handover";
      t.result = { type: "gameover", winners: [], showdown: [] };
      return t;
    }
    t.handNo += 1;
    t.phase = "preflop";
    t.board = [];
    t.deck = shuffle(makeDeck());
    t.pot = 0;
    t.currentBet = 0;
    t.minRaise = t.cfg.bb;
    t.lastAggressor = -1;
    t.result = null;
    t.log = [];

    t.players.forEach(function (p) {
      p.bet = 0; p.totalBet = 0; p.hole = []; p.lastAction = "";
      p.acted = false; p.folded = false; p.allIn = false; p.canRaise = true;
      p.out = p.stack <= 0;
    });

    // 庄家轮转：只在还有筹码的人之间转
    t.dealer = nextSeat(t, t.dealer, function (p) { return p.stack > 0; });

    var liveSeats = t.players
      .filter(function (p) { return !p.out; })
      .map(function (p) { return p.seat; });
    var headsUp = liveSeats.length === 2;

    var sbSeat = headsUp ? t.dealer : nextSeat(t, t.dealer, function (p) { return !p.out && p.stack > 0; });
    var bbSeat = nextSeat(t, sbSeat, function (p) { return !p.out && p.stack > 0; });

    // 发底牌：从小盲开始一人一张，转两轮
    var order = [];
    for (var k = 0; k < t.cfg.seats; k++) {
      var seat = (sbSeat + k) % t.cfg.seats;
      if (!t.players[seat].out) order.push(seat);
    }
    for (var round = 0; round < 2; round++) {
      order.forEach(function (seat) {
        t.players[seat].hole.push(t.deck.pop());
      });
    }

    pay(t, t.players[sbSeat], t.cfg.sb);
    t.players[sbSeat].lastAction = "小盲";
    pay(t, t.players[bbSeat], t.cfg.bb);
    t.players[bbSeat].lastAction = "大盲";

    t.currentBet = Math.max(t.players[sbSeat].bet, t.players[bbSeat].bet);
    t.minRaise = Math.max(t.cfg.bb, t.currentBet);

    // 翻前从大盲左手边开始；单挑时由庄家（小盲）先行动
    t.players.forEach(function (p) { p.acted = false; });
    // 盲注就把所有人打光的极端情况：没人还能行动，直接发完摊牌
    if (actionable(t).length <= 1) { advance(t); return t; }
    t.turn = headsUp ? t.dealer : nextSeat(t, bbSeat, function (p) { return !p.out && !p.allIn && p.stack > 0; });
    return t;
  }

  function legalActions(t, seat) {
    var p = t.players[seat];
    var toCall = Math.max(0, t.currentBet - p.bet);
    var maxTo = p.bet + p.stack;
    var minTo = Math.min(maxTo, t.currentBet + t.minRaise);
    return {
      toCall: Math.min(toCall, p.stack),
      canCheck: toCall === 0,
      canCall: toCall > 0,
      canRaise: p.canRaise !== false && maxTo > t.currentBet,
      minTo: minTo,
      maxTo: maxTo,
      raiseStep: Math.max(t.minRaise, 1)
    };
  }

  function act(t, seat, action) {
    if (t.phase === "idle" || t.phase === "showdown" || t.phase === "handover") return { ok: false, error: "此时不能行动" };
    if (t.turn !== seat) return { ok: false, error: "还没轮到你" };
    var p = t.players[seat];
    if (p.folded || p.allIn || p.out) return { ok: false, error: "无法行动" };
    var toCall = Math.max(0, t.currentBet - p.bet);
    var legal = legalActions(t, seat);
    var type = action.type;

    if (type === "fold") {
      p.folded = true;
      p.lastAction = "弃牌";
    } else if (type === "check") {
      if (toCall > 0) return { ok: false, error: "有下注，不能过牌" };
      p.lastAction = "过牌";
    } else if (type === "call") {
      if (toCall <= 0) return { ok: false, error: "无需跟注" };
      var paid = pay(t, p, toCall);
      p.lastAction = p.allIn ? "全下 " + paid : "跟 " + paid;
    } else if (type === "raise" || type === "allin") {
      var to = type === "allin" ? legal.maxTo : Math.round(action.to);
      if (!isFinite(to)) return { ok: false, error: "加注额无效" };
      if (to > legal.maxTo) to = legal.maxTo;
      var need = to - p.bet;
      if (need <= 0) return { ok: false, error: "加注额无效" };
      // 面对不足额全下时，已经行动过的人只能跟或弃，加注权没有重新打开
      if (to > t.currentBet && p.canRaise === false) return { ok: false, error: "本轮不能加注" };
      var fullRaise = t.currentBet + t.minRaise;
      var isAllInShort = to < fullRaise && to === legal.maxTo;
      if (to < fullRaise && !isAllInShort) return { ok: false, error: "加注至少 " + fullRaise };
      pay(t, p, need);
      if (to > t.currentBet) {
        var raiseSize = to - t.currentBet;
        if (raiseSize >= t.minRaise) {
          t.minRaise = raiseSize;
          // 完整加注会重新打开行动权和加注权
          t.players.forEach(function (q) {
            if (q.seat !== seat) { q.acted = false; q.canRaise = true; }
          });
        }
        t.currentBet = to;
        t.lastAggressor = seat;
      }
      p.lastAction = p.allIn ? "全下 " + to : "加到 " + to;
    } else {
      return { ok: false, error: "未知行动" };
    }

    p.acted = true;
    p.canRaise = false;

    // 只剩一个人没弃牌 → 直接收池
    var live = inHand(t);
    if (live.length === 1) return awardUncontested(t, live[0]);

    if (roundComplete(t)) return advance(t);

    t.turn = nextSeat(t, seat, function (q) { return !q.folded && !q.allIn && q.stack > 0; });
    if (t.turn < 0) return advance(t);
    return { ok: true };
  }

  function roundComplete(t) {
    var act = actionable(t);
    if (act.length === 0) return true;
    return act.every(function (p) {
      return p.acted && p.bet === t.currentBet;
    });
  }

  function advance(t) {
    // 河牌后摊牌
    if (t.phase === "river") return showdown(t);

    var act = actionable(t);
    // 所有人全下：把剩余的牌一次发完再摊牌
    if (act.length <= 1) {
      while (t.board.length < 5) t.board.push(t.deck.pop());
      return showdown(t);
    }

    var nextPhase = { preflop: "flop", flop: "turn", turn: "river", river: "showdown" }[t.phase];
    if (nextPhase === "flop") { t.board.push(t.deck.pop(), t.deck.pop(), t.deck.pop()); }
    else { t.board.push(t.deck.pop()); }

    t.players.forEach(function (p) { p.bet = 0; p.acted = false; p.lastAction = ""; p.canRaise = true; });
    t.currentBet = 0;
    t.minRaise = t.cfg.bb;
    t.lastAggressor = -1;
    t.phase = nextPhase;

    t.turn = nextSeat(t, t.dealer, function (p) { return !p.folded && !p.allIn && p.stack > 0; });
    if (t.turn < 0) return advance(t);
    return { ok: true };
  }

  function awardUncontested(t, winner) {
    var amount = t.pot;
    winner.stack += amount;
    t.pot = 0;
    t.result = {
      type: "fold",
      pot: amount,
      winners: [{ seat: winner.seat, name: winner.name, amount: amount, label: "其他人都弃牌" }],
      showdown: []
    };
    t.log.push(winner.name + " 赢得 " + amount);
    t.phase = "handover";
    t.turn = -1;
    return { ok: true };
  }

  // 边池：按投入额分层，每层只由投满该层且未弃牌的人竞争
  function buildPots(t) {
    var levels = [];
    t.players.forEach(function (p) {
      if (p.totalBet > 0 && levels.indexOf(p.totalBet) < 0) levels.push(p.totalBet);
    });
    levels.sort(function (a, b) { return a - b; });
    var pots = [], prev = 0;
    levels.forEach(function (lvl) {
      var amount = 0, contributors = [];
      t.players.forEach(function (p) {
        var part = Math.max(0, Math.min(p.totalBet, lvl) - Math.min(p.totalBet, prev));
        if (part > 0) { amount += part; contributors.push({ p: p, amount: part }); }
      });
      var eligible = t.players.filter(function (p) { return !p.folded && p.totalBet >= lvl; });
      if (amount > 0) pots.push({ amount: amount, eligible: eligible, contributors: contributors });
      prev = lvl;
    });
    return pots;
  }

  function showdown(t) {
    while (t.board.length < 5) t.board.push(t.deck.pop());
    var contenders = inHand(t);
    var scored = contenders.map(function (p) {
      var s = evaluate7(p.hole.concat(t.board));
      return { p: p, score: s, label: scoreLabel(s) };
    });

    var pots = buildPots(t);
    var gains = {};
    pots.forEach(function (pot) {
      // 高额层没有存活竞争者（加注者弃牌且无人跟到该额度）：退还这部分
      if (!pot.eligible.length) {
        pot.contributors.forEach(function (c) { c.p.stack += c.amount; });
        return;
      }
      var best = null;
      var winners = [];
      pot.eligible.forEach(function (p) {
        var s = scored.filter(function (x) { return x.p.seat === p.seat; })[0];
        if (!s) return;
        if (!best || compareScore(s.score, best) > 0) { best = s.score; winners = [s]; }
        else if (compareScore(s.score, best) === 0) winners.push(s);
      });
      if (!winners.length) return;
      var share = Math.floor(pot.amount / winners.length);
      var remainder = pot.amount - share * winners.length;
      winners.forEach(function (w, i) {
        var got = share + (i === 0 ? remainder : 0);
        gains[w.p.seat] = (gains[w.p.seat] || 0) + got;
      });
    });

    var winnersOut = Object.keys(gains).map(function (seat) {
      var s = scored.filter(function (x) { return x.p.seat === Number(seat); })[0];
      return { seat: Number(seat), name: s.p.name, amount: gains[seat], label: s.label };
    }).sort(function (a, b) { return b.amount - a.amount; });

    Object.keys(gains).forEach(function (seat) {
      t.players[Number(seat)].stack += gains[seat];
    });

    var amount = t.pot;
    t.pot = 0;
    t.result = {
      type: "showdown",
      pot: amount,
      winners: winnersOut,
      showdown: scored.map(function (x) {
        return { seat: x.p.seat, name: x.p.name, hole: x.p.hole.slice(), label: x.label, folded: x.p.folded };
      })
    };
    t.log.push("摊牌：" + winnersOut.map(function (w) { return w.name + " " + w.label; }).join("；"));
    t.phase = "handover";
    t.turn = -1;
    return { ok: true };
  }

  // 下一手：全员出局检查
  function nextHand(t) {
    var live = alive(t);
    t.players.forEach(function (p) { p.out = p.stack <= 0; });
    if (live.length < 2) {
      t.phase = "handover";
      t.result = { type: "gameover", winners: [], showdown: [] };
      return t;
    }
    return startHand(t);
  }

  return {
    RANK_CHARS: RANK_CHARS,
    SUIT_CHARS: SUIT_CHARS,
    CAT_NAMES: CAT_NAMES,
    makeDeck: makeDeck,
    shuffle: shuffle,
    cardText: cardText,
    rankOf: rankOf,
    suitOf: suitOf,
    isRed: isRed,
    evaluate5: evaluate5,
    evaluate7: evaluate7,
    compareScore: compareScore,
    scoreLabel: scoreLabel,
    createTable: createTable,
    startHand: startHand,
    nextHand: nextHand,
    legalActions: legalActions,
    act: act,
    inHand: inHand,
    actionable: actionable,
    alive: alive,
    buildPots: buildPots
  };
});
