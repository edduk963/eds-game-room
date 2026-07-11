import { ButtplugClient, ButtplugBrowserWebsocketClientConnector } from 'buttplug';
import { ButtplugWasmClientConnector } from 'buttplug-wasm/dist/buttplug-wasm.mjs';

let client = null;
let devices = [];
let stopTimer = null;
let vibeSeconds = 0;
let vibeTickInterval = null;
let missSpikeUntil = 0; // timestamp until which an explicit pulse() should win over ambient loops

function stopAllDevices() {
  devices.forEach(d => d.stop().catch(() => {}));
}

export async function connect(mode = 'bluetooth') {
  if (client) {
    try { await client.disconnect(); } catch {}
    client = null;
    devices = [];
  }

  client = new ButtplugClient("Ed's Game Room");

  client.addListener('deviceadded', (dev) => {
    devices.push(dev);
  });
  client.addListener('deviceremoved', (dev) => {
    devices = devices.filter(d => d.index !== dev.index);
  });
  client.addListener('disconnect', () => {
    devices = [];
    client = null;
  });

  const connector = mode === 'intiface'
    ? new ButtplugBrowserWebsocketClientConnector('ws://localhost:12345')
    : new ButtplugWasmClientConnector();
  await client.connect(connector);
  await client.startScanning();

  const already = client.devices;
  if (already.length > 0) {
    devices = [...already];
    return devices[0];
  }

  return new Promise((resolve) => {
    const onAdded = (dev) => {
      client.removeListener('deviceadded', onAdded);
      resolve(dev);
    };
    client.addListener('deviceadded', onAdded);
    setTimeout(() => {
      client.removeListener('deviceadded', onAdded);
      resolve(null);
    }, 30_000);
  });
}

async function vibe(intensity) {
  if (devices.length === 0) return;
  await Promise.all(devices.map(d => d.vibrate(intensity).catch(() => {})));
}

export async function pulse(intensity, durationMs) {
  if (devices.length === 0) return;
  if (vibeSeconds > 0) return;
  clearTimeout(stopTimer);
  // Win over any ambient loop (e.g. forfeit vibe) for the pulse's duration, so an
  // explicit pulse is never immediately overwritten by a concurrent 100ms tick.
  missSpikeUntil = performance.now() + durationMs;
  await vibe(intensity);
  stopTimer = setTimeout(() => {
    missSpikeUntil = 0;
    if (vibeSeconds <= 0 && forfeitSeconds <= 0 && shootVibeSeconds <= 0) stopAllDevices();
  }, durationMs);
}

export function addVibeSeconds(n) {
  vibeSeconds = Math.max(0, vibeSeconds + n);
  if (!vibeTickInterval) {
    vibe(1.0);
    vibeTickInterval = setInterval(() => {
      vibeSeconds = Math.max(0, vibeSeconds - 0.1);
      if (vibeSeconds <= 0) {
        clearInterval(vibeTickInterval);
        vibeTickInterval = null;
        stopAllDevices();
      }
    }, 100);
  }
}

export const getVibeSeconds = () => vibeSeconds;

export async function winPattern() {
  if (devices.length === 0) return;
  for (const [i, t, d] of [[0.4, 0, 200], [0.7, 350, 200], [1.0, 700, 300]]) {
    setTimeout(async () => {
      await vibe(i);
      setTimeout(() => stopAllDevices(), d);
    }, t);
  }
}

export async function losePattern() {
  if (devices.length === 0) return;
  await vibe(0.6);
  setTimeout(() => vibe(0.3), 600);
  setTimeout(() => stopAllDevices(), 1200);
}

export const isConnected = () => devices.length > 0;

export async function getBattery() {
  const d = devices.find(d => d.hasBattery);
  if (!d) return null;
  try { return Math.round((await d.battery()) * 100); } catch { return null; }
}

let forfeitSeconds = 0;
let forfeitIntensity = 1.0;
let forfeitTickInterval = null;
let _waveVibeMode = false;
let _wavePhase    = 0;   // ticks within current state
let _waveState    = 'steady'; // 'steady' | 'oscillate' | 'pulse'
let _waveStateTicks = 0;
let _waveStateMax   = 40;

function _pickWaveState(exclude) {
  const pool = ['steady', 'oscillate', 'pulse'].filter(s => s !== exclude);
  _waveState = pool[Math.floor(Math.random() * pool.length)];
  _wavePhase = 0;
  _waveStateTicks = 0;
  if (_waveState === 'steady')    _waveStateMax = 30  + Math.floor(Math.random() * 1770); // 3–180s
  if (_waveState === 'oscillate') _waveStateMax = 50  + Math.floor(Math.random() * 1150); // 5–120s
  if (_waveState === 'pulse')     _waveStateMax = 40  + Math.floor(Math.random() * 560);  // 4–60s
}

export function setWaveVibeMode(enabled) {
  _waveVibeMode = enabled;
  if (enabled) _pickWaveState(null);
}

function waveIntensity(base) {
  _waveStateTicks++;
  _wavePhase++;
  if (_waveStateTicks >= _waveStateMax) _pickWaveState(_waveState);

  if (_waveState === 'steady') return base;

  if (_waveState === 'oscillate') {
    // smooth sine: 50%–100% of max, ~4.8s period
    const wave = 0.75 + 0.25 * Math.sin(_wavePhase * 0.1 * 1.3);
    return Math.max(0, Math.min(1, base * wave));
  }

  if (_waveState === 'pulse') {
    // 70%–100% toggle: 20 ticks (2s) at each level
    const high = Math.floor(_wavePhase / 20) % 2 === 0;
    return base * (high ? 1.0 : 0.7);
  }

  return base;
}

export function startForfeitVibe(seconds) {
  if (devices.length === 0) return;
  forfeitSeconds = seconds;
  vibe(forfeitIntensity);
  if (forfeitTickInterval) clearInterval(forfeitTickInterval);
  forfeitTickInterval = setInterval(() => {
    forfeitSeconds = Math.max(0, forfeitSeconds - 0.1);
    if (forfeitSeconds <= 0) {
      clearInterval(forfeitTickInterval);
      forfeitTickInterval = null;
      stopAllDevices();
    } else if (performance.now() < missSpikeUntil) {
      // an explicit pulse() is mid-flight — don't stomp it
    } else if (_waveVibeMode) {
      _wavePhase++;
      vibe(waveIntensity(forfeitIntensity));
    } else {
      vibe(forfeitIntensity);
    }
  }, 100);
}

let _intensityRaf = 0;
let _pendingIntensity = 1.0;

export function setForfeitIntensity(level) {
  forfeitIntensity = Math.max(0, Math.min(1, level));
  _pendingIntensity = forfeitIntensity;
  if (_pendingIntensity === 0) {
    if (_intensityRaf) { cancelAnimationFrame(_intensityRaf); _intensityRaf = 0; }
    stopAllDevices();
    return;
  }
  if (_intensityRaf) return;
  _intensityRaf = requestAnimationFrame(() => {
    _intensityRaf = 0;
    if (devices.length === 0 || !forfeitTickInterval || _pendingIntensity === 0) return;
    vibe(_pendingIntensity).then(() => {
      if (_pendingIntensity === 0) stopAllDevices();
    });
  });
}

export function addForfeitSeconds(n) {
  if (devices.length === 0) return;
  forfeitSeconds += n;
  vibe(_waveVibeMode ? waveIntensity(forfeitIntensity) : forfeitIntensity);
  if (!forfeitTickInterval) {
    forfeitTickInterval = setInterval(() => {
      forfeitSeconds = Math.max(0, forfeitSeconds - 0.1);
      if (forfeitSeconds <= 0) {
        clearInterval(forfeitTickInterval);
        forfeitTickInterval = null;
        stopAllDevices();
      } else if (performance.now() < missSpikeUntil) {
        // an explicit pulse() is mid-flight — don't stomp it
      } else if (_waveVibeMode) {
        _wavePhase++;
        vibe(waveIntensity(forfeitIntensity));
      } else {
        vibe(forfeitIntensity);
      }
    }, 100);
  }
}

export const isForfeitActive = () => forfeitSeconds > 0;
export const getForfeitSeconds = () => forfeitSeconds;

export function pauseForfeitVibe() {
  if (forfeitTickInterval) { clearInterval(forfeitTickInterval); forfeitTickInterval = null; }
  _waveVibeMode = false;
  stopAllDevices();
}

let shootVibeSeconds = 0;
let shootVibeIntensity = 0;
let shootVibeInterval = null;

export function addShootVibe(intensity, seconds) {
  shootVibeSeconds = Math.max(0, shootVibeSeconds + seconds);
  shootVibeIntensity = Math.min(1, Math.max(0, intensity));
  if (!shootVibeInterval) {
    vibe(shootVibeIntensity);
    shootVibeInterval = setInterval(() => {
      shootVibeSeconds = Math.max(0, shootVibeSeconds - 0.1);
      if (shootVibeSeconds <= 0) {
        clearInterval(shootVibeInterval); shootVibeInterval = null;
        stopAllDevices();
      }
    }, 100);
  } else {
    vibe(shootVibeIntensity);
  }
}

export const isShootVibeActive = () => shootVibeSeconds > 0;

let _testRaf = 0;
let _testLevel = 0;

export function testVibe(level) {
  _testLevel = Math.max(0, Math.min(1, level));
  if (_testLevel === 0) {
    if (_testRaf) { cancelAnimationFrame(_testRaf); _testRaf = 0; }
    stopAllDevices();
    return;
  }
  if (_testRaf) return;
  _testRaf = requestAnimationFrame(() => {
    _testRaf = 0;
    if (devices.length === 0 || _testLevel === 0) return;
    vibe(_testLevel).then(() => {
      if (_testLevel === 0) stopAllDevices();
    });
  });
}

export function pauseHaptics() {
  const saved = { vibeSeconds, forfeitSeconds, shootVibeSeconds };
  if (vibeTickInterval)    { clearInterval(vibeTickInterval);    vibeTickInterval    = null; }
  if (forfeitTickInterval) { clearInterval(forfeitTickInterval); forfeitTickInterval = null; }
  if (shootVibeInterval)   { clearInterval(shootVibeInterval);   shootVibeInterval   = null; }
  vibeSeconds = 0; forfeitSeconds = 0; shootVibeSeconds = 0;
  stopAllDevices();
  return saved;
}

export function resumeHaptics(saved) {
  if (!saved) return;
  if (saved.vibeSeconds > 0) addVibeSeconds(saved.vibeSeconds);
  if (saved.forfeitSeconds > 0) startForfeitVibe(saved.forfeitSeconds);
  if (saved.shootVibeSeconds > 0) addShootVibe(shootVibeIntensity || 0.5, saved.shootVibeSeconds);
}

export function setBtdVibe(intensity) {
  if (devices.length === 0) return;
  const level = Math.max(0, Math.min(1, intensity));
  if (level === 0) {
    stopAllDevices();
  } else {
    vibe(level);
  }
}

export const getWaveState = () => _waveVibeMode ? _waveState : 'steady';

export function stopAll() {
  if (vibeTickInterval)    { clearInterval(vibeTickInterval);    vibeTickInterval    = null; }
  if (forfeitTickInterval) { clearInterval(forfeitTickInterval); forfeitTickInterval = null; }
  if (shootVibeInterval)   { clearInterval(shootVibeInterval);   shootVibeInterval   = null; }
  vibeSeconds    = 0;
  forfeitSeconds = 0;
  shootVibeSeconds = 0;
  _waveVibeMode = false;
  stopAllDevices();
}
