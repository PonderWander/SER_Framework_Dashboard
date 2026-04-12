# U.S. Economic Indicators Dashboard — USAGE.md

Interactive CONUS choropleth map and aggregated statistics dashboard covering
publicly available census, labor, credit, cost-of-living, inflation, and capital
expenditure data by state (2019–2024), with embedded SER (Stress–Elasticity–Reaction)
framework scores derived from Castle (2026).

---

## Quick Start

No build step or server required. Open the file directly in a modern browser:

```
open index.html          # macOS
start index.html         # Windows
xdg-open index.html      # Linux
```

> **Internet required for the map.** The U.S. state topology is fetched at runtime
> from `cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json`. All other data and logic
> runs entirely in the browser from the local files. If you need fully offline
> operation, see [Offline Operation](#offline-operation) below.

---

## Project Structure

```
us-economic-dashboard/
├── index.html              Main dashboard (entry point)
├── USAGE.md                This file
├── src/
│   ├── style.css           All visual styles (light + dark mode)
│   ├── data.js             State economic datasets 2019–2024
│   ├── ser.js              SER framework computation (Castle 2026)
│   └── dashboard.js        Map, charts, and UI logic
└── scripts/
    └── refresh_data.py     Data refresh script (BLS, Census, BEA APIs)
```

---

## Using the Dashboard

### CONUS Map View

- **Metric selector** — choose from 7 economic indicators or 4 SER framework scores.
- **Year selector** — toggle between 2019 and 2024.
- **Heat scale controls** — enter custom Min/Max values to pin the choropleth range
  for that metric independently. Click **Auto** to restore data-driven scaling. Scale
  overrides are stored per metric; switching metrics preserves each metric's override.
- **Hover** any state to preview all metrics in the side panel.
- **Click** a state to pin it (panel stays visible when moving the cursor).
- The side panel shows year-over-year direction arrows (green = improving for that metric)
  and, for SER scores, percentage deviation from the paper's control baseline.

### Aggregated CONUS View

- Summary cards: CONUS average, highest state, lowest state, range spread.
  For SER metrics, a fourth card shows the paper's control case value.
- **Top 10 bar chart** — ranked by the currently selected metric.
- **CONUS trend line** — average across all 50 states from 2019–2024. For SER metrics,
  a dashed orange reference line marks the paper's control value.
- **Full data table** — all 50 states ranked, with prior-year delta pills and (for SER)
  a vs.-paper-control column.

---

## Data Sources

| Metric | Source | URL |
|---|---|---|
| Unemployment Rate | BLS Local Area Unemployment Statistics | https://www.bls.gov/lau/ |
| Median Household Income | Census Bureau ACS 1-Year | https://data.census.gov/ |
| CPI Inflation | BLS Consumer Price Index | https://www.bls.gov/cpi/ |
| Cost-of-Living Index | C2ER/ACCRA COLI (state composite) | https://www.coli.org/ |
| Labor Participation Rate | BLS Current Population Survey | https://www.bls.gov/lau/ |
| Avg Credit Score | Experian State of Credit (annual) | https://www.experian.com/blogs/ask-experian/state-of-credit/ |
| Capital Expenditure | BEA GDP by State / Fixed Assets | https://www.bea.gov/data/gdp/gdp-state |
| SER Framework | Castle, J. (2026). OZERP. SSRN. | Computed from above inputs |

All data is curated from publicly available annual releases. State-level CPI figures
incorporate BLS metro-area series with interpolation where state-level series are not
published directly. Cost-of-living values reflect MERIC/C2ER composite estimates.

---

## SER Framework

The SER (Stress–Elasticity–Reaction) framework is specified in:

> Castle, J. (2026). *OZERP: A Framework for Aligning Capital Allocation with
> Real-World Economic Outcomes.* SSRN.

### Operational form

```
S* = 0.5 × (housing share) + 0.2 × (energy share) + 0.2 × (delinquency) + 0.1 × (debt ratio)
E* = 0.5 × (FICO / 850)   + 0.3 × (1 – energy share) + 0.2 × (1 – delinquency)
R* = S* / E*
U* = E* – S*
```

### Input mapping from state data

| SER input | Source variable | Transformation |
|---|---|---|
| Housing share | Cost-of-Living Index | `(COL / 100) × 0.334`, capped at 0.50 |
| Energy share | CPI Inflation | `(CPI / 100) × 0.08`, capped at 0.15 |
| Delinquency | Unemployment Rate | `UE / 100`, capped at 0.15 |
| FICO | Avg Credit Score | direct |
| Debt ratio | Avg Credit Score | `(850 – FICO) / (850 – 580)`, capped at 1.0 |

### Paper reference (control case)

| Score | Paper value | Description |
|---|---|---|
| S* | 0.1828 | U.S. consumer baseline stress |
| E* | 0.9121 | U.S. consumer baseline elasticity |
| R* | 0.2004 | U.S. consumer baseline reaction |
| U* | 0.7293 | U.S. consumer baseline utility proxy |

Source: BLS CEX 2024, NY Fed 2024, NREL 2016, Fitch Ratings 2025.

The dashboard computes these scores for each of the 50 states for each year and
benchmarks them against the paper's national control case.

---

## Refreshing Data for a New Year

The dashboard ships with data from 2019 through 2024. When annual data for a new
year becomes available (typically Q1–Q2 of the following year), run:

```bash
pip install requests
python scripts/refresh_data.py --year 2025
```

### API keys (recommended, free)

| API | Registration | Environment variable |
|---|---|---|
| BLS | https://data.bls.gov/registrationEngine/ | `BLS_API_KEY` |
| BEA | https://apps.bea.gov/API/signup/ | `BEA_API_KEY` |
| Census | No key required | — |

Without keys the script falls back to `DEMO_KEY` (rate-limited to ~25 requests/day).

Set keys via environment:

```bash
export BLS_API_KEY=your_key_here
export BEA_API_KEY=your_key_here
python scripts/refresh_data.py --year 2025
```

Or edit the constants at the top of `scripts/refresh_data.py`.

### Metrics that require manual update

These sources do not expose free programmatic APIs:

| Metric | How to update |
|---|---|
| **Cost-of-Living Index** | Download annual MERIC composite table from https://meric.mo.gov/data/cost-living-data-series and add a new year block to `costOfLiving` in `src/data.js` |
| **CPI Inflation (state-level)** | BLS publishes metro-area CPI. Aggregate to state level using population-weighted MSA averages, or use the national figure ±regional variance. Add block to `inflation` in `src/data.js` |
| **Avg Credit Score** | Download Experian's annual "State of Credit" PDF from https://www.experian.com/blogs/ask-experian/state-of-credit/ and add state values to `creditScore` in `src/data.js` |

### Data format

Each metric in `src/data.js` follows this structure:

```javascript
metricName: {
  label: "Display Name",
  unit:  "%",
  fmt:   v => v.toFixed(1) + "%",
  loBetter: true,          // true if lower values are "better"
  source: "Source name",
  url:    "https://...",
  2024: { Alabama: 3.3, Alaska: 4.4, ... },
  2025: { Alabama: X.X, Alaska: X.X, ... }   // new year
}
```

After adding a new year block, update `yearSel` in `index.html`:

```html
<option value="2025">2025</option>   <!-- add at top -->
```

And add `"2025"` to the `YEARS` array in `src/data.js`:

```javascript
const YEARS = ["2019","2020","2021","2022","2023","2024","2025"];
```

---

## Offline Operation

To run fully offline, download the US Atlas topology JSON and serve it locally:

```bash
curl -o data/states-10m.json \
  https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json
```

Then edit the fetch call in `src/dashboard.js`:

```javascript
// Change:
d3.json('https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json')
// To:
d3.json('data/states-10m.json')
```

Similarly, download D3, TopoJSON, and Chart.js from `cdnjs.cloudflare.com` and
update the `<script>` tags in `index.html` to point to `src/lib/`.

> **Note:** Browsers block local file fetches via `file://`. For offline local
> development, run a simple HTTP server:
> ```bash
> python -m http.server 8080
> # then open http://localhost:8080
> ```

---

## Extending the Dashboard

### Adding a new metric

1. Add a block to `RAW` in `src/data.js` following the existing format.
2. Add an `<option>` in the appropriate `<optgroup>` in `index.html`.
3. The dashboard will automatically include the metric in the state card, map,
   bar chart, trend line, and data table.

### Adding a new SER input mapping

Edit `computeSER()` in `src/ser.js` to adjust the weighting or input variables.
The function signature and return type (`{S, E, R, U}`) must be preserved for
the dashboard to display scores correctly.

### Styling

All colors use CSS custom properties defined in `src/style.css` under `:root`
and `@media (prefers-color-scheme: dark)`. Dark mode is automatic based on
system preference.

---

## Browser Compatibility

Tested in: Chrome 120+, Firefox 121+, Safari 17+, Edge 120+.

Requires: ES2020, CSS custom properties, SVG, Canvas API.

---

## License

Data is sourced from U.S. government agencies (public domain) and third-party
annual reports (Experian, C2ER) used for informational purposes.

SER framework formulas are cited from Castle (2026) / SSRN per academic fair use.

Dashboard source code is provided as-is for research and informational purposes.
