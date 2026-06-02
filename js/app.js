/* ===== STORAGE ===== */
const Store = {
  get: (k, def) => { try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : def; } catch { return def; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

/* ===== STATE ===== */
const state = {
  activeCategoryId: Store.get('activeCategoryId', 'csaladi'),
  timerSecs: Store.get('timerSecs', 60),
  password: Store.get('gmPassword', '1234'),
  apiKey: Store.get('apiKey', ''),
  currentWord: null,
  currentPoints: null,
  selectedCardIndex: null,
  generatedCards: [],
  timerInterval: null,
  timeLeft: 60,
  usedWords: Store.get('usedWords', {})
};

const CIRC = 2 * Math.PI * 96;

/* ===== SESSION ===== */
const Session = {
  getUsed(id) { return state.usedWords[id] || []; },
  markUsed(id, w) {
    if (!state.usedWords[id]) state.usedWords[id] = [];
    if (!state.usedWords[id].includes(w)) { state.usedWords[id].push(w); Store.set('usedWords', state.usedWords); }
  },
  reset() { state.usedWords = {}; Store.set('usedWords', {}); },
  totalUsed() { return Object.values(state.usedWords).reduce((s, a) => s + a.length, 0); }
};

/* ===== AI PROMPT: 5 SZAVAS GENERÁLÁS ===== */
function buildFiveCardPrompt(category, used) {
  const usedStr = used.length > 0 ? `\nMÁR HASZNÁLT szavak (TILOS megismételni): ${used.join(', ')}` : '';
  const modeList = '"Mutasd meg!", "Rajzold le!", "Magyarázd el!", "Írd körül!"';

  let categoryNote = '';
  if (category.id === 'tizennyolcPlus') categoryNote = 'A kategória felnőtt, vulgáris, szexuálisan explicit tartalom – legyenek trágár, obszcén szavak is.';
  else if (category.id === 'ceges') categoryNote = 'A kategória irodai, üzleti témájú.';
  else if (category.id === 'gyerek') categoryNote = 'A kategória 6-12 éves gyerekeknek szól, egyszerű, barátságos szavak.';
  else categoryNote = `A kategória: "${category.name}".`;

  return `Te egy Activity társasjáték feladványgenerátora vagy.
${categoryNote}

Generálj PONTOSAN 5 különböző magyar szót vagy rövid kifejezést (max 3 szó), és mindegyikhez rendelj hozzá:
1. Egy előadásmódot a következők közül: ${modeList}
2. Egy nehézségi pontszámot 1-től 5-ig (1=könnyű, 5=nagyon nehéz), azt értékelve, hogy az adott előadásmóddal mennyire nehéz a szót kitaláltatni.

Fontos: az 5 szó között legyen 1 db 1 pontos, 1 db 2 pontos, 1 db 3 pontos, 1 db 4 pontos és 1 db 5 pontos – minden pontérték pontosan egyszer szerepeljen!${usedStr}

Válaszolj KIZÁRÓLAG valid JSON tömbként, így:
[
  {"word":"szó","mode":"Mutasd meg!","points":1},
  {"word":"szó","mode":"Rajzold le!","points":2},
  {"word":"szó","mode":"Magyarázd el!","points":3},
  {"word":"szó","mode":"Írd körül!","points":4},
  {"word":"szó","mode":"Mutasd meg!","points":5}
]
Semmi más szöveg, csak a JSON!`;
}

/* ===== AI GENERÁLÁS ===== */
async function generateFiveWithAI(category) {
  const used = Session.getUsed(category.id);
  const prompt = buildFiveCardPrompt(category, used);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": state.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!resp.ok) throw new Error('API hiba');
  const data = await resp.json();
  const raw = data.content?.[0]?.text?.trim() || '[]';
  const clean = raw.replace(/```json|```/g, '').trim();
  const cards = JSON.parse(clean);

  // Validáció
  if (!Array.isArray(cards) || cards.length < 5) throw new Error('Hibás válasz');
  return cards.slice(0, 5).map(c => ({
    word: String(c.word || '?'),
    mode: String(c.mode || 'Mutasd meg!'),
    points: parseInt(c.points) || 1
  }));
}

/* ===== FALLBACK: 5 SZAVAS ===== */
function generateFiveFallback(category) {
  const modeNames = Object.keys(category.words);
  const used = Session.getUsed(category.id);

  let available = [];
  for (const m of modeNames) {
    for (const w of category.words[m]) {
      if (!used.includes(w)) available.push({ word: w, mode: m });
    }
  }
  if (available.length === 0) {
    state.usedWords[category.id] = [];
    Store.set('usedWords', state.usedWords);
    for (const m of modeNames) for (const w of category.words[m]) available.push({ word: w, mode: m });
  }

  // Véletlenszerűen 5 különböző szót húzunk
  const shuffled = available.sort(() => Math.random() - 0.5).slice(0, 5);

  // Pontokat 1-5 random sorrendben osztjuk szét
  const pointsPool = [1, 2, 3, 4, 5].sort(() => Math.random() - 0.5);

  return shuffled.map((c, i) => ({
    word: c.word,
    mode: c.mode,
    points: pointsPool[i]
  })).sort((a, b) => a.points - b.points);
}

/* ===== MODE METAADAT ===== */
const MODES_META = {
  'Mutasd meg!':     { icon: 'ti-user',           hint: 'Csak mutogatással, szó nélkül!' },
  'Rajzold le!':     { icon: 'ti-pencil',          hint: 'Csak rajzzal, szó és jel nélkül!' },
  'Magyarázd el!':   { icon: 'ti-message-circle',  hint: 'Szóban magyarázd körül!' },
  'Írd körül!':      { icon: 'ti-writing',         hint: 'Egy mondatban körülírd!' }
};

function getModeIcon(mode) {
  return (MODES_META[mode] || { icon: 'ti-star' }).icon;
}

/* ===== UI ===== */
const UI = {
  showState(name) {
    document.querySelectorAll('.state').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('state-' + name);
    if (el) { el.classList.add('active'); void el.offsetWidth; }
  },
  showGMLogin() {
    SoundEngine.play('menu-open');
    document.getElementById('gm-password-input').value = '';
    document.getElementById('login-error').textContent = '';
    document.getElementById('gm-login').classList.add('active');
  },
  hideAll() {
    document.getElementById('gm-login').classList.remove('active');
    document.getElementById('gm-panel').classList.remove('active');
  },
  gmLogin() {
    const val = document.getElementById('gm-password-input').value;
    if (val === state.password) {
      document.getElementById('gm-login').classList.remove('active');
      UI.openGMPanel();
    } else {
      document.getElementById('login-error').textContent = 'Hibás jelszó!';
      document.getElementById('gm-password-input').value = '';
    }
  },
  openGMPanel() {
    document.getElementById('api-key-input').value = state.apiKey;
    document.getElementById('timer-range').value = state.timerSecs;
    document.getElementById('timer-val').textContent = state.timerSecs;
    document.getElementById('new-pass-input').value = '';
    document.getElementById('gm-status').textContent = '';
    document.getElementById('sound-toggle').checked = SoundEngine.isEnabled();
    document.getElementById('volume-range').value = Math.round(SoundEngine.getVolume() * 100);
    document.getElementById('volume-val').textContent = Math.round(SoundEngine.getVolume() * 100) + '%';
    UI.updateSessionCounter();
    UI.renderCategoryGrid();
    document.getElementById('gm-panel').classList.add('active');
  },
  renderCategoryGrid() {
    document.getElementById('category-grid').innerHTML = CATEGORIES.map(cat => `
      <button class="cat-btn ${cat.id === state.activeCategoryId ? 'selected' : ''}"
        onclick="UI.selectCategory('${cat.id}')">
        <i class="ti ${cat.icon}"></i>
        <div>
          <div>${cat.name}</div>
          <div style="font-size:11px;opacity:0.6;font-weight:400;margin-top:2px;">${cat.description}</div>
        </div>
      </button>`).join('');
  },
  selectCategory(id) { SoundEngine.play('cat-select'); state.activeCategoryId = id; UI.renderCategoryGrid(); },
  updateTimerLabel() { document.getElementById('timer-val').textContent = document.getElementById('timer-range').value; },
  updateVolumeLabel() {
    const v = document.getElementById('volume-range').value;
    document.getElementById('volume-val').textContent = v + '%';
    SoundEngine.setVolume(v / 100);
  },
  toggleSound() { const on = document.getElementById('sound-toggle').checked; SoundEngine.setEnabled(on); if (on) SoundEngine.play('btn-click'); },
  updateSessionCounter() {
    const t = Session.totalUsed();
    const el = document.getElementById('session-counter');
    if (el) el.textContent = t > 0 ? `${t} szó elhangzott` : 'Még nincs elhangzott szó';
  },
  resetSession() { Session.reset(); UI.updateSessionCounter(); document.getElementById('gm-status').textContent = '✓ Session visszaállítva!'; },
  saveGMSettings() {
    SoundEngine.play('btn-click');
    const sel = document.querySelector('.cat-btn.selected');
    if (sel) { const m = sel.getAttribute('onclick').match(/'([^']+)'/); if (m) state.activeCategoryId = m[1]; }
    state.timerSecs = parseInt(document.getElementById('timer-range').value);
    state.apiKey = document.getElementById('api-key-input').value.trim();
    const np = document.getElementById('new-pass-input').value.trim();
    if (np) { state.password = np; Store.set('gmPassword', np); }
    Store.set('activeCategoryId', state.activeCategoryId);
    Store.set('timerSecs', state.timerSecs);
    Store.set('apiKey', state.apiKey);
    const cat = CATEGORIES.find(c => c.id === state.activeCategoryId);
    if (cat) document.getElementById('active-cat-name').textContent = cat.name;
    document.getElementById('gm-status').textContent = '✓ Mentve!';
    setTimeout(() => UI.hideAll(), 1200);
  },
  setLoading(on) { document.getElementById('loading-overlay').style.display = on ? 'flex' : 'none'; },

  renderFiveCards(cards) {
    const grid = document.getElementById('five-cards-grid');
    grid.innerHTML = cards.map((c, i) => `
      <button class="pick-card" id="pick-${i}" onclick="App.selectCard(${i})">
        <div>
          <div class="pick-card-points">${c.points}</div>
          <div class="pick-card-points-star">${'★'.repeat(c.points)}</div>
        </div>
        <div class="pick-card-divider"></div>
        <div class="pick-card-info">
          <div class="pick-card-word">${c.word}</div>
          <div class="pick-card-mode">
            <i class="ti ${getModeIcon(c.mode)}"></i>
            ${c.mode}
          </div>
        </div>
        <i class="ti ti-circle-check pick-card-check"></i>
      </button>`).join('');

    // Timer gomb letiltva amíg nincs kiválasztva kártya
    const btn = document.getElementById('btn-start-timer');
    if (btn) btn.disabled = true;
  },

  startFullscreen() {
    const el = document.getElementById('fs-start');
    if (el) { el.style.display = 'none'; }
    try {
      const d = document.documentElement;
      if (d.requestFullscreen) d.requestFullscreen({ navigationUI: 'hide' });
      else if (d.webkitRequestFullscreen) d.webkitRequestFullscreen();
      else if (d.mozRequestFullScreen) d.mozRequestFullScreen();
    } catch(e) {}
  },
  toggleFullscreen() {
    try {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
      if (!isFs) {
        const d = document.documentElement;
        if (d.requestFullscreen) d.requestFullscreen({ navigationUI: 'hide' });
        else if (d.webkitRequestFullscreen) d.webkitRequestFullscreen();
        else if (d.mozRequestFullScreen) d.mozRequestFullScreen();
      } else {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
      }
    } catch(e) {}
  }
};

/* ===== APP ===== */
const App = {
  async drawCard() {
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (!isFs) { try { const d = document.documentElement; if (d.requestFullscreen) d.requestFullscreen({ navigationUI: 'hide' }); else if (d.webkitRequestFullscreen) d.webkitRequestFullscreen(); } catch(e) {} }

    SoundEngine.play('card-draw');
    const category = CATEGORIES.find(c => c.id === state.activeCategoryId);
    if (!category) return;

    let cards;
    if (state.apiKey) {
      UI.setLoading(true);
      try {
        cards = await generateFiveWithAI(category);
      } catch (e) {
        cards = generateFiveFallback(category);
      } finally {
        UI.setLoading(false);
      }
    } else {
      cards = generateFiveFallback(category);
    }

    // Pontszám szerint rendezve 1→5
    cards.sort((a, b) => a.points - b.points);

    state.generatedCards = cards;
    state.selectedCardIndex = null;
    state.currentWord = null;
    state.currentPoints = null;

    UI.renderFiveCards(cards);
    UI.showState('card');
  },

  selectCard(index) {
    SoundEngine.play('btn-click');
    state.selectedCardIndex = index;
    state.currentWord = state.generatedCards[index].word;
    state.currentPoints = state.generatedCards[index].points;

    // Vizuális kijelölés
    document.querySelectorAll('.pick-card').forEach((el, i) => {
      el.classList.toggle('selected', i === index);
    });

    // Timer gomb aktív
    const btn = document.getElementById('btn-start-timer');
    if (btn) {
      btn.disabled = false;
      btn.classList.add('pulse');
    }

    // Használt szóként jelölés
    Session.markUsed(state.activeCategoryId, state.currentWord);
  },

  startTimer() {
    if (state.selectedCardIndex === null) return;
    SoundEngine.play('timer-start');

    const secs = state.timerSecs;
    state.timeLeft = secs;

    const arc = document.getElementById('timer-arc');
    arc.style.strokeDasharray = CIRC;
    arc.style.transition = 'none';
    arc.style.strokeDashoffset = '0';
    arc.style.stroke = '#27c47a';

    document.getElementById('timer-num').textContent = secs;
    document.getElementById('timer-word-recap').textContent = state.currentWord || '';

    const badge = document.getElementById('timer-points-badge');
    if (badge) badge.textContent = state.currentPoints + ' PONTOS SZÓ';

    document.getElementById('btn-done').style.display = 'none';
    UI.showState('timer');

    setTimeout(() => {
      arc.style.transition = `stroke-dashoffset ${secs}s linear, stroke 1s ease`;
      arc.style.strokeDashoffset = CIRC;
    }, 80);

    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
      state.timeLeft--;
      document.getElementById('timer-num').textContent = state.timeLeft;
      const pct = state.timeLeft / secs;

      if (state.timeLeft <= 3 && state.timeLeft > 0) SoundEngine.play('beep');
      else if (state.timeLeft <= 10) SoundEngine.play('tick-fast');
      else SoundEngine.play('tick');

      if (pct < 0.25) arc.style.stroke = '#e84040';
      else if (pct < 0.5) arc.style.stroke = '#f5a623';

      if (state.timeLeft <= 0) {
        clearInterval(state.timerInterval);
        SoundEngine.play('buzzer');
        document.getElementById('btn-done').style.display = '';
        UI.showState('timeout');
      }
    }, 1000);
  },

  reset() {
    SoundEngine.play('btn-click');
    if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
    state.currentWord = null;
    state.currentPoints = null;
    state.selectedCardIndex = null;
    state.generatedCards = [];
    UI.showState('idle');
  }
};

/* ===== INIT ===== */
function init() {
  const starsEl = document.getElementById('stars');
  for (let i = 0; i < 80; i++) {
    const s = document.createElement('div');
    s.className = 'star';
    const size = Math.random() * 2.5 + 1;
    s.style.cssText = `left:${Math.random()*100}%;top:${Math.random()*100}%;width:${size}px;height:${size}px;--dur:${(Math.random()*4+2).toFixed(1)}s;--op:${(Math.random()*0.5+0.2).toFixed(2)};animation-delay:${(Math.random()*5).toFixed(1)}s;`;
    starsEl.appendChild(s);
  }
  const cat = CATEGORIES.find(c => c.id === state.activeCategoryId);
  if (cat) document.getElementById('active-cat-name').textContent = cat.name;
  document.getElementById('gm-password-input').addEventListener('keydown', e => { if (e.key === 'Enter') UI.gmLogin(); });
  ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange'].forEach(ev => {
    document.addEventListener(ev, () => {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement);
      const icon = document.getElementById('fs-icon');
      if (icon) icon.className = isFs ? 'ti ti-arrows-minimize' : 'ti ti-arrows-maximize';
    });
  });
  UI.showState('idle');
}

document.addEventListener('DOMContentLoaded', init);
