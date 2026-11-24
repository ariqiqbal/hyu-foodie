// HYU Foodie - live place search (Vercel serverless function)
// GET /api/search?q=ramen
// Asks the Kakao Local API for restaurants and cafes near Hanyang University ERICA.
// The Kakao REST API key stays here on the server (env KAKAO_REST_KEY). Never put it in config.js.
//
// Optional: if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set, places found here are also
// remembered in the "discovered_places" table (status "unverified") so the team can review them later.

const KAKAO_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const CENTER = { lat: 37.2970, lon: 126.8350 }; // ERICA campus (same point as the app's map)
const RADIUS = Number(process.env.SEARCH_RADIUS_M) || 3000; // meters, Kakao max is 20000
const PER_MINUTE = Number(process.env.SEARCH_PER_MINUTE) || 20; // simple per-IP limit
const CATEGORIES = ["FD6", "CE7"]; // FD6 = restaurants, CE7 = cafes
const CACHE_MS = 10 * 60 * 1000;
const MAX_Q = 60;

// English words students type -> the Korean word Kakao understands.
// Kakao's search is Korean-first, so "ramen" finds far more as "라멘".
export const EN_KO = {
  pizza: "피자", burger: "햄버거", burgers: "햄버거", hamburger: "햄버거", chicken: "치킨",
  coffee: "카페", cafe: "카페", cafes: "카페", ramen: "라멘", noodle: "국수", noodles: "국수",
  sushi: "초밥", kebab: "케밥", halal: "할랄", curry: "카레", indian: "인도음식", thai: "태국음식",
  pho: "쌀국수", vietnamese: "베트남음식", chinese: "중식", japanese: "일식", korean: "한식",
  bbq: "고기", meat: "고기", pork: "돼지고기", beef: "소고기", tteokbokki: "떡볶이",
  bakery: "베이커리", bread: "빵", dessert: "디저트", salad: "샐러드", vegan: "비건",
  vegetarian: "채식", mexican: "멕시칸", taco: "타코", tacos: "타코", bubble: "버블티",
  boba: "버블티", dumpling: "만두", dumplings: "만두", kimbap: "김밥", gimbap: "김밥",
  bibimbap: "비빔밥", sandwich: "샌드위치", pasta: "파스타", steak: "스테이크",
  tonkatsu: "돈까스", donkatsu: "돈까스", mala: "마라탕", malatang: "마라탕",
  uzbek: "우즈베키스탄", turkish: "터키음식", soup: "국밥", gukbap: "국밥", jjajangmyeon: "짜장면",
  udon: "우동", donut: "도넛", donuts: "도넛", icecream: "아이스크림", brunch: "브런치",
  lunchbox: "도시락", dosirak: "도시락", seafood: "해산물", fish: "생선", tofu: "두부",
};

const CAT_EN = {
  "한식": "Korean", "중식": "Chinese", "일식": "Japanese", "양식": "Western", "카페": "Cafe",
  "치킨": "Chicken", "분식": "Korean street food", "패스트푸드": "Fast food", "아시아음식": "Asian",
  "간식": "Snacks & dessert", "술집": "Bar", "뷔페": "Buffet", "도시락": "Lunch box",
  "패밀리레스토랑": "Family restaurant", "샐러드": "Salad", "퓨전요리": "Fusion", "샤브샤브": "Shabu-shabu",
};

/** Turn "cheap ramen" into "cheap 라멘". Korean text and unknown words are kept as they are. */
export function toKakaoQuery(q) {
  return q.split(/\s+/).filter(Boolean).map((w) => EN_KO[w.toLowerCase()] || w).join(" ");
}

/** Kakao "음식점 > 한식 > 육류,고기" -> { ko: "육류,고기", en: "Korean" } */
export function categoryOf(name) {
  const parts = String(name || "").split(">").map((s) => s.trim()).filter(Boolean);
  const main = parts[1] || parts[0] || "";
  return { ko: parts[parts.length - 1] || "", en: CAT_EN[main] || CAT_EN[parts[0]] || main };
}

/** Keep only the fields the app shows. */
export function slim(d) {
  const m = d.distance === "" || d.distance == null ? null : Number(d.distance);
  const cat = categoryOf(d.category_name);
  return {
    k: String(d.id),
    ko: String(d.place_name || ""),
    cat: cat.ko,
    group: cat.en,
    phone: String(d.phone || ""),
    address: String(d.road_address_name || d.address_name || ""),
    lat: Number(d.y),
    lon: Number(d.x),
    m: Number.isFinite(m) ? m : null,
    w: Number.isFinite(m) ? Math.max(1, Math.round(m / 67)) : null, // ~67 m per walking minute, like places.json
    url: String(d.place_url || `https://place.map.kakao.com/${d.id}`).replace(/^http:/, "https:"),
  };
}

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  return list.length > PER_MINUTE;
}

const cache = new Map(); // query -> { at, places }
export function clearCache() { cache.clear(); hits.clear(); }

async function kakao(query, category) {
  const u = new URL(KAKAO_URL);
  u.search = new URLSearchParams({
    query, category_group_code: category, x: String(CENTER.lon), y: String(CENTER.lat),
    radius: String(RADIUS), sort: "accuracy", size: "15",
  }).toString();
  const r = await fetch(u, { headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_KEY}` } });
  if (!r.ok) {
    const err = new Error("kakao_" + r.status);
    err.status = r.status;
    throw err;
  }
  const j = await r.json();
  return Array.isArray(j.documents) ? j.documents : [];
}

async function remember(places) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !places.length) return;
  const now = new Date().toISOString();
  const rows = places.map((p) => ({
    kakao_id: p.k, name_ko: p.ko, category: p.cat, address: p.address, lat: p.lat, lon: p.lon, last_seen: now,
  }));
  try {
    await fetch(`${url.replace(/\/$/, "")}/rest/v1/discovered_places?on_conflict=kakao_id`, {
      method: "POST",
      headers: {
        apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(2500),
    });
  } catch { /* saving is a bonus; search still works without it */ }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "get_only" });
  if (!process.env.KAKAO_REST_KEY) return res.status(503).json({ error: "search_not_configured" });

  const q = String((req.query && req.query.q) || "").replace(/\s+/g, " ").trim().slice(0, MAX_Q);
  if (q.length < 2) return res.status(400).json({ error: "query_too_short" });

  const query = toKakaoQuery(q);
  const key = query.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
    return res.status(200).json({ q, query, places: hit.places, cached: true });
  }

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "rate_limited" });

  let docs;
  try {
    const lists = await Promise.all(CATEGORIES.map((c) => kakao(query, c)));
    docs = lists.flat();
  } catch (e) {
    if (e.status === 401 || e.status === 403) return res.status(502).json({ error: "kakao_key_rejected" });
    if (e.status === 429) return res.status(429).json({ error: "kakao_quota" });
    return res.status(502).json({ error: "upstream" });
  }

  const seen = new Set();
  const places = docs.map(slim)
    .filter((p) => p.k && Number.isFinite(p.lat) && Number.isFinite(p.lon) && !seen.has(p.k) && seen.add(p.k))
    .sort((a, b) => (a.m ?? 1e9) - (b.m ?? 1e9));

  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), places });
  await remember(places);

  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
  return res.status(200).json({ q, query, places });
}
