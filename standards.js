/* Haze Watch SG: standards.js
   Turns a PM2.5 reading (ug/m3) into an index number on several published scales.
   Used by app.js (the PSI "hourly estimate" and the "Other standards" section).
   Also loads in Node (module.exports) so the maths can be tested.

   IMPORTANT: every scale below is DEFINED on a 24-hour average of PM2.5 (the US EPA uses a
   "NowCast" for real-time). Here they are applied to the 1-hour PM2.5 that NEA publishes, which
   gives an early estimate that reacts faster than the official number. It is NOT an official reading.

   Each scale is a list of segments: [pm25 low, pm25 high, index low, index high, band key].
   Within a segment the index is interpolated linearly (NEA "Equation 1" / EPA formula):
     I = (Ihi - Ilo) / (Chi - Clo) * (C - Clo) + Ilo
   Band keys are the colour hooks in styles.css: good, moderate, sensitive, unhealthy, very, hazard. */
(function (root) {
  const SCALES = {
    // Singapore NEA PSI, PM2.5 sub-index (24-hour PM2.5). Source: NEA, "Computation of the
    // Pollutant Standards Index (PSI)". Check: 40 ug/m3 gives PSI 83. PM2.5 is rounded to a whole
    // number first, because NEA's table steps in whole numbers (12 / 13, 55 / 56, ...).
    psi: {
      name: 'NEA PSI, hourly estimate',
      round: 0,
      cap: 500,
      segs: [
        [0, 12, 0, 50, 'good', 'Good'],
        [13, 55, 51, 100, 'moderate', 'Moderate'],
        [56, 150, 101, 200, 'unhealthy', 'Unhealthy'],
        [151, 250, 201, 300, 'very', 'Very unhealthy'],
        [251, 350, 301, 400, 'hazard', 'Hazardous'],
        [351, 500, 401, 500, 'hazard', 'Hazardous']
      ]
    },
    // US EPA AQI, PM2.5 breakpoints in force since 6 May 2024 (EPA fact sheet, Feb 2024)
    epa: {
      name: 'US EPA AQI (2024)',
      round: 1,
      cap: 500,
      segs: [
        [0, 9.0, 0, 50, 'good', 'Good'],
        [9.1, 35.4, 51, 100, 'moderate', 'Moderate'],
        [35.5, 55.4, 101, 150, 'sensitive', 'Unhealthy for sensitive groups'],
        [55.5, 125.4, 151, 200, 'unhealthy', 'Unhealthy'],
        [125.5, 225.4, 201, 300, 'very', 'Very unhealthy'],
        [225.5, 325.4, 301, 500, 'hazard', 'Hazardous']
      ]
    },
    // India National AQI (CPCB), PM2.5 24-hour. 250 is the top of "Very poor"; the top of "Severe" (380) is
    // the CPCB figure as best recalled and only matters above 250 ug/m3.
    india: {
      name: 'India NAQI',
      round: 0,
      cap: 500,
      segs: [
        [0, 30, 0, 50, 'good', 'Good'],
        [31, 60, 51, 100, 'moderate', 'Satisfactory'],
        [61, 90, 101, 200, 'sensitive', 'Moderate'],
        [91, 120, 201, 300, 'unhealthy', 'Poor'],
        [121, 250, 301, 400, 'very', 'Very poor'],
        [251, 380, 401, 500, 'hazard', 'Severe']
      ]
    }
  };

  // WHO 2021 Global Air Quality Guidelines: 24-hour PM2.5 guideline level. A guideline, not an index.
  const WHO_24H_PM25 = 15;

  const ok = (v) => typeof v === 'number' && isFinite(v) && v >= 0;

  // Returns { value, band, label } for one scale, or null when the reading is missing.
  function convert(scaleKey, pm25) {
    const s = SCALES[scaleKey];
    if (!s || !ok(pm25)) return null;
    const f = Math.pow(10, s.round);
    let c = Math.floor(pm25 * f + 1e-9) / f;        // EPA truncates; NEA and CPCB use whole numbers
    if (s.round === 0) c = Math.round(pm25);        // whole-number scales: round, do not truncate
    const last = s.segs[s.segs.length - 1];
    const seg = s.segs.find((x) => c <= x[1]) || last;
    const v = Math.min(s.cap, Math.round(((seg[3] - seg[2]) / (seg[1] - seg[0])) * (Math.max(c, seg[0]) - seg[0]) + seg[2]));
    return { value: v, band: seg[4], label: seg[5] };
  }

  // Band for an index number that is already worked out (used for the island average of the regions).
  function bandOfIndex(scaleKey, v) {
    const s = SCALES[scaleKey];
    if (!s || !ok(v)) return null;
    const seg = s.segs.find((x) => v <= x[3]) || s.segs[s.segs.length - 1];
    return { band: seg[4], label: seg[5] };
  }

  const api = { SCALES, WHO_24H_PM25, convert, bandOfIndex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HazeStandards = api;
})(typeof window !== 'undefined' ? window : this);
