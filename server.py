"""
MKTDESK — Local Server (NSE Bhavcopy Edition)
==============================================
Replaces Dhan API with free NSE Bhavcopy data.
No API key needed. No authentication. No token expiry.

HOW TO RUN:
  Option 1 (Windows): Double-click START_SCREENER.bat
  Option 2 (Manual):  python server_bhavcopy.py
  Then open:          http://localhost:5555

DATA SOURCES:
  - NSE Bhavcopy (CM + FO) — price, OI, PCR, signals
  - Bhavcopy releases daily ~6 PM IST on trading days
  - Falls back up to 5 trading days if latest is unavailable

ENDPOINTS:
  GET  /                         → serves dashboard HTML
  GET  /api/bhavcopy             → full universe data (JSON)
  GET  /api/stock?symbol=RELIANCE → single stock data (JSON)
  GET  /api/status               → server health check
  POST /api/bhavcopy             → manual CSV upload fallback
"""

import http.server, json, urllib.request, urllib.parse, ssl, os, time, csv
import gzip, io, zipfile, threading, math
from datetime import datetime, timedelta
from http.cookiejar import CookieJar

PORT      = 5555
MONTHS    = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"]
CTX       = ssl.create_default_context()
CACHE_TTL = 5  * 60   # 5 min
COOKIE_TTL= 20 * 60   # 20 min

_cache     = {"data": None, "date": None, "ts": 0}
_nse_cookie= {"value": "",  "ts": 0}
_cache_lock= threading.Lock()

# ── Sector map (213 F&O stocks) ───────────────────────────────────────────────
SECTORS = {
    "RELIANCE":"Oil Gas & Fuels","TCS":"IT","INFY":"IT","HDFCBANK":"Fin Ser-Pvt Bank",
    "ICICIBANK":"Fin Ser-Pvt Bank","BHARTIARTL":"Telecom","SBIN":"Fin Ser-PSU Bank",
    "ITC":"FMCG","HINDUNILVR":"FMCG","KOTAKBANK":"Fin Ser-Pvt Bank","LT":"Construction",
    "AXISBANK":"Fin Ser-Pvt Bank","BAJFINANCE":"Fin Ser-NBFC","TATAMOTORS":"Automobile",
    "MARUTI":"Automobile","SUNPHARMA":"Healthcare","TITAN":"Consumer Durables",
    "WIPRO":"IT","HCLTECH":"IT","TATASTEEL":"Metals & Mining","ADANIENT":"Metals & Mining",
    "NTPC":"Power","POWERGRID":"Power","COALINDIA":"Metals & Mining","ONGC":"Oil Gas & Fuels",
    "JSWSTEEL":"Metals & Mining","HINDALCO":"Metals & Mining","DRREDDY":"Healthcare",
    "CIPLA":"Healthcare","DIVISLAB":"Healthcare","BAJAJFINSV":"Fin Ser-NBFC",
    "BAJAJ_AUTO":"Automobile","EICHERMOT":"Automobile","HEROMOTOCO":"Automobile",
    "ASIANPAINT":"Consumer Durables","NESTLEIND":"FMCG","BRITANNIA":"FMCG",
    "INDIGO":"Services","BPCL":"Oil Gas & Fuels","GRASIM":"Cement","ULTRACEMCO":"Cement",
    "DLF":"Realty","GODREJPROP":"Realty","TECHM":"IT","LTIM":"IT","PERSISTENT":"IT",
    "COFORGE":"IT","MPHASIS":"IT","NAUKRI":"IT","TATAELXSI":"IT","LTTS":"IT",
    "BSOFT":"IT","KPITTECH":"IT","BANKBARODA":"Fin Ser-PSU Bank","PNB":"Fin Ser-PSU Bank",
    "CANBK":"Fin Ser-PSU Bank","FEDERALBNK":"Fin Ser-Pvt Bank","INDUSINDBK":"Fin Ser-Pvt Bank",
    "BANDHANBNK":"Fin Ser-Pvt Bank","AUBANK":"Fin Ser","CHOLAFIN":"Fin Ser-NBFC",
    "SHRIRAMFIN":"Fin Ser-NBFC","M_MFIN":"Fin Ser-NBFC","HDFCLIFE":"Fin Ser-Insurance",
    "SBILIFE":"Fin Ser-Insurance","ICICIGI":"Fin Ser-Insurance","HAL":"Capital Goods",
    "BEL":"Capital Goods","SIEMENS":"Capital Goods","TATAPOWER":"Power",
    "ADANIGREEN":"Power","ADANIPORTS":"Services","ZOMATO":"Consumer Services",
    "TRENT":"Consumer Services","POLYCAB":"Consumer Durables","DIXON":"Consumer Durables",
    "VOLTAS":"Consumer Durables","HAVELLS":"Consumer Durables","PIDILITIND":"Chemicals",
    "SRF":"Chemicals","DEEPAKNTR":"Chemicals","UPL":"Chemicals","ACC":"Cement",
    "AMBUJACEM":"Cement","SHREECEM":"Cement","DALBHARAT":"Cement","VEDL":"Metals & Mining",
    "SAIL":"Metals & Mining","JINDALSTEL":"Metals & Mining","HINDPETRO":"Oil Gas & Fuels",
    "IOC":"Oil Gas & Fuels","GAIL":"Oil Gas & Fuels","LUPIN":"Healthcare",
    "AUROPHARMA":"Healthcare","BIOCON":"Healthcare","APOLLOHOSP":"Healthcare",
    "TORNTPHARM":"Healthcare","MARICO":"FMCG","DABUR":"FMCG","COLPAL":"FMCG",
    "GODREJCP":"FMCG","M_M":"Automobile","ASHOKLEY":"Automobile","TVSMOTOR":"Automobile",
    "ESCORTS":"Automobile","INDUSTOWER":"Telecom","IDEA":"Telecom","OBEROIRLTY":"Realty",
    "PRESTIGE":"Realty","IRCTC":"Services","CONCOR":"Services","DELHIVERY":"Services",
    "MCX":"Fin Ser-Exchange","BSE":"Fin Ser-Exchange","CDSL":"Fin Ser","JIOFIN":"Fin Ser",
    "PAYTM":"Fin Ser","JUBLFOOD":"Consumer Services","INDHOTEL":"Consumer Services",
    "ZEEL":"Consumer Services","BOSCHLTD":"Auto Components","MOTHERSON":"Auto Components",
    "MRF":"Auto Components","360ONE":"Fin Ser","AARTIIND":"Chemicals","ABB":"Capital Goods",
    "ABCAPITAL":"Fin Ser-NBFC","ABFRL":"Consumer Services","ADANIENSOL":"Power",
    "ALKEM":"Healthcare","AMBER":"Consumer Durables","ANGELONE":"Fin Ser",
    "APLAPOLLO":"Metals & Mining","ASTRAL":"Capital Goods","ATGL":"Oil Gas & Fuels",
    "BALKRISIND":"Auto Components","BATAINDIA":"Consumer Durables","BERGEPAINT":"Consumer Durables",
    "BHARATFORG":"Auto Components","BHEL":"Capital Goods","CAMS":"Fin Ser",
    "CHAMBLFERT":"Chemicals","COROMANDEL":"Chemicals","CROMPTON":"Consumer Durables",
    "CUB":"Fin Ser-Pvt Bank","CUMMINSIND":"Capital Goods","CYIENT":"IT","DEVYANI":"Consumer Services",
    "EXIDEIND":"Auto Components","GLENMARK":"Healthcare","GMRAIRPORT":"Services",
    "GNFC":"Chemicals","GRANULES":"Healthcare","GUJGASLTD":"Oil Gas & Fuels",
    "HDFCAMC":"Fin Ser","HINDCOPPER":"Metals & Mining","HUDCO":"Fin Ser-NBFC",
    "ICICIPRULI":"Fin Ser-Insurance","IDFC":"Fin Ser-Pvt Bank","IEX":"Fin Ser-Exchange",
    "IGL":"Oil Gas & Fuels","INDIAMART":"IT","INDIANB":"Fin Ser-PSU Bank",
    "IPCALAB":"Healthcare","IRFC":"Fin Ser-NBFC","JKCEMENT":"Cement","JSL":"Metals & Mining",
    "JSWENERGY":"Power","KALYANKJIL":"Consumer Durables","KEI":"Capital Goods",
    "LALPATHLAB":"Healthcare","LAURUSLABS":"Healthcare","LICHSGFIN":"Fin Ser-NBFC",
    "MANAPPURAM":"Fin Ser-NBFC","MCDOWELL_N":"FMCG","METROPOLIS":"Healthcare",
    "MFSL":"Fin Ser-NBFC","MGL":"Oil Gas & Fuels","MUTHOOTFIN":"Fin Ser-NBFC",
    "NATIONALUM":"Metals & Mining","NAVINFLUOR":"Chemicals","NHPC":"Power","NMDC":"Metals & Mining",
    "OFSS":"IT","OIL":"Oil Gas & Fuels","PAGEIND":"Textiles","PATANJALI":"FMCG",
    "PEL":"Fin Ser-NBFC","PETRONET":"Oil Gas & Fuels","PFC":"Fin Ser-NBFC","PIIND":"Chemicals",
    "POONAWALLA":"Fin Ser-NBFC","PVRINOX":"Consumer Services","RAMCOCEM":"Cement",
    "RBLBANK":"Fin Ser-Pvt Bank","RECLTD":"Fin Ser-NBFC","SBICARD":"Fin Ser",
    "SJVN":"Power","SONACOMS":"Auto Components","STAR":"Consumer Services",
    "SUNTV":"Consumer Services","SUPREMEIND":"Capital Goods","SYNGENE":"Healthcare",
    "TATACHEM":"Chemicals","TATACOMM":"Telecom","TATACONSUM":"FMCG","TIINDIA":"Auto Components",
    "TORNTPOWER":"Power","UBL":"FMCG","UNIONBANK":"Fin Ser-PSU Bank","UNITDSPR":"FMCG",
    "UNOMINDA":"Auto Components","ZYDUSLIFE":"Healthcare","HCLTECH":"IT","HDFCBANK":"Fin Ser-Pvt Bank",
}

# ── Date helpers ──────────────────────────────────────────────────────────────
def trading_date(days_back=0):
    ist = datetime.utcnow() + timedelta(hours=5, minutes=30)
    ist -= timedelta(days=days_back)
    while ist.weekday() >= 5:   # skip Sat/Sun
        ist -= timedelta(days=1)
    dd   = ist.strftime("%d")
    mm   = ist.strftime("%m")
    yyyy = ist.strftime("%Y")
    mon  = MONTHS[ist.month - 1]
    return {"dd":dd,"mm":mm,"yyyy":yyyy,"mon":mon,"ddmmyyyy":dd+mm+yyyy,
            "label":f"{dd}-{mon}-{yyyy}"}

def bhav_urls(d):
    dd, mm, yyyy, mon, ddmmyyyy = d["dd"],d["mm"],d["yyyy"],d["mon"],d["ddmmyyyy"]
    return {
        "fo": [
            f"https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{ddmmyyyy}_F_0000.csv.zip",
            f"https://archives.nseindia.com/content/historical/DERIVATIVES/{yyyy}/{mon}/fo{dd}{mon}{yyyy}bhav.csv.zip",
        ],
        "cm": [
            f"https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{ddmmyyyy}_F_0000.csv.zip",
            f"https://archives.nseindia.com/content/historical/EQUITIES/{yyyy}/{mon}/cm{dd}{mon}{yyyy}bhav.csv.zip",
        ],
    }

# ── NSE session cookie (two-step) ─────────────────────────────────────────────
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
      "AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124.0.0.0 Safari/537.36")

def get_nse_cookie():
    global _nse_cookie
    if _nse_cookie["value"] and time.time() - _nse_cookie["ts"] < COOKIE_TTL:
        return _nse_cookie["value"]

    cj = CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(cj),
        urllib.request.HTTPSHandler(context=CTX)
    )

    try:
        # Step 1: NSE homepage
        req1 = urllib.request.Request("https://www.nseindia.com/", headers={"User-Agent":UA,"Accept":"text/html"})
        opener.open(req1, timeout=8)
        # Step 2: equity market page (acquires session cookies)
        cookie_str = "; ".join(f"{c.name}={c.value}" for c in cj)
        req2 = urllib.request.Request("https://www.nseindia.com/market-data/live-equity-market",
                                      headers={"User-Agent":UA,"Accept":"text/html","Referer":"https://www.nseindia.com/","Cookie":cookie_str})
        opener.open(req2, timeout=8)

        cookie_str = "; ".join(f"{c.name}={c.value}" for c in cj)
        _nse_cookie = {"value": cookie_str, "ts": time.time()}
        print(f"  [cookie] NSE session OK ({sum(1 for _ in cj)} cookies)")
        return cookie_str
    except Exception as e:
        print(f"  [cookie] Failed: {e}")
        return ""

# ── Download + unzip + return CSV text ───────────────────────────────────────
def fetch_zip_csv(urls):
    cookie = get_nse_cookie()
    headers = {
        "User-Agent": UA,
        "Accept": "application/octet-stream,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.nseindia.com/",
    }
    if cookie:
        headers["Cookie"] = cookie

    for url in urls:
        try:
            req = urllib.request.Request(url, headers=headers)
            r   = urllib.request.urlopen(req, timeout=20, context=CTX)
            raw = r.read()
            enc = r.headers.get("Content-Encoding","")
            if "gzip" in enc:
                raw = gzip.decompress(raw)
            zf = zipfile.ZipFile(io.BytesIO(raw))
            # Find CSV inside ZIP (case-insensitive)
            csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
            if not csv_names:
                print(f"  [zip] No CSV in {url.split('/')[-1]}. Entries: {zf.namelist()}")
                continue
            text = zf.read(csv_names[0]).decode("utf-8", errors="ignore")
            print(f"  [zip] OK: {url.split('/')[-1]} → {csv_names[0]}")
            return text
        except urllib.error.HTTPError as e:
            print(f"  [zip] HTTP {e.code}: {url.split('/')[-1]}")
        except Exception as e:
            print(f"  [zip] Error {url.split('/')[-1]}: {e}")
    return None

# ── CSV parser ────────────────────────────────────────────────────────────────
def parse_csv(text):
    lines   = text.replace("\r","").strip().split("\n")
    if len(lines) < 2: return []
    headers = [h.strip().upper().replace('"','') for h in lines[0].split(",")]
    rows    = []
    for line in lines[1:]:
        if not line.strip(): continue
        vals = line.split(",")
        row  = {headers[i]: (vals[i].strip().replace('"','') if i<len(vals) else "") for i in range(len(headers))}
        rows.append(row)
    return rows

def gf(row, *keys):
    for k in keys:
        v = row.get(k.upper(),"")
        if v: return v
    return ""

def num(v):
    try: return float(v) or 0.0
    except: return 0.0

def int_(v):
    try: return int(v) or 0
    except: return 0

# ── Process CM + FO rows → result dict ───────────────────────────────────────
def process_data(cm_rows, fo_rows):
    result = {}

    # Cash market
    for row in cm_rows:
        sym = gf(row, "SYMBOL","FININSTRMID","ISIN_CODE","SCRIP_CD")
        if not sym or len(sym) > 15: continue
        series = gf(row, "SERIES","SGT","FININSTRMTP")
        if series and series not in ("EQ","EQUITY"): continue
        result[sym] = {
            "sym":        sym,
            "sector":     SECTORS.get(sym,""),
            "cmp":        num(gf(row,"CLOSE","CLSPRIC","LASTPRIC")),
            "open":       num(gf(row,"OPEN","OPNPRIC")),
            "high":       num(gf(row,"HIGH","HGHPRIC")),
            "low":        num(gf(row,"LOW","LWPRIC")),
            "prevClose":  num(gf(row,"PREVCLOSE","PRVSCLSGPRIC","PREV_CLOSE")),
            "volume":     int_(gf(row,"TOTTRDQTY","TTLTRADGVOL","TTL_TRADG_VOL")),
            "turnoverCr": num(gf(row,"TOTTRDVAL","TTLTRFVAL")) / 1e7,
            "high52w":    num(gf(row,"52WK_H")) or None,
            "low52w":     num(gf(row,"52WK_L")) or None,
        }

    # F&O
    fut_map = {}
    opt_map = {}

    for row in fo_rows:
        inst = gf(row,"INSTRUMENT").upper()
        sym  = gf(row,"SYMBOL")
        if not sym or not inst: continue

        if inst in ("FUTSTK","FUTIDX"):
            expiry = gf(row,"EXPIRY_DT","EXPIRYDATE")
            if sym not in fut_map or expiry < fut_map[sym].get("_expiry",""):
                fut_map[sym] = {**row, "_expiry": expiry}

        if inst in ("OPTSTK","OPTIDX"):
            ot     = gf(row,"OPTION_TYP","OPTIONTYPE").upper()
            if ot not in ("CE","PE"): continue
            strike = gf(row,"STRIKE_PR","STRIKEPRICE")
            oi     = int_(gf(row,"OPEN_INT","OPENINT"))
            if sym not in opt_map: opt_map[sym] = {"CE":{},"PE":{}}
            opt_map[sym][ot][strike] = opt_map[sym][ot].get(strike,0) + oi

    for sym, fut_row in fut_map.items():
        if sym not in result: result[sym] = {"sym":sym,"sector":SECTORS.get(sym,"")}
        r = result[sym]
        r["futPrice"]    = num(gf(fut_row,"CLOSE","SETTLE_PR","SETTLEPR"))
        r["futOI"]       = int_(gf(fut_row,"OPEN_INT","OPENINT"))
        r["futOIChg"]    = int_(gf(fut_row,"CHG_IN_OI","CHGINOI"))
        r["futPrevOI"]   = max(0, r["futOI"] - r["futOIChg"])
        r["futOIChgPct"] = round(r["futOIChg"]/r["futPrevOI"]*100, 2) if r["futPrevOI"] > 0 else 0
        r["expiryDate"]  = gf(fut_row,"EXPIRY_DT","EXPIRYDATE")
        r["changePct"]   = round((r.get("cmp",0)-r.get("prevClose",0))/r.get("prevClose",1)*100, 2) if r.get("prevClose",0) > 0 else 0
        r["change"]      = round(r.get("cmp",0) - r.get("prevClose",0), 2)
        if r.get("futPrice") and r.get("cmp"):
            r["basis"]    = round(r["futPrice"] - r["cmp"], 2)
            r["basisPct"] = round(r["basis"] / r["cmp"] * 100, 3)
        px_up  = r.get("changePct",0) > 0
        oi_up  = r.get("futOIChg",0)  > 0
        r["signal"] = ("Long Buildup"   if  px_up and  oi_up else
                        "Short Buildup"  if not px_up and  oi_up else
                        "Long Unwinding" if not px_up and not oi_up else
                        "Short Covering")

    for sym, opts in opt_map.items():
        if sym not in result: result[sym] = {"sym":sym,"sector":SECTORS.get(sym,"")}
        r   = result[sym]
        ce  = [(float(k),v) for k,v in opts["CE"].items()]
        pe  = [(float(k),v) for k,v in opts["PE"].items()]
        tce = sum(v for _,v in ce)
        tpe = sum(v for _,v in pe)
        r["totalCEOI"] = tce
        r["totalPEOI"] = tpe
        r["pcr"]       = round(tpe/tce, 3) if tce > 0 else None
        if ce:
            mx = max(ce, key=lambda x:x[1])
            r["maxCEStrike"], r["maxCEOI"] = mx
        if pe:
            mx = max(pe, key=lambda x:x[1])
            r["maxPEStrike"], r["maxPEOI"] = mx

    return result

# ── Load data for a specific date ─────────────────────────────────────────────
def load_bhavcopy(days_back=0):
    d    = trading_date(days_back)
    urls = bhav_urls(d)
    print(f"  [bhav] Trying {d['label']}")
    fo_text = fetch_zip_csv(urls["fo"])
    cm_text = fetch_zip_csv(urls["cm"])
    if not fo_text or not cm_text:
        return None, None
    fo_rows = parse_csv(fo_text)
    cm_rows = parse_csv(cm_text)
    print(f"  [bhav] Parsed {len(cm_rows)} CM + {len(fo_rows)} FO rows")
    data = process_data(cm_rows, fo_rows)
    return data, d["label"]

# ── Get data (cached) ─────────────────────────────────────────────────────────
def get_data():
    with _cache_lock:
        if _cache["data"] and time.time() - _cache["ts"] < CACHE_TTL:
            return _cache["data"], _cache["date"], "cache"

    ist = datetime.utcnow() + timedelta(hours=5, minutes=30)
    start = 1 if ist.hour < 18 else 0   # Bhavcopy releases ~6 PM IST

    for extra in range(5):
        data, date = load_bhavcopy(start + extra)
        if data:
            with _cache_lock:
                _cache["data"] = data
                _cache["date"] = date
                _cache["ts"]   = time.time()
            return data, date, "nse-bhavcopy"

    return None, None, "unavailable"

# ── HTTP Handler ──────────────────────────────────────────────────────────────
class Handler(http.server.BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self._cors(); self.end_headers()

    def do_GET(self):
        p  = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(p.query)

        # Serve dashboard HTML
        if p.path in ("/", "/index.html", "/dashboard"):
            return self._serve_file("index.html", "text/html")

        if p.path == "/api/status":
            return self._json({"ok": True, "source": "nse-bhavcopy",
                                "cached": bool(_cache["data"]), "date": _cache["date"]})

        if p.path == "/api/bhavcopy":
            syms  = [s.strip().upper() for s in (qs.get("symbols",[""])[0]).split(",") if s.strip()]
            data, date, source = get_data()
            if not data:
                return self._json({"success":False,"blocked":False,
                    "error":"Bhavcopy unavailable. Files release ~6 PM IST. Try again later."}, 503)
            out = {k:v for k,v in data.items() if (not syms or k in syms)}
            return self._json({"success":True,"source":source,"date":date,
                                "totalSymbols":len(data),"data":out})

        if p.path == "/api/stock":
            sym = (qs.get("symbol",[""])[0]).strip().upper()
            if not sym:
                return self._json({"error":"symbol required"}, 400)
            data, date, source = get_data()
            if not data:
                return self._json({"success":False,"error":"Bhavcopy not yet loaded"}, 503)
            stock = data.get(sym)
            if not stock:
                return self._json({"success":False,"error":f"'{sym}' not found in Bhavcopy"}, 404)
            return self._json({"success":True,"source":source,"date":date,"data":stock})

        self.send_error(404)

    def do_POST(self):
        p = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        body   = json.loads(self.rfile.read(length)) if length else {}

        # Manual CSV upload
        if p.path == "/api/bhavcopy":
            cm_csv = body.get("cmCsv","")
            fo_csv = body.get("foCsv","")
            if not cm_csv or not fo_csv:
                return self._json({"success":False,"error":"cmCsv and foCsv required"}, 400)
            cm_rows = parse_csv(cm_csv)
            fo_rows = parse_csv(fo_csv)
            if len(cm_rows) < 5:
                return self._json({"success":False,"error":"CM CSV too short"}, 400)
            data = process_data(cm_rows, fo_rows)
            date_str = body.get("date", datetime.now().strftime("%d-%b-%Y").upper())
            with _cache_lock:
                _cache["data"] = data; _cache["date"] = date_str; _cache["ts"] = time.time()
            qs   = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            syms = [s.strip().upper() for s in (qs.get("symbols",[""])[0]).split(",") if s.strip()]
            out  = {k:v for k,v in data.items() if (not syms or k in syms)}
            return self._json({"success":True,"source":"manual-upload","date":date_str,
                                "totalSymbols":len(data),"data":out})

        self.send_error(404)

    def _cors(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, data, code=200):
        body = json.dumps(data, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, name, ctype):
        fpath = os.path.join(os.path.dirname(os.path.abspath(__file__)), name)
        if not os.path.exists(fpath):
            self.send_error(404, f"{name} not found")
            return
        with open(fpath, "rb") as f:
            content = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", len(content))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, fmt, *args):
        if "/api/" in str(args[0]):
            print(f"  [http] {args[0]}")

# ── Pre-fetch data in background on startup ───────────────────────────────────
def prefetch():
    print("  Pre-fetching Bhavcopy in background…")
    get_data()

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "="*60)
    print("  MKTDESK — NSE Bhavcopy Edition")
    print("  Free data · No API key · No token expiry")
    print("="*60)
    print(f"\n  Dashboard: http://localhost:{PORT}")
    print(f"  API:       http://localhost:{PORT}/api/bhavcopy")
    print("  Press Ctrl+C to stop.\n")

    threading.Thread(target=prefetch, daemon=True).start()

    server = http.server.HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"  Server ready on port {PORT}!\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")
        server.server_close()
