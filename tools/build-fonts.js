/* 生成站点所需的本地字体子集：只请求页面实际用到的字符。
   用法：node tools/build-fonts.js
   产物：fonts/*.woff2 + css/fonts.css（来源 Google Fonts，均为 SIL OFL 字体） */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FONT_DIR = path.join(ROOT, "fonts");
const CSS_OUT = path.join(ROOT, "css", "fonts.css");
const UA = "Mozilla/5.0 (Linux; Android 14; 23127PN0CC) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

const FAMILIES = [
  { family: "Noto Sans SC", weights: [400, 500, 700], cjk: true },
  { family: "Noto Serif SC", weights: [400, 600, 700], cjk: true },
  { family: "ZCOOL KuaiLe", weights: [400], cjk: true },
  { family: "Ma Shan Zheng", weights: [400], cjk: true },
  { family: "Zhi Mang Xing", weights: [400], cjk: true },
  { family: "Playfair Display", weights: [500, 600, 700] },
  { family: "Archivo", weights: [400, 500, 600, 700] },
  { family: "Space Grotesk", weights: [400, 500, 700] },
  { family: "JetBrains Mono", weights: [400, 600, 700] },
  { family: "Press Start 2P", weights: [400] },
  { family: "Bodoni Moda", weights: [400, 500, 600, 700] },
  { family: "Archivo Black", weights: [400] },
  { family: "Fredoka", weights: [400, 500, 600, 700] },
  { family: "Cormorant Garamond", weights: [400, 500, 600, 700], italic: 400 },
  { family: "Bungee", weights: [400] },
  { family: "Luckiest Guy", weights: [400] },
  { family: "Oswald", weights: [400, 500, 600, 700] },
  { family: "VT323", weights: [400] },
  { family: "Orbitron", weights: [400, 500, 700, 900] },
  { family: "Share Tech Mono", weights: [400] },
  { family: "Cinzel", weights: [400, 500, 600, 700, 900] },
  { family: "IM Fell English", weights: [400], italic: 400 },
  { family: "Baloo 2", weights: [400, 500, 600, 700, 800] },
  { family: "Zen Kaku Gothic New", weights: [300, 400, 500, 700] }
];

const CJK_CHUNK = 300;

function sourceChars() {
  const files = ["index.html", "play.html"];
  for (const dir of ["js", "css"]) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) files.push(path.join(dir, f));
  }
  let text = "";
  for (const f of files) text += fs.readFileSync(path.join(ROOT, f), "utf8");
  const ascii = new Set();
  const cjk = new Set();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 32 || cp === 127) continue;
    if (cp < 127) ascii.add(ch);
    else if (/[\u4E00-\u9FFF]/.test(ch)) cjk.add(ch);
    else if (/[\u2000-\u206F\u2190-\u21FF\u2200-\u22FF\u25A0-\u25FF\u2600-\u26FF\u3000-\u303F\uFE00-\uFE0F\uFF00-\uFFEF]/.test(ch)) ascii.add(ch);
  }
  return { base: [...ascii].join(""), cjk: [...cjk] };
}

function slug(family) {
  return family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
  return res.text();
}

async function download(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw last;
}

function specFor(fam, style) {
  const name = fam.family.replace(/ /g, "+");
  return style === "italic"
    ? name + ":ital,wght@1," + fam.italic
    : name + ":wght@" + fam.weights.join(";");
}

function parseFaces(css) {
  const faces = [];
  const re = /@font-face\s*\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const body = m[1];
    const style = /font-style:\s*([^;]+)/.exec(body);
    const weight = /font-weight:\s*([^;]+)/.exec(body);
    const url = /src:\s*url\((https:[^)]+)\)/.exec(body);
    const range = /unicode-range:\s*([^;]+)/.exec(body);
    if (!url) continue;
    faces.push({
      style: style ? style[1].trim() : "normal",
      weight: weight ? weight[1].trim() : "400",
      url: url[1],
      range: range ? range[1].trim() : ""
    });
  }
  return faces;
}

async function main() {
  fs.rmSync(FONT_DIR, { recursive: true, force: true });
  fs.mkdirSync(FONT_DIR, { recursive: true });
  const { base, cjk } = sourceChars();
  console.log("characters: base", [...base].length, "cjk", cjk.length);

  const chunks = [];
  for (let i = 0; i < cjk.length; i += CJK_CHUNK) chunks.push(cjk.slice(i, i + CJK_CHUNK));
  if (!chunks.length) chunks.push([]);

  const rules = [];
  for (const fam of FAMILIES) {
    const own = fam.cjk ? chunks : [[]];
    const styles = fam.italic ? ["normal", "italic"] : ["normal"];
    for (const style of styles) {
      const weights = style === "italic" ? [fam.italic] : fam.weights;
      // 一族的多个字重通常由同一个可变字体文件承担，先按 URL 去重再决定写法
      for (let c = 0; c < own.length; c++) {
        let text = "";
        if (fam.cjk) text = (c === 0 ? base : "") + own[c].join("");
        else if (c === 0) text = base;
        if (!text) continue;
        const url = "https://fonts.googleapis.com/css2?family=" + specFor(fam, style) +
          "&display=swap&text=" + encodeURIComponent(text);
        let css;
        try {
          css = await fetchText(url);
        } catch (e) {
          console.error("CSS 请求失败", fam.family, style, "chunk", c, e.message);
          continue;
        }
        const faces = parseFaces(css);
        if (!faces.length) { console.error("无字体块", fam.family, style, "chunk", c); continue; }

        const byUrl = new Map();
        for (const face of faces) if (!byUrl.has(face.url)) byUrl.set(face.url, face);
        const styleTag = style === "italic" ? "-italic" : "";
        const stem = slug(fam.family) + styleTag + "-" + c;

        if (byUrl.size === 1) {
          const face = [...byUrl.values()][0];
          const file = stem + "-var.woff2";
          try {
            await download(face.url, path.join(FONT_DIR, file));
          } catch (e) {
            console.error("字体下载失败", file, e.message);
            continue;
          }
          const desc = weights.length > 1
            ? Math.min(...weights) + " " + Math.max(...weights)
            : String(weights[0]);
          rules.push(faceRule(fam.family, style, desc, "../fonts/" + file, face.range));
        } else {
          const seen = new Set();
          for (const face of faces) {
            const key = face.url + "|" + face.weight + "|" + face.style;
            if (seen.has(key)) continue;
            seen.add(key);
            const file = stem + "-" + face.weight + ".woff2";
            try {
              await download(face.url, path.join(FONT_DIR, file));
            } catch (e) {
              console.error("字体下载失败", file, e.message);
              continue;
            }
            rules.push(faceRule(fam.family, face.style, face.weight, "../fonts/" + file, face.range));
          }
        }
        process.stdout.write(".");
      }
    }
  }

  const header = "/* 本地字体子集（仅包含页面用到的字符）· 来源 Google Fonts · SIL OFL\n" +
    "   由 tools/build-fonts.js 生成，请勿手工编辑。 */\n\n";
  fs.writeFileSync(CSS_OUT, header + rules.join("\n\n") + "\n");

  const files = fs.readdirSync(FONT_DIR).filter((f) => f.endsWith(".woff2"));
  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(FONT_DIR, f)).size, 0);
  console.log("\nfaces", rules.length, "files", files.length, "woff2", (bytes / 1024 / 1024).toFixed(2) + "MB");
  console.log("css", path.relative(ROOT, CSS_OUT));
}

function faceRule(family, style, weight, src, range) {
  return "@font-face {\n" +
    "  font-family: '" + family + "';\n" +
    "  font-style: " + style + ";\n" +
    "  font-weight: " + weight + ";\n" +
    "  font-display: swap;\n" +
    "  src: url('" + src + "') format('woff2');\n" +
    (range ? "  unicode-range: " + range + ";\n" : "") +
    "}";
}

main().catch((e) => { console.error(e); process.exit(1); });
