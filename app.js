// --- SERVICE WORKER REGISTRATION ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// --- SCREEN WAKE LOCK ---
let wakeLock = null;
const wakeStatusEl = document.getElementById('wakeStatus');

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeStatusEl.textContent = 'Screen Wake Lock: Active';
      wakeLock.addEventListener('release', () => {
        wakeStatusEl.textContent = 'Screen Wake Lock: Paused';
      });
    } else {
      wakeStatusEl.textContent = 'Wake Lock: Unsupported';
    }
  } catch (err) {
    wakeStatusEl.textContent = 'Wake Lock: Tap screen to activate';
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});
requestWakeLock();

// --- CANVAS & RETINA SETUP ---
const canvas = document.getElementById('swarmCanvas');
const ctx = canvas.getContext('2d');
let width, height;

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);
}
window.addEventListener('resize', resize);
resize();

// --- CONFIGURATION, PRESETS & PALETTES ---
const palettes = {
  cyan: ['#00f2fe', '#4facfe', '#a1c4fd', '#ffffff'],
  ember: ['#ff0844', '#ffb199', '#ff758c', '#ffd1ff'],
  aurora: ['#b224ef', '#7579ff', '#00dbde', '#fc00ff'],
  mono: ['#ffffff', '#d0d0d5', '#8e8e93', '#555558'],
  custom: ['#00f2fe', '#ff0844', '#ffffff', '#00f2fe']
};

const presets = {
  flock:  { align: 1.0, cohesion: 0.85, separation: 1.45, perception: 55, force: 0.08, vortex: 0.0,  trail: 0.24 },
  vortex: { align: 0.6, cohesion: 0.30, separation: 1.30, perception: 50, force: 0.12, vortex: 0.14, trail: 0.18 },
  drift:  { align: 0.8, cohesion: 0.60, separation: 1.80, perception: 75, force: 0.03, vortex: 0.0,  trail: 0.15 },
  hive:   { align: 0.3, cohesion: 1.40, separation: 1.10, perception: 40, force: 0.18, vortex: 0.0,  trail: 0.32 }
};

const config = {
  count: 180,
  baseSpeed: 4.0,
  behavior: 'flock',
  palette: 'cyan',
  repelMode: true,
  audioEnabled: false
};

// --- AUDIO REACTIVE ENGINE (MICROPHONE) ---
let audioCtx = null;
let analyser = null;
let dataArray = null;
let micStream = null;
let audioEnergy = 0;

async function toggleAudio(enable) {
  if (enable) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(micStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      config.audioEnabled = true;
    } catch (err) {
      alert('Microphone permission is needed to hear your speakers.');
      document.getElementById('audioToggle').checked = false;
      config.audioEnabled = false;
    }
  } else {
    config.audioEnabled = false;
    audioEnergy = 0;
    if (micStream) {
      micStream.getTracks().forEach(track => track.stop());
      micStream = null;
    }
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }
  }
}

function updateAudioEnergy() {
  if (!config.audioEnabled || !analyser) {
    audioEnergy *= 0.9;
    return;
  }
  analyser.getByteFrequencyData(dataArray);
  let sum = 0;
  const bins = 16;
  for (let i = 0; i < bins; i++) {
    sum += dataArray[i];
  }
  const normalized = (sum / bins) / 255;
  audioEnergy = audioEnergy * 0.65 + normalized * 0.35;
}

// --- TOUCH / SCATTER INTERACTION ---
const touchPoint = { x: 0, y: 0, active: false, pulse: 0 };

function triggerTouch(x, y) {
  touchPoint.x = x;
  touchPoint.y = y;
  touchPoint.active = true;
  touchPoint.pulse = 1.0;
  revealGearIcon();
  if (!wakeLock) requestWakeLock();
}

canvas.addEventListener('pointerdown', (e) => triggerTouch(e.clientX, e.clientY));
canvas.addEventListener('pointermove', (e) => {
  if (touchPoint.active) {
    touchPoint.x = e.clientX;
    touchPoint.y = e.clientY;
  }
});
canvas.addEventListener('pointerup', () => {
  touchPoint.active = false;
});

// --- BOID CLASS ---
class Boid {
  constructor() {
    this.pos = { x: Math.random() * width, y: Math.random() * height };
    const angle = Math.random() * Math.PI * 2;
    this.vel = { x: Math.cos(angle) * 2, y: Math.sin(angle) * 2 };
    this.acc = { x: 0, y: 0 };
    this.baseSize = Math.random() * 1.8 + 1.4;
    this.colorIndex = Math.floor(Math.random() * 4);
  }

  edges() {
    const margin = 40;
    const turnFactor = 0.25;
    if (this.pos.x < margin) this.acc.x += turnFactor;
    if (this.pos.x > width - margin) this.acc.x -= turnFactor;
    if (this.pos.y < margin) this.acc.y += turnFactor;
    if (this.pos.y > height - margin) this.acc.y -= turnFactor;
  }

  flock(boids, preset, currentMaxSpeed) {
    let align = { x: 0, y: 0 };
    let cohesion = { x: 0, y: 0 };
    let separation = { x: 0, y: 0 };
    let total = 0;

    const dynamicPerception = preset.perception * (1 + audioEnergy * 0.5);

    for (let other of boids) {
      if (other === this) continue;
      const dx = other.pos.x - this.pos.x;
      const dy = other.pos.y - this.pos.y;
      const d = Math.hypot(dx, dy);

      if (d > 0 && d < dynamicPerception) {
        align.x += other.vel.x;
        align.y += other.vel.y;

        cohesion.x += other.pos.x;
        cohesion.y += other.pos.y;

        if (d < dynamicPerception * 0.45) {
          separation.x -= dx / d;
          separation.y -= dy / d;
        }
        total++;
      }
    }

    if (total > 0) {
      align.x /= total;
      align.y /= total;
      this.steer(align, preset.align, currentMaxSpeed, preset.force);

      cohesion.x = (cohesion.x / total) - this.pos.x;
      cohesion.y = (cohesion.y / total) - this.pos.y;
      this.steer(cohesion, preset.cohesion, currentMaxSpeed, preset.force);

      this.steer(separation, preset.separation + (audioEnergy * 1.2), currentMaxSpeed, preset.force);
    }

    if (preset.vortex > 0) {
      const cx = width / 2;
      const cy = height / 2;
      const dx = cx - this.pos.x;
      const dy = cy - this.pos.y;
      const dist = Math.hypot(dx, dy) || 1;
      const tangentX = -dy / dist;
      const tangentY = dx / dist;
      this.acc.x += (tangentX * preset.vortex) + (dx / dist) * (preset.vortex * 0.35);
      this.acc.y += (tangentY * preset.vortex) + (dy / dist) * (preset.vortex * 0.35);
    }

    if (touchPoint.active || touchPoint.pulse > 0.05) {
      const dx = this.pos.x - touchPoint.x;
      const dy = this.pos.y - touchPoint.y;
      const d = Math.hypot(dx, dy);
      const radius = 190;

      if (d < radius && d > 0) {
        const force = ((radius - d) / radius) * 0.9;
        const dir = config.repelMode ? 1 : -1;
        this.acc.x += (dx / d) * force * dir;
        this.acc.y += (dy / d) * force * dir;
      }
    }
  }

  steer(target, weight, maxSpeed, maxForce) {
    const mag = Math.hypot(target.x, target.y);
    if (mag === 0) return;
    target.x = (target.x / mag) * maxSpeed - this.vel.x;
    target.y = (target.y / mag) * maxSpeed - this.vel.y;

    const steerMag = Math.hypot(target.x, target.y);
    if (steerMag > maxForce) {
      target.x = (target.x / steerMag) * maxForce;
      target.y = (target.y / steerMag) * maxForce;
    }
    this.acc.x += target.x * weight;
    this.acc.y += target.y * weight;
  }

  update(currentMaxSpeed) {
    this.vel.x += this.acc.x;
    this.vel.y += this.acc.y;

    const speed = Math.hypot(this.vel.x, this.vel.y);
    if (speed > currentMaxSpeed) {
      this.vel.x = (this.vel.x / speed) * currentMaxSpeed;
      this.vel.y = (this.vel.y / speed) * currentMaxSpeed;
    } else if (speed < currentMaxSpeed * 0.4) {
      this.vel.x = (this.vel.x / speed) * (currentMaxSpeed * 0.4);
      this.vel.y = (this.vel.y / speed) * (currentMaxSpeed * 0.4);
    }

    this.pos.x += this.vel.x;
    this.pos.y += this.vel.y;
    this.acc.x = 0;
    this.acc.y = 0;
  }

  draw() {
    const colors = palettes[config.palette];
    ctx.fillStyle = colors[this.colorIndex];
    const renderSize = this.baseSize * (1 + audioEnergy * 0.9);
    
    const angle = Math.atan2(this.vel.y, this.vel.x);
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.moveTo(renderSize * 2.2, 0);
    ctx.lineTo(-renderSize * 1.4, renderSize * 0.9);
    ctx.lineTo(-renderSize * 0.8, 0);
    ctx.lineTo(-renderSize * 1.4, -renderSize * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// --- SWARM INITIALIZATION & LOOP ---
let swarm = [];
function syncSwarmCount() {
  while (swarm.length < config.count) swarm.push(new Boid());
  if (swarm.length > config.count) swarm.length = config.count;
}
syncSwarmCount();

function animate() {
  updateAudioEnergy();
  const preset = presets[config.behavior];
  const currentMaxSpeed = config.baseSpeed * (1 + audioEnergy * 1.1);

  ctx.fillStyle = `rgba(0, 0, 0, ${preset.trail})`;
  ctx.fillRect(0, 0, width, height);

  if (audioEnergy > 0.15) {
    const grad = ctx.createRadialGradient(width / 2, height / 2, 10, width / 2, height / 2, width * 0.45);
    grad.addColorStop(0, `rgba(255, 255, 255, ${audioEnergy * 0.05})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  if (touchPoint.pulse > 0.01) {
    ctx.beginPath();
    ctx.arc(touchPoint.x, touchPoint.y, (1 - touchPoint.pulse) * 140 + 15, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${touchPoint.pulse * 0.18})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    touchPoint.pulse *= 0.92;
  }

  for (let boid of swarm) {
    boid.edges();
boid.flock(swarm, preset, currentMaxSpeed);
boid.update(currentMaxSpeed);
boid.draw();
}
requestAnimationFrame(animate);
}
animate();
// --- UI CONTROLS & AUTO-HIDE ---
const gearBtn = document.getElementById('gearBtn');
const settingsPanel = document.getElementById('settingsPanel');
const closeBtn = document.getElementById('closeBtn');
let hideTimer;
function revealGearIcon() {
gearBtn.classList.remove('faded');
clearTimeout(hideTimer);
hideTimer = setTimeout(() => {
if (settingsPanel.classList.contains('hidden')) {
gearBtn.classList.add('faded');
}
}, 3000);
}
revealGearIcon();
gearBtn.addEventListener('click', (e) => {
e.stopPropagation();
settingsPanel.classList.remove('hidden');
gearBtn.classList.add('faded');
});
closeBtn.addEventListener('click', () => {
settingsPanel.classList.add('hidden');
revealGearIcon();
});
document.getElementById('behaviorSelect').addEventListener('change', (e) => {
config.behavior = e.target.value;
});
const countSlider = document.getElementById('countSlider');
const countVal = document.getElementById('countVal');
countSlider.addEventListener('input', (e) => {
config.count = parseInt(e.target.value, 10);
countVal.textContent = config.count;
syncSwarmCount();
});
const speedSlider = document.getElementById('speedSlider');
const speedVal = document.getElementById('speedVal');
speedSlider.addEventListener('input', (e) => {
config.baseSpeed = parseFloat(e.target.value);
speedVal.textContent = config.baseSpeed.toFixed(1);
});
const colorSelect = document.getElementById('colorSelect');
const customColorGroup = document.getElementById('customColorGroup');
const c1 = document.getElementById('customColor1');
const c2 = document.getElementById('customColor2');
const c3 = document.getElementById('customColor3');
function updateCustomPalette() {
palettes.custom = [c1.value, c2.value, c3.value, c1.value];
}
colorSelect.addEventListener('change', (e) => {
config.palette = e.target.value;
if (config.palette === 'custom') {
customColorGroup.classList.remove('hidden');
updateCustomPalette();
} else {
customColorGroup.classList.add('hidden');
}
});
[c1, c2, c3].forEach(picker => picker.addEventListener('input', updateCustomPalette));
document.getElementById('audioToggle').addEventListener('change', (e) => {
toggleAudio(e.target.checked);
});
const predatorToggle = document.getElementById('predatorToggle');
const touchModeLabel = document.getElementById('touchModeLabel');
predatorToggle.addEventListener('change', (e) => {
config.repelMode = e.target.checked;
touchModeLabel.textContent = config.repelMode ? 'Repel Scatter' : 'Attract Magnet';
});