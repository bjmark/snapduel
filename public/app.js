const socket = io();

const EMOJI = {
  rock:     '✊',
  paper:    '🖐',
  scissors: '✌️',
};

const MATCH_TIMEOUT_SEC = 30;
let countdownTimer = null;
let roundRevealTimer = null;

function startCountdown() {
  const el = document.getElementById('waiting-countdown');
  let remaining = MATCH_TIMEOUT_SEC;

  function tick() {
    el.textContent = remaining + 's';
    el.classList.toggle('urgent', remaining <= 10);
    if (remaining <= 0) return;
    remaining--;
    countdownTimer = setTimeout(tick, 1000);
  }

  clearCountdown();
  tick();
}

function clearCountdown() {
  clearTimeout(countdownTimer);
  countdownTimer = null;
  const el = document.getElementById('waiting-countdown');
  if (el) { el.textContent = ''; el.classList.remove('urgent'); }
}

// ── Screen management ──────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showToast(message, duration = 3500) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), duration);
}

// ── Battle UI state ────────────────────────────────────────────────────────
function setChoicesEnabled(enabled) {
  document.querySelectorAll('.choice-btn').forEach(b => {
    b.disabled = !enabled;
    if (enabled) b.classList.remove('selected');
  });
}

function setStatus(text) {
  document.getElementById('battle-status').textContent = text;
}

function updateScore(scores) {
  const youEl  = document.getElementById('score-you');
  const oppEl  = document.getElementById('score-opp');

  function bump(el, newVal) {
    if (el.textContent !== String(newVal)) {
      el.textContent = newVal;
      el.classList.remove('bump');
      // Force reflow so the animation re-triggers
      void el.offsetWidth;
      el.classList.add('bump');
      el.addEventListener('transitionend', () => el.classList.remove('bump'), { once: true });
    }
  }

  bump(youEl, scores.you);
  bump(oppEl, scores.opponent);
}

// ── Socket events ──────────────────────────────────────────────────────────
socket.on('match_timeout', () => {
  clearCountdown();
  showScreen('screen-home');
  showToast('未找到对手，匹配超时');
});

socket.on('match_found', () => {
  clearTimeout(roundRevealTimer);
  clearCountdown();
  document.getElementById('screen-waiting').classList.remove('private-mode');
  updateScore({ you: 0, opponent: 0 });
  showScreen('screen-battle');
  document.getElementById('round-overlay').classList.add('hidden');
  setChoicesEnabled(true);
  setStatus('请出拳');
});

socket.on('choice_acknowledged', () => {
  setChoicesEnabled(false);
  setStatus('等待对手出拳…');
});

socket.on('round_result', (data) => {
  clearTimeout(roundRevealTimer);
  const { yourChoice, opponentChoice, roundWinner, scores, matchOver, matchWinner } = data;

  // Update scoreboard
  updateScore(scores);

  // Fill overlay
  const youEmoji = document.getElementById('reveal-you');
  const oppEmoji = document.getElementById('reveal-opp');

  // Re-trigger animation by replacing nodes
  youEmoji.textContent = '';
  oppEmoji.textContent = '';
  requestAnimationFrame(() => {
    youEmoji.textContent = EMOJI[yourChoice];
    oppEmoji.textContent = EMOJI[opponentChoice];
  });

  const resultEl = document.getElementById('round-result-text');
  if (roundWinner === 'you') {
    resultEl.textContent = '🏆 本局获胜！';
    resultEl.style.color = 'var(--success)';
  } else if (roundWinner === 'opponent') {
    resultEl.textContent = '💀 本局落败';
    resultEl.style.color = 'var(--danger)';
  } else {
    resultEl.textContent = '🤝 平局！';
    resultEl.style.color = 'var(--text-muted)';
  }

  document.getElementById('round-scores').textContent =
    `比分：${scores.you} – ${scores.opponent}`;

  document.getElementById('round-overlay').classList.remove('hidden');

  roundRevealTimer = setTimeout(() => {
    document.getElementById('round-overlay').classList.add('hidden');

    if (matchOver) {
      showMatchResult(matchWinner, scores);
    } else {
      setChoicesEnabled(true);
      setStatus('请出拳');
    }
  }, 2500);
});

socket.on('opponent_left', () => {
  clearTimeout(roundRevealTimer);
  showToast('对手已离开');
  showScreen('screen-home');
});

socket.on('disconnect', () => {
  showToast('连接断开，正在重连…');
});

socket.on('connect', () => {
  // If we were disconnected and reconnected, go back to home
  // (server has no state for us anymore)
  const activeScreen = document.querySelector('.screen.active');
  if (activeScreen && activeScreen.id !== 'screen-home') {
    const wasDisconnected = !socket.recovered;
    if (wasDisconnected) {
      showToast('已重新连接');
      showScreen('screen-home');
    }
  }
});

// ── Match result ───────────────────────────────────────────────────────────
function showMatchResult(winner, scores) {
  const banner   = document.getElementById('result-banner');
  const scoreEl  = document.getElementById('result-score');

  if (winner === 'you') {
    banner.textContent = '🏆 你赢了！';
    banner.className = 'result-banner win';
  } else {
    banner.textContent = '💀 你输了';
    banner.className = 'result-banner lose';
  }

  scoreEl.textContent = `最终比分：${scores.you} – ${scores.opponent}`;
  showScreen('screen-result');
}

// ── Private room helpers ───────────────────────────────────────────────────
function showWaiting(mode) {
  const el = document.getElementById('screen-waiting');
  if (mode === 'private') {
    el.classList.add('private-mode');
  } else {
    el.classList.remove('private-mode');
    startCountdown();
  }
  showScreen('screen-waiting');
}

function renderCodeTiles(code) {
  const container = document.getElementById('code-tiles');
  container.innerHTML = '';
  for (const ch of code) {
    const tile = document.createElement('div');
    tile.className = 'code-tile';
    tile.textContent = ch;
    container.appendChild(tile);
  }
}

socket.on('private_room_created', ({ code }) => {
  renderCodeTiles(code);
  showWaiting('private');
});

socket.on('private_room_expired', () => {
  showScreen('screen-home');
  showToast('房间已过期（60秒无人加入）');
});

socket.on('join_error', ({ message }) => {
  showToast(message);
});

// ── Button handlers ────────────────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', () => {
  showWaiting('random');
  socket.emit('find_match');
});

document.getElementById('btn-create-room').addEventListener('click', () => {
  socket.emit('create_private_room');
});

document.getElementById('btn-join-room').addEventListener('click', () => {
  const code = document.getElementById('input-room-code').value.trim();
  if (!code) return;
  socket.emit('join_private_room', { code });
});

document.getElementById('input-room-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-join-room').click();
});

document.getElementById('btn-cancel').addEventListener('click', () => {
  clearCountdown();
  document.getElementById('screen-waiting').classList.remove('private-mode');
  socket.emit('leave');
  showScreen('screen-home');
});

document.getElementById('btn-leave').addEventListener('click', () => {
  socket.emit('leave');
  showScreen('screen-home');
});

document.querySelectorAll('.choice-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    setChoicesEnabled(false);
    btn.classList.add('selected');
    socket.emit('choose', btn.dataset.choice);
  });
});

document.getElementById('btn-rematch').addEventListener('click', () => {
  showWaiting('random');
  socket.emit('rematch');
});

document.getElementById('btn-home').addEventListener('click', () => {
  showScreen('screen-home');
});
