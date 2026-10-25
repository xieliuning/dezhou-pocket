/* ============================================================
   cf/worker.js — Cloudflare Worker 入口

   路由：
     /ws （WebSocket 升级）→ Durable Object「牌局大厅」
     其它                  → Workers Static Assets（dist/ 前端）

   前端和牌局服务器同源，所以浏览器直接连 wss://<域名>/ws，
   不需要再配 ?server= 参数。
   ============================================================ */
import { PokerHall } from "./poker-hall.js";

export { PokerHall };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const upgrade = (request.headers.get("Upgrade") || "").toLowerCase();

    if (upgrade === "websocket" || url.pathname === "/ws") {
      const id = env.POKER.idFromName("hall");
      const stub = env.POKER.get(id);
      return stub.fetch(request);
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("夜航俱乐部 · 德州扑克", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
};
