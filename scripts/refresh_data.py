#!/usr/bin/env python3
"""
scripts/refresh_data.py
=======================
Fetches updated state-level economic data from public APIs and updates
src/data.js for the U.S. Economic Indicators Dashboard.

Data sources:
  - BLS API v2  (unemployment, labor participation)    https://api.bls.gov/publicAPI/v2/
  - Census API  (median household income)              https://api.census.gov/data/
  - BEA API     (capital expenditure proxy)            https://apps.bea.gov/api/
  - BLS CPI     (inflation — national series, state-adjusted estimate)
  - Experian/CFPB  (credit score — manual update only, see note below)
  - C2ER COLI   (cost-of-living — manual update only, see note below)

Prerequisites:
    pip install requests

API keys:
    BLS  — free registration at https://data.bls.gov/registrationEngine/
    BEA  — free registration at https://apps.bea.gov/API/signup/
    Census — no key needed for ACS 1-year summary-level data

Usage:
    # Fetch all available sources for a new year (e.g. 2025)
    python scripts/refresh_data.py --year 2025

    # Fetch BLS data only
    python scripts/refresh_data.py --year 2025 --source bls

    # Dry run (print to stdout, don't write file)
    python scripts/refresh_data.py --year 2025 --dry-run

Notes on manual-only sources:
    Credit scores  — Experian publishes an annual "State of Credit" PDF.
                     Extract state averages and add to the creditScore block in src/data.js.
                     Alternatively, CFPB Consumer Credit Panel has state medians.
    Cost-of-living — The C2ER/ACCRA COLI requires a paid subscription for full state data.
                     The Missouri Economic Research and Information Center (MERIC) publishes
                     a free annual composite: https://meric.mo.gov/data/cost-living-data-series
"""

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("Install requests first:  pip install requests")

# ── Configuration ────────────────────────────────────────────────────

BLS_API_KEY  = ""   # Set your key or export BLS_API_KEY env var
BEA_API_KEY  = ""   # Set your key or export BEA_API_KEY env var

BLS_BASE  = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
CENSUS_BASE = "https://api.census.gov/data"

STATE_FIPS = {
    "Alabama":"01","Alaska":"02","Arizona":"04","Arkansas":"05","California":"06",
    "Colorado":"08","Connecticut":"09","Delaware":"10","Florida":"12","Georgia":"13",
    "Hawaii":"15","Idaho":"16","Illinois":"17","Indiana":"18","Iowa":"19","Kansas":"20",
    "Kentucky":"21","Louisiana":"22","Maine":"23","Maryland":"24","Massachusetts":"25",
    "Michigan":"26","Minnesota":"27","Mississippi":"28","Missouri":"29","Montana":"30",
    "Nebraska":"31","Nevada":"32","New Hampshire":"33","New Jersey":"34","New Mexico":"35",
    "New York":"36","North Carolina":"37","North Dakota":"38","Ohio":"39","Oklahoma":"40",
    "Oregon":"41","Pennsylvania":"42","Rhode Island":"44","South Carolina":"45",
    "South Dakota":"46","Tennessee":"47","Texas":"48","Utah":"49","Vermont":"50",
    "Virginia":"51","Washington":"53","West Virginia":"54","Wisconsin":"55","Wyoming":"56"
}

FIPS_TO_STATE = {v: k for k, v in STATE_FIPS.items()}

# ── BLS: Unemployment Rate ────────────────────────────────────────────

def fetch_bls_unemployment(year: int, api_key: str) -> dict:
    """
    Fetch annual average unemployment rates from BLS LAUS.
    Series IDs: LASST{FIPS}0000000000003  (state unemployment rate)
    """
    series_ids = [f"LASST{fips}0000000000003" for fips in STATE_FIPS.values()]
    # BLS allows 50 series per request on the registered tier
    results = {}
    for chunk_start in range(0, len(series_ids), 50):
        chunk = series_ids[chunk_start:chunk_start+50]
        payload = {
            "seriesid": chunk,
            "startyear": str(year),
            "endyear": str(year),
            "annualaverage": True,
            "registrationkey": api_key or "DEMO_KEY"
        }
        r = requests.post(BLS_BASE, json=payload, timeout=30)
        r.raise_for_status()
        data = r.json()
        if data.get("status") != "REQUEST_SUCCEEDED":
            print(f"  BLS warning: {data.get('message', 'unknown error')}", file=sys.stderr)
            continue
        for series in data.get("Results", {}).get("series", []):
            sid   = series["seriesID"]
            fips  = sid[5:7]
            state = FIPS_TO_STATE.get(fips)
            if not state:
                continue
            annual = [d for d in series.get("data", []) if d.get("period") == "M13"]
            if annual:
                try:
                    results[state] = float(annual[0]["value"])
                except (ValueError, KeyError):
                    pass
    return results

# ── BLS: Labor Participation Rate ─────────────────────────────────────

def fetch_bls_lfpr(year: int, api_key: str) -> dict:
    """
    Fetch annual labor force participation rates from BLS LAUS.
    Series IDs: LASST{FIPS}0000000000006
    """
    series_ids = [f"LASST{fips}0000000000006" for fips in STATE_FIPS.values()]
    results = {}
    for chunk_start in range(0, len(series_ids), 50):
        chunk = series_ids[chunk_start:chunk_start+50]
        payload = {
            "seriesid": chunk,
            "startyear": str(year),
            "endyear": str(year),
            "annualaverage": True,
            "registrationkey": api_key or "DEMO_KEY"
        }
        r = requests.post(BLS_BASE, json=payload, timeout=30)
        r.raise_for_status()
        data = r.json()
        if data.get("status") != "REQUEST_SUCCEEDED":
            print(f"  BLS warning: {data.get('message')}", file=sys.stderr)
            continue
        for series in data.get("Results", {}).get("series", []):
            sid   = series["seriesID"]
            fips  = sid[5:7]
            state = FIPS_TO_STATE.get(fips)
            if not state:
                continue
            annual = [d for d in series.get("data", []) if d.get("period") == "M13"]
            if annual:
                try:
                    results[state] = float(annual[0]["value"])
                except (ValueError, KeyError):
                    pass
    return results

# ── Census: Median Household Income ──────────────────────────────────

def fetch_census_income(year: int) -> dict:
    """
    Fetch median household income from Census ACS 1-Year estimates.
    Variable: B19013_001E (median household income in past 12 months)
    """
    # ACS 1-year is typically available for states the following year
    acs_year = min(year, 2023)  # adjust if new data is available
    url = f"{CENSUS_BASE}/{acs_year}/acs/acs1"
    params = {
        "get": "NAME,B19013_001E",
        "for": "state:*"
    }
    r = requests.get(url, params=params, timeout=30)
    r.raise_for_status()
    rows = r.json()
    headers = rows[0]
    name_idx   = headers.index("NAME")
    income_idx = headers.index("B19013_001E")
    results = {}
    for row in rows[1:]:
        state  = row[name_idx]
        income = row[income_idx]
        if income and income != "-666666666":
            results[state] = int(income)
    return results

# ── BLS: National CPI (state-level placeholder) ───────────────────────

def fetch_national_cpi_yoy(year: int, api_key: str) -> float:
    """
    Fetch national all-items CPI annual average YoY change.
    Series: CUUR0000SA0 (CPI-U, all items, not seasonally adjusted)
    Returns: float percentage or None
    """
    payload = {
        "seriesid": ["CUUR0000SA0"],
        "startyear": str(year - 1),
        "endyear": str(year),
        "annualaverage": True,
        "registrationkey": api_key or "DEMO_KEY"
    }
    r = requests.post(BLS_BASE, json=payload, timeout=30)
    r.raise_for_status()
    data = r.json()
    series_list = data.get("Results", {}).get("series", [])
    if not series_list:
        return None
    data_pts = {d["year"]: float(d["value"])
                for d in series_list[0].get("data", [])
                if d.get("period") == "M13"}
    if str(year) in data_pts and str(year-1) in data_pts:
        return round((data_pts[str(year)] / data_pts[str(year-1)] - 1) * 100, 2)
    return None

# ── BEA: State GDP as CapEx proxy ─────────────────────────────────────

def fetch_bea_gdp(year: int, api_key: str) -> dict:
    """
    Fetch state GDP as a rough capital expenditure proxy.
    For real CapEx use BEA Fixed Assets table FA226.
    API docs: https://apps.bea.gov/api/
    """
    if not api_key:
        print("  BEA: No API key provided, skipping.", file=sys.stderr)
        return {}
    url = "https://apps.bea.gov/api/data"
    params = {
        "UserID": api_key,
        "method": "GetData",
        "datasetname": "Regional",
        "TableName": "SAGDP2N",
        "LineCode": "1",
        "GeoFips": "STATE",
        "Year": str(year),
        "ResultFormat": "json"
    }
    r = requests.get(url, params=params, timeout=30)
    r.raise_for_status()
    data = r.json()
    results = {}
    for item in data.get("BEAAPI", {}).get("Results", {}).get("Data", []):
        geo  = item.get("GeoName", "")
        val  = item.get("DataValue", "").replace(",", "")
        if geo and val:
            try:
                results[geo] = round(float(val) / 1000, 1)  # thousands → $B
            except ValueError:
                pass
    return results

# ── Patch data.js ─────────────────────────────────────────────────────

def patch_data_js(path: Path, metric: str, year: int, values: dict):
    """
    Inject a new year block into the specified metric in src/data.js.
    Looks for the metric block and inserts/replaces the year entry.
    """
    content = path.read_text(encoding="utf-8")
    year_str = str(year)
    vals_js  = json.dumps(values, ensure_ascii=False, separators=(", ", ": "))

    # Check if year already exists in this metric block
    pattern = rf'({metric}:.*?){year_str}:\s*\{{[^}}]*\}}'
    if re.search(pattern, content, re.DOTALL):
        # Replace existing year entry
        content = re.sub(
            rf'({year_str}):\s*\{{[^}}]*\}}',
            f'{year_str}: {vals_js}',
            content, count=1
        )
    else:
        # Insert before the closing brace of the metric block
        # This is a simplified approach; manual editing may be clearer for large updates
        print(f"  Note: {year} block not found in {metric}. "
              f"Please insert the following manually into src/data.js:\n"
              f"  {year_str}: {vals_js}", file=sys.stderr)
        return

    path.write_text(content, encoding="utf-8")
    print(f"  Patched {metric} → {year_str} ({len(values)} states)")

# ── CLI ───────────────────────────────────────────────────────────────

def main():
    import os
    parser = argparse.ArgumentParser(
        description="Refresh state economic data for the U.S. Economic Indicators Dashboard")
    parser.add_argument("--year",    type=int, required=True, help="Target year, e.g. 2025")
    parser.add_argument("--source",  choices=["bls","census","bea","all"], default="all")
    parser.add_argument("--dry-run", action="store_true", help="Print results only, don't write")
    args = parser.parse_args()

    bls_key = BLS_API_KEY or os.getenv("BLS_API_KEY", "")
    bea_key = BEA_API_KEY or os.getenv("BEA_API_KEY", "")

    root    = Path(__file__).parent.parent
    data_js = root / "src" / "data.js"

    if not data_js.exists():
        sys.exit(f"Cannot find {data_js}")

    fetched = {}

    if args.source in ("bls", "all"):
        print(f"Fetching BLS unemployment {args.year}...")
        fetched["unemployment"] = fetch_bls_unemployment(args.year, bls_key)
        print(f"  → {len(fetched['unemployment'])} states")

        print(f"Fetching BLS labor participation {args.year}...")
        fetched["laborParticipation"] = fetch_bls_lfpr(args.year, bls_key)
        print(f"  → {len(fetched['laborParticipation'])} states")

        print(f"Fetching national CPI {args.year}...")
        national_cpi = fetch_national_cpi_yoy(args.year, bls_key)
        if national_cpi:
            print(f"  → national YoY: {national_cpi}%  (state adjustments applied manually)")
        else:
            print("  → CPI data not yet available for this year")

    if args.source in ("census", "all"):
        print(f"Fetching Census median income {args.year}...")
        fetched["medianIncome"] = fetch_census_income(args.year)
        print(f"  → {len(fetched['medianIncome'])} states")

    if args.source in ("bea", "all"):
        print(f"Fetching BEA state GDP {args.year} (CapEx proxy)...")
        fetched["capex"] = fetch_bea_gdp(args.year, bea_key)
        print(f"  → {len(fetched['capex'])} states")

    if args.dry_run:
        print("\n── DRY RUN OUTPUT ─────────────────────────────────────────────")
        for metric, values in fetched.items():
            print(f"\n{metric} ({args.year}):")
            print(json.dumps(values, indent=2))
        return

    for metric, values in fetched.items():
        if values:
            patch_data_js(data_js, metric, args.year, values)

    print("\nDone. Review src/data.js and reload the dashboard.")
    print("Remember to manually update: costOfLiving, inflation (state), creditScore")

if __name__ == "__main__":
    main()
