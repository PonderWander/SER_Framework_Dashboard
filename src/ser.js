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

/* global RAW, STATE_NAMES, YEARS */

// Paper reference values (control case)
const SER_PAPER_REF = { S: 0.1828, E: 0.9121, R: 0.2004, U: 0.7293 };

/**
 * Compute SER scores for a single state and year.
 * @param {string} state  Full state name
 * @param {string|number} year
 * @returns {{ S, E, R, U }} normalized scores, or null if data is missing
 */
function computeSER(state, year) {
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

// Pre-compute SER tables for all states × years
const SER_DATA = {
  ser_stress:     {},
  ser_elasticity: {},
  ser_reaction:   {},
  ser_utility:    {}
};

YEARS.forEach(yr => {
  ['ser_stress','ser_elasticity','ser_reaction','ser_utility'].forEach(k => {
    SER_DATA[k][yr] = {};
  });
  STATE_NAMES.forEach(s => {
    const r = computeSER(s, yr);
    if (r) {
      SER_DATA.ser_stress[yr][s]     = r.S;
      SER_DATA.ser_elasticity[yr][s] = r.E;
      SER_DATA.ser_reaction[yr][s]   = r.R;
      SER_DATA.ser_utility[yr][s]    = r.U;
    }
  });
});

// Metadata for SER metrics (mirrors RAW structure)
const SER_META = {
  ser_stress: {
    label: "SER Stress (S*)", unit: "",
    fmt: v => v.toFixed(4),
    loBetter: true,
    desc: "Economic constraint level. Lower = better.",
    paperKey: "S"
  },
  ser_elasticity: {
    label: "SER Elasticity (E*)", unit: "",
    fmt: v => v.toFixed(4),
    loBetter: false,
    desc: "Adaptive capacity. Higher = better.",
    paperKey: "E"
  },
  ser_reaction: {
    label: "SER Reaction (R*)", unit: "",
    fmt: v => v.toFixed(4),
    loBetter: true,
    desc: "Behavioral response amplitude. Lower = better.",
    paperKey: "R"
  },
  ser_utility: {
    label: "SER Utility (U*)", unit: "",
    fmt: v => v.toFixed(4),
    loBetter: false,
    desc: "Net welfare proxy (E*−S*). Higher = better.",
    paperKey: "U"
  }
};
