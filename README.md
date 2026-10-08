# Haze Watch SG: B2 · Watercolor Haze (handoff)

A plain HTML/CSS/JS version of the chosen design. Open `index.html` to preview; no build step.

```
index.html   structure, with data-bind hooks
styles.css   all visuals, driven by data-state / data-tone / data-pose on <html>
app.js       band code, render(data), sample data, mascot picker
data.js      fetches /api/haze, keeps last good values, retries, fills the page
api/haze.js  Vercel server function: reads NEA's open data and does the sums
test.html    tester page with sliders (sample data only, not linked from the site, marked noindex)
assets/      panda-* and otter-* pictures (6 poses each), grain.webp (full-strength noise tile, source for the next file), grain-soft.webp (the tile the page uses), island.webp (relief map), og.png (1200x630 share picture)
robots.txt   lets search engines in and points them to the sitemap
sitemap.xml  lists the one public page
favicon.ico, favicon-32.png, apple-touch-icon.png   browser tab and home-screen icons (the panda)
```

Preview a state: `index.html?demo=good` (or `moderate`, `sensitive`, `unhealthy`, `very`, `hazard`).

## Plug in your live data

Everything funnels through one call. This is the only place your data code touches the design:

```js
HazeWatch.render({
  aqi: 75, pm25: 24, psi: 52,     // island-wide
  temp: 31, feels: 37,            // degrees C
  regions: {
    north:   { pm25: 26, psi: 55 },
    east:    { pm25: 22, psi: 51 },
    west:    { pm25: 25, psi: 54 },
    south:   { pm25: 21, psi: 49 },
    central: { pm25: 24, psi: 52 }
  }
});
```

Call it after each fetch (the page already re-renders cleanly on repeat calls). `data.js` does this for the live site, and also wires up the Refresh button (`#refresh`). To show data on first paint, set `window.HAZE_INITIAL_DATA = {...}` before `app.js` loads. Until then the page shows "Loading" and dashes (never sample numbers).

## When NEA hiccups

- The function retries a failed request once, ignores an hourly or 5-minute record that is empty or half filled in and uses the newest complete one, and keeps its last good numbers (under 3 hours old) if a request comes back empty. PM2.5 and PSI fall back separately, and the answer lists what was filled in this way in `fallback`.
- An incomplete answer is cached for 15 seconds only (a complete one for 5 minutes), and the page looks again after 45 seconds, up to 4 times. A failed request (error or no connection) gets the same quick retries.
- The page keeps showing the last good values for any part that comes back empty (PM2.5, PSI or weather, each on its own), with a note and "Delayed" in the top bar. If there has never been a good answer, it says "Air data unavailable".

## Mascots

**Everyone sees the Panda by default.** Visitors can switch to the Otter with the two small icons in the header (top right); that choice is remembered in their browser and only saved when they pick one (click, or arrow keys on the icons); `?mascot=otter` forces one, handy for sharing. All have the same six poses, and everything else (shaking, breathing, sweat beads, shivering) works for each.

To add another mascot: put six transparent 440x440 .webp pictures in `assets/`, one per pose (good, moderate, mask, cough, oxygen, passout; the file names are up to you, the `files` map in `MASCOTS` points to them, e.g. the panda's mask and cough pictures are `panda-unhealthy` and `panda-hazard`), add an entry to `MASCOTS` in `app.js` (name, label, picture names, alt text), and add one line in `styles.css` per pose under "per-mascot face positions" (`--hx --hy --hrx --hry` = where the sweat beads may sit, `--mx --my` = mouth or mask). The picker builds itself from `MASCOTS`.

## Haze states

The page state comes from the AQI band (`AQI_BANDS` in `app.js`, six levels using the standard US AQI names). Region tints and pins also follow the AQI. The 24-hour PSI has its own five names (`PSI_BANDS`).

| AQI band | Background | Text theme | Panda | Specks |
|---|---|---|---|---|
| Good (≤50) | mint white #EEF4EC | light | happy | 4 |
| Moderate (≤100) | #DAD9D2 | light | worried | 14 |
| Sensitive groups (101-150) | #A3A19C | mid | mask, then coughing | 28 |
| Unhealthy (151-200) | #5A5957 | dark | oxygen mask | 38 |
| Very unhealthy (201-300) | #3B393B | dark | passed out | 48 |
| Hazardous (301+) | near black #1E1C1F | dark | passed out | 58 |

All per-state colours live as CSS variables under `[data-state="..."]` in `styles.css`.

## Design tokens

- Font: Hanken Grotesk, weights 200 to 500 (loaded from Google Fonts in `index.html`).
- Glass: 10% white fill, 12px backdrop blur, 1px light border (`--glass-bg`, `--glass-blur`).
- Grain: part of the page background on `.stage` in `styles.css` (`assets/grain-soft.webp`, 128px tile, `background-blend-mode: overlay`), not a layer on top of the page. A full-screen overlay with `mix-blend-mode` made the browser keep the whole page behind it in extra graphics-memory layers, about half of all GPU memory in measurements. The strength (0.4) is baked into the tile: each pixel is `128 + 0.4 * (pixel of assets/grain.webp - 128)`, which gives the same result as an overlay at opacity 0.4. To change the strength, remake the tile with another factor, e.g. `python3 -c "from PIL import Image; import numpy as np; a=np.array(Image.open('assets/grain.webp').convert('RGB')).astype(float); Image.fromarray(np.clip(np.round(128+0.4*(a-128)),0,255).astype('uint8')).save('assets/grain-soft.webp', lossless=True)"`. Because it is a background, the grain no longer sits over the cards, text and panda (the difference is under 1 level of 255 for 99% of pixels).
- Headline word: weight 200, size per state (`--band-size`), 60px on phones.
- Band colours: `--c-good … --c-hazard`, with lighter variants on the dark theme.

## Layout

Nav pill, then a hero (band word, tip, metrics card AQI | 1 hr PM 2.5 (µg/m³) | PSI 24-hour, temperature card Temperature | Feels like, and the panda), then the Island view, then a short "about the numbers" explainer (four native `<details>` dropdown rows in `.about`: PSI, 1-hour PM2.5, AQI, where the readings come from), then the Refresh button. At 720px and below: padding shrinks, the "Updated hourly" label hides, map pills hide and the region list under the map appears.

## Notes for the integrator

- The page starts with "Loading" and dashes; sample values only appear with `?demo=...`. The "+N° warmer" note is computed from `feels - temp`.
- Tip copy per state is in the `STATE` object in `app.js`.
- Map pins are positioned in percentages of a 1025×645 image; keep `island.webp` at that aspect ratio.
- Region tints are an SVG masked by the island image (`.isle-mask`), so they need `assets/island.webp` served from the same origin.
- If your site is Next.js: put `assets/` in `public/`, port `styles.css` into a global stylesheet, and move the markup into a component. Keep the `data-*` attributes on `<html>` (set them in an effect) since the CSS depends on them.

## Search, sharing and analytics

- `<head>` in `index.html` carries the page title, description, canonical link, Open Graph and Twitter share tags (picture: `assets/og.png`, 1200x630) and one JSON-LD block (WebSite and WebApplication).
- The site address `https://sghaze.vercel.app/` is written out in full, because these tags need absolute URLs and there is no build step. It appears 8 times in `index.html` (canonical, `og:url`, `og:image`, `twitter:image`, and four times in the JSON-LD), once in `robots.txt` and once in `sitemap.xml`. If the site moves to its own domain, change all 10 (`grep -rn sghaze.vercel.app .` finds them).
- The page headline is `<h1><span class="sr-only">Singapore haze today: </span><span data-bind="aqiBand">…</span></h1>`; the hidden words are for screen readers and search engines, and only the inner span is filled by `app.js`.
- Two analytics tags are loaded: Vercel Web Analytics (no cookies; needs Analytics switched on in the Vercel dashboard) and Google Analytics 4 (`gtag.js`, at the very top of `<head>`). Google Analytics uses cookies by default and the site has no consent banner yet.

## Live data

- `api/haze.js` is a Vercel serverless function (must stay in the `api/` folder). It reads NEA's data.gov.sg feeds (PM2.5, PSI, air temperature, humidity, wind), averages the weather stations, converts PM2.5 to AQI, calculates "feels like" (Steadman / Australian BoM apparent temperature) and returns one small JSON at `/api/haze`. Results are cached for 5 minutes.
- `data.js` calls `/api/haze` on load, on the Refresh button, and every 10 minutes while the tab is open, then passes the numbers to `HazeWatch.render()`.
- A single missing number shows as an en dash; a region with no readings at all says "No data". Air data more than 2 hours old, or old readings kept because a refresh failed, shows "Delayed" in the top bar with a note at the bottom. If the page has never had an answer it says "Air data unavailable" and tries again after 45 seconds (up to 4 times); sample data only appears with `?demo=good|moderate|sensitive|unhealthy|very|hazard`.
- NEA does not publish "feels like", so it is calculated. Other apps use other formulas and may differ by 1-3 °C. The formula is the single `feelsLike` function in `api/haze.js`.

## Pandas

Six static pictures in `assets/` (transparent, about 30 KB each). All movement is done in code (`styles.css`, "Panda" sections at the bottom).

Which panda shows (AQI picks it; a very high PSI can push it further):

| AQI | Panda | Extra movement |
|---|---|---|
| 0-50 | happy | gentle bob, sparkles |
| 51-100 | worried | slow sigh |
| 101-125 | face mask | small shake, chest heave |
| 126-150 | coughing in smoke | coughing fits, puffs |
| 151-200 | oxygen mask | heavy breaths, bubbles |
| 201+ (or PSI over 300) | passed out | slow shallow breathing |

PSI over 200 shows at least the oxygen mask. The thresholds are in `poseFor()` in `app.js`.

Temperature effects (air temperature, steps in `TEMP_STEPS` in `app.js`):

| Temperature | Effect |
|---|---|
| 24.9 C or below | shivering, icy glow, snow, breath |
| 25.0-29.9 C | none |
| 30.0-33.9 C | 5 sweat beads on the face |
| 34.0 C and above | 11 beads, faster, panda pants |

Sweat beads stay inside the panda's face: each pose has a head oval (`--hx --hy --hrx --hry` in `styles.css`) and the beads are clipped to it.

Strength of the air-quality shake per level is `--amp`, `--rot` and `--shake-dur` in `styles.css`. Everything stops for visitors with "reduce motion" turned on.

Looping animations are also frozen when they cannot be seen, to spare the visitor's CPU and GPU: all of them while the tab is hidden (`is-hidden` on `<html>`), the panda while its section is scrolled out of view (`is-off-panda`), and the map pin pulses while the map is (`is-off-map`). `app.js` sets the classes (IntersectionObserver, 80px margin) and `styles.css` ("Section scrolled out of view") pauses the animations; without IntersectionObserver nothing is paused.

The loops also rest when nobody is using the page. After `IDLE_MS` (60 seconds, top of that block in `app.js`) without a mouse move, key press, touch or scroll, `<html>` gets `is-resting`: `styles.css` ("Nobody using the page") then removes every animation, so the panda sits in its normal place and the pin pulses and little effects (which only show mid-animation) are hidden. Any of those inputs, or coming back to the tab, starts the motion again. Without this a page left open on a spare screen keeps the browser drawing 60 frames a second (about 4-5% CPU measured on a laptop with the panda passed out; 0% once the nav dot, pin pulses and breathing were switched off). The numbers keep refreshing while it rests.

Preview any combination: `index.html?demo=good&aqi=180&psi=250&temp=22`

## 1-hour PM 2.5 bands (NEA)

Shown under the PM 2.5 number as just the name (Normal, Elevated, High, Very High):

| 1 hr PM 2.5 (µg/m³) | Band |
|---|---|
| 0 to 55 | Band 1 · Normal |
| 56 to 150 | Band 2 · Elevated |
| 151 to 250 | Band 3 · High |
| 251 and above | Band 4 · Very High |
