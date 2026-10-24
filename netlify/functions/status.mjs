import { getStore } from "@netlify/blobs";

const store = (name) => getStore({ name, consistency: "strong" });
const text = (t, status = 200) => new Response(t, {
  status,
  headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
});

// Answers "yes" if the kid has screen time running right now, otherwise "no"
// Example: /api/status?code=K7XM2Q&kid=Emma
export default async (req) => {
  const url = new URL(req.url);
  const code = (url.searchParams.get("code") || "").trim().toUpperCase();
  const kidParam = (url.searchParams.get("kid") || "").trim();
  if (!code || !kidParam) return text("error: add ?code=YOURCODE&kid=Name", 400);

  const fid = await store("codes").get(code);
  const fam = fid ? await store("families").get(fid, { type: "json" }) : null;
  if (!fam) return text("error: family code not found", 404);

  const kid = fam.kids.find((k) => k.toLowerCase() === kidParam.toLowerCase());
  if (!kid) return text("error: kid not found", 404);

  const end = (fam.timers || {})[kid];
  return text(end && end > Date.now() ? "yes" : "no");
};

export const config = { path: "/api/status" };
