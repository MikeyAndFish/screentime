import { getStore } from "@netlify/blobs";

const store = (name) => getStore({ name, consistency: "strong" });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// A simple web page for the parent
const page = (body, status = 200) => new Response(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ScreenTime Bank</title>
<style>
  body{font-family:system-ui,sans-serif;background:#f0f4ff;margin:0;padding:20px;color:#222}
  .card{background:#fff;max-width:500px;margin:auto;border-radius:12px;padding:20px;box-shadow:0 2px 6px rgba(0,0,0,.08);text-align:center}
  img{max-width:100%;border-radius:8px;margin:10px 0}
  input{width:100%;padding:10px;font-size:16px;border:1px solid #ccc;border-radius:8px;margin:6px 0;box-sizing:border-box}
  button{font-size:18px;padding:14px;border:none;border-radius:8px;color:#fff;width:100%;margin:6px 0;cursor:pointer}
  .ok{background:#16a34a}.no{background:#dc2626}.muted{color:#777;font-size:14px}
</style></head>
<body><div class="card"><h2>⏱️ ScreenTime Bank</h2>${body}</div></body></html>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

async function addMinutes(fid, kid, m, reason) {
  const balances = store("balances");
  const key = `${fid}/${kid}`;
  const current = (await balances.get(key, { type: "json" })) || 0;
  await balances.setJSON(key, current + m);

  const logs = store("logs");
  const log = (await logs.get(fid, { type: "json" })) || [];
  log.unshift({ kid, delta: m, reason, type: "earn", date: Date.now() });
  await logs.setJSON(fid, log.slice(0, 300));
}

export default async (req) => {
  const url = new URL(req.url);
  const fid = url.searchParams.get("f") || "";
  const id = url.searchParams.get("id") || "";
  const t = url.searchParams.get("t") || "";
  const key = `${fid}/${id}`;

  const subs = store("submissions");
  const sub = fid && id ? await subs.get(key, { type: "json" }) : null;
  if (!sub || !t || sub.token !== t)
    return page("<p>❌ This link is invalid or expired.</p>", 403);

  if (sub.status !== "pending")
    return page(`<p>This task was already <b>${esc(sub.status)}</b> ✔</p>`);

  const fam = await store("families").get(fid, { type: "json" });
  if (!fam || !fam.kids.includes(sub.kidName))
    return page("<p>This kid is no longer in the family.</p>");

  // ---------- Parent tapped a button ----------
  if (req.method === "POST") {
    const form = await req.formData();
    const action = form.get("action");
    sub.comment = String(form.get("comment") || "").slice(0, 200);

    if (action === "approve") {
      const m = parseInt(form.get("minutes"));
      if (!m || m < 1 || m > 600) return page("<p>Enter a number of minutes between 1 and 600.</p>", 400);
      sub.status = "approved";
      sub.minutes = m;
      await subs.setJSON(key, sub);
      await addMinutes(fid, sub.kidName, m, "Approved: " + sub.taskName);
      return page(`<h3>✅ Approved!</h3><p>${esc(sub.kidName)} got <b>+${m} minutes</b>.</p>`);
    }

    sub.status = "rejected";
    await subs.setJSON(key, sub);
    return page(`<h3>❌ Rejected</h3><p>${esc(sub.kidName)} will see it in the app.</p>`);
  }

  // ---------- Show the review page ----------
  const photo = await store("photos").get(key);
  const ai = sub.ai
    ? `<p>🤖 AI: ${esc(sub.ai.reason)}<br><span class="muted">(${esc(sub.ai.confidence)} confidence${sub.ai.isScreenshot ? ", ⚠️ might be a screenshot" : ""})</span></p>`
    : "";

  return page(`
    <h3>${esc(sub.kidName)}: ${esc(sub.taskName)}</h3>
    <p class="muted">${new Date(sub.date).toLocaleString("en-US")}</p>
    ${sub.note ? `<p>"${esc(sub.note)}"</p>` : ""}
    ${photo && photo.startsWith("data:image/") ? `<img src="${photo}" alt="Proof photo">` : "<p class='muted'>No photo</p>"}
    ${ai}
    <form method="POST">
      <label>Minutes to give</label>
      <input name="minutes" type="number" min="1" max="600" value="${sub.minutes || 10}">
      <input name="comment" placeholder="Comment for your kid (optional)">
      <button class="ok" name="action" value="approve">✅ Approve</button>
      <button class="no" name="action" value="reject">❌ Reject</button>
    </form>`);
};

export const config = { path: "/api/approve" };
