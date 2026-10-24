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

## 自测

```bash
node tools/test-engine.js    # 引擎回归（约 2.2 万条断言）
node tools/test-server.js    # 联机服务器集成测试（47 项断言）
```
