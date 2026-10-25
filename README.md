# 夜航俱乐部 · 德州扑克

一套德扑牌桌，两种玩法：

- **单机**：九人桌，你 + 8 位 AI，二十套可切换的界面风格 → `play.html`
- **同桌联机**：建房间发到微信群，朋友点开上桌，九个座位自由换 → `room.html`

规则引擎在 `js/poker.js`（2.2 万条断言覆盖边池/单挑/最小加注/A2345）；联机服务器零 npm 依赖，Node ≥16 直接跑。无真钱、无账号、纯娱乐。

## 本地运行

```bash
node server/server.js        # 联机服务器（默认 0.0.0.0:8080）
# 浏览器打开 http://localhost:8080/room.html
```

单机版不需要服务器，直接开 `play.html`（或任意静态服务器）。

## 部署到公网

### 国内朋友要玩 → 本机隧道（免绑卡，10 分钟开桌）

```bash
node tools/tunnel.js    # 零改动、零账号：本机起隧道，电脑要开着
```

优先用 Cloudflare 官方的 cloudflared 快速隧道，给出 `https://xxx.trycloudflare.com` 地址，
**国内能直接打开、访客不用输密码**（把 cloudflared 放到 `tools/bin/` 即可，见
[tools/README-cloudflared.md](tools/README-cloudflared.md)）；
没装就退回 localtunnel（会弹一次「隧道密码」页）。

### 长期稳定 → Cloudflare Workers（免绑卡，永久免费，电脑关掉也能玩）

仓库自带 `wrangler.toml` 和 `cf/`，**客户端一行都不用改**：

```bash
npx wrangler login     # 浏览器授权；Cloudflare 账号注册不要绑卡
npx wrangler deploy    # 得到 https://yehang-poker.xxx.workers.dev
```

把这个域名的 `/room.html` 发到微信群即可。前端和牌局服务器同源，房间状态落 SQLite，
Worker 重启后房间还在；牌局逻辑跑在 Durable Objects 里，客户端协议完全没变。
本地调试用 `npx wrangler dev`。

> ⚠️ **`workers.dev` 域名在中国大陆被 DNS 污染 + SNI 拦截，打开不了**（实测）。
> Worker 本身没问题，海外访问完全正常；国内要用的话，给它绑一个自己的域名
> （`wrangler.toml` 里加 `routes`），或先用上面的本机隧道顶着。

### 其它托管

详见 [deploy/发布指南.md](deploy/发布指南.md)：Zeabur（GitHub 导入，免备案香港节点）、
Render（自带 `render.yaml` 一键 Blueprint）、Railway、腾讯云轻量服务器等。

完整对比、实测记录与踩坑说明见 **[deploy/免绑卡托管.md](deploy/免绑卡托管.md)**。

## Mini App

`miniapps/yehang-poker/` 是一个独立的 Mini App 包，把牌桌装进一个应用窗口，四个标签：

| 标签 | 作用 |
| --- | --- |
| 联机牌桌 | 连公网牌局服务器，建房 / 输房间号上桌，生成邀请链接 |
| AI 陪练 | 单机九人桌（沿用二十套风格），切走标签不消耗思考时间 |
| 桌主控制台 | 房间号、在座 / 围观、盲注、席位、邀请链接 |
| 服务器 | 配置牌局服务器地址并自检连通性 |

Mini App 自身不跑牌局：它托管客户端页面、存服务器地址、把 `/ws` 反向代理到上游。地址写在运行时的 `dataDir/config.json`，默认 `http://127.0.0.1:8080`（与 `npm start` 一致）；按上面的指南部署到公网后，到「服务器」标签改成 `https://xxx.zeabur.app` 即可和朋友联机。

```
miniapps/yehang-poker/
  miniapp/node/server.mjs      Node 入口（静态托管 + /api/config + /api/health + /ws 代理）
  miniapp/node/ws-lite.js      零依赖 WebSocket 实现
  miniapp/client/              客户端页面 + 移植过来的牌桌资产（25 CSS / 39 字体 / 32 头像）
  miniapp/miniapp.json         Mini App 清单
  .minimax-plugin/plugin.json  插件元信息
```

## 自测

```bash
node tools/test-engine.js    # 引擎回归（约 2.2 万条断言）
node tools/test-server.js    # 联机服务器集成测试（47 项断言）
```
