/* ==========================================================================
   Haze Watch SG: app.js
   Feed the page with:   HazeWatch.render(data)

   data = {
     aqi:   75,            // island-wide AQI (average of the five regions)
     pm25:  24,            // island-wide PM2.5, ug/m3, hourly
     psi:   52,            // island-wide 24-hour PSI
     temp:  31,            // air temperature, C
     feels: 37,            // feels-like temperature, C
     regions: {            // per-region readings
       north:   { aqi: 80, pm25: 26, psi: 55 },
       east:    { pm25: 22, psi: 51 },
       west:    { pm25: 25, psi: 54 },
       south:   { pm25: 21, psi: 49 },
       central: { pm25: 24, psi: 52 }
     }
   }

   Any value may be null (shown as an en dash). Second argument is optional:
   HazeWatch.render(data, { bandword, tip, tempNote, error })

   Preview any state without data:  index.html?demo=good|moderate|sensitive|unhealthy|very|hazard
   Fine-tune the preview:           index.html?demo=good&aqi=180&psi=250&temp=22&feels=24
   ========================================================================== */

(function () {
  // ---- Band definitions (c = CSS colour token, see styles.css) ----------
  // Six AQI levels, same names as the standard US AQI scale (101-150 is shortened to "Sensitive groups")
  const AQI_BANDS = [
    { max: 50,  name: 'Good',             c: '--good' },
    { max: 100, name: 'Moderate',         c: '--moderate' },
    { max: 150, name: 'Sensitive groups', c: '--sensitive' },
    { max: 200, name: 'Unhealthy',        c: '--unhealthy' },
    { max: 300, name: 'Very unhealthy',   c: '--very' },
    { max: 1e9, name: 'Hazardous',        c: '--hazard' }
  ];
  const PSI_BANDS = [
    { max: 50,  name: 'Good',             c: '--good' },
    { max: 100, name: 'Moderate',         c: '--moderate' },
    { max: 200, name: 'Unhealthy',        c: '--unhealthy' },
    { max: 300, name: 'Very unhealthy',   c: '--very' },
    { max: 1e9, name: 'Hazardous',        c: '--hazard' }
  ];

  // Per state: theme (text/glass colours), copy, particle count
  const STATE = {
    good:      { theme: 'light', particles: 4,  tip: 'A great day to be outside. Go for that long walk.' },
    moderate:  { theme: 'light', particles: 14, tip: 'Fine for most people. If haze bothers you, take long outdoor workouts a little easier.' },
    sensitive: { theme: 'mid',   particles: 28, tip: 'Sensitive groups should cut back on long or strenuous time outdoors. Keep a mask handy.' },
    unhealthy: { theme: 'dark',  particles: 38, tip: 'Everyone may start to feel it. Keep outdoor time short and wear a well-fitted mask if you go out.' },
    very:      { theme: 'dark',  particles: 48, tip: 'Stay indoors where you can, keep windows closed, and avoid exercising outside.' },
    hazard:    { theme: 'dark',  particles: 58, tip: 'Avoid going outside. Keep windows closed and rest indoors.' }
  };

  // ---- Which panda to show -------------------------------------------------
  // From mildest to worst. AQI picks the panda; a very high PSI can push it further.
  const POSES = ['good', 'moderate', 'mask', 'cough', 'oxygen', 'passout'];
  //   AQI  0-50 happy | 51-100 worried | 101-125 mask | 126-150 coughing | 151-200 oxygen mask | 201+ passed out
  //   PSI  over 200 = at least oxygen mask | over 300 = passed out
  function poseFor(aqi, psi) {
    let p = aqi > 200 ? 5 : aqi > 150 ? 4 : aqi > 125 ? 3 : aqi > 100 ? 2 : aqi > 50 ? 1 : 0;
    if (has(psi)) p = Math.max(p, psi > 300 ? 5 : psi > 200 ? 4 : 0);
    return POSES[p];
  }

  // ---- Temperature steps (air temperature, degrees C) ----------------------
  // cold = shivering, normal = nothing, warm = sweating, hot = sweating more
  const TEMP_STEPS = [
    { max: 24.9, key: 'cold' },     // 24.9 or below
    { max: 29.9, key: 'normal' },   // 25.0 to 29.9
    { max: 33.9, key: 'warm' },     // 30.0 to 33.9
    { max: 1e9, key: 'hot' }        // 34.0 and above
  ];

  const bandOf = (bands, v) => bands.find((b) => v <= b.max);
  const key = (b) => b.c.slice(2); // '--good' -> 'good'
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---- Particles: more specks = thicker haze ------------------------------
  function renderParticles(n, seed = 11) {
    const host = $('#particles');
    host.textContent = '';
    let s = seed;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < n; i++) {
      const p = document.createElement('div');
      const size = Math.round(4 + rnd() * 9);
      p.className = 'part';
      p.style.cssText =
        'left:' + Math.round(rnd() * 100) + '%;top:' + Math.round(rnd() * 100) + '%;' +
        'width:' + size + 'px;height:' + size + 'px;' +
        'background:var(' + (i % 2 ? '--part-b' : '--part-a') + ');' +
        'animation-duration:' + Math.round(14 + rnd() * 20) + 's;' +
        'animation-delay:-' + Math.round(rnd() * 30) + 's;';
      host.appendChild(p);
    }
  }

  function setText(name, value) {
    $$('[data-bind="' + name + '"]').forEach((el) => { el.textContent = value; });
  }

  // ---- Main render --------------------------------------------------------
  // render(data, opts): any number may be null/undefined (shown as an en dash).
  //   opts.bandword  headline when there is no AQI ("Loading", "No data")
  //   opts.tip       sentence under the headline when there is no AQI
  //   opts.tempNote  small text under the temperature
  //   opts.error     true = show the neutral panda even though there is no AQI
  const has = (v) => typeof v === 'number' && isFinite(v);
  const dash = (v) => (has(v) ? v : '\u2013');
  const deg = (v) => (has(v) ? v.toFixed(1) : '\u2013'); // temperatures: always one decimal, 31.0 / 31.5
  const EMPTY = { aqi: null, pm25: null, psi: null, temp: null, feels: null, regions: {} };
  const REGIONS = ['north', 'east', 'west', 'south', 'central'];

  function showPose(pose) {
    // Load only the panda being shown (the four images are ~2 MB together)
    $$('.pose').forEach((img) => {
      if (img.classList.contains('pose--' + pose) && !img.getAttribute('src') && img.dataset.src) {
        img.src = img.dataset.src;
      }
    });
  }

  function render(data, opts) {
    data = data || EMPTY;
    opts = opts || {};
    const root = document.documentElement;
    const regionsIn = data.regions || {};

    const aqiBand = has(data.aqi) ? bandOf(AQI_BANDS, data.aqi) : null;
    const psiBand = has(data.psi) ? bandOf(PSI_BANDS, data.psi) : null;

    if (aqiBand) {
      const stateKey = key(aqiBand);
      const st = STATE[stateKey];
      root.dataset.state = stateKey;
      root.dataset.theme = st.theme;
      const pose = poseFor(data.aqi, data.psi);
      root.dataset.pose = pose;
      setText('aqiBand', aqiBand.name);
      setText('tip', st.tip);
      renderParticles(st.particles);
      showPose(pose);
    } else {
      // No AQI: keep whatever look is on screen, say why
      setText('aqiBand', opts.bandword || 'No data');
      setText('tip', opts.tip || 'Air quality readings are not available right now.');
      if (opts.error) showPose(root.dataset.pose);
    }

    if (has(data.temp)) root.dataset.temp = TEMP_STEPS.find((t) => data.temp <= t.max).key;
    else delete root.dataset.temp;

    setText('aqi', dash(data.aqi));
    setText('pm25', dash(data.pm25));
    setText('psi', dash(data.psi));
    setText('temp', deg(data.temp));
    setText('feels', deg(data.feels));
    setText('psiBand', psiBand ? psiBand.name : '\u2013');
    setText('tempNote', opts.tempNote || (has(data.temp) ? 'Right now' : 'Unavailable'));

    if (has(data.feels) && has(data.temp)) {
      const diff = Math.round((data.feels - data.temp) * 10) / 10;
      setText('feelsNote', diff > 0 ? '+' + diff.toFixed(1) + '\u00b0 warmer' : diff < 0 ? Math.abs(diff).toFixed(1) + '\u00b0 cooler' : 'Same as actual');
    } else {
      setText('feelsNote', 'Unavailable');
    }

    $$('[data-band-for="aqi"]').forEach((el) => { aqiBand ? (el.dataset.band = key(aqiBand)) : delete el.dataset.band; });
    $$('[data-band-for="psi"]').forEach((el) => { psiBand ? (el.dataset.band = key(psiBand)) : delete el.dataset.band; });

    // Panda alt text (only the visible pose is announced)
    $$('.pose').forEach((img) => {
      img.alt = img.classList.contains('pose--' + root.dataset.pose) ? img.dataset.alt : '';
    });

    // Regions: pins, zone tints and the phone list
    const list = $('#pinlist');
    list.textContent = '';
    REGIONS.forEach((name) => {
      const r = regionsIn[name] || {};
      const band = has(r.aqi) ? key(bandOf(AQI_BANDS, r.aqi)) : null; // colour follows AQI, same as the headline
      const pin = $('.pin[data-region="' + name + '"]');
      const zone = $('.zone[data-zone="' + name + '"]');
      if (band) { pin.dataset.band = band; zone.dataset.band = band; }
      else { delete pin.dataset.band; delete zone.dataset.band; }
      $('[data-r="aqi"]', pin).textContent = dash(r.aqi);
      $('[data-r="pm25"]', pin).textContent = dash(r.pm25);
      $('[data-r="psi"]', pin).textContent = dash(r.psi);

      const li = document.createElement('li');
      const n = document.createElement('div');
      n.className = 'n';
      const dot = document.createElement('span');
      dot.className = 'dot';
      if (band) dot.dataset.band = band;
      n.appendChild(dot);
      n.appendChild(document.createTextNode(name));
      li.appendChild(n);
      [['AQI', r.aqi], ['PM2.5', r.pm25], ['PSI', r.psi]].forEach((s) => {
        const d = document.createElement('div');
        d.className = 's';
        d.innerHTML = '<b>' + dash(s[1]) + '</b><small>' + s[0] + '</small>';
        li.appendChild(d);
      });
      list.appendChild(li);
    });
  }

  // ---- Sample data (one per state) ---------------------------------------
  // Region values are scaled from the island-wide numbers just for the demo.
  function demo(aqi, pm25, psi, temp, feels) {
    const f = { north: 1.1, east: 0.95, west: 1.05, south: 0.9, central: 1 };
    const regions = {};
    Object.keys(f).forEach((k) => { regions[k] = { aqi: Math.round(aqi * f[k]), pm25: Math.round(pm25 * f[k]), psi: Math.round(psi * f[k]) }; });
    return { aqi, pm25, psi, temp, feels, regions };
  }
  const DEMO = {
    good:      demo(32, 8, 38, 28, 32),
    moderate:  demo(75, 24, 52, 31, 37),
    sensitive: demo(128, 46, 112, 32, 38),
    unhealthy: demo(176, 104, 238, 33, 40),
    very:      demo(240, 190, 330, 34, 41),
    hazard:    demo(330, 260, 380, 34, 41)
  };

  window.HazeWatch = { render, DEMO, AQI_BANDS, PSI_BANDS, EMPTY };

  // ---- Boot ---------------------------------------------------------------
  // ?demo=<state> shows sample data. Otherwise the page starts empty ("Loading")
  // and data.js fills it from /api/haze. Sample data is never shown as live.
  const params = new URLSearchParams(location.search);
  const demoKey = params.get('demo');
  if (DEMO[demoKey]) {
    // Optional overrides for previewing, e.g. ?demo=good&aqi=180&psi=250&temp=22&feels=24
    const base = DEMO[demoKey];
    const num = (k, dflt) => { const v = parseFloat(params.get(k)); return isFinite(v) ? v : dflt; };
    const aqi = num('aqi', base.aqi), psi = num('psi', base.psi), temp = num('temp', base.temp);
    const feels = num('feels', temp + (base.feels - base.temp));   // keeps the "+N warmer" gap unless you set it
    const pm25 = Math.round(base.pm25 * (aqi / base.aqi));         // regions scale with the AQI you pick
    const d = demo(aqi, pm25, psi, temp, feels);
    render(d);
  }
  else if (window.HAZE_INITIAL_DATA) render(window.HAZE_INITIAL_DATA);
  else render(EMPTY, { bandword: 'Loading', tip: 'Fetching the latest readings\u2026' });
})();
