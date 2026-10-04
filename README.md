# Haze Watch SG: B2 · Watercolor Haze (handoff)

A plain HTML/CSS/JS version of the chosen design. Open `index.html` to preview; no build step.

```
index.html   structure, with data-bind hooks
styles.css   all visuals, driven by data-state / data-theme / data-pose on <html>
app.js       band code, render(data), sample data
assets/      panda-good / moderate / unhealthy (mask) / hazard (coughing) / oxygen / passout .webp, island.webp (relief map)
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

Call it after each fetch (the page already re-renders cleanly on repeat calls). To skip the sample on first paint, set `window.HAZE_INITIAL_DATA = {...}` before `app.js` loads. The Refresh button (`#refresh`) has no handler yet; attach your fetch to it.

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
- Grain: `--grain: 0.7` at the top of `styles.css` (SVG noise, overlay blend).
- Headline word: weight 200, size per state (`--band-size`), 60px on phones.
- Band colours: `--c-good … --c-hazard`, with lighter variants on the dark theme.

## Layout

Nav pill, then a hero (band word, tip, metrics card AQI | PM2.5 | PSI, temperature card Temperature | Feels like, and the panda), then the Island view. At 720px and below: padding shrinks, the "Updated hourly" label hides, map pills hide and the region list under the map appears.

## Notes for the integrator

- Sample values and the placeholder labels ("Right now", "Hourly") are not live data. The "+N° warmer" note is computed from `feels - temp`.
- Tip copy per state is in the `STATE` object in `app.js`.
- Map pins are positioned in percentages of a 1025×645 image; keep `island.webp` at that aspect ratio.
- Region tints are an SVG masked by the island image (`.isle-mask`), so they need `assets/island.webp` served from the same origin.
- If your site is Next.js: put `assets/` in `public/`, port `styles.css` into a global stylesheet, and move the markup into a component. Keep the `data-*` attributes on `<html>` (set them in an effect) since the CSS depends on them.

## Live data

- `api/haze.js` is a Vercel serverless function (must stay in the `api/` folder). It reads NEA's data.gov.sg feeds (PM2.5, PSI, air temperature, humidity, wind), averages the weather stations, converts PM2.5 to AQI, calculates "feels like" (Steadman / Australian BoM apparent temperature) and returns one small JSON at `/api/haze`. Results are cached for 5 minutes.
- `data.js` calls `/api/haze` on load, on the Refresh button, and every 10 minutes while the tab is open, then passes the numbers to `HazeWatch.render()`.
- Anything missing shows as an en dash; stale air data shows "Delayed" in the top bar; sample data only appears with `?demo=good|moderate|sensitive|unhealthy|very|hazard`.
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

Preview any combination: `index.html?demo=good&aqi=180&psi=250&temp=22`
