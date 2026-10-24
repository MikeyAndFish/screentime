import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const store = (name) => getStore({ name, consistency: "strong" });
const json = (data, status = 200) => Response.json(data, { status });
const DAY = 86400000;

const DEFAULT_TASKS = [
  { id: "t1", name: "📚 Homework", minutes: 20, autoApprove: false },
  { id: "t2", name: "🧹 Dishes", minutes: 15, autoApprove: false },
  { id: "t3", name: "🛏️ Make bed", minutes: 10, autoApprove: true },
  { id: "t4", name: "📖 Reading (30 min)", minutes: 20, autoApprove: false }
];

// Scramble passwords so they're never saved as plain text
const hash = (password, salt) => crypto.scryptSync(password, salt, 64).toString("hex");

function newJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I to avoid confusion
  return Array.from(crypto.randomBytes(6), (b) => chars[b % chars.length]).join("");
}

async function createSession(familyId, role, kidName = null) {
  const token = crypto.randomBytes(24).toString("hex");
  const days = role === "parent" ? 30 : 180;
  await store("sessions").setJSON(token, { familyId, role, kidName, expires: Date.now() + days * DAY });
  return token;
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  const action = body.action;
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  // ---------- PARENT SIGN UP ----------
  if (action === "register") {
    const familyName = String(body.familyName || "").trim().slice(0, 40);
    if (!familyName) return json({ error: "Enter a family name" }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email" }, 400);
    if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    if (!body.consent) return json({ error: "A parent or guardian must agree to the terms" }, 400);
    if (await store("emails").get(email)) return json({ error: "That email is already registered" }, 400);

    const id = crypto.randomUUID();
    let joinCode;
    do { joinCode = newJoinCode(); } while (await store("codes").get(joinCode));

    const salt = crypto.randomBytes(16).toString("hex");
    const family = {
      id, familyName, email, salt,
      passwordHash: hash(password, salt),
      joinCode,
      kids: [],
      tasks: DEFAULT_TASKS,
      dailyLimit: 120,
      timers: {},
      created: Date.now()
    };

    await store("families").setJSON(id, family);
    await store("emails").set(email, id);
    await store("codes").set(joinCode, id);

    const token = await createSession(id, "parent");
    return json({ ok: true, token, role: "parent", familyName, joinCode });
  }

  // ---------- PARENT LOG IN ----------
  if (action === "login") {
    const id = await store("emails").get(email);
    const fam = id ? await store("families").get(id, { type: "json" }) : null;
    if (!fam) return json({ error: "Wrong email or password" }, 401);

    const ok = crypto.timingSafeEqual(
      Buffer.from(hash(password, fam.salt), "hex"),
      Buffer.from(fam.passwordHash, "hex")
    );
    if (!ok) return json({ error: "Wrong email or password" }, 401);

    const token = await createSession(fam.id, "parent");
    return json({ ok: true, token, role: "parent", familyName: fam.familyName, joinCode: fam.joinCode });
  }

  // ---------- KID JOIN ----------
  // Step 1: send joinCode only → get the list of kid names
  // Step 2: send joinCode + kidName → get logged in
  if (action === "join") {
    const code = String(body.joinCode || "").trim().toUpperCase();
    const id = code ? await store("codes").get(code) : null;
    const fam = id ? await store("families").get(id, { type: "json" }) : null;
    if (!fam) return json({ error: "Code not found. Ask your parent for the family code." }, 404);

    if (!body.kidName) return json({ ok: true, familyName: fam.familyName, kids: fam.kids });

    if (!fam.kids.includes(body.kidName)) return json({ error: "Name not found in this family" }, 400);
    const token = await createSession(fam.id, "kid", body.kidName);
    return json({ ok: true, token, role: "kid", kidName: body.kidName, familyName: fam.familyName });
  }

  // ---------- LOG OUT ----------
  if (action === "logout") {
    if (body.token) await store("sessions").delete(String(body.token));
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
};

export const config = { path: "/api/auth" };
