// HYU Foodie - read a post caption from a TikTok or YouTube link (Vercel serverless function)
// GET /api/oembed?url=https://vt.tiktok.com/...
// Uses the platforms' public oEmbed endpoints. Instagram needs a Meta app token, so it is not supported here.

const ALLOWED = /(^|\.)tiktok\.com$|(^|\.)youtube\.com$|^youtu\.be$/;

export default async function handler(req, res) {
  const raw = String((req.query && req.query.url) || "").trim();
  let u;
  try { u = new URL(raw); } catch { return res.status(400).json({ error: "bad_url" }); }
  if (!/^https?:$/.test(u.protocol)) return res.status(400).json({ error: "bad_url" });
  const host = u.hostname.replace(/^www\./, "");
  if (!ALLOWED.test(host)) return res.status(200).json({ supported: false, host });

  try {
    let finalUrl = u.toString();
    // Short TikTok links (vt.tiktok.com / vm.tiktok.com) must be expanded first.
    if (/^(vt|vm)\.tiktok\.com$/.test(host)) {
      const r = await fetch(finalUrl, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 HYU-Foodie" } });
      const landed = new URL(r.url);
      if (!ALLOWED.test(landed.hostname.replace(/^www\./, ""))) return res.status(200).json({ supported: true, found: false });
      finalUrl = landed.origin + landed.pathname;
    }
    const isTikTok = /tiktok\.com$/.test(host);
    const endpoint = isTikTok
      ? `https://www.tiktok.com/oembed?url=${encodeURIComponent(finalUrl)}`
      : `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(finalUrl)}`;
    const r = await fetch(endpoint, { headers: { "user-agent": "Mozilla/5.0 HYU-Foodie" } });
    if (!r.ok) return res.status(200).json({ supported: true, found: false });
    const j = await r.json();
    res.setHeader("cache-control", "s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({
      supported: true, found: true, source: isTikTok ? "TikTok" : "YouTube",
      title: String(j.title || ""), author: String(j.author_name || ""), thumbnail: String(j.thumbnail_url || ""),
    });
  } catch {
    return res.status(200).json({ supported: true, found: false });
  }
}
