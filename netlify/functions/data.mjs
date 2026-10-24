import { getStore } from "@netlify/blobs";

const store = (name) => getStore({ name, consistency: "strong" });
const json = (data, status = 200) => Response.json(data, { status });

const DEFAULTS = {
  kids: [],
  tasks: [
    { id: "t1", name: "📚 Homework", minutes: 20, autoApprove: false },
    { id: "t2", name: "🧹 Dishes", minutes: 15, autoApprove: false },
    { id: "t3", name: "🛏️ Make bed", minutes: 10, autoApprove: true },
    { id: "t4", name: "📖 Reading (30 min)", minutes: 20, autoApprove: false }
  ],
  dailyLimit: 120,
  timers: {}
};

// ---------- Helpers ----------
async function getSettings() {
  const s = await store("settings").get("family", { type: "json" });
  return s || structuredClone(DEFAULTS);
}
const saveSettings = (s) => store("settings").setJSON("family", s);

async function getLog() {
  return (await store("settings").get("log", { type: "json" })) || [];
}
async function addLog(entry) {
  const log = await getLog();
  log.unshift({ ...entry, date: Date.now() });
  await store("settings").setJSON("log", log.slice(0, 300));
}

async function getBalance(kid) {
  return (await store("balances").get(kid, { type: "json" })) || 0;
}
async function changeBalance(kid, delta, reason, type = "adjust") {
  const current = await getBalance(kid);
  const actual = Math.max(-current, delta);
  await store("balances").setJSON(kid, current + actual);
  await addLog({ kid, delta: actual, reason, type });
}

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

  const { familyCode, pin, action, kidName } = body;
  if (familyCode !== Netlify.env.get("FAMILY_CODE"))
    return json({ error: "Wrong family code" }, 403);

  const isParent = !!pin && pin === Netlify.env.get("PARENT_PIN");
  const parentOnly = ["approve", "reject", "bonus", "addKid", "removeKid", "addTask", "removeTask", "setLimit"];
  if (parentOnly.includes(action) && !isParent)
    return json({ error: "Parent PIN required" }, 403);

  let tz = "UTC";
  try { if (body.tz) { new Date().toLocaleDateString("en-US", { timeZone: body.tz }); tz = body.tz; } } catch {}

  const s = await getSettings();
  s.timers ||= {};

  switch (action) {
    case "checkPin":
      return json({ ok: isParent });

    case "load": {
      const balances = {};
      for (const k of s.kids) balances[k] = await getBalance(k);

      const subStore = store("submissions");
      const { blobs } = await subStore.list();
      const subs = (await Promise.all(blobs.map((b) => subStore.get(b.key, { type: "json" }))))
        .filter(Boolean)
        .map(({ token, ...rest }) => rest)
        .sort((a, b) => b.date - a.date)
        .slice(0, 50);

      const log = await getLog();
      const used = Object.fromEntries(s.kids.map((k) => [k, usedToday(log, k, tz)]));

      return json({
        kids: s.kids, tasks: s.tasks, dailyLimit: s.dailyLimit, timers: s.timers,
        balances, used, subs,
        log: isParent ? log.slice(0, 30) : []
      });
    }

    case "photo": {
      const photo = await store("photos").get(String(body.id || ""));
      return json({ photo: photo || null });
    }

    case "spend": {
      const m = parseInt(body.minutes);
      if (!s.kids.includes(kidName)) return json({ error: "Unknown kid" }, 400);
      if (!m || m < 1) return json({ error: "Enter how many minutes" }, 400);
      if (s.timers[kidName] > Date.now()) return json({ error: "Screen time is already running" }, 400);

      const bal = await getBalance(kidName);
      if (m > bal) return json({ error: "Not enough minutes!" }, 400);

      const used = usedToday(await getLog(), kidName, tz);
      if (s.dailyLimit && used + m > s.dailyLimit)
        return json({ error: `Daily limit reached! You can use ${Math.max(0, s.dailyLimit - used)} more minutes today.` }, 400);

      await changeBalance(kidName, -m, "Used screen time", "spend");
      s.timers[kidName] = Date.now() + m * 60000;
      await saveSettings(s);
      return json({ ok: true, endsAt: s.timers[kidName] });
    }

    case "stop": {
      const end = s.timers[kidName];
      if (!end) return json({ ok: true, refund: 0 });
      const refund = Math.floor((end - Date.now()) / 60000);
      delete s.timers[kidName];
      await saveSettings(s);
      if (refund > 0) await changeBalance(kidName, refund, "Stopped early (refund)", "refund");
      return json({ ok: true, refund: Math.max(0, refund) });
    }

    case "approve":
    case "reject": {
      const subStore = store("submissions");
      const sub = await subStore.get(String(body.id || ""), { type: "json" });
      if (!sub) return json({ error: "Submission not found" }, 404);
      if (sub.status !== "pending") return json({ error: `Already ${sub.status}` }, 400);

      sub.comment = String(body.comment || "").slice(0, 200);
      if (action === "approve") {
        const m = parseInt(body.minutes) || sub.minutes;
        sub.status = "approved";
        sub.minutes = m;
        await subStore.setJSON(sub.id, sub);
        await changeBalance(sub.kidName, m, "Approved: " + sub.taskName, "earn");
      } else {
        sub.status = "rejected";
        await subStore.setJSON(sub.id, sub);
      }
      return json({ ok: true });
    }

    case "bonus": {
      const m = parseInt(body.minutes);
      if (!s.kids.includes(kidName)) return json({ error: "Unknown kid" }, 400);
      if (!m) return json({ error: "Enter minutes (use - to remove, like -15)" }, 400);
      await changeBalance(kidName, m, m > 0 ? "Bonus from parent" : "Removed by parent");
      return json({ ok: true });
    }

    case "addKid": {
      const name = String(kidName || "").trim().slice(0, 30);
      if (!name) return json({ error: "Enter a name" }, 400);
      if (s.kids.includes(name)) return json({ error: "That name already exists" }, 400);
      s.kids.push(name);
      await saveSettings(s);
      return json({ ok: true });
    }

    case "removeKid": {
      s.kids = s.kids.filter((k) => k !== kidName);
      delete s.timers[kidName];
      await saveSettings(s);
      await store("balances").delete(kidName);
      return json({ ok: true });
    }

    case "addTask": {
      const name = String(body.name || "").trim().slice(0, 40);
      const minutes = parseInt(body.minutes);
      if (!name || !minutes || minutes < 1) return json({ error: "Enter a task name and minutes" }, 400);
      s.tasks.push({ id: "t" + Date.now(), name, minutes, autoApprove: !!body.autoApprove });
      await saveSettings(s);
      return json({ ok: true });
    }

    case "removeTask": {
      s.tasks = s.tasks.filter((t) => t.id !== body.id);
      await saveSettings(s);
      return json({ ok: true });
    }

    case "setLimit": {
      const v = parseInt(body.limit);
      s.dailyLimit = isNaN(v) || v < 0 ? 0 : v;
      await saveSettings(s);
      return json({ ok: true });
    }

    default:
      return json({ error: "Unknown action" }, 400);
  }
};

export const config = { path: "/api/data" };
