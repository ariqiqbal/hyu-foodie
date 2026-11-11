# HYU Foodie – web app

A phone web app for food near Hanyang University ERICA. People open one link. They do not need a Claude account.
They can tap "Add to Home Screen" to install it like an app.

## What is in this folder

| File / folder | What it does |
|---|---|
| `index.html` | The app (all screens) |
| `places.json` | 540 places from Kakao Map (+ HESS halal data), with English names and pictures |
| `img/` | Sample food photos (AI-made, one per food type) |
| `config.js` | Public settings: Supabase URL, Supabase anon key, Kakao JavaScript key |
| `api/ai.js` | Server function: AI Bot and Import (calls the Claude API) |
| `api/oembed.js` | Server function: reads the caption of a TikTok or YouTube link |
| `supabase/schema.sql` | Database tables for votes and saved places |
| `manifest.webmanifest`, `sw.js`, `icon-*.png` | "Add to Home Screen" and offline support |

## Which features need which setup

| Feature | Works with no setup | Needs |
|---|---|---|
| Browse, search, filters, place pages, Naver/Kakao links | Yes | – |
| Saved places on one phone | Yes | – |
| Votes, ERICA Pick, saved places on all devices | No | Step 1 (Supabase) |
| Real Kakao map | No | Step 2 (Kakao domain) |
| AI Bot, screenshot import, link import | No (simple keyword mode only) | Step 3 (Claude API key) + Step 4 (Vercel) |

---

## Step 1 – Supabase (votes and saved places) – about 5 min

1. Go to **supabase.com** → sign up → **New project**. Name: `hyu-foodie`. Region: **Northeast Asia (Seoul)**.
2. Open **SQL Editor** → **New query**. Paste all of `supabase/schema.sql` → **Run**.
3. Open **Authentication** → **Sign In / Providers** (or **Providers**) → turn **Anonymous sign-ins** ON → Save.
   Users get a hidden account automatically. They never see a login screen.
4. Open **Project Settings** → **API**. Copy:
   - **Project URL** → put in `config.js` as `SUPABASE_URL`
   - **anon public** key → put in `config.js` as `SUPABASE_ANON_KEY`
5. Do **not** use the `service_role` key anywhere. It is secret.

## Step 2 – Kakao map – about 2 min

The JavaScript key is already in `config.js`. Kakao only allows it on websites you list.

1. **developers.kakao.com** → **HYU Foodie** app → **플랫폼 키** (or **앱 키**) → **JavaScript 키**.
2. Find **JavaScript SDK 도메인** (old console: **플랫폼 → Web → 사이트 도메인**).
3. Add your website address after Step 4, for example `https://hyu-foodie.vercel.app`.
   Also add `http://localhost:3000` if you test on your computer.
4. Make sure **카카오맵** is still **ON**.

If the map does not load, the app shows a message and the **Dot map** still works.

## Step 3 – Claude API key (AI features) – about 3 min

1. Go to **console.anthropic.com** → sign up → **API Keys** → **Create Key**. Copy it.
2. Go to **Billing** → add credit → set a **monthly spend limit** (for example USD 5).
3. Keep the key secret. It goes **only** into Vercel (Step 4), never into `config.js` or GitHub.

Cost note: one AI Bot answer sends the list of 540 places (about 12k tokens). With the default
small model this is about 1–2 cents per question. The server allows 8 AI calls per minute per user.

## Step 4 – Put it online with Vercel – about 5 min

**Option A – GitHub + Vercel website (easiest)**
1. Make a GitHub account → **New repository** `hyu-foodie` → **uploading an existing file** → drag all files and folders from this folder → **Commit**.
2. Go to **vercel.com** → sign in with GitHub → **Add New → Project** → import `hyu-foodie`.
3. Framework Preset: **Other**. Build command: leave empty. Output directory: leave empty.
4. Open **Environment Variables** and add:
   - `ANTHROPIC_API_KEY` = your key from Step 3
   - (optional) `ANTHROPIC_MODEL` = a different Claude model id (default: `claude-haiku-5-5`)
   - (optional) `AI_PER_MINUTE` = AI calls per minute per user (default: `8`)
5. Click **Deploy**. You get a link like `https://hyu-foodie.vercel.app`.
6. Go back to Step 2 and add this link to the Kakao domains.

**Option B – Vercel command line**
```bash
npm i -g vercel
cd hyu-foodie-web
vercel                      # first deploy (preview)
vercel env add ANTHROPIC_API_KEY
vercel --prod               # real link
```

## Step 5 – Test (2 min)

1. Open the link on your phone.
2. Open a place → tap **Worth it** → open the app on another phone → the vote count goes up.
3. Tap the bookmark → **Saved** tab shows it.
4. **AI Bot** → tap "Something spicy" → you get 1–3 places.
5. **Import** → paste a TikTok link → it reads the caption and finds places.
6. **Map** → **Kakao map** shows dots. Tap one → the card shows below.
7. Browser menu → **Add to Home Screen**.

## Share with testers

- Send the link, or make a QR code of the link (for posters on campus).
- Testers need no account. Each phone gets an anonymous account, so votes count one per phone.

## Update the restaurant list

1. Run `hyu_foodie_collect_all.py` again → new `erica_all_places.csv`.
2. Make a new `places.json` from it (ask Claude to rebuild it with English names and pictures).
3. Replace `places.json` in GitHub → Vercel updates the site automatically.

## Security notes

- Public on purpose: Supabase URL, Supabase anon key, Kakao JavaScript key.
- Secret, never in this folder: Claude API key, Kakao REST key, Supabase service_role key.
- Database rules (in `schema.sql`): each user can change only their own votes and saved places.
  Everybody sees only vote totals, not who voted.
- Pictures are AI-made sample photos of the food type, not photos of the real shops.
