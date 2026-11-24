// Run with: npm test   (uses Node's built-in test runner, no packages needed)
import test from "node:test";
import assert from "node:assert/strict";
import handler, { toKakaoQuery, categoryOf, slim, clearCache } from "../api/search.js";

function fakeRes() {
  return {
    code: 0, body: null, headers: {},
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const req = (q, ip = "1.1.1.1") => ({ method: "GET", query: { q }, headers: { "x-forwarded-for": ip } });

const DOC = (id, name, dist, cat = "음식점 > 일식 > 일본식라면") => ({
  id, place_name: name, category_name: cat, phone: "031-000-0000",
  road_address_name: "경기 안산시 상록구 한양대학로 1", address_name: "", x: "126.83", y: "37.29",
  distance: String(dist), place_url: `http://place.map.kakao.com/${id}`,
});

let calls = [];
function mockKakao(byCategory, status = 200) {
  calls = [];
  globalThis.fetch = async (url, opts) => {
    const u = new URL(url);
    calls.push({ u, opts });
    if (u.hostname !== "dapi.kakao.com") return { ok: true, json: async () => ({}) };
    if (status !== 200) return { ok: false, status, json: async () => ({}) };
    return { ok: true, json: async () => ({ documents: byCategory[u.searchParams.get("category_group_code")] || [] }) };
  };
}

test.beforeEach(() => {
  clearCache();
  process.env.KAKAO_REST_KEY = "test-key";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("English food words become Korean, other words stay", () => {
  assert.equal(toKakaoQuery("Ramen"), "라멘");
  assert.equal(toKakaoQuery("cheap  pizza"), "cheap 피자");
  assert.equal(toKakaoQuery("떡볶이"), "떡볶이");
});

test("category names are split and translated", () => {
  assert.deepEqual(categoryOf("음식점 > 한식 > 육류,고기"), { ko: "육류,고기", en: "Korean" });
  assert.deepEqual(categoryOf("음식점 > 카페"), { ko: "카페", en: "Cafe" });
  assert.deepEqual(categoryOf(""), { ko: "", en: "" });
});

test("slim keeps the app fields and works out walking minutes", () => {
  const p = slim(DOC("123", "라멘집", 670));
  assert.equal(p.k, "123");
  assert.equal(p.ko, "라멘집");
  assert.equal(p.group, "Japanese");
  assert.equal(p.m, 670);
  assert.equal(p.w, 10);
  assert.equal(p.lat, 37.29);
});

test("searches restaurants and cafes, merges, removes duplicates, sorts by distance", async () => {
  mockKakao({ FD6: [DOC("1", "far", 900), DOC("2", "near", 100)], CE7: [DOC("2", "near", 100), DOC("3", "mid", 400, "음식점 > 카페")] });
  const res = fakeRes();
  await handler(req("ramen"), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.query, "라멘");
  assert.deepEqual(res.body.places.map((p) => p.k), ["2", "3", "1"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].opts.headers.Authorization, "KakaoAK test-key");
  assert.equal(calls[0].u.searchParams.get("radius"), "3000");
});

test("second identical search is served from cache without calling Kakao", async () => {
  mockKakao({ FD6: [DOC("1", "a", 10)] });
  await handler(req("pizza"), fakeRes());
  const n = calls.length;
  const res = fakeRes();
  await handler(req("PIZZA"), res);
  assert.equal(res.body.cached, true);
  assert.equal(calls.length, n);
});

test("returns clear errors", async () => {
  let res = fakeRes();
  await handler(req("a"), res);
  assert.equal(res.code, 400);

  delete process.env.KAKAO_REST_KEY;
  res = fakeRes();
  await handler(req("ramen"), res);
  assert.equal(res.body.error, "search_not_configured");

  process.env.KAKAO_REST_KEY = "bad";
  mockKakao({}, 401);
  res = fakeRes();
  await handler(req("ramen"), res);
  assert.equal(res.body.error, "kakao_key_rejected");

  res = fakeRes();
  await handler({ method: "POST", query: {}, headers: {} }, res);
  assert.equal(res.code, 405);
});

test("rate limit kicks in per IP", async () => {
  mockKakao({ FD6: [] });
  let last;
  for (let i = 0; i < 25; i++) { last = fakeRes(); await handler(req("word" + i, "9.9.9.9"), last); }
  assert.equal(last.code, 429);
});

test("saves found places to Supabase only when the service key is set", async () => {
  mockKakao({ FD6: [DOC("7", "x", 50)] });
  await handler(req("kimbap"), fakeRes());
  assert.ok(!calls.some((c) => c.u.pathname.includes("discovered_places")));

  clearCache();
  process.env.SUPABASE_URL = "https://demo.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  mockKakao({ FD6: [DOC("7", "x", 50)] });
  await handler(req("kimbap"), fakeRes());
  const save = calls.find((c) => c.u.pathname.includes("discovered_places"));
  assert.ok(save);
  const rows = JSON.parse(save.opts.body);
  assert.equal(rows[0].kakao_id, "7");
});
