// @ts-check

/**
 * 夜航俱乐部 · 德州扑克 — Mini App Node 运行时
 *
 * 职责：
 *   1) 托管 Mini App 客户端页面（静态文件）
 *   2) 保存并提供「牌局服务器地址」配置（公网部署后的 server/server.js）
 *   3) 健康检查：确认目标地址确实是德州扑克牌局服务器
 *   4) /ws 反向代理：把客户端的 WebSocket 帧转发到牌局服务器的 /ws
 *
 * 牌局本体（发牌、下注、边池、结算）全部在公网服务器上完成，
 * Mini App 不持有任何牌局状态，底牌在摊牌前不会经由本进程。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { upgrade } = require('./ws-lite.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = join(__dirname, '..', 'client');

/** 未配置时的默认地址：与项目 README 一致的本机启动方式（npm start → 8080） */
const DEFAULT_UPSTREAM = 'http://127.0.0.1:8080';
const CONFIG_FILE = 'config.json';
const WS_PATH = '/ws';
const HEALTH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

/**
 * 把用户填写的地址规整成 origin（scheme://host[:port]）。
 * 允许省略 scheme（默认 https）、允许 ws/wss（换算回 http/https）。
 * @param {unknown} raw
 * @returns {string} 合法则返回 origin，否则返回空串
 */
export function normalizeUpstream(raw) {
  let text = String(raw == null ? '' : raw).trim();
  if (!text) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    // 没写 scheme 时按地址性质猜：裸 IP 与 localhost 用 http，域名用 https
    const hostPart = text.split('/')[0].split(':')[0].toLowerCase();
    const looksLocal = hostPart === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostPart);
    text = (looksLocal ? 'http://' : 'https://') + text;
  }
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return '';
  }
  if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
  else if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  if (!parsed.hostname) return '';
  return parsed.origin;
}

/**
 * 由牌局服务器地址推导 WebSocket 地址。
 * @param {string} upstream
 * @returns {string}
 */
export function wsUrlFor(upstream) {
  const parsed = new URL(upstream);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.pathname = WS_PATH;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

/**
 * 探测目标地址是否为可用的德州扑克牌局服务器。
 * @param {string} upstream
 * @returns {Promise<{ok: boolean, status: number, detail: string}>}
 */
async function probeUpstream(upstream) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(upstream + '/room.html', {
      signal: controller.signal,
      redirect: 'follow'
    });
    if (!response.ok) {
      return { ok: false, status: response.status, detail: '服务器返回 HTTP ' + response.status };
    }
    const body = await response.text();
    const looksLikePoker = /夜航俱乐部|js-lobby|Texas Hold/i.test(body);
    if (!looksLikePoker) {
      return { ok: false, status: response.status, detail: '这个地址不是德州扑克牌局服务器' };
    }
    return { ok: true, status: response.status, detail: '牌局服务器可达' };
  } catch {
    return {
      ok: false,
      status: 0,
      detail: '连不上服务器，请检查地址、网络和服务是否已启动'
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  });
  response.end(body);
}

/**
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 客户端页面里有一段 JSON 配置块，Node 运行时在响应时把它替换成
 * 当前生效的牌局服务器地址，页面在脚本执行前就能拿到同源配置。
 * @param {string} html
 * @param {string} upstream
 * @returns {string}
 */
function injectConfig(html, upstream) {
  const safe = String(upstream).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return html.replace('"__YEHANG_UPSTREAM__"', '"' + safe + '"');
}

/**
 * @param {string} pathname
 * @param {string} upstream
 * @param {import('node:http').ServerResponse} response
 */
async function serveStatic(pathname, upstream, response) {
  let relative = pathname;
  if (relative === '/' || relative === '/dashboard') relative = '/index.html';
  let decoded;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    decoded = relative;
  }
  const target = normalize(join(CLIENT_ROOT, decoded));
  if (target !== CLIENT_ROOT && !target.startsWith(CLIENT_ROOT + sep)) {
    sendJson(response, 403, { error: 'forbidden' });
    return;
  }
  try {
    const ext = extname(target).toLowerCase();
    if (ext === '.html') {
      const html = injectConfig(await readFile(target, 'utf8'), upstream);
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-cache'
      });
      response.end(html);
      return;
    }
    const data = await readFile(target);
    response.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-cache'
    });
    response.end(data);
  } catch {
    sendJson(response, 404, { error: 'not_found' });
  }
}

/**
 * @param {import('./miniapp-api.js').MiniAppContext} context
 * @returns {Promise<import('./miniapp-api.js').MiniAppLifecycle>}
 */
export async function start(context) {
  await mkdir(context.dataDir, { recursive: true });
  const configPath = join(context.dataDir, CONFIG_FILE);

  /** @type {{ upstream: string }} */
  let config = { upstream: DEFAULT_UPSTREAM };
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const upstream = normalizeUpstream(parsed && parsed.upstream);
    if (upstream) config.upstream = upstream;
  } catch {
    // 首次启动：用默认地址，配置文件在用户保存设置时写入
  }

  /** @type {Set<{ close: () => void }>} */
  const liveBridges = new Set();

  const server = createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url || '/', 'http://miniapp.local');
        const path = url.pathname;

        if (path === '/api/config') {
          if (request.method === 'GET') {
            sendJson(response, 200, {
              upstream: config.upstream,
              wsPath: WS_PATH
            });
            return;
          }
          if (request.method === 'POST') {
            const body = await readJsonBody(request);
            const upstream = normalizeUpstream(body.upstream);
            if (!upstream) {
              sendJson(response, 400, {
                error: 'invalid_upstream',
                message: '请填写 http:// 或 https:// 开头的地址'
              });
              return;
            }
            config.upstream = upstream;
            await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
            const health = await probeUpstream(upstream);
            context.logger.info('miniapp.upstream.saved', { ok: health.ok });
            sendJson(response, 200, { upstream: config.upstream, wsPath: WS_PATH, health });
            return;
          }
          sendJson(response, 405, { error: 'method_not_allowed' });
          return;
        }

        if (path === '/api/health') {
          const health = await probeUpstream(config.upstream);
          sendJson(response, 200, { upstream: config.upstream, health });
          return;
        }

        await serveStatic(path, config.upstream, response);
      } catch (error) {
        context.logger.error('miniapp.request.failed', {
          message: error instanceof Error ? error.message : 'unknown'
        });
        if (!response.headersSent) sendJson(response, 500, { error: 'internal_error' });
        else response.end();
      }
    })();
  });

  /* ---- WebSocket 反向代理 ---- */

  server.on('upgrade', (request, socket) => {
    let path = '/';
    try {
      path = new URL(request.url || '/', 'http://miniapp.local').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (path !== WS_PATH) {
      socket.destroy();
      return;
    }
    void bridgeToUpstream(request, socket);
  });

  /**
   * 先连上牌局服务器，连通后再与页面完成 WebSocket 握手，
   * 避免页面以为已连上却被立刻断开。
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:net').Socket} socket
   */
  async function bridgeToUpstream(request, socket) {
    const target = wsUrlFor(config.upstream);
    let upstream;
    try {
      upstream = new WebSocket(target);
    } catch {
      socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    let opened = false;
    let settled = false;

    const rejectUpgrade = () => {
      if (settled) return;
      settled = true;
      try {
        socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
        socket.destroy();
      } catch {
        /* 忽略：socket 可能已关闭 */
      }
      try {
        upstream.close();
      } catch {
        /* 忽略 */
      }
    };

    const timer = setTimeout(() => {
      if (!opened) rejectUpgrade();
    }, HEALTH_TIMEOUT_MS);

    upstream.addEventListener('open', () => {
      opened = true;
      clearTimeout(timer);
      if (settled) {
        try {
          upstream.close();
        } catch {
          /* 忽略 */
        }
        return;
      }
      const conn = upgrade(request, socket);
      if (!conn) {
        settled = true;
        try {
          upstream.close();
        } catch {
          /* 忽略 */
        }
        return;
      }
      settled = true;
      liveBridges.add(upstream);

      conn.onmessage = (raw) => {
        if (upstream.readyState === 1) upstream.send(raw);
      };
      conn.onclose = () => {
        liveBridges.delete(upstream);
        try {
          upstream.close();
        } catch {
          /* 忽略 */
        }
      };
      upstream.addEventListener('message', (event) => {
        const data = event.data;
        conn.send(typeof data === 'string' ? data : String(data));
      });
      upstream.addEventListener('close', () => {
        liveBridges.delete(upstream);
        conn.close();
      });
      upstream.addEventListener('error', () => {
        /* close 事件紧随其后，这里不重复处理 */
      });
    });

    upstream.addEventListener('error', () => {
      clearTimeout(timer);
      if (!opened) rejectUpgrade();
    });
    upstream.addEventListener('close', () => {
      clearTimeout(timer);
      if (!opened) rejectUpgrade();
    });
  }

  await listen(server, context.listen.host, context.listen.port);
  context.logger.info('miniapp.runtime.listening', { upstream: config.upstream });

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    context.signal.removeEventListener('abort', onAbort);
    for (const bridge of liveBridges) {
      try {
        bridge.close();
      } catch {
        /* 忽略 */
      }
    }
    liveBridges.clear();
    await close(server);
  };
  const onAbort = () => {
    void dispose();
  };
  context.signal.addEventListener('abort', onAbort, { once: true });
  if (context.signal.aborted) await dispose();

  return { dispose };
}

/**
 * @param {import('node:http').Server} server
 * @param {string} host
 * @param {number} port
 */
function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

/**
 * @param {import('node:http').Server} server
 */
function close(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}
