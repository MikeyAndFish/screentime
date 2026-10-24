// ===== kid.js: kid screen =====

function kidScreen() {
  const s = state, k = s.kidName;
  const bal = s.balances[k] || 0;
  const used = s.used[k] || 0;
  const end = s.timers[k];
  const leftToday = s.dailyLimit ? Math.max(0, s.dailyLimit - used) : null;

  const timePart = end ? `
      <p class="center">⏳ Screen time running</p>
      <div class="timer" id="countdown">${fmt(end - Date.now())}</div>
      <button class="red wide" onclick="kStop()">⏹ Stop early (get unused minutes back)</button>`
    : `
      <input id="spend" type="number" min="1" placeholder="Minutes to use">
      <button class="gray" onclick="$('spend').value=10">10</button>
      <button class="gray" onclick="$('spend').value=20">20</button>
      <button class="gray" onclick="$('spend').value=30">30</button>
      <button class="green wide" onclick="kSpend()">▶ Start screen time</button>`;

  app.innerHTML = `
    <div class="card">
      <h2>Hi ${esc(k)}! 👋
        <button class="gray" onclick="refresh()" style="float:right">🔄</button></h2>
      <div class="balance">${bal} min</div>
      <p class="muted center">screen time in your bank<br>
        Used today: ${used}${s.dailyLimit ? ' / ' + s.dailyLimit : ''} min
        ${leftToday !== null ? `<br>You can still use ${Math.min(leftToday, bal)} min today` : ''}</p>
      ${timePart}
    </div>

    <div class="card">
      <h3>📸 Submit a task</h3>
      <select id="task">
        ${s.tasks.map(t => `<option value="${esc(t.id)}">${esc(t.name)} (+${t.minutes} min)</option>`).join('')}
        <option value="other">⭐ Other (parent decides minutes)</option>
      </select>
      <textarea id="note" placeholder="What did you do?"></textarea>
      <input id="photo" type="file" accept="image/*" capture="environment">
      <button id="sendBtn" class="wide" onclick="kSubmit()">📤 Send to parent</button>
    </div>

    <div class="card">
      <h3>My submissions</h3>
      ${s.subs.map(x => `
        <div class="row">
          <div>${esc(x.taskName)}${x.note ? ' – ' + esc(x.note) : ''}
            <div class="muted">${when(x.date)}
              ${x.comment ? '<br>💬 ' + esc(x.comment) : ''}
              ${x.status === 'rejected' && x.ai?.reason ? '<br>🤖 ' + esc(x.ai.reason) : ''}</div>
          </div>
          <b class="${x.status}">${x.status === 'approved' ? '+' + x.minutes + ' min' : x.status}</b>
        </div>`).join('') || '<p class="muted">Nothing yet. Finish a task and send a photo!</p>'}
    </div>`;
}

// ---------- Screen time ----------
function kSpend() {
  const m = parseInt(val('spend'));
  const bal = state.balances[state.kidName] || 0;
  if (!m || m < 1) return alert('Enter how many minutes');
  if (m > bal) return alert(`Not enough minutes! You have ${bal}.`);
  act('spend', { minutes: m });
}

async function kStop() {
  if (!confirm('Stop screen time now?')) return;
  const r = await act('stop');
  if (r.ok) alert(r.refund > 0 ? `${r.refund} minutes returned to your bank 👍` : 'Timer stopped');
}

function kBeep() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)();
    const o = a.createOscillator();
    o.connect(a.destination); o.frequency.value = 880;
    o.start(); setTimeout(() => o.stop(), 1000);
  } catch (e) {}
  if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
}

// Update the countdown every second
setInterval(() => {
  if (!state || state.role !== 'kid') return;
  const end = state.timers[state.kidName];
  if (!end) return;
  const left = end - Date.now();
  if (left > 0) {
    const el = $('countdown');
    if (el) el.textContent = fmt(left);
    return;
  }
  delete state.timers[state.kidName];
  kBeep();
  alert("⏰ Time's up! Screen time is over.");
  refresh();
}, 1000);

// ---------- Submit a task ----------
// Shrink the photo so uploads are fast and small
function kResize(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, 800 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function kSubmit() {
  const file = $('photo').files[0];
  if (!file) return alert('Please take a photo as proof! 📸');
  const btn = $('sendBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Sending...';

  let photo;
  try { photo = await kResize(file); }
  catch (e) {
    btn.disabled = false; btn.textContent = '📤 Send to parent';
    return alert("Couldn't read that photo. Try another one.");
  }

  const r = await api('/api/submit', {
    token: session.token, tz,
    taskId: val('task'), note: val('note'), photo
  });

  if (r.error) {
    btn.disabled = false; btn.textContent = '📤 Send to parent';
    return alert(r.error);
  }
  if (r.status === 'approved') alert(`🤖 AI approved it! +${r.minutes} minutes added 🎉`);
  else alert('Sent! Waiting for your parent to approve ✅');
  refresh();
}

// end of kid.js
