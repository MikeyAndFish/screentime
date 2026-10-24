import { getStore } from "@netlify/blobs";

export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id"), token = url.searchParams.get("token");
  const subs = getStore("submissions");
  const sub = await subs.get(id, { type: "json" });

  if (!sub || sub.token !== token) return new Response("Invalid link", { status: 403 });
  const page = body => new Response(
    `<html><body style="font-family:sans-serif;text-align:center;padding:40px">${body}</body></html>`,
    { headers: { "Content-Type": "text/html" } });

  if (sub.status !== "pending") return page(`<h2>Already ${sub.status} ✔</h2>`);

  if (req.method === "POST") {
    const action = (await req.formData()).get("action");
    sub.status = action === "approve" ? "approved" : "rejected";
    await subs.setJSON(id, sub);
    if (action === "approve") {
      const balances = getStore("balances");
      const current = (await balances.get(sub.kidName, { type: "json" })) || 0;
      await balances.setJSON(sub.kidName, current + sub.minutes);
    }
    return page(`<h2>${action === "approve" ? "✅ Approved!" : "❌ Rejected"}</h2>`);
  }

  return page(`
    <h2>${sub.kidName}: ${sub.taskName}</h2>
    <p>🤖 ${sub.ai.reason}</p>
    <form method="POST">
      <button name="action" value="approve" style="font-size:20px;padding:14px;background:#16a34a;color:#fff;border:none;border-radius:8px">✅ Approve +${sub.minutes} min</button>
      <button name="action" value="reject" style="font-size:20px;padding:14px;background:#dc2626;color:#fff;border:none;border-radius:8px">❌ Reject</button>
    </form>`);
};

export const config = { path: "/api/approve" };
