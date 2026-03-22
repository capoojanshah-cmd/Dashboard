/**
 * api/bhavcopy.js — Vercel Serverless Function
 * Fetches NSE CM + FO Bhavcopy, parses CSV from ZIP, returns processed JSON.
 * No authentication required. NSE releases Bhavcopy ~6 PM IST on trading days.
 *
 * GET /api/bhavcopy?symbols=RELIANCE,TCS,INFY
 * Returns: { success, date, data: { [SYMBOL]: { cmp, changePct, futOI, pcr, signal, ... } } }
 */

import AdmZip from "adm-zip";

// ── In-memory cache (lives for the lifetime of the Lambda instance) ─────────
let _cache = { data: null, date: null, ts: 0 };
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Date helpers ─────────────────────────────────────────────────────────────
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function getLastTradingDay(daysBack = 0) {
  const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  // Bhavcopy released ~18:00 IST. Before that, use previous day.
  if (ist.getHours() < 18) ist.setDate(ist.getDate() - 1);
  ist.setDate(ist.getDate() - daysBack);
  // Skip weekends
  while (ist.getDay() === 0 || ist.getDay() === 6) ist.setDate(ist.getDate() - 1);
  const dd   = String(ist.getDate()).padStart(2, "0");
  const mm   = String(ist.getMonth() + 1).padStart(2, "0");
  const yyyy = String(ist.getFullYear());
  const mon  = MONTHS[ist.getMonth()];
  return { dd, mm, yyyy, mon, ddmmyyyy: `${dd}${mm}${yyyy}` };
}

// ── NSE Bhavcopy URL patterns (tries new format first, falls back to old) ────
function bhavUrls({ dd, mm, yyyy, mon, ddmmyyyy }) {
  return {
    fo: [
      // New NSE archive format (2023+)
      `https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_${ddmmyyyy}_F_0000.csv.zip`,
      // Old NSE archive format
      `https://archives.nseindia.com/content/historical/DERIVATIVES/${yyyy}/${mon}/fo${dd}${mon}${yyyy}bhav.csv.zip`,
    ],
    cm: [
      `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${ddmmyyyy}_F_0000.csv.zip`,
      `https://archives.nseindia.com/content/historical/EQUITIES/${yyyy}/${mon}/cm${dd}${mon}${yyyy}bhav.csv.zip`,
    ],
  };
}

// ── Fetch + unzip + return CSV text ──────────────────────────────────────────
async function fetchZipCSV(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/octet-stream,*/*",
          Referer: "https://www.nseindia.com/",
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) { console.warn(`[bhavcopy] ${url} → HTTP ${res.status}`); continue; }
      const buf  = Buffer.from(await res.arrayBuffer());
      const zip  = new AdmZip(buf);
      const csvEntry = zip.getEntries().find((e) => e.entryName.endsWith(".csv"));
      if (!csvEntry) { console.warn(`[bhavcopy] No CSV in ZIP at ${url}`); continue; }
      console.log(`[bhavcopy] OK: ${url}`);
      return csvEntry.getData().toString("utf-8");
    } catch (err) {
      console.warn(`[bhavcopy] fetch failed ${url}: ${err.message}`);
    }
  }
  return null;
}

// ── Simple CSV parser ─────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.replace(/\r/g, "").trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toUpperCase().replace(/"/g, ""));
  return lines.slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const vals = line.split(",");
      const row  = {};
      headers.forEach((h, i) => { row[h] = (vals[i] || "").trim().replace(/"/g, ""); });
      return row;
    });
}

// ── Get a field value tolerating multiple column name variants ───────────────
const gf = (row, ...keys) => {
  for (const k of keys) {
    const v = row[k.toUpperCase()];
    if (v !== undefined && v !== "") return v;
  }
  return "";
};
const num  = (v) => parseFloat(v) || 0;
const int_ = (v) => parseInt(v)   || 0;

// ── Process CM + FO rows into a symbol-keyed object ──────────────────────────
function processData(cmRows, foRows) {
  const result = {};

  // ── Cash market (price data) ────────────────────────────────────────────
  for (const row of cmRows) {
    // Support both old (SYMBOL) and new (FININSTRMID / ISINCODE) columns
    const sym = gf(row, "SYMBOL", "FININSTRMID", "ISIN_CODE") || gf(row, "SCRIP_CD");
    if (!sym || sym.length > 15) continue;
    // Only include EQ series (skip BE, N, etc.)
    const series = gf(row, "SERIES", "SGT", "FININSTRMTP");
    if (series && series !== "EQ" && series !== "EQUITY") continue;

    result[sym] = {
      sym,
      cmp:       num(gf(row, "CLOSE", "CLSPRIC", "LASTPRIC")),
      open:      num(gf(row, "OPEN",  "OPNPRIC")),
      high:      num(gf(row, "HIGH",  "HGHPRIC")),
      low:       num(gf(row, "LOW",   "LWPRIC")),
      prevClose: num(gf(row, "PREVCLOSE", "PRVSCLSGPRIC", "PREV_CLOSE")),
      volume:    int_(gf(row, "TOTTRDQTY", "TTLTRADGVOL", "TTL_TRADG_VOL")),
      turnoverCr:num(gf(row, "TOTTRDVAL", "TTLTRFVAL")) / 1e7 || 0,
      high52w:   num(gf(row, "52WK_H")) || null,
      low52w:    num(gf(row, "52WK_L")) || null,
    };
  }

  // ── F&O (futures + options data) ─────────────────────────────────────────
  const futMap = {};  // sym → nearest-expiry futures row
  const optMap = {};  // sym → { CE: {strike→totalOI}, PE: ... }

  for (const row of foRows) {
    const inst = gf(row, "INSTRUMENT").toUpperCase();
    const sym  = gf(row, "SYMBOL");
    if (!sym || !inst) continue;

    // ── Futures ────────────────────────────────────────────────────
    if (inst === "FUTSTK" || inst === "FUTIDX") {
      const expiry = gf(row, "EXPIRY_DT", "EXPIRYDATE");
      if (!futMap[sym] || expiry < futMap[sym]._expiry) {
        futMap[sym] = { ...row, _expiry: expiry };
      }
    }

    // ── Options ────────────────────────────────────────────────────
    if (inst === "OPTSTK" || inst === "OPTIDX") {
      const optType = gf(row, "OPTION_TYP", "OPTIONTYPE").toUpperCase();
      if (optType !== "CE" && optType !== "PE") continue;
      const strike  = gf(row, "STRIKE_PR", "STRIKEPRICE");
      const oi      = int_(gf(row, "OPEN_INT", "OPENINT"));
      if (!optMap[sym]) optMap[sym] = { CE: {}, PE: {} };
      // Aggregate OI across expiries per strike
      optMap[sym][optType][strike] = (optMap[sym][optType][strike] || 0) + oi;
    }
  }

  // ── Merge futures data ───────────────────────────────────────────────────
  for (const [sym, futRow] of Object.entries(futMap)) {
    if (!result[sym]) result[sym] = { sym };
    const r = result[sym];
    r.futPrice    = num(gf(futRow, "CLOSE", "SETTLE_PR", "SETTLEPR"));
    r.futOI       = int_(gf(futRow, "OPEN_INT", "OPENINT"));
    r.futOIChg    = int_(gf(futRow, "CHG_IN_OI", "CHGINOI"));
    r.futPrevOI   = Math.max(0, r.futOI - r.futOIChg);
    r.futOIChgPct = r.futPrevOI > 0
      ? parseFloat(((r.futOIChg / r.futPrevOI) * 100).toFixed(2))
      : 0;
    r.expiryDate  = gf(futRow, "EXPIRY_DT", "EXPIRYDATE");

    // Change % from CM data
    r.changePct = r.prevClose > 0
      ? parseFloat(((r.cmp - r.prevClose) / r.prevClose * 100).toFixed(2))
      : 0;
    r.change = parseFloat((r.cmp - r.prevClose).toFixed(2));

    // Basis
    if (r.futPrice && r.cmp) {
      r.basis    = parseFloat((r.futPrice - r.cmp).toFixed(2));
      r.basisPct = parseFloat(((r.basis / r.cmp) * 100).toFixed(3));
    }

    // OI-Price signal
    const pxUp = r.changePct > 0;
    const oiUp = r.futOIChg  > 0;
    if      ( pxUp &&  oiUp) r.signal = "Long Buildup";
    else if (!pxUp &&  oiUp) r.signal = "Short Buildup";
    else if (!pxUp && !oiUp) r.signal = "Long Unwinding";
    else                     r.signal = "Short Covering";
  }

  // ── Merge options data (PCR, max CE/PE strikes) ──────────────────────────
  for (const [sym, opts] of Object.entries(optMap)) {
    if (!result[sym]) result[sym] = { sym };
    const r = result[sym];

    const ceEntries = Object.entries(opts.CE).map(([k, v]) => [parseFloat(k), v]);
    const peEntries = Object.entries(opts.PE).map(([k, v]) => [parseFloat(k), v]);

    const totalCE = ceEntries.reduce((s, [, v]) => s + v, 0);
    const totalPE = peEntries.reduce((s, [, v]) => s + v, 0);
    r.totalCEOI = totalCE;
    r.totalPEOI = totalPE;
    r.pcr = totalCE > 0 ? parseFloat((totalPE / totalCE).toFixed(3)) : null;

    if (ceEntries.length) {
      const [strike, oi] = ceEntries.reduce((a, b) => b[1] > a[1] ? b : a);
      r.maxCEStrike = strike;  r.maxCEOI = oi;
    }
    if (peEntries.length) {
      const [strike, oi] = peEntries.reduce((a, b) => b[1] > a[1] ? b : a);
      r.maxPEStrike = strike;  r.maxPEOI = oi;
    }
  }

  return result;
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  // Return cached data if fresh
  if (_cache.data && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return res.json({ success: true, source: "cache", date: _cache.date, data: filterSymbols(_cache.data, req.query.symbols) });
  }

  // Try up to 4 trading days back (handles holidays, late releases)
  for (let back = 0; back <= 4; back++) {
    const dateInfo = getLastTradingDay(back);
    const urls     = bhavUrls(dateInfo);
    const label    = `${dateInfo.dd}-${dateInfo.mon}-${dateInfo.yyyy}`;

    console.log(`[bhavcopy] Trying date: ${label}`);

    const [foText, cmText] = await Promise.all([
      fetchZipCSV(urls.fo),
      fetchZipCSV(urls.cm),
    ]);

    if (!foText || !cmText) continue;

    const foRows = parseCSV(foText);
    const cmRows = parseCSV(cmText);
    console.log(`[bhavcopy] Parsed: ${cmRows.length} CM rows, ${foRows.length} FO rows`);

    const data = processData(cmRows, foRows);
    _cache = { data, date: label, ts: Date.now() };

    return res.json({
      success: true,
      source: "nse-bhavcopy",
      date: label,
      totalSymbols: Object.keys(data).length,
      data: filterSymbols(data, req.query.symbols),
    });
  }

  return res.status(503).json({
    success: false,
    error: "NSE Bhavcopy unavailable for last 4 trading days. Try again after 6 PM IST.",
  });
}

function filterSymbols(data, symsQuery) {
  if (!symsQuery) return data;
  const list = symsQuery.split(",").map((s) => s.trim().toUpperCase());
  return Object.fromEntries(list.filter((s) => data[s]).map((s) => [s, data[s]]));
}
