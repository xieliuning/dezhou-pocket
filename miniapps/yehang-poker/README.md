# 夜航俱乐部 · 德州扑克 (Yehang Poker)

A Texas Hold'em table that lives inside MiniMax Code. Four tabs in one window:

| Tab | What it does |
| --- | --- |
| **联机牌桌 / Online table** | Join a room on a public poker server, seat yourself, and share an invite link with friends |
| **AI 陪练 / AI sparring** | Nine-player table against eight AI opponents, in the same twenty switchable table styles |
| **桌主控制台 / Host console** | Room code, seated and spectating counts, blinds, seat roster, invite link |
| **服务器 / Server** | Configure the address of your poker server and check that it is reachable |

The Mini App does **not** run the poker game. It hosts the table page, remembers the server
address, and proxies `/ws` to that server. All card dealing, betting and settlement happen on the
server, so a room's state lives there and not in the Mini App.

## How to play with friends

1. Deploy the poker server (zero npm dependencies, Node ≥ 16):

   ```bash
   npm start        # = node server/server.js, listens on 0.0.0.0:8080
   ```

   The server project ships a `render.yaml` Blueprint, a `Dockerfile` for Hugging Face Spaces, and
   a deployment guide. Any host that serves HTTPS and forwards WebSocket upgrades works — Render,
   Railway, Zeabur, or your own VPS.

2. Open the **服务器 / Server** tab, paste the public address (for example
   `https://your-poker.onrender.com`), press **保存并应用 / Save and apply**, and wait for
   "牌局服务器可达".

3. Open the **联机牌桌 / Online table** tab, create a room, and copy the invite link. The link
   points at the public server address, so friends can open it directly.

Addresses may be written without a scheme: a bare IP or `localhost` is treated as `http://`, a
domain name as `https://`. `ws://` and `wss://` are accepted and converted.

## Data & access

- The only external service this Mini App talks to is the poker server **you** configure. It is
  reached over HTTPS (page and WebSocket).
- The server address is stored in the Mini App's own runtime data directory, never in the page, and
  never shared with the room. It is never sent to the Agent.
- The Mini App performs a read-only reachability check against `<address>/room.html` when you press
  **测试连接 / Test connection**, and verifies that the response is a Yehang table page.
- No accounts, no analytics, no telemetry, no real money.

## Tested environment

- MiniMax Code 3.1.2 on Windows 11
- Room creation, seating, reconnecting after a reload, and a full hand played to showdown against
  a second client
- Switching all twenty table styles from the in-app style panel, across both table views
- Server address configuration, reachability check, and save/apply

## License

MIT — see [LICENSE](LICENSE).
