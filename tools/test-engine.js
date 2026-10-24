/* 规则引擎回归测试：node tools/test-engine.js
   覆盖牌型比较、边池、单挑盲注顺序、全下、随机对局不变量。 */
"use strict";
const P = require("../js/poker.js");

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.log("FAIL " + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + " (got " + a + ", want " + b + ")"); }

/* 牌字符串 → {r,s}，例如 "As" "Td" "9h" */
const SUIT_IDX = { s: 0, h: 1, d: 2, c: 3 };
function card(str) {
  return { r: P.RANK_CHARS.indexOf(str[0]), s: SUIT_IDX[str[1]] };
}
function hand(str) { return str.split(" ").map(card); }

/* ---------- 牌型 ---------- */
ok(P.evaluate5(hand("As Ks Qs Js Ts")).cat === 8, "皇家同花顺 = cat 8");
eq(P.scoreLabel(P.evaluate5(hand("As Ks Qs Js Ts"))), "皇家同花顺", "皇家同花顺文案");
ok(P.compareScore(P.evaluate5(hand("As Ks Qs Js Ts")), P.evaluate5(hand("9s 8s 7s 6s 5s"))) > 0, "同花顺比大小");

const wheel = P.evaluate5(hand("As 2d 3h 4c 5s"));
eq(wheel.cat, 4, "A2345 是顺子");
eq(wheel.tie[0], 3, "A2345 以 5 为高");
ok(P.compareScore(P.evaluate5(hand("6s 2d 3h 4c 5s")), wheel) > 0, "6 高顺 > 5 高顺");

eq(P.evaluate5(hand("Ah Ad Ac As Kd")).cat, 7, "四条");
eq(P.evaluate5(hand("Ah Ad Ac Ks Kd")).cat, 6, "葫芦");
eq(P.evaluate5(hand("Ah Kh 9h 5h 2h")).cat, 5, "同花");
eq(P.evaluate5(hand("Ah Ad Ac Ks Qd")).cat, 3, "三条");
eq(P.evaluate5(hand("Ah Ad Kc Ks Qd")).cat, 2, "两对");
eq(P.evaluate5(hand("Ah Ad Kc Qs Jd")).cat, 1, "一对");
eq(P.evaluate5(hand("Ah Kd Qc Js 9d")).cat, 0, "高牌");

ok(P.compareScore(P.evaluate5(hand("Ah Ad Kc Qs Jd")), P.evaluate5(hand("Ah Ad Kc Qs Td"))) > 0, "同对子比踢脚");
ok(P.compareScore(P.evaluate5(hand("Ah Ad Kc Ks Qd")), P.evaluate5(hand("Ah Ad Kc Ks Jd"))) > 0, "两对比踢脚");
ok(P.compareScore(P.evaluate5(hand("Kh Kd Kc 2s 2d")), P.evaluate5(hand("Qh Qd Qc As Ad"))) > 0, "葫芦比三条");
ok(P.compareScore(P.evaluate5(hand("Ah Ad Kc Ks Qd")), P.evaluate5(hand("Ah Ad Kc Qs Qd"))) > 0, "两对比最大对");

// 7 选 5
const seven = P.evaluate7(hand("Ah Kh Qh Jh Th 2c 3d"));
eq(seven.cat, 8, "7 张里找到同花顺");
eq(seven.best.length, 5, "返回 5 张最佳");
const twoPair7 = P.evaluate7(hand("Ah Ad Kc Ks 2d 3c 4h"));
eq(twoPair7.cat, 2, "7 张两对");
ok(P.compareScore(twoPair7, P.evaluate7(hand("Ah Ad Qc Qs 2d 3c 4h"))) > 0, "7 张两对比较");

/* ---------- 边池 ---------- */
function fakeTable(bets, folded) {
  const t = P.createTable({ seats: bets.length, stack: 10000 });
  t.players.forEach(function (p, i) {
    p.totalBet = bets[i];
    p.folded = !!folded[i];
    p.stack = 10000 - bets[i];
    p.hole = hand("2c 7d");
  });
  t.board = hand("As Kd Qh Jc 9s");
  return t;
}
let ft = fakeTable([100, 300, 500], [false, false, false]);
let pots = P.buildPots(ft);
eq(pots.length, 3, "三层边池");
eq(pots[0].amount, 300, "主池 = 100×3");
eq(pots[1].amount, 400, "边池 2 = 200×2");
eq(pots[2].amount, 200, "边池 3 = 200×1");
eq(pots[2].eligible.length, 1, "最高层只有一人有资格");

// 弃牌者的高额部分不能凭空消失（记录 contributors，供摊牌时退回）
ft = fakeTable([500, 500, 1000], [false, false, true]);
pots = P.buildPots(ft);
const voidPot = pots[pots.length - 1];
eq(voidPot.eligible.length, 0, "弃牌者的超额层没有竞争者");
eq(voidPot.amount, 500, "超额层金额");
eq(voidPot.contributors.length, 1, "超额层只有弃牌者本人出资");
eq(voidPot.contributors[0].p.seat, 2, "退款对象是弃牌者");
eq(pots.reduce(function (s, p) { return s + p.amount; }, 0), 2000, "所有层金额合计等于总投入");

/* ---------- 单挑：庄家=小盲，翻前先动；翻后大盲先动 ---------- */
function headsUpTable() {
  const t = P.createTable({ seats: 2, stack: 1000, sb: 10, bb: 20 });
  // 直接把庄家设成 0，避免轮转噪音
  t.dealer = 1; // 下一手轮到 0
  P.startHand(t);
  return t;
}
let hu = headsUpTable();
eq(hu.dealer, 0, "单挑庄家");
eq(hu.players[0].bet, 10, "单挑庄家下小盲");
eq(hu.players[1].bet, 20, "对手下大盲");
eq(hu.turn, 0, "单挑翻前庄家先行动");
P.act(hu, 0, { type: "call" });
P.act(hu, 1, { type: "check" });
eq(hu.phase, "flop", "翻牌");
eq(hu.turn, 1, "单挑翻后大盲先行动");

/* ---------- 加注规则 ---------- */
let t3 = P.createTable({ seats: 3, stack: 1000, sb: 10, bb: 20 });
t3.dealer = 2; // 下一手轮到 0 做庄：顺序 0 庄、1 小盲、2 大盲
P.startHand(t3);
eq(t3.turn, 0, "三人桌翻前 UTG（庄家）先行动");
const L0 = P.legalActions(t3, 0);
eq(L0.toCall, 20, "UTG 需跟 20");
eq(L0.minTo, 40, "最小加注到 40");
ok(!P.act(t3, 0, { type: "raise", to: 30 }).ok, "低于最小加注被拒绝");
ok(P.act(t3, 0, { type: "raise", to: 60 }).ok, "合法加注到 60");
eq(t3.minRaise, 40, "加注后最小加注额 = 40");
ok(P.act(t3, 1, { type: "raise", to: 100 }).ok, "再加注到 100");
eq(t3.minRaise, 40, "加注额 40");

// 全下不足一个完整加注时，不重新打开加注权
let t4 = P.createTable({ seats: 3, stack: 1000, sb: 10, bb: 20 });
t4.dealer = 2;
P.startHand(t4);
P.act(t4, 0, { type: "raise", to: 100 });   // 完整加注 80
P.act(t4, 1, { type: "call" });
t4.players[2].stack = 130;                  // 大盲再补 130，全下到 150（加价 50 < 最小加注 80）
const short = P.act(t4, 2, { type: "allin" });
ok(short.ok, "短码全下被接受");
eq(t4.currentBet, 150, "不足额全下把注额推到 150");
eq(t4.minRaise, 80, "最小加注额不变");
// 0 号和 1 号都只差 50，可以跟，但不能再加注
const L1 = P.legalActions(t4, 0);
eq(L1.toCall, 50, "0 号还差 50");
eq(L1.canRaise, false, "不足额全下后，已行动过的人没有加注权");
eq(P.legalActions(t4, 1).canRaise, false, "1 号同样不能加注");
ok(P.act(t4, 0, { type: "raise", to: 300 }).ok === false, "强行加注被拒绝");
ok(P.act(t4, 0, { type: "call" }).ok, "跟注仍然可以");
eq(t4.phase, "preflop", "还有玩家未行动");
ok(P.act(t4, 1, { type: "call" }).ok, "1 号也能跟注");
eq(t4.phase, "flop", "跟注后进入翻牌");
eq(P.legalActions(t4, 1).canRaise, true, "新街重新拥有加注权");

/* ---------- 随机对局浸泡测试 ---------- */
function randAction(t, seat) {
  const L = P.legalActions(t, seat);
  const r = Math.random();
  if (L.canRaise && r < 0.06) return { type: "allin" };
  if (L.canRaise && r < 0.25) {
    const steps = Math.floor(Math.random() * 4);
    return { type: "raise", to: Math.min(L.maxTo, L.minTo + steps * L.raiseStep) };
  }
  if (L.canCheck) return r < 0.93 ? { type: "check" } : { type: "fold" };
  return r < 0.86 ? { type: "call" } : { type: "fold" };
}

function soak(hands, label, seats) {
  const t = P.createTable({ seats: seats || 6, stack: 2000, sb: 10, bb: 20 });
  const totalChips = t.players.reduce(function (s, p) { return s + p.stack; }, 0);
  let played = 0;
  for (let h = 0; h < hands; h++) {
    if (P.alive(t).length < 2) {
      t.players.forEach(function (p) { p.stack = 2000; p.out = false; });
    }
    P.startHand(t);
    if (t.phase === "handover") continue;
    played++;
    let steps = 0;
    while (t.phase !== "handover") {
      if (++steps > 4000) { ok(false, label + " 手牌 #" + h + " 无法结束"); return; }
      const seat = t.turn;
      ok(seat >= 0, label + " 回合座位有效");
      if (seat < 0) return;
      const p = t.players[seat];
      ok(!p.folded && !p.allIn && p.stack > 0, label + " 行动者状态正常");
      const before = p.stack;
      const res = P.act(t, seat, randAction(t, seat));
      ok(res.ok, label + " 随机行动被接受: " + (res.error || ""));
      if (!res.ok) return;
      ok(p.stack >= 0, label + " 筹码不为负");
      if (t.phase !== "handover") {
        ok(p.stack <= before, label + " 行动不会凭空给筹码");

        // 不变量：桌上总筹码守恒
        const onTable = t.players.reduce(function (s, q) { return s + q.stack; }, 0);
        eq(onTable + t.pot, totalChips, label + " 筹码守恒");
        const inBets = t.players.reduce(function (s, q) { return s + q.totalBet; }, 0);
        eq(inBets, t.pot, label + " 底池等于累计投入");
      }

      // 牌不重复
      const seen = new Set();
      let dup = false;
      t.players.forEach(function (q) {
        q.hole.forEach(function (c) {
          const k = c.r + "-" + c.s;
          if (seen.has(k)) dup = true;
          seen.add(k);
        });
      });
      t.board.forEach(function (c) {
        const k = c.r + "-" + c.s;
        if (seen.has(k)) dup = true;
        seen.add(k);
      });
      t.deck.forEach(function (c) {
        const k = c.r + "-" + c.s;
        if (seen.has(k)) dup = true;
        seen.add(k);
      });
      ok(!dup, label + " 牌不重复");
      eq(seen.size, 52, label + " 52 张牌齐全");
    }
    ok(t.pot === 0, label + " 结算后底池归零");
    ok(!!t.result, label + " 有结算结果");
    const end = t.players.reduce(function (s, q) { return s + q.stack; }, 0);
    eq(end, totalChips, label + " 结算后总筹码守恒");
  }
  ok(played > hands * 0.9, label + " 完成的对局数充足 (" + played + "/" + hands + ")");
}

soak(200, "六人桌");
soak(120, "九人桌", 9);

/* 单挑浸泡 */
function soakHeadsUp(hands) {
  const t = P.createTable({ seats: 2, stack: 1500, sb: 10, bb: 20 });
  const totalChips = 3000;
  for (let h = 0; h < hands; h++) {
    if (P.alive(t).length < 2) {
      t.players.forEach(function (p) { p.stack = 1500; p.out = false; });
    }
    P.startHand(t);
    let steps = 0;
    while (t.phase !== "handover" && steps++ < 3000) {
      const seat = t.turn;
      if (seat < 0) break;
      if (!P.act(t, seat, randAction(t, seat)).ok) break;
    }
    const end = t.players.reduce(function (s, q) { return s + q.stack; }, 0);
    eq(end + t.pot, totalChips, "单挑筹码守恒 #" + h);
  }
}
soakHeadsUp(100);

/* 短码盲注全下：不应卡死 */
for (let i = 0; i < 50; i++) {
  const t = P.createTable({ seats: 6, stack: 2000, sb: 10, bb: 20 });
  t.players.forEach(function (p, i) {
    if (i > 0) p.stack = 5 + Math.floor(Math.random() * 60);
  });
  const total = t.players.reduce(function (s, q) { return s + q.stack; }, 0);
  P.startHand(t);
  let steps = 0;
  while (t.phase !== "handover" && steps++ < 500) {
    if (t.turn < 0) { ok(false, "短码局出现无行动者"); break; }
    if (!P.act(t, t.turn, randAction(t, t.turn)).ok) { ok(false, "短码局行动被拒"); break; }
  }
  ok(t.phase === "handover", "短码局能正常结束");
  eq(t.players.reduce(function (s, q) { return s + q.stack; }, 0), total, "短码局筹码守恒");
}

console.log("\n" + (fail ? "FAILED" : "OK") + "  " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
