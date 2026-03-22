/**
 * api/bhavcopy.js — Vercel Serverless Function
 *
 * Two data paths:
 *   GET  /api/bhavcopy?symbols=...  — auto-fetch from NSE archives
 *   POST /api/bhavcopy  { cmCsv, foCsv, date }  — manual upload fallback
 *
 * NSE's nsearchives domain is behind Cloudflare, which blocks cloud-provider
 * IPs. If auto-fetch fails (blocked:true in response), the frontend shows an
 * upload UI so the user can paste/upload the CSV content directly.
 */

import AdmZip from "adm-zip";

// ─── Cache ────────────────────────────────────────────────────────────────────
let _cache     = { data: null, date: null, ts: 0 };
let _nseCookie = { value: "", ts: 0 };
const CACHE_MS  = 5  * 60 * 1000;
const COOKIE_MS = 20 * 60 * 1000;

// ─── Date helpers ─────────────────────────────────────────────────────────────
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function tradingDate(daysBack = 0) {
  const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  ist.setDate(ist.getDate() - daysBack);
  while (ist.getDay() === 0 || ist.getDay() === 6) ist.setDate(ist.getDate() - 1);
  const dd   = String(ist.getDate()).padStart(2, "0");
  const mm   = String(ist.getMonth() + 1).padStart(2, "0");
  const yyyy = String(ist.getFullYear());
  const mon  = MONTHS[ist.getMonth()];
  return { dd, mm, yyyy, mon, ddmmyyyy:`${dd}${mm}${yyyy}`, label:`${dd}-${mon}-${yyyy}` };
}

function bhavUrls({ dd, mm, yyyy, mon, ddmmyyyy }) {
  return {
    fo: [
      `https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_${ddmmyyyy}_F_0000.csv.zip`,
      `https://archives.nseindia.com/content/historical/DERIVATIVES/${yyyy}/${mon}/fo${dd}${mon}${yyyy}bhav.csv.zip`,
    ],
    cm: [
      `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${ddmmyyyy}_F_0000.csv.zip`,
      `https://archives.nseindia.com/content/historical/EQUITIES/${yyyy}/${mon}/cm${dd}${mon}${yyyy}bhav.csv.zip`,
    ],
  };
}

// ─── NSE two-step cookie acquisition ─────────────────────────────────────────
async function getNseCookie() {
  if (_nseCookie.value && Date.now() - _nseCookie.ts < COOKIE_MS) return _nseCookie.value;

  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  const jar = new Map();

  const collect = (res) => {
    const all = res.headers.getSetCookie?.() ?? [];
    for (const c of all) {
      const [kv] = c.split(";");
      const eq   = kv.indexOf("=");
      if (eq > 0) jar.set(kv.slice(0, eq).trim(), kv.slice(eq + 1).trim());
    }
  };
  const cookieStr = () => [...jar.entries()].map(([k,v])=>`${k}=${v}`).join("; ");

  try {
    const r1 = await fetch("https://www.nseindia.com/", {
      headers: { "User-Agent":UA, "Accept":"text/html", "Accept-Language":"en-US,en;q=0.9" },
      signal: AbortSignal.timeout(8000),
    });
    collect(r1);

    const r2 = await fetch("https://www.nseindia.com/market-data/live-equity-market", {
      headers: { "User-Agent":UA, "Accept":"text/html", "Referer":"https://www.nseindia.com/", "Cookie":cookieStr() },
      signal: AbortSignal.timeout(8000),
    });
    collect(r2);

    const cookie = cookieStr();
    if (jar.size > 0) {
      _nseCookie = { value: cookie, ts: Date.now() };
      console.log(`[bhav] cookies acquired: ${[...jar.keys()].join(", ")}`);
    }
    return cookie;
  } catch (e) {
    console.warn(`[bhav] cookie error: ${e.message}`);
    return "";
  }
}

// ─── Fetch ZIP → CSV ──────────────────────────────────────────────────────────
async function fetchZipCSV(urls) {
  const cookie = await getNseCookie();
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          "Accept": "application/octet-stream,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://www.nseindia.com/",
          ...(cookie ? { "Cookie": cookie } : {}),
        },
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) { console.warn(`[bhav] ${url} → HTTP ${res.status}`); continue; }

      const buf   = Buffer.from(await res.arrayBuffer());
      const zip   = new AdmZip(buf);
      const entry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith(".csv"));
      if (!entry) { console.warn(`[bhav] No CSV entry. Found: ${zip.getEntries().map(e=>e.entryName).join(", ")}`); continue; }
      console.log(`[bhav] OK ${url.split("/").at(-1)} → ${entry.entryName}`);
      return entry.getData().toString("utf-8");
    } catch (e) {
      console.warn(`[bhav] ${url}: ${e.message}`);
    }
  }
  return null;
}

// ─── CSV parser ───────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.replace(/\r/g, "").trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().toUpperCase().replace(/"/g, ""));
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = line.split(",");
    const row  = {};
    headers.forEach((h, i) => { row[h] = (vals[i] || "").trim().replace(/"/g, ""); });
    return row;
  });
}

const gf   = (row, ...keys) => { for (const k of keys) { const v=row[k.toUpperCase()]; if(v!==undefined&&v!=="") return v; } return ""; };
const num  = v => parseFloat(v)   || 0;
const int_ = v => parseInt(v, 10) || 0;

// ─── Build result object from CM + FO rows ────────────────────────────────────
function processData(cmRows, foRows) {
  const result = {};

  for (const row of cmRows) {
    const sym = gf(row, "SYMBOL", "FININSTRMID", "ISIN_CODE", "SCRIP_CD");
    if (!sym || sym.length > 15) continue;
    const series = gf(row, "SERIES", "SGT", "FININSTRMTP");
    if (series && series !== "EQ" && series !== "EQUITY") continue;
    result[sym] = {
      sym,
      cmp:       num(gf(row, "CLOSE","CLSPRIC","LASTPRIC")),
      open:      num(gf(row, "OPEN","OPNPRIC")),
      high:      num(gf(row, "HIGH","HGHPRIC")),
      low:       num(gf(row, "LOW","LWPRIC")),
      prevClose: num(gf(row, "PREVCLOSE","PRVSCLSGPRIC","PREV_CLOSE")),
      volume:    int_(gf(row, "TOTTRDQTY","TTLTRADGVOL","TTL_TRADG_VOL")),
      turnoverCr:num(gf(row, "TOTTRDVAL","TTLTRFVAL")) / 1e7 || 0,
      high52w:   num(gf(row, "52WK_H")) || null,
      low52w:    num(gf(row, "52WK_L")) || null,
    };
  }

  const futMap = {}, optMap = {};

  for (const row of foRows) {
    const inst = gf(row, "INSTRUMENT").toUpperCase();
    const sym  = gf(row, "SYMBOL");
    if (!sym || !inst) continue;

    if (inst === "FUTSTK" || inst === "FUTIDX") {
      const expiry = gf(row, "EXPIRY_DT", "EXPIRYDATE");
      if (!futMap[sym] || expiry < futMap[sym]._expiry) futMap[sym] = { ...row, _expiry: expiry };
    }

    if (inst === "OPTSTK" || inst === "OPTIDX") {
      const ot = gf(row, "OPTION_TYP", "OPTIONTYPE").toUpperCase();
      if (ot !== "CE" && ot !== "PE") continue;
      const strike = gf(row, "STRIKE_PR", "STRIKEPRICE");
      const oi     = int_(gf(row, "OPEN_INT", "OPENINT"));
      if (!optMap[sym]) optMap[sym] = { CE:{}, PE:{} };
      optMap[sym][ot][strike] = (optMap[sym][ot][strike] || 0) + oi;
    }
  }

  for (const [sym, futRow] of Object.entries(futMap)) {
    if (!result[sym]) result[sym] = { sym };
    const r      = result[sym];
    r.futPrice    = num(gf(futRow, "CLOSE","SETTLE_PR","SETTLEPR"));
    r.futOI       = int_(gf(futRow, "OPEN_INT","OPENINT"));
    r.futOIChg    = int_(gf(futRow, "CHG_IN_OI","CHGINOI"));
    r.futPrevOI   = Math.max(0, r.futOI - r.futOIChg);
    r.futOIChgPct = r.futPrevOI > 0 ? parseFloat(((r.futOIChg/r.futPrevOI)*100).toFixed(2)) : 0;
    r.expiryDate  = gf(futRow, "EXPIRY_DT", "EXPIRYDATE");
    r.changePct   = r.prevClose > 0 ? parseFloat(((r.cmp-r.prevClose)/r.prevClose*100).toFixed(2)) : 0;
    r.change      = parseFloat((r.cmp - r.prevClose).toFixed(2));
    if (r.futPrice && r.cmp) {
      r.basis    = parseFloat((r.futPrice - r.cmp).toFixed(2));
      r.basisPct = parseFloat(((r.basis / r.cmp) * 100).toFixed(3));
    }
    const pu = r.changePct > 0, ou = r.futOIChg > 0;
    r.signal = pu&&ou?"Long Buildup":!pu&&ou?"Short Buildup":!pu&&!ou?"Long Unwinding":"Short Covering";
  }

  for (const [sym, opts] of Object.entries(optMap)) {
    if (!result[sym]) result[sym] = { sym };
    const r = result[sym];
    const ceE = Object.entries(opts.CE).map(([k,v])=>[parseFloat(k),v]);
    const peE = Object.entries(opts.PE).map(([k,v])=>[parseFloat(k),v]);
    const tCE = ceE.reduce((s,[,v])=>s+v, 0);
    const tPE = peE.reduce((s,[,v])=>s+v, 0);
    r.totalCEOI = tCE; r.totalPEOI = tPE;
    r.pcr = tCE > 0 ? parseFloat((tPE/tCE).toFixed(3)) : null;
    if (ceE.length) { const [s,o]=ceE.reduce((a,b)=>b[1]>a[1]?b:a); r.maxCEStrike=s; r.maxCEOI=o; }
    if (peE.length) { const [s,o]=peE.reduce((a,b)=>b[1]>a[1]?b:a); r.maxPEStrike=s; r.maxPEOI=o; }
  }

  return result;
}

function filterSymbols(data, q) {
  if (!q) return data;
  const syms = q.split(",").map(s => s.trim().toUpperCase());
  return Object.fromEntries(syms.filter(s => data[s]).map(s => [s, data[s]]));
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // POST → manual CSV upload
  if (req.method === "POST") {
    try {
      const { cmCsv, foCsv, date } = req.body || {};
      if (!cmCsv || !foCsv) return res.status(400).json({ success:false, error:"Both cmCsv and foCsv required." });
      const cmRows = parseCSV(cmCsv);
      const foRows = parseCSV(foCsv);
      if (cmRows.length < 5) return res.status(400).json({ success:false, error:"CM CSV too short — paste the full file content." });
      if (foRows.length < 5) return res.status(400).json({ success:false, error:"FO CSV too short — paste the full file content." });
      const data    = processData(cmRows, foRows);
      const dateStr = date || new Date().toLocaleDateString("en-IN", { timeZone:"Asia/Kolkata" });
      _cache = { data, date: dateStr, ts: Date.now() };
      return res.json({ success:true, source:"manual-upload", date:dateStr, totalSymbols:Object.keys(data).length, data:filterSymbols(data, req.query.symbols) });
    } catch (e) {
      return res.status(500).json({ success:false, error:e.message });
    }
  }

  // GET → serve cache
  if (_cache.data && Date.now() - _cache.ts < CACHE_MS) {
    return res.json({ success:true, source:"cache", date:_cache.date, data:filterSymbols(_cache.data, req.query.symbols) });
  }

  // GET → auto-fetch NSE
  const ist       = new Date(new Date().toLocaleString("en-US", { timeZone:"Asia/Kolkata" }));
  const startBack = ist.getHours() < 18 ? 1 : 0;

  for (let i = 0; i <= 4; i++) {
    const d    = tradingDate(startBack + i);
    const urls = bhavUrls(d);
    console.log(`[bhav] trying ${d.label}`);
    const [foText, cmText] = await Promise.all([fetchZipCSV(urls.fo), fetchZipCSV(urls.cm)]);
    if (!foText || !cmText) continue;
    const data = processData(parseCSV(cmText), parseCSV(foText));
    _cache = { data, date: d.label, ts: Date.now() };
    return res.json({ success:true, source:"nse-bhavcopy", date:d.label, totalSymbols:Object.keys(data).length, data:filterSymbols(data, req.query.symbols) });
  }

  // All auto-fetch attempts failed
  return res.status(503).json({
    success: false,
    blocked: true,
    error: "NSE auto-fetch blocked (Cloudflare). Use the Upload CSVs button in the dashboard.",
    downloadUrl: "https://www.nseindia.com/market-data/exchange-statistics",
  });
}
