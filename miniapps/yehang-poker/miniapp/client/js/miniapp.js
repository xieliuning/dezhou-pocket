/* ============================================================
   miniapp.js — 夜航俱乐部德州扑克 Mini App 外壳控制器
   负责：视图切换、桌主控制台、服务器设置、跨视图风格同步。
   牌局逻辑仍在 room.js（联机）与 single.js（单机）里。
   ============================================================ */
(function () {
  "use strict";

  var STYLE_KEY = "holdem.style";

  var els = {
    tabs: document.querySelectorAll(".mtab"),
    views: document.querySelectorAll(".mview"),
    dot: document.getElementById("m-dot"),
    stateText: document.getElementById("m-state-text"),
    code: document.getElementById("mc-code"),
    phase: document.getElementById("mc-phase"),
    seats: document.getElementById("mc-seats"),
    hand: document.getElementById("mc-hand"),
    blind: document.getElementById("mc-blind"),
    pot: document.getElementById("mc-pot"),
    roster: document.getElementById("mc-roster"),
    link: document.getElementById("mc-link"),
    roomcode: document.getElementById("mc-roomcode"),
    inviteNote: document.getElementById("mc-invite-note"),
    upstream: document.getElementById("ms-upstream"),
    msStatus: document.getElementById("ms-status"),
    msForm: document.getElementById("ms-form"),
    msTest: document.getElementById("ms-test"),
    solo: document.querySelector(".js-solo")
  };

  var boot = readBootstrap();
  window.YEHANG = boot;
  var upstream = boot.upstream || "";
  var lastState = null;
  var connected = false;

  /* ---------------- 启动配置 ---------------- */

  function readBootstrap() {
    var fallback = { upstream: "", wsPath: "/ws" };
    var node = document.getElementById("yehang-config");
    if (!node) return fallback;
    try {
      var parsed = JSON.parse(node.textContent || "{}");
      return {
        upstream: typeof parsed.upstream === "string" ? parsed.upstream : "",
        wsPath: typeof parsed.wsPath === "string" ? parsed.wsPath : "/ws"
      };
    } catch (e) {
      return fallback;
    }
  }

  /* ---------------- 视图切换 ---------------- */

  function activate(name) {
    var found = false;
    Array.prototype.forEach.call(els.views, function (view) {
      if (view.dataset.view === name) found = true;
      view.classList.toggle("is-active", view.dataset.view === name);
    });
    if (!found) return;
    Array.prototype.forEach.call(els.tabs, function (tab) {
      var on = tab.dataset.tab === name;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", on ? "true" : "false");
    });
    try { localStorage.setItem("yehang.tab", name); } catch (e) { /* ignore */ }
  }

  Array.prototype.forEach.call(els.tabs, function (tab) {
    tab.addEventListener("click", function () { activate(tab.dataset.tab); });
  });

  if (els.solo) {
    els.solo.addEventListener("click", function () { activate("practice"); });
  }

  var initialTab = "room";
  try {
    var savedTab = localStorage.getItem("yehang.tab");
    if (savedTab) initialTab = savedTab;
  } catch (e) { /* ignore */ }
  activate(initialTab);

  /* ---------------- 顶部连接状态 ---------------- */

  function setConn(state, text) {
    connected = state === "ok";
    els.dot.setAttribute("data-state", state);
    els.stateText.textContent = text;
  }

  document.addEventListener("holdem:conn", function (e) {
    var detail = e.detail || {};
    if (detail.connected) {
      setConn("ok", lastState ? "已连接 · 房间 " + lastState.code : "已连接牌局服务器");
    } else {
      setConn("err", "未连接到牌局服务器");
    }
  });

  /* ---------------- 桌主控制台 ---------------- */

  document.addEventListener("holdem:state", function (e) {
    lastState = e.detail || null;
    renderConsole(lastState);
    if (connected) {
      els.stateText.textContent = "已连接 · 房间 " + (lastState.code || "");
    }
  });

  function renderConsole(S) {
    if (!S || !els.roster) return;
    var code = S.code || "····";
    els.code.textContent = code;
    els.phase.textContent = phaseText(S);

    var seated = 0;
    for (var i = 0; i < S.seats.length; i++) if (S.seats[i].occupied) seated++;
    els.seats.textContent = seated + " / " + (S.spectators || 0);
    els.hand.textContent = S.phase === "lobby" ? "尚未开始" : "第 " + Math.max(1, S.handNo) + " 手";
    els.blind.textContent = S.cfg ? S.cfg.sb + " / " + S.cfg.bb : "— / —";
    els.pot.textContent = "底池 " + fmt(S.pot || 0);

    renderRoster(S);

    var link = inviteLink(code);
    els.link.value = link;
    els.roomcode.value = code;
    els.inviteNote.textContent = upstream
      ? "链接指向 " + upstream + "，朋友点开就能上桌。"
      : "还没有配置牌局服务器地址，先到「服务器」页填一个。";
  }

  function phaseText(S) {
    if (S.phase === "lobby") return "等待开局";
    if (S.phase === "handover") return "本手结束";
    if (S.phase === "idle") return "空闲";
    return "进行中 · 第 " + Math.max(1, S.handNo) + " 手";
  }

  function renderRoster(S) {
    var files = window.YEHANG_AVATARS || [];
    var html = "";
    for (var i = 0; i < S.seats.length; i++) {
      var p = S.seats[i];
      if (!p.occupied) {
        html += '<div class="mroster-row is-empty">'
          + '<span class="mroster-seat">' + (i + 1) + '</span>'
          + '<span class="mroster-name">空位</span>'
          + '<span class="mroster-stack">待入座</span>'
          + '</div>';
        continue;
      }
      var file = files.length ? files[p.avatar % files.length] : "";
      html += '<div class="mroster-row' + (p.online ? "" : " is-offline") + '">'
        + (file ? '<img src="assets/avatars/' + file + '" alt="">' : "")
        + '<span class="mroster-name">' + escapeHTML(p.name) + '</span>'
        + (p.host ? '<span class="mroster-tag" data-tone="host">庄家</span>' : "")
        + (p.me ? '<span class="mroster-tag" data-tone="me">你</span>' : "")
        + '<span class="mroster-stack">' + (p.out ? "出局" : fmt(p.stack)) + '</span>'
        + '</div>';
    }
    els.roster.innerHTML = html;
  }

  function inviteLink(code) {
    if (!upstream || !code || code === "····") return "还没有房间";
    return upstream.replace(/\/+$/, "") + "/room.html?room=" + code;
  }

  /* ---------------- 复制 ---------------- */

  function copyText(text, okMsg) {
    if (!text || text === "还没有房间") return;
    var fallback = function () {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) flash(okMsg);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { flash(okMsg); }, fallback);
      return;
    }
    fallback();
  }

  function flash(msg) {
    var node = els.msStatus;
    if (!node) return;
    node.hidden = false;
    node.setAttribute("data-tone", "ok");
    node.textContent = msg;
    setTimeout(function () {
      if (node.textContent === msg) node.hidden = true;
    }, 2400);
  }

  var copyLink = document.getElementById("mc-copy-link");
  var copyLink2 = document.getElementById("mc-copy-link-2");
  var copyCode = document.getElementById("mc-copy-code");
  if (copyLink) copyLink.addEventListener("click", function () { copyText(els.link.value, "邀请链接已复制，发到群里即可"); });
  if (copyLink2) copyLink2.addEventListener("click", function () { copyText(els.link.value, "邀请链接已复制，发到群里即可"); });
  if (copyCode) copyCode.addEventListener("click", function () { copyText(els.roomcode.value, "房间号已复制"); });

  /* ---------------- 服务器设置 ---------------- */

  function setStatus(text, tone) {
    var node = els.msStatus;
    if (!node) return;
    node.hidden = false;
    node.textContent = text;
    if (tone) node.setAttribute("data-tone", tone);
    else node.removeAttribute("data-tone");
  }

  function loadConfig() {
    fetch("/api/config", { headers: { accept: "application/json" } })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        upstream = data.upstream || "";
        if (els.upstream) els.upstream.value = upstream;
      })
      .catch(function () {
        setStatus("读取服务器配置失败", "err");
      });
  }

  if (els.msForm) {
    els.msForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var value = els.upstream.value.trim();
      setStatus("正在连接…", "");
      fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ upstream: value })
      })
        .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
        .then(function (result) {
          if (!result.ok) {
            setStatus(result.data.message || "地址无效", "err");
            return;
          }
          upstream = result.data.upstream || "";
          els.upstream.value = upstream;
          var health = result.data.health || {};
          if (health.ok) {
            setStatus("已连接：" + (health.detail || "牌局服务器可达"), "ok");
            window.YEHANG.upstream = upstream;
            document.dispatchEvent(new CustomEvent("holdem:reconfigure"));
          } else {
            setStatus("地址已保存，但连不上：" + (health.detail || "未知原因"), "err");
          }
        })
        .catch(function (err) {
          setStatus("保存失败：" + (err && err.message ? err.message : "未知错误"), "err");
        });
    });
  }

  if (els.msTest) {
    els.msTest.addEventListener("click", function () {
      setStatus("正在测试连接…", "");
      fetch("/api/health", { headers: { accept: "application/json" } })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var health = data.health || {};
          setStatus(
            (health.ok ? "连接正常：" : "连接失败：") + (health.detail || "") +
              "（当前地址 " + (data.upstream || "未设置") + "）",
            health.ok ? "ok" : "err"
          );
        })
        .catch(function () { setStatus("测试失败，无法访问 Mini App 服务", "err"); });
    });
  }

  /* ---------------- 跨视图风格同步 ---------------- */

  function styleKeys() {
    var keys = {};
    Array.prototype.forEach.call(document.querySelectorAll(".style-chip"), function (chip) {
      if (chip.dataset && chip.dataset.key) keys[chip.dataset.key] = true;
    });
    Array.prototype.forEach.call(document.querySelectorAll(".app"), function (app) {
      Array.prototype.forEach.call(app.classList, function (cls) {
        if (/^s-[a-z0-9-]+$/.test(cls)) keys[cls] = true;
      });
    });
    return Object.keys(keys);
  }

  function styleName(key) {
    var chip = document.querySelector('.style-chip[data-key="' + key + '"]');
    if (!chip) return "";
    var name = chip.querySelector(".chip-name");
    return name ? name.textContent : "";
  }

  function applyStyleEverywhere(key) {
    if (!key) return;
    var keys = styleKeys();
    Array.prototype.forEach.call(document.querySelectorAll(".app"), function (app) {
      keys.forEach(function (k) { app.classList.remove(k); });
      app.classList.add(key);
    });
    try { localStorage.setItem(STYLE_KEY, key); } catch (e) { /* ignore */ }
    var name = styleName(key);
    Array.prototype.forEach.call(document.querySelectorAll(".js-style-now"), function (node) {
      if (name) node.textContent = name;
    });
    Array.prototype.forEach.call(document.querySelectorAll(".style-chip"), function (chip) {
      chip.classList.toggle("is-active", chip.dataset.key === key);
    });
  }

  document.addEventListener("click", function (e) {
    var chip = e.target && e.target.closest ? e.target.closest(".style-chip") : null;
    if (!chip || !chip.dataset || !chip.dataset.key) return;
    applyStyleEverywhere(chip.dataset.key);
  });

  /* ---------------- 工具 ---------------- */

  function fmt(n) {
    return Math.round(Number(n) || 0).toLocaleString("en-US");
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  loadConfig();
  setConn("idle", upstream ? "等待连接" : "未配置服务器");
})();
