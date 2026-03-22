"""
Stock Parameter Screener — Local Server (Dhan API + Yahoo Finance)
==================================================================
No pip install needed — uses only Python standard library.

SETUP:
  1. Subscribe to Dhan Data API (web.dhan.co → Profile → DhanHQ Trading APIs)
  2. Generate an access token (30-day validity)
  3. Run: python server.py
  4. Open http://localhost:5555 in your browser
  5. Enter your Dhan Client ID and Access Token in Settings
"""

import http.server, json, urllib.request, urllib.parse, ssl, os, time, threading, gzip, io, csv, re, math, statistics
from datetime import datetime, timedelta
from http.cookiejar import CookieJar

PORT = 5555
DHAN_BASE = "https://api.dhan.co/v2"
SCRIP_MASTER_URL = "https://images.dhan.co/api-data/api-scrip-master.csv"

dhan_config = {"client_id": "", "access_token": ""}


eq_map = {}       # "RELIANCE" -> "2885"
fut_map = {}      # "RELIANCE" -> {security_id, expiry, trading_symbol, lot_size}
scrip_loaded = False
scrip_debug = {}

ctx = ssl.create_default_context()

HEADERS_YAHOO = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

# Yahoo Finance cookie/crumb cache (needed since Yahoo started requiring auth)
_yahoo_crumb = {"crumb": None, "cookie": None, "ts": 0}

def _get_yahoo_crumb():
    """Fetch a fresh Yahoo Finance crumb + cookie pair."""
    now = time.time()
    # Cache for 1 hour
    if _yahoo_crumb["crumb"] and (now - _yahoo_crumb["ts"]) < 3600:
        return _yahoo_crumb["crumb"], _yahoo_crumb["cookie"]

    try:
        # Step 1: Get consent cookie
        cj = CookieJar()
        opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(cj),
            urllib.request.HTTPSHandler(context=ctx)
        )
        # Visit Yahoo Finance to get cookies
        req = urllib.request.Request("https://finance.yahoo.com/", headers=HEADERS_YAHOO)
        opener.open(req, timeout=10)

        # Step 2: Get crumb using cookies
        req2 = urllib.request.Request("https://query2.finance.yahoo.com/v1/test/getcrumb", headers=HEADERS_YAHOO)
        resp2 = opener.open(req2, timeout=10)
        crumb = resp2.read().decode().strip()

        if crumb and crumb != "":
            # Build cookie string from jar
            cookie_str = "; ".join(f"{c.name}={c.value}" for c in cj)
            _yahoo_crumb["crumb"] = crumb
            _yahoo_crumb["cookie"] = cookie_str
            _yahoo_crumb["ts"] = now
            print(f"    [Yahoo] Got fresh crumb: {crumb[:10]}...")
            return crumb, cookie_str
    except Exception as e:
        print(f"    [Yahoo] Crumb fetch failed: {e}")

    return None, None


# ============================================================
# DHAN SCRIP MASTER
# ============================================================
def load_scrip_master():
    global eq_map, fut_map, scrip_loaded, scrip_debug
    print("  Downloading Dhan scrip master CSV...")
    try:
        req = urllib.request.Request(SCRIP_MASTER_URL, headers={"User-Agent": "Mozilla/5.0"})
        r = urllib.request.urlopen(req, timeout=60, context=ctx)
        raw = r.read()
        enc = r.headers.get("Content-Encoding", "")
        if "gzip" in enc:
            raw = gzip.decompress(raw)
        text = raw.decode("utf-8", errors="ignore")
        reader = csv.DictReader(io.StringIO(text))

        cols = reader.fieldnames or []
        print(f"  CSV columns: {cols}")
        scrip_debug["columns"] = cols

        eq_temp = {}
        fut_rows = []  # Store all FUTSTK rows for second pass
        nse_inst_count = {}

        # === PASS 1: Load equities + collect futures rows ===
        row_count = 0
        equity_raw_samples = []
        fut_raw_samples = []

        for row in reader:
            row_count += 1
            seg = row.get("SEM_EXM_EXCH_ID", "").strip()
            if seg != "NSE":
                continue

            inst = row.get("SEM_INSTRUMENT_NAME", "").strip().upper()
            nse_inst_count[inst] = nse_inst_count.get(inst, 0) + 1

            sym = row.get("SEM_TRADING_SYMBOL", "").strip()
            sec_id = row.get("SEM_SMST_SECURITY_ID", "").strip()
            if not sec_id or not sym:
                continue

            # --- EQUITY: just check instrument name ---
            if inst == "EQUITY":
                key = sym.upper()
                if key not in eq_temp:
                    eq_temp[key] = sec_id
                if len(equity_raw_samples) < 3:
                    equity_raw_samples.append(dict(row))

            # --- FUTSTK: collect for second pass ---
            if inst == "FUTSTK":
                fut_rows.append(row)
                if len(fut_raw_samples) < 3:
                    fut_raw_samples.append(dict(row))

        print(f"\n  Total CSV rows: {row_count}")
        print(f"  NSE instruments: {nse_inst_count}")
        print(f"  Equities found: {len(eq_temp)}")
        print(f"  FUTSTK rows: {len(fut_rows)}")

        # Print raw samples for debugging
        if equity_raw_samples:
            print(f"\n  --- RAW EQUITY SAMPLE ---")
            for s in equity_raw_samples[:2]:
                relevant = {k: v for k, v in s.items() if v and v.strip()}
                print(f"    {relevant}")

        if fut_raw_samples:
            print(f"\n  --- RAW FUTSTK SAMPLE ---")
            for s in fut_raw_samples[:2]:
                relevant = {k: v for k, v in s.items() if v and v.strip()}
                print(f"    {relevant}")

        scrip_debug["equity_samples"] = equity_raw_samples[:3]
        scrip_debug["fut_samples"] = fut_raw_samples[:3]
        scrip_debug["nse_instruments"] = nse_inst_count

        # === PASS 2: Map futures to equity symbols ===
        eq_symbols = set(eq_temp.keys())  # {"RELIANCE", "TCS", "WIPRO", ...}
        fut_temp = {}  # symbol -> list of contracts
        unmatched = []

        for row in fut_rows:
            sym = row.get("SEM_TRADING_SYMBOL", "").strip().upper()
            sec_id = row.get("SEM_SMST_SECURITY_ID", "").strip()
            custom = row.get("SEM_CUSTOM_SYMBOL", "").strip().upper()
            expiry = row.get("SEM_EXPIRY_DATE", "").strip()
            lot = row.get("SEM_LOT_UNITS", "").strip()

            base = None

            # Strategy A: Match SEM_TRADING_SYMBOL prefix against known equity symbols
            # Sort equity symbols longest first to match "M&MFIN" before "M&M"
            for eq_sym in sorted(eq_symbols, key=len, reverse=True):
                if sym.startswith(eq_sym) and (len(sym) == len(eq_sym) or not sym[len(eq_sym)].isalpha()):
                    base = eq_sym
                    break

            # Strategy B: Match SEM_CUSTOM_SYMBOL prefix
            if not base and custom:
                for eq_sym in sorted(eq_symbols, key=len, reverse=True):
                    if custom.startswith(eq_sym) and (len(custom) == len(eq_sym) or not custom[len(eq_sym)].isalpha()):
                        base = eq_sym
                        break

            # Strategy C: Extract from trading symbol using regex
            if not base:
                # Remove common suffixes like "25FEB", "FUT", dates
                m = re.match(r'^([A-Z&]+?)(?:\d{2}[A-Z]{3}|\s|$)', sym)
                if m and m.group(1) in eq_symbols:
                    base = m.group(1)

            # Strategy D: Split on hyphen/space
            if not base:
                parts = re.split(r'[-\s]', sym)
                if parts and parts[0] in eq_symbols:
                    base = parts[0]

            if base:
                if base not in fut_temp:
                    fut_temp[base] = []
                fut_temp[base].append({
                    "security_id": sec_id,
                    "expiry": expiry,
                    "trading_symbol": row.get("SEM_TRADING_SYMBOL", "").strip(),
                    "lot_size": lot
                })
            else:
                if len(unmatched) < 5:
                    unmatched.append({"sym": sym, "custom": custom})

        if unmatched:
            print(f"\n  Unmatched futures (first 5): {unmatched}")

        # Pick nearest expiry for each symbol
        today = datetime.now().strftime("%Y-%m-%d")
        for key, contracts in fut_temp.items():
            valid = [c for c in contracts if c["expiry"] >= today]
            if valid:
                valid.sort(key=lambda c: c["expiry"])
                fut_map[key] = valid[0]
            elif contracts:
                contracts.sort(key=lambda c: c["expiry"], reverse=True)
                fut_map[key] = contracts[0]

        eq_map = eq_temp
        scrip_loaded = True

        print(f"\n  *** SCRIP MASTER LOADED: {len(eq_map)} equities, {len(fut_map)} futures ***")

        # Verify key stocks
        test_syms = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "WIPRO", "ICICIBANK", "SBIN", "BHARTIARTL"]
        for ts in test_syms:
            eq = eq_map.get(ts, "---")
            ft = fut_map.get(ts, {})
            ft_id = ft.get("security_id", "---") if ft else "---"
            ft_sym = ft.get("trading_symbol", "") if ft else ""
            print(f"    {ts:15s} eq_id={eq:>8s}  fut_id={ft_id:>8s}  fut_sym={ft_sym}")

        scrip_debug["eq_count"] = len(eq_map)
        scrip_debug["fut_count"] = len(fut_map)
        scrip_debug["test_symbols"] = {
            s: {"eq": eq_map.get(s), "fut": fut_map.get(s, {}).get("security_id") if fut_map.get(s) else None}
            for s in test_syms
        }

    except Exception as e:
        import traceback
        print(f"\n  *** ERROR loading scrip master: {e} ***")
        traceback.print_exc()
        scrip_debug["error"] = str(e)
        scrip_loaded = False


def find_security_ids(symbol):
    sym = symbol.upper().strip()
    eq_id = eq_map.get(sym)
    fut_info = fut_map.get(sym)

    if not eq_id or not fut_info:
        clean = sym.replace("&", "").replace(" ", "").replace("-", "").replace("_", "")
        if not eq_id:
            for k, v in eq_map.items():
                if k.replace("&", "").replace("-", "").replace("_", "") == clean:
                    eq_id = v
                    break
        if not fut_info:
            for k, v in fut_map.items():
                if k.replace("&", "").replace("-", "").replace("_", "") == clean:
                    fut_info = v
                    break

    return eq_id, fut_info


# ============================================================
# DHAN API CALLS
# ============================================================
def dhan_post(path, body):
    if not dhan_config["access_token"] or not dhan_config["client_id"]:
        return None

    url = DHAN_BASE + path
    data = json.dumps(body).encode()
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "access-token": dhan_config["access_token"],
        "client-id": str(dhan_config["client_id"]),
        "User-Agent": "Mozilla/5.0"
    }
    print(f"      [Dhan] POST {path}")

    try:
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        r = urllib.request.urlopen(req, timeout=15, context=ctx)
        raw = r.read()
        enc = r.headers.get("Content-Encoding", "")
        if "gzip" in enc:
            raw = gzip.decompress(raw)
        return json.loads(raw)
    except urllib.error.HTTPError as e:
        body_err = e.read().decode() if e.fp else ""
        print(f"      [Dhan] HTTP {e.code}: {body_err[:300]}")
        return {"error": f"HTTP {e.code}", "detail": body_err[:300]}
    except Exception as e:
        print(f"      [Dhan] Error: {e}")
        return {"error": str(e)}


def fetch_futures_quote(fut_info):
    if not fut_info:
        return None
    sec_id = int(fut_info["security_id"])
    print(f"      [FUT] sec_id={sec_id} ({fut_info.get('trading_symbol','')})")

    # Try quote mode first (has OI + volume), then full mode
    for endpoint in ["/marketfeed/quote", "/marketfeed/full"]:
        resp = dhan_post(endpoint, {"NSE_FNO": [sec_id]})
        if not resp or not isinstance(resp, dict) or "error" in resp:
            continue

        quote = None
        if "data" in resp:
            fno = resp["data"].get("NSE_FNO", {})
            quote = fno.get(str(sec_id))
            if not quote:
                for k, v in fno.items():
                    if isinstance(v, dict) and ("last_price" in v or "ltp" in v):
                        quote = v
                        break
        elif "NSE_FNO" in resp:
            quote = resp["NSE_FNO"].get(str(sec_id))

        if quote:
            # Normalize field names (Dhan sometimes uses different casing)
            if "ltp" in quote and "last_price" not in quote:
                quote["last_price"] = quote["ltp"]
            print(f"      [FUT] OK via {endpoint}: LTP={quote.get('last_price')}, OI={quote.get('oi')}, prevOI={quote.get('previous_oi', quote.get('prev_oi', '?'))}, Vol={quote.get('volume')}")
            print(f"      [FUT] All keys: {list(quote.keys())}")
            return quote
        else:
            print(f"      [FUT] {endpoint}: No quote in response. Keys: {list(resp.keys())}")

    print(f"      [FUT] All endpoints failed for {sec_id}")
    return None


def fetch_dhan_historical_oi(fut_info, days=30):
    """Fetch historical daily data for futures to get past OI values."""
    if not fut_info:
        return None
    sec_id = int(fut_info["security_id"])
    today = datetime.now()
    from_date = (today - timedelta(days=days)).strftime("%Y-%m-%d")
    to_date = today.strftime("%Y-%m-%d")

    # Dhan charts/historical endpoint — oi:true is REQUIRED for OI data
    resp = dhan_post("/charts/historical", {
        "securityId": str(sec_id),
        "exchangeSegment": "NSE_FNO",
        "instrument": "FUTIDX",
        "expiryCode": 0,
        "oi": True,
        "fromDate": from_date,
        "toDate": to_date
    })
    if not resp or not isinstance(resp, dict) or "error" in resp:
        # Try alternate instrument type (FUTSTK for stock futures)
        resp = dhan_post("/charts/historical", {
            "securityId": str(sec_id),
            "exchangeSegment": "NSE_FNO",
            "instrument": "FUTSTK",
            "expiryCode": 0,
            "oi": True,
            "fromDate": from_date,
            "toDate": to_date
        })
    if not resp or not isinstance(resp, dict) or "error" in resp:
        print(f"      [HIST-OI] Failed: {str(resp)[:200]}")
        return None

    # Response has: open, high, low, close, volume, timestamp (and sometimes oi)
    oi_list = resp.get("oi") or resp.get("open_interest") or []
    timestamps = resp.get("timestamp") or resp.get("timestamps") or []
    closes = resp.get("close") or []

    if oi_list and timestamps:
        print(f"      [HIST-OI] Got {len(oi_list)} daily OI points")
        return {"oi": oi_list, "timestamps": timestamps, "closes": closes}
    else:
        print(f"      [HIST-OI] No OI in response. Keys: {list(resp.keys())}")
        # Even if no OI, try to return what we have for debugging
        if timestamps:
            print(f"      [HIST-OI] Has {len(timestamps)} timestamps, {len(closes)} closes")
        return resp


def fetch_option_chain(eq_id, symbol):
    if not eq_id:
        return None

    print(f"      [OC] Getting expiry list for eq_id={eq_id}")
    expiry_resp = dhan_post("/optionchain/expirylist", {
        "UnderlyingScrip": int(eq_id),
        "UnderlyingSeg": "NSE_EQ"
    })

    if not expiry_resp or (isinstance(expiry_resp, dict) and "error" in expiry_resp):
        print(f"      [OC] Expiry error: {expiry_resp}")
        return None

    expiry_list = None
    if isinstance(expiry_resp, dict) and "data" in expiry_resp:
        expiry_list = expiry_resp["data"]
    elif isinstance(expiry_resp, list):
        expiry_list = expiry_resp

    if not isinstance(expiry_list, list) or not expiry_list:
        print(f"      [OC] No expiry list. Response: {str(expiry_resp)[:200]}")
        return None

    today = datetime.now().strftime("%Y-%m-%d")
    future = sorted([e for e in expiry_list if isinstance(e, str) and e >= today])
    expiry_date = future[0] if future else sorted(expiry_list)[-1]
    print(f"      [OC] Using expiry: {expiry_date} (from {len(expiry_list)} total)")

    time.sleep(0.5)
    oc_resp = dhan_post("/optionchain", {
        "UnderlyingScrip": int(eq_id),
        "UnderlyingSeg": "NSE_EQ",
        "Expiry": expiry_date
    })

    if not oc_resp or not isinstance(oc_resp, dict) or "error" in oc_resp:
        print(f"      [OC] Chain error: {oc_resp}")
        return None

    # Debug
    print(f"      [OC] Response keys: {list(oc_resp.keys())}")
    if "data" in oc_resp and isinstance(oc_resp["data"], dict):
        dk = list(oc_resp["data"].keys())
        print(f"      [OC] data keys: {dk}")
        oc_inner = oc_resp["data"].get("oc")
        if isinstance(oc_inner, dict):
            print(f"      [OC] {len(oc_inner)} strikes")

    return oc_resp


def process_option_chain(oc_raw):
    result = {}
    oc_data = oc_raw
    if isinstance(oc_raw, dict) and "data" in oc_raw and isinstance(oc_raw["data"], dict):
        oc_data = oc_raw["data"]

    if not isinstance(oc_data, dict) or "oc" not in oc_data:
        print(f"      [OC] No 'oc' in data. Keys: {list(oc_data.keys()) if isinstance(oc_data, dict) else type(oc_data)}")
        return result

    oc = oc_data["oc"]
    if not isinstance(oc, dict):
        return result

    max_ce = {"strike": None, "oi": 0}
    max_pe = {"strike": None, "oi": 0}
    tot_ce = tot_pe = prev_ce = prev_pe = 0
    count = 0

    for strike_str, sdata in oc.items():
        try:
            strike = float(strike_str)
        except:
            continue
        if not isinstance(sdata, dict):
            continue

        count += 1
        ce = sdata.get("ce") or {}
        pe = sdata.get("pe") or {}

        ce_oi = ce.get("oi") or 0
        pe_oi = pe.get("oi") or 0
        tot_ce += ce_oi
        tot_pe += pe_oi
        prev_ce += (ce.get("previous_oi") or ce.get("prev_oi") or 0)
        prev_pe += (pe.get("previous_oi") or pe.get("prev_oi") or 0)

        if ce_oi > max_ce["oi"]:
            max_ce = {"strike": strike, "oi": ce_oi}
        if pe_oi > max_pe["oi"]:
            max_pe = {"strike": strike, "oi": pe_oi}

    print(f"      [OC] {count} strikes | MaxCE={max_ce['strike']}({max_ce['oi']:,}) MaxPE={max_pe['strike']}({max_pe['oi']:,}) PCR={round(tot_pe/tot_ce,2) if tot_ce else '-'}")

    result.update({
        "maxCEStrike": max_ce["strike"], "maxCEOI": max_ce["oi"],
        "maxPEStrike": max_pe["strike"], "maxPEOI": max_pe["oi"],
        "totalCEOI": tot_ce, "totalPEOI": tot_pe,
        "pcr": round(tot_pe / tot_ce, 3) if tot_ce > 0 else None
    })

    total_prev = prev_ce + prev_pe
    total_curr = tot_ce + tot_pe
    if total_prev > 0:
        result["optOIChg"] = total_curr - total_prev
        result["optOIChgPct"] = round((total_curr - total_prev) / total_prev * 100, 2)

    if isinstance(oc_data, dict) and "last_price" in oc_data:
        result["underlying_ltp"] = oc_data["last_price"]

    return result


# ============================================================
# YAHOO FINANCE
# ============================================================
def fetch_yahoo_history(symbol):
    ys = symbol.replace("_", "-") + ".NS"

    # Try multiple approaches for Yahoo Finance
    attempts = []

    # Approach 1: v8 with crumb + cookie (required since Yahoo auth changes)
    crumb, cookie = _get_yahoo_crumb()
    if crumb:
        url_crumb = f"https://query1.finance.yahoo.com/v8/finance/chart/{ys}?range=3y&interval=1d&crumb={urllib.parse.quote(crumb)}"
        attempts.append(("v8+crumb", url_crumb, cookie))

    # Approach 2: v8 without crumb (works on some networks/regions)
    url_v8 = f"https://query1.finance.yahoo.com/v8/finance/chart/{ys}?range=3y&interval=1d"
    attempts.append(("v8-direct", url_v8, None))

    # Approach 3: query2 endpoint
    url_q2 = f"https://query2.finance.yahoo.com/v8/finance/chart/{ys}?range=3y&interval=1d"
    if crumb:
        url_q2 += f"&crumb={urllib.parse.quote(crumb)}"
    attempts.append(("query2", url_q2, cookie))

    for label, url, ck in attempts:
        try:
            headers = dict(HEADERS_YAHOO)
            if ck:
                headers["Cookie"] = ck
            req = urllib.request.Request(url, headers=headers)
            r = urllib.request.urlopen(req, timeout=15, context=ctx)
            raw = r.read()
            enc = r.headers.get("Content-Encoding", "")
            if "gzip" in enc:
                raw = gzip.decompress(raw)
            data = json.loads(raw)
            if data and data.get("chart", {}).get("result"):
                print(f"    [Yahoo] Success via {label}")
                return data
            else:
                print(f"    [Yahoo] {label}: empty response")
        except urllib.error.HTTPError as e:
            print(f"    [Yahoo] {label}: HTTP {e.code}")
        except Exception as e:
            print(f"    [Yahoo] {label}: {e}")

    print(f"    [Yahoo] All approaches failed for {symbol}")
    return None


# ============================================================
# OI SNAPSHOT STORAGE (for 5-day & since-expiry positioning)
# ============================================================
OI_SNAPSHOT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".oi_snapshots.json")

def load_oi_snapshots():
    try:
        if os.path.exists(OI_SNAPSHOT_FILE):
            with open(OI_SNAPSHOT_FILE, "r") as f:
                return json.load(f)
    except: pass
    return {}

def save_oi_snapshot(symbol, oi_value, price):
    """Save today's OI snapshot for a symbol."""
    today = datetime.now().strftime("%Y-%m-%d")
    data = load_oi_snapshots()
    if symbol not in data:
        data[symbol] = {}
    data[symbol][today] = {"oi": oi_value, "price": price}
    # Keep only last 60 days
    if len(data[symbol]) > 60:
        dates = sorted(data[symbol].keys())
        for d in dates[:-60]:
            del data[symbol][d]
    try:
        with open(OI_SNAPSHOT_FILE, "w") as f:
            json.dump(data, f)
    except: pass

def get_oi_snapshot(symbol, days_ago):
    """Get OI snapshot from N days ago."""
    data = load_oi_snapshots()
    if symbol not in data:
        return None
    dates = sorted(data[symbol].keys(), reverse=True)
    # Find the date closest to N trading days ago
    target = (datetime.now() - timedelta(days=days_ago)).strftime("%Y-%m-%d")
    # Find closest date <= target
    for d in dates:
        if d <= target:
            return data[symbol][d]
    return None


# ============================================================
# EXPIRY DATE CALCULATION
# ============================================================
def get_previous_expiry():
    """Get last Thursday of previous month (F&O expiry)."""
    today = datetime.now()
    # Go to first day of current month
    first_of_month = today.replace(day=1)
    # Go to last day of previous month
    last_of_prev = first_of_month - timedelta(days=1)
    # Find last Thursday of that month
    # weekday(): Mon=0, Tue=1, Wed=2, Thu=3
    day = last_of_prev
    while day.weekday() != 3:  # Thursday
        day -= timedelta(days=1)
    return day.strftime("%Y-%m-%d")


# ============================================================
# INDEX DATA CACHE (CNX500 for RS, Sector indices for Alpha)
# ============================================================
index_cache = {}  # ticker -> {"closes": [...], "timestamps": [...], "ts": epoch}

# Sector category -> NSE sector index Yahoo ticker(s)
SECTOR_INDEX_MAP = {
    "IT":                 ["^CNXIT", "NIFTYIT.NS"],
    "Fin Ser-Private Bank": ["^NSEBANK", "BANKNIFTY.NS"],
    "Fin Ser-PSU Bank":   ["^NSEBANK", "BANKNIFTY.NS"],
    "Fin Ser":            ["^CNXFINANCE", "NIFTYFINSERVICE.NS"],
    "Fin Ser-NBFC":       ["^CNXFINANCE", "NIFTYFINSERVICE.NS"],
    "Fin Ser-Insurance":  ["^CNXFINANCE", "NIFTYFINSERVICE.NS"],
    "Fin Ser-Exchange":   ["^CNXFINANCE", "NIFTYFINSERVICE.NS"],
    "Healthcare":         ["^CNXPHARMA", "NIFTYPHARMA.NS"],
    "Automobile":         ["^CNXAUTO", "NIFTYAUTO.NS"],
    "Auto Components":    ["^CNXAUTO", "NIFTYAUTO.NS"],
    "Metals & Mining":    ["^CNXMETAL", "NIFTYMETAL.NS"],
    "FMCG":               ["^CNXFMCG", "NIFTYFMCG.NS"],
    "Realty":             ["NIFTYREALTY.NS", "^CNXREALTY"],
    "Oil Gas & Fuels":    ["^CNXENERGY", "NIFTYENERGY.NS"],
    "Power":              ["^CNXENERGY", "NIFTYENERGY.NS"],
    "Construction":       ["^CNXINFRA", "NIFTYINFRA.NS"],
    "Capital Goods":      ["^CNXINFRA", "NIFTYINFRA.NS"],
    "Cement":             ["^CNXINFRA", "NIFTYINFRA.NS"],
    "Chemicals":          ["^CRSLDX", "NIFTY500.NS"],
    "Telecomm":           ["^CRSLDX", "NIFTY500.NS"],
    "Services":           ["^CRSLDX", "NIFTY500.NS"],
    "Consumer Durables":  ["^CNXCONSUMPTION", "NIFTY500.NS"],
    "Consumer Services":  ["^CNXCONSUMPTION", "NIFTY500.NS"],
    "Textiles":           ["^CRSLDX", "NIFTY500.NS"],
}

def fetch_index_history(tickers):
    """Fetch 1-year daily history for an index. Tries multiple tickers with crumb auth."""
    if isinstance(tickers, str):
        tickers = [tickers]

    for ticker in tickers:
        # Check cache (1 hour)
        if ticker in index_cache and (time.time() - index_cache[ticker]["ts"]) < 3600:
            return index_cache[ticker]

        # Use same crumb/cookie approach as fetch_yahoo_history
        crumb, cookie = _get_yahoo_crumb()
        attempts = []
        if crumb:
            attempts.append(("v8+crumb", f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?range=1y&interval=1d&crumb={urllib.parse.quote(crumb)}", cookie))
        attempts.append(("v8-direct", f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?range=1y&interval=1d", None))
        if crumb:
            attempts.append(("query2", f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?range=1y&interval=1d&crumb={urllib.parse.quote(crumb)}", cookie))

        for label, url, ck in attempts:
            try:
                headers = dict(HEADERS_YAHOO)
                if ck:
                    headers["Cookie"] = ck
                req = urllib.request.Request(url, headers=headers)
                r = urllib.request.urlopen(req, timeout=15, context=ctx)
                raw = r.read()
                enc = r.headers.get("Content-Encoding", "")
                if "gzip" in enc:
                    raw = gzip.decompress(raw)
                data = json.loads(raw)
                if data.get("chart", {}).get("result"):
                    result = data["chart"]["result"][0]
                    q = result.get("indicators", {}).get("quote", [{}])[0]
                    closes = q.get("close") or []
                    timestamps = result.get("timestamp") or []
                    valid_closes = [c for c in closes if c is not None]
                    if len(valid_closes) > 30:
                        cached = {"closes": closes, "timestamps": timestamps, "ts": time.time(), "ticker": ticker}
                        index_cache[ticker] = cached
                        print(f"    [INDEX] Loaded {len(valid_closes)} days from {ticker} via {label}")
                        return cached
            except urllib.error.HTTPError as e:
                print(f"    [INDEX] {ticker} {label}: HTTP {e.code}")
            except Exception as e:
                print(f"    [INDEX] {ticker} {label}: {e}")
    return None

def fetch_cnx500_history():
    """Fetch Nifty 500 (or Nifty 50 as proxy) for RS calculation.
    Returns dict with 'closes' and 'timestamps'."""
    # Try CNX500 tickers first, then fall back to Nifty 50
    result = fetch_index_history(["^CRSLDX", "^CNX500", "^NSEI", "^NIFTY"])
    if result:
        return result
    return None

def get_sector_for_symbol(symbol):
    """Get sector category for a stock from the F&O list."""
    # FO list is in HTML, but we have the mapping here too
    FO_SECTORS = {
        "RELIANCE": "Oil Gas & Fuels", "TCS": "IT", "INFY": "IT", "HDFCBANK": "Fin Ser-Private Bank",
        "ICICIBANK": "Fin Ser-Private Bank", "BHARTIARTL": "Telecomm", "SBIN": "Fin Ser-PSU Bank",
        "ITC": "FMCG", "HINDUNILVR": "FMCG", "KOTAKBANK": "Fin Ser-Private Bank",
        "LT": "Construction", "AXISBANK": "Fin Ser-Private Bank", "BAJFINANCE": "Fin Ser-NBFC",
        "TATAMOTORS": "Automobile", "MARUTI": "Automobile", "SUNPHARMA": "Healthcare",
        "TITAN": "Consumer Durables", "WIPRO": "IT", "HCLTECH": "IT", "TATASTEEL": "Metals & Mining",
        "ADANIENT": "Metals & Mining", "NTPC": "Power", "POWERGRID": "Power", "COALINDIA": "Metals & Mining",
        "ONGC": "Oil Gas & Fuels", "JSWSTEEL": "Metals & Mining", "HINDALCO": "Metals & Mining",
        "DRREDDY": "Healthcare", "CIPLA": "Healthcare", "DIVISLAB": "Healthcare",
        "BAJAJFINSV": "Fin Ser-NBFC", "BAJAJ_AUTO": "Automobile", "EICHERMOT": "Automobile",
        "HEROMOTOCO": "Automobile", "ASIANPAINT": "Consumer Durables", "NESTLEIND": "FMCG",
        "BRITANNIA": "FMCG", "INDIGO": "Services", "BPCL": "Oil Gas & Fuels",
        "GRASIM": "Cement", "ULTRACEMCO": "Cement", "DLF": "Realty", "GODREJPROP": "Realty",
        "TECHM": "IT", "LTIM": "IT", "PERSISTENT": "IT", "COFORGE": "IT", "MPHASIS": "IT",
        "NAUKRI": "IT", "TATAELXSI": "IT", "LTTS": "IT", "BSOFT": "IT", "KPITTECH": "IT",
        "BANKBARODA": "Fin Ser-PSU Bank", "PNB": "Fin Ser-PSU Bank", "CANBK": "Fin Ser-PSU Bank",
        "FEDERALBNK": "Fin Ser-Private Bank", "INDUSINDBK": "Fin Ser-Private Bank",
        "BANDHANBNK": "Fin Ser-Private Bank", "AUBANK": "Fin Ser-Private Bank",
        "CHOLAFIN": "Fin Ser-NBFC", "SHRIRAMFIN": "Fin Ser-NBFC", "M_MFIN": "Fin Ser-NBFC",
        "HDFCLIFE": "Fin Ser-Insurance", "SBILIFE": "Fin Ser-Insurance", "ICICIGI": "Fin Ser-Insurance",
        "HAL": "Capital Goods", "BEL": "Capital Goods", "SIEMENS": "Capital Goods",
        "TATAPOWER": "Power", "ADANIGREEN": "Power", "ADANIPORTS": "Services",
        "ZOMATO": "Consumer Services", "TRENT": "Consumer Services", "POLYCAB": "Consumer Durables",
        "DIXON": "Consumer Durables", "VOLTAS": "Consumer Durables", "HAVELLS": "Consumer Durables",
        "PIDILITIND": "Chemicals", "SRF": "Chemicals", "DEEPAKNTR": "Chemicals", "UPL": "Chemicals",
        "ACC": "Cement", "AMBUJACEM": "Cement", "SHREECEM": "Cement", "DALBHARAT": "Cement",
        "VEDL": "Metals & Mining", "SAIL": "Metals & Mining", "JINDALSTEL": "Metals & Mining",
        "HINDPETRO": "Oil Gas & Fuels", "IOC": "Oil Gas & Fuels", "GAIL": "Oil Gas & Fuels",
        "LUPIN": "Healthcare", "AUROPHARMA": "Healthcare", "BIOCON": "Healthcare",
        "APOLLOHOSP": "Healthcare", "TORNTPHARM": "Healthcare",
        "MARICO": "FMCG", "DABUR": "FMCG", "COLPAL": "FMCG", "GODREJCP": "FMCG",
        "M_M": "Automobile", "ASHOKLEY": "Automobile", "TVSMOTOR": "Automobile", "ESCORTS": "Automobile",
        "INDUSTOWER": "Telecomm", "IDEA": "Telecomm",
        "OBEROIRLTY": "Realty", "PRESTIGE": "Realty",
        "IRCTC": "Services", "CONCOR": "Services", "DELHIVERY": "Services",
        "MCX": "Fin Ser-Exchange", "BSE": "Fin Ser-Exchange", "CDSL": "Fin Ser",
        "JIOFIN": "Fin Ser", "PAYTM": "Fin Ser",
        "JUBLFOOD": "Consumer Services", "INDHOTEL": "Consumer Services", "ZEEL": "Consumer Services",
        "BOSCHLTD": "Auto Components", "MOTHERSON": "Auto Components", "MRF": "Auto Components",
        "360ONE": "Fin Ser", "AARTIIND": "Chemicals", "ABB": "Capital Goods", "ABCAPITAL": "Fin Ser-NBFC",
        "ABFRL": "Consumer Services", "ADANIENSOL": "Power", "ALKEM": "Healthcare", "AMBER": "Consumer Durables",
        "ANGELONE": "Fin Ser", "APLAPOLLO": "Metals & Mining", "ASTRAL": "Capital Goods", "ATGL": "Oil Gas & Fuels",
        "BALKRISIND": "Auto Components", "BATAINDIA": "Consumer Durables", "BERGEPAINT": "Consumer Durables",
        "BHARATFORG": "Auto Components", "BHEL": "Capital Goods", "CAMS": "Fin Ser", "CHAMBLFERT": "Chemicals",
        "COROMANDEL": "Chemicals", "CROMPTON": "Consumer Durables", "CUB": "Fin Ser-Private Bank", "CUMMINSIND": "Capital Goods",
        "CYIENT": "IT", "DEVYANI": "Consumer Services", "EXIDEIND": "Auto Components", "GLENMARK": "Healthcare",
        "GMRAIRPORT": "Services", "GNFC": "Chemicals", "GRANULES": "Healthcare", "GUJGASLTD": "Oil Gas & Fuels",
        "HDFCAMC": "Fin Ser", "HINDCOPPER": "Metals & Mining", "HUDCO": "Fin Ser-NBFC", "ICICIPRULI": "Fin Ser-Insurance",
        "IDFC": "Fin Ser-Private Bank", "IEX": "Fin Ser-Exchange", "IGL": "Oil Gas & Fuels", "INDIAMART": "IT",
        "INDIANB": "Fin Ser-PSU Bank", "IPCALAB": "Healthcare", "IRFC": "Fin Ser-NBFC", "JKCEMENT": "Cement",
        "JSL": "Metals & Mining", "JSWENERGY": "Power", "KALYANKJIL": "Consumer Durables", "KEI": "Capital Goods",
        "LALPATHLAB": "Healthcare", "LAURUSLABS": "Healthcare", "LICHSGFIN": "Fin Ser-NBFC", "MANAPPURAM": "Fin Ser-NBFC",
        "MCDOWELL_N": "FMCG", "METROPOLIS": "Healthcare", "MFSL": "Fin Ser-NBFC", "MGL": "Oil Gas & Fuels",
        "MUTHOOTFIN": "Fin Ser-NBFC", "NATIONALUM": "Metals & Mining", "NAVINFLUOR": "Chemicals", "NHPC": "Power",
        "NMDC": "Metals & Mining", "OFSS": "IT", "OIL": "Oil Gas & Fuels", "PAGEIND": "Textiles",
        "PATANJALI": "FMCG", "PEL": "Fin Ser-NBFC", "PETRONET": "Oil Gas & Fuels", "PFC": "Fin Ser-NBFC",
        "PIIND": "Chemicals", "POONAWALLA": "Fin Ser-NBFC", "PVRINOX": "Consumer Services", "RAMCOCEM": "Cement",
        "RBLBANK": "Fin Ser-Private Bank", "RECLTD": "Fin Ser-NBFC", "SBICARD": "Fin Ser", "SJVN": "Power",
        "SONACOMS": "Auto Components", "STAR": "Consumer Services", "SUNTV": "Consumer Services", "SUPREMEIND": "Capital Goods",
        "SYNGENE": "Healthcare", "TATACHEM": "Chemicals", "TATACOMM": "Telecomm", "TATACONSUM": "FMCG",
        "TIINDIA": "Auto Components", "TORNTPOWER": "Power", "UBL": "FMCG", "UNIONBANK": "Fin Ser-PSU Bank",
        "UNITDSPR": "FMCG", "UNOMINDA": "Auto Components", "ZYDUSLIFE": "Healthcare",
    }
    return FO_SECTORS.get(symbol, None)


# ============================================================
# NEW METRIC CALCULATIONS
# ============================================================
def calc_adr_pct(highs, lows, closes, period=50):
    """Average Daily Range % over N days = avg((H-L)/C × 100)."""
    n = min(len(highs), len(lows), len(closes), period)
    if n < 5:
        return None
    ranges = []
    for i in range(-n, 0):
        if closes[i] and closes[i] > 0 and highs[i] and lows[i]:
            ranges.append((highs[i] - lows[i]) / closes[i] * 100)
    return round(sum(ranges) / len(ranges), 2) if ranges else None


def calc_burst_power(closes, period=None):
    """Burst Power (Pine Script formula):
    Count daily moves >= 5%, >= 10%, >= 19% over lookback period.
    Power = (count_5 / 5) + (count_10 / 2) + (count_19 / 0.5)
    Default lookback = all available data (up to 1 year from Yahoo).
    """
    if len(closes) < 20:
        return None
    # Use all available data if no period specified (mimics 3-year lookback with 1yr data)
    if period:
        subset = closes[-period:] if len(closes) >= period else closes
    else:
        subset = closes
    count_5 = 0
    count_10 = 0
    count_19 = 0
    for i in range(1, len(subset)):
        prev = subset[i - 1]
        if prev <= 0:
            continue
        pct_move = abs((subset[i] - prev) / prev) * 100
        if pct_move >= 19:
            count_19 += 1
        elif pct_move >= 10:
            count_10 += 1
        elif pct_move >= 5:
            count_5 += 1
    power = (count_5 / 5) + (count_10 / 2) + (count_19 / 0.5)
    print(f"    [BURST] {len(subset)} days: >=5%={count_5}, >=10%={count_10}, >=19%={count_19} → Power={round(power, 1)}")
    return round(power, 1)


def calc_purple_dots(closes, volumes, period=125, pct_threshold=5, vol_threshold=1000000):
    """Purple Dots: count days where |daily % change| >= 5% AND volume >= 10 lakh.
    period=125 ~ 6 months of trading days.
    Returns (count, list of {date_idx, pct_move, volume} for details).
    """
    if len(closes) < 2 or len(volumes) < 2:
        return 0
    n = min(len(closes), len(volumes))
    start = max(1, n - period)
    count = 0
    for i in range(start, n):
        prev = closes[i - 1]
        if prev <= 0:
            continue
        pct_move = abs((closes[i] - prev) / prev) * 100
        if pct_move >= pct_threshold and volumes[i] >= vol_threshold:
            count += 1
    return count


def _sma(data, period, idx):
    """Simple moving average ending at index idx (inclusive), looking back 'period' bars."""
    if idx < period - 1:
        return None
    return sum(data[idx - period + 1:idx + 1]) / period


def _atr(highs, lows, closes, period, idx):
    """Average True Range at index idx over 'period' bars."""
    if idx < 1 or idx < period:
        return None
    tr_vals = []
    start = max(1, idx - period + 1)
    for i in range(start, idx + 1):
        h, l, pc = highs[i], lows[i], closes[i - 1]
        if h is None or l is None or pc is None:
            continue
        tr = max(h - l, abs(h - pc), abs(l - pc))
        tr_vals.append(tr)
    if len(tr_vals) < period:
        return None
    return sum(tr_vals[-period:]) / period


def _stochastic(closes, highs, lows, period, idx):
    """%K stochastic at index idx."""
    if idx < period - 1:
        return None
    hh = max(h for h in highs[idx - period + 1:idx + 1] if h is not None)
    ll = min(l for l in lows[idx - period + 1:idx + 1] if l is not None)
    if hh == ll:
        return 50.0
    return ((closes[idx] - ll) / (hh - ll)) * 100


def _calc_ema_series(data, period):
    """Calculate full EMA series for all data points. Returns list of same length as data."""
    if len(data) < period:
        return [None] * len(data)
    result = [None] * (period - 1)
    mult = 2 / (period + 1)
    ema = sum(data[:period]) / period
    result.append(ema)
    for i in range(period, len(data)):
        ema = (data[i] - ema) * mult + ema
        result.append(ema)
    return result


def _find_anchor_and_contractions(closes, lows, highs, ema50_series, end_idx, lookback_months=6):
    """
    VCP Detection — Mr. Market Rulebook:
    1. ANCHOR = Last upside move of >= 20% (most recent qualifying rally)
    2. CONTRACTIONS = After the anchor peak (T0), every time price touches or
       undercuts the 50 EMA is counted as a contraction (T1, T2, etc.)
    3. Depth of each contraction = how far below the prior swing high it went

    Returns:
      anchor: {origin_idx, peak_idx, advance_pct} or None
      contractions: [{touch_idx, depth_pct, low_price, high_before}, ...]
    """
    lookback = min(end_idx, lookback_months * 21)
    if lookback < 20:
        return None, []

    start_scan = max(0, end_idx - lookback)

    # --- STEP 1: Find the MOST RECENT 20%+ rally ---
    # Scan backward from current bar to find the latest qualifying anchor
    best_anchor = None

    for i in range(end_idx - 10, start_scan - 1, -1):
        if i < 1:
            continue
        base_price = lows[i]
        if base_price <= 0:
            continue

        # Find the highest point reached after this low (within 90 bars or till end)
        peak_price = base_price
        peak_idx = i
        for j in range(i + 1, min(i + 90, end_idx + 1)):
            if highs[j] > peak_price:
                peak_price = highs[j]
                peak_idx = j

        advance_pct = (peak_price - base_price) / base_price * 100
        if advance_pct >= 20:
            best_anchor = {"origin_idx": i, "peak_idx": peak_idx, "advance_pct": round(advance_pct, 1)}
            break  # Most recent anchor found

    if not best_anchor:
        return None, []

    # --- STEP 2: After anchor peak (T0), detect 50 EMA touches/undercuts ---
    t0_idx = best_anchor["peak_idx"]
    contractions = []

    if t0_idx >= end_idx - 3:
        return best_anchor, []

    # Track the highest high since T0 or last contraction
    current_high = highs[t0_idx]
    in_contraction = False
    contraction_low = None
    contraction_low_idx = None

    for i in range(t0_idx + 1, end_idx + 1):
        ema50_val = ema50_series[i] if i < len(ema50_series) else None
        if ema50_val is None:
            continue

        # Update running high
        if highs[i] > current_high:
            current_high = highs[i]

        # Check if price touches or undercuts 50 EMA (within 1% counts as touch)
        touches_ema = lows[i] <= ema50_val * 1.01

        if touches_ema and not in_contraction:
            in_contraction = True
            contraction_low = lows[i]
            contraction_low_idx = i
        elif touches_ema and in_contraction:
            if lows[i] < contraction_low:
                contraction_low = lows[i]
                contraction_low_idx = i
        elif not touches_ema and in_contraction:
            # Price bounced off 50 EMA — contraction complete
            if current_high > 0 and contraction_low is not None:
                depth = round((current_high - contraction_low) / current_high * 100, 1)
                contractions.append({
                    "touch_idx": contraction_low_idx,
                    "depth": depth,
                    "low": round(contraction_low, 2),
                    "high_before": round(current_high, 2),
                })
            in_contraction = False
            current_high = highs[i]
            contraction_low = None

    # If still in contraction at end, record it
    if in_contraction and contraction_low is not None and current_high > 0:
        depth = round((current_high - contraction_low) / current_high * 100, 1)
        contractions.append({
            "touch_idx": contraction_low_idx,
            "depth": depth,
            "low": round(contraction_low, 2),
            "high_before": round(current_high, 2),
        })

    return best_anchor, contractions


def calc_vcp(closes, highs, lows, volumes, timestamps, index_data=None):
    """VCP (Volatility Contraction Pattern) — Mr. Market Rulebook.

    CORE LOGIC:
    1. ANCHOR = Last upside >= 20% (most recent qualifying rally)
    2. CONTRACTIONS = After anchor peak (T0), each 50 EMA touch/undercut = one T
    3. Max 4-T hard limit (T5+ = EXHAUSTED, no trade)
    4. Trend Template (8 pillars) + Stage 2 EMA check
    5. Volume Dry-Up + ATR contraction
    6. VCP Footprint: "12W 30/15/8/3 4T"
    """
    n = len(closes)
    min_bars = 200
    if n < min_bars or len(highs) < min_bars or len(lows) < min_bars or len(volumes) < min_bars:
        return {"active": False, "stage": "Insufficient Data", "conditions": {},
                "trendTemplate": {}, "contractions": [], "insufficient": True}

    idx = n - 1
    price = closes[idx]

    # ================================================================
    # A) TREND TEMPLATE — Minervini's 8 Pillars
    # ================================================================
    sma_50 = _sma(closes, 50, idx)
    sma_150 = _sma(closes, 150, idx) if n >= 150 else None
    sma_200 = _sma(closes, 200, idx)

    tt1_price_above_long = (price > sma_150 and price > sma_200) if sma_150 and sma_200 else False
    tt2_150_above_200 = (sma_150 > sma_200) if sma_150 and sma_200 else False

    tt3_200_slope_up = False
    if sma_200 and n > 220:
        slope_up = sum(1 for d in range(20) if idx - d - 1 >= 199 and
                       _sma(closes, 200, idx - d) and _sma(closes, 200, idx - d - 1) and
                       _sma(closes, 200, idx - d) > _sma(closes, 200, idx - d - 1))
        tt3_200_slope_up = slope_up >= 15

    tt4_acceleration = (sma_50 > sma_150 and sma_50 > sma_200) if sma_50 and sma_150 and sma_200 else False
    tt5_above_50 = (price > sma_50) if sma_50 else False

    low_52w = min(lows[max(0, idx - 251):idx + 1])
    tt6_recovery = ((price - low_52w) / low_52w * 100 >= 30) if low_52w and low_52w > 0 else False

    high_52w = max(highs[max(0, idx - 251):idx + 1])
    tt7_near_high = ((high_52w - price) / high_52w * 100 <= 25) if high_52w and high_52w > 0 else False

    # Stage 2: Price > 50 EMA > 200 EMA
    ema50_series = _calc_ema_series(closes, 50)
    ema200_series = _calc_ema_series(closes, 200)
    ema_50_val = ema50_series[idx] if idx < len(ema50_series) else None
    ema_200_val = ema200_series[idx] if idx < len(ema200_series) else None
    stage2_confirmed = (price > ema_50_val > ema_200_val) if ema_50_val and ema_200_val else False

    # RS Spread
    tt8_rs = False
    rs_spread = None
    if index_data:
        idx_cl = index_data.get("closes", [])
        idx_ts = index_data.get("timestamps", [])
        if len(idx_cl) > 210 and n > 210:
            idx_by_date = {int(t) // 86400: idx_cl[i] for i, t in enumerate(idx_ts) if idx_cl[i] and idx_cl[i] > 0}
            d_now = int(timestamps[idx]) // 86400
            d_210 = int(timestamps[idx - 210]) // 86400
            idx_now = idx_by_date.get(d_now) or idx_by_date.get(d_now - 1) or idx_by_date.get(d_now + 1)
            idx_210 = idx_by_date.get(d_210) or idx_by_date.get(d_210 - 1) or idx_by_date.get(d_210 + 1)
            stk_210 = closes[idx - 210]
            if stk_210 and stk_210 > 0 and idx_now and idx_210 and idx_210 > 0:
                rs_spread = round(100 * (price - stk_210) / stk_210 - 100 * (idx_now - idx_210) / idx_210, 2)
                tt8_rs = rs_spread > 0

    trend_template = {
        "priceAbove150_200": tt1_price_above_long, "ma150Above200": tt2_150_above_200,
        "ma200SlopeUp": tt3_200_slope_up, "ma50Above150_200": tt4_acceleration,
        "priceAbove50": tt5_above_50, "above30PctFrom52wLow": tt6_recovery,
        "within25PctOf52wHigh": tt7_near_high, "rsOutperforming": tt8_rs,
    }
    tt_passed = sum(1 for v in trend_template.values() if v)
    tt_total = len(trend_template)
    trend_template_ok = tt_passed >= 6

    # ================================================================
    # PHASE 1: ANCHOR — Last 20%+ upside move
    # ================================================================
    anchor, contractions_raw = _find_anchor_and_contractions(closes, lows, highs, ema50_series, idx, lookback_months=6)
    has_anchor = anchor is not None
    origin_pct = anchor["advance_pct"] if anchor else 0

    # ================================================================
    # PHASE 2: CONTRACTIONS — 50 EMA touches/undercuts after anchor
    # ================================================================
    contraction_details = []
    for i, c in enumerate(contractions_raw):
        contraction_details.append({"t": i + 1, "depth": c["depth"]})

    t_count = len(contractions_raw)
    too_many = t_count >= 5
    t_count_valid = 2 <= t_count <= 4
    has_contractions = t_count >= 2

    # Check depth reduction (each contraction shallower than previous)
    depths_decreasing = all(contractions_raw[i]["depth"] < contractions_raw[i-1]["depth"]
                           for i in range(1, len(contractions_raw))) if len(contractions_raw) >= 2 else False

    final_tight = contractions_raw[-1]["depth"] <= 8 if contractions_raw else False

    # Base metrics
    if anchor:
        base_start = anchor["peak_idx"]
        base_lookback = idx - base_start
    else:
        base_lookback = min(90, idx - 200)
        base_start = idx - base_lookback

    base_high = max(highs[max(0, base_start):idx + 1])
    base_low = min(lows[max(0, base_start):idx + 1])
    base_depth_pct = round((base_high - base_low) / base_high * 100, 1) if base_high > 0 else 0
    base_within_range = base_depth_pct <= 35
    base_weeks = round(base_lookback / 5, 0)

    # Footprint: "12W 30/15/8/3 4T"
    depth_str = "/".join([str(int(c["depth"])) for c in contractions_raw[-4:]]) if contractions_raw else "N/A"
    footprint = f"{int(base_weeks)}W {depth_str} {t_count}T"

    # ================================================================
    # PHASE 3: VOLUME & VDU
    # ================================================================
    avg_vol_50 = sum(volumes[max(0, idx - 49):idx + 1]) / min(50, idx + 1)
    recent_vol_3d = volumes[max(0, idx - 2):idx + 1]
    min_recent_vol = min(recent_vol_3d) if recent_vol_3d else 0
    vdu_active = (min_recent_vol <= avg_vol_50 * 0.50) if avg_vol_50 > 0 else False
    vdu_ratio = round(min_recent_vol / avg_vol_50 * 100, 1) if avg_vol_50 > 0 else None

    half = max(1, base_lookback // 2)
    if half > 5 and base_start + half < idx:
        vol_declining = sum(volumes[base_start:base_start + half]) / half > sum(volumes[base_start + half:idx + 1]) / max(1, base_lookback - half)
    else:
        vol_declining = False

    avg_vol_2 = sum(volumes[max(0, idx - 1):idx + 1]) / 2 if idx >= 1 else volumes[idx]
    avg_vol_10 = sum(volumes[max(0, idx - 9):idx + 1]) / min(10, idx + 1)
    avg_vol_40 = sum(volumes[max(0, idx - 39):idx + 1]) / min(40, idx + 1)
    vol_contraction = avg_vol_2 < avg_vol_10 < avg_vol_40

    # ================================================================
    # ATR% CONTRACTION
    # ================================================================
    atr_2 = _atr(highs, lows, closes, 2, idx)
    atr_10 = _atr(highs, lows, closes, 10, idx)
    atr_30 = _atr(highs, lows, closes, 30, idx)
    s2, s10, s30 = _sma(closes, 2, idx), _sma(closes, 10, idx), _sma(closes, 30, idx)
    atr_pct_2 = (atr_2 / s2 * 100) if atr_2 and s2 and s2 > 0 else None
    atr_pct_10 = (atr_10 / s10 * 100) if atr_10 and s10 and s10 > 0 else None
    atr_pct_30 = (atr_30 / s30 * 100) if atr_30 and s30 and s30 > 0 else None
    atr_contracting = (atr_pct_2 < atr_pct_10 < atr_pct_30) if atr_pct_2 and atr_pct_10 and atr_pct_30 else False

    # ================================================================
    # PIVOT & STOP-LOSS
    # ================================================================
    pivot_price = round(contractions_raw[-1]["high_before"], 2) if contractions_raw else None
    dist_from_pivot = round((price - pivot_price) / pivot_price * 100, 2) if pivot_price and pivot_price > 0 else None
    stop_loss = round(contractions_raw[-1]["low"], 2) if contractions_raw else None
    risk_pct = round((pivot_price - stop_loss) / pivot_price * 100, 2) if pivot_price and stop_loss and pivot_price > 0 else None

    # ================================================================
    # COMPOSITE SCORING & VERDICT
    # ================================================================
    conditions = {
        "trendTemplate": trend_template_ok, "stage2Confirmed": stage2_confirmed,
        "momentumAnchor": has_anchor, "contractions": has_contractions,
        "tCountValid": t_count_valid, "depthReduction": depths_decreasing,
        "finalTight": final_tight, "baseWithinRange": base_within_range,
        "vduActive": vdu_active, "volDeclining": vol_declining,
        "volContraction": vol_contraction, "atrContracting": atr_contracting,
        "rsOutperforming": tt8_rs,
    }
    passed = sum(1 for v in conditions.values() if v)
    total = len(conditions)

    if too_many:
        stage, verdict = "EXHAUSTED", "NO TRADE"
    elif passed >= 11 and trend_template_ok and depths_decreasing and has_anchor and stage2_confirmed:
        stage, verdict = "ACTIVE", "GO"
    elif passed >= 8 and trend_template_ok and has_anchor:
        stage, verdict = "FORMING", "WATCH"
    elif tt_passed >= 5 and has_anchor:
        stage, verdict = "EARLY BASE", "WATCH"
    elif not has_anchor:
        stage, verdict = "NO ANCHOR", "NO TRADE"
    else:
        stage, verdict = "NO SETUP", "NO TRADE"

    stoch_10 = _stochastic(closes, highs, lows, 10, idx)
    stoch_20 = _stochastic(closes, highs, lows, 20, idx)

    print(f"    [VCP] {stage} ({verdict}) | TT={tt_passed}/{tt_total} | Score={passed}/{total} | "
          f"Anchor={'Y(+'+str(origin_pct)+'%)' if has_anchor else 'N'} | "
          f"T-count={t_count} (50EMA touches) | Depths={[c['depth'] for c in contractions_raw[-5:]]} | "
          f"VDU={'Y' if vdu_active else 'N'} | Stage2={'Y' if stage2_confirmed else 'N'} | "
          f"Footprint={footprint}")

    return {
        "active": stage == "ACTIVE", "stage": stage, "verdict": verdict,
        "passed": passed, "total": total, "footprint": footprint,
        "trendTemplate": trend_template, "ttPassed": tt_passed, "ttTotal": tt_total,
        "stage2Confirmed": stage2_confirmed,
        "momentumAnchor": has_anchor, "originAdvancePct": origin_pct,
        "tCount": t_count, "tCountValid": t_count_valid, "tooManyContractions": too_many,
        "contractions": contraction_details[-5:],
        "baseDepth": base_depth_pct, "baseDays": base_lookback, "baseWeeks": int(base_weeks),
        "finalTightDepth": contractions_raw[-1]["depth"] if contractions_raw else None,
        "depthReduction": depths_decreasing,
        "vduActive": vdu_active, "vduRatio": vdu_ratio,
        "volDeclining": vol_declining, "volContraction": vol_contraction,
        "atrContracting": atr_contracting,
        "atrPct2": round(atr_pct_2, 2) if atr_pct_2 else None,
        "atrPct10": round(atr_pct_10, 2) if atr_pct_10 else None,
        "atrPct30": round(atr_pct_30, 2) if atr_pct_30 else None,
        "rsSpread": rs_spread,
        "pivotPrice": pivot_price, "distFromPivot": dist_from_pivot,
        "stopLoss": stop_loss, "riskPct": risk_pct,
        "stoch10": round(stoch_10, 1) if stoch_10 else None,
        "stoch20": round(stoch_20, 1) if stoch_20 else None,
        "conditions": conditions, "insufficient": False,
    }


def calc_volume_usd(volume, close_price, usd_inr=83.5):
    """Daily turnover in USD millions."""
    if not volume or not close_price:
        return None
    turnover_inr = volume * close_price
    turnover_cr = turnover_inr / 1e7  # INR Crores
    turnover_usd_m = turnover_inr / (usd_inr * 1e6)  # USD Millions
    return {
        "turnoverCr": round(turnover_cr, 1),
        "turnoverUsdM": round(turnover_usd_m, 1)
    }


def calc_mansfield_rs(stock_closes, stock_timestamps, index_data, period_days=30):
    """Mansfield Relative Strength using timestamp-aligned data.
    RS line = Stock Price / Index Price (daily).
    Mansfield RS = (RS today / SMA(RS, N days) - 1) * 100.
    Positive = outperforming benchmark, Negative = underperforming.
    Returns (mansfield_value, raw_ratio)."""
    if not stock_closes or not stock_timestamps or not index_data:
        return None, None

    idx_closes = index_data.get("closes", [])
    idx_ts = index_data.get("timestamps", [])
    if not idx_closes or not idx_ts:
        return None, None

    # Build date-keyed lookup for index (day granularity)
    idx_by_date = {}
    for i, t in enumerate(idx_ts):
        if idx_closes[i] is not None and idx_closes[i] > 0:
            d = int(t) // 86400  # day key
            idx_by_date[d] = idx_closes[i]

    # Build RS ratio series aligned by date
    rs_series = []
    for i, t in enumerate(stock_timestamps):
        if stock_closes[i] is None or stock_closes[i] <= 0:
            continue
        d = int(t) // 86400
        # Try exact day, then +/- 1 day for timezone differences
        idx_val = idx_by_date.get(d) or idx_by_date.get(d - 1) or idx_by_date.get(d + 1)
        if idx_val:
            rs_series.append(stock_closes[i] / idx_val)

    if len(rs_series) < period_days:
        return None, None

    # Current RS
    rs_now = rs_series[-1]

    # SMA of RS over last N days
    rs_window = rs_series[-period_days:]
    rs_sma = sum(rs_window) / len(rs_window)
    if rs_sma <= 0:
        return None, None

    # Mansfield RS = (Current RS / SMA of RS - 1) * 100
    mansfield = round((rs_now / rs_sma - 1) * 100, 2)
    raw_ratio = round(rs_now, 4)

    return mansfield, raw_ratio


def calc_alpha(stock_closes, stock_timestamps, sector_index_data, period_label):
    """Alpha = % Stock change - % Sector Index change over same period.
    period_label: '1d', '5d', 'expiry'
    Returns alpha percentage."""
    if not sector_index_data or not stock_closes:
        return None

    idx_closes = sector_index_data.get("closes") or []
    idx_timestamps = sector_index_data.get("timestamps") or []

    n_stk = len(stock_closes)
    n_idx = len(idx_closes)
    if n_stk < 2 or n_idx < 2:
        return None

    stk_now = stock_closes[-1]
    if not stk_now:
        return None

    if period_label == "1d":
        stk_prev = stock_closes[-2] if n_stk >= 2 else None
        # Find the corresponding index close
        idx_now = idx_closes[-1] if idx_closes else None
        idx_prev = idx_closes[-2] if n_idx >= 2 else None
        # Skip None
        for i in range(len(idx_closes)-1, -1, -1):
            if idx_closes[i] is not None:
                idx_now = idx_closes[i]
                break
        for i in range(len(idx_closes)-2, -1, -1):
            if idx_closes[i] is not None:
                idx_prev = idx_closes[i]
                break

    elif period_label == "5d":
        stk_prev = stock_closes[-6] if n_stk >= 6 else None
        idx_now = None
        for i in range(n_idx-1, -1, -1):
            if idx_closes[i] is not None:
                idx_now = idx_closes[i]
                break
        idx_prev = idx_closes[-6] if n_idx >= 6 else None
        if idx_prev is None and n_idx >= 6:
            for i in range(n_idx-6, max(0, n_idx-10), -1):
                if i < len(idx_closes) and idx_closes[i] is not None:
                    idx_prev = idx_closes[i]
                    break

    elif period_label == "expiry":
        prev_expiry = get_previous_expiry()
        expiry_ts = time.mktime(datetime.strptime(prev_expiry, "%Y-%m-%d").timetuple())
        # Find stock close at expiry
        stk_prev = None
        if stock_timestamps:
            for i, t in enumerate(stock_timestamps):
                if t >= expiry_ts and i < len(stock_closes) and stock_closes[i]:
                    stk_prev = stock_closes[i]
                    break
        # Find index close at expiry
        idx_now = None
        for i in range(n_idx-1, -1, -1):
            if idx_closes[i] is not None:
                idx_now = idx_closes[i]
                break
        idx_prev = None
        if idx_timestamps:
            for i, t in enumerate(idx_timestamps):
                if t >= expiry_ts and i < len(idx_closes) and idx_closes[i]:
                    idx_prev = idx_closes[i]
                    break
    else:
        return None

    if not stk_prev or not idx_now or not idx_prev or stk_prev <= 0 or idx_prev <= 0:
        return None

    stock_pct = (stk_now - stk_prev) / stk_prev * 100
    index_pct = (idx_now - idx_prev) / idx_prev * 100
    alpha = round(stock_pct - index_pct, 2)
    return alpha


def calc_positioning(closes, timestamps, current_oi, symbol):
    """Calculate 1D, 5D, since-expiry positioning."""
    positioning = {}
    n = len(closes)
    cmp = closes[-1] if n > 0 else None

    if not cmp or n < 2:
        return positioning

    # 1-Day
    if n >= 2:
        prev_close = closes[-2]
        if prev_close and prev_close > 0:
            positioning["px1d"] = round((cmp - prev_close) / prev_close * 100, 2)

    # 5-Day
    if n >= 6:
        close_5d = closes[-6]
        if close_5d and close_5d > 0:
            positioning["px5d"] = round((cmp - close_5d) / close_5d * 100, 2)

    # Since Expiry
    prev_expiry = get_previous_expiry()
    if timestamps and len(timestamps) > 0:
        expiry_ts = time.mktime(datetime.strptime(prev_expiry, "%Y-%m-%d").timetuple())
        expiry_close = None
        for i, t in enumerate(timestamps):
            if t >= expiry_ts and i < len(closes) and closes[i]:
                expiry_close = closes[i]
                break
        if expiry_close and expiry_close > 0:
            positioning["pxExpiry"] = round((cmp - expiry_close) / expiry_close * 100, 2)
            positioning["expiryDate"] = prev_expiry

    # OI changes from snapshots
    if current_oi and current_oi > 0:
        # Save today's snapshot
        save_oi_snapshot(symbol, current_oi, cmp)

        # 1-day OI change (try snapshot first)
        snap_1d = get_oi_snapshot(symbol, 1)
        if snap_1d and snap_1d.get("oi") and snap_1d["oi"] > 0:
            positioning["oi1d"] = round((current_oi - snap_1d["oi"]) / snap_1d["oi"] * 100, 2)

        # 5-day OI change
        snap_5d = get_oi_snapshot(symbol, 7)  # 7 calendar days ≈ 5 trading days
        if snap_5d and snap_5d.get("oi") and snap_5d["oi"] > 0:
            positioning["oi5d"] = round((current_oi - snap_5d["oi"]) / snap_5d["oi"] * 100, 2)

        # Since expiry OI change
        snap_exp = get_oi_snapshot(symbol, (datetime.now() - datetime.strptime(prev_expiry, "%Y-%m-%d")).days)
        if snap_exp and snap_exp.get("oi") and snap_exp["oi"] > 0:
            positioning["oiExpiry"] = round((current_oi - snap_exp["oi"]) / snap_exp["oi"] * 100, 2)

    return positioning


# ============================================================
# FUNDAMENTALS (Multi-source: Screener.in HTML > Yahoo > Screener API)
# ============================================================
fund_cache = {}  # symbol -> {"data": ..., "ts": ...}

def _parse_screener_html(html, symbol):
    """Parse quarterly results from screener.in HTML page.
    Extracts: Sales, OPM%, EPS for last 8+ quarters."""
    result = {}
    try:
        import re as _re

        # Try multiple patterns to find the quarterly results table
        table_html = None
        # Pattern 1: section with id="quarters"
        m = _re.search(r'<section[^>]*id="quarters"[^>]*>(.*?)</section>', html, _re.DOTALL)
        if m:
            table_html = m.group(1)
        # Pattern 2: look for "Quarterly Results" heading + table
        if not table_html:
            m = _re.search(r'Quarterly\s+Results.*?(<table.*?</table>)', html, _re.DOTALL)
            if m:
                table_html = m.group(1)
        # Pattern 3: find data-result-table or any large table with "Sales" row
        if not table_html:
            tables = _re.findall(r'<table[^>]*>(.*?)</table>', html, _re.DOTALL)
            for t in tables:
                if 'Sales' in t and 'OPM' in t and 'EPS' in t:
                    table_html = t
                    break

        if not table_html:
            print(f"    [Screener HTML] {symbol}: No quarterly table found")
            return result

        # Parse ALL rows
        rows = _re.findall(r'<tr[^>]*>(.*?)</tr>', table_html, _re.DOTALL)

        sales_vals = []
        opm_vals = []
        eps_vals = []
        op_vals = []  # Operating Profit

        for row in rows:
            cells = _re.findall(r'<td[^>]*>(.*?)</td>', row, _re.DOTALL)
            if not cells:
                continue
            label = _re.sub(r'<[^>]+>', '', cells[0]).strip()
            label_lower = label.lower()
            vals = []
            for c in cells[1:]:
                txt = _re.sub(r'<[^>]+>', '', c).strip().replace(',', '').replace('%', '')
                try:
                    vals.append(float(txt))
                except:
                    vals.append(None)

            if 'sales' == label_lower or label_lower == 'revenue' or label_lower.startswith('sales'):
                sales_vals = vals
            elif 'opm' in label_lower:
                opm_vals = vals
            elif label_lower.startswith('eps') or 'eps in rs' in label_lower:
                eps_vals = vals
            elif 'operating profit' in label_lower and 'margin' not in label_lower:
                op_vals = vals

        # Screener.in: columns are left=oldest, right=newest → reverse for index 0=latest
        if sales_vals:
            sales_vals = list(reversed([v for v in sales_vals if v is not None]))
        if opm_vals:
            opm_vals = list(reversed([v for v in opm_vals if v is not None]))
        if eps_vals:
            eps_vals = list(reversed([v for v in eps_vals if v is not None]))
        if op_vals:
            op_vals = list(reversed([v for v in op_vals if v is not None]))

        # Revenue — latest + 8Q history
        if sales_vals and len(sales_vals) > 0:
            result["revenue"] = sales_vals[0]
            result["revenue8q"] = sales_vals[:8]
            if len(sales_vals) >= 2 and sales_vals[1] and sales_vals[1] > 0:
                result["revenueGrowth"] = round((sales_vals[0] - sales_vals[1]) / sales_vals[1] * 100, 1)
            if len(sales_vals) >= 5 and sales_vals[4] and sales_vals[4] > 0:
                result["revenueGrowthYoY"] = round((sales_vals[0] - sales_vals[4]) / sales_vals[4] * 100, 1)

        # EBITDA Margin (OPM%) — latest + 8Q history
        if opm_vals and len(opm_vals) > 0:
            result["ebitdaMargin"] = opm_vals[0]
            result["opm8q"] = opm_vals[:8]
            if len(opm_vals) >= 2 and opm_vals[1] is not None:
                result["ebitdaMarginChg"] = round(opm_vals[0] - opm_vals[1], 1)
        # Fallback: compute OPM from Operating Profit / Sales
        elif op_vals and sales_vals and len(op_vals) > 0 and len(sales_vals) > 0:
            opm_computed = []
            for i in range(min(len(op_vals), len(sales_vals))):
                if op_vals[i] is not None and sales_vals[i] is not None and sales_vals[i] > 0:
                    opm_computed.append(round(op_vals[i] / sales_vals[i] * 100, 1))
            if opm_computed:
                result["ebitdaMargin"] = opm_computed[0]
                result["opm8q"] = opm_computed[:8]
                if len(opm_computed) >= 2:
                    result["ebitdaMarginChg"] = round(opm_computed[0] - opm_computed[1], 1)

        # EPS — latest + 8Q history
        if eps_vals and len(eps_vals) > 0:
            result["eps"] = eps_vals[0]
            result["eps8q"] = eps_vals[:8]
            if len(eps_vals) >= 5 and eps_vals[4] is not None and eps_vals[4] != 0:
                result["epsGrowth"] = round((eps_vals[0] - eps_vals[4]) / abs(eps_vals[4]) * 100, 1)

        if result:
            print(f"    [Screener HTML] {symbol}: Rev={result.get('revenue')}, EPS={result.get('eps')}, "
                  f"EBITDA%={result.get('ebitdaMargin')}, Rev8Q={len(result.get('revenue8q',[]))}q, "
                  f"OPM8Q={len(result.get('opm8q',[]))}q, EPS8Q={len(result.get('eps8q',[]))}q")

    except Exception as e:
        print(f"    [Screener HTML] {symbol}: Parse error: {e}")
        import traceback; traceback.print_exc()

    return result


def fetch_fundamentals(symbol):
    """Fetch fundamentals from multiple sources with fallbacks."""
    # Check cache (1 hour)
    if symbol in fund_cache and (time.time() - fund_cache[symbol]["ts"]) < 3600:
        return fund_cache[symbol]["data"]

    result = {}

    # --- Source 1: Screener.in HTML page (most reliable for Indian stocks) ---
    for suffix in ["/consolidated/", "/"]:
        if result.get("eps") or result.get("revenue"):
            break
        try:
            surl = f"https://www.screener.in/company/{symbol}{suffix}"
            req = urllib.request.Request(surl, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate",
                "Connection": "keep-alive",
                "Referer": "https://www.screener.in/",
            })
            r = urllib.request.urlopen(req, timeout=20, context=ctx)
            raw = r.read()
            enc = r.headers.get("Content-Encoding", "")
            if "gzip" in enc:
                raw = gzip.decompress(raw)
            html = raw.decode("utf-8", errors="ignore")
            parsed = _parse_screener_html(html, symbol)
            if parsed:
                result.update(parsed)
                print(f"    [Fundamentals] {symbol}: Screener.in HTML OK")
        except urllib.error.HTTPError as e:
            print(f"    [Fundamentals] {symbol}: Screener HTML {e.code}")
        except Exception as e:
            print(f"    [Fundamentals] {symbol}: Screener HTML error: {e}")

    # --- Source 2: Screener.in API ---
    if not result.get("eps") and not result.get("revenue"):
        for suffix in ["/consolidated/", "/"]:
            try:
                surl = f"https://www.screener.in/api/company/{symbol}{suffix}"
                req = urllib.request.Request(surl, headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Accept": "application/json",
                    "Referer": "https://www.screener.in/",
                })
                r = urllib.request.urlopen(req, timeout=10, context=ctx)
                sdata = json.loads(r.read().decode("utf-8"))
                quarters = sdata.get("quarters", [])
                if quarters:
                    result["eps"] = quarters[0].get("eps")
                    result["revenue"] = quarters[0].get("sales")
                    result["ebitdaMargin"] = quarters[0].get("opm")
                    # 8Q arrays
                    result["eps8q"] = [q.get("eps") for q in quarters[:8]]
                    result["revenue8q"] = [q.get("sales") for q in quarters[:8]]
                    result["opm8q"] = [q.get("opm") for q in quarters[:8]]
                    if len(quarters) >= 2 and quarters[0].get("opm") is not None and quarters[1].get("opm") is not None:
                        result["ebitdaMarginChg"] = round(quarters[0]["opm"] - quarters[1]["opm"], 1)
                    if len(quarters) >= 5 and quarters[0].get("sales") and quarters[4].get("sales"):
                        result["revenueGrowthYoY"] = round((quarters[0]["sales"] - quarters[4]["sales"]) / quarters[4]["sales"] * 100, 1)
                    if len(quarters) >= 5 and quarters[0].get("eps") is not None and quarters[4].get("eps") is not None and quarters[4]["eps"] != 0:
                        result["epsGrowth"] = round((quarters[0]["eps"] - quarters[4]["eps"]) / abs(quarters[4]["eps"]) * 100, 1)
                    print(f"    [Fundamentals] {symbol}: Screener API OK - Rev8Q={len(result.get('revenue8q',[]))}q, OPM8Q={len(result.get('opm8q',[]))}q")
                    break
            except:
                pass

    # --- Source 2.5: Tickertape.in API (good fallback for EBITDA/margins) ---
    if not result.get("ebitdaMargin"):
        try:
            tt_url = f"https://api.tickertape.in/stocks/financials/income/{symbol}?period=quarterly"
            req = urllib.request.Request(tt_url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
                "Referer": "https://www.tickertape.in/",
            })
            r = urllib.request.urlopen(req, timeout=10, context=ctx)
            raw = r.read()
            enc = r.headers.get("Content-Encoding", "")
            if "gzip" in enc:
                raw = gzip.decompress(raw)
            tt_data = json.loads(raw)
            income_data = tt_data.get("data", [])
            if income_data:
                # Tickertape returns list of quarterly income statements, newest first
                rev_8q = []
                opm_8q = []
                for q in income_data[:8]:
                    rev = q.get("revenue") or q.get("netSales") or q.get("totalRevenue")
                    op = q.get("operatingProfit") or q.get("ebitda")
                    if rev is not None:
                        rev_cr = round(rev / 1e7, 0) if rev > 100000 else rev  # normalize to Cr
                        rev_8q.append(rev_cr)
                    if rev and op and rev > 0:
                        opm_8q.append(round(op / rev * 100, 1))
                if opm_8q:
                    if not result.get("ebitdaMargin"):
                        result["ebitdaMargin"] = opm_8q[0]
                    if not result.get("opm8q"):
                        result["opm8q"] = opm_8q
                    if len(opm_8q) >= 2 and not result.get("ebitdaMarginChg"):
                        result["ebitdaMarginChg"] = round(opm_8q[0] - opm_8q[1], 1)
                if rev_8q and not result.get("revenue8q"):
                    result["revenue8q"] = rev_8q
                    if not result.get("revenue"):
                        result["revenue"] = rev_8q[0]
                print(f"    [Fundamentals] {symbol}: Tickertape OK - OPM={result.get('ebitdaMargin')}")
        except Exception as e:
            print(f"    [Fundamentals] {symbol}: Tickertape error: {e}")

    # --- Source 3: Yahoo Finance quoteSummary ---
    if not result.get("eps") and not result.get("revenue"):
        ys = symbol.replace("_", "-") + ".NS"
        for domain in ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]:
            if result.get("eps") or result.get("revenue"):
                break
            try:
                modules = "earningsHistory,incomeStatementHistoryQuarterly,financialData"
                url = f"https://{domain}/v10/finance/quoteSummary/{ys}?modules={modules}"
                req = urllib.request.Request(url, headers=HEADERS_YAHOO)
                r = urllib.request.urlopen(req, timeout=15, context=ctx)
                raw = r.read()
                enc = r.headers.get("Content-Encoding", "")
                if "gzip" in enc:
                    raw = gzip.decompress(raw)
                data = json.loads(raw)

                qr = data.get("quoteSummary", {}).get("result", [])
                if not qr:
                    continue
                qr = qr[0]

                # Earnings History
                eh = qr.get("earningsHistory", {}).get("history", [])
                if eh:
                    eps_list = [q.get("epsActual", {}).get("raw") for q in eh]
                    eps_list_rev = list(reversed(eps_list))
                    result["eps8q"] = eps_list_rev[:8]
                    if eps_list_rev and eps_list_rev[0] is not None:
                        result["eps"] = eps_list_rev[0]
                    if len(eps_list_rev) >= 5 and eps_list_rev[0] is not None and eps_list_rev[4] is not None and eps_list_rev[4] != 0:
                        result["epsGrowth"] = round((eps_list_rev[0] - eps_list_rev[4]) / abs(eps_list_rev[4]) * 100, 1)

                # Quarterly Income
                inc_q = qr.get("incomeStatementHistoryQuarterly", {}).get("incomeStatementHistory", [])
                if inc_q:
                    latest = inc_q[0]
                    rev_raw = latest.get("totalRevenue", {}).get("raw")
                    ebitda_raw = latest.get("ebitda", {}).get("raw")
                    if rev_raw:
                        result["revenue"] = round(rev_raw / 1e7, 0)
                    if rev_raw and ebitda_raw:
                        result["ebitdaMargin"] = round(ebitda_raw / rev_raw * 100, 1)
                    # 8Q arrays from Yahoo
                    rev_8q_y = []
                    opm_8q_y = []
                    for q in inc_q[:8]:
                        qr_val = q.get("totalRevenue", {}).get("raw")
                        qe_val = q.get("ebitda", {}).get("raw")
                        if qr_val:
                            rev_8q_y.append(round(qr_val / 1e7, 0))
                        if qr_val and qe_val and qr_val > 0:
                            opm_8q_y.append(round(qe_val / qr_val * 100, 1))
                    if rev_8q_y and not result.get("revenue8q"):
                        result["revenue8q"] = rev_8q_y
                    if opm_8q_y and not result.get("opm8q"):
                        result["opm8q"] = opm_8q_y
                    if len(inc_q) >= 2:
                        prev_rev = inc_q[1].get("totalRevenue", {}).get("raw")
                        prev_ebitda = inc_q[1].get("ebitda", {}).get("raw")
                        if prev_rev and prev_ebitda and prev_rev > 0:
                            result["ebitdaMarginChg"] = round(result.get("ebitdaMargin", 0) - (prev_ebitda / prev_rev * 100), 1)
                    if len(inc_q) >= 5:
                        rev_yoy = inc_q[4].get("totalRevenue", {}).get("raw")
                        if rev_raw and rev_yoy and rev_yoy > 0:
                            result["revenueGrowthYoY"] = round((rev_raw - rev_yoy) / rev_yoy * 100, 1)

                print(f"    [Fundamentals] {symbol}: Yahoo {domain} OK")
            except Exception as e:
                print(f"    [Fundamentals] {symbol}: Yahoo {domain}: {e}")

    if not result:
        print(f"    [Fundamentals] {symbol}: ALL SOURCES FAILED")

    # Cache result
    if result:
        fund_cache[symbol] = {"data": result, "ts": time.time()}

    return result


# ============================================================
# RESULT ANALYSIS — Pre-Earnings Setup Report (10 Parameters)
# ============================================================
def calc_result_analysis(symbol, closes, highs, lows, volumes, timestamps, fundamentals=None):
    """Generate pre-earnings analysis for the 10 evaluation parameters.
    Auto-computes what it can from price/volume data.
    Returns dict with all 10 parameters.
    """
    n = len(closes)
    idx = n - 1
    price = closes[idx] if n > 0 else 0

    analysis = {"symbol": symbol}

    # ------------------------------------------------------------------
    # P2: HISTORICAL RESULT REACTIONS (last 4 quarters)
    # How did stock move pre/post results? Map against beats/misses.
    # ------------------------------------------------------------------
    quarterly_reactions = []
    fund = fundamentals or {}
    eps_8q = fund.get("eps8q", [])
    rev_8q = fund.get("revenue8q", [])
    opm_8q = fund.get("opm8q", [])

    # Compute QoQ and YoY changes from available data
    if len(eps_8q) >= 5:
        for i in range(min(4, len(eps_8q) - 4)):
            entry = {"quarter": f"Q{i+1}"}
            if eps_8q[i] is not None and eps_8q[i+4] is not None and eps_8q[i+4] != 0:
                entry["epsGrowthYoY"] = round((eps_8q[i] - eps_8q[i+4]) / abs(eps_8q[i+4]) * 100, 1)
            if i < len(rev_8q) and i + 4 < len(rev_8q) and rev_8q[i] and rev_8q[i+4] and rev_8q[i+4] > 0:
                entry["revGrowthYoY"] = round((rev_8q[i] - rev_8q[i+4]) / rev_8q[i+4] * 100, 1)
            if i < len(opm_8q) and opm_8q[i] is not None:
                entry["opm"] = opm_8q[i]
            quarterly_reactions.append(entry)
    analysis["historicalReactions"] = quarterly_reactions

    # ------------------------------------------------------------------
    # P3: PRE-POSITIONING (45-Day Lookback)
    # How has stock behaved in 45 days before today?
    # ------------------------------------------------------------------
    pre_pos = {}
    if n >= 46:
        price_45d_ago = closes[idx - 45]
        if price_45d_ago and price_45d_ago > 0:
            pre_pos["change45d"] = round((price - price_45d_ago) / price_45d_ago * 100, 2)
            # Classify
            chg = pre_pos["change45d"]
            if chg > 10:
                pre_pos["signal"] = "Strong Run-Up"
                pre_pos["interpretation"] = "Expectations likely priced in. Risk of sell-the-news."
            elif chg > 3:
                pre_pos["signal"] = "Mild Run-Up"
                pre_pos["interpretation"] = "Some optimism, but room for upside if beat is strong."
            elif chg > -3:
                pre_pos["signal"] = "Flat / Neutral"
                pre_pos["interpretation"] = "No strong positioning. Result will dictate direction."
            elif chg > -10:
                pre_pos["signal"] = "Mild Sell-Off"
                pre_pos["interpretation"] = "Washed-out sentiment. Positive surprise can trigger sharp rally."
            else:
                pre_pos["signal"] = "Deep Sell-Off"
                pre_pos["interpretation"] = "Extreme pessimism. Low-risk long if fundamentals hold."

        # 45-day price path (for sparkline)
        pre_pos["path"] = [round(c, 2) for c in closes[idx-45:idx+1]]

        # Volume trend in pre-result window
        if len(volumes) >= 46:
            vol_first_half = sum(volumes[idx-45:idx-22]) / 23
            vol_second_half = sum(volumes[idx-22:idx+1]) / 23
            pre_pos["volTrend"] = "Increasing" if vol_second_half > vol_first_half * 1.2 else "Decreasing" if vol_second_half < vol_first_half * 0.8 else "Stable"

    # 20-day pre-result positioning
    if n >= 21:
        price_20d_ago = closes[idx - 20]
        if price_20d_ago and price_20d_ago > 0:
            pre_pos["change20d"] = round((price - price_20d_ago) / price_20d_ago * 100, 2)

    # 10-day pre-result positioning
    if n >= 11:
        price_10d_ago = closes[idx - 10]
        if price_10d_ago and price_10d_ago > 0:
            pre_pos["change10d"] = round((price - price_10d_ago) / price_10d_ago * 100, 2)

    analysis["prePositioning"] = pre_pos

    # ------------------------------------------------------------------
    # P6: TECHNICAL CHART VIEW & LEFT SIDE TRAFFIC
    # Overhead supply analysis
    # ------------------------------------------------------------------
    tech = {}
    if n >= 200:
        # Count bars in last 250 days where close was ABOVE current price
        # These represent overhead supply / resistance
        lookback_250 = min(250, n)
        overhead_count = sum(1 for i in range(idx - lookback_250, idx) if closes[i] > price)
        overhead_pct = round(overhead_count / lookback_250 * 100, 1)
        tech["overheadSupplyPct"] = overhead_pct

        if overhead_pct < 10:
            tech["leftSideTraffic"] = "Blue Sky Breakout"
            tech["trafficColor"] = "green"
            tech["interpretation"] = "Minimal overhead resistance. Clear path for post-earnings rally."
        elif overhead_pct < 30:
            tech["leftSideTraffic"] = "Light Traffic"
            tech["trafficColor"] = "green"
            tech["interpretation"] = "Some resistance but manageable on strong volumes."
        elif overhead_pct < 60:
            tech["leftSideTraffic"] = "Moderate Traffic"
            tech["trafficColor"] = "orange"
            tech["interpretation"] = "Significant overhead supply. Will need strong catalyst to clear."
        else:
            tech["leftSideTraffic"] = "Heavy Traffic"
            tech["trafficColor"] = "red"
            tech["interpretation"] = "Dense overhead supply will cap any post-earnings rally."

        # Key resistance levels (volume-weighted)
        tech["dist52wHigh"] = round((high_52w - price) / high_52w * 100, 2) if 'high_52w' in dir() else None
        if n >= 200:
            high_52w_local = max(highs[max(0, idx-251):idx+1])
            low_52w_local = min(lows[max(0, idx-251):idx+1])
            tech["dist52wHigh"] = round((high_52w_local - price) / high_52w_local * 100, 2)
            tech["dist52wLow"] = round((price - low_52w_local) / low_52w_local * 100, 2)
            tech["high52w"] = round(high_52w_local, 2)
            tech["low52w"] = round(low_52w_local, 2)

    # DMA positions
    if n >= 20: tech["dma20"] = round(sum(closes[-20:]) / 20, 2)
    if n >= 50: tech["dma50"] = round(sum(closes[-50:]) / 50, 2)
    if n >= 200: tech["dma200"] = round(sum(closes[-200:]) / 200, 2)

    analysis["technicals"] = tech

    # ------------------------------------------------------------------
    # P7: RISK:REWARD FOR THE TRADE
    # ------------------------------------------------------------------
    rr = {}
    if n >= 20:
        adr_20 = sum(abs(highs[idx-i] - lows[idx-i]) for i in range(20)) / 20
        adr_pct = round(adr_20 / price * 100, 2) if price > 0 else 0
        rr["adrPct"] = adr_pct
        rr["expectedMoveUp"] = round(adr_pct * 3, 1)   # 3x ADR as typical result move
        rr["expectedMoveDown"] = round(adr_pct * 2, 1)  # 2x ADR as downside risk

        # Pre-positioning adjusted R:R
        pre_chg = pre_pos.get("change45d", 0)
        if pre_chg > 10:
            rr["longBias"] = "Unfavorable"
            rr["shortBias"] = "Favorable"
            rr["rr_long"] = f"1:{round(rr['expectedMoveUp'] / max(rr['expectedMoveDown'], 0.1), 1)}"
        elif pre_chg < -10:
            rr["longBias"] = "Favorable"
            rr["shortBias"] = "Unfavorable"
            rr["rr_long"] = f"1:{round(rr['expectedMoveUp'] * 1.5 / max(rr['expectedMoveDown'], 0.1), 1)}"
        else:
            rr["longBias"] = "Neutral"
            rr["shortBias"] = "Neutral"
            rr["rr_long"] = f"1:{round(rr['expectedMoveUp'] / max(rr['expectedMoveDown'], 0.1), 1)}"

    analysis["riskReward"] = rr

    # ------------------------------------------------------------------
    # P8: MARGIN EXPANSION (Delayed EP Play)
    # ------------------------------------------------------------------
    margin_analysis = {}
    if len(opm_8q) >= 4:
        # Check if margins are expanding
        recent_opm = [x for x in opm_8q[:4] if x is not None]
        if len(recent_opm) >= 2:
            margin_analysis["latestOPM"] = recent_opm[0]
            margin_analysis["prevOPM"] = recent_opm[1]
            margin_analysis["opmChange"] = round(recent_opm[0] - recent_opm[1], 1)
            if len(recent_opm) >= 4:
                margin_analysis["opm4qAvg"] = round(sum(recent_opm[:4]) / len(recent_opm[:4]), 1)
                margin_analysis["opmTrend"] = "Expanding" if recent_opm[0] > recent_opm[-1] else "Contracting" if recent_opm[0] < recent_opm[-1] else "Stable"
                if recent_opm[0] > recent_opm[-1]:
                    margin_analysis["delayedEP"] = "Possible — margins trending up. Street may be underestimating earnings power."
                elif recent_opm[0] < recent_opm[-1]:
                    margin_analysis["delayedEP"] = "Unlikely — margins compressing. Watch for further deterioration."
                else:
                    margin_analysis["delayedEP"] = "Neutral — margins stable. No clear delayed EP signal."
    analysis["marginExpansion"] = margin_analysis

    # ------------------------------------------------------------------
    # P1: ESTIMATES — Manual input fields (user provides Bloomberg/street nos)
    # ------------------------------------------------------------------
    analysis["estimates"] = {
        "consensusRevenue": None, "consensusEBITDA": None, "consensusPAT": None,
        "whisperDirection": None,
        "note": "Enter Bloomberg/street estimates in the input fields below"
    }

    # ------------------------------------------------------------------
    # P4: CYCLE STAGE — Manual input (HOS)
    # ------------------------------------------------------------------
    analysis["cycleStage"] = {
        "stage": None,
        "note": "Select sector cycle stage below"
    }

    # ------------------------------------------------------------------
    # P5: MANAGEMENT TONE — Auto-assessed from financial trajectory
    # ------------------------------------------------------------------
    mgmt = {}
    signals = []
    if len(rev_8q) >= 4:
        valid_revs = [r for r in rev_8q[:4] if r is not None and r > 0]
        if len(valid_revs) >= 2:
            if valid_revs[0] > valid_revs[1]:
                signals.append("Revenue accelerating QoQ")
            else:
                signals.append("Revenue decelerating QoQ")
    if len(opm_8q) >= 4:
        valid_opm = [o for o in opm_8q[:4] if o is not None]
        if len(valid_opm) >= 3:
            if valid_opm[0] > valid_opm[1] > valid_opm[2]:
                signals.append("Margin expanding consistently — confident stance likely")
            elif valid_opm[0] < valid_opm[1] < valid_opm[2]:
                signals.append("Margin compressing — defensive tone likely")
            else:
                signals.append("Margin mixed — cautious tone expected")
    if len(eps_8q) >= 5:
        valid_eps = [e for e in eps_8q[:5] if e is not None]
        if len(valid_eps) >= 2:
            if valid_eps[0] > 0 and valid_eps[1] > 0 and valid_eps[0] > valid_eps[1] * 1.2:
                signals.append("Strong EPS growth (+20%+ QoQ) — high confidence")
            elif valid_eps[0] is not None and valid_eps[1] is not None and valid_eps[0] < valid_eps[1] * 0.8:
                signals.append("EPS declining (-20%+ QoQ) — expect cautious guidance")

    # Auto-determine tone
    pos_signals = sum(1 for s in signals if "confident" in s.lower() or "accelerat" in s.lower() or "expanding" in s.lower() or "strong" in s.lower())
    neg_signals = sum(1 for s in signals if "defensive" in s.lower() or "decelerat" in s.lower() or "compress" in s.lower() or "declining" in s.lower() or "cautious" in s.lower())

    if pos_signals > neg_signals:
        mgmt["tone"] = "Confident"
        mgmt["toneColor"] = "green"
    elif neg_signals > pos_signals:
        mgmt["tone"] = "Cautious/Defensive"
        mgmt["toneColor"] = "red"
    else:
        mgmt["tone"] = "Neutral/Mixed"
        mgmt["toneColor"] = "orange"

    mgmt["signals"] = signals
    mgmt["autoAssessed"] = True
    analysis["managementTone"] = mgmt

    # ------------------------------------------------------------------
    # P9 & P10: RESULT TIMING & DATE — Auto-fetch from BSE
    # ------------------------------------------------------------------
    result_info = _fetch_bse_result_date(symbol)
    analysis["resultTiming"] = result_info.get("timing", {"timing": None, "note": "Not found"})
    analysis["probableDate"] = result_info.get("date", {"date": None, "note": "Not found"})

    return analysis


def _fetch_bse_result_date(symbol):
    """Try to fetch upcoming board meeting / result date from BSE India."""
    result = {"timing": {"timing": None, "note": "Auto-fetch attempted"}, "date": {"date": None, "boardMeetingDate": None}}

    # Try BSE's forthcoming results API (internal endpoint)
    try:
        # BSE uses scrip codes; try to find via search
        search_url = f"https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&company={urllib.parse.quote(symbol)}&scripclass="
        req = urllib.request.Request(search_url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json",
            "Referer": "https://www.bseindia.com/",
            "Origin": "https://www.bseindia.com",
        })
        r = urllib.request.urlopen(req, timeout=8, context=ctx)
        data = json.loads(r.read().decode())
        scrip_code = None
        if data and isinstance(data, list):
            for item in data:
                sc = item.get("SCRIP_CD") or item.get("Scrip_Code") or item.get("scrip_code")
                nm = (item.get("SCRIP_NAME") or item.get("Scrip_Name") or "").upper()
                if sc and (symbol.upper() in nm or nm.startswith(symbol.upper()[:4])):
                    scrip_code = str(sc)
                    break

        if scrip_code:
            # Fetch board meetings for this scrip
            bm_url = f"https://api.bseindia.com/BseIndiaAPI/api/BoardMeeting/w?scripcode={scrip_code}&Flag=Forthcoming"
            req = urllib.request.Request(bm_url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
                "Referer": "https://www.bseindia.com/corporates/board_meeting.aspx",
            })
            r = urllib.request.urlopen(req, timeout=8, context=ctx)
            bm_data = json.loads(r.read().decode())
            if bm_data and isinstance(bm_data, list) and len(bm_data) > 0:
                latest = bm_data[0]
                meeting_date = latest.get("MeetingDate") or latest.get("MEETING_DATE") or latest.get("meeting_date")
                purpose = latest.get("PURPOSE") or latest.get("Purpose") or ""
                result["date"]["boardMeetingDate"] = meeting_date
                result["date"]["date"] = meeting_date
                result["date"]["purpose"] = purpose
                print(f"    [BSE] {symbol}: Board meeting {meeting_date} — {purpose}")
    except Exception as e:
        print(f"    [BSE] Result date fetch failed for {symbol}: {e}")

    return result


# ============================================================
# COMBINED DATA
# ============================================================
def get_stock_data(symbol):
    result = {"symbol": symbol, "source": []}
    has_dhan = bool(dhan_config["access_token"] and dhan_config["client_id"])

    # Initialize defaults (in case Yahoo fails, rest of function won't crash)
    closes, highs, lows, volumes, opens, ts = [], [], [], [], [], []
    n = 0

    # Yahoo Finance
    print(f"    [Yahoo] Fetching...")
    ydata = fetch_yahoo_history(symbol)
    if ydata and ydata.get("chart", {}).get("result"):
        result["source"].append("Yahoo")
        yr = ydata["chart"]["result"][0]
        ts = yr.get("timestamp", [])
        q = yr.get("indicators", {}).get("quote", [{}])[0]
        closes = [c for c in (q.get("close") or []) if c is not None]
        volumes = [v for v in (q.get("volume") or []) if v is not None]
        highs = [h for h in (q.get("high") or []) if h is not None]
        lows = [l for l in (q.get("low") or []) if l is not None]
        opens = [o for o in (q.get("open") or []) if o is not None]
        n = len(closes)

        if n > 0:
            result["cmp"] = closes[-1]
            if n > 1:
                result["prevClose"] = closes[-2]
                result["change"] = closes[-1] - closes[-2]
                result["changePct"] = (result["change"] / closes[-2]) * 100
            if opens: result["open"] = opens[-1]
            if highs: result["high"] = highs[-1]
            if lows: result["low"] = lows[-1]

        meta = yr.get("meta", {})
        result["high52w"] = meta.get("fiftyTwoWeekHigh")
        result["low52w"] = meta.get("fiftyTwoWeekLow")
        if volumes: result["volume"] = volumes[-1]

        # SMA (Simple Moving Averages)
        if n >= 20: result["dma20"] = round(sum(closes[-20:]) / 20, 2)
        if n >= 50: result["dma50"] = round(sum(closes[-50:]) / 50, 2)
        if n >= 150: result["dma150"] = round(sum(closes[-150:]) / 150, 2)
        if n >= 200: result["dma200"] = round(sum(closes[-200:]) / 200, 2)

        # EMA (Exponential Moving Averages)
        def _calc_ema(data, period):
            if len(data) < period:
                return None
            mult = 2 / (period + 1)
            ema = sum(data[:period]) / period  # seed with SMA
            for i in range(period, len(data)):
                ema = (data[i] - ema) * mult + ema
            return round(ema, 2)

        if n >= 10: result["ema10"] = _calc_ema(closes, 10)
        if n >= 20: result["ema20"] = _calc_ema(closes, 20)
        if n >= 50: result["ema50"] = _calc_ema(closes, 50)
        if n >= 200: result["ema200"] = _calc_ema(closes, 200)

        vn = len(volumes)
        if vn >= 3: result["avgVol3"] = round(sum(volumes[-3:]) / 3)
        if vn >= 5: result["avgVol5"] = round(sum(volumes[-5:]) / 5)
        if vn >= 20: result["avgVol20"] = round(sum(volumes[-20:]) / 20)
        tv = volumes[-1] if volumes else None
        if tv and result.get("avgVol5"): result["xVol5"] = round(tv / result["avgVol5"], 2)
        if tv and result.get("avgVol20"): result["xVol20"] = round(tv / result["avgVol20"], 2)
        # RVol % = (today's volume / SMA of previous 20 days' volume) * 100
        if vn >= 21:
            prev_20_avg = sum(volumes[-21:-1]) / 20
            if prev_20_avg > 0:
                result["rVol"] = round((tv / prev_20_avg) * 100, 1)

        result["historical"] = {
            "closes": closes[-60:],
            "volumes": volumes[-30:],
            "dates": [time.strftime("%d/%m", time.localtime(t)) for t in ts[-30:]] if ts else []
        }

        # === NEW METRICS ===
        # ADR % (50-day)
        if len(highs) >= 50 and len(lows) >= 50:
            result["adrPct"] = calc_adr_pct(highs, lows, closes, 50)

        # Burst Power (count-based: 5%/10%/19% daily moves over full history)
        if n >= 20:
            result["burstPower"] = calc_burst_power(closes)

        # Purple Dots (6 months: days with >=5% move AND volume >= 10 lakh)
        if len(closes) >= 20 and len(volumes) >= 20:
            result["purpleDots"] = calc_purple_dots(closes, volumes, period=125)

        # VCP (Volatility Contraction Pattern)
        if len(closes) >= 210 and len(highs) >= 210 and len(lows) >= 210:
            # Fetch Nifty 100 Equal Weight for VCP spread calc
            nifty100_data = fetch_index_history(["NIFTY100EQUALWEIGHT.NS", "^CNXEQWT", "^NSEI"])
            vcp = calc_vcp(closes, highs, lows, volumes, ts, nifty100_data)
            result["vcp"] = vcp

        # Volume in USD terms
        if volumes and closes:
            vol_usd = calc_volume_usd(volumes[-1], closes[-1])
            if vol_usd:
                result["turnoverCr"] = vol_usd["turnoverCr"]
                result["turnoverUsdM"] = vol_usd["turnoverUsdM"]

        # Avg daily turnover (20-day) for liquidity
        if vn >= 20 and n >= 20:
            avg_to = sum(volumes[-i] * closes[-i] for i in range(1, 21) if i < vn and i < n) / 20
            result["avgTurnoverCr"] = round(avg_to / 1e7, 1)

    # Mansfield Relative Strength vs CNX500 (30 days)
    if len(closes) >= 30:
        cnx_data = fetch_cnx500_history()
        if cnx_data:
            mansfield_rs, rs_ratio = calc_mansfield_rs(closes, ts, cnx_data, 30)
            if mansfield_rs is not None:
                result["rs30d"] = mansfield_rs
                result["rsRatio"] = rs_ratio
            else:
                print(f"    [RS] Mansfield calc returned None for {symbol}")
        else:
            print(f"    [RS] CNX500 data not available")

    # Positioning (1D, 5D, since expiry) — price part from Yahoo
    positioning = calc_positioning(closes, ts, None, symbol)
    result["positioning"] = positioning

    # Alpha = Stock % change - Sector Index % change
    sector = get_sector_for_symbol(symbol)
    result["sector"] = sector
    if len(closes) >= 2:
        sector_tickers = SECTOR_INDEX_MAP.get(sector) if sector else None
        sector_data = None
        if sector_tickers:
            sector_data = fetch_index_history(sector_tickers)
            if sector_data:
                result["sectorIndex"] = sector_data.get("ticker", "")
                a1d = calc_alpha(closes, ts, sector_data, "1d")
                a5d = calc_alpha(closes, ts, sector_data, "5d")
                a_exp = calc_alpha(closes, ts, sector_data, "expiry")
                if a1d is not None:
                    positioning["alpha1d"] = a1d
                if a5d is not None:
                    positioning["alpha5d"] = a5d
                if a_exp is not None:
                    positioning["alphaExpiry"] = a_exp
                print(f"    [ALPHA] Sector={sector}, Index={result.get('sectorIndex')}, 1D={a1d}, 5D={a5d}, Exp={a_exp}")

    # DMA distances
    cmp = result.get("cmp")
    if cmp:
        for k, dk in [("dma20","distDma20"),("dma50","distDma50"),("dma200","distDma200")]:
            dv = result.get(k)
            if dv: result[dk] = round((cmp - dv) / dv * 100, 2)
        if result.get("high52w"): result["distHigh52w"] = round((cmp - result["high52w"]) / result["high52w"] * 100, 2)
        if result.get("low52w"): result["distLow52w"] = round((cmp - result["low52w"]) / result["low52w"] * 100, 2)

    # Dhan API
    if has_dhan and scrip_loaded:
        eq_id, fut_info = find_security_ids(symbol)
        print(f"    [Dhan] eq_id={eq_id}, fut_id={fut_info['security_id'] if fut_info else 'None'}")

        if not eq_id and not fut_info:
            result["dhan_error"] = f"'{symbol}' not in scrip master"
            print(f"    [Dhan] *** NOT FOUND: {symbol} ***")
        else:
            if fut_info:
                fq = fetch_futures_quote(fut_info)
                if isinstance(fq, dict) and "error" not in fq and fq.get("last_price"):
                    result["source"].append("Dhan-Fut")
                    result["futPrice"] = fq["last_price"]
                    result["futOI"] = fq.get("oi")
                    result["futVol"] = fq.get("volume")
                    result["futOIDayHigh"] = fq.get("oi_day_high")
                    result["futOIDayLow"] = fq.get("oi_day_low")
                    result["futPrevOI"] = fq.get("previous_oi") or fq.get("prev_oi") or fq.get("prev_open_interest") or fq.get("previousOI")
                    result["lotSize"] = fut_info.get("lot_size")
                    result["expiryDate"] = fut_info.get("expiry")
                    ohlc = fq.get("ohlc", {})
                    if ohlc:
                        result["futOpen"] = ohlc.get("open")
                        result["futClose"] = ohlc.get("close")

                # Fetch historical OI for 5D and expiry positioning
                time.sleep(0.3)
                hist_oi = fetch_dhan_historical_oi(fut_info, days=45)
                if hist_oi:
                    result["_hist_oi"] = hist_oi

            if eq_id:
                time.sleep(1)
                oc = fetch_option_chain(eq_id, symbol)
                has_oc = False
                if isinstance(oc, dict):
                    if "data" in oc and isinstance(oc.get("data"), dict) and "oc" in oc["data"]:
                        has_oc = True
                    elif "oc" in oc:
                        has_oc = True

                if has_oc:
                    result["source"].append("Dhan-OC")
                    oc_parsed = process_option_chain(oc)
                    result.update(oc_parsed)
                    if oc_parsed.get("optOIChg") is not None:
                        result["futOIChg"] = oc_parsed["optOIChg"]
                        result["futOIChgPct"] = oc_parsed.get("optOIChgPct")

    elif has_dhan and not scrip_loaded:
        result["dhan_error"] = "Scrip master loading..."
    elif not has_dhan:
        result["dhan_error"] = "Dhan not configured"

    # Update positioning with OI data if available
    if "positioning" in result:
        pos = result["positioning"]
        current_oi = result.get("futOI")
        hist_oi = result.get("_hist_oi")

        if current_oi and current_oi > 0:
            save_oi_snapshot(symbol, current_oi, result.get("cmp"))

        # --- 1-Day OI change ---
        # Priority 1: prev_oi from Dhan futures quote
        prev_oi = result.get("futPrevOI")
        if current_oi and prev_oi and prev_oi > 0:
            pos["oi1d"] = round((current_oi - prev_oi) / prev_oi * 100, 2)
            print(f"    [POS] 1D OI (prev_oi): {prev_oi} -> {current_oi} = {pos['oi1d']}%")
        # Priority 2: Use historical OI (yesterday's value)
        if "oi1d" not in pos and hist_oi and isinstance(hist_oi, dict):
            oi_arr = hist_oi.get("oi") or []
            if oi_arr and len(oi_arr) >= 2 and oi_arr[-2] and oi_arr[-2] > 0 and current_oi:
                pos["oi1d"] = round((current_oi - oi_arr[-2]) / oi_arr[-2] * 100, 2)
                print(f"    [POS] 1D OI (hist[-2]): {oi_arr[-2]} -> {current_oi} = {pos['oi1d']}%")
        # Priority 3: Use option chain total OI change (already computed)
        if "oi1d" not in pos and result.get("futOIChgPct") is not None:
            pos["oi1d"] = result["futOIChgPct"]
            print(f"    [POS] 1D OI (option chain): {pos['oi1d']}%")
        # Priority 4: Local snapshot
        if "oi1d" not in pos and current_oi:
            snap_1d = get_oi_snapshot(symbol, 1)
            if snap_1d and snap_1d.get("oi") and snap_1d["oi"] > 0:
                pos["oi1d"] = round((current_oi - snap_1d["oi"]) / snap_1d["oi"] * 100, 2)
                print(f"    [POS] 1D OI (snapshot): {pos['oi1d']}%")

        # --- 5-Day OI change ---
        # Priority 1: Dhan historical charts (hist_oi already fetched above)
        if hist_oi and isinstance(hist_oi, dict) and current_oi:
            oi_arr = hist_oi.get("oi") or hist_oi.get("open_interest") or []
            ts_arr = hist_oi.get("timestamps") or hist_oi.get("timestamp") or []

            if oi_arr:
                if len(oi_arr) >= 6 and oi_arr[-6] and oi_arr[-6] > 0:
                    pos["oi5d"] = round((current_oi - oi_arr[-6]) / oi_arr[-6] * 100, 2)
                    print(f"    [POS] 5D OI (hist): {oi_arr[-6]} -> {current_oi} = {pos['oi5d']}%")

                # Since expiry
                prev_expiry = get_previous_expiry()
                if ts_arr and len(ts_arr) == len(oi_arr):
                    expiry_ts = time.mktime(datetime.strptime(prev_expiry, "%Y-%m-%d").timetuple())
                    for i, t in enumerate(ts_arr):
                        if t >= expiry_ts and i < len(oi_arr) and oi_arr[i] and oi_arr[i] > 0:
                            pos["oiExpiry"] = round((current_oi - oi_arr[i]) / oi_arr[i] * 100, 2)
                            print(f"    [POS] Expiry OI (hist): {oi_arr[i]} -> {current_oi} = {pos['oiExpiry']}%")
                            break
                elif len(oi_arr) >= 20:
                    # Estimate: expiry was ~N trading days ago
                    days_since = (datetime.now() - datetime.strptime(prev_expiry, "%Y-%m-%d")).days
                    trading_days = max(1, int(days_since * 5 / 7))
                    idx = max(0, len(oi_arr) - 1 - trading_days)
                    if oi_arr[idx] and oi_arr[idx] > 0:
                        pos["oiExpiry"] = round((current_oi - oi_arr[idx]) / oi_arr[idx] * 100, 2)
                        print(f"    [POS] Expiry OI (hist-est): {oi_arr[idx]} -> {current_oi} = {pos['oiExpiry']}%")

        # Priority 2: Local snapshots for 5D and expiry
        if "oi5d" not in pos and current_oi:
            snap_5d = get_oi_snapshot(symbol, 7)
            if snap_5d and snap_5d.get("oi") and snap_5d["oi"] > 0:
                pos["oi5d"] = round((current_oi - snap_5d["oi"]) / snap_5d["oi"] * 100, 2)
                print(f"    [POS] 5D OI (snapshot): {pos['oi5d']}%")

        if "oiExpiry" not in pos and current_oi:
            prev_expiry = get_previous_expiry()
            days_since = (datetime.now() - datetime.strptime(prev_expiry, "%Y-%m-%d")).days
            snap_exp = get_oi_snapshot(symbol, days_since)
            if snap_exp and snap_exp.get("oi") and snap_exp["oi"] > 0:
                pos["oiExpiry"] = round((current_oi - snap_exp["oi"]) / snap_exp["oi"] * 100, 2)
                print(f"    [POS] Expiry OI (snapshot): {pos['oiExpiry']}%")

        # Log what we have/don't have
        have = [k for k in ["oi1d", "oi5d", "oiExpiry"] if k in pos]
        miss = [k for k in ["oi1d", "oi5d", "oiExpiry"] if k not in pos]
        print(f"    [POS] Have: {have}, Missing: {miss}")

    # Clean up internal field
    result.pop("_hist_oi", None)

    # Basis
    cmp = result.get("cmp")
    fp = result.get("futPrice")
    if cmp and fp:
        result["basis"] = round(fp - cmp, 2)
        result["basisPct"] = round((fp - cmp) / cmp * 100, 3)

    # Signal
    px = result.get("changePct")
    oi_chg = result.get("futOIChgPct")
    if px is not None and oi_chg is not None:
        pu, ou = px > 0, oi_chg > 0
        if pu and ou: result["signal"] = "Long Buildup"
        elif not pu and ou: result["signal"] = "Short Buildup"
        elif not pu and not ou: result["signal"] = "Long Unwinding"
        else: result["signal"] = "Short Covering"
    else:
        result["signal"] = "Data Pending"

    # Fundamentals (async-friendly, cached)
    fundamentals = None
    try:
        fundamentals = fetch_fundamentals(symbol)
        if fundamentals:
            result["fundamentals"] = fundamentals
    except:
        pass

    # Result Analysis (pre-earnings 10-parameter report)
    try:
        if n > 50:
            ra = calc_result_analysis(symbol, closes, highs, lows, volumes, ts, fundamentals)
            result["resultAnalysis"] = ra
    except Exception as e:
        print(f"    [ResultAnalysis] Error for {symbol}: {e}")

    return result


# ============================================================
# HTTP SERVER
# ============================================================
class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        p = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(p.query)

        if p.path in ("/", "/index.html", "/v2"):
            return self.serve_file("Poojan_OI_Dashboard_v2.html", "text/html")

        if p.path == "/v1":
            return self.serve_file("Stock_Parameter_Screener.html", "text/html")

        if p.path == "/api/stock":
            sym = (qs.get("symbol") or [None])[0]
            if not sym:
                return self.json_resp({"error": "symbol required"}, 400)
            print(f"\n  ===== Fetching: {sym.upper()} =====")
            data = get_stock_data(sym.upper())
            print(f"  ===== Done: {sym.upper()} | CMP={data.get('cmp','?')} | FutOI={data.get('futOI','?')} | Signal={data.get('signal','?')} =====\n")
            return self.json_resp(data)

        if p.path == "/api/status":
            return self.json_resp({
                "status": "ok",
                "dhan_configured": bool(dhan_config["access_token"]),
                "scrip_loaded": scrip_loaded,
                "equities": len(eq_map),
                "futures": len(fut_map)
            })

        if p.path == "/api/config":
            return self.json_resp({
                "client_id": dhan_config["client_id"],
                "has_token": bool(dhan_config["access_token"]),
                "token_preview": dhan_config["access_token"][:8] + "..." if dhan_config["access_token"] else ""
            })

        if p.path == "/api/debug":
            sym = (qs.get("symbol") or ["RELIANCE"])[0].upper()
            eq_id, fut_info = find_security_ids(sym) if scrip_loaded else (None, None)
            return self.json_resp({
                "scrip_loaded": scrip_loaded,
                "scrip_debug": scrip_debug,
                "eq_map_size": len(eq_map),
                "fut_map_size": len(fut_map),
                "eq_sample": {k: v for i, (k, v) in enumerate(eq_map.items()) if i < 15},
                "fut_sample": {k: {"id": v["security_id"], "exp": v["expiry"], "sym": v["trading_symbol"]}
                               for i, (k, v) in enumerate(fut_map.items()) if i < 15},
                "lookup": {"symbol": sym, "eq_id": eq_id, "fut_info": fut_info},
                "dhan": {"client_id": dhan_config["client_id"], "has_token": bool(dhan_config["access_token"])}
            })

        self.send_error(404)

    def do_POST(self):
        p = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))

        if p.path == "/api/config":
            body = json.loads(self.rfile.read(length))
            if "client_id" in body:
                dhan_config["client_id"] = body["client_id"].strip()
            if "access_token" in body:
                dhan_config["access_token"] = body["access_token"].strip()
            save_config()
            print(f"  Config saved: client_id={dhan_config['client_id']}")
            return self.json_resp({"status": "ok"})

        self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def serve_file(self, name, ctype):
        fpath = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
        if not os.path.exists(fpath):
            return self.send_error(404)
        with open(fpath, "rb") as f:
            content = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", len(content))
        self.end_headers()
        self.wfile.write(content)

    def json_resp(self, data, code=200):
        body = json.dumps(data, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        if "/api/" in str(args[0]):
            print(f"  [HTTP] {args[0]}")


# ============================================================
# CONFIG
# ============================================================
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".dhan_config.json")

def save_config():
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(dhan_config, f, indent=2)
    except Exception as e:
        print(f"  [Config] Save error: {e}")

def load_config():
    global dhan_config
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, "r") as f:
                data = json.load(f)
            if "client_id" in data:
                dhan_config["client_id"] = data["client_id"]
            if "access_token" in data:
                dhan_config["access_token"] = data["access_token"]
            print(f"  Loaded config: client_id={dhan_config['client_id']}, has_token={bool(dhan_config['access_token'])}")
    except Exception as e:
        print(f"  [Config] Load error: {e}")


# ============================================================
# MAIN
# ============================================================
if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  STOCK PARAMETER SCREENER")
    print("  Yahoo Finance (price) + Dhan Data API (derivatives)")
    print("=" * 60)
    print(f"\n  Dashboard: http://localhost:{PORT}")
    print(f"  Debug:     http://localhost:{PORT}/api/debug")
    print("  Press Ctrl+C to stop.\n")

    load_config()

    threading.Thread(target=load_scrip_master, daemon=True).start()

    server = http.server.HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"  Server ready on port {PORT}!")
    if dhan_config["access_token"]:
        print(f"  Dhan: Configured (client: {dhan_config['client_id']})")
    else:
        print("  Dhan: Not configured — go to Settings")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")
        server.server_close()
