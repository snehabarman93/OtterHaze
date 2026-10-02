/* Haze Watch SG: data.js
   Fetches live readings from /api/haze (see api/haze.js) and hands them to
   HazeWatch.render(). Skipped when the URL has ?demo=<state>. */
(function () {
  if (new URLSearchParams(location.search).get('demo')) return;

  const $ = (id) => document.getElementById(id);
  const btn = $('refresh'), updated = $('updated'), live = $('live'), status = $('status');
  const REFRESH_MS = 10 * 60 * 1000;
  const AIR_STALE_MIN = 120;
  let lastGood = null, lastFetch = 0, busy = false;

  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
  const int = (v) => (num(v) === null ? null : Math.round(v));
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
    // Round both so the "+N° warmer" note matches the two numbers on screen
    const weatherAt = d.updated && d.updated.weather;
    HazeWatch.render(
      { aqi: int(d.aqi), pm25: int(d.pm25), psi: int(d.psi), temp: int(d.temp), feels: int(d.feels), regions },
      {
        bandword: 'No data',
        tip: 'Air quality readings are not available right now.',
        tempNote: num(d.temp) !== null && weatherAt ? 'As of ' + clock(weatherAt) : undefined,
        error: true
      }
    );

    const notes = [];
    const airAt = d.updated && (d.updated.pm25 || d.updated.psi);
    const airAge = d.ages && num(d.ages.pm25);
    if (airAge !== null && airAge > AIR_STALE_MIN) notes.push('The air quality readings are delayed; NEA has not published a newer hour yet.');
    if (num(d.feels) === null && num(d.temp) !== null) notes.push('Feels like is unavailable because humidity readings are missing.');
    if (num(d.temp) === null) notes.push('Temperature is unavailable right now.');
    status.textContent = notes.join(' ');

    if (airAt && airAge !== null && airAge > AIR_STALE_MIN) setNav('Delayed · ' + clock(airAt), 'is-stale');
    else setNav('Updated ' + clock(airAt || d.updated && d.updated.weather), '');
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
      const d = await res.json();
      lastGood = d;
      lastFetch = Date.now();
      show(d);
    } catch (e) {
      if (lastGood) {
        // keep what we have, say it is old
        const at = lastGood.updated && (lastGood.updated.pm25 || lastGood.updated.weather);
        setNav('Offline · last ' + clock(at), 'is-off');
        status.textContent = 'Could not refresh just now, so these are the last readings we got.';
      } else {
        HazeWatch.render(HazeWatch.EMPTY, {
          bandword: 'No data',
          tip: 'We could not reach the data service. Please try again in a moment.',
          error: true
        });
        setNav('Offline', 'is-off');
        status.textContent = 'Could not load readings from data.gov.sg.';
      }
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
