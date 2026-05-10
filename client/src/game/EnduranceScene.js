import Phaser from 'phaser';
import { makeRng, rngRange } from './seededRng.js';
import { GameAudio } from './audio.js';

const W = 800;
const H = 600;
const ROUND_MS = 90_000;

// Alien tiers: { key, color, pts, passPenalty }
const TIERS = [
  { key: 'e-small',  color: 0xff77aa, w: 24, h: 16, pts: 5,  passPenalty: 10 },
  { key: 'e-medium', color: 0xff9933, w: 30, h: 20, pts: 15, passPenalty: 25 },
  { key: 'e-large',  color: 0xffcc44, w: 36, h: 24, pts: 30, passPenalty: 50 },
];

const BASE_SPEED = 40;
const DESCENT_STEP = 28;
const COL_SPACING = 52;
const ROW_SPACING = 38;
const FORMATION_Y = 55;

// Each entry: [colOffset, rowOffset, tierIndex]  (row 0 = top/farthest, higher row = closer to player)
const PATTERNS = [
  // V-chevron — wide top, single large tip at bottom (player hits tip first)
  [
    [-4,0,0],[-3,0,0],[-2,0,0],[-1,0,0],[0,0,0],[1,0,0],[2,0,0],[3,0,0],[4,0,0],
    [-3,1,0],[-2,1,0],[-1,1,0],[0,1,0],[1,1,0],[2,1,0],[3,1,0],
    [-2,2,1],[-1,2,1],[0,2,1],[1,2,1],[2,2,1],
    [-1,3,1],[0,3,1],[1,3,1],
    [0,4,2],
  ],
  // Arrowhead — large tip at top, wide small base at bottom (player clears wide base first)
  [
    [0,0,2],
    [-1,1,1],[0,1,1],[1,1,1],
    [-2,2,0],[-1,2,0],[0,2,0],[1,2,0],[2,2,0],
    [-3,3,0],[-2,3,0],[-1,3,0],[0,3,0],[1,3,0],[2,3,0],[3,3,0],
    [-4,4,0],[-3,4,0],[-2,4,0],[-1,4,0],[0,4,0],[1,4,0],[2,4,0],[3,4,0],[4,4,0],
  ],
  // Diamond — narrow tips top and bottom, widest in middle
  [
    [0,0,0],
    [-2,1,0],[-1,1,0],[0,1,0],[1,1,0],[2,1,0],
    [-3,2,1],[-2,2,1],[-1,2,1],[0,2,2],[1,2,1],[2,2,1],[3,2,1],
    [-2,3,0],[-1,3,0],[0,3,0],[1,3,0],[2,3,0],
    [0,4,0],
  ],
  // Split wings — two clusters with a gap, large in the centre gap
  [
    [-5,0,0],[-4,0,0],[-3,0,0],[-2,0,0], [2,0,0],[3,0,0],[4,0,0],[5,0,0],
    [-4,1,0],[-3,1,1],[-2,1,0],          [2,1,0],[3,1,1],[4,1,0],
    [-3,2,0],[-2,2,0],                   [2,2,0],[3,2,0],
    [0,1,2],
  ],
];

export class EnduranceScene extends Phaser.Scene {
  constructor() { super('endurance'); }

  init(data) {
    this.seed = data.seed >>> 0;
    this.startAt = data.startAt;
    this.onScore = data.onScore || (() => {});
    this.onEnd = data.onEnd || (() => {});
    this.onShootVibe = data.onShootVibe || (() => {});
    this.onVTimeAdd = data.onVTimeAdd || (() => {});
    this.onShootVibeActive = data.onShootVibeActive || (() => false);
    this.onVibeOpponent = data.onVibeOpponent || (() => {});
    this.opponentName = data.opponentName || 'Opponent';
    this.myName = data.myName || 'You';
  }

  preload() {
    this._mkRect('player',    36, 18, 0x5cffd4);
    this._mkRect('bullet',     4, 12, 0xffffff);
    for (const t of TIERS) this._mkRect(t.key, t.w, t.h, t.color);
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
    this.wave = 0;
    this.alienSpeed = BASE_SPEED;
    this.vTimeAccum = 0;
    this.shotStack = 0;
    this._waveQueued = false;
    this.audio = new GameAudio();

    this.cameras.main.setBackgroundColor('#0a0e1a');
    this._drawStars();

    this.player = this.physics.add.sprite(W / 2, H - 40, 'player');
    this.player.setCollideWorldBounds(true);

    this.bullets = this.physics.add.group({ defaultKey: 'bullet', maxSize: 30 });
    this.aliens  = this.physics.add.group();

    this.physics.add.overlap(this.bullets, this.aliens, (b, a) => this._hitAlien(b, a));

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('A,D,SPACE');
    this.lastShotAt = 0;

    this.hudScore  = this.add.text(16, 12,  `${this.myName}: 0`,         { fontFamily: 'Segoe UI', fontSize: 20, color: '#5cffd4' });
    this.hudVTime  = this.add.text(16, 36,  'V-time: 0s',                { fontFamily: 'Segoe UI', fontSize: 14, color: '#ffaa00' });
    this.hudOpp    = this.add.text(W - 16, 12, `${this.opponentName}: 0`,{ fontFamily: 'Segoe UI', fontSize: 20, color: '#ffcc44' }).setOrigin(1, 0);
    this.hudTimer  = this.add.text(W / 2, 12, '90',                      { fontFamily: 'Segoe UI', fontSize: 24, color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.banner    = this.add.text(W / 2, H / 2, '',                     { fontFamily: 'Segoe UI', fontSize: 48, color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);

    this._showCountdown();

    this.input.keyboard.on('keydown-SPACE', () => this._shoot());
    this.input.keyboard.on('keydown-V', () => {
      if (!this.gameStarted || this.gameOver) return;
      this._addVTime(10);
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
    this._spawnWave();
  }

  _spawnWave() {
    if (this.gameOver) return;
    this.wave++;

    const pattern = PATTERNS[(this.wave - 1) % PATTERNS.length];
    const cx = W / 2;

    for (const [col, row, tierIdx] of pattern) {
      const tier = TIERS[tierIdx];
      const x = cx + col * COL_SPACING;
      const y = FORMATION_Y + row * ROW_SPACING;
      const alien = this.aliens.create(x, y, tier.key);
      alien.setData('tier', tier);
      alien.setData('dir', 1);
      alien.setVelocityX(this.alienSpeed);
    }
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

    // Shot recoil vibe stacking
    if (!this.onShootVibeActive()) this.shotStack = 0;
    this.shotStack++;
    const intensity = Math.min(1.0, 0.50 + (this.shotStack - 1) * 0.05);
    this.onShootVibe(intensity, 0.5);
  }

  _hitAlien(bullet, alien) {
    if (!bullet.active || !alien.active) return;
    const tier = alien.getData('tier');
    const [ax, ay] = [alien.x, alien.y];
    bullet.disableBody(true, true);
    alien.disableBody(true, true);
    this._addScore(tier.pts);
    this._flashBanner(`+${tier.pts}`, tier.color === 0xff77aa ? '#ff77aa' : tier.color === 0xff9933 ? '#ff9933' : '#ffcc44', ax, ay);
    this._spawnBurst(ax, ay, tier.color);
    this.audio.invaderDie();
    if (this.aliens.countActive(true) === 0 && !this._waveQueued) {
      this._waveQueued = true;
      this.time.delayedCall(600, () => { this._waveQueued = false; if (!this.gameOver) this._spawnWave(); });
    }
  }

  _addScore(delta) {
    this.score = Math.max(0, this.score + delta);
    this.hudScore.setText(`${this.myName}: ${this.score}`);
    this.onScore(this.score);
  }

  _addVTime(n) {
    if (this.score < 100) return;
    this._addScore(-100);
    this.vTimeAccum += n;
    this.hudVTime.setText(`V-time: ${this.vTimeAccum}s`);
    this.onVTimeAdd(n);
    this.onVibeOpponent(5);
    this._flashBanner('-100 → +10s forfeit', '#cc44ff');
  }

  setOpponentScore(v) {
    this.oppScore = v;
    this.hudOpp.setText(`${this.opponentName}: ${v}`);
  }

  update() {
    if (!this.gameStarted || this.gameOver) return;

    // Move player
    const speed = 280;
    const left  = this.cursors.left.isDown  || this.keys.A.isDown;
    const right = this.cursors.right.isDown || this.keys.D.isDown;
    this.player.setVelocityX(left ? -speed : right ? speed : 0);

    // Space shoot (held)
    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) this._shoot();

    // Timer display
    const remaining = Math.max(0, (this.endsAt - Date.now()) / 1000);
    this.hudTimer.setText(Math.ceil(remaining).toString());
    if (remaining <= 0) { this._end(); return; }

    // Time-based speed ramp: 40 → 260 over 90 seconds, accelerates toward the end
    const t = 1 - remaining / (ROUND_MS / 1000);
    this.alienSpeed = BASE_SPEED + Math.pow(t, 1.5) * 220;

    // Move alien grid — when any alien hits the wall, reverse all and descend
    let shouldReverse = false;
    this.aliens.getChildren().forEach(alien => {
      if (!alien.active) return;
      if (alien.x >= W - 40 && alien.getData('dir') === 1) shouldReverse = true;
      if (alien.x <= 40    && alien.getData('dir') === -1) shouldReverse = true;
    });

    if (shouldReverse) {
      this.aliens.getChildren().forEach(alien => {
        if (!alien.active) return;
        alien.setData('dir', -alien.getData('dir'));
      });
      this.aliens.getChildren().forEach(alien => {
        if (!alien.active) return;
        alien.y += DESCENT_STEP;
      });
    }

    // Apply current speed to all active aliens every frame
    this.aliens.getChildren().forEach(alien => {
      if (!alien.active) return;
      alien.setVelocityX(this.alienSpeed * alien.getData('dir'));
    });

    // Check if any alien passed the player — deduct points, no vibe
    let alienPassedThisFrame = false;
    this.aliens.getChildren().forEach(alien => {
      if (!alien.active) return;
      if (alien.y > this.player.y) {
        const tier = alien.getData('tier');
        alien.disableBody(true, true);
        this.cameras.main.shake(200, 0.015);
        this._addScore(-tier.passPenalty);
        this._flashBanner(`-${tier.passPenalty}`, '#ff3333', alien.x, this.player.y - 20);
        alienPassedThisFrame = true;
      }
    });
    // If the last alien(s) passed this frame, spawn next wave
    if (alienPassedThisFrame && this.aliens.countActive(true) === 0 && !this._waveQueued) {
      this._waveQueued = true;
      this.time.delayedCall(400, () => { this._waveQueued = false; if (!this.gameOver) this._spawnWave(); });
    }

    // Clean up bullets that left the screen
    this.bullets.getChildren().forEach(b => {
      if (b.active && b.y < -20) b.disableBody(true, true);
    });
  }

  pauseScene() {
    if (!this.gameStarted || this.gameOver || this._edgePaused) return;
    this._edgePaused = true;
    this._edgePausedAt = Date.now();
    this.physics.pause();
    this.time.paused = true;
  }

  resumeScene() {
    if (!this._edgePaused) return;
    this._edgePaused = false;
    const elapsed = Date.now() - this._edgePausedAt;
    this.endsAt += elapsed;
    this.time.paused = false;
    this.physics.resume();
  }

  _end() {
    if (this.gameOver) return;
    this.gameOver = true;
    this.physics.pause();
    this.banner.setText('TIME!');
    this.onEnd(this.score);
  }

  _flashBanner(text, color, x, y) {
    x ??= this.player.x;
    y ??= H / 2;
    const t = this.add.text(x, y, text, { fontFamily: 'Segoe UI', fontSize: 18, color, fontStyle: 'bold' }).setOrigin(0.5);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 800, onComplete: () => t.destroy() });
  }

  _spawnBurst(x, y, color) {
    const g = this.add.graphics();
    g.fillStyle(color, 0.8);
    for (let i = 0; i < 6; i++) {
      g.fillRect(x + rngRange(this.rng, -16, 16), y + rngRange(this.rng, -16, 16), 4, 4);
    }
    this.tweens.add({ targets: g, alpha: 0, duration: 400, onComplete: () => g.destroy() });
  }
}
