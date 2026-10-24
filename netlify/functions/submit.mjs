import { getStore } from "@netlify/blobs";
import Anthropic from "@anthropic-ai/sdk";
import crypto from "node:crypto";

const store = (name) => getStore({ name, consistency: "strong" });
const json = (data, status = 200) => Response.json(data, { status });
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Login check ----------
async function getSession(token) {
  if (!token) return null;
  const s = await store("sessions").get(String(token), { type: "json" });
  if (!s || s.expires < Date.now()) return null;
  return s;
}

// ---------- Add minutes (used for AI auto-approve) ----------
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

// ---------- AI check (only runs if ANTHROPIC_API_KEY is set) ----------
async function checkWithAI(photo, taskName) {
  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return null;
  try {
    const client = new Anthropic({ apiKey });
    const r = await client.messages.create({
      model: "claude-sonnet-4-5", // check Anthropic's docs for current model names
      max_tokens: 200,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: photo.split(",")[1] } },
          { type: "text", text:
            `A child says this photo proves they completed this task: "${taskName}".
Does the photo clearly show this task completed?
Also: is it a screenshot, a photo of a screen, or a picture from the internet?
Reply ONLY with JSON:
{"match": true or false, "confidence": "high" or "medium" or "low", "isScreenshot": true or false, "reason": "one short sentence"}` }
        ]
      }]
    });
    const ai = JSON.parse(r.content[0].text.match(/\{[\s\S]*\}/)[0]);
    return {
      match: ai.match === true,
      confidence: ["high", "medium", "low"].includes(ai.confidence) ? ai.confidence : "low",
      isScreenshot: ai.isScreenshot === true,
      reason: String(ai.reason || "").slice(0, 200)
    };
  } catch (e) {
    console.log("AI check failed:", e.message);
    return { match: false, confidence: "low", isScreenshot: false, reason: "AI check didn't work, so a parent will review it." };
  }
}

// ---------- Email (only runs if RESEND_API_KEY is set) ----------
async function emailParent(fam, sub, origin) {
  const apiKey = Netlify.env.get("RESEND_API_KEY");
  if (!apiKey) return;

  const link = `${origin}/api/approve?f=${fam.id}&id=${sub.id}&t=${sub.token}`;
  const auto = sub.status === "approved";
  const aiLine = sub.ai
    ? `<p>🤖 AI: ${esc(sub.ai.reason)} (confidence: ${esc(sub.ai.confidence)})</p>` : "";

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "ScreenTime Bank <onboarding@resend.dev>",
        to: fam.email,
        subject: auto
          ? `✅ Auto-approved: ${sub.kidName} – ${sub.taskName}`
          : `📸 ${sub.kidName} submitted: ${sub.taskName}`,
        html: `
          <p><b>${esc(sub.kidName)}</b> submitted <b>${esc(sub.taskName)}</b>
             ${sub.minutes ? `(+${sub.minutes} min)` : ""}</p>
          ${sub.note ? `<p>Note: ${esc(sub.note)}</p>` : ""}
          ${aiLine}
          ${auto
            ? "<p>The minutes were added automatically. You can check it in the app.</p>"
            : `<p><a href="${link}" style="background:#16a34a;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Review & approve</a></p>`}`
      })
    });
    if (!r.ok) console.log("Email failed:", await r.text());
  } catch (e) {
    console.log("Email failed:", e.message);
  }
}

// ---------- Main ----------
export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  const session = await getSession(body.token);
  if (!session) return json({ error: "Please log in again", loggedOut: true }, 401);
  if (session.role !== "kid") return json({ error: "Only kids can submit tasks. Log in as a kid to test." }, 403);

  const fam = await store("families").get(session.familyId, { type: "json" });
  if (!fam || !fam.kids.includes(session.kidName))
    return json({ error: "You were removed from this family", loggedOut: true }, 401);

  const photo = String(body.photo || "");
  if (!photo.startsWith("data:image/")) return json({ error: "Please add a photo" }, 400);
  if (photo.length > 3000000) return json({ error: "Photo is too big. Try another one." }, 400);

  const fid = fam.id;
  const task = fam.tasks.find((t) => t.id === body.taskId);
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(16).toString("hex"); // secret code for the email link

  await store("photos").set(`${fid}/${id}`, photo);

  // AI only checks preset tasks (not "Other")
  const ai = task ? await checkWithAI(photo, task.name) : null;
  const auto = !!(task && task.autoApprove && ai && ai.match && ai.confidence === "high" && !ai.isScreenshot);

  const sub = {
    id, token,
    kidName: session.kidName,
    taskName: task ? task.name : "⭐ Other",
    minutes: task ? task.minutes : 0,
    note: String(body.note || "").slice(0, 200),
    ai,
    status: auto ? "approved" : "pending",
    comment: auto ? "🤖 Auto-approved by AI" : "",
    date: Date.now()
  };
  await store("submissions").setJSON(`${fid}/${id}`, sub);

  if (auto) await addMinutes(fid, sub.kidName, sub.minutes, "🤖 AI approved: " + sub.taskName);

  await emailParent(fam, sub, new URL(req.url).origin);

  return json({ ok: true, status: sub.status, minutes: sub.minutes });
};

export const config = { path: "/api/submit" };
