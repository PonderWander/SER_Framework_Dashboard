/**
 * dashboard.js — U.S. Economic Indicators Dashboard
 * Depends on: data.js, ser.js, D3 v7, TopoJSON v3, Chart.js v4
 */

/* global d3, topojson, Chart, RAW, SER_DATA, SER_META, SER_PAPER_REF, STATE_NAMES, YEARS */

// ── State ────────────────────────────────────────────────────────────
let currentMetric = 'unemployment';
let currentYear   = '2024';
let currentState  = null;
let topoData      = null;
let barChartInst  = null;
let lineChartInst = null;

// Per-metric independent scale overrides: { [metric]: {min, max} }
const scaleOverrides = {};

// ── Helpers ──────────────────────────────────────────────────────────

function isSER(m) { return m.startsWith('ser_'); }

function getMeta(m) {
  return isSER(m) ? SER_META[m] : RAW[m];
}

function getYrData(m, yr) {
  if (isSER(m)) return SER_DATA[m]?.[yr] || {};
  return RAW[m]?.[yr] || {};
}

function getVal(m, yr, state) {
  const d = getYrData(m, yr);
  return d[state] !== undefined ? d[state] : null;
}

function colorRamp(m) {
  return getMeta(m).loBetter
    ? ['#1D9E75','#9FE1CB','#FAC775','#EF9F27','#D85A30']
    : ['#FAECE7','#FAC775','#9FE1CB','#1D9E75','#085041'];
}

function getScale(m, yr) {
  const d    = getYrData(m, yr);
  const vals = Object.values(d).filter(v => v != null);
  const autoMin = Math.min(...vals);
  const autoMax = Math.max(...vals);
  const ov  = scaleOverrides[m];
  const mn  = (ov && ov.min != null) ? ov.min : autoMin;
  const mx  = (ov && ov.max != null) ? ov.max : autoMax;
  return { min: mn, max: mx, autoMin, autoMax, colorFn: d3.scaleQuantize([mn, mx], colorRamp(m)) };
}

// ── Legend ───────────────────────────────────────────────────────────

function buildLegend(m, yr) {
  const sc   = getScale(m, yr);
  const meta = getMeta(m);
  const ramp = colorRamp(m);

  let html = `<div class="legend-title">${meta.label}</div><div class="legend-bar">`;
  ramp.forEach(c => { html += `<div style="flex:1;background:${c}"></div>`; });
  html += `</div><div class="legend-labels">
    <span>${meta.fmt(sc.min)}</span>
    <span>${meta.fmt((sc.min + sc.max) / 2)}</span>
    <span>${meta.fmt(sc.max)}</span>
  </div>`;

  document.getElementById('legendWrap').innerHTML = html;
  document.getElementById('scaleMin').value = +sc.min.toFixed(6);
  document.getElementById('scaleMax').value = +sc.max.toFixed(6);
}

// ── Custom scale controls ─────────────────────────────────────────────

function applyCustomScale() {
  const mn = parseFloat(document.getElementById('scaleMin').value);
  const mx = parseFloat(document.getElementById('scaleMax').value);
  if (isNaN(mn) || isNaN(mx) || mn >= mx) return;
  scaleOverrides[currentMetric] = { min: mn, max: mx };
  buildLegend(currentMetric, currentYear);
  if (topoData) drawMap(topoData);
}

function resetScale() {
  delete scaleOverrides[currentMetric];
  buildLegend(currentMetric, currentYear);
  if (topoData) drawMap(topoData);
}

// Expose to inline onclick handlers
window.applyCustomScale = applyCustomScale;
window.resetScale       = resetScale;

// ── State card ───────────────────────────────────────────────────────

function updateStateCard(stateName) {
  const card  = document.getElementById('stateCard');
  const noSel = document.getElementById('noSel');
  if (!stateName) { card.style.display = 'none'; noSel.style.display = ''; return; }

  noSel.style.display = 'none';
  card.style.display  = '';
  document.getElementById('sc-name').textContent = stateName;
  document.getElementById('sc-sub').textContent  = 'Period: ' + currentYear;

  // Economic metric rows
  let rows = '';
  Object.keys(RAW).forEach(m => {
    const v = getVal(m, currentYear, stateName);
    if (v == null) return;
    const meta = RAW[m];
    const prevV = getVal(m, String(parseInt(currentYear) - 1), stateName);
    let dir = '';
    if (prevV != null) {
      const better = (v < prevV && meta.loBetter) || (v > prevV && !meta.loBetter);
      dir = better ? 'up' : 'dn';
    }
    rows += `<div class="metric-row">
      <span class="metric-lbl">${meta.label}</span>
      <span class="metric-val ${dir}">${meta.fmt(v)}</span>
    </div>`;
  });
  document.getElementById('sc-rows').innerHTML = rows;

  const ser = computeSER(stateName, currentYear);
  if (!ser) {
    document.getElementById('sc-ser').innerHTML =
      '<div style="font-size:11px;color:var(--color-text-secondary)">Insufficient data</div>';
    return;
  }

  const p  = SER_PAPER_REF;
  const dS = ((ser.S - p.S) / p.S * 100).toFixed(1);
  const dE = ((ser.E - p.E) / p.E * 100).toFixed(1);
  const dR = ((ser.R - p.R) / p.R * 100).toFixed(1);
  const dU = ((ser.U - p.U) / p.U * 100).toFixed(1);

  const motionS = getVal('ser_stress_motion', currentYear, stateName);
  const motionR = getVal('ser_reaction_motion', currentYear, stateName);
  const spill   = getVal('ser_spillover', currentYear, stateName);
  const dspill  = getVal('ser_damped_spillover', currentYear, stateName);
  const fcast   = getVal('ser_forecast_stress', currentYear, stateName);
  const ferr    = getVal('ser_forecast_error', currentYear, stateName);

  const clr = (val, lo) => (lo ? val < 0 : val > 0) ? '#1D9E75' : '#D85A30';
  const arr = (val, lo) => (lo ? val < 0 : val > 0) ? '▼' : '▲';

  document.getElementById('sc-ser').innerHTML = `
    <div class="ser-row"><span class="ser-lbl">S* Stress</span>
      <span>${ser.S.toFixed(4)} <small style="color:${clr(parseFloat(dS), true)}">${arr(parseFloat(dS), true)}${Math.abs(dS)}%</small></span></div>
    <div class="ser-row"><span class="ser-lbl">E* Elasticity</span>
      <span>${ser.E.toFixed(4)} <small style="color:${clr(parseFloat(dE), false)}">${arr(parseFloat(dE), false)}${Math.abs(dE)}%</small></span></div>
    <div class="ser-row"><span class="ser-lbl">R* Reaction</span>
      <span>${ser.R.toFixed(4)} <small style="color:${clr(parseFloat(dR), true)}">${arr(parseFloat(dR), true)}${Math.abs(dR)}%</small></span></div>
    <div class="ser-row"><span class="ser-lbl">U* Utility</span>
      <span>${ser.U.toFixed(4)} <small style="color:${clr(parseFloat(dU), false)}">${arr(parseFloat(dU), false)}${Math.abs(dU)}%</small></span></div>

    <div class="ser-row"><span class="ser-lbl">ΔS Stress Motion</span>
      <span>${motionS != null ? motionS.toFixed(4) : '—'}</span></div>
    <div class="ser-row"><span class="ser-lbl">ΔR Reaction Motion</span>
      <span>${motionR != null ? motionR.toFixed(4) : '—'}</span></div>
    <div class="ser-row"><span class="ser-lbl">Spillover Pressure</span>
      <span>${spill != null ? spill.toFixed(4) : '—'}</span></div>
    <div class="ser-row"><span class="ser-lbl">Damped Spillover</span>
      <span>${dspill != null ? dspill.toFixed(4) : '—'}</span></div>
    <div class="ser-row"><span class="ser-lbl">Forecast Stress</span>
      <span>${fcast != null ? fcast.toFixed(4) : '—'}</span></div>
    <div class="ser-row"><span class="ser-lbl">Forecast Error</span>
      <span class="${ferr != null && ferr <= 0 ? 'metric-val up' : 'metric-val dn'}">${ferr != null ? ferr.toFixed(4) : '—'}</span></div>

    <div class="ser-ref-note">▲▼ vs. paper control (Castle 2026)</div>
  `;
}

// ── Map ──────────────────────────────────────────────────────────────

function drawMap(us) {
  const svg = d3.select('#mapSvg');
  svg.selectAll('*').remove();

  const sc       = getScale(currentMetric, currentYear);
  const path     = d3.geoPath(d3.geoAlbersUsa().scale(1200).translate([480, 300]));
  const features = topojson.feature(us, us.objects.states).features;

  svg.selectAll('path')
    .data(features)
    .join('path')
    .attr('d', path)
    .attr('fill', d => {
      const v = getVal(currentMetric, currentYear, d.properties.name);
      return v != null ? sc.colorFn(v) : 'var(--color-bg-secondary)';
    })
    .attr('stroke', 'var(--color-bg-primary)')
    .attr('stroke-width', 0.7)
    .style('cursor', 'pointer')
    .on('mouseover', function(event, d) {
      d3.select(this).attr('stroke-width', 2).attr('stroke', 'var(--color-text-primary)');
      updateStateCard(d.properties.name);
    })
    .on('mouseout', function(event, d) {
      d3.select(this).attr('stroke-width', 0.7).attr('stroke', 'var(--color-bg-primary)');
      updateStateCard(currentState || null);
    })
    .on('click', function(event, d) {
      currentState = d.properties.name;
      updateStateCard(currentState);
    });
}

// ── Aggregated view ──────────────────────────────────────────────────

function buildAggView() {
  const m    = currentMetric;
  const yr   = currentYear;
  const meta = getMeta(m);
  const vals = STATE_NAMES.map(s => ({ s, v: getVal(m, yr, s) })).filter(x => x.v != null);

  const avg  = vals.reduce((a, b) => a + b.v, 0) / vals.length;
  const mn   = vals.reduce((a, b) => a.v < b.v ? a : b);
  const mx   = vals.reduce((a, b) => a.v > b.v ? a : b);

  // Prior year delta
  const prevYr  = String(parseInt(yr) - 1);
  const prevVals = STATE_NAMES.map(s => getVal(m, prevYr, s)).filter(v => v != null);
  const prevAvg = prevVals.length ? prevVals.reduce((a, b) => a + b, 0) / prevVals.length : null;
  const chg     = prevAvg != null ? avg - prevAvg : null;
  const chgHtml = chg != null
    ? `<div class="mcard-sub">${chg >= 0 ? '+' : ''}${chg.toFixed(4)} vs ${prevYr}</div>`
    : '';

  // Paper reference card (SER only)
  const paperKey   = isSER(m) ? SER_META[m].paperKey : null;
  const paperRef   = paperKey ? SER_PAPER_REF[paperKey] : null;
  const paperCard  = paperRef != null
    ? `<div class="mcard" style="border:0.5px solid #B5D4F4">
        <div class="mcard-label" style="color:#185FA5">Paper control (Castle 2026)</div>
        <div class="mcard-val" style="font-size:14px;color:#185FA5">${paperRef.toFixed(4)}</div>
        <div class="mcard-sub">U.S. consumer baseline</div>
       </div>`
    : '';

  document.getElementById('aggCards').innerHTML = `
    <div class="mcard">
      <div class="mcard-label">CONUS Average</div>
      <div class="mcard-val">${meta.fmt(avg)}</div>${chgHtml}
    </div>
    <div class="mcard">
      <div class="mcard-label">Highest</div>
      <div class="mcard-val">${meta.fmt(mx.v)}</div>
      <div class="mcard-sub">${mx.s}</div>
    </div>
    <div class="mcard">
      <div class="mcard-label">Lowest</div>
      <div class="mcard-val">${meta.fmt(mn.v)}</div>
      <div class="mcard-sub">${mn.s}</div>
    </div>
    <div class="mcard">
      <div class="mcard-label">Range</div>
      <div class="mcard-val">${meta.fmt(mx.v - mn.v)}</div>
      <div class="mcard-sub">spread</div>
    </div>
    ${paperCard}
  `;

  // Bar chart — top 10
  document.getElementById('barTitle').textContent = `Top 10 states — ${meta.label}`;
  const sorted = [...vals].sort((a, b) => meta.loBetter ? a.v - b.v : b.v - a.v).slice(0, 10);
  const ramp   = colorRamp(m);
  const barColors = sorted.map((_, i) =>
    ramp[Math.min(Math.floor(i / sorted.length * ramp.length), ramp.length - 1)]);

  const abbrev = s => s
    .replace('North ', 'N. ').replace('South ', 'S. ')
    .replace('New ', 'N. ').replace('West ', 'W. ');

  if (barChartInst) barChartInst.destroy();
  barChartInst = new Chart(document.getElementById('barChart'), {
    type: 'bar',
    data: {
      labels: sorted.map(x => abbrev(x.s)),
      datasets: [{ label: meta.label, data: sorted.map(x => +x.v.toFixed(6)), backgroundColor: barColors }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => meta.fmt(ctx.raw) } } },
      scales: {
        x: { ticks: { callback: v => meta.fmt(v), font: { size: 10 } }, grid: { color: 'rgba(128,128,128,.1)' } },
        y: { grid: { display: false }, ticks: { font: { size: 10 } } }
      }
    }
  });

  // Line chart — CONUS trend
  const lineData = YEARS.map(y => {
    const yv = STATE_NAMES.map(s => getVal(m, y, s)).filter(v => v != null);
    return yv.length ? +(yv.reduce((a, b) => a + b, 0) / yv.length).toFixed(6) : null;
  });
  const datasets = [{
    label: 'CONUS Avg',
    data: lineData,
    borderColor: '#378ADD',
    backgroundColor: 'rgba(55,138,221,.12)',
    tension: 0.3, pointRadius: 4, fill: true
  }];
  if (paperRef != null) {
    datasets.push({
      label: 'Paper control (Castle 2026)',
      data: YEARS.map(() => paperRef),
      borderColor: '#D85A30',
      borderDash: [4, 3],
      pointRadius: 0,
      borderWidth: 1.5,
      fill: false
    });
  }

  if (lineChartInst) lineChartInst.destroy();
  lineChartInst = new Chart(document.getElementById('lineChart'), {
    type: 'line',
    data: { labels: YEARS, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: isSER(m), labels: { font: { size: 10 }, boxWidth: 10 } }
      },
      scales: {
        y: { ticks: { callback: v => meta.fmt(v), font: { size: 10 } }, grid: { color: 'rgba(128,128,128,.1)' } },
        x: { grid: { display: false }, ticks: { font: { size: 10 } } }
      }
    }
  });

  // Full data table
  const allSorted = [...vals].sort((a, b) => meta.loBetter ? a.v - b.v : b.v - a.v);
  const hasPaper  = paperRef != null;

  let tbl = `<table><thead><tr>
    <th>#</th><th>State</th><th>${meta.label}</th><th>vs Prior Year</th>
    ${hasPaper ? '<th>vs Paper Control</th>' : ''}
  </tr></thead><tbody>`;

  allSorted.forEach((x, i) => {
    const pv = getVal(m, prevYr, x.s);
    let pill = '—';
    if (pv != null) {
      const delta   = x.v - pv;
      const better  = (delta < 0 && meta.loBetter) || (delta > 0 && !meta.loBetter);
      pill = `<span class="pill ${better ? 'up' : 'dn'}">${delta >= 0 ? '+' : ''}${delta.toFixed(4)}</span>`;
    }
    let refCell = '';
    if (hasPaper) {
      const d2      = x.v - paperRef;
      const better2 = (d2 < 0 && meta.loBetter) || (d2 > 0 && !meta.loBetter);
      refCell = `<td><span class="pill ${better2 ? 'up' : 'dn'}">${d2 >= 0 ? '+' : ''}${d2.toFixed(4)}</span></td>`;
    }
    tbl += `<tr>
      <td style="color:var(--color-text-secondary)">${i + 1}</td>
      <td>${x.s}</td>
      <td><strong>${meta.fmt(x.v)}</strong></td>
      <td>${pill}</td>
      ${refCell}
    </tr>`;
  });

  tbl += '</tbody></table>';
  document.getElementById('tableWrap').innerHTML = tbl;
}

// ── Tab switching ─────────────────────────────────────────────────────

function switchTab(t) {
  ['map', 'agg'].forEach(x => {
    document.getElementById('tab-' + x).classList.toggle('active', x === t);
    document.getElementById('view-' + x).classList.toggle('active', x === t);
  });
  if (t === 'agg') buildAggView();
}

window.switchTab = switchTab;

// ── Controls ──────────────────────────────────────────────────────────

document.getElementById('metricSel').addEventListener('change', function () {
  currentMetric = this.value;
  currentState  = null;
  buildLegend(currentMetric, currentYear);
  if (topoData) drawMap(topoData);
  updateStateCard(null);
  if (document.getElementById('view-agg').classList.contains('active')) buildAggView();
});

document.getElementById('yearSel').addEventListener('change', function () {
  currentYear  = this.value;
  currentState = null;
  buildLegend(currentMetric, currentYear);
  if (topoData) drawMap(topoData);
  updateStateCard(null);
  if (document.getElementById('view-agg').classList.contains('active')) buildAggView();
});

// ── Init ──────────────────────────────────────────────────────────────

d3.json('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json').then(us => {
  topoData = us;
  buildLegend(currentMetric, currentYear);
  drawMap(us);
}).catch(err => {
  console.error('Failed to load US topology:', err);
  document.getElementById('mapSvg').insertAdjacentHTML('afterend',
    '<p style="color:#D85A30;padding:1rem">Map requires an internet connection to load the U.S. topology from cdn.jsdelivr.net.</p>');
});
