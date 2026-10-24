/* ============================================================
   game.js — 五套原型共用的牌局交互
   ============================================================ */

(function () {
  "use strict";

  var RING = 119.38;          // 2πr, r=19
  var TURN_SECONDS = 15;
  var QUICK = {
    half: 0.5,
    three: 2 / 3,
    pot: 1
  };

  function fmt(n) {
    return Math.round(n).toLocaleString("en-US");
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  document.querySelectorAll(".app").forEach(function (app) {
    var el = {
      pot: app.querySelector(".js-pot"),
      stack: app.querySelector(".js-stack"),
      strength: app.querySelector(".js-strength"),
      callAmt: app.querySelector(".js-call-amt"),
      raiseAmts: app.querySelectorAll(".js-raise-amt"),
      range: app.querySelector(".js-raise-range"),
      potFinal: app.querySelector(".js-pot-final"),
      call: app.querySelector(".js-call"),
      raiseBtn: app.querySelector(".js-raise-btn"),
      fold: app.querySelector(".js-fold"),
      next: app.querySelector(".js-next"),
      toast: app.querySelector(".js-toast"),
      board: app.querySelector(".js-board"),
      timer: app.querySelector(".js-timer"),
      timerNum: app.querySelector(".js-timer-num"),
      resultTitle: app.querySelector(".result-title"),
      resultSub: app.querySelector(".js-result-sub")
    };

    var title0 = el.resultTitle.textContent;

    var S = {
      pot0: +app.dataset.pot,
      stack0: +app.dataset.stack,
      toCall: +app.dataset.tocall,
      pot: +app.dataset.pot,
      stack: +app.dataset.stack,
      raise: 0,
      range0: +el.range.value,
      phase: "action",
      time: TURN_SECONDS,
      tick: null,
      toastTimer: null
    };

    /* ---------- 加注额换算 ---------- */

    function amountFromRange(v) {
      var head = S.stack - S.toCall;
      if (head <= 0) return S.stack;
      return Math.round(S.toCall + (v / 100) * head);
    }

    function rangeFromAmount(a) {
      var head = S.stack - S.toCall;
      if (head <= 0) return 0;
      return clamp(((a - S.toCall) / head) * 100, 0, 100);
    }

    function paintRaise() {
      el.raiseAmts.forEach(function (n) { n.textContent = fmt(S.raise); });
      el.potFinal.textContent = fmt(S.pot + S.raise);
    }

    function setRaise(amount) {
      S.raise = clamp(Math.round(amount), S.toCall, S.stack);
      el.range.value = rangeFromAmount(S.raise);
      paintRaise();
    }

    /* ---------- 提示条 ---------- */

    function toast(msg, dur) {
      el.toast.textContent = msg;
      el.toast.classList.add("is-on");
      clearTimeout(S.toastTimer);
      S.toastTimer = setTimeout(function () {
        el.toast.classList.remove("is-on");
      }, dur || 1800);
    }

    /* ---------- 计时器 ---------- */

    function paintTimer() {
      var ratio = S.time / TURN_SECONDS;
      el.timer.style.strokeDashoffset = (1 - ratio) * RING;
      el.timerNum.textContent = S.time;
      el.timer.style.stroke = S.time <= 5 ? "var(--danger)" : "";
    }

    function stopTimer() {
      clearInterval(S.tick);
      S.tick = null;
    }

    function startTimer() {
      stopTimer();
      S.time = TURN_SECONDS;
      paintTimer();
      S.tick = setInterval(function () {
        S.time -= 1;
        if (S.time <= 0) {
          S.time = 0;
          paintTimer();
          stopTimer();
          doFold(true);
          return;
        }
        paintTimer();
      }, 1000);
    }

    /* ---------- 座位轮转 ---------- */

    function moveTurn(fromSel, toSel) {
      var from = app.querySelector(fromSel);
      var to = app.querySelector(toSel);
      if (from) from.classList.remove("is-turn");
      if (to) to.classList.add("is-turn");
    }

    /* ---------- 行动 ---------- */

    function doFold(timeout) {
      if (S.phase !== "action") return;
      S.phase = "folded";
      stopTimer();
      app.classList.add("is-folded");
      el.call.disabled = true;
      el.raiseBtn.disabled = true;
      moveTurn(".seat--d", ".seat--e");
      el.resultTitle.textContent = "你已弃牌";
      el.resultSub.textContent = "底池 " + fmt(S.pot) + " · 本手未跟注";
      toast(timeout ? "超时 · 自动弃牌" : "你弃牌了");
    }

    function doAct(kind) {
      if (S.phase !== "action") return;
      var amount = kind === "call" ? S.toCall : S.raise;
      S.stack = Math.max(0, S.stack - amount);
      S.pot += amount;
      el.pot.textContent = fmt(S.pot);
      el.stack.textContent = fmt(S.stack);
      stopTimer();
      S.phase = "acting";

      moveTurn(".seat--d", ".seat--e");
      toast(kind === "call" ? "跟注 " + fmt(S.toCall) : "加注至 " + fmt(S.raise), 1500);

      setTimeout(function () {
        var slot = el.board.querySelector(".card--empty");
        if (slot) {
          slot.classList.remove("card--empty");
          slot.classList.add("is-dealing");
          slot.innerHTML =
            '<span class="c-rank">' + app.dataset.river + "</span>" +
            '<span class="c-suit">' + app.dataset.riverSuit + "\uFE0E" + "</span>";
          if (app.dataset.riverSuit === "♥" || app.dataset.riverSuit === "♦") {
            slot.classList.add("is-red");
          }
        }
      }, 480);

      setTimeout(function () {
        toast("河牌 " + app.dataset.river + app.dataset.riverSuit, 1600);
        el.strength.textContent = app.dataset.final;
      }, 1250);

      setTimeout(function () {
        S.phase = "done";
        app.classList.add("is-done");
        el.call.disabled = true;
        el.raiseBtn.disabled = true;
        el.resultTitle.textContent = title0;
        el.resultSub.textContent = "底池 " + fmt(S.pot) + " · " + app.dataset.final;
      }, 2200);
    }

    function reset() {
      stopTimer();
      S.pot = S.pot0;
      S.stack = S.stack0;
      S.phase = "action";
      S.time = TURN_SECONDS;
      app.classList.remove("is-done", "is-folded");
      el.pot.textContent = fmt(S.pot);
      el.stack.textContent = fmt(S.stack);
      el.strength.textContent = app.dataset.strength;
      el.call.disabled = false;
      el.raiseBtn.disabled = false;
      el.resultTitle.textContent = title0;

      var slot = el.board.querySelector(".card:last-child");
      if (slot) {
        slot.className = "card card--empty";
        slot.innerHTML = "";
      }
      moveTurn(".seat--e", ".seat--d");
      setRaise(Math.min(S.toCall * 2, S.stack));
      startTimer();
      toast("新一手开始", 1400);
    }

    /* ---------- 绑定 ---------- */

    el.range.addEventListener("input", function () {
      setRaise(amountFromRange(+el.range.value));
    });

    el.call.addEventListener("click", function () { doAct("call"); });
    el.raiseBtn.addEventListener("click", function () { doAct("raise"); });
    el.fold.addEventListener("click", function () { doFold(false); });
    el.next.addEventListener("click", reset);

    app.querySelectorAll(".js-quick").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var q = chip.dataset.q;
        var target;
        if (q === "all") {
          target = S.stack;
        } else {
          target = S.toCall + S.pot * QUICK[q];
        }
        setRaise(target);
      });
    });

    setRaise(Math.min(S.toCall * 2, S.stack));
    paintTimer();
    startTimer();
  });

  /* ---------- 画廊导航 ---------- */

  document.querySelectorAll(".legend button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = document.getElementById(btn.dataset.target);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      document.querySelectorAll(".legend button").forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
      });
    });
  });
})();
