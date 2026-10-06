// Pollutant Standards Index (PSI), worked out the way NEA describes it in
// "Computation of the Pollutant Standards Index (PSI)" (last updated March 2014).
//
// For each pollutant a sub-index (0 to 500) comes from a segmented linear function: straight lines
// joining the breakpoints in the table below. For a concentration X between breakpoints
// (Xj, Ij) and (Xj+1, Ij+1):
//
//     I = (Ij+1 - Ij) / (Xj+1 - Xj) * (X - Xj) + Ij
//
// The overall PSI is the highest of the sub-indices.
//
// Each row is [concentration, sub-index]. Units and averaging time:
//   pm25  24-hour mean, ug/m3        pm10  24-hour mean, ug/m3     so2  24-hour mean, ug/m3
//   co    8-hour max,   mg/m3        o3    8-hour max,   ug/m3     no2  1-hour max,   ug/m3
const BREAKPOINTS = {
  pm25: [[0, 0], [12, 50], [55, 100], [150, 200], [250, 300], [350, 400], [500, 500]],
  pm10: [[0, 0], [50, 50], [150, 100], [350, 200], [420, 300], [500, 400], [600, 500]],
  so2:  [[0, 0], [80, 50], [365, 100], [800, 200], [1600, 300], [2100, 400], [2620, 500]],
  co:   [[0, 0], [5, 50], [10, 100], [17, 200], [34, 300], [46, 400], [57.5, 500]],
  o3:   [[0, 0], [118, 50], [157, 100], [235, 200], [785, 300], [980, 400], [1180, 500]],
  // NO2 is only reported once the 1-hour concentration reaches 1130 ug/m3 (a sub-index of 200).
  no2:  [[1130, 200], [2260, 300], [3000, 400], [3750, 500]],
};
// Not applied: when the 8-hour ozone passes 785 ug/m3 NEA uses the 1-hour ozone instead. NEA does not
// publish a 1-hour ozone figure in its open data, and ozone has not been anywhere near that level.

const isNum = (v) => typeof v === "number" && isFinite(v);

// Sub-index for one pollutant, a whole number from 0 to 500, or null when there is nothing to report.
function subIndex(pollutant, x) {
  const bp = BREAKPOINTS[pollutant];
  if (!bp || !isNum(x) || x < 0) return null;
  if (x < bp[0][0]) return null;                       // NO2 below 1130: not reported
  if (x >= bp[bp.length - 1][0]) return 500;           // the scale stops at 500
  for (let j = 0; j < bp.length - 1; j++) {
    const [x0, i0] = bp[j], [x1, i1] = bp[j + 1];
    if (x <= x1) return Math.round(((i1 - i0) / (x1 - x0)) * (x - x0) + i0);
  }
  return null;
}

// Overall PSI: the highest of the sub-indices that exist. null when none do.
function psiFrom(subs) {
  const v = subs.filter(isNum);
  return v.length ? Math.max(...v) : null;
}

// Mean of the readings for one region over the 24 hours ending at endTs.
// `series` is a list of { ts, vals } hourly records (vals = { north, south, ... }).
// A 24-hour mean needs most of its hours, so fewer than minHours readings gives null (not a guess).
function rollingMean(series, region, endTs, hours = 24, minHours = 18) {
  const end = Date.parse(endTs), start = end - hours * 3600e3;
  const v = series
    .filter((s) => { const t = Date.parse(s.ts); return t > start && t <= end; })
    .map((s) => s.vals && s.vals[region])
    .filter(isNum);
  return v.length >= minHours ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

module.exports = { BREAKPOINTS, subIndex, psiFrom, rollingMean };
