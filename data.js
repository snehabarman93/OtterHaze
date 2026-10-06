/* Haze Watch SG: data.js
   Fetches live readings from /api/haze (see api/haze.js) and hands them to
   HazeWatch.render(). Skipped when the URL has a valid ?demo=<state> (an unknown one loads live data). */
(function () {
  if (HazeWatch.DEMO[new URLSearchParams(location.search).get('demo')]) return;

  const $ = (id) => document.getElementById(id);
  const btn = $('refresh'), updated = $('updated'), live = $('live'), status = $('status');
  const REFRESH_MS = 10 * 60 * 1000;
  const AIR_STALE_MIN = 120;      // air data older than this shows "Delayed" (the server gives up on it at 180, see api/haze.js)
  const RETRY_MS = 45 * 1000, MAX_RETRIES = 4; // after a hiccup, look again soon, a few times
  let lastGood = null, lastFetch = 0, busy = false, retries = 0, retryTimer = null;

  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  const int = (v) => (num(v) === null ? null : Math.round(v));
  const dec = (v) => (num(v) === null ? null : Math.round(v * 10) / 10); // one decimal, e.g. 31.5
  const clock = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Singapore' });
  };
  const setNav = (text, cls) => {
    updated.textContent = text;
    live.className = 'live' + (cls ? ' ' + cls : '');
  };

  function show(d) {
    const regions = {};
    Object.keys(d.regions || {}).forEach((k) => {
      const r = d.regions[k] || {};
      regions[k] = { aqi: int(r.aqi), pm25: int(r.pm25), psi: int(r.psi) };
    });
    // Temperature and feels like are shown to one decimal (31.5), so the note matches them
    const weatherAt = d.updated && d.updated.weather;
    HazeWatch.render(
      { aqi: int(d.aqi), pm25: int(d.pm25), psi: int(d.psi), temp: dec(d.temp), feels: dec(d.feels), regions },
      {
        bandword: 'No data',
        tip: 'Air quality readings are not available right now.',
        tempNote: num(d.temp) !== null && weatherAt ? 'As of ' + clock(weatherAt) : undefined,
        error: true
      }
    );

    const notes = [];
    const airAt = d.updated && (d.updated.pm25 || d.updated.psi);
    const airAge = airAt ? Math.round((Date.now() - Date.parse(airAt)) / 60000) : null;
    // `old` = parts the server (or this page) could not refresh, so older readings are shown
    const old = d.old || [];
    const airOld = old.includes('pm25') || old.includes('psi');
    if (airAge !== null && airAge > AIR_STALE_MIN) notes.push('The air quality readings are delayed; NEA has not published a newer hour yet.');
    else if (airOld) notes.push('Some air quality readings could not be refreshed just now, so the latest good ones (from ' + clock(airAt) + ') are shown.');
    if (old.includes('weather') && num(d.temp) !== null) notes.push('Temperature could not be refreshed just now, so the latest good reading is shown.');
    if (num(d.feels) === null && num(d.temp) !== null) notes.push('Feels like is unavailable because humidity readings are missing.');
    if (num(d.temp) === null) notes.push('Temperature is unavailable right now.');
    status.textContent = notes.join(' ');

    const at = clock(airAt || (d.updated && d.updated.weather));
    if (num(d.aqi) === null) setNav('Air data unavailable', 'is-stale');
    else if ((airAge !== null && airAge > AIR_STALE_MIN) || airOld) setNav('Delayed · ' + clock(airAt), 'is-stale');
    else setNav(at ? 'Updated ' + at : 'Updated', '');
  }

  // If part of this answer is missing but the last good one had it, keep the old numbers for that
  // part. The time shown stays the old time, and the part is listed in `old`, so nothing looks
  // fresher than it is. PM2.5 (with AQI), PSI and weather are separate feeds, so each is kept on its own.
  const PARTS = {
    pm25:    { has: (x) => num(x.aqi) !== null, fields: ['aqi', 'pm25'], region: ['aqi', 'pm25'], time: 'pm25' },
    psi:     { has: (x) => num(x.psi) !== null, fields: ['psi'], region: ['psi'], time: 'psi' },
    weather: { has: (x) => num(x.temp) !== null, fields: ['temp', 'feels', 'humidity'], region: [], time: 'weather' }
  };
  function keepGood(d) {
    const m = Object.assign({}, d, { updated: Object.assign({}, d.updated), regions: {} });
    Object.keys(d.regions || {}).forEach((r) => { m.regions[r] = Object.assign({}, d.regions[r]); });
    const old = (d.fallback || []).slice(); // parts the server already filled from its own last good answer
    if (lastGood) {
      Object.keys(PARTS).forEach((name) => {
        const p = PARTS[name];
        if (p.has(d) || !p.has(lastGood)) return;
        p.fields.forEach((f) => { m[f] = lastGood[f]; });
        Object.keys(lastGood.regions || {}).forEach((r) => {
          m.regions[r] = m.regions[r] || {};
          p.region.forEach((f) => { m.regions[r][f] = lastGood.regions[r][f]; });
        });
        m.updated[p.time] = lastGood.updated ? lastGood.updated[p.time] : null;
        if (!old.includes(name)) old.push(name);
      });
    }
    m.old = old;
    return m;
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    if (retries < MAX_RETRIES) { retries++; retryTimer = setTimeout(() => load(false), RETRY_MS); }
  }

  async function load(manual) {
    if (busy) return;
    busy = true;
    btn.setAttribute('aria-busy', 'true'); // not disabled, so keyboard focus stays on the button
    if (manual) btn.textContent = 'Refreshing…';
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 9000);
    try {
      const res = await fetch('/api/haze', { signal: ctl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const fresh = await res.json();
      const d = keepGood(fresh);
      lastGood = d;
      lastFetch = Date.now();
      show(d);
      // Something was missing or old: look again soon, in case it was a short hiccup
      if ((fresh.missing || []).some((x) => x !== 'wind') || d.old.length) scheduleRetry();
      else { clearTimeout(retryTimer); retries = 0; }
    } catch (e) {
      if (lastGood) {
        // keep what we have, say it is old
        const at = clock(lastGood.updated && (lastGood.updated.pm25 || lastGood.updated.weather));
        setNav(at ? 'Offline · last ' + at : 'Offline', 'is-off');
        status.textContent = 'Could not refresh just now, so these are the last readings we got.';
      } else {
        HazeWatch.render(HazeWatch.EMPTY, {
          bandword: 'No data',
          tip: 'We could not reach the data service. Please try again in a moment.',
          error: true
        });
        setNav('Air data unavailable', 'is-off');
        status.textContent = 'Could not load readings from data.gov.sg. Trying again shortly.';
      }
      scheduleRetry(); // a failed request also gets the quick retries, not just the 10-minute refresh
    } finally {
      clearTimeout(timer);
      busy = false;
      btn.removeAttribute('aria-busy');
      btn.textContent = 'Refresh';
    }
  }

  btn.addEventListener('click', () => load(true));
  setInterval(() => { if (!document.hidden) load(false); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && lastGood && Date.now() - lastFetch > REFRESH_MS) load(false);
  });
  load(false);
})();
