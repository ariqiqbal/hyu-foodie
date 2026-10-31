// HYU Foodie - AI endpoint (Vercel serverless function)
// POST /api/ai  { task: "bot", message, votes }  or  { task: "import", url, caption, image: { data, type } }
// The Claude API key stays here on the server (env ANTHROPIC_API_KEY). Never put it in the web page.

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
const PER_MINUTE = Number(process.env.AI_PER_MINUTE) || 8; // simple per-IP limit
const DIET = {
  halal: "Halal certified", porkfree: "Pork-free options", halalc: "Maybe halal (not verified)",
  veganc: "Salad", chinese: "Chinese", none: "Not checked",
};

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  return list.length > PER_MINUTE;
}

let placesCache = null;
async function loadPlaces(req) {
  if (placesCache) return placesCache;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const r = await fetch(`${proto}://${req.headers.host}/places.json`);
  if (!r.ok) throw new Error("places.json not found");
  placesCache = await r.json();
  return placesCache;
}

export function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  return null;
}

export function botPrompt(places, message, votes) {
  const brief = places.map((p) => {
    const v = votes && Array.isArray(votes[p.id]) ? votes[p.id] : null;
    return `${p.id}|${p.name}${p.ko && p.ko !== p.name ? " (" + p.ko + ")" : ""}|${p.cuisine}|${DIET[p.diet] || "Not checked"}|${p.m ?? "?"}m` +
      `${(p.dishes || []).length ? "|dishes: " + p.dishes.join(", ") : ""}${p.note ? "|tip: " + p.note : ""}` +
      `${v ? `|votes ${v[0]} worth it / ${v[1]} not` : ""}`;
  }).join("\n");
  return `You are Foodie AI, a friendly food guide for students at Hanyang University ERICA (Ansan, Korea). Many users need halal or pork-free food. Pick 1 to 3 places ONLY from this list that fit the student's message. Distances are meters from the ERICA campus address (Hanyangdaehak-ro 55). If the student needs halal food or does not say, pick only "Halal certified" or "Pork-free options" places. Never say a "Not checked" or "Chinese" place is halal. Use the staff tips. Keep "reply" to 1-2 short, warm sentences in simple English. "why" is one short sentence each.
Places (id|name (Korean name)|cuisine|diet|distance|dishes|tip|votes):
${brief}

Student says: "${message.replace(/"/g, "'")}"
Reply with only JSON: {"reply": string, "picks": [{"id": string, "why": string}]}`;
}

export function importPrompt(places, url, caption, hasImage) {
  return `A student wants to save the restaurant(s) from a social media food post (TikTok, Instagram, YouTube or Naver Blog). ${hasImage ? "The attached image is a screenshot of the post: read every visible text, sign, caption, hashtag and location tag. " : ""}Find every restaurant the post is about. Match each to this list of places within 1.5 km of Hanyang University ERICA (Ansan). Korean names are given; captions may use Korean or English. If the post names a place that is not in the list, still return it with id null, its name as "guess", and "outside": true.
Places (id|name|Korean name|cuisine|address):
${places.map((p) => `${p.id}|${p.name}|${p.ko || ""}|${p.cuisine}|${p.address}`).join("\n")}

Post link: ${url || "(none)"}
Post text: """${caption || "(none)"}"""
Reply with only JSON: {"places":[{"id": string|null, "guess": string, "confidence": number 0-100, "outside": boolean, "reason": string (one short sentence)}]}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "post_only" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "ai_not_configured" });
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "rate_limited" });

  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

  let places;
  try { places = await loadPlaces(req); } catch { return res.status(500).json({ error: "places_missing" }); }

  let content;
  if (body.task === "bot") {
    const message = String(body.message || "").slice(0, 500).trim();
    if (!message) return res.status(400).json({ error: "empty_message" });
    content = [{ type: "text", text: botPrompt(places, message, body.votes || {}) }];
  } else if (body.task === "import") {
    const url = String(body.url || "").slice(0, 500);
    const caption = String(body.caption || "").slice(0, 4000);
    const img = body.image && typeof body.image.data === "string" ? body.image : null;
    if (img && !/^image\/(jpeg|png|webp)$/.test(img.type || "")) return res.status(400).json({ error: "bad_image_type" });
    if (img && img.data.length > 3_500_000) return res.status(413).json({ error: "image_too_large" });
    if (!caption && !img) return res.status(400).json({ error: "nothing_to_read" });
    content = [];
    if (img) content.push({ type: "image", source: { type: "base64", media_type: img.type, data: img.data } });
    content.push({ type: "text", text: importPrompt(places, url, caption, !!img) });
  } else {
    return res.status(400).json({ error: "unknown_task" });
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 800, messages: [{ role: "user", content }] }),
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      return res.status(r.status === 429 ? 429 : 502).json({ error: "upstream", status: r.status, detail });
    }
    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const out = parseJson(text);
    if (!out) return res.status(502).json({ error: "invalid_json" });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: "upstream_unreachable" });
  }
}
