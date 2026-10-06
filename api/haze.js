// Haze Watch SG: server function (Vercel). The page calls it at /api/haze.
//
// It gathers NEA's open data (data.gov.sg), does the sums, and returns ONE small answer:
//   { updated, aqi, pm25, psi, psiSource, psiNea, temp, feels, humidity, regions, missing, ages }
// Any number it cannot work out is null, never a guess. The page shows null as a dash.
//
// PSI: NEA's own 24-hour PSI is published once an hour and can trail the hourly PM2.5 feed by an hour or
// more. So the PSI shown here is worked out with NEA's method (lib/psi.js) from the newest hourly PM2.5
// (a rolling 24-hour mean) plus NEA's latest figures for the other five pollutants. `psiSource` says
// whether the number is "live" (that calculation) or "nea" (NEA's published PSI, used when the hourly
// PM2.5 history is incomplete). `psiNea` is always NEA's published island figure, for comparison.

const { subIndex, psiFrom, rollingMean } = require("../lib/psi");

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

// How long the page should trust air data: the page shows it as "Delayed" after AIR_STALE_MIN in data.js (2 h);
// the server keeps serving last-good air data for up to MAX_AIR_AGE_MIN below (3 h), flagged in `fallback`.

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
        return { ts: best.timestamp, vals: best.readings[key], readings: best.readings };
      }
    } catch (e) { /* try the next form */ }
  }
  return null;
}

// The hourly PM2.5 records for today and yesterday (Singapore dates), oldest first, so a rolling
// 24-hour mean can be worked out. Only records with at least 3 of 5 regions filled in count.
// If neither day's list can be read, fall back to just the newest record (no history, so no live PSI).
async function pm25Series(deadline) {
  const days = await Promise.allSettled([sgDay(-1), sgDay()].map((d) => getJson("pm25?date=" + d, deadline)));
  const byTs = new Map();
  days.forEach((d) => {
    if (d.status !== "fulfilled") return;
    (((d.value || {}).data || {}).items || []).forEach((it) => {
      const vals = it && it.readings && it.readings.pm25_one_hourly;
      if (validRegions(vals) && Date.parse(it.timestamp)) byTs.set(Date.parse(it.timestamp), { ts: it.timestamp, vals });
    });
  });
  if (byTs.size) return [...byTs.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  const one = await latestAir("pm25", "pm25_one_hourly", deadline);
  return one ? [{ ts: one.ts, vals: one.vals }] : null;
}

// The other five pollutants: NEA's published sub-index when there is one (worked out from unrounded
// data, so it is the more exact), otherwise worked out here from the published concentration.
const OTHER_POLLUTANTS = [
  ["pm10", "pm10_twenty_four_hourly"], ["so2", "so2_twenty_four_hourly"], ["co", "co_eight_hour_max"],
  ["o3", "o3_eight_hour_max"], ["no2", "no2_one_hour_max"],
];
function otherSubIndices(readings, region) {
  return OTHER_POLLUTANTS.map(([p, conc]) => {
    const published = readings[p + "_sub_index"] && num(readings[p + "_sub_index"][region]);
    if (published !== null && published !== undefined) return published;
    return subIndex(p, readings[conc] && num(readings[conc][region]));
  });
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
let lastPm = null, lastPsi = null, lastWx = null;

module.exports = async (req, res) => {
  const deadline = Date.now() + DEADLINE_MS;
  const [pm, psi, temp, hum, wind] = await Promise.allSettled([
    pm25Series(deadline),
    latestAir("psi", "psi_twenty_four_hourly", deadline),
    latestStation("air-temperature", 15, 45, deadline),   // degrees C
    latestStation("relative-humidity", 1, 100, deadline), // percent
    latestStation("wind-speed", 0, 60, deadline),         // knots
  ]);

  const missing = [];
  const val = (s) => (s.status === "fulfilled" ? s.value : null);
  const pmSeries = val(pm) || [];
  const pmItem = pmSeries.length ? pmSeries[pmSeries.length - 1] : null; // newest hour
  const psiItem = val(psi);
  if (!pmItem) missing.push("pm25");
  // "psi" is added to `missing` further down, once it is known whether either source gave a number.

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

  // PSI per region, two ways:
  //   nea  = NEA's published 24-hour PSI (the newest hourly PSI record)
  //   live = NEA's method (lib/psi.js) on the rolling 24-hour mean PM2.5 up to the newest hourly PM2.5,
  //          taking the highest of that and NEA's latest sub-indices for the other pollutants.
  // Live needs the PSI record too (on a clean day ozone or PM10 can be the highest sub-index, and only
  // that record has them) and at least 18 of the last 24 hours of PM2.5.
  const nea = {}, live = {};
  REGIONS.forEach((r) => {
    nea[r] = psiItem ? num(psiItem.vals[r]) : null;
    live[r] = null;
    if (!pmItem || !psiItem) return;
    const mean24 = rollingMean(pmSeries, r, pmItem.ts);
    if (mean24 === null) return;
    // NEA publishes the 24-hour PM2.5 as a whole number, and its sub-indices follow from the whole number
    live[r] = psiFrom([subIndex("pm25", Math.round(mean24)), ...otherSubIndices(psiItem.readings, r)]);
  });
  const useLive = REGIONS.filter((r) => live[r] !== null).length >= 3;
  const psiSource = useLive ? "live" : "nea";

  // Regions
  const regions = {};
  REGIONS.forEach((r) => {
    const p = pmItem ? num(pmItem.vals[r]) : null;
    const s = useLive && live[r] !== null ? live[r] : nea[r];
    regions[r] = { pm25: p, psi: s, aqi: p === null ? null : toAqi(p) };
  });

  // Feels like needs temperature and humidity. Missing wind is treated as calm air.
  const windMs = W.v === null ? 0 : W.v * 0.514444;
  const feels = T.v !== null && H.v !== null ? feelsLike(T.v, H.v, windMs) : null;

  const psiNow = islandPsi(REGIONS.map((r) => regions[r].psi));
  if (psiNow === null) missing.push("psi");
  const psiTs = useLive ? pmItem.ts : psiItem ? psiItem.ts : null; // the hour the PSI shown is for
  const out = {
    updated: { pm25: pmItem ? pmItem.ts : null, psi: psiTs, psiNea: psiItem ? psiItem.ts : null, weather: T.ts },
    aqi: islandMean(REGIONS.map((r) => regions[r].aqi)),
    pm25: islandMean(REGIONS.map((r) => regions[r].pm25)),
    psi: psiNow,
    psiSource: psiNow === null ? null : psiSource,
    psiNea: islandPsi(REGIONS.map((r) => nea[r])),
    temp: T.v === null ? null : Math.round(T.v * 10) / 10,
    feels: feels === null ? null : Math.round(feels * 10) / 10,
    humidity: round(H.v),
    regions,
    missing,
    ages: { pm25: ageMin(pmItem && pmItem.ts), psi: ageMin(psiTs), temp: ageMin(T.ts), humidity: ageMin(H.ts), wind: ageMin(W.ts) },
  };

  // Fall back to the last good numbers for a group that came back empty this time.
  // PM2.5 (with AQI) and PSI are separate NEA feeds, so each one falls back on its own:
  // a PSI hiccup no longer blanks PSI while PM2.5 is fine, and is never saved as the "last good" PSI.
  // `fallback` tells the page which parts are old, so it can say so.
  const fallback = [];
  if (out.aqi !== null) {
    lastPm = { aqi: out.aqi, pm25: out.pm25, ts: out.updated.pm25,
      regions: Object.fromEntries(REGIONS.map((r) => [r, { aqi: regions[r].aqi, pm25: regions[r].pm25 }])) };
  } else if (lastPm && ageMin(lastPm.ts) <= MAX_AIR_AGE_MIN) {
    Object.assign(out, { aqi: lastPm.aqi, pm25: lastPm.pm25 });
    REGIONS.forEach((r) => Object.assign(regions[r], lastPm.regions[r]));
    out.updated.pm25 = lastPm.ts; out.ages.pm25 = ageMin(lastPm.ts);
    fallback.push("pm25");
  }
  if (out.psi !== null) {
    lastPsi = { psi: out.psi, psiSource: out.psiSource, psiNea: out.psiNea, ts: out.updated.psi,
      regions: Object.fromEntries(REGIONS.map((r) => [r, regions[r].psi])) };
  } else if (lastPsi && ageMin(lastPsi.ts) <= MAX_AIR_AGE_MIN) {
    out.psi = lastPsi.psi; out.psiSource = lastPsi.psiSource; out.psiNea = lastPsi.psiNea;
    REGIONS.forEach((r) => { regions[r].psi = lastPsi.regions[r]; });
    out.updated.psi = lastPsi.ts; out.ages.psi = ageMin(lastPsi.ts);
    fallback.push("psi");
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

module.exports.toAqi = toAqi;
module.exports.feelsLike = feelsLike;
module.exports._reset = () => { lastPm = null; lastPsi = null; lastWx = null; };
