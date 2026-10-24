/* ============================================================
   tools/verify.js — 原型自检工具
   node tools/verify.js vars            静态检查：每套 CSS 是否覆盖全部 50 个变量
   node tools/verify.js audit           生成 tools/_out/audit.html（布局 + 字体审计）
   node tools/verify.js shot s-pop,...  生成 tools/_out/<id>.html（单套渲染页）
   node tools/verify.js act             生成 tools/_out/act.html（交互链路探针）
   截图用 tools/snap.sh <id>
   ============================================================ */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "_out");
const REL = "../../"; // tools/_out/ → 仓库根

const VARS = `--bg --ink --muted --panel --line --accent --accent-ink --accent-soft
--card-bg --card-ink --suit-red --card-shadow
--radius-card --radius-av --radius-seat --radius-btn --radius-chip --radius-sm
--font-ui --font-display --font-num --font-card
--seat-bg --seat-line --seat-shadow --av-bg --av-ink
--bet-bg --bet-ink --bet-dot --bet-dot-ring
--dealer-bg --dealer-ink --danger --turn-line --turn-shadow
--timer-track --timer-fg --actions-bg --btn-bg --btn-ink
--track --thumb --thumb-ring --chip-bg --chip-ink
--toast-bg --toast-ink --result-bg --result-ink --result-line`
  .split(/\s+/)
  .filter(Boolean);

function ensureOut() {
  fs.mkdirSync(OUT, { recursive: true });
}

function readHtml() {
  return fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
}

function fontLinks(html) {
  return (html.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/g) || []).join("\n");
}

function cssFiles() {
  return fs.readdirSync(path.join(ROOT, "css")).filter((f) => f.endsWith(".css")).sort();
}

function sectionIds(html) {
  return [...html.matchAll(/<section class="phone" id="(s-[a-z0-9-]+)">/g)].map((m) => m[1]);
}

function sectionBlock(html, id) {
  const start = html.indexOf(`<section class="phone" id="${id}">`);
  if (start < 0) return null;
  const end = html.indexOf("</section>", start) + "</section>".length;
  return html.slice(start, end);
}

/* ---------- vars ---------- */

function cmdVars() {
  let bad = 0;
  const files = fs.readdirSync(path.join(ROOT, "css")).filter((f) => /^s\d+-.*\.css$/.test(f)).sort();
  for (const f of files) {
    const css = fs.readFileSync(path.join(ROOT, "css", f), "utf8");
    const defined = new Set();
    const re = /--([a-z0-9-]+)\s*:/gi;
    let m;
    while ((m = re.exec(css))) defined.add(m[1]);
    const missing = VARS.filter((v) => !defined.has(v.slice(2)));
    const cls = (css.match(/^\.s-[a-z0-9-]+\s*\{/m) || [])[0];
    if (missing.length) bad++;
    console.log(
      `${missing.length ? "FAIL" : "ok  "} ${f.padEnd(22)} vars=${defined.size}` +
        (cls ? `  cls=${cls.replace(/\s*\{/, "")}` : "  cls=??") +
        (missing.length ? `\n      MISSING: ${missing.join(" ")}` : "")
    );
  }
  console.log(bad ? `\n${bad} file(s) FAIL` : "\nAll files define all 50 variables.");
  process.exitCode = bad ? 1 : 0;
}

/* ---------- audit ---------- */

function cmdAudit() {
  ensureOut();
  const html = readHtml();
  const ids = sectionIds(html);
  const links = cssFiles().map((f) => `<link rel="stylesheet" href="${REL}css/${f}">`).join("\n");

  const page = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>audit</title>
${fontLinks(html)}
${links}
<style>
  body { background:#111; color:#0f0; font: 12px/1.5 monospace; padding:8px; }
  .phones { display:block !important; }
  .phone { display:none; }
  .phone.is-check { display:block; }
  #report { position: fixed; inset: 0; background:#000; color:#0f0; z-index: 9999;
            font: 13px/1.3 monospace; padding:8px; white-space:pre; overflow:hidden; }
</style>
</head><body>
<div class="phones">
${ids.map((id) => sectionBlock(html, id)).join("\n")}
</div>
<div id="report">running…</div>
<script>
(function () {
  var ids = ${JSON.stringify(ids)};
  var lines = [], bad = 0, allFams = {};
  function firstFam(el) {
    if (!el) return "?";
    return getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim();
  }
  function run() {
    ids.forEach(function (id) {
      var sec = document.getElementById(id);
      sec.classList.add("is-check");
      var app = sec.querySelector(".app");
      var r = app.getBoundingClientRect();
      var of = app.scrollWidth - app.clientWidth;
      var ofh = app.scrollHeight - app.clientHeight;
      var box = app.getBoundingClientRect();
      var fams = {
        room: firstFam(sec.querySelector(".room-name")),
        pot: firstFam(sec.querySelector(".pot")),
        card: firstFam(sec.querySelector(".card"))
      };
      Object.keys(fams).forEach(function (k) { allFams[fams[k]] = true; });
      var seatOut = 0;
      sec.querySelectorAll(".seat").forEach(function (s) {
        var sr = s.getBoundingClientRect();
        if (sr.left < box.left - 1 || sr.right > box.right + 1) seatOut++;
      });
      var br = sec.querySelector(".btn-row").getBoundingClientRect();
      var btnOut = br.right > box.right + 1 || br.left < box.left - 1;
      var ok = !(seatOut > 0 || btnOut || ofh > 0);
      if (!ok) bad++;
      lines.push((ok ? "ok  " : "FAIL") + " " + id.padEnd(11) +
        " " + Math.round(r.width) + "x" + Math.round(r.height) +
        " ovfW=" + of + " ovfH=" + ofh +
        " seatOut=" + seatOut +
        " btnOut=" + (btnOut ? "Y" : "n") +
        " " + fams.room + " | " + fams.pot + " | " + fams.card);
    });
    var famNames = Object.keys(allFams);
    Promise.all(famNames.map(function (f) {
      return document.fonts.load('16px "' + f + '"').then(function (r) {
        return { f: f, ok: r.length > 0 };
      }).catch(function () { return { f: f, ok: false }; });
    })).then(function (res) {
      var missing = res.filter(function (x) { return !x.ok; }).map(function (x) { return x.f; });
      lines.push("");
      lines.push("apps=" + ids.length + "  bad=" + bad);
      lines.push("font families used: " + famNames.join(", "));
      lines.push("NOT LOADED: " + (missing.length ? missing.join(", ") : "(none)"));
      document.getElementById("report").textContent = lines.join("\\n");
    });
  }
  // 先把 20 套全部显示出来，触发字体加载，再等 fonts.ready
  ids.forEach(function (id) { document.getElementById(id).classList.add("is-check"); });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      if (document.fonts.ready.then) return document.fonts.ready;
    }).then(run).catch(run);
  } else {
    window.addEventListener("load", run);
  }
})();
</script>
</body></html>`;

  fs.writeFileSync(path.join(OUT, "audit.html"), page);
  console.log("wrote tools/_out/audit.html");
}

/* ---------- shot ---------- */

function cmdShot(idsArg) {
  ensureOut();
  const html = readHtml();
  const ids = idsArg ? idsArg.split(",") : sectionIds(html);
  for (const id of ids) {
    const block = sectionBlock(html, id);
    if (!block) { console.log("MISSING SECTION", id); continue; }
    const styleFile = cssFiles().find((f) => {
      const m = /^s\d+-([a-z0-9]+)\.css$/.exec(f);
      return m && m[1] === id.slice(2);
    });
    const page = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${id}</title>
${fontLinks(html)}
<link rel="stylesheet" href="${REL}css/base.css">
<link rel="stylesheet" href="${REL}css/${styleFile}">
<style>
  body { padding: 14px 10px 20px; background: #08080a; }
  .phone-frame { margin: 0 auto; }
  /* 窄窗口下 base.css 的移动端媒体查询会把机身压到 88vh，单套截图统一按 375×812 渲染 */
  @media (max-width: 560px) { .phone-frame { height: 812px; } }
</style>
</head><body>
${block}
</body></html>`;
    fs.writeFileSync(path.join(OUT, `${id}.html`), page);
    console.log(`wrote tools/_out/${id}.html  (css/${styleFile})`);
  }
}

/* ---------- act ---------- */

function cmdAct() {
  ensureOut();
  const html = readHtml();
  const js = [
    "var L=[];",
    "function q(app,s){return app.querySelector(s);}",
    "function t(el){return el?el.textContent.trim():'(null)';}",
    "function n(s){return +String(s).replace(/[^0-9.\\-]/g,'');}",
    "var apps=[].slice.call(document.querySelectorAll('.app'));",
    "function report(){",
    " document.getElementById('r').textContent=L.join('\\n')+'\\napps='+apps.length+' bad='+L.filter(function(x){return x.indexOf('FAIL')===0;}).length+'\\nDONE';",
    "}",
    "apps.forEach(function(app){",
    " var id=app.closest('.phone').id;",
    " var chip=q(app,'.js-quick[data-q=pot]');",
    " var rng=q(app,'.js-raise-range');",
    " var raiseAmt=q(app,'.js-raise-amt');",
    " var potFinal=q(app,'.js-pot-final');",
    " var call=q(app,'.js-call');",
    " var next=q(app,'.js-next');",
    " var board=q(app,'.js-board');",
    " var pot0=t(q(app,'.js-pot'));",
    " var stack0=t(q(app,'.js-stack'));",
    " var raise0=t(raiseAmt);",
    " var potFinal0=t(potFinal);",
    " var err=[];",
    " if(chip) chip.click(); else err.push('no-quick-chip');",
    " if(rng){ rng.value=10; rng.dispatchEvent(new Event('input',{bubbles:true})); }",
    " var raiseAfter=t(raiseAmt);",
    " if(raiseAfter===raise0) err.push('raise-not-changed');",
    " if(t(potFinal)===potFinal0) err.push('pot-final-not-changed');",
    " if(rng && +rng.value!==10) err.push('range-stuck:'+rng.value);",
    " if(call) call.click(); else err.push('no-call');",
    " setTimeout(function(){",
    "  if(!app.classList.contains('is-done')) err.push('not-done');",
    "  var last=board?board.querySelector('.card:last-child'):null;",
    "  if(last && last.classList.contains('card--empty')) err.push('river-missing');",
    "  if(last && !t(last.querySelector('.c-rank'))) err.push('river-rank-empty');",
    "  var seatD=q(app,'.seat--d');",
    "  if(seatD && seatD.classList.contains('is-turn')) err.push('turn-not-moved');",
    "  if(call && !call.disabled) err.push('call-not-disabled');",
    "  if(next) next.click(); else err.push('no-next');",
    "  if(app.classList.contains('is-done')) err.push('not-reset');",
    "  if(n(t(q(app,'.js-pot')))!==n(pot0)) err.push('pot-reset:'+t(q(app,'.js-pot'))+'/'+pot0);",
    "  if(n(t(q(app,'.js-stack')))!==n(stack0)) err.push('stack-reset:'+t(q(app,'.js-stack'))+'/'+stack0);",
    "  if(last && !last.classList.contains('card--empty')) err.push('river-not-reset');",
    "  if(call && call.disabled) err.push('call-still-disabled');",
    "  L.push((err.length?'FAIL ':'ok   ')+id+' raise '+raise0+'->'+raiseAfter+' pot '+pot0+(err.length?' | '+err.join(','):''));",
    "  report();",
    " },2800);",
    "});"
  ].join(String.fromCharCode(10));

  const page = html
    .replace(/href="css\//g, `href="${REL}css/`)
    .replace(/src="js\//g, `src="${REL}js/`)
    .replace(
      "</body>",
      `<style>#r{position:fixed;inset:0;background:#000;color:#0f0;z-index:99999;font:14px/1.45 monospace;padding:10px;white-space:pre}</style>
<div id="r">running...</div>
<script>${js}<\/script>
</body>`
    );
  fs.writeFileSync(path.join(OUT, "act.html"), page);
  console.log("wrote tools/_out/act.html");
}

/* ---------- cli ---------- */

const cmd = process.argv[2];
if (cmd === "vars") cmdVars();
else if (cmd === "audit") cmdAudit();
else if (cmd === "shot") cmdShot(process.argv[3]);
else if (cmd === "act") cmdAct();
else {
  console.log("usage: node tools/verify.js vars|audit|shot|act [ids]");
  process.exitCode = 1;
}
