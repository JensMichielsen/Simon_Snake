(() => {
  'use strict';

  const GRID = 20;
  const START_INTERVAL = 150; // ms per step
  const MIN_INTERVAL = 60;
  const SPEEDUP = 3; // ms faster per apple
  const SWIPE_THRESHOLD = 24; // px

  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const wrapEl = document.querySelector('.board-wrap');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');
  const startBtn = document.getElementById('start-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const wallsBtn = document.getElementById('wrap-btn');

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

  let cell = 20;
  let snake, dir, dirQueue, food, score, interval, state, lastTime, acc;
  let best = storage.get('simonSnake.best', 0);
  let wallsOn = storage.get('simonSnake.walls', true);

  bestEl.textContent = best;
  updateWallsBtn();

  // ---------- Layout ----------
  function resize() {
    const rect = wrapEl.getBoundingClientRect();
    const size = Math.floor(Math.min(rect.width, rect.height));
    cell = Math.max(8, Math.floor(size / GRID));
    const px = cell * GRID;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = px + 'px';
    canvas.style.height = px + 'px';
    canvas.width = px * dpr;
    canvas.height = px * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    overlay.style.width = px + 'px';
    overlay.style.height = px + 'px';
    overlay.style.inset = 'auto';
    draw();
  }

  // ---------- Game state ----------
  function reset() {
    const mid = Math.floor(GRID / 2);
    snake = [
      { x: mid, y: mid },
      { x: mid - 1, y: mid },
      { x: mid - 2, y: mid },
    ];
    dir = DIRS.right;
    dirQueue = [];
    score = 0;
    interval = START_INTERVAL;
    scoreEl.textContent = '0';
    placeFood();
  }

  function placeFood() {
    const free = [];
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (!snake.some((s) => s.x === x && s.y === y)) free.push({ x, y });
      }
    }
    food = free.length ? free[Math.floor(Math.random() * free.length)] : null;
  }

  function queueDir(name) {
    const next = DIRS[name];
    if (!next) return;
    if (state === 'ready' || state === 'over') {
      start();
    } else if (state === 'paused') {
      resume();
    }
    const last = dirQueue.length ? dirQueue[dirQueue.length - 1] : dir;
    // Ignore same direction and direct reversals
    if (next === last || (next.x === -last.x && next.y === -last.y)) return;
    if (dirQueue.length < 3) dirQueue.push(next);
  }

  function step() {
    if (dirQueue.length) dir = dirQueue.shift();

    const head = snake[0];
    let nx = head.x + dir.x;
    let ny = head.y + dir.y;

    if (wallsOn) {
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) return gameOver();
    } else {
      nx = (nx + GRID) % GRID;
      ny = (ny + GRID) % GRID;
    }

    const eating = food && nx === food.x && ny === food.y;
    // The tail moves away this step unless we're eating, so it's safe to enter
    const body = eating ? snake : snake.slice(0, -1);
    if (body.some((s) => s.x === nx && s.y === ny)) return gameOver();

    snake.unshift({ x: nx, y: ny });
    if (eating) {
      score++;
      scoreEl.textContent = score;
      interval = Math.max(MIN_INTERVAL, interval - SPEEDUP);
      buzz(15);
      placeFood();
      if (!food) return win();
    } else {
      snake.pop();
    }
  }

  // ---------- Loop ----------
  function loop(t) {
    if (state !== 'playing') return;
    acc += t - lastTime;
    lastTime = t;
    // Cap catch-up so a stalled tab doesn't jump many steps at once
    if (acc > interval * 3) acc = interval;
    while (acc >= interval && state === 'playing') {
      acc -= interval;
      step();
    }
    draw();
    if (state === 'playing') requestAnimationFrame(loop);
  }

  function start() {
    reset();
    state = 'playing';
    hideOverlay();
    pauseBtn.textContent = '❚❚';
    lastTime = performance.now();
    acc = 0;
    requestAnimationFrame(loop);
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    pauseBtn.textContent = '▶';
    showOverlay('Paused', 'Tap Resume or swipe to continue.', 'Resume');
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'playing';
    hideOverlay();
    pauseBtn.textContent = '❚❚';
    lastTime = performance.now();
    acc = 0;
    requestAnimationFrame(loop);
  }

  function endGame(title) {
    state = 'over';
    buzz([60, 40, 60]);
    let text = `Score: ${score}`;
    if (score > best) {
      best = score;
      storage.set('simonSnake.best', best);
      bestEl.textContent = best;
      text += '<br>New best! 🎉';
    }
    draw();
    showOverlay(title, text, 'Play again');
  }

  const gameOver = () => endGame('Game Over');
  const win = () => endGame('You Win!');

  // ---------- Rendering ----------
  function draw() {
    const px = cell * GRID;
    ctx.clearRect(0, 0, px, px);

    // Checkerboard
    ctx.fillStyle = '#1b2e23';
    for (let y = 0; y < GRID; y++) {
      for (let x = (y % 2); x < GRID; x += 2) {
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    if (wallsOn) {
      ctx.strokeStyle = '#4ade8055';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, px - 2, px - 2);
    }

    if (!snake) return;

    // Food
    if (food) {
      const cx = food.x * cell + cell / 2;
      const cy = food.y * cell + cell / 2;
      ctx.fillStyle = '#f87171';
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#86efac';
      ctx.fillRect(cx - 1, cy - cell * 0.5, 2, cell * 0.18);
    }

    // Snake
    const n = snake.length;
    snake.forEach((s, i) => {
      const light = 62 - (i / Math.max(1, n - 1)) * 22;
      ctx.fillStyle = `hsl(142, 70%, ${light}%)`;
      const pad = i === 0 ? 1 : 2;
      roundRect(s.x * cell + pad, s.y * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.3);
    });

    // Eyes
    const h = snake[0];
    const ex = h.x * cell + cell / 2;
    const ey = h.y * cell + cell / 2;
    const off = cell * 0.2;
    const fwd = cell * 0.15;
    ctx.fillStyle = '#06200f';
    for (const side of [-1, 1]) {
      const x = ex + dir.x * fwd + (dir.y !== 0 ? side * off : 0);
      const y = ey + dir.y * fwd + (dir.x !== 0 ? side * off : 0);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.5, cell * 0.09), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  // ---------- UI helpers ----------
  function showOverlay(title, html, btnText) {
    overlayTitle.textContent = title;
    overlayText.innerHTML = html;
    startBtn.textContent = btnText;
    overlay.classList.remove('hidden');
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
  }

  function updateWallsBtn() {
    wallsBtn.textContent = wallsOn ? 'Walls' : 'Wrap';
    wallsBtn.setAttribute('aria-pressed', String(wallsOn));
  }

  function buzz(pattern) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch { /* ignore */ }
    }
  }

  // ---------- Input ----------
  startBtn.addEventListener('click', () => {
    if (state === 'paused') resume();
    else start();
  });

  pauseBtn.addEventListener('click', () => {
    if (state === 'playing') pause();
    else if (state === 'paused') resume();
  });

  wallsBtn.addEventListener('click', () => {
    // Only allow switching mode between games so it can't be abused mid-run
    if (state === 'playing' || state === 'paused') return;
    wallsOn = !wallsOn;
    storage.set('simonSnake.walls', wallsOn);
    updateWallsBtn();
    draw();
  });

  // D-pad: react on pointerdown for zero latency
  document.querySelectorAll('.dir').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      queueDir(btn.dataset.dir);
    });
  });

  // Swipe anywhere (except on buttons)
  let touchStart = null;
  document.addEventListener('touchstart', (e) => {
    if (e.target.closest('button')) return;
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!touchStart) return;
    e.preventDefault();
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return;
    if (Math.abs(dx) > Math.abs(dy)) queueDir(dx > 0 ? 'right' : 'left');
    else queueDir(dy > 0 ? 'down' : 'up');
    // Re-anchor so one continuous gesture can make several turns
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: false });

  document.addEventListener('touchend', () => { touchStart = null; });
  document.addEventListener('touchcancel', () => { touchStart = null; });

  // Keyboard (desktop)
  const KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right',
  };
  document.addEventListener('keydown', (e) => {
    if (KEYS[e.key]) {
      e.preventDefault();
      queueDir(KEYS[e.key]);
    } else if (e.key === ' ' || e.key === 'p' || e.key === 'Escape') {
      e.preventDefault();
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
      else if (e.key === ' ') start();
    }
  });

  // Auto-pause when the app is backgrounded
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 150));

  // ---------- Boot ----------
  state = 'ready';
  reset();
  resize();
})();
