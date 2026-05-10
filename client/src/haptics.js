import { ButtplugClient } from 'buttplug';
import { ButtplugWasmClientConnector } from 'buttplug-wasm/dist/buttplug-wasm.mjs';

let client = null;
let device = null;
let stopTimer = null;
let vibeSeconds = 0;
let vibeTickInterval = null;

export async function connect() {
  if (client) {
    try { await client.disconnect(); } catch {}
    client = null;
    device = null;
  }

  client = new ButtplugClient('Galactic Salvage');

  client.addListener('deviceadded', (dev) => {
    if (!device) device = dev;
  });
  client.addListener('deviceremoved', (dev) => {
    if (device && device.index === dev.index) device = null;
  });
  client.addListener('disconnect', () => {
    device = null;
    client = null;
  });

  await client.connect(new ButtplugWasmClientConnector());
  await client.startScanning();

  const already = client.devices;
  if (already.length > 0) {
    device = already[0];
    return device;
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
  if (!device) return;
  try { await device.vibrate(intensity); } catch {}
}

export async function pulse(intensity, durationMs) {
  if (!device) return;
  if (vibeSeconds > 0) return;
  clearTimeout(stopTimer);
  await vibe(intensity);
  stopTimer = setTimeout(() => {
    if (device && vibeSeconds <= 0) device.stop().catch(() => {});
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
        if (device) device.stop().catch(() => {});
      }
    }, 100);
  }
}

export const getVibeSeconds = () => vibeSeconds;

export async function winPattern() {
  if (!device) return;
  for (const [i, t, d] of [[0.4, 0, 200], [0.7, 350, 200], [1.0, 700, 300]]) {
    setTimeout(async () => {
      await vibe(i);
      setTimeout(() => { if (device) device.stop().catch(() => {}); }, d);
    }, t);
  }
}

export async function losePattern() {
  if (!device) return;
  await vibe(0.6);
  setTimeout(() => vibe(0.3), 600);
  setTimeout(() => { if (device) device.stop().catch(() => {}); }, 1200);
}

export const isConnected = () => device !== null;

let forfeitSeconds = 0;
let forfeitIntensity = 1.0;
let forfeitTickInterval = null;

export function startForfeitVibe(seconds) {
  if (!device) return;
  forfeitSeconds = seconds;
  vibe(forfeitIntensity);
  if (forfeitTickInterval) clearInterval(forfeitTickInterval);
  forfeitTickInterval = setInterval(() => {
    forfeitSeconds = Math.max(0, forfeitSeconds - 0.1);
    if (forfeitSeconds <= 0) {
      clearInterval(forfeitTickInterval);
      forfeitTickInterval = null;
      if (device) device.stop().catch(() => {});
    }
  }, 100);
}

let _intensityRaf = 0;
let _pendingIntensity = 1.0;

export function setForfeitIntensity(level) {
  forfeitIntensity = Math.max(0, Math.min(1, level));
  _pendingIntensity = forfeitIntensity;
  if (_intensityRaf) return;
  _intensityRaf = requestAnimationFrame(() => {
    _intensityRaf = 0;
    if (!forfeitTickInterval || !device) return;
    if (_pendingIntensity === 0) device.stop().catch(() => {});
    else device.vibrate(_pendingIntensity).catch(() => {});
  });
}

export const isForfeitActive = () => forfeitSeconds > 0;
export const getForfeitSeconds = () => forfeitSeconds;

export function pauseForfeitVibe() {
  if (forfeitTickInterval) { clearInterval(forfeitTickInterval); forfeitTickInterval = null; }
  if (device) device.stop().catch(() => {});
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
        if (device) device.stop().catch(() => {});
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
  if (_testRaf) return;
  _testRaf = requestAnimationFrame(() => {
    _testRaf = 0;
    if (!device) return;
    if (_testLevel === 0) device.stop().catch(() => {});
    else device.vibrate(_testLevel).catch(() => {});
  });
}

export function stopAll() {
  if (vibeTickInterval)    { clearInterval(vibeTickInterval);    vibeTickInterval    = null; }
  if (forfeitTickInterval) { clearInterval(forfeitTickInterval); forfeitTickInterval = null; }
  if (shootVibeInterval)   { clearInterval(shootVibeInterval);   shootVibeInterval   = null; }
  vibeSeconds    = 0;
  forfeitSeconds = 0;
  shootVibeSeconds = 0;
  if (device) device.stop().catch(() => {});
}
