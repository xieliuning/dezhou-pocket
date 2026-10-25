/* 牌局服务器地址（可选）
   网页版被托管在静态站上、而真正跑牌局的 server/server.js 在另一台机器时，
   把那台机器的公网地址写在这里：
     window.YEHANG_SERVER = "https://xxx.zeabur.app";
   留空 = 默认连当前站点（同源部署，行为与从前一致）。
   优先级：链接里的 ?server= > 本机记住的 > 这里的默认值 > 同源。 */
window.YEHANG_SERVER = "";
