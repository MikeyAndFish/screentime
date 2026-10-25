// ===== parent.js: parent dashboard =====

function parentScreen() {
  const s = state;
  const pending = s.subs.filter(x => x.status === 'pending');
  const reviewed = s.subs.filter(x => x.status !== 'pending').slice(0, 10);

  app.innerHTML = `
    <div class="card">
      <h2>👨‍👩‍👧 ${esc(s.familyName)}
        <button class="gray" onclick="refresh()" style="float:right">🔄</button></h2>
      <p>Family code for kids:</p>
      <div class="code">${esc(s.joinCode)}</div>
      <p class="muted center">Kids tap "I'm a kid" and type this code.</p>
    </div>

    <div class="card">
      <h3>📸 Pending approvals (${pending.length})</h3>
      ${pending.map(pendingCard).join('') || '<p class="muted">All caught up! 🎉</p>'}
    </div>

    <div class="card">
      <h3>🧒 Kids</h3>
      ${s.kids.map((k, i) => `
        <div class="row">
          <div><b>${esc(k)}</b>
            <div class="muted">${s.balances[k] || 0} min in bank · used ${s.used[k] || 0} today
              ${s.timers[k] ? `<br>▶ Screen time on until ${new Date(s.timers[k]).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}` : ''}
            </div>
          </div>
          <div style="text-align:right">
            <input id="b_${i}" type="number" placeholder="± min" style="width:90px">
            <button onclick="pBonus(${i})">Apply</button>
            <button class="red" onclick="pRemoveKid(${i})">✕</button>
          </div>
        </div>`).join('') || '<p class="muted">No kids yet. Add one below.</p>'}
      <input id="newKid" placeholder="Kid's name">
      <button onclick="pAddKid()">+ Add kid</button>
    </div>

    <div class="card">
      <h3>📋 Tasks</h3>
      ${s.tasks.map(t => `
        <div class="row">
          <div>${esc(t.name)} <b>+${t.minutes} min</b>
            <label class="check muted">
              <input type="checkbox" ${t.autoApprove ? 'checked' : ''}
                onchange="pToggleAuto('${t.id}', this.checked)"> 🤖 AI auto-approve
            </label>
          </div>
          <button class="red" onclick="pRemoveTask('${t.id}')">✕</button>
        </div>`).join('') || '<p class="muted">No tasks yet.</p>'}
      <input id="taskName" placeholder="Task name (e.g. 🐶 Walk the dog)">
      <input id="taskMin" type="number" min="1" placeholder="Minutes earned">
      <label class="check"><input id="taskAuto" type="checkbox"> 🤖 Let AI auto-approve this task</label>
      <button onclick="pAddTask()">+ Add task</button>
    </div>

    <div class="card">
      <h3>⚙️ Settings</h3>
      <label>Daily screen time limit (minutes, 0 = no limit)</label>
      <input id="limit" type="number" min="0" value="${s.dailyLimit}">
      <button onclick="pSetLimit()">Save limit</button>

      <hr style="border:none;border-top:1px solid #eee;margin:14px 0">

      <label class="check"><input type="checkbox" ${s.allowUploads ? 'checked' : ''}
        onchange="pSetUploads(this.checked)"> 📁 Let kids upload photos from their gallery</label>
      ${s.allowUploads ? `
        <label class="check"><input type="checkbox" ${s.galleryAuto ? 'checked' : ''}
          onchange="pSetGalleryAuto(this.checked)"> 🤖 Let AI auto-approve gallery photos</label>
        <p class="muted">Off = gallery photos always come to you. On = AI can approve them too
          (less safe, since old or internet photos are harder to catch).</p>`
      : '<p class="muted">Off = live camera only (safest).</p>'}
    </div>

    <div class="card">
      <h3>✔️ Recently reviewed</h3>
      ${reviewed.map(x => `
        <div class="row">
          <div>${esc(x.kidName)} – ${esc(x.taskName)}
            ${x.source === 'gallery' ? ' <span class="muted">📁</span>' : ''}
            <div class="muted">${when(x.date)}${x.comment ? ' · 💬 ' + esc(x.comment) : ''}</div>
          </div>
          <b class="${x.status}">${x.status === 'approved' ? '+' + x.minutes + ' min' : x.status}</b>
        </div>`).join('') || '<p class="muted">Nothing yet.</p>'}
    </div>

    <div class="card">
      <h3>📜 History</h3>
      ${s.log.map(l => `
        <div class="row">
          <div>${esc(l.kid)} – ${esc(l.reason)}
            <div class="muted">${when(l.date)}</div>
          </div>
          <span class="${l.delta >= 0 ? 'plus' : 'minus'}">${l.delta >= 0 ? '+' : ''}${l.delta}</span>
        </div>`).join('') || '<p class="muted">No activity yet.</p>'}
    </div>`;

  pending.forEach(x => pLoadPhoto(x.id));
}

function pendingCard(x) {
  const ai = x.ai
    ? `<p>🤖 AI: ${esc(x.ai.reason)} <span class="muted">(${esc(x.ai.confidence)} confidence${x.ai.isScreenshot ? ', ⚠️ might be a screenshot' : ''})</span></p>`
    : '';
  return `
    <div class="card">
      <b>${esc(x.kidName)}</b> – ${esc(x.taskName)}
      <div class="muted">${when(x.date)}</div>
      ${x.note ? `<p>${esc(x.note)}</p>` : ''}
      ${ai}
      ${x.source === 'gallery' ? '<p>📁 <b>From gallery</b> (not a live photo)</p>' : ''}
      <img class="proof" id="img_${x.id}" alt="Loading photo...">
      <input id="c_${x.id}" placeholder="Comment for your kid (optional)">
      ${x.minutes ? `<button class="green" onclick="pApprove('${x.id}', ${x.minutes})">✅ Approve +${x.minutes} min</button>` : ''}
      <button class="green" onclick="pApprove('${x.id}', 10)">+10</button>
      <button class="green" onclick="pApprove('${x.id}', 20)">+20</button>
      <button class="green" onclick="pApprove('${x.id}', 30)">+30</button>
      <input id="m_${x.id}" type="number" min="1" placeholder="Custom minutes">
      <button onclick="pApproveCustom('${x.id}')">Approve custom</button>
      <button class="red" onclick="pReject('${x.id}')">❌ Reject</button>
    </div>`;
}

// Photos load separately so the page opens fast
async function pLoadPhoto(id) {
  if (!(id in photos)) {
    const r = await data('photo', { id });
    photos[id] = r.photo || '';
  }
  const img = $('img_' + id);
  if (img && photos[id]) img.src = photos[id];
  else if (img) img.alt = 'No photo';
}

// ---------- Actions ----------
function pApprove(id, m) {
  act('approve', { id, minutes: m, comment: val('c_' + id) });
}
function pApproveCustom(id) {
  const m = parseInt(val('m_' + id));
  if (!m || m < 1) return alert('Enter the number of minutes');
  pApprove(id, m);
}
function pReject(id) {
  act('reject', { id, comment: val('c_' + id) });
}
function pBonus(i) {
  const m = parseInt(val('b_' + i));
  if (!m) return alert('Enter minutes (use a minus sign to remove, like -15)');
  act('bonus', { kidName: state.kids[i], minutes: m });
}
function pAddKid() {
  act('addKid', { kidName: val('newKid') });
}
function pRemoveKid(i) {
  if (!confirm(`Remove ${state.kids[i]}? Their minutes will be deleted.`)) return;
  act('removeKid', { kidName: state.kids[i] });
}
function pAddTask() {
  act('addTask', { name: val('taskName'), minutes: val('taskMin'), autoApprove: $('taskAuto').checked });
}
function pRemoveTask(id) {
  if (!confirm('Remove this task?')) return;
  act('removeTask', { id });
}
function pToggleAuto(id, on) {
  act('setAuto', { id, autoApprove: on });
}
function pSetLimit() {
  act('setLimit', { limit: val('limit') }, 'Daily limit saved ✅');
}
function pSetUploads(on) {
  act('setUploads', { allowUploads: on });
}
function pSetGalleryAuto(on) {
  act('setGalleryAuto', { galleryAuto: on });
}

// end of parent.js
