class GameSocket extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.queue = [];
    this.role = null;
    this._joinParams = null;
    this._autoReconnect = false;
    this._reconnectTimer = null;
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws.addEventListener('open', () => {
      while (this.queue.length) this.ws.send(this.queue.shift());
    });
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'ping') { this.send({ type: 'pong' }); return; }
      if (msg.type === 'joined') this.role = msg.role;
      if (msg.type === 'error') this._autoReconnect = false;
      this.dispatchEvent(new CustomEvent('msg', { detail: msg }));
      this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
    });
    this.ws.addEventListener('close', () => {
      this.dispatchEvent(new CustomEvent('disconnect'));
      if (this._autoReconnect && this._joinParams) this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => {
      if (!this._autoReconnect || !this._joinParams) return;
      this.queue = [JSON.stringify(this._joinParams)];
      this.connect();
    }, 2000);
  }

  send(obj) {
    if (obj.type === 'join') {
      this._joinParams = { ...obj };
      this._autoReconnect = true;
    }
    const json = JSON.stringify(obj);
    if (this.ws && this.ws.readyState === 1) this.ws.send(json);
    else if (this.queue.length < 200) this.queue.push(json);
  }

  close() {
    this._autoReconnect = false;
    this._joinParams = null;
    clearTimeout(this._reconnectTimer);
    if (this.ws) this.ws.close();
    this.ws = null;
    this.role = null;
  }
}

export const socket = new GameSocket();
