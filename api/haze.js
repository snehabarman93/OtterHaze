// Haze Watch SG: server function (Vercel). The page calls it at /api/haze.
//
// It gathers NEA's open data (data.gov.sg), does the sums, and returns ONE small answer:
//   { updated, aqi, pm25, psi, temp, feels, humidity, regions, missing, ages }
// Any number it cannot work out is null, never a guess. The page shows null as a dash.

const BASE = "https://api-open.data.gov.sg/v2/real-time/api/";
const REGIONS = ["north", "south", "east", "west", "central"];
const MAX_WEATHER_AGE_MIN = 180; // a weather reading older than 3 hours is not used

// ---- small helpers --------------------------------------------------------
const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const round = (v) => (v === null ? null : Math.round(v));
const ageMin = (ts) => (ts ? Math.round((Date.now() - Date.parse(ts)) / 60000) : null);
// Today's date in Singapore (UTC+8), as YYYY-MM-DD. offset = -1 gives yesterday.
const sgDay = (offset = 0) => new Date(Date.now() + 8 * 3600e3 + offset * 864e5).toISOString().slice(0, 10);

// Whole request must finish within ~8 s (Vercel's free plan stops functions at 10 s).
const DEADLINE_MS = 8000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// One quick retry: NEA's open API sometimes answers 429/5xx for a moment, especially from shared hosting.
async function getJson(path, deadline, tries = 2) {
  let err = new Error(path + " out of time");
  for (let i = 0; i < tries; i++) {
    const left = Math.min(4000, deadline - Date.now());
    if (left <= 0) break;
    try {
      const r = await fetch(BASE + path, { signal: AbortSignal.timeout(left) });
      if (r.ok) return await r.json();
      err = new Error(path + " " + r.status);
    } catch (e) { err = e; }
    if (i < tries - 1) await sleep(300);
  }
  throw err;
}

// ---- PM2.5 to AQI ---------------------------------------------------------
// Matched against the Haze@SG app on 10 readings (10 of 10 agree).
// Up to 55.4 ug/m3 this is the older US EPA table. Above that the app is steeper than any EPA
// table, so this is a straight line fitted to the app's haze readings (tested up to about 141).
const BP = [[0, 12.0, 0, 50], [12.1, 35.4, 51, 100], [35.5, 55.4, 101, 150]];
function toAqi(c) {
  c = Math.floor(c * 10) / 10;
  if (c > 55.4) return Math.min(500, Math.round(151 + 1.049 * (c - 55.5)));
  const b = BP.find((x) => c <= x[1]);
  return Math.round(((b[3] - b[2]) / (b[1] - b[0])) * (Math.max(c, b[0]) - b[0]) + b[2]);
}

// ---- Feels like -----------------------------------------------------------
// NEA does not publish a "feels like" figure, so it is calculated here.
// Apparent temperature as used by the Australian Bureau of Meteorology (Steadman):
//   feels = T + 0.33 * e - 0.70 * wind - 4.00
//   T = air temperature (C), e = water vapour pressure (hPa) worked out from T and humidity,
//   wind = wind speed in metres per second.
// Other weather apps use other formulas (for example the US heat index, which ignores wind),
// so their number can differ by a degree or two. To change the method, change only this function.
function feelsLike(t, rh, windMs) {
  const e = (rh / 100) * 6.105 * Math.exp((17.27 * t) / (237.7 + t));
  return t + 0.33 * e - 0.7 * windMs - 4.0;
}

// ---- Island-wide numbers --------------------------------------------------
// AQI and PM2.5 are the average of the five regions (this is what the Haze@SG app does).
// PSI is also the plain average here. NEA may headline the highest region instead;
// to switch, replace `mean` with Math.max in islandPsi.
const islandMean = (vals) => {
  const v = vals.filter((x) => x !== null);
  return v.length >= 3 ? round(mean(v)) : null; // need at least 3 of 5 regions
};
const islandPsi = (vals) => islandMean(vals);

// ---- Air quality feeds (PM2.5 and PSI) ------------------------------------
// An hourly record can show up before its numbers are filled in. So a record only counts if at
// least 3 of the 5 regions have a number. If the newest one does not, use the newest one that does
// (today's list, then yesterday's).
const validRegions = (vals) => !!vals && REGIONS.filter((r) => num(vals[r]) !== null).length >= 3;
async function latestAir(name, key, deadline) {
  for (const path of [name, name + "?date=" + sgDay(), name + "?date=" + sgDay(-1)]) {
    try {
      const items = ((await getJson(path, deadline)).data || {}).items || [];
      const ok = items.filter((it) => it && it.readings && validRegions(it.readings[key]) && Date.parse(it.timestamp));
      if (ok.length) {
        const best = ok.reduce((a, b) => (Date.parse(b.timestamp) > Date.parse(a.timestamp) ? b : a));
        return { ts: best.timestamp, vals: best.readings[key] };
      }
    } catch (e) { /* try the next form */ }
  }
  return null;
}

// ---- Weather station feeds ------------------------------------------------
// The plain endpoint can lag. Humidity once returned a reading from the evening before while
// temperature was current. So ask for today's list instead (it comes newest first), fall back
// to yesterday's (just after midnight), and only then to the plain endpoint.
// The newest 5-minute record is sometimes only half filled in, so the newest record with at least
// 3 sensible stations is used, not simply the newest record.
// Average of the stations whose value is a sensible number. Needs at least 3 stations.
function stationMean(reading, lo, hi) {
  const v = reading.data.map((d) => num(d && d.value)).filter((x) => x !== null && x >= lo && x <= hi);
  return v.length >= 3 ? mean(v) : null;
}
async function latestStation(name, lo, hi, deadline) {
  let best = { ts: null, v: null };
  for (const path of [name + "?date=" + sgDay(), name + "?date=" + sgDay(-1), name]) {
    try {
      const list = (((await getJson(path, deadline)).data || {}).readings || [])
        .filter((r) => r && Array.isArray(r.data) && r.data.length && Date.parse(r.timestamp))
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
      for (const r of list) {
        const v = stationMean(r, lo, hi);
        if (v === null) continue;
        if (ageMin(r.timestamp) <= MAX_WEATHER_AGE_MIN) return { ts: r.timestamp, v };
        if (best.ts === null || Date.parse(r.timestamp) > Date.parse(best.ts)) best = { ts: r.timestamp, v };
        break; // older than this in the same list is older still
      }
    } catch (e) { /* try the next form */ }
  }
  return best; // nothing fresh: report how old the best one was (the caller treats it as missing)
}

// ---- The handler ----------------------------------------------------------
// Last good answers kept in memory (only helps while this server instance stays warm). If NEA
// hiccups for a moment, the page keeps showing the last good numbers instead of dashes, as long as
// they are under 3 hours old. The ages in the answer stay honest.
const MAX_AIR_AGE_MIN = 180;
let lastAir = null, lastWx = null;

module.exports = async (req, res) => {
  const deadline = Date.now() + DEADLINE_MS;
  const [pm, psi, temp, hum, wind] = await Promise.allSettled([
    latestAir("pm25", "pm25_one_hourly", deadline),
    latestAir("psi", "psi_twenty_four_hourly", deadline),
    latestStation("air-temperature", 15, 45, deadline),   // degrees C
    latestStation("relative-humidity", 1, 100, deadline), // percent
    latestStation("wind-speed", 0, 60, deadline),         // knots
  ]);

  const missing = [];
  const val = (s) => (s.status === "fulfilled" ? s.value : null);
  const pmItem = val(pm), psiItem = val(psi);
  if (!pmItem) missing.push("pm25");
  if (!psiItem) missing.push("psi");

  // Weather: use a reading only if it is recent enough.
  const weather = (s, name) => {
    const r = val(s) || { ts: null, v: null };
    const age = ageMin(r.ts);
    const v = r.v !== null && age !== null && age <= MAX_WEATHER_AGE_MIN ? r.v : null;
    if (v === null) missing.push(name);
    return { v, ts: r.ts };
  };
  const T = weather(temp, "temp");
  const H = weather(hum, "humidity");
  const W = weather(wind, "wind");

  // Regions
  const regions = {};
  REGIONS.forEach((r) => {
    const p = pmItem ? num(pmItem.vals[r]) : null;
    const s = psiItem ? num(psiItem.vals[r]) : null;
    regions[r] = { pm25: p, psi: s, aqi: p === null ? null : toAqi(p) };
  });

  // Feels like needs temperature and humidity. Missing wind is treated as calm air.
  const windMs = W.v === null ? 0 : W.v * 0.514444;
  const feels = T.v !== null && H.v !== null ? feelsLike(T.v, H.v, windMs) : null;

  const out = {
    updated: { pm25: pmItem ? pmItem.ts : null, psi: psiItem ? psiItem.ts : null, weather: T.ts },
    aqi: islandMean(REGIONS.map((r) => regions[r].aqi)),
    pm25: islandMean(REGIONS.map((r) => regions[r].pm25)),
    psi: islandPsi(REGIONS.map((r) => regions[r].psi)),
    temp: T.v === null ? null : Math.round(T.v * 10) / 10,
    feels: feels === null ? null : Math.round(feels * 10) / 10,
    humidity: round(H.v),
    regions,
    missing,
    ages: { pm25: ageMin(out_ts(pmItem)), psi: ageMin(out_ts(psiItem)), temp: ageMin(T.ts), humidity: ageMin(H.ts), wind: ageMin(W.ts) },
  };

  // Fall back to the last good numbers for a group that came back empty this time.
  const fallback = [];
  if (out.aqi !== null) {
    lastAir = { aqi: out.aqi, pm25: out.pm25, psi: out.psi, regions, upd: { pm25: out.updated.pm25, psi: out.updated.psi } };
  } else if (lastAir && ageMin(lastAir.upd.pm25) <= MAX_AIR_AGE_MIN) {
    Object.assign(out, { aqi: lastAir.aqi, pm25: lastAir.pm25, psi: lastAir.psi, regions: lastAir.regions });
    out.updated.pm25 = lastAir.upd.pm25; out.updated.psi = lastAir.upd.psi;
    out.ages.pm25 = ageMin(lastAir.upd.pm25); out.ages.psi = ageMin(lastAir.upd.psi);
    fallback.push("air");
  }
  if (out.temp !== null) {
    lastWx = { temp: out.temp, feels: out.feels, humidity: out.humidity, ts: out.updated.weather };
  } else if (lastWx && ageMin(lastWx.ts) <= MAX_WEATHER_AGE_MIN) {
    Object.assign(out, { temp: lastWx.temp, feels: lastWx.feels, humidity: lastWx.humidity });
    out.updated.weather = lastWx.ts;
    out.ages.temp = ageMin(lastWx.ts);
    fallback.push("weather");
  }
  out.fallback = fallback;

  // Everything failed: say so, and do not let this answer be cached.
  if (out.aqi === null && out.psi === null && out.temp === null && out.humidity === null) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: "No data from NEA", missing });
  }
  // A complete answer is kept for 5 minutes so NEA is not asked on every visit.
  // An incomplete one is kept for only 15 seconds, so a hiccup is not served to everyone for long.
  const degraded = missing.some((m) => m !== "wind") || fallback.length > 0;
  res.setHeader("Cache-Control", degraded
    ? "public, max-age=0, s-maxage=15"
    : "public, max-age=0, s-maxage=300, stale-while-revalidate=600");
  res.status(200).json(out);
};

function out_ts(x) { return x ? x.ts : null; }
module.exports.toAqi = toAqi;
module.exports.feelsLike = feelsLike;
module.exports._reset = () => { lastAir = null; lastWx = null; };
