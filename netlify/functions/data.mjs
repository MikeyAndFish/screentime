import { getStore } from "@netlify/blobs";

const store = (name) => getStore({ name, consistency: "strong" });
const json = (data, status = 200) => Response.json(data, { status });

// ---------- Login check ----------
async function getSession(token) {
  if (!token) return null;
  const s = await store("sessions").get(String(token), { type: "json" });
  if (!s) return null;
  if (s.expires < Date.now()) {
    await store("sessions").delete(String(token));
    return null;
  }
  return s;
}

const getFamily = (id) => store("families").get(id, { type: "json" });
const saveFamily = (f) => store("families").setJSON(f.id, f);

// ---------- History log (one per family) ----------
async function getLog(fid) {
  return (await store("logs").get(fid, { type: "json" })) || [];
}
async function addLog(fid, entry) {
  const log = await getLog(fid);
  log.unshift({ ...entry, date: Date.now() });
  await store("logs").setJSON(fid, log.slice(0, 300)); // keep newest 300
}

// ---------- Balances (one per kid, per family) ----------
const balKey = (fid, kid) => `${fid}/${kid}`;
async function getBalance(fid, kid) {
  return (await store("balances").get(balKey(fid, kid), { type: "json" })) || 0;
}
async function changeBalance(fid, kid, delta, reason, type = "adjust") {
  const current = await getBalance(fid, kid);
  const actual = Math.max(-current, delta); // never below 0
  await store("balances").setJSON(balKey(fid, kid), current + actual);
  await addLog(fid, { kid, delta: actual, reason, type });
}

// Minutes used today, in the family's time zone
function usedToday(log, kid, tz) {
  const day = (t) => new Date(t).toLocaleDateString("en-US", { timeZone: tz });
  const today = day(Date.now());
  return log
    .filter((l) => l.kid === kid && (l.type === "spend" || l.type === "refund") && day(l.date) === today)
    .reduce((sum, l) => sum - l.delta, 0);
}

// ---------- Main ----------
export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  // Who is this?
  const session = await getSession(body.token);
  if (!session) return json({ error: "Please log in again", loggedOut: true }, 401);

  const fam = await getFamily(session.familyId);
  if (!fam) return json({ error: "Family not found", loggedOut: true }, 401);

  const fid = fam.id;
  const isParent = session.role === "parent";

  // If a parent removed this kid, log them out
  if (!isParent && !fam.kids.includes(session.kidName))
    return json({ error: "You were removed from this family", loggedOut: true }, 401);

  const action = body.action;
  const parentOnly = ["approve", "reject", "bonus", "addKid", "removeKid",
                      "addTask", "removeTask", "setAuto", "setLimit"];
  if (parentOnly.includes(action) && !isParent)
    return json({ error: "Only a parent can do that" }, 403);

  // Kids can only act for themselves. Parents choose which kid.
  const kidName = isParent ? body.kidName : session.kidName;

  let tz = "UTC";
  try {
    if (body.tz) { new Date().toLocaleDateString("en-US", { timeZone: body.tz }); tz = body.tz; }
  } catch {}

  fam.timers ||= {};

  switch (action) {
    case "load": {
      const balances = {};
      for (const k of fam.kids) balances[k] = await getBalance(fid, k);

      // Only this family's submissions
      const subStore = store("submissions");
      const { blobs } = await subStore.list({ prefix: fid + "/" });
      let subs = (await Promise.all(blobs.map((b) => subStore.get(b.key, { type: "json" }))))
        .filter(Boolean)
        .map(({ token, ...rest }) => rest) // never send the secret email token
        .sort((a, b) => b.date - a.date);
      if (!isParent) subs = subs.filter((s) => s.kidName === session.kidName);
      subs = subs.slice(0, 50);

      const log = await getLog(fid);
      const used = Object.fromEntries(fam.kids.map((k) => [k, usedToday(log, k, tz)]));

      // Only send timers that are still running
      const timers = {};
      for (const k in fam.timers) if (fam.timers[k] > Date.now()) timers[k] = fam.timers[k];

      return json({
        role: session.role,
        kidName: session.kidName,
        familyName: fam.familyName,
        joinCode: isParent ? fam.joinCode : undefined,
        kids: fam.kids,
        tasks: fam.tasks,
        dailyLimit: fam.dailyLimit,
        timers, balances, used, subs,
        log: isParent ? log.slice(0, 30) : []
      });
    }

    case "photo": {
      const id = String(body.id || "");
      const sub = await store("submissions").get(`${fid}/${id}`, { type: "json" });
      if (!sub) return json({ photo: null });
      if (!isParent && sub.kidName !== session.kidName) return json({ error: "Not allowed" }, 403);
      const photo = await store("photos").get(`${fid}/${id}`);
      return json({ photo: photo || null });
    }

    case "spend": {
      const m = parseInt(body.minutes);
      if (!fam.kids.includes(kidName)) return json({ error: "Unknown kid" }, 400);
      if (!m || m < 1) return json({ error: "Enter how many minutes" }, 400);
      if (fam.timers[kidName] > Date.now()) return json({ error: "Screen time is already running" }, 400);

      const bal = await getBalance(fid, kidName);
      if (m > bal) return json({ error: "Not enough minutes!" }, 400);

      const used = usedToday(await getLog(fid), kidName, tz);
      if (fam.dailyLimit && used + m > fam.dailyLimit)
        return json({ error: `Daily limit reached! You can use ${Math.max(0, fam.dailyLimit - used)} more minutes today.` }, 400);

      await changeBalance(fid, kidName, -m, "Used screen time", "spend");
      fam.timers[kidName] = Date.now() + m * 60000;
      await saveFamily(fam);
      return json({ ok: true, endsAt: fam.timers[kidName] });
    }

    case "stop": {
      const end = fam.timers[kidName];
      if (!end) return json({ ok: true, refund: 0 });
      const refund = Math.floor((end - Date.now()) / 60000);
      delete fam.timers[kidName];
      await saveFamily(fam);
      if (refund > 0) await changeBalance(fid, kidName, refund, "Stopped early (refund)", "refund");
      return json({ ok: true, refund: Math.max(0, refund) });
    }

    case "approve":
    case "reject": {
      const subStore = store("submissions");
      const key = `${fid}/${String(body.id || "")}`;
      const sub = await subStore.get(key, { type: "json" });
      if (!sub) return json({ error: "Submission not found" }, 404);
      if (sub.status !== "pending") return json({ error: `Already ${sub.status}` }, 400);

      sub.comment = String(body.comment || "").slice(0, 200);
      if (action === "approve") {
        const m = parseInt(body.minutes) || sub.minutes;
        if (!m || m < 1) return json({ error: "Enter the number of minutes" }, 400);
        sub.status = "approved";
        sub.minutes = m;
        await subStore.setJSON(key, sub);
        await changeBalance(fid, sub.kidName, m, "Approved: " + sub.taskName, "earn");
      } else {
        sub.status = "rejected";
        await subStore.setJSON(key, sub);
      }
      return json({ ok: true });
    }

    case "bonus": {
      const m = parseInt(body.minutes);
      if (!fam.kids.includes(kidName)) return json({ error: "Unknown kid" }, 400);
      if (!m) return json({ error: "Enter minutes (use - to remove, like -15)" }, 400);
      await changeBalance(fid, kidName, m, m > 0 ? "Bonus from parent" : "Removed by parent");
      return json({ ok: true });
    }

    case "addKid": {
      const name = String(body.kidName || "").replace(/\//g, "").trim().slice(0, 30);
      if (!name) return json({ error: "Enter a name" }, 400);
      if (fam.kids.includes(name)) return json({ error: "That name already exists" }, 400);
      if (fam.kids.length >= 10) return json({ error: "Maximum 10 kids per family" }, 400);
      fam.kids.push(name);
      await saveFamily(fam);
      return json({ ok: true });
    }

    case "removeKid": {
      fam.kids = fam.kids.filter((k) => k !== kidName);
      delete fam.timers[kidName];
      await saveFamily(fam);
      await store("balances").delete(balKey(fid, kidName));
      return json({ ok: true });
    }

    case "addTask": {
      const name = String(body.name || "").trim().slice(0, 40);
      const minutes = parseInt(body.minutes);
      if (!name || !minutes || minutes < 1) return json({ error: "Enter a task name and minutes" }, 400);
      if (fam.tasks.length >= 30) return json({ error: "Maximum 30 tasks" }, 400);
      fam.tasks.push({ id: "t" + Date.now(), name, minutes, autoApprove: !!body.autoApprove });
      await saveFamily(fam);
      return json({ ok: true });
    }

    case "removeTask": {
      fam.tasks = fam.tasks.filter((t) => t.id !== body.id);
      await saveFamily(fam);
      return json({ ok: true });
    }

    case "setAuto": {
      // Turn AI auto-approve on or off for one task
      const t = fam.tasks.find((x) => x.id === body.id);
      if (!t) return json({ error: "Task not found" }, 404);
      t.autoApprove = !!body.autoApprove;
      await saveFamily(fam);
      return json({ ok: true });
    }

    case "setLimit": {
      const v = parseInt(body.limit);
      fam.dailyLimit = isNaN(v) || v < 0 ? 0 : v;
      await saveFamily(fam);
      return json({ ok: true });
    }

    default:
      return json({ error: "Unknown action" }, 400);
  }
};

export const config = { path: "/api/data" };
