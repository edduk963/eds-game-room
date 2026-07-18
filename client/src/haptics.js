import { ButtplugClient, ButtplugBrowserWebsocketClientConnector } from 'buttplug';
import { ButtplugWasmClientConnector } from 'buttplug-wasm/dist/buttplug-wasm.mjs';
import { getVibeMode as _getVibeMode, setVibeMode as _setVibeMode, createVibeModeDriver, vibeModeLabel, VIBE_MODES } from './vibeModes.js';

export { VIBE_MODES };
export const getVibeMode = _getVibeMode;

export function setVibeMode(id) {
  _setVibeMode(id);
  if (_waveVibeMode) _modeDriver = createVibeModeDriver(id);
}

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
let _modeDriver = null;

export function setWaveVibeMode(enabled) {
  _waveVibeMode = enabled;
  _modeDriver = enabled ? createVibeModeDriver(_getVibeMode()) : null;
}

function waveIntensity(base) {
  if (!_modeDriver) _modeDriver = createVibeModeDriver(_getVibeMode());
  return Math.max(0, Math.min(1, _modeDriver.sample(100, base)));
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

let continuousLevel = 0;
let continuousInterval = null;

// An indefinite background vibe that runs until explicitly stopped — distinct from the
// countdown-based forfeit/vibe/shoot channels above. Used for Conquest's Secret Trap (flat
// intensity, no pattern) and its match-end winner-controlled vibe (respects wave/pattern mode
// via the same setWaveVibeMode/setVibeMode toggles the forfeit channel uses, so a selected
// pattern is audible here too). Calling again while already running just updates the level —
// the next 500ms tick picks it up, so a live slider can drive this without restarting it.
export function startContinuousVibe(intensity) {
  continuousLevel = Math.max(0, Math.min(1, intensity));
  if (!continuousInterval) {
    vibe(_waveVibeMode ? waveIntensity(continuousLevel) : continuousLevel);
    continuousInterval = setInterval(() => {
      if (performance.now() < missSpikeUntil) return;
      vibe(_waveVibeMode ? waveIntensity(continuousLevel) : continuousLevel);
    }, 500);
  }
}

export function stopContinuousVibe() {
  if (continuousInterval) { clearInterval(continuousInterval); continuousInterval = null; }
  continuousLevel = 0;
  if (vibeSeconds <= 0 && forfeitSeconds <= 0 && shootVibeSeconds <= 0) stopAllDevices();
}

// Escalating ramp toward a forced climax cue, then a flat lower-intensity cooldown —
// Conquest's "The Reckoning" end-of-match effect.
export function triggerReckoning(postCumSeconds = 180) {
  let lvl = 0.5;
  setWaveVibeMode(false);
  addShootVibe(lvl, 6);
  const ramp = setInterval(() => {
    lvl = Math.min(1, lvl + 0.1);
    addShootVibe(lvl, 1);
    if (lvl >= 1) {
      clearInterval(ramp);
      setTimeout(() => {
        startForfeitVibe(postCumSeconds);
        setForfeitIntensity(0.3);
      }, 1500);
    }
  }, 1000);
}

export const getWaveState = () => _waveVibeMode ? vibeModeLabel(_getVibeMode()) : 'Steady';

export function stopAll() {
  if (vibeTickInterval)    { clearInterval(vibeTickInterval);    vibeTickInterval    = null; }
  if (forfeitTickInterval) { clearInterval(forfeitTickInterval); forfeitTickInterval = null; }
  if (shootVibeInterval)   { clearInterval(shootVibeInterval);   shootVibeInterval   = null; }
  if (continuousInterval)  { clearInterval(continuousInterval);  continuousInterval  = null; }
  vibeSeconds    = 0;
  forfeitSeconds = 0;
  shootVibeSeconds = 0;
  continuousLevel = 0;
  _waveVibeMode = false;
  stopAllDevices();
}
