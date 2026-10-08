(() => {
  'use strict';

  // ---------- Tuning ----------
  // Everything runs in world units: the view is always H units tall and its
  // width follows the screen (capped at MAX_W so desktops get a centred column).
  const H = 640;
  const MAX_W = 720;
  const GROUND_H = 84;
  const GROUND_Y = H - GROUND_H;
  const STEP = 1 / 120; // fixed physics step, seconds

  const GRAVITY = 1500;
  const FLAP_V = -470;
  const MAX_FALL = 820;

  const BASE_SPEED = 165;
  const MAX_SPEED = 230;
  const BASE_GAP = 178;
  const MIN_GAP = 138;
  const SPACING = 255; // left edge to left edge of consecutive towers
  const TOWER_MIN_W = 78;
  const TOWER_MAX_W = 104;
  const MAX_GAP_SHIFT = 190; // how far the gap may move between towers

  // ---------- DOM ----------
  const gameEl = document.getElementById('game');
  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const titleEl = document.getElementById('title');
  const titleBestEl = document.getElementById('title-best');
  const hintEl = document.getElementById('hint');
  const pauseBtn = document.getElementById('pause-btn');
  const muteBtn = document.getElementById('mute-btn');
  const panel = document.getElementById('panel');
  const panelTitle = document.getElementById('panel-title');
  const panelScores = document.getElementById('panel-scores');
  const panelBtn = document.getElementById('panel-btn');
  const finalScoreEl = document.getElementById('final-score');
  const finalBestEl = document.getElementById('final-best');
  const newBestEl = document.getElementById('new-best');

  const storage = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage unavailable */
      }
    },
  };

  // ---------- Helpers ----------
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const smooth = (t) => t * t * (3 - 2 * t);
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rgb = (c, a = 1) =>
    a >= 1
      ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
      : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  // Stable pseudo-random value in [0, 1) for a window, so lights don't flicker.
  function hash(a, b, c) {
    let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function circleHitsRect(cx, cy, r, x0, y0, x1, y1) {
    const dx = cx - clamp(cx, x0, x1);
    const dy = cy - clamp(cy, y0, y1);
    return dx * dx + dy * dy < r * r;
  }

  // ---------- Sky palettes (day → dusk → night → dawn) ----------
  const PALETTES = {
    day: {
      skyTop: [74, 163, 232], skyBot: [196, 232, 255],
      far: [150, 190, 218], near: [118, 160, 194],
      sun: [255, 244, 194], sunA: 1, sunY: 130, cloud: [255, 255, 255], cloudA: 0.92,
      night: 0,
    },
    dusk: {
      skyTop: [70, 62, 140], skyBot: [255, 160, 110],
      far: [140, 100, 140], near: [100, 72, 112],
      sun: [255, 170, 100], sunA: 1, sunY: 400, cloud: [255, 200, 190], cloudA: 0.8,
      night: 0.45,
    },
    night: {
      skyTop: [10, 16, 46], skyBot: [36, 48, 96],
      far: [32, 40, 78], near: [22, 28, 58],
      sun: [255, 170, 100], sunA: 0, sunY: 520, cloud: [120, 130, 170], cloudA: 0.3,
      night: 1,
    },
  };
  const SKY_CYCLE = ['day', 'day', 'dusk', 'night', 'night', 'dusk'];
  const POINTS_PER_STAGE = 5;

  function paletteAt(points) {
    const p = points / POINTS_PER_STAGE;
    const i = Math.floor(p);
    const a = PALETTES[SKY_CYCLE[i % SKY_CYCLE.length]];
    const b = PALETTES[SKY_CYCLE[(i + 1) % SKY_CYCLE.length]];
    const t = smooth(p - i);
    const out = {};
    for (const k in a) out[k] = Array.isArray(a[k]) ? mix(a[k], b[k], t) : lerp(a[k], b[k], t);
    return out;
  }

  const TOWER_COLORS = [
    [176, 186, 200], // concrete
    [74, 142, 164], // teal glass
    [170, 96, 76], // brick
    [214, 192, 152], // sandstone
    [64, 92, 140], // navy glass
    [118, 126, 146], // slate
  ];
  const TOWER_STYLES = ['grid', 'glass', 'ribbon'];
  const NIGHT_TINT = [14, 18, 40];
  const LIT_DAY = [255, 244, 210];
  const LIT_NIGHT = [255, 206, 92];

  // ---------- State ----------
  let W = 360;
  let scale = 1;
  let dpr = 1;
  let state = 'ready'; // ready | playing | paused | resume | dying | over
  let score = 0;
  let best = storage.get('skylineFlyer.best', 0);
  let skyPoints = 0; // eased score, drives the day/night cycle
  let dist = 0; // total distance scrolled
  let time = 0;
  let towers = [];
  let particles = [];
  let shake = 0;
  let flash = 0;
  let deathTimer = 0;
  let trailTimer = 0;
  let lastTime = null;
  let acc = 0;
  let pal = paletteAt(0);

  const plane = { x: 100, y: H * 0.42, vy: 0, angle: 0, prop: 0, grounded: false };

  // Background scenery, generated once and tiled.
  const farCity = makeSkyline(110, 230, 30, 60);
  const nearCity = makeSkyline(60, 160, 36, 70, true);
  const clouds = Array.from({ length: 6 }, (_, i) => ({
    x: i * 140 + rand(0, 80),
    y: rand(40, 300),
    s: rand(0.7, 1.4),
    v: rand(6, 16),
  }));
  const stars = Array.from({ length: 70 }, () => ({
    x: Math.random(),
    y: Math.random() * 0.6,
    r: rand(0.6, 1.6),
    p: Math.random() * Math.PI * 2,
  }));

  function makeSkyline(minH, maxH, minW, maxW, withWindows = false) {
    const blocks = [];
    let x = 0;
    while (x < MAX_W + 300) {
      const w = Math.round(rand(minW, maxW));
      const h = Math.round(rand(minH, maxH));
      const b = { x, w, h, spire: Math.random() < 0.15, windows: [] };
      if (withWindows) {
        for (let wy = 10; wy < h - 6; wy += 10) {
          for (let wx = 6; wx < w - 6; wx += 9) {
            if (Math.random() < 0.3) b.windows.push(wx, wy);
          }
        }
      }
      blocks.push(b);
      x += w + Math.round(rand(-6, 4));
    }
    return { blocks, width: x };
  }

  // ---------- Audio ----------
  const audio = {
    ctx: null,
    master: null,
    noise: null,
    muted: storage.get('skylineFlyer.muted', false),

    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.6;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },

    setMuted(m) {
      this.muted = m;
      storage.set('skylineFlyer.muted', m);
      if (this.master) this.master.gain.value = m ? 0 : 0.6;
    },

    noiseBurst(dur, type, f0, f1, vol) {
      const c = this.ctx;
      const t = c.currentTime;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      const filter = c.createBiquadFilter();
      filter.type = type;
      filter.frequency.setValueAtTime(f0, t);
      filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(filter).connect(g).connect(this.master);
      src.start(t);
      src.stop(t + dur);
    },

    tone(type, f0, f1, dur, vol, delay = 0) {
      const c = this.ctx;
      const t = c.currentTime + delay;
      const osc = c.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + dur);
    },

    flap() {
      if (!this.ctx || this.muted) return;
      this.noiseBurst(0.16, 'bandpass', 1400, 500, 0.35);
      this.tone('triangle', 220, 140, 0.1, 0.08);
    },

    point() {
      if (!this.ctx || this.muted) return;
      this.tone('sine', 880, 880, 0.09, 0.18);
      this.tone('sine', 1320, 1320, 0.14, 0.18, 0.08);
    },

    crash() {
      if (!this.ctx || this.muted) return;
      this.noiseBurst(0.6, 'lowpass', 1200, 80, 0.8);
      this.tone('sine', 140, 40, 0.45, 0.5);
    },
  };

  // ---------- Layout ----------
  function resize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    scale = vh / H;
    W = Math.min(MAX_W, vw / scale);
    const cssW = W * scale;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    gameEl.style.width = cssW + 'px';
    canvas.style.width = cssW + 'px';
    canvas.style.height = vh + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(vh * dpr);
    plane.x = clamp(W * 0.3, 80, 200);
    render();
  }

  // ---------- Game flow ----------
  const speed = () => BASE_SPEED + (MAX_SPEED - BASE_SPEED) * Math.min(1, score / 40);
  const gapSize = () => Math.max(MIN_GAP, BASE_GAP - score * 1.2);

  function toReady() {
    state = 'ready';
    score = 0;
    towers = [];
    particles = [];
    plane.y = H * 0.42;
    plane.vy = 0;
    plane.angle = 0;
    plane.grounded = false;
    flash = 0;
    shake = 0;
    scoreEl.textContent = '0';
    scoreEl.classList.add('hidden');
    pauseBtn.classList.add('hidden');
    panel.classList.add('hidden');
    titleEl.classList.remove('hidden');
    titleBestEl.textContent = best > 0 ? `Best: ${best}` : '';
    hintEl.textContent = 'Tap to take off';
    hintEl.classList.remove('hidden');
  }

  function start() {
    state = 'playing';
    titleEl.classList.add('hidden');
    hintEl.classList.add('hidden');
    scoreEl.classList.remove('hidden');
    pauseBtn.classList.remove('hidden');
  }

  function flap() {
    plane.vy = FLAP_V;
    audio.flap();
    // A puff of exhaust from the tail.
    const [tx, ty] = planePoint(-26, 0);
    for (let i = 0; i < 4; i++) {
      particles.push({
        x: tx, y: ty,
        vx: -speed() - rand(20, 60), vy: rand(-30, 30),
        r: rand(3, 6), grow: 14, life: 0, max: rand(0.35, 0.55),
        color: [255, 255, 255], alpha: 0.7,
      });
    }
  }

  function press() {
    audio.unlock();
    if (state === 'ready') {
      start();
      flap();
    } else if (state === 'resume') {
      state = 'playing';
      hintEl.classList.add('hidden');
      flap();
    } else if (state === 'playing') {
      flap();
    }
  }

  function pause() {
    if (state !== 'playing' && state !== 'resume') return;
    state = 'paused';
    hintEl.classList.add('hidden');
    panelTitle.textContent = 'Paused';
    panelScores.classList.add('hidden');
    newBestEl.classList.add('hidden');
    panelBtn.textContent = 'Resume';
    panelBtn.disabled = false;
    panel.classList.remove('hidden');
  }

  function resume() {
    // Freeze until the next tap so the player isn't dropped mid-fall.
    state = 'resume';
    panel.classList.add('hidden');
    hintEl.textContent = 'Tap to continue';
    hintEl.classList.remove('hidden');
  }

  function crash() {
    state = 'dying';
    deathTimer = 0;
    shake = 14;
    flash = 1;
    audio.crash();
    if (navigator.vibrate) navigator.vibrate(120);
    pauseBtn.classList.add('hidden');
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = rand(60, 320);
      particles.push({
        x: plane.x, y: plane.y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60,
        r: rand(3, 8), grow: rand(-4, 10), life: 0, max: rand(0.4, 0.9),
        color: pick([[255, 214, 90], [255, 140, 50], [230, 57, 70], [90, 90, 100]]),
        alpha: 1, gravity: 300,
      });
    }
  }

  function gameOver() {
    state = 'over';
    const isBest = score > best;
    if (isBest) {
      best = score;
      storage.set('skylineFlyer.best', best);
    }
    panelTitle.textContent = 'Crashed!';
    panelScores.classList.remove('hidden');
    finalScoreEl.textContent = score;
    finalBestEl.textContent = best;
    newBestEl.classList.toggle('hidden', !isBest || score === 0);
    panelBtn.textContent = 'Fly again';
    // Short delay so a frantic tap doesn't skip the result.
    panelBtn.disabled = true;
    setTimeout(() => {
      panelBtn.disabled = false;
    }, 600);
    panel.classList.remove('hidden');
  }

  function addScore() {
    score++;
    scoreEl.textContent = score;
    scoreEl.classList.remove('pop');
    void scoreEl.offsetWidth; // restart the animation
    scoreEl.classList.add('pop');
    audio.point();
  }

  function makeTower(x, prevGapY) {
    const gap = gapSize();
    const lo = 80 + gap / 2;
    const hi = GROUND_Y - 70 - gap / 2;
    let gapY = rand(lo, hi);
    if (prevGapY !== undefined) gapY = clamp(gapY, prevGapY - MAX_GAP_SHIFT, prevGapY + MAX_GAP_SHIFT);
    return {
      x,
      w: Math.round(rand(TOWER_MIN_W, TOWER_MAX_W)),
      gap,
      gapY,
      color: pick(TOWER_COLORS),
      style: pick(TOWER_STYLES),
      seed: (Math.random() * 1e9) | 0,
      scored: false,
    };
  }

  // Plane-local point → world point.
  function planePoint(lx, ly) {
    const c = Math.cos(plane.angle);
    const s = Math.sin(plane.angle);
    return [plane.x + lx * c - ly * s, plane.y + lx * s + ly * c];
  }

  // A few circles that roughly cover the fuselage; slightly forgiving on purpose.
  function hitCircles() {
    return [
      [...planePoint(2, 0), 12],
      [...planePoint(18, 0), 7],
      [...planePoint(-19, -2), 6],
    ];
  }

  function collides() {
    const circles = hitCircles();
    for (const [cx, cy, r] of circles) {
      if (cy + r >= GROUND_Y) return true;
    }
    for (const t of towers) {
      if (t.x > plane.x + 40 || t.x + t.w < plane.x - 40) continue;
      const x0 = t.x + 3;
      const x1 = t.x + t.w - 3;
      const gapTop = t.gapY - t.gap / 2;
      const gapBot = t.gapY + t.gap / 2;
      for (const [cx, cy, r] of circles) {
        if (circleHitsRect(cx, cy, r, x0, -1000, x1, gapTop + 2)) return true;
        if (circleHitsRect(cx, cy, r, x0, gapBot + 2, x1, GROUND_Y)) return true;
      }
    }
    return false;
  }

  // ---------- Update ----------
  function update(dt) {
    time += dt;
    const moving = state === 'ready' || state === 'playing';
    const v = moving ? speed() : 0;
    dist += v * dt;

    for (const c of clouds) {
      c.x -= (c.v + v * 0.06) * dt;
      if (c.x < -120 * c.s) {
        c.x = W + rand(20, 120);
        c.y = rand(40, 300);
      }
    }

    if (state === 'ready') {
      plane.y = H * 0.42 + Math.sin(time * 3) * 8;
      plane.angle = Math.sin(time * 3 + 1) * 0.06;
      plane.prop += dt * 40;
    } else if (state === 'playing') {
      plane.vy = Math.min(MAX_FALL, plane.vy + GRAVITY * dt);
      plane.y += plane.vy * dt;
      if (plane.y < -30) {
        plane.y = -30;
        plane.vy = Math.max(0, plane.vy);
      }
      const target = plane.vy < 0 ? -0.38 : clamp(-0.38 + (plane.vy / MAX_FALL) * 1.7, -0.38, 1.25);
      plane.angle += (target - plane.angle) * Math.min(1, dt * 10);
      plane.prop += dt * 45;

      for (const t of towers) {
        t.x -= v * dt;
        if (!t.scored && t.x + t.w < plane.x) {
          t.scored = true;
          addScore();
        }
      }
      towers = towers.filter((t) => t.x + t.w > -20);
      const last = towers[towers.length - 1];
      if (!last) towers.push(makeTower(W + 60));
      else if (last.x + SPACING < W + 60) towers.push(makeTower(last.x + SPACING, last.gapY));

      trailTimer -= dt;
      if (trailTimer <= 0) {
        trailTimer = 0.05;
        const [tx, ty] = planePoint(-27, -1);
        particles.push({
          x: tx, y: ty, vx: -v, vy: 0,
          r: 2, grow: 5, life: 0, max: 0.5,
          color: [255, 255, 255], alpha: 0.35,
        });
      }

      if (collides()) crash();
    } else if (state === 'dying') {
      deathTimer += dt;
      if (!plane.grounded) {
        plane.vy = Math.min(MAX_FALL * 1.2, plane.vy + GRAVITY * dt);
        plane.y += plane.vy * dt;
        plane.angle += (1.35 - plane.angle) * Math.min(1, dt * 4);
        plane.prop += dt * 8;
        if (plane.y + 10 >= GROUND_Y) {
          plane.y = GROUND_Y - 10;
          plane.grounded = true;
          shake = Math.max(shake, 6);
        }
      }
      trailTimer -= dt;
      if (trailTimer <= 0) {
        trailTimer = 0.04;
        particles.push({
          x: plane.x + rand(-6, 6), y: plane.y + rand(-6, 6),
          vx: rand(-20, 20), vy: rand(-90, -50),
          r: rand(4, 7), grow: 18, life: 0, max: rand(0.8, 1.3),
          color: [60, 60, 70], alpha: 0.55,
        });
      }
      if (plane.grounded && deathTimer > 0.8) gameOver();
    }

    for (const p of particles) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.gravity) p.vy += p.gravity * dt;
      p.r = Math.max(0.5, p.r + p.grow * dt);
    }
    particles = particles.filter((p) => p.life < p.max);

    shake = Math.max(0, shake - dt * 40);
    flash = Math.max(0, flash - dt * 3);
    skyPoints += (score - skyPoints) * Math.min(1, dt * 1.2);
  }

  // ---------- Render ----------
  function render() {
    pal = paletteAt(skyPoints);
    const k = scale * dpr;
    const sx = shake ? rand(-shake, shake) : 0;
    const sy = shake ? rand(-shake, shake) : 0;
    ctx.setTransform(k, 0, 0, k, sx * k, sy * k);

    drawSky();
    drawSkyline(farCity, 0.12, pal.far, false);
    drawSkyline(nearCity, 0.3, pal.near, true);
    for (const t of towers) drawTower(t);
    drawGround();
    drawParticles();
    drawPlane();

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.6})`;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
  }

  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    g.addColorStop(0, rgb(pal.skyTop));
    g.addColorStop(1, rgb(pal.skyBot));
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    if (pal.night > 0.4) {
      const a = (pal.night - 0.4) / 0.6;
      ctx.fillStyle = '#fff';
      for (const s of stars) {
        ctx.globalAlpha = a * (0.55 + 0.45 * Math.sin(time * 2 + s.p));
        ctx.fillRect(s.x * W, s.y * GROUND_Y, s.r, s.r);
      }
      ctx.globalAlpha = 1;
      // Crescent moon: the full disc minus an offset disc.
      const mx = W * 0.78;
      ctx.save();
      ctx.beginPath();
      ctx.arc(mx, 110, 26, 0, Math.PI * 2);
      ctx.clip();
      ctx.beginPath();
      ctx.rect(mx - 30, 80, 60, 60);
      ctx.arc(mx + 11, 102, 22, 0, Math.PI * 2);
      ctx.fillStyle = rgb([240, 240, 220], a);
      ctx.fill('evenodd');
      ctx.restore();
    }

    if (pal.sunA > 0.01) {
      const sxp = W * 0.72;
      ctx.fillStyle = rgb(pal.sun, 0.25 * pal.sunA);
      ctx.beginPath();
      ctx.arc(sxp, pal.sunY, 58, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb(pal.sun, pal.sunA);
      ctx.beginPath();
      ctx.arc(sxp, pal.sunY, 38, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = rgb(pal.cloud, pal.cloudA);
    for (const c of clouds) {
      const s = c.s;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 22 * s, 0, Math.PI * 2);
      ctx.arc(c.x + 26 * s, c.y - 12 * s, 26 * s, 0, Math.PI * 2);
      ctx.arc(c.x + 56 * s, c.y - 2 * s, 20 * s, 0, Math.PI * 2);
      ctx.arc(c.x + 30 * s, c.y + 6 * s, 20 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSkyline(layer, factor, color, windows) {
    const off = (dist * factor) % layer.width;
    ctx.fillStyle = rgb(color);
    for (let base = -off; base < W; base += layer.width) {
      for (const b of layer.blocks) {
        const x = base + b.x;
        if (x > W || x + b.w < 0) continue;
        const top = GROUND_Y - b.h;
        ctx.fillRect(x, top, b.w, b.h);
        if (b.spire) ctx.fillRect(x + b.w / 2 - 1.5, top - 26, 3, 26);
      }
    }
    if (!windows || pal.night < 0.05) return;
    ctx.fillStyle = rgb(LIT_NIGHT, pal.night * 0.8);
    for (let base = -off; base < W; base += layer.width) {
      for (const b of layer.blocks) {
        const x = base + b.x;
        if (x > W || x + b.w < 0) continue;
        const top = GROUND_Y - b.h;
        for (let i = 0; i < b.windows.length; i += 2) {
          ctx.fillRect(x + b.windows[i], top + b.windows[i + 1], 3, 4);
        }
      }
    }
  }

  function drawTower(t) {
    if (t.x > W || t.x + t.w < 0) return;
    const body = mix(t.color, NIGHT_TINT, pal.night * 0.6);
    const gapTop = t.gapY - t.gap / 2;
    const gapBot = t.gapY + t.gap / 2;
    drawTowerPart(t, body, -20, gapTop, true);
    drawTowerPart(t, body, gapBot, GROUND_Y, false);
  }

  function drawTowerPart(t, body, y0, y1, isTop) {
    const { x, w } = t;
    const h = y1 - y0;
    const night = pal.night;

    ctx.fillStyle = rgb(body);
    ctx.fillRect(x, y0, w, h);
    // Shaded right face for a little depth.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x + w * 0.78, y0, w * 0.22, h);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y0, 3, h);

    const glass = mix(mix(pal.skyBot, body, 0.45), [20, 26, 44], 0.25 + night * 0.4);
    const lit = mix(LIT_DAY, LIT_NIGHT, night);
    const litChance = 0.1 + 0.5 * night;
    const rowH = 20;
    const innerTop = y0 + (isTop ? 6 : 16);
    const innerBot = y1 - (isTop ? 18 : 22);
    // Rows are measured up from the ground so both halves line up as one building.
    // Row r spans [GROUND_Y - (r + 1) * rowH, + 12]; keep it inside innerTop..innerBot.
    const rFirst = Math.ceil((GROUND_Y - innerBot + 12) / rowH) - 1;
    const rLast = Math.floor((GROUND_Y - innerTop) / rowH) - 1;

    if (t.style === 'grid') {
      const cols = Math.max(2, Math.floor((w - 12) / 16));
      const startX = x + (w - (cols * 16 - 6)) / 2;
      for (let r = rFirst; r <= rLast; r++) {
        const wy = GROUND_Y - (r + 1) * rowH;
        for (let c = 0; c < cols; c++) {
          ctx.fillStyle = hash(t.seed, r, c) < litChance ? rgb(lit) : rgb(glass);
          ctx.fillRect(startX + c * 16, wy, 10, 12);
        }
      }
    } else if (t.style === 'ribbon') {
      for (let r = rFirst; r <= rLast; r++) {
        const wy = GROUND_Y - (r + 1) * rowH;
        ctx.fillStyle = rgb(glass);
        ctx.fillRect(x + 6, wy, w - 12, 9);
        const segs = Math.floor((w - 12) / 14);
        ctx.fillStyle = rgb(lit);
        for (let c = 0; c < segs; c++) {
          if (hash(t.seed, r, c) < litChance) ctx.fillRect(x + 6 + c * 14 + 1, wy + 1, 12, 7);
        }
      }
    } else {
      // Curtain-wall glass: one big pane split by mullions.
      const gx = x + 5;
      const gw = w - 10;
      if (innerBot > innerTop) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(gx, innerTop, gw, innerBot - innerTop);
        ctx.clip();
        ctx.fillStyle = rgb(glass);
        ctx.fillRect(gx, innerTop, gw, innerBot - innerTop);
        ctx.fillStyle = rgb(lit);
        const cols = Math.floor(gw / 12);
        for (let r = rFirst - 1; r <= rLast + 1; r++) {
          const wy = GROUND_Y - (r + 1) * rowH;
          for (let c = 0; c < cols; c++) {
            if (hash(t.seed, r, c) < litChance * 0.8) ctx.fillRect(gx + c * 12 + 1, wy + 1, 10, rowH - 2);
          }
        }
        ctx.fillStyle = rgb(body, 0.55);
        for (let mx = gx + 12; mx < gx + gw - 2; mx += 12) ctx.fillRect(mx - 0.5, innerTop, 1.5, innerBot - innerTop);
        for (let r = rFirst - 1; r <= rLast + 1; r++) ctx.fillRect(gx, GROUND_Y - (r + 1) * rowH, gw, 1.5);
        // Sky reflection streak.
        ctx.fillStyle = `rgba(255,255,255,${0.16 * (1 - night)})`;
        ctx.beginPath();
        ctx.moveTo(gx + gw * 0.2, innerBot);
        ctx.lineTo(gx + gw * 0.5, innerBot);
        ctx.lineTo(gx + gw * 0.9, innerTop);
        ctx.lineTo(gx + gw * 0.6, innerTop);
        ctx.fill();
        ctx.restore();
      }
    }

    const blink = Math.sin(time * 4 + t.seed) > 0.2;
    if (isTop) {
      // Underside of the upper section: a steel beam with warning lights.
      ctx.fillStyle = rgb(mix(body, [30, 34, 48], 0.5));
      ctx.fillRect(x, y1 - 12, w, 12);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let bx = x + 4; bx < x + w - 6; bx += 12) {
        ctx.beginPath();
        ctx.moveTo(bx, y1 - 12);
        ctx.lineTo(bx + 6, y1);
        ctx.lineTo(bx + 12, y1 - 12);
        ctx.lineTo(bx + 9, y1 - 12);
        ctx.lineTo(bx + 6, y1 - 6);
        ctx.lineTo(bx + 3, y1 - 12);
        ctx.fill();
      }
      ctx.fillStyle = blink ? '#ff4d4d' : '#7a1f1f';
      ctx.fillRect(x + 4, y1 - 4, 4, 4);
      ctx.fillRect(x + w - 8, y1 - 4, 4, 4);
    } else {
      // Rooftop parapet with aircraft warning lights.
      ctx.fillStyle = rgb(mix(body, [255, 255, 255], 0.25));
      ctx.fillRect(x, y0, w, 6);
      ctx.fillStyle = rgb(mix(body, [0, 0, 0], 0.3));
      ctx.fillRect(x, y0 + 6, w, 4);
      ctx.fillStyle = blink ? '#ff4d4d' : '#7a1f1f';
      ctx.fillRect(x + 3, y0 + 1, 4, 4);
      ctx.fillRect(x + w - 7, y0 + 1, 4, 4);
      // Street-level entrance.
      ctx.fillStyle = rgb(mix(body, [0, 0, 0], 0.45));
      ctx.fillRect(x + w / 2 - 9, y1 - 16, 18, 16);
      ctx.fillStyle = rgb(lit, 0.6 + night * 0.4);
      ctx.fillRect(x + w / 2 - 7, y1 - 14, 6, 14);
      ctx.fillRect(x + w / 2 + 1, y1 - 14, 6, 14);
    }
  }

  function drawGround() {
    const n = pal.night;
    ctx.fillStyle = rgb(mix([196, 188, 174], [70, 70, 86], n));
    ctx.fillRect(-20, GROUND_Y, W + 40, 12);
    ctx.fillStyle = rgb(mix([120, 114, 104], [40, 40, 52], n));
    ctx.fillRect(-20, GROUND_Y + 12, W + 40, 4);
    ctx.fillStyle = rgb(mix([62, 66, 76], [24, 26, 36], n));
    ctx.fillRect(-20, GROUND_Y + 16, W + 40, H - GROUND_Y + 20);
    // Sidewalk joints and lane markings scroll with the towers.
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    const sOff = dist % 28;
    for (let x = -sOff; x < W; x += 28) ctx.fillRect(x, GROUND_Y, 2, 12);
    ctx.fillStyle = rgb(mix([250, 214, 90], [180, 150, 70], n));
    const lOff = dist % 60;
    for (let x = -lOff; x < W + 30; x += 60) ctx.fillRect(x, GROUND_Y + 46, 30, 4);
  }

  function drawParticles() {
    for (const p of particles) {
      const fade = 1 - p.life / p.max;
      ctx.fillStyle = rgb(p.color, p.alpha * fade);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPlane() {
    ctx.save();
    ctx.translate(plane.x, plane.y);
    ctx.rotate(plane.angle);

    const RED = '#e63946';
    const DARK = '#1d3557';

    // Tail fin
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.moveTo(-17, -4);
    ctx.lineTo(-25, -19);
    ctx.lineTo(-19, -19);
    ctx.lineTo(-7, -5);
    ctx.closePath();
    ctx.fill();

    // Fuselage
    ctx.beginPath();
    ctx.moveTo(-28, -4);
    ctx.lineTo(8, -9);
    ctx.bezierCurveTo(20, -10, 26, -5, 26, 0);
    ctx.bezierCurveTo(26, 6, 20, 9, 8, 9);
    ctx.lineTo(-20, 4);
    ctx.quadraticCurveTo(-28, 3, -28, -4);
    ctx.closePath();
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = RED;
    ctx.fillRect(-30, 1, 60, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(-30, 4, 60, 8);
    ctx.restore();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = DARK;
    ctx.stroke();

    // Cockpit and cabin windows
    ctx.fillStyle = '#7dd3fc';
    ctx.beginPath();
    ctx.moveTo(8, -8.5);
    ctx.lineTo(15, -8.5);
    ctx.lineTo(20, -3.5);
    ctx.lineTo(9, -3.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = DARK;
    for (const wx of [-14, -8, -2]) {
      ctx.beginPath();
      ctx.arc(wx, -3.5, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }

    // Horizontal stabiliser and wing
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.ellipse(-22, -1, 7, 2, -0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-1, 4, 14, 3.5, -0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Propeller
    ctx.fillStyle = 'rgba(30,40,60,0.15)';
    ctx.beginPath();
    ctx.ellipse(28, 0, 2.5, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(30,40,60,0.8)';
    const blade = 2 + Math.abs(Math.sin(plane.prop)) * 12;
    ctx.beginPath();
    ctx.ellipse(28, 0, 1.8, blade, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffcf4a';
    ctx.beginPath();
    ctx.arc(27, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ---------- Loop ----------
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = lastTime === null ? 0 : Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    if (state !== 'paused' && state !== 'resume') {
      acc += dt;
      while (acc >= STEP) {
        update(STEP);
        acc -= STEP;
      }
    } else {
      acc = 0;
    }
    render();
  }

  // ---------- Input ----------
  const onButton = (e) => e.target instanceof Element && e.target.closest('button');

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (onButton(e) || !panel.classList.contains('hidden')) return;
      e.preventDefault();
      press();
    },
    { passive: false },
  );

  // Stop iOS from turning taps into scrolls, zooms or text selection.
  document.addEventListener('touchstart', (e) => {
    if (!onButton(e)) e.preventDefault();
  }, { passive: false });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W' || k === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      if (!panel.classList.contains('hidden')) {
        if (!panelBtn.disabled) panelBtn.click();
      } else {
        press();
      }
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      if (state === 'paused') resume();
      else pause();
    } else if (k === 'm' || k === 'M') {
      muteBtn.click();
    }
  });

  panelBtn.addEventListener('click', () => {
    audio.unlock();
    if (state === 'paused') resume();
    else if (state === 'over') toReady();
  });

  pauseBtn.addEventListener('click', () => pause());

  function updateMuteBtn() {
    muteBtn.textContent = audio.muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', audio.muted ? 'Unmute' : 'Mute');
  }
  muteBtn.addEventListener('click', () => {
    audio.unlock();
    audio.setMuted(!audio.muted);
    updateMuteBtn();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    lastTime = null;
  });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);

  updateMuteBtn();
  toReady();
  resize();
  requestAnimationFrame(frame);
})();
