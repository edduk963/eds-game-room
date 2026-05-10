class GameSocket extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.queue = [];
    this.role = null;
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
      this.dispatchEvent(new CustomEvent('msg', { detail: msg }));
      this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
    });
    this.ws.addEventListener('close', () => {
      this.dispatchEvent(new CustomEvent('disconnect'));
    });
  }

  send(obj) {
    const json = JSON.stringify(obj);
    if (this.ws && this.ws.readyState === 1) this.ws.send(json);
    else this.queue.push(json);
  }

  close() {
    if (this.ws) this.ws.close();
    this.ws = null;
    this.role = null;
  }
}

export const socket = new GameSocket();
