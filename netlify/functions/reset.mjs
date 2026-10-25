import { getStore, listStores } from "@netlify/blobs";

// Storage names the app uses (plus any others found automatically)
const KNOWN = ["families", "codes", "sessions", "balances", "logs", "submissions", "photos", "emails", "users", "parents"];

const page = (body, status = 200) => new Response(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Reset</title>
<style>body{font-family:system-ui,sans-serif;background:#f0f4ff;padding:20px}
.card{background:#fff;max-width:500px;margin:auto;border-radius:12px;padding:20px}
a.btn{display:block;background:#dc2626;color:#fff;text-align:center;padding:14px;border-radius:8px;text-decoration:none;font-size:18px}</style>
</head><body><div class="card"><h2>🧹 Reset all data</h2>${body}</div></body></html>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

export default async (req) => {
  const url = new URL(req.url);
  const secret = Netlify.env.get("RESET_KEY");
  if (!secret) return page("<p>Reset is turned off. Add RESET_KEY in Netlify first.</p>", 403);
  const key = url.searchParams.get("key") || "";
  if (key !== secret) return page("<p>❌ Wrong key.</p>", 403);

  let names = [...KNOWN];
  try {
    const r = await listStores();
    names = [...new Set([...names, ...(r.stores || [])])];
  } catch (e) {}

  const confirm = url.searchParams.get("confirm") === "yes";
  const counts = [];
  let total = 0;

  for (const name of names) {
    const s = getStore({ name, consistency: "strong" });
    const { blobs } = await s.list();
    if (confirm) await Promise.all(blobs.map((b) => s.delete(b.key)));
    if (blobs.length) counts.push(`<li>${name}: ${blobs.length}</li>`);
    total += blobs.length;
  }

  if (confirm) {
    return page(`<p>✅ Deleted ${total} items.</p><ul>${counts.join("")}</ul>
      <p>Now open the app and create a new family.</p>
      <p><b>Remember to delete reset.mjs and RESET_KEY when you're done.</b></p>`);
  }

  return page(`<p>Found <b>${total}</b> saved items:</p><ul>${counts.join("") || "<li>Nothing saved</li>"}</ul>
    <p>⚠️ This erases <b>everything</b>. It can't be undone.</p>
    <a class="btn" href="/api/reset?key=${encodeURIComponent(key)}&confirm=yes">🗑️ Yes, erase everything</a>`);
};

export const config = { path: "/api/reset" };
