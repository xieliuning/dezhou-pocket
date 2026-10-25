#!/usr/bin/env node
/* ============================================================
   tunnel.js — 一键把本机牌局服务器开到公网（免绑卡、零账号）

   用法：
     node tools/tunnel.js                     # 自动起服务器 + 隧道
     node tools/tunnel.js --port 8080
     node tools/tunnel.js --provider localtunnel   # 强制用 localtunnel
     node tools/tunnel.js --cloudflared <路径>     # 指定 cloudflared 可执行文件

   两种隧道（按优先级自动选）：
     1) cloudflared 快速隧道 → https://xxx-yyy-zzz.trycloudflare.com
        · Cloudflare 官方，不需要账号、不绑卡
        · 访客直接进，不会弹任何密码页
        · 国内可访问（workers.dev 反而会被 DNS/SNI 拦截）
        · 需要 cloudflared 可执行文件，见 tools/README-cloudflared.md
     2) localtunnel → https://xxx.loca.lt
        · 纯 npm 依赖，零外部文件，永远可用作兜底
        · 访客第一次打开会看到「隧道密码」页，要填你的公网 IP

   两种隧道都会：进程退出自动重开；健康检查连续 3 次失败就掐掉重开。
   电脑必须保持开机，隧道断了牌局就断。
   ============================================================ */
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(argValue("--port") || 8080);
const WANT_PROVIDER = argValue("--provider");
const URL_FILE = path.join(__dirname, ".tunnel-url");   // 当前公网地址，方便随时查

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    const done = (v) => { try { s.destroy(); } catch (e) { /* ignore */ } resolve(v); };
    s.setTimeout(1200);
    s.once("connect", () => done(true));
    s.once("timeout", () => done(false));
    s.once("error", () => done(false));
  });
}

/* 查本机公网 IPv4（localtunnel 的「隧道密码」就是这个） */
function publicIp() {
  return new Promise((resolve) => {
    const req = https.get("https://ipinfo.io/ip", { timeout: 6000 }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => {
        const ip = b.trim();
        resolve(/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : null);
      });
    });
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
  });
}

/* ---------- 找 cloudflared 可执行文件 ---------- */
function findCloudflared() {
  const explicit = argValue("--cloudflared");
  const candidates = [
    explicit,
    process.env.CLOUDFLARED,
    path.join(ROOT, "tools", "bin", "cloudflared.exe"),
    path.join(ROOT, "tools", "bin", "cloudflared"),
    path.join(process.env.LOCALAPPDATA || "", "cloudflared", "cloudflared.exe"),
    path.join(process.env.TEMP || "", "cloudflared.exe")
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; } catch (e) { /* ignore */ }
  }
  return null;
}

let serverProc = null;

async function ensureServer() {
  if (await isPortOpen(PORT)) {
    console.log("牌局服务器已在 127.0.0.1:" + PORT + " 运行，跳过启动。");
    return;
  }
  console.log("启动牌局服务器 node server/server.js …");
  serverProc = spawn(process.execPath, [path.join(ROOT, "server", "server.js")], {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    env: Object.assign({}, process.env, { PORT: String(PORT) })
  });
  serverProc.on("exit", (code) => {
    console.log("牌局服务器退出（code " + code + "）");
  });
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 300));
    if (await isPortOpen(PORT)) { console.log("牌局服务器就绪。"); return; }
  }
  console.error("牌局服务器启动超时。");
  process.exit(1);
}

let tunnelProc = null;
let provider = "localtunnel";
let cloudflaredBin = null;

/* ---------- cloudflared 快速隧道 ---------- */
function startCloudflared(bin) {
  return new Promise((resolve, reject) => {
    console.log("启动隧道 cloudflared（快速隧道，无需账号）…");
    const args = [
      "tunnel",
      "--url", "http://127.0.0.1:" + PORT,
      "--no-autoupdate",
      "--protocol", "http2"      // UDP/QUIC 在部分国内网络不通，强制走 TCP
    ];
    tunnelProc = spawn(bin, args, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) {
        cleanup();
        resolve(m[0]);
      }
    };
    const cleanup = () => {
      tunnelProc.stdout.off("data", onData);
      tunnelProc.stderr.off("data", onData);
    };
    tunnelProc.stdout.on("data", onData);
    tunnelProc.stderr.on("data", onData);
    tunnelProc.on("exit", (code) => {
      cleanup();
      reject(new Error("cloudflared 退出，code " + code));
    });
    setTimeout(() => { cleanup(); reject(new Error("cloudflared 启动超时（120 秒）")); }, 120000);
  });
}

/* ---------- localtunnel ---------- */
function startLocaltunnel() {
  return new Promise((resolve, reject) => {
    console.log("启动隧道 npx --yes localtunnel --port " + PORT + " …");
    tunnelProc = spawn("npx", ["--yes", "localtunnel", "--port", String(PORT)], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true           // Windows 下 npx 是 .cmd，必须经 shell 启动
    });
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/https:\/\/[a-z0-9-]+\.loca\.lt/);
      if (m) {
        cleanup();
        resolve(m[0]);
      }
    };
    const cleanup = () => {
      tunnelProc.stdout.off("data", onData);
      tunnelProc.stderr.off("data", onData);
    };
    tunnelProc.stdout.on("data", onData);
    tunnelProc.stderr.on("data", onData);
    tunnelProc.on("exit", (code) => {
      cleanup();
      reject(new Error("隧道进程退出，code " + code));
    });
    setTimeout(() => { cleanup(); reject(new Error("隧道启动超时（120 秒）")); }, 120000);
  });
}

function startTunnel() {
  if (provider === "cloudflared") return startCloudflared(cloudflaredBin);
  return startLocaltunnel();
}

/* 把当前公网地址写到文件，方便随时确认「现在该发哪个链接」 */
function saveUrl(url) {
  try {
    fs.writeFileSync(URL_FILE, url + "\n", "utf8");
  } catch (e) { /* ignore */ }
}

function shutdown() {
  console.log("\n正在关闭…");
  if (healthTimer) clearInterval(healthTimer);
  try { if (tunnelProc) tunnelProc.kill(); } catch (e) { /* ignore */ }
  try { if (serverProc) serverProc.kill(); } catch (e) { /* ignore */ }
  process.exit(0);
}

/* 隧道健康检查：进程活着但链路已死的情况很常见，
   所以定期探一下；连续失败 3 次就掐掉重开，换一个新地址。 */
function probe(url) {
  return new Promise((resolve) => {
    const req = https.get(url + "/room.html", { timeout: 8000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

let healthTimer = null;
let fails = 0;

function startHealthCheck(getUrl) {
  if (healthTimer) clearInterval(healthTimer);
  fails = 0;
  healthTimer = setInterval(async () => {
    const url = getUrl();
    if (!url) return;
    const ok = await probe(url);
    if (ok) {
      if (fails) console.log("隧道已恢复正常。");
      fails = 0;
      return;
    }
    fails += 1;
    console.warn("隧道探测失败 " + fails + "/3 次：" + url);
    if (fails < 3) return;
    fails = 0;
    console.log("隧道判定失效，掐掉重开…");
    try { if (tunnelProc) tunnelProc.kill(); } catch (e) { /* ignore */ }
  }, 45000);
}

(async () => {
  cloudflaredBin = findCloudflared();
  if (WANT_PROVIDER === "cloudflared" && !cloudflaredBin) {
    console.error("指定了 --provider cloudflared，但没有找到 cloudflared 可执行文件。");
    console.error("把 cloudflared.exe 放到 tools/bin/ 下，或用 --cloudflared <路径> 指定。");
    process.exit(1);
  }
  if (WANT_PROVIDER === "localtunnel") {
    provider = "localtunnel";
  } else if (cloudflaredBin) {
    provider = "cloudflared";
  } else {
    provider = "localtunnel";
    console.log("未找到 cloudflared，使用 localtunnel（国内可访问，但访客会看到一次「隧道密码」页）。");
    console.log("想让朋友直接点开就能进？见 tools/README-cloudflared.md。");
  }

  await ensureServer();
  console.log("");

  let url = "";
  for (;;) {
    try {
      url = await startTunnel();
      break;
    } catch (e) {
      console.error("隧道启动失败：" + e.message + "，3 秒后重试…");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  console.log("");
  console.log("  公网地址已就绪（" + provider + "）：");
  console.log("");
  console.log("    联机开黑  " + url + "/room.html");
  console.log("    单机练习  " + url + "/play.html");
  console.log("");
  if (provider === "localtunnel") {
    const ip = await publicIp();
    console.log("  朋友第一次打开会看到 localtunnel 的「隧道密码」页，需要填你的公网 IP：");
    console.log("");
    console.log("    " + (ip || "（查不到，请看密码页上显示的 IP）"));
    console.log("");
    console.log("  同一 IP 7 天内只会问一次，填完就能直接进。");
  } else {
    console.log("  cloudflared 快速隧道：朋友直接点链接就能进，不会弹密码页。");
    console.log("  这个地址在进程重启后会变，记得把新链接重新发到群里。");
  }
  console.log("  建房后把带 ?room=房间号 的完整链接发到群里，朋友点开就能上桌。");
  console.log("");
  console.log("  按 Ctrl+C 结束（会一并关掉隧道和牌局服务器）。");
  console.log("");

  let currentUrl = url;
  saveUrl(currentUrl);

  // 隧道进程退出 → 自动重开
  tunnelProc.on("exit", async (code) => {
    console.error("隧道已断开（code " + code + "），3 秒后自动重开…");
    await new Promise((r) => setTimeout(r, 3000));
    try {
      currentUrl = await startTunnel();
      saveUrl(currentUrl);
      console.log("新的公网地址：" + currentUrl + "/room.html");
      console.log("（旧链接已失效，记得把新链接发到群里）");
    } catch (e) {
      console.error("隧道重启失败：" + e.message);
      process.exit(1);
    }
  });

  // 链路假死 → 健康检查兜底
  startHealthCheck(() => currentUrl);

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
})();
