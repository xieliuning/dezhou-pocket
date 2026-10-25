# cloudflared 安装说明（给国内用户的免绑卡公网地址）

`node tools/tunnel.js` 默认优先用 **cloudflared 快速隧道**，它是 Cloudflare 官方的隧道工具：

- 不需要账号、不需要绑卡、不花钱
- 给的是 `https://随机字符串.trycloudflare.com` 地址，**国内可以直接打开**
- 访客点开就能进，**不会弹任何「隧道密码」页**（localtunnel 会弹）
- 走的是 Cloudflare 自己的边缘网络，速度和稳定性都比 localtunnel 好

> 为什么不用 `*.workers.dev`？那个地址在**中国大陆被 DNS/SNI 拦截**，打不开；
> 而 `*.trycloudflare.com` 的域名没被拦，所以能用。

## 一、下载 cloudflared

Windows（64 位）官方直链：

```
https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
```

国内网络下载慢的话，可以用并行分段的方式拉（也可以直接复制下面这行到 PowerShell）：

```powershell
# 单线程直连（慢但简单）
curl.exe -L -o cloudflared.exe "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
```

下载完成后（约 65 MB），把文件放到项目的 `tools/bin/` 目录下：

```
tools/bin/cloudflared.exe
```

`tools/bin/` 已在 `.gitignore` 里，不会进仓库。

## 二、确认能用

```powershell
tools\bin\cloudflared.exe --version
```

看到版本号就说明装好了。

## 三、开黑

```powershell
node tools/tunnel.js
```

脚本会自动：

1. 检查 8080 端口，没在跑就启动 `node server/server.js`
2. 拉起 cloudflared 快速隧道
3. 打印公网地址，例如：

```
  公网地址已就绪（cloudflared）：

    联机开黑  https://abc-def-ghi.trycloudflare.com/room.html
    单机练习  https://abc-def-ghi.trycloudflare.com/play.html
```

建房后把带 `?room=房间号` 的完整链接发到群里，朋友点开就能上桌。

## 四、几个要注意的地方

| 事项 | 说明 |
| --- | --- |
| 地址会变 | 隧道进程重启后地址会换，旧链接失效。脚本会自动重开并打印新地址，记得把新链接重新发到群里。 |
| 电脑要开着 | 电脑关机/睡眠，牌局就断。这是本机托管的固有限制。 |
| 想要 24 小时不间断 | 走 Cloudflare Workers 方案（见 `deploy/免绑卡托管.md`），但 `workers.dev` 域名在国内被拦，需要绑自己的域名才能让国内朋友访问。 |
| 强制用 localtunnel | `node tools/tunnel.js --provider localtunnel` |

## 五、macOS / Linux

```bash
# 下载并放到 tools/bin/
curl -L -o tools/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x tools/bin/cloudflared
node tools/tunnel.js
```

macOS 用 `cloudflared-darwin-amd64.tgz`（先 `tar xzf`）。
