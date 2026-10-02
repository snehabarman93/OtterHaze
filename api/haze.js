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

async function getJson(path) {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(5000) }); // give up after 5 seconds
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
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

// ---- Weather station feeds ------------------------------------------------
// The plain endpoint can lag. Humidity once returned a reading from the evening before while
// temperature was current. So ask for today's list instead (it comes newest first), fall back
// to yesterday's (just after midnight), and only then to the plain endpoint.
async function latestStationReading(name) {
  for (const path of [name + "?date=" + sgDay(), name + "?date=" + sgDay(-1), name]) {
    try {
      const j = await getJson(path);
      const list = (j && j.data && j.data.readings) || [];
      const usable = list.filter((r) => r && Array.isArray(r.data) && r.data.length && Date.parse(r.timestamp));
      if (usable.length) {
        return usable.reduce((a, b) => (Date.parse(b.timestamp) > Date.parse(a.timestamp) ? b : a));
      }
    } catch (e) { /* try the next form */ }
  }
  throw new Error(name + ": no readings");
}

// Average of the stations whose value is a sensible number. Needs at least 3 stations.
function stationMean(reading, lo, hi) {
  const v = reading.data.map((d) => num(d && d.value)).filter((x) => x !== null && x >= lo && x <= hi);
  return v.length >= 3 ? mean(v) : null;
}

// ---- The handler ----------------------------------------------------------
module.exports = async (req, res) => {
  const [pm, psi, temp, hum, wind] = await Promise.allSettled([
    getJson("pm25"),
    getJson("psi"),
    latestStationReading("air-temperature"),
    latestStationReading("relative-humidity"),
    latestStationReading("wind-speed"),
  ]);

  const missing = [];
  const item = (s, key) => {
    const it = s.status === "fulfilled" && s.value && s.value.data && s.value.data.items && s.value.data.items[0];
    return it && it.readings && it.readings[key] ? { ts: it.timestamp, vals: it.readings[key] } : null;
  };
  const pmItem = item(pm, "pm25_one_hourly");
  const psiItem = item(psi, "psi_twenty_four_hourly");
  if (!pmItem) missing.push("pm25");
  if (!psiItem) missing.push("psi");

  // Weather: use a reading only if it is recent enough.
  const weather = (s, name, lo, hi) => {
    if (s.status !== "fulfilled") { missing.push(name); return { v: null, ts: null }; }
    const age = ageMin(s.value.timestamp);
    const v = age !== null && age <= MAX_WEATHER_AGE_MIN ? stationMean(s.value, lo, hi) : null;
    if (v === null) missing.push(name);
    return { v, ts: s.value.timestamp };
  };
  const T = weather(temp, "temp", 15, 45);       // degrees C
  const H = weather(hum, "humidity", 1, 100);    // percent
  const W = weather(wind, "wind", 0, 60);        // knots

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

  // Everything failed: say so, and do not let this answer be cached.
  if (!pmItem && !psiItem && T.v === null && H.v === null) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: "No data from NEA", missing });
  }
  // Keep a copy for 5 minutes so NEA is not asked on every visit.
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=600");
  res.status(200).json(out);
};

function out_ts(x) { return x ? x.ts : null; }
module.exports.toAqi = toAqi;
module.exports.feelsLike = feelsLike;
