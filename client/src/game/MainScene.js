import Phaser from 'phaser';
import { makeRng, rngRange } from './seededRng.js';
import { GameAudio } from './audio.js';

const W = 800;
const H = 600;
const ROUND_MS = 90_000;

const SCORES = {
  invader: 10,
  ufo: 100,
  civilianHit: -50,
  debrisHit: -25,
  decoyPickup: -30,
};

export class MainScene extends Phaser.Scene {
  constructor() { super('main'); }

  init(data) {
    this.seed = data.seed >>> 0;
    this.startAt = data.startAt;
    this.onScore = data.onScore || (() => {});
    this.onEnd = data.onEnd || (() => {});
    this.onVibeAdd = data.onVibeAdd || (() => {});
    this.onVibeOpponent = data.onVibeOpponent || (() => {});
    this.onVTimeAdd = data.onVTimeAdd || (() => {});
    this.onClockExtend = data.onClockExtend || (() => {});
    this.opponentName = data.opponentName || 'Opponent';
    this.myName = data.myName || 'You';
  }

  preload() {
    this._mkRect('player',   36, 18, 0x5cffd4);
    this._mkRect('bullet',    4, 12, 0xffffff);
    this._mkRect('invader',  28, 18, 0xff77aa);
    this._mkRect('ufo',      40, 16, 0xffcc44);
    this._mkRect('civilian', 28, 16, 0x88ddff);
    this._mkRect('debris',   18, 18, 0x886644);
    this._mkRect('decoy',    20, 20, 0xffaa00);
  }

  _mkRect(key, w, h, color) {
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillRect(0, 0, w, h);
    g.generateTexture(key, w, h);
    g.destroy();
  }

  create() {
    this.rng = makeRng(this.seed);
    this.score = 0;
    this.oppScore = 0;
    this.gameOver = false;
    this.stunUntil = 0;
    this.wave = 0;
    this.vibeSeconds = 0;
    this.vTimeAccum = 0;
    this.audio = new GameAudio();

    this.cameras.main.setBackgroundColor('#0a0e1a');
    this._drawStars();

    this.player = this.physics.add.sprite(W / 2, H - 40, 'player');
    this.player.setCollideWorldBounds(true);

    this.bullets   = this.physics.add.group({ defaultKey: 'bullet', maxSize: 30 });
    this.invaders  = this.physics.add.group();
    this.civilians = this.physics.add.group();
    this.debris    = this.physics.add.group();
    this.decoys    = this.physics.add.group();
    this.ufos      = this.physics.add.group();

    this.physics.add.overlap(this.bullets, this.invaders,  (b, e) => this._hitInvader(b, e));
    this.physics.add.overlap(this.bullets, this.ufos,      (b, e) => this._hitUfo(b, e));
    this.physics.add.overlap(this.bullets, this.civilians, (b, e) => this._hitCivilian(b, e));
    this.physics.add.overlap(this.player,  this.debris,    (_p, d) => this._hitByDebris(d));
    this.physics.add.overlap(this.player,  this.decoys,    (_p, d) => this._pickupDecoy(d));

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('A,D,SPACE');
    this.lastShotAt = 0;

    this.hudScore   = this.add.text(16, 12,   `${this.myName}: 0`,         { fontFamily: 'Segoe UI', fontSize: 20, color: '#5cffd4' });
    this.hudVibe    = this.add.text(16, 36,   'Vibe: 0s',                   { fontFamily: 'Segoe UI', fontSize: 14, color: '#cc44ff' });
    this.hudVTime   = this.add.text(16, 54,   'V-time: 0s',                 { fontFamily: 'Segoe UI', fontSize: 14, color: '#ffaa00' });
    this.hudOpp     = this.add.text(W - 16, 12, `${this.opponentName}: 0`, { fontFamily: 'Segoe UI', fontSize: 20, color: '#ffcc44' }).setOrigin(1, 0);
    this.hudTimer   = this.add.text(W / 2, 12, '90', { fontFamily: 'Segoe UI', fontSize: 24, color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.banner     = this.add.text(W / 2, H / 2, '', { fontFamily: 'Segoe UI', fontSize: 48, color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);

    this._showCountdown();

    this.input.keyboard.on('keydown-SPACE', () => this._shoot());
    this.input.keyboard.on('keydown-V', () => {
      if (!this.gameStarted || this.gameOver) return;
      this._sendVibeToOpponent();
    });
  }

  _drawStars() {
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 0.6);
    const starRng = makeRng(this.seed ^ 0xa5a5a5a5);
    for (let i = 0; i < 80; i++) {
      g.fillRect(Math.floor(starRng() * W), Math.floor(starRng() * H), 1, 1);
    }
  }

  _showCountdown() {
    this.gameStarted = false;
    this._cdTimers = [];
    const target = this.startAt || (Date.now() + 3000);
    const tickAt = (when, label, after) => {
      const wait = Math.max(0, when - Date.now());
      const id = setTimeout(() => {
        this.banner?.setText(label);
        if (after) after();
      }, wait);
      this._cdTimers.push(id);
    };
    tickAt(target - 3000, '3');
    tickAt(target - 2000, '2');
    tickAt(target - 1000, '1');
    tickAt(target, 'GO!', () => {
      this._begin();
      const id = setTimeout(() => { this.banner?.setText(''); }, 700);
      this._cdTimers.push(id);
    });
    this.events.once('shutdown', () => this._cdTimers.forEach(clearTimeout));
  }

  _begin() {
    this.gameStarted = true;
    this.endsAt = Date.now() + ROUND_MS;
    this._spawnInvaderWave();
    this._scheduleSpawns();
  }

  _scheduleSpawns() {
    this._scheduleDebris();
    this.time.addEvent({ delay: 4000, loop: true, callback: () => this._spawnCivilian() });
    this.time.addEvent({ delay: 5500, loop: true, callback: () => this._spawnDecoy() });
    this.time.addEvent({ delay: 9000, loop: true, callback: () => this._spawnUfo() });
  }

  _scheduleDebris() {
    const elapsed = Math.max(0, Date.now() - (this.endsAt - ROUND_MS));
    const ratio = Math.min(1, elapsed / ROUND_MS);
    const delay = 1800 + (700 - 1800) * ratio;
    this.time.delayedCall(delay, () => {
      this._spawnDebris();
      if (!this.gameOver) this._scheduleDebris();
    });
  }

  _spawnInvaderWave() {
    this.wave++;
    const baseSpeed = Math.min(40 + (this.wave - 1) * 12, 130);
    const cols = 8, rows = 3;
    const xPad = 80, yTop = 70, dx = (W - xPad * 2) / (cols - 1), dy = 36;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const e = this.invaders.create(xPad + c * dx, yTop + r * dy, 'invader');
        e.setVelocityX(baseSpeed + rngRange(this.rng, 0, 30));
        e.setData('dir', this.rng() < 0.5 ? -1 : 1);
        e.body.setVelocityX(e.body.velocity.x * e.getData('dir'));
      }
    }
  }

  _spawnDebris() {
    if (this.gameOver) return;
    const x = rngRange(this.rng, 30, W - 30);
    const d = this.debris.create(x, -20, 'debris');
    d.setVelocityY(rngRange(this.rng, 140, 220));
    d.setVelocityX(rngRange(this.rng, -40, 40));
    d.setAngularVelocity(rngRange(this.rng, -180, 180));
  }

  _spawnCivilian() {
    if (this.gameOver) return;
    const fromLeft = this.rng() < 0.5;
    const y = rngRange(this.rng, 120, H - 200);
    const c = this.civilians.create(fromLeft ? -30 : W + 30, y, 'civilian');
    c.setVelocityX(fromLeft ? rngRange(this.rng, 80, 150) : -rngRange(this.rng, 80, 150));
    this.tweens.add({ targets: c, scaleY: 1.4, duration: 350, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  _spawnDecoy() {
    if (this.gameOver) return;
    const x = rngRange(this.rng, 30, W - 30);
    const d = this.decoys.create(x, -20, 'decoy');
    d.setVelocityY(rngRange(this.rng, 80, 130));
    d.setAngularVelocity(90 + Math.random() * 110);
  }

  _spawnUfo() {
    if (this.gameOver) return;
    if (this.rng() > 0.5) return;
    const fromLeft = this.rng() < 0.5;
    const u = this.ufos.create(fromLeft ? -40 : W + 40, rngRange(this.rng, 50, 100), 'ufo');
    u.setVelocityX(fromLeft ? 120 : -120);
  }

  _shoot() {
    if (!this.gameStarted || this.gameOver) return;
    const now = this.time.now;
    if (now - this.lastShotAt < 220) return;
    this.lastShotAt = now;
    const b = this.bullets.get(this.player.x, this.player.y - 14);
    if (!b) return;
    b.setActive(true).setVisible(true);
    if (b.body) {
      b.body.enable = true;
      b.body.reset(this.player.x, this.player.y - 14);
      b.body.setVelocityY(-450);
    }
    this.audio.shoot();
  }

  _hitInvader(bullet, enemy) {
    const [ex, ey] = [enemy.x, enemy.y];
    bullet.disableBody(true, true);
    enemy.disableBody(true, true);
    this._addScore(SCORES.invader);
    this._flashBanner('+10', '#ff77aa', ex, ey);
    this._spawnBurst(ex, ey, 0xff77aa);
    this.audio.invaderDie();
    this.onVibeOpponent(1);
    if (this.invaders.countActive(true) === 0) this._spawnInvaderWave();
  }

  _hitUfo(bullet, ufo) {
    const [ux, uy] = [ufo.x, ufo.y];
    bullet.disableBody(true, true);
    ufo.disableBody(true, true);
    this._addScore(SCORES.ufo);
    this._flashBanner('+100', '#ffcc44', ux, uy);
    this._spawnBurst(ux, uy, 0xffcc44, 10);
    this.audio.ufoDie();
    this.onVibeOpponent(5);
  }

  _hitCivilian(bullet, civ) {
    const [cx, cy] = [civ.x, civ.y];
    bullet.disableBody(true, true);
    civ.disableBody(true, true);
    this._addScore(SCORES.civilianHit);
    this._flashBanner('-50 CIVILIAN', '#ff5577', cx, cy);
    this._spawnBurst(cx, cy, 0x88ddff);
    this.audio.civilianDie();
    this._addVibeSeconds(2);
  }

  _hitByDebris(d) {
    const [dx, dy] = [d.x, d.y];
    d.disableBody(true, true);
    if (this.time.now < this.stunUntil) return;
    this.stunUntil = this.time.now + 600;
    this._addScore(SCORES.debrisHit);
    this.cameras.main.shake(150, 0.01);
    this.player.setTint(0xff5577);
    this.time.delayedCall(300, () => this.player.clearTint());
    this._spawnBurst(dx, dy, 0x886644);
    this.audio.debrisHit();
    this._addVibeSeconds(1);
  }

  _pickupDecoy(d) {
    const [dx, dy] = [d.x, d.y];
    d.disableBody(true, true);
    this._addScore(SCORES.decoyPickup);
    this._flashBanner('-30 DECOY', '#ff5577', dx, dy);
    this._spawnBurst(dx, dy, 0xffaa00);
    this.audio.decoyHit();
    this._addVibeSeconds(15);
  }

  _addScore(delta) {
    this.score = Math.max(0, this.score + delta);
    this.hudScore.setText(`${this.myName}: ${this.score}`);
    this.onScore(this.score);
  }

  _addVibeSeconds(n) {
    this.vibeSeconds += n;
    this.hudVibe.setText(`Vibe: ${Math.ceil(this.vibeSeconds)}s`);
    this.onVibeAdd(n);
  }

  _addVTime(n) {
    this.vTimeAccum += n;
    this.hudVTime?.setText(`V-time: ${this.vTimeAccum}s`);
    this.onVTimeAdd(n);
  }

  _sendVibeToOpponent() {
    if (this.score < 100) return;
    this._addScore(-100);
    this._addVTime(10);
    this._flashBanner('-100 → +10s forfeit', '#cc44ff');
  }

  extendClock(seconds) {
    this.endsAt += seconds * 1000;
  }

  _flashBanner(text, color, x, y) {
    x ??= this.player.x;
    y ??= this.player.y - 30;
    const t = this.add.text(x, y, text, { fontFamily: 'Segoe UI', fontSize: 16, color, fontStyle: 'bold' }).setOrigin(0.5);
    this.tweens.add({ targets: t, y: t.y - 30, alpha: 0, duration: 700, onComplete: () => t.destroy() });
  }

  _spawnBurst(x, y, colorHex, count = 6) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const dist = 20 + Math.random() * 30;
      const g = this.add.graphics();
      g.fillStyle(colorHex, 1);
      g.fillRect(-2, -2, 4, 4);
      g.x = x;
      g.y = y;
      this.tweens.add({
        targets: g,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        duration: 300 + Math.random() * 200,
        onComplete: () => g.destroy(),
      });
    }
  }

  setOpponentScore(v) {
    this.oppScore = v | 0;
    if (this.hudOpp) this.hudOpp.setText(`${this.opponentName}: ${this.oppScore}`);
  }

  update(time, delta) {
    if (!this.gameStarted) return;
    if (this.gameOver) return;

    if (this.vibeSeconds > 0) {
      this.vibeSeconds = Math.max(0, this.vibeSeconds - delta / 1000);
    }
    this.hudVibe.setText(`Vibe: ${Math.ceil(this.vibeSeconds)}s`);

    const stunned = this.time.now < this.stunUntil;
    if (!stunned) {
      const left  = this.cursors.left.isDown  || this.keys.A.isDown;
      const right = this.cursors.right.isDown || this.keys.D.isDown;
      this.player.setVelocityX(left ? -300 : right ? 300 : 0);
    } else {
      this.player.setVelocityX(0);
    }

    this.invaders.getChildren().forEach((e) => {
      if (!e || !e.active) return;
      if (e.x < 30 && e.body.velocity.x < 0) { e.body.setVelocityX(-e.body.velocity.x); e.y += 14; }
      if (e.x > W - 30 && e.body.velocity.x > 0) { e.body.setVelocityX(-e.body.velocity.x); e.y += 14; }
    });

    [this.bullets, this.debris, this.decoys, this.civilians, this.ufos].forEach((g) => {
      g.getChildren().forEach((c) => {
        if (!c || !c.active) return;
        if (c.y > H + 40 || c.y < -40 || c.x < -60 || c.x > W + 60) c.disableBody(true, true);
      });
    });

    const remaining = Math.max(0, this.endsAt - Date.now());
    this.hudTimer.setText(String(Math.ceil(remaining / 1000)));
    if (remaining <= 0) this._end();
  }

  _end() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.physics.pause();
    this.banner.setText('TIME!').setColor('#ffffff');
    this.onEnd(this.score);
  }
}
