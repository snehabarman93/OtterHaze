// Run with:  node --test test/
const test = require("node:test");
const assert = require("node:assert/strict");
const { subIndex, psiFrom, rollingMean } = require("../lib/psi");
const handler = require("../api/haze");

// ---- The formula, against NEA's own worked example and table ------------------
test("NEA worked example: 24-hr PM2.5 of 40 ug/m3 gives 83", () => {
  assert.equal(subIndex("pm25", 40), 83);
});

test("NEA worked example: overall PSI is the highest sub-index (83), NO2 not reported", () => {
  assert.equal(psiFrom([83, 48, 46, 15, 45, null]), 83);
});

test("every breakpoint in the table lands on its PSI value", () => {
  const { BREAKPOINTS } = require("../lib/psi");
  for (const [p, rows] of Object.entries(BREAKPOINTS)) {
    for (const [x, i] of rows) assert.equal(subIndex(p, x), i === 500 ? 500 : i, `${p} at ${x}`);
  }
});

test("category edges from the table (PM2.5)", () => {
  assert.equal(subIndex("pm25", 0), 0);
  assert.equal(subIndex("pm25", 12), 50);   // top of Good
  assert.equal(subIndex("pm25", 55), 100);  // top of Moderate
  assert.equal(subIndex("pm25", 150), 200); // top of Unhealthy
  assert.equal(subIndex("pm25", 250), 300); // top of Very Unhealthy
  assert.equal(subIndex("pm25", 350), 400);
});

test("above the top of the scale stays at 500; bad input gives null", () => {
  assert.equal(subIndex("pm25", 900), 500);
  assert.equal(subIndex("pm25", NaN), null);
  assert.equal(subIndex("pm25", -3), null);
  assert.equal(subIndex("pm25", null), null);
  assert.equal(subIndex("nope", 10), null);
});

test("NO2 is only reported from 1130 ug/m3", () => {
  assert.equal(subIndex("no2", 1129), null);
  assert.equal(subIndex("no2", 1130), 200);
  assert.equal(subIndex("no2", 2260), 300);
});

// NEA's published PSI record, 2026-10-05 18:00 SGT (north, south, west, east, central), read from
// api-open.data.gov.sg/v2/real-time/api/psi. The formula should reproduce NEA's sub-indices.
test("reproduces NEA's published sub-indices from its published concentrations", () => {
  const conc = {
    pm25: [50, 51, 74, 56, 76], pm10: [70, 70, 105, 88, 101], so2: [6, 5, 7, 5, 6], o3: [98, 50, 40, 61, 67],
  };
  const published = {
    pm25: [94, 95, 120, 101, 122], pm10: [60, 60, 78, 69, 76], so2: [4, 3, 4, 3, 4], o3: [42, 21, 17, 26, 29],
  };
  for (const p of ["pm25", "pm10", "so2"]) {
    assert.deepEqual(conc[p].map((x) => subIndex(p, x)), published[p], p);
  }
  // Ozone: NEA rounds the concentration it publishes, so one of five can be off by one
  conc.o3.forEach((x, k) => assert.ok(Math.abs(subIndex("o3", x) - published.o3[k]) <= 1, "o3 " + k));
});

// ---- Rolling 24-hour mean -------------------------------------------------
const hourly = (endIso, n, valFn) => {
  const end = Date.parse(endIso);
  return Array.from({ length: n }, (_, k) => {
    const t = end - (n - 1 - k) * 3600e3;
    return { ts: new Date(t).toISOString(), vals: { north: valFn(k), south: valFn(k), west: valFn(k), east: valFn(k), central: valFn(k) } };
  });
};

test("rolling mean uses the 24 hours ending at the newest hour", () => {
  const s = hourly("2026-10-06T04:00:00Z", 30, (k) => (k < 6 ? 1000 : 40)); // old spike must drop out
  assert.equal(rollingMean(s, "north", "2026-10-06T04:00:00Z"), 40);
});

test("rolling mean needs 18 of 24 hours, otherwise null", () => {
  const s = hourly("2026-10-06T04:00:00Z", 17, () => 40);
  assert.equal(rollingMean(s, "north", "2026-10-06T04:00:00Z"), null);
  assert.equal(rollingMean(hourly("2026-10-06T04:00:00Z", 18, () => 40), "north", "2026-10-06T04:00:00Z"), 40);
});

// Real data: NEA's hourly PM2.5 (pm25?date=2026-10-05) for 00:00 to 23:00, and the 24-hour PM2.5 that
// NEA's PSI feed published for 23:00 the same day. The mean of those 24 hours, rounded, must match.
test("24-hour mean of the hourly feed matches NEA's published 24-hour PM2.5 (5 Oct 2026, 23:00)", () => {
  const hourlyByRegion = {
    north:   [40, 53, 55, 59, 46, 43, 52, 41, 37, 39, 43, 36, 29, 37, 57, 83, 83, 75, 77, 104, 112, 89, 90, 77],
    south:   [73, 87, 86, 80, 68, 56, 51, 37, 26, 36, 19, 25, 43, 41, 39, 43, 56, 71, 75, 83, 86, 78, 88, 63],
    west:    [99, 104, 88, 79, 81, 100, 81, 65, 58, 73, 67, 62, 61, 63, 64, 94, 105, 78, 79, 72, 85, 94, 82, 73],
    east:    [44, 48, 81, 80, 74, 59, 49, 42, 39, 47, 42, 43, 49, 54, 46, 77, 76, 80, 79, 101, 115, 83, 92, 93],
    central: [62, 106, 91, 80, 54, 96, 93, 81, 83, 70, 52, 49, 52, 66, 72, 86, 91, 106, 97, 109, 143, 117, 108, 116],
  };
  const published = { north: 61, south: 59, west: 79, east: 66, central: 87 };
  const day = Date.parse("2026-10-05T00:00:00+08:00");
  const series = Array.from({ length: 24 }, (_, h) => ({
    ts: new Date(day + h * 3600e3).toISOString(),
    vals: Object.fromEntries(Object.entries(hourlyByRegion).map(([r, v]) => [r, v[h]])),
  }));
  const end = new Date(day + 23 * 3600e3).toISOString();
  for (const [r, want] of Object.entries(published)) {
    assert.equal(Math.round(rollingMean(series, r, end)), want, r);
  }
  // and the sub-indices that follow from them (north 61, central 87)
  assert.equal(subIndex("pm25", 61), 106);
  assert.equal(subIndex("pm25", 87), 134);
});

// ---- The API function, with NEA's feeds faked ---------------------------------
const NOW = Date.parse("2026-10-06T12:30:00+08:00");
const SG = (t) => new Date(t + 8 * 3600e3).toISOString().slice(0, 19) + "+08:00";
const allRegions = (v) => ({ north: v, south: v, west: v, east: v, central: v });

function psiRecord(tsMs, psiVal, pm25conc) {
  return {
    timestamp: SG(tsMs),
    readings: {
      psi_twenty_four_hourly: allRegions(psiVal),
      pm25_twenty_four_hourly: allRegions(pm25conc),
      pm10_sub_index: allRegions(40), so2_sub_index: allRegions(3), co_sub_index: allRegions(8), o3_sub_index: allRegions(30),
    },
  };
}

function fakeNea({ pmHours, pmValue, psiTs }) {
  return async (url) => {
    const u = new URL(url), path = u.pathname.split("/").pop(), date = u.searchParams.get("date");
    const json = (data) => ({ ok: true, status: 200, json: async () => ({ code: 0, data }) });
    if (path === "pm25") {
      const end = Date.parse("2026-10-06T12:00:00+08:00");
      const items = Array.from({ length: pmHours }, (_, k) => end - k * 3600e3)
        .map((t) => ({ timestamp: SG(t), readings: { pm25_one_hourly: allRegions(pmValue(t)) } }))
        .filter((it) => !date || it.timestamp.startsWith(date));
      return json({ items });
    }
    if (path === "psi") return json({ items: [psiRecord(psiTs, 70, 24)] });
    return json({ readings: [] }); // weather feeds: nothing, the page copes
  };
}

async function callHandler(fetchImpl) {
  const realFetch = global.fetch, realNow = Date.now;
  global.fetch = fetchImpl;
  Date.now = () => NOW;
  handler._reset();
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; } };
  try { await handler({}, res); } finally { global.fetch = realFetch; Date.now = realNow; }
  return res;
}

test("live PSI follows the newest hourly PM2.5, ahead of NEA's older PSI record", async () => {
  // PM2.5 has been a steady 60 ug/m3 for 36 hours; NEA's PSI record is two hours old and says 70
  const res = await callHandler(fakeNea({ pmHours: 36, pmValue: () => 60, psiTs: Date.parse("2026-10-06T10:00:00+08:00") }));
  assert.equal(res.code, 200);
  assert.equal(res.body.psiSource, "live");
  assert.equal(res.body.psi, 100 + Math.round((100 / 95) * 5)); // 24-hr mean 60 -> 105, more than other sub-indices
  assert.equal(res.body.psiNea, 70);                            // NEA's published figure is kept for comparison
  assert.equal(res.body.updated.psi, SG(Date.parse("2026-10-06T12:00:00+08:00")));
  assert.equal(res.body.updated.psiNea, SG(Date.parse("2026-10-06T10:00:00+08:00")));
  assert.equal(res.body.regions.north.psi, res.body.psi);
});

test("on a clean day another pollutant can be the highest sub-index", async () => {
  // PM2.5 of 5 gives a sub-index of about 21, below the 40 reported for PM10
  const res = await callHandler(fakeNea({ pmHours: 36, pmValue: () => 5, psiTs: Date.parse("2026-10-06T12:00:00+08:00") }));
  assert.equal(res.body.psiSource, "live");
  assert.equal(res.body.psi, 40);
});

test("too little PM2.5 history: fall back to NEA's published PSI, labelled as such", async () => {
  const res = await callHandler(fakeNea({ pmHours: 10, pmValue: () => 60, psiTs: Date.parse("2026-10-06T10:00:00+08:00") }));
  assert.equal(res.body.psiSource, "nea");
  assert.equal(res.body.psi, 70);
  assert.equal(res.body.updated.psi, SG(Date.parse("2026-10-06T10:00:00+08:00")));
});

test("no PSI record at all: no live PSI either, and PSI is reported missing", async () => {
  const base = fakeNea({ pmHours: 36, pmValue: () => 60, psiTs: NOW });
  const res = await callHandler(async (url) => (new URL(url).pathname.endsWith("/psi") ? { ok: false, status: 503 } : base(url)));
  assert.equal(res.body.psi, null);
  assert.equal(res.body.psiSource, null);
  assert.ok(res.body.missing.includes("psi"));
});
