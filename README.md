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

详见 [deploy/发布指南.md](deploy/发布指南.md)。最快路径：

1. 把本仓库推到 GitHub
2. 在 [zeabur.com](https://zeabur.com) 用 GitHub 登录 → 导入本仓库 → 区域选 Hong Kong
3. 生成域名，把 `https://xxx.zeabur.app/room.html` 发到微信群里

平台会自动执行 `npm start`（即 `node server/server.js`）并注入端口。

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
