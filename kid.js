// ===== kid.js: kid screen (live camera only) =====
let camStream = null, camPhoto = null, camTime = 0;
const MAX_PHOTO_AGE = 10 * 60000; // 10 minutes

function kidScreen() {
  kStopCam();
  camPhoto = null;
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
      <button class="gray" onclick="$('spend').value=15">15</button>
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
      <div id="camBox">
        <button class="wide" onclick="kStartCam()">📷 Open camera</button>
        <p class="muted center">Take a live photo of your finished task.</p>
      </div>
      <button id="sendBtn" class="wide" onclick="kSubmit()" disabled>📤 Send to parent</button>
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
        </div>`).join('') || '<p class="muted">Nothing yet. Finish a task and take a photo!</p>'}
    </div>`;
}

// ---------- Screen time ----------
async function kSpend() {
  const m = parseInt(val('spend'));
  const bal = state.balances[state.kidName] || 0;
  if (!m || m < 1) return alert('Enter how many minutes');
  if (m > bal) return alert(`Not enough minutes! You have ${bal}.`);
  const r = await act('spend', { minutes: m });
  if (r.ok) alert(`▶ Timer started for ${m} min!\n\nIf your phone is locked, tap "Ask For More" so your parent can unlock it. 📱`);
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

setInterval(() => {
  // Turn the camera off if the camera screen is gone (for example, after logging out)
  if (camStream && !$('camVideo')) kStopCam();

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

// ---------- Live camera ----------
async function kStartCam() {
  if (!navigator.mediaDevices?.getUserMedia)
    return alert("This browser can't open the camera. Try Safari (iPhone) or Chrome (Android).");
  kStopCam();
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false
    });
  } catch (e) {
    return alert('Camera is blocked. Allow camera access for this website in your browser settings, then try again.');
  }
  $('camBox').innerHTML = `
    <video id="camVideo" autoplay playsinline muted style="width:100%;border-radius:8px;background:#000"></video>
    <button class="green wide" onclick="kSnap()">📸 Take photo</button>`;
  $('camVideo').srcObject = camStream;
  $('sendBtn').disabled = true;
}

function kSnap() {
  const v = $('camVideo');
  if (!v || !v.videoWidth) return alert('The camera is still starting. Try again in a second.');
  const scale = Math.min(1, 800 / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * scale);
  c.height = Math.round(v.videoHeight * scale);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  camPhoto = c.toDataURL('image/jpeg', 0.7);
  camTime = Date.now();
  kStopCam();
  $('camBox').innerHTML = `
    <img class="proof" src="${camPhoto}" alt="Your photo">
    <button class="gray" onclick="kStartCam()">🔄 Retake</button>`;
  $('sendBtn').disabled = false;
}

function kStopCam() {
  if (camStream) camStream.getTracks().forEach(t => t.stop());
  camStream = null;
}

// ---------- Submit a task ----------
async function kSubmit() {
  if (!camPhoto) return alert('Take a photo of your task first! 📸');
  if (Date.now() - camTime > MAX_PHOTO_AGE) {
    camPhoto = null;
    $('sendBtn').disabled = true;
    $('camBox').innerHTML = `<button class="wide" onclick="kStartCam()">📷 Open camera</button>`;
    return alert('That photo is more than 10 minutes old. Please take a new one.');
  }

  const btn = $('sendBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Sending...';

  const r = await api('/api/submit', {
    token: session.token, tz,
    taskId: val('task'), note: val('note'), photo: camPhoto
  });

  if (r.error) {
    btn.disabled = false;
    btn.textContent = '📤 Send to parent';
    return alert(r.error);
  }
  camPhoto = null;
  if (r.status === 'approved') alert(`🤖 AI approved it! +${r.minutes} minutes added 🎉`);
  else alert('Sent! Waiting for your parent to approve ✅');
  refresh();
}

// end of kid.js
