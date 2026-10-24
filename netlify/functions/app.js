// ===== app.js: setup, server, and login screens =====
const SKEY = 'stbSession';
let session = JSON.parse(localStorage.getItem(SKEY) || 'null');
let state = null, screen = 'welcome', joinInfo = null, photos = {}, busy = false;

const app = document.getElementById('app');
const $ = id => document.getElementById(id);
const val = id => ($(id)?.value || '').trim();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when = t => new Date(t).toLocaleString();
const fmt = ms => { ms = Math.max(0, ms); return `${Math.floor(ms / 60000)}:${String(Math.floor(ms % 60000 / 1000)).padStart(2, '0')}`; };
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

// ---------- SERVER ----------
async function api(path, payload) {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    let j;
    try { j = await r.json(); }
    catch { j = { error: r.status === 404 ? 'This feature is not set up yet.' : 'Server error (' + r.status + ')' }; }
    if (!r.ok && !j.error) j.error = 'Server error (' + r.status + ')';
    if (j.loggedOut) { clearSession(); render(); }
    return j;
  } catch (e) {
    return { error: 'No internet connection. Try again.' };
  }
}
const data = (action, extra = {}) => api('/api/data', { token: session?.token, tz, action, ...extra });

function setSession(r) {
  session = { token: r.token, role: r.role, kidName: r.kidName || null };
  localStorage.setItem(SKEY, JSON.stringify(session));
}
function clearSession() {
  session = null; state = null; photos = {};
  localStorage.removeItem(SKEY);
  screen = 'welcome';
}

async function refresh() {
  if (!session) return render();
  if (!state) app.innerHTML = '<div class="card center">Loading... ⏳</div>';
  const d = await data('load');
  if (!session) return render();
  if (d.error) {
    app.innerHTML = `<div class="card"><p>⚠️ ${esc(d.error)}</p><button onclick="refresh()">Try again</button></div>`;
    return;
  }
  state = d;
  render();
}

// Do an action, show any error, then reload
async function act(action, extra = {}, msg) {
  if (busy) return {};
  busy = true;
  const r = await data(action, extra);
  busy = false;
  if (r.error) { alert(r.error); return r; }
  if (msg) alert(msg);
  await refresh();
  return r;
}

// ---------- SCREENS ----------
function render() {
  $('outBtn').style.display = session ? 'block' : 'none';
  if (!session) {
    if (screen === 'register') return registerScreen();
    if (screen === 'login') return loginScreen();
    if (screen === 'join') return joinScreen();
    return welcomeScreen();
  }
  if (!state) return refresh();
  const isParent = state.role === 'parent';
  const fn = isParent ? window.parentScreen : window.kidScreen;
  if (typeof fn !== 'function') {
    app.innerHTML = `<div class="card center">
      <p>✅ You're logged in!</p>
      <p class="muted">This screen isn't added yet (${isParent ? 'parent.js' : 'kid.js'} is missing).</p>
      <button onclick="logout()">Log out</button></div>`;
    return;
  }
  fn();
}
function go(s) { screen = s; joinInfo = null; render(); }

function welcomeScreen() {
  app.innerHTML = `
    <div class="card center">
      <h2>Welcome! 👋</h2>
      <p>Finish homework and chores, earn screen time.</p>
      <button class="wide" onclick="go('register')">👨‍👩‍👧 Create a family (parents)</button>
      <button class="wide gray" onclick="go('login')">🔑 Parent log in</button>
      <button class="wide green" onclick="go('join')">🧒 I'm a kid</button>
    </div>`;
}

function registerScreen() {
  app.innerHTML = `
    <div class="card">
      <h2>Create a family</h2>
      <p class="muted">For parents and guardians only.</p>
      <input id="fam" placeholder="Family name (e.g. The Smiths)">
      <input id="email" type="email" placeholder="Parent email">
      <input id="pw" type="password" placeholder="Password (8+ characters)">
      <label class="check"><input id="consent" type="checkbox">
        I am a parent or guardian and agree to use this app with my children.</label>
      <button class="wide" onclick="doRegister()">Create family</button>
      <button class="gray" onclick="go('welcome')">← Back</button>
    </div>`;
}
async function doRegister() {
  const r = await api('/api/auth', { action: 'register', familyName: val('fam'), email: val('email'),
    password: $('pw').value, consent: $('consent').checked });
  if (r.error) return alert(r.error);
  setSession(r); refresh();
}

function loginScreen() {
  app.innerHTML = `
    <div class="card">
      <h2>Parent log in</h2>
      <input id="email" type="email" placeholder="Email">
      <input id="pw" type="password" placeholder="Password">
      <button class="wide" onclick="doLogin()">Log in</button>
      <button class="gray" onclick="go('welcome')">← Back</button>
    </div>`;
}
async function doLogin() {
  const r = await api('/api/auth', { action: 'login', email: val('email'), password: $('pw').value });
  if (r.error) return alert(r.error);
  setSession(r); refresh();
}

function joinScreen() {
  if (!joinInfo) {
    app.innerHTML = `
      <div class="card">
        <h2>🧒 Join your family</h2>
        <p>Ask your parent for the family code.</p>
        <input id="code" placeholder="Family code (e.g. K7XM2Q)" style="text-transform:uppercase">
        <button class="wide green" onclick="findFamily()">Next</button>
        <button class="gray" onclick="go('welcome')">← Back</button>
      </div>`;
    return;
  }
  app.innerHTML = `
    <div class="card">
      <h2>${esc(joinInfo.familyName)}</h2>
      <p>Who are you?</p>
      ${joinInfo.kids.map((k, i) => `<button class="wide green" onclick="pickKid(${i})">🧒 ${esc(k)}</button>`).join('')
        || '<p class="muted">No kids added yet. Ask your parent to add you.</p>'}
      <button class="gray" onclick="go('join')">← Back</button>
    </div>`;
}
async function findFamily() {
  const code = val('code').toUpperCase();
  const r = await api('/api/auth', { action: 'join', joinCode: code });
  if (r.error) return alert(r.error);
  joinInfo = { code, familyName: r.familyName, kids: r.kids };
  render();
}
async function pickKid(i) {
  const r = await api('/api/auth', { action: 'join', joinCode: joinInfo.code, kidName: joinInfo.kids[i] });
  if (r.error) return alert(r.error);
  setSession(r); refresh();
}

async function logout() {
  if (session) api('/api/auth', { action: 'logout', token: session.token });
  clearSession(); render();
}

window.addEventListener('load', render);
