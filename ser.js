/**
 * ser.js — SER (Stress–Elasticity–Reaction) Framework
 *
 * Implements the operational form from:
 *   Castle, J. (2026). OZERP: A Framework for Aligning Capital Allocation
 *   with Real-World Economic Outcomes. SSRN.
 *
 * Formal specification:
 *   S* = 0.5*(housing share) + 0.2*(energy share) + 0.2*(delinquency) + 0.1*(debt ratio)
 *   E* = 0.5*(FICO/850)     + 0.3*(1 – energy share) + 0.2*(1 – delinquency)
 *   R* = S* / E*
 *   U* = E* – S*
 *
 * Input mappings from state data (all normalized to [0,1] range):
 *   housing share  = (costOfLiving / 100) × 0.334   (housing ~33.4% of composite COL)
 *   energy share   = (inflation / 100) × 0.08        (energy ~8% of CPI basket per BLS)
 *   delinquency    = unemployment / 100              (financial distress proxy)
 *   FICO           = creditScore                     (direct)
 *   debt ratio     = (850 – creditScore) / (850 – 580)  (inverse FICO spread)
 *
 * Paper reference (control case, U.S. consumer baseline 2024):
 *   S* = 0.1828,  E* = 0.9121,  R* = 0.2004,  U* = 0.7293
 *   Source inputs: avg spending $6,545/mo, housing $2,189/mo, electricity $142.26/mo,
 *   FICO ≈ 717, credit card debt $6,329, delinquency flow 1.59%
 *   (BLS CEX 2024; NY Fed 2024)
 */
/**
 * ser.js — SER (Stress–Elasticity–Reaction) Framework
 *
 * Two-layer implementation:
 *  1) Local descriptive SER (restores original behavior)
 *  2) Border-based propagation / forecast diagnostics
 *
 * Local descriptive:
 *   S* = 0.5*(housing share) + 0.2*(energy share) + 0.2*(delinquency) + 0.1*(debt ratio)
 *   E* = 0.5*(FICO/850)     + 0.3*(1 – energy share) + 0.2*(1 – delinquency)
 *   R* = S* / E*
 *   U* = E* – S*
 *
 * Dynamic diagnostics:
 *   motion_S_i,t = S_i,t - S_i,t-1
 *   spillover_i,t = λ * Σ_j w_ij * max(0, motion_S_j,t - motion_S_i,t)
 *   damped_spillover_i,t = spillover_i,t * (1 - E_i,t)
 *   forecast_stress_i,t+1 = S_i,t + damped_spillover_i,t
 */

/* global RAW, STATE_NAMES, YEARS */

// Paper reference values (control case)
const SER_PAPER_REF = { S: 0.1828, E: 0.9121, R: 0.2004, U: 0.7293 };

// Propagation parameters (tune later)
const SER_PARAMS = {
  lambda: 0.35
};

// State adjacency map (50 states + DC optional if present in your data)
const STATE_BORDERS = {
  Alabama: ['Florida', 'Georgia', 'Mississippi', 'Tennessee'],
  Arizona: ['California', 'Nevada', 'Utah', 'New Mexico', 'Colorado'],
  Arkansas: ['Missouri', 'Tennessee', 'Mississippi', 'Louisiana', 'Texas', 'Oklahoma'],
  California: ['Oregon', 'Nevada', 'Arizona'],
  Colorado: ['Wyoming', 'Nebraska', 'Kansas', 'Oklahoma', 'New Mexico', 'Arizona', 'Utah'],
  Connecticut: ['New York', 'Massachusetts', 'Rhode Island'],
  Delaware: ['Maryland', 'New Jersey', 'Pennsylvania'],
  Florida: ['Alabama', 'Georgia'],
  Georgia: ['Florida', 'Alabama', 'Tennessee', 'North Carolina', 'South Carolina'],
  Idaho: ['Washington', 'Oregon', 'Nevada', 'Utah', 'Wyoming', 'Montana'],
  Illinois: ['Wisconsin', 'Iowa', 'Missouri', 'Kentucky', 'Indiana', 'Michigan'],
  Indiana: ['Michigan', 'Ohio', 'Kentucky', 'Illinois'],
  Iowa: ['Minnesota', 'South Dakota', 'Nebraska', 'Missouri', 'Illinois', 'Wisconsin'],
  Kansas: ['Nebraska', 'Missouri', 'Oklahoma', 'Colorado'],
  Kentucky: ['Illinois', 'Indiana', 'Ohio', 'West Virginia', 'Virginia', 'Tennessee', 'Missouri'],
  Louisiana: ['Texas', 'Arkansas', 'Mississippi'],
  Maine: ['New Hampshire'],
  Maryland: ['Virginia', 'West Virginia', 'Pennsylvania', 'Delaware'],
  Massachusetts: ['Rhode Island', 'Connecticut', 'New York', 'Vermont', 'New Hampshire'],
  Michigan: ['Wisconsin', 'Indiana', 'Ohio', 'Illinois'],
  Minnesota: ['North Dakota', 'South Dakota', 'Iowa', 'Wisconsin'],
  Mississippi: ['Louisiana', 'Arkansas', 'Tennessee', 'Alabama'],
  Missouri: ['Iowa', 'Illinois', 'Kentucky', 'Tennessee', 'Arkansas', 'Oklahoma', 'Kansas', 'Nebraska'],
  Montana: ['Idaho', 'Wyoming', 'South Dakota', 'North Dakota'],
  Nebraska: ['South Dakota', 'Iowa', 'Missouri', 'Kansas', 'Colorado', 'Wyoming'],
  Nevada: ['Oregon', 'Idaho', 'Utah', 'Arizona', 'California'],
  'New Hampshire': ['Maine', 'Massachusetts', 'Vermont'],
  'New Jersey': ['New York', 'Delaware', 'Pennsylvania'],
  'New Mexico': ['Arizona', 'Utah', 'Colorado', 'Oklahoma', 'Texas'],
  'New York': ['Pennsylvania', 'New Jersey', 'Connecticut', 'Massachusetts', 'Vermont'],
  'North Carolina': ['Virginia', 'Tennessee', 'Georgia', 'South Carolina'],
  'North Dakota': ['Montana', 'South Dakota', 'Minnesota'],
  Ohio: ['Michigan', 'Pennsylvania', 'West Virginia', 'Kentucky', 'Indiana'],
  Oklahoma: ['Colorado', 'Kansas', 'Missouri', 'Arkansas', 'Texas', 'New Mexico'],
  Oregon: ['Washington', 'Idaho', 'Nevada', 'California'],
  Pennsylvania: ['New York', 'New Jersey', 'Delaware', 'Maryland', 'West Virginia', 'Ohio'],
  'Rhode Island': ['Connecticut', 'Massachusetts'],
  'South Carolina': ['North Carolina', 'Georgia'],
  'South Dakota': ['North Dakota', 'Minnesota', 'Iowa', 'Nebraska', 'Wyoming', 'Montana'],
  Tennessee: ['Kentucky', 'Virginia', 'North Carolina', 'Georgia', 'Alabama', 'Mississippi', 'Arkansas', 'Missouri'],
  Texas: ['New Mexico', 'Oklahoma', 'Arkansas', 'Louisiana'],
  Utah: ['Idaho', 'Wyoming', 'Colorado', 'New Mexico', 'Arizona', 'Nevada'],
  Vermont: ['New York', 'Massachusetts', 'New Hampshire'],
  Virginia: ['North Carolina', 'Tennessee', 'Kentucky', 'West Virginia', 'Maryland'],
  Washington: ['Idaho', 'Oregon'],
  'West Virginia': ['Ohio', 'Pennsylvania', 'Maryland', 'Virginia', 'Kentucky'],
  Wisconsin: ['Minnesota', 'Iowa', 'Illinois', 'Michigan'],
  Wyoming: ['Montana', 'South Dakota', 'Nebraska', 'Colorado', 'Utah', 'Idaho']
};

function clamp(val, min = 0, max = 1) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Local descriptive SER only.
 * This is the coherent baseline evaluation from the original dashboard.
 */
function computeLocalSER(state, year) {
  const col  = RAW.costOfLiving[year]?.[state];
  const inf  = RAW.inflation[year]?.[state];
  const ue   = RAW.unemployment[year]?.[state];
  const fico = RAW.creditScore[year]?.[state];
  if (col == null || inf == null || ue == null || fico == null) return null;

  const housingShare = Math.min((col / 100) * 0.334, 0.50);
  const energyShare  = Math.min((inf / 100) * 0.08,  0.15);
  const delinquency  = Math.min(ue / 100,             0.15);
  const debtRatio    = Math.min((850 - fico) / (850 - 580), 1.0);

  const S = 0.5 * housingShare + 0.2 * energyShare + 0.2 * delinquency + 0.1 * debtRatio;
  const E = 0.5 * (fico / 850)  + 0.3 * (1 - energyShare) + 0.2 * (1 - delinquency);
  const R = E > 0 ? S / E : 0;
  const U = E - S;

  return {
    S: +S.toFixed(6),
    E: +E.toFixed(6),
    R: +R.toFixed(6),
    U: +U.toFixed(6)
  };
}

// Public compatibility alias: dashboard should call this only
function computeSER(state, year) {
  return computeLocalSER(state, year);
}

// Pre-compute local descriptive SER tables
const SER_DATA = {
  ser_stress: {},
  ser_elasticity: {},
  ser_reaction: {},
  ser_utility: {},

  // dynamic / propagation diagnostics
  ser_stress_motion: {},
  ser_reaction_motion: {},
  ser_spillover: {},
  ser_damped_spillover: {},
  ser_forecast_stress: {},
  ser_forecast_error: {}
};

YEARS.forEach(yr => {
  Object.keys(SER_DATA).forEach(k => {
    SER_DATA[k][yr] = {};
  });
});

// Fill local layer
YEARS.forEach(yr => {
  STATE_NAMES.forEach(state => {
    const r = computeLocalSER(state, yr);
    if (!r) return;
    SER_DATA.ser_stress[yr][state] = r.S;
    SER_DATA.ser_elasticity[yr][state] = r.E;
    SER_DATA.ser_reaction[yr][state] = r.R;
    SER_DATA.ser_utility[yr][state] = r.U;
  });
});

// Motion terms and propagation diagnostics
YEARS.forEach((yr, idx) => {
  const prevYr = YEARS[idx - 1];
  const nextYr = YEARS[idx + 1];

  STATE_NAMES.forEach(state => {
    const S = SER_DATA.ser_stress[yr][state];
    const E = SER_DATA.ser_elasticity[yr][state];
    const R = SER_DATA.ser_reaction[yr][state];
    if (S == null || E == null || R == null) return;

    const prevS = prevYr ? SER_DATA.ser_stress[prevYr][state] : null;
    const prevR = prevYr ? SER_DATA.ser_reaction[prevYr][state] : null;

    const motionS = prevS != null ? +(S - prevS).toFixed(6) : 0;
    const motionR = prevR != null ? +(R - prevR).toFixed(6) : 0;

    SER_DATA.ser_stress_motion[yr][state] = motionS;
    SER_DATA.ser_reaction_motion[yr][state] = motionR;
  });

  // Need motion populated before spillover
  STATE_NAMES.forEach(state => {
    const S = SER_DATA.ser_stress[yr][state];
    const E = SER_DATA.ser_elasticity[yr][state];
    if (S == null || E == null) return;

    const neighbors = (STATE_BORDERS[state] || []).filter(n => STATE_NAMES.includes(n));
    const selfMotion = SER_DATA.ser_stress_motion[yr][state] ?? 0;

    let rawSpill = 0;
    if (neighbors.length) {
      const w = 1 / neighbors.length;
      neighbors.forEach(n => {
        const neighborMotion = SER_DATA.ser_stress_motion[yr][n];
        if (neighborMotion == null) return;
        rawSpill += w * Math.max(0, neighborMotion - selfMotion);
      });
    }

    rawSpill *= SER_PARAMS.lambda;

    // high elasticity dampens incoming pressure
    const dampedSpill = rawSpill * (1 - E);

    SER_DATA.ser_spillover[yr][state] = +rawSpill.toFixed(6);
    SER_DATA.ser_damped_spillover[yr][state] = +dampedSpill.toFixed(6);

    // Forecast next year's stress from current state + damped spillover
    const forecast = +(S + dampedSpill).toFixed(6);
    SER_DATA.ser_forecast_stress[yr][state] = forecast;

    const actualNext = nextYr ? SER_DATA.ser_stress[nextYr][state] : null;
    SER_DATA.ser_forecast_error[yr][state] =
      actualNext != null ? +(actualNext - forecast).toFixed(6) : null;
  });
});

// Metadata for SER metrics
const SER_META = {
  ser_stress: {
    label: "SER Stress (S*)",
    unit: "",
    fmt: v => v.toFixed(4),
    loBetter: true,
    desc: "Economic constraint level. Lower = better.",
    paperKey: "S"
  },
  ser_elasticity: {
    label: "SER Elasticity (E*)",
    unit: "",
    fmt: v => v.toFixed(4),
    loBetter: false,
    desc: "Adaptive capacity. Higher = better.",
    paperKey: "E"
  },
  ser_reaction: {
    label: "SER Reaction (R*)",
    unit: "",
    fmt: v => v.toFixed(4),
    loBetter: true,
    desc: "Behavioral response amplitude. Lower = better.",
    paperKey: "R"
  },
  ser_utility: {
    label: "SER Utility (U*)",
    unit: "",
    fmt: v => v.toFixed(4),
    loBetter: false,
    desc: "Net welfare proxy (E*−S*). Higher = better.",
    paperKey: "U"
  },
  ser_stress_motion: {
    label: "SER Stress Motion (ΔS)",
    unit: "",
    fmt: v => v.toFixed(4),
    loBetter: true,
    desc: "Year-over-year change in stress.",
    paperKey: null
  },
  ser_reaction_motion: {
    label: "SER Reaction Motion (ΔR)",
    unit: "",
    fmt: v => v.toFixed(4),
    loBetter: true,
    desc: "Year-over-year change in reaction.",
    paperKey: null
  },
  ser_spillover: {
    label: "SER Spillover Pressure",
    unit: "",
    fmt: v => v.toFixed(4),
    loBetter: true,
    desc: "Incoming pressure from higher-motion neighbors.",
    paperKey: null
  },
  ser_damped_spillover: {
    label: "SER Damped Spillover",
    unit: "",
    fmt: v => v.toFixed(4),
    loBetter: true,
    desc: "Spillover after local elasticity damping.",
    paperKey: null
  },
  ser_forecast_stress: {
    label: "SER Forecast Stress",
    unit: "",
    fmt: v => v.toFixed(4),
    loBetter: true,
    desc: "Next-period stress estimate from local state plus spillover.",
    paperKey: null
  },
  ser_forecast_error: {
    label: "SER Forecast Error",
    unit: "",
    fmt: v => v == null ? '—' : v.toFixed(4),
    loBetter: true,
    desc: "Actual next stress minus forecast stress.",
    paperKey: null
  }
};

window.SER_PAPER_REF = SER_PAPER_REF;
window.SER_PARAMS = SER_PARAMS;
window.STATE_BORDERS = STATE_BORDERS;
window.computeSER = computeSER;
window.computeLocalSER = computeLocalSER;
window.SER_DATA = SER_DATA;
window.SER_META = SER_META;
