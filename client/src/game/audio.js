export class GameAudio {
  _ctx() { return (this._audioCtx ??= new AudioContext()); }

  _tone(freq, dur, type = 'square', gain = 0.25, freqEnd = freq) {
    const ctx = this._ctx();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(freqEnd, ctx.currentTime + dur);
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start(); osc.stop(ctx.currentTime + dur);
  }

  shoot()       { this._tone(880, 0.07, 'square', 0.15, 440); }
  invaderDie()  { this._tone(300, 0.12, 'square', 0.25, 80); }
  ufoDie()      { [500, 700, 900].forEach((f, i) => setTimeout(() => this._tone(f, 0.15, 'sine', 0.3), i * 80)); }
  civilianDie() { this._tone(440, 0.3, 'sine', 0.2, 200); }
  debrisHit()   { this._tone(120, 0.25, 'sawtooth', 0.35, 60); }
  decoyHit()    { this._tone(200, 0.2, 'triangle', 0.25, 100); }
}
