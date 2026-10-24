/* ============================================================
   ws-lite.js — 零依赖 WebSocket 服务端实现（RFC 6455 子集）
   只实现服务端需要的部分：文本帧、客户端掩码帧解析、分片重组、
   ping/pong、close 握手。避免任何 npm 依赖，便于随处部署。
   ============================================================ */
"use strict";

const crypto = require("crypto");

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MESSAGE = 1 << 20; // 单条消息上限 1MB，防止恶意大帧

function acceptKey(key) {
  return crypto.createHash("sha1").update(key + GUID).digest("base64");
}

class WSConn {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragments = null;      // { chunks: [] } 分片重组
    this.lastPong = Date.now();
    this.closed = false;

    this.onmessage = null;      // (string)
    this.onclose = null;        // ()

    socket.setNoDelay(true);
    socket.on("data", (chunk) => this._onData(chunk));
    const die = () => this._terminate();
    socket.on("close", die);
    socket.on("error", die);
  }

  /* 服务端 → 客户端：不发掩码 */
  send(str) {
    if (this.closed) return;
    const payload = Buffer.from(str, "utf8");
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x81, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81; header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81; header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(len, 6);
    }
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch (e) { /* 连接已坏，交给 close 事件 */ }
  }

  ping() {
    if (this.closed) return;
    try { this.socket.write(Buffer.from([0x89, 0])); } catch (e) { /* ignore */ }
  }

  close() {
    if (this.closed) return;
    try { this.socket.write(Buffer.from([0x88, 0])); } catch (e) { /* ignore */ }
    this._terminate();
  }

  _terminate() {
    if (this.closed) return;
    this.closed = true;
    try { this.socket.destroy(); } catch (e) { /* ignore */ }
    if (this.onclose) this.onclose();
  }

  _onData(chunk) {
    this.buffer = this.buffer.length
      ? Buffer.concat([this.buffer, chunk])
      : chunk;
    if (this.buffer.length > MAX_MESSAGE) return this._terminate();
    // 一次数据块里可能有多帧，逐帧解析
    for (;;) {
      const frame = this._tryParseFrame();
      if (!frame) break;
      if (frame === "closed") return;
      this._handleFrame(frame);
      if (this.closed) return;
    }
  }

  /* 返回 null 表示数据不完整；"closed" 表示对端发起关闭 */
  _tryParseFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (buf.length < 4) return null;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) return null;
      const big = buf.readUInt32BE(2);
      if (big !== 0) return this._terminate(), null; // 超大帧拒绝
      len = buf.readUInt32BE(6);
      offset = 10;
    }
    if (len > MAX_MESSAGE) return this._terminate(), null;

    const maskLen = masked ? 4 : 0;
    if (buf.length < offset + maskLen + len) return null;

    const mask = masked ? buf.slice(offset, offset + 4) : null;
    offset += maskLen;
    let payload = buf.slice(offset, offset + len);
    if (masked) {
      const out = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
      payload = out;
    }
    this.buffer = buf.slice(offset + len);
    return { fin, opcode, payload };
  }

  _handleFrame(frame) {
    const { fin, opcode, payload } = frame;
    if (opcode === 0x8) {          // close
      this.close();
      return;
    }
    if (opcode === 0x9) {          // ping → pong
      try {
        const h = Buffer.from([0x8a, payload.length]);
        this.socket.write(Buffer.concat([h, payload]));
      } catch (e) { /* ignore */ }
      return;
    }
    if (opcode === 0xA) {          // pong
      this.lastPong = Date.now();
      return;
    }
    if (opcode === 0x1 || opcode === 0x0) {
      if (opcode === 0x1) {
        if (fin) return this._emitText(payload);
        this.fragments = { chunks: [payload] };
      } else if (this.fragments) {
        this.fragments.chunks.push(payload);
        if (fin) {
          const all = Buffer.concat(this.fragments.chunks);
          this.fragments = null;
          this._emitText(all);
        }
      }
    }
    // 其余 opcode 忽略
  }

  _emitText(payload) {
    if (payload.length > MAX_MESSAGE) return this._terminate();
    if (!this.onmessage) return;
    this.onmessage(payload.toString("utf8"));
  }
}

/* 完成 HTTP Upgrade 握手，返回 WSConn；失败返回 null */
function upgrade(req, socket) {
  const key = req.headers["sec-websocket-key"];
  const isGet = (req.method || "").toUpperCase() === "GET";
  if (!key || !isGet || (req.headers.upgrade || "").toLowerCase() !== "websocket") {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return null;
  }
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + acceptKey(key) + "\r\n\r\n"
  );
  return new WSConn(socket);
}

module.exports = { upgrade, WSConn };
