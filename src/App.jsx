/**
 * MKTDESK — NSE Bhavcopy Edition
 * Search any NSE F&O or Cash symbol → adds to watchlist → fetches Bhavcopy data
 * Result Trades: fully manual (blank on start)
 * Swing Trades: template prefilled (clear via the form)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

/* ─── Fonts + CSS ────────────────────────────────────────────────────────── */
const Styles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#060b11;--bg2:#0c1420;--bg3:#111d2c;
      --border:#1a2f45;--border2:#1f3a56;
      --blue:#1e90ff;--blue2:#0d6edf;--blue-dim:rgba(30,144,255,.12);
      --amber:#f59e0b;--amber-dim:rgba(245,158,11,.12);
      --green:#10b981;--green-dim:rgba(16,185,129,.12);
      --red:#ef4444;--red-dim:rgba(239,68,68,.12);
      --purple:#8b5cf6;
      --text:#c9d8e8;--text2:#7a9ab8;--text3:#3d5a78;
      --mono:'IBM Plex Mono',monospace;--sans:'IBM Plex Sans',sans-serif;
    }
    body{background:var(--bg);color:var(--text);font-family:var(--sans)}
    input,select,textarea{font-family:var(--sans)}
    ::-webkit-scrollbar{width:4px;height:4px}
    ::-webkit-scrollbar-track{background:var(--bg2)}
    ::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
    @keyframes ticker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
    .fade{animation:fadeIn .2s ease forwards}
    .spin{animation:spin .9s linear infinite}
    .acl-item:hover{background:var(--bg3)!important}
  `}</style>
);

/* ─── Full F&O universe (213 stocks) with sector tags ───────────────────── */
const FO_LIST = [
  {s:"360ONE",c:"Fin Ser"},{s:"AARTIIND",c:"Chemicals"},{s:"ABB",c:"Capital Goods"},
  {s:"ABCAPITAL",c:"Fin Ser-NBFC"},{s:"ABFRL",c:"Consumer Services"},{s:"ACC",c:"Cement"},
  {s:"ADANIENSOL",c:"Power"},{s:"ADANIENT",c:"Metals & Mining"},{s:"ADANIGREEN",c:"Power"},
  {s:"ADANIPORTS",c:"Services"},{s:"ALKEM",c:"Healthcare"},{s:"AMBER",c:"Consumer Durables"},
  {s:"AMBUJACEM",c:"Cement"},{s:"ANGELONE",c:"Fin Ser"},{s:"APLAPOLLO",c:"Metals & Mining"},
  {s:"APOLLOHOSP",c:"Healthcare"},{s:"ASHOKLEY",c:"Automobile"},{s:"ASIANPAINT",c:"Consumer Durables"},
  {s:"ASTRAL",c:"Capital Goods"},{s:"ATGL",c:"Oil Gas & Fuels"},{s:"AUBANK",c:"Fin Ser"},
  {s:"AUROPHARMA",c:"Healthcare"},{s:"AXISBANK",c:"Fin Ser-Pvt Bank"},{s:"BAJAJ_AUTO",c:"Automobile"},
  {s:"BAJAJFINSV",c:"Fin Ser-NBFC"},{s:"BAJFINANCE",c:"Fin Ser-NBFC"},{s:"BALKRISIND",c:"Auto Components"},
  {s:"BANDHANBNK",c:"Fin Ser-Pvt Bank"},{s:"BANKBARODA",c:"Fin Ser-PSU Bank"},{s:"BATAINDIA",c:"Consumer Durables"},
  {s:"BEL",c:"Capital Goods"},{s:"BERGEPAINT",c:"Consumer Durables"},{s:"BHARATFORG",c:"Auto Components"},
  {s:"BHARTIARTL",c:"Telecom"},{s:"BHEL",c:"Capital Goods"},{s:"BIOCON",c:"Healthcare"},
  {s:"BOSCHLTD",c:"Auto Components"},{s:"BPCL",c:"Oil Gas & Fuels"},{s:"BRITANNIA",c:"FMCG"},
  {s:"BSE",c:"Fin Ser-Exchange"},{s:"BSOFT",c:"IT"},{s:"CAMS",c:"Fin Ser"},
  {s:"CANBK",c:"Fin Ser-PSU Bank"},{s:"CDSL",c:"Fin Ser"},{s:"CHAMBLFERT",c:"Chemicals"},
  {s:"CHOLAFIN",c:"Fin Ser-NBFC"},{s:"CIPLA",c:"Healthcare"},{s:"COALINDIA",c:"Metals & Mining"},
  {s:"COFORGE",c:"IT"},{s:"COLPAL",c:"FMCG"},{s:"CONCOR",c:"Services"},
  {s:"COROMANDEL",c:"Chemicals"},{s:"CROMPTON",c:"Consumer Durables"},{s:"CUB",c:"Fin Ser-Pvt Bank"},
  {s:"CUMMINSIND",c:"Capital Goods"},{s:"CYIENT",c:"IT"},{s:"DABUR",c:"FMCG"},
  {s:"DALBHARAT",c:"Cement"},{s:"DEEPAKNTR",c:"Chemicals"},{s:"DELHIVERY",c:"Services"},
  {s:"DEVYANI",c:"Consumer Services"},{s:"DIVISLAB",c:"Healthcare"},{s:"DIXON",c:"Consumer Durables"},
  {s:"DLF",c:"Realty"},{s:"DRREDDY",c:"Healthcare"},{s:"EICHERMOT",c:"Automobile"},
  {s:"ESCORTS",c:"Automobile"},{s:"EXIDEIND",c:"Auto Components"},{s:"FEDERALBNK",c:"Fin Ser-Pvt Bank"},
  {s:"GAIL",c:"Oil Gas & Fuels"},{s:"GLENMARK",c:"Healthcare"},{s:"GMRAIRPORT",c:"Services"},
  {s:"GNFC",c:"Chemicals"},{s:"GODREJCP",c:"FMCG"},{s:"GODREJPROP",c:"Realty"},
  {s:"GRANULES",c:"Healthcare"},{s:"GRASIM",c:"Cement"},{s:"GUJGASLTD",c:"Oil Gas & Fuels"},
  {s:"HAL",c:"Capital Goods"},{s:"HAVELLS",c:"Consumer Durables"},{s:"HCLTECH",c:"IT"},
  {s:"HDFCAMC",c:"Fin Ser"},{s:"HDFCBANK",c:"Fin Ser-Pvt Bank"},{s:"HDFCLIFE",c:"Fin Ser-Insurance"},
  {s:"HEROMOTOCO",c:"Automobile"},{s:"HINDALCO",c:"Metals & Mining"},{s:"HINDCOPPER",c:"Metals & Mining"},
  {s:"HINDPETRO",c:"Oil Gas & Fuels"},{s:"HINDUNILVR",c:"FMCG"},{s:"HUDCO",c:"Fin Ser-NBFC"},
  {s:"ICICIBANK",c:"Fin Ser-Pvt Bank"},{s:"ICICIGI",c:"Fin Ser-Insurance"},{s:"ICICIPRULI",c:"Fin Ser-Insurance"},
  {s:"IDEA",c:"Telecom"},{s:"IDFC",c:"Fin Ser-Pvt Bank"},{s:"IEX",c:"Fin Ser-Exchange"},
  {s:"IGL",c:"Oil Gas & Fuels"},{s:"INDHOTEL",c:"Consumer Services"},{s:"INDIAMART",c:"IT"},
  {s:"INDIANB",c:"Fin Ser-PSU Bank"},{s:"INDIGO",c:"Services"},{s:"INDUSINDBK",c:"Fin Ser-Pvt Bank"},
  {s:"INDUSTOWER",c:"Telecom"},{s:"INFY",c:"IT"},{s:"IOC",c:"Oil Gas & Fuels"},
  {s:"IPCALAB",c:"Healthcare"},{s:"IRCTC",c:"Services"},{s:"IRFC",c:"Fin Ser-NBFC"},
  {s:"ITC",c:"FMCG"},{s:"JINDALSTEL",c:"Metals & Mining"},{s:"JIOFIN",c:"Fin Ser"},
  {s:"JKCEMENT",c:"Cement"},{s:"JSL",c:"Metals & Mining"},{s:"JSWENERGY",c:"Power"},
  {s:"JSWSTEEL",c:"Metals & Mining"},{s:"JUBLFOOD",c:"Consumer Services"},{s:"KALYANKJIL",c:"Consumer Durables"},
  {s:"KEI",c:"Capital Goods"},{s:"KOTAKBANK",c:"Fin Ser-Pvt Bank"},{s:"KPITTECH",c:"IT"},
  {s:"LALPATHLAB",c:"Healthcare"},{s:"LAURUSLABS",c:"Healthcare"},{s:"LICHSGFIN",c:"Fin Ser-NBFC"},
  {s:"LT",c:"Construction"},{s:"LTIM",c:"IT"},{s:"LTTS",c:"IT"},
  {s:"LUPIN",c:"Healthcare"},{s:"M_M",c:"Automobile"},{s:"M_MFIN",c:"Fin Ser-NBFC"},
  {s:"MANAPPURAM",c:"Fin Ser-NBFC"},{s:"MARICO",c:"FMCG"},{s:"MARUTI",c:"Automobile"},
  {s:"MCDOWELL_N",c:"FMCG"},{s:"MCX",c:"Fin Ser-Exchange"},{s:"METROPOLIS",c:"Healthcare"},
  {s:"MFSL",c:"Fin Ser-NBFC"},{s:"MGL",c:"Oil Gas & Fuels"},{s:"MOTHERSON",c:"Auto Components"},
  {s:"MPHASIS",c:"IT"},{s:"MRF",c:"Auto Components"},{s:"MUTHOOTFIN",c:"Fin Ser-NBFC"},
  {s:"NATIONALUM",c:"Metals & Mining"},{s:"NAUKRI",c:"IT"},{s:"NAVINFLUOR",c:"Chemicals"},
  {s:"NESTLEIND",c:"FMCG"},{s:"NHPC",c:"Power"},{s:"NMDC",c:"Metals & Mining"},
  {s:"NTPC",c:"Power"},{s:"OBEROIRLTY",c:"Realty"},{s:"OFSS",c:"IT"},
  {s:"OIL",c:"Oil Gas & Fuels"},{s:"ONGC",c:"Oil Gas & Fuels"},{s:"PAGEIND",c:"Textiles"},
  {s:"PATANJALI",c:"FMCG"},{s:"PAYTM",c:"Fin Ser"},{s:"PEL",c:"Fin Ser-NBFC"},
  {s:"PERSISTENT",c:"IT"},{s:"PETRONET",c:"Oil Gas & Fuels"},{s:"PFC",c:"Fin Ser-NBFC"},
  {s:"PIDILITIND",c:"Chemicals"},{s:"PIIND",c:"Chemicals"},{s:"PNB",c:"Fin Ser-PSU Bank"},
  {s:"POLYCAB",c:"Consumer Durables"},{s:"POONAWALLA",c:"Fin Ser-NBFC"},{s:"POWERGRID",c:"Power"},
  {s:"PRESTIGE",c:"Realty"},{s:"PVRINOX",c:"Consumer Services"},{s:"RAMCOCEM",c:"Cement"},
  {s:"RBLBANK",c:"Fin Ser-Pvt Bank"},{s:"RECLTD",c:"Fin Ser-NBFC"},{s:"RELIANCE",c:"Oil Gas & Fuels"},
  {s:"SAIL",c:"Metals & Mining"},{s:"SBICARD",c:"Fin Ser"},{s:"SBILIFE",c:"Fin Ser-Insurance"},
  {s:"SBIN",c:"Fin Ser-PSU Bank"},{s:"SHREECEM",c:"Cement"},{s:"SHRIRAMFIN",c:"Fin Ser-NBFC"},
  {s:"SIEMENS",c:"Capital Goods"},{s:"SJVN",c:"Power"},{s:"SONACOMS",c:"Auto Components"},
  {s:"SRF",c:"Chemicals"},{s:"STAR",c:"Consumer Services"},{s:"SUNPHARMA",c:"Healthcare"},
  {s:"SUNTV",c:"Consumer Services"},{s:"SUPREMEIND",c:"Capital Goods"},{s:"SYNGENE",c:"Healthcare"},
  {s:"TATACHEM",c:"Chemicals"},{s:"TATACOMM",c:"Telecom"},{s:"TATACONSUM",c:"FMCG"},
  {s:"TATAELXSI",c:"IT"},{s:"TATAMOTORS",c:"Automobile"},{s:"TATAPOWER",c:"Power"},
  {s:"TATASTEEL",c:"Metals & Mining"},{s:"TCS",c:"IT"},{s:"TECHM",c:"IT"},
  {s:"TIINDIA",c:"Auto Components"},{s:"TITAN",c:"Consumer Durables"},{s:"TORNTPHARM",c:"Healthcare"},
  {s:"TORNTPOWER",c:"Power"},{s:"TRENT",c:"Consumer Services"},{s:"TVSMOTOR",c:"Automobile"},
  {s:"UBL",c:"FMCG"},{s:"ULTRACEMCO",c:"Cement"},{s:"UNIONBANK",c:"Fin Ser-PSU Bank"},
  {s:"UNITDSPR",c:"FMCG"},{s:"UNOMINDA",c:"Auto Components"},{s:"UPL",c:"Chemicals"},
  {s:"VEDL",c:"Metals & Mining"},{s:"VOLTAS",c:"Consumer Durables"},{s:"WIPRO",c:"IT"},
  {s:"ZEEL",c:"Consumer Services"},{s:"ZOMATO",c:"Consumer Services"},{s:"ZYDUSLIFE",c:"Healthcare"},
];
const FO_SET = new Set(FO_LIST.map(f => f.s));
const foMeta = sym => FO_LIST.find(f => f.s === sym);

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const fm  = (v,d=2) => v==null||isNaN(v)?"–":Number(v).toLocaleString("en-IN",{minimumFractionDigits:d,maximumFractionDigits:d});
const fi  = v => v==null||isNaN(v)?"–":Number(v).toLocaleString("en-IN",{maximumFractionDigits:0});
const fp  = v => v==null||isNaN(v)?"–":(v>=0?"+":"")+Number(v).toFixed(2)+"%";
const pc  = v => v==null?"":v>=0?"var(--green)":"var(--red)";
const rr  = (e,sl,t) => e&&sl&&t?((t-e)/(e-sl)).toFixed(1)+"x":"–";
const bm  = (est,act) => est&&act!=null?((act-est)/est*100).toFixed(1):null;
const SIG_COL = {"Long Buildup":"#10b981","Short Buildup":"#ef4444","Long Unwinding":"#f59e0b","Short Covering":"#1e90ff"};
const CONV_COL = {"Gold":"#f59e0b","High":"#10b981","Medium":"#1e90ff","Low":"#8b5cf6","Punt":"#7a9ab8"};

function exportCSV(name, rows) {
  const csv  = rows.map(r=>r.map(v=>`"${(v??"")}"`).join(",")).join("\n");
  const blob = new Blob([csv],{type:"text/csv"});
  const a    = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; a.click();
}

/* ─── UI atoms ───────────────────────────────────────────────────────────── */
const Btn = ({children,onClick,variant="primary",small,disabled}) => {
  const s = {
    primary:{background:"var(--blue2)",color:"#fff",border:"1px solid var(--blue)"},
    ghost:  {background:"transparent",color:"var(--blue)",border:"1px solid var(--border2)"},
    amber:  {background:"var(--amber-dim)",color:"var(--amber)",border:"1px solid rgba(245,158,11,.4)"},
    success:{background:"var(--green-dim)",color:"var(--green)",border:"1px solid rgba(16,185,129,.4)"},
    danger: {background:"var(--red-dim)",color:"var(--red)",border:"1px solid rgba(239,68,68,.4)"},
  };
  return <button onClick={onClick} disabled={disabled} style={{...s[variant],padding:small?"4px 10px":"7px 14px",borderRadius:5,fontSize:small?10:12,fontWeight:600,cursor:disabled?"not-allowed":"pointer",fontFamily:"var(--sans)",opacity:disabled?.5:1}}>{children}</button>;
};
const SigBadge  = ({sig})=>{const c=SIG_COL[sig]||"#7a9ab8";return <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:3,background:c+"22",color:c,border:`1px solid ${c}44`,textTransform:"uppercase"}}>{sig||"–"}</span>;};
const ConvBadge = ({c})=>{const col=CONV_COL[c]||"#7a9ab8";return <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:3,background:col+"22",color:col,border:`1px solid ${col}44`}}>{c}</span>;};
const FoBadge   = ({isFO})=><span style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:3,background:isFO?"rgba(16,185,129,.15)":"rgba(245,158,11,.12)",color:isFO?"var(--green)":"var(--amber)",border:`1px solid ${isFO?"rgba(16,185,129,.3)":"rgba(245,158,11,.3)"}`}}>{isFO?"F&O":"Cash"}</span>;
const Th = ({children,right})=><th style={{fontSize:10,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.7,padding:"8px 10px",textAlign:right?"right":"left",borderBottom:"1px solid var(--border)",fontWeight:600,whiteSpace:"nowrap"}}>{children}</th>;
const Td = ({children,right,mono,color,style:sx})=><td style={{padding:"9px 10px",fontSize:12,textAlign:right?"right":"left",color:color||"var(--text)",fontFamily:mono?"var(--mono)":undefined,borderBottom:"1px solid var(--border2)",...sx}}>{children}</td>;
const KpiCard = ({label,value,sub,color,icon})=>(
  <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,padding:"14px 16px",flex:1,minWidth:130}}>
    <div style={{fontSize:10,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.8,marginBottom:6,display:"flex",justifyContent:"space-between"}}><span>{label}</span><span style={{fontSize:16}}>{icon}</span></div>
    <div style={{fontSize:22,fontWeight:700,color:color||"var(--text)",fontFamily:"var(--mono)"}}>{value}</div>
    {sub&&<div style={{fontSize:11,color:"var(--text2)",marginTop:3}}>{sub}</div>}
  </div>
);

/* ─── Search bar with autocomplete ──────────────────────────────────────── */
function SearchBar({onAdd}) {
  const [query, setQuery] = useState("");
  const [suggs, setSuggs] = useState([]);
  const [open,  setOpen]  = useState(false);
  const ref = useRef();

  const search = v => {
    const q = v.toUpperCase().trim();
    setQuery(v);
    if (!q || q.length < 1) { setSuggs([]); setOpen(false); return; }
    const matches = FO_LIST.filter(f =>
      f.s.startsWith(q) || f.s.includes(q) || f.c.toUpperCase().includes(q)
    ).slice(0, 14);
    setSuggs(matches);
    setOpen(true);
  };

  const pick = sym => { setQuery(""); setSuggs([]); setOpen(false); onAdd(sym); };

  const submit = () => {
    const sym = query.trim().toUpperCase().replace(/\s+/g,"");
    if (!sym || sym.length < 1 || sym.length > 20) return;
    if (!/^[A-Z0-9&_\-]+$/.test(sym)) return;
    pick(sym);
  };

  // Close on outside click
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={ref} style={{position:"relative",flex:1,maxWidth:500}}>
      <div style={{display:"flex",gap:0}}>
        <div style={{position:"relative",flex:1}}>
          <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"var(--text3)",fontSize:14,pointerEvents:"none"}}>🔍</span>
          <input
            value={query}
            onChange={e => search(e.target.value)}
            onKeyDown={e => { if(e.key==="Enter") submit(); if(e.key==="Escape") setOpen(false); }}
            onFocus={() => query && setOpen(true)}
            placeholder="Search any NSE symbol — F&O or Cash (e.g. RELIANCE, DMART, IREDA)…"
            style={{
              width:"100%", padding:"8px 12px 8px 32px",
              background:"var(--bg3)", border:"1px solid var(--border2)",
              borderRight:"none", borderRadius:"5px 0 0 5px",
              color:"var(--text)", fontSize:13, outline:"none",
            }}
          />
        </div>
        <button onClick={submit} style={{padding:"8px 16px",background:"var(--blue2)",color:"#fff",border:"1px solid var(--blue)",borderRadius:"0 5px 5px 0",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"var(--sans)",whiteSpace:"nowrap"}}>
          + Add
        </button>
      </div>

      {open && suggs.length > 0 && (
        <div style={{position:"absolute",top:"100%",left:0,right:0,background:"var(--bg2)",border:"1px solid var(--border2)",borderTop:"none",borderRadius:"0 0 6px 6px",zIndex:200,maxHeight:300,overflowY:"auto",boxShadow:"0 8px 24px rgba(0,0,0,.5)"}}>
          {query && !FO_SET.has(query.toUpperCase()) && (
            <div onClick={()=>pick(query.toUpperCase())} className="acl-item"
              style={{padding:"8px 12px",cursor:"pointer",fontSize:12,borderBottom:"1px solid var(--border2)",display:"flex",justifyContent:"space-between",alignItems:"center",background:"rgba(245,158,11,.06)"}}>
              <span style={{fontWeight:700,color:"var(--amber)"}}>{query.toUpperCase()}</span>
              <span style={{fontSize:10,color:"var(--amber)"}}>Cash-only · Add anyway</span>
            </div>
          )}
          {suggs.map(f => (
            <div key={f.s} onClick={()=>pick(f.s)} className="acl-item"
              style={{padding:"8px 12px",cursor:"pointer",fontSize:12,borderBottom:"1px solid var(--border2)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontWeight:700,color:"var(--blue)"}}>{f.s}</span>
                <FoBadge isFO={true}/>
              </div>
              <span style={{fontSize:10,color:"var(--text3)"}}>{f.c}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Bhavcopy Upload Modal (fallback when NSE blocks Vercel IPs) ─────────── */
function UploadModal({onUpload, onClose}) {
  const [cmCsv,    setCmCsv]   = useState("");
  const [foCsv,    setFoCsv]   = useState("");
  const [loading,  setLoading] = useState(false);
  const [error,    setError]   = useState(null);

  const go = async () => {
    if (!cmCsv.trim() || !foCsv.trim()) { setError("Both CM and FO CSV content required"); return; }
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/bhavcopy", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cmCsv,foCsv})});
      const json = await res.json();
      if (!json.success) throw new Error(json.error||"Parse failed");
      onUpload(json);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:10,padding:22,width:"min(700px,100%)",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontSize:15,fontWeight:700,color:"var(--amber)"}}>⬆ Upload NSE Bhavcopy CSVs</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--text2)",fontSize:20,cursor:"pointer",lineHeight:1}}>✕</button>
        </div>
        <div style={{background:"var(--bg3)",borderRadius:6,padding:"10px 14px",marginBottom:14,fontSize:11,color:"var(--text2)",lineHeight:1.8}}>
          <strong style={{color:"var(--amber)"}}>NSE blocks Vercel IPs.</strong> Download the ZIPs manually, extract CSVs, paste below.<br/>
          Go to <a href="https://www.nseindia.com/market-data/exchange-statistics" target="_blank" rel="noreferrer" style={{color:"var(--blue)"}}>nseindia.com → Market Data → Bhavcopy</a> → latest date → download <em>CM Bhavcopy ZIP</em> + <em>FO Bhavcopy ZIP</em> → extract each → paste CSV content here.
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          {[["CM Bhavcopy CSV","SYMBOL,SERIES,OPEN,HIGH,LOW,CLOSE,PREVCLOSE,TOTTRDQTY,…\nRELIANCE,EQ,…",cmCsv,setCmCsv],
            ["FO Bhavcopy CSV","INSTRUMENT,SYMBOL,EXPIRY_DT,OPTION_TYP,STRIKE_PR,OPEN_INT,…\nFUTSTK,RELIANCE,…",foCsv,setFoCsv]
          ].map(([label,placeholder,val,set])=>(
            <div key={label}>
              <div style={{fontSize:10,color:"var(--text3)",marginBottom:4,textTransform:"uppercase",letterSpacing:.7}}>{label} <span style={{color:"var(--red)"}}>*</span></div>
              <textarea value={val} onChange={e=>set(e.target.value)} rows={10} placeholder={placeholder}
                style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:5,padding:"7px 9px",color:"var(--text)",fontSize:10,fontFamily:"var(--mono)",resize:"vertical"}}/>
            </div>
          ))}
        </div>
        {error && <div style={{background:"var(--red-dim)",border:"1px solid rgba(239,68,68,.4)",borderRadius:5,padding:"6px 10px",color:"var(--red)",fontSize:11,marginBottom:10}}>{error}</div>}
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="amber" onClick={go} disabled={loading}>{loading?"Parsing…":"Parse & Load"}</Btn>
        </div>
      </div>
    </div>
  );
}

/* ─── Module 1: OI Dashboard ─────────────────────────────────────────────── */
function OIModule({watchlist, stockData, dataDate, loading, onRefresh, onShowUpload, onRemove}) {
  const [sigFilter, setSigFilter] = useState("All");
  const [selected,  setSelected]  = useState(null);

  const stocks   = watchlist.map(sym => stockData[sym]).filter(Boolean);
  const filtered = stocks.filter(s => sigFilter==="All" || s.signal===sigFilter)
                         .sort((a,b) => Math.abs(b.futOIChgPct||0) - Math.abs(a.futOIChgPct||0));
  const sel      = selected || filtered[0];
  const pcrStocks = stocks.filter(s => s.pcr != null);

  return (
    <div className="fade">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:16,fontWeight:700}}>OI & Derivatives Dashboard</div>
          <div style={{fontSize:11,color:"var(--text2)",marginTop:2,display:"flex",alignItems:"center",gap:6}}>
            <span>NSE Bhavcopy · {dataDate||"–"}</span>
            {loading && <span className="spin" style={{display:"inline-block",width:10,height:10,border:"2px solid var(--border2)",borderTopColor:"var(--blue)",borderRadius:"50%"}}/>}
          </div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <Btn variant="ghost" small onClick={onShowUpload}>⬆ Upload CSVs</Btn>
          <Btn variant="ghost" small onClick={onRefresh}>↻ Refresh</Btn>
          <Btn variant="ghost" small onClick={()=>exportCSV("oi_bhavcopy.csv",[
            ["Symbol","Type","Sector","CMP","Chg%","Futures","Basis%","FutOI","OI Chg%","PCR","MaxCE","MaxPE","Signal","Date"],
            ...stocks.map(s=>[s.sym,FO_SET.has(s.sym)?"F&O":"Cash",foMeta(s.sym)?.c||"",s.cmp,s.changePct,s.futPrice,s.basisPct,s.futOI,s.futOIChgPct,s.pcr,s.maxCEStrike,s.maxPEStrike,s.signal,dataDate]),
          ])}>⬇ CSV</Btn>
        </div>
      </div>

      {!watchlist.length ? (
        <div style={{textAlign:"center",padding:"60px 20px",color:"var(--text3)"}}>
          <div style={{fontSize:32,marginBottom:10}}>🔍</div>
          <div style={{fontSize:14,color:"var(--text2)",marginBottom:6}}>Your watchlist is empty</div>
          <div style={{fontSize:12}}>Search any NSE symbol above to add stocks</div>
        </div>
      ) : (
        <>
          <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
            <KpiCard label="Long Buildups"  value={stocks.filter(s=>s.signal==="Long Buildup").length}  color="var(--green)"  icon="↑" sub="Bullish OI"/>
            <KpiCard label="Short Buildups" value={stocks.filter(s=>s.signal==="Short Buildup").length} color="var(--red)"    icon="↓" sub="Bearish OI"/>
            <KpiCard label="Avg PCR"        value={pcrStocks.length?(pcrStocks.reduce((a,b)=>a+(b.pcr||0),0)/pcrStocks.length).toFixed(2):"–"} color="var(--amber)" icon="⚖" sub="Put-Call Ratio"/>
            <KpiCard label="Watchlist"      value={watchlist.length} color="var(--blue)" icon="◉" sub={`${stocks.filter(s=>FO_SET.has(s.sym)).length} F&O · ${stocks.filter(s=>!FO_SET.has(s.sym)).length} Cash`}/>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 310px",gap:14,alignItems:"start"}}>
            <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,overflow:"hidden"}}>
              <div style={{padding:"8px 12px",borderBottom:"1px solid var(--border)",display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                {["All","Long Buildup","Short Buildup","Long Unwinding","Short Covering"].map(sig=>(
                  <button key={sig} onClick={()=>setSigFilter(sig)} style={{padding:"3px 9px",borderRadius:4,fontSize:11,fontWeight:600,cursor:"pointer",background:sigFilter===sig?(SIG_COL[sig]||"var(--blue2)"):"transparent",color:sigFilter===sig?"#fff":"var(--text2)",border:`1px solid ${sigFilter===sig?(SIG_COL[sig]||"var(--blue)"):"var(--border)"}`}}>{sig}</button>
                ))}
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr>
                    <Th>Symbol</Th><Th>Type</Th><Th right>CMP</Th><Th right>Chg%</Th>
                    <Th right>FutOI</Th><Th right>OI Δ%</Th><Th right>PCR</Th>
                    <Th right>MaxCE</Th><Th right>MaxPE</Th><Th>Signal</Th><Th></Th>
                  </tr></thead>
                  <tbody>
                    {filtered.length === 0 && (
                      <tr><td colSpan={11} style={{padding:20,textAlign:"center",color:"var(--text3)",fontSize:12}}>
                        {loading ? "Loading Bhavcopy…" : "No data yet — Bhavcopy loads after 6 PM IST or use Upload"}
                      </td></tr>
                    )}
                    {filtered.map(s => (
                      <tr key={s.sym} onClick={()=>setSelected(s)} style={{cursor:"pointer",background:sel?.sym===s.sym?"var(--blue-dim)":"transparent"}}>
                        <Td><div style={{fontWeight:700,color:"var(--blue)"}}>{s.sym}</div><div style={{fontSize:10,color:"var(--text3)"}}>{foMeta(s.sym)?.c||"Cash"}</div></Td>
                        <Td><FoBadge isFO={FO_SET.has(s.sym)}/></Td>
                        <Td right mono>₹{fm(s.cmp)}</Td>
                        <Td right mono color={pc(s.changePct)}>{fp(s.changePct)}</Td>
                        <Td right mono>{fi(s.futOI)}</Td>
                        <Td right mono color={pc(s.futOIChgPct)}>{fp(s.futOIChgPct)}</Td>
                        <Td right mono color={s.pcr>1?"var(--green)":s.pcr<0.7?"var(--red)":"var(--amber)"}>{s.pcr?fm(s.pcr,3):"–"}</Td>
                        <Td right mono>{fi(s.maxCEStrike)}</Td>
                        <Td right mono>{fi(s.maxPEStrike)}</Td>
                        <Td><SigBadge sig={s.signal}/></Td>
                        <Td><button onClick={e=>{e.stopPropagation();onRemove(s.sym);}} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:14,padding:"0 4px"}} title="Remove">✕</button></Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {sel && (
              <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,padding:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                  <div style={{fontSize:18,fontWeight:700,color:"var(--blue)"}}>{sel.sym}</div>
                  <FoBadge isFO={FO_SET.has(sel.sym)}/>
                </div>
                <div style={{fontSize:11,color:"var(--text2)",marginBottom:10}}>{foMeta(sel.sym)?.c||"Cash Only"}</div>
                <SigBadge sig={sel.signal}/>
                <div style={{marginTop:12}}>
                  {[
                    ["CMP",          `₹${fm(sel.cmp)}`],
                    ["Change",       fp(sel.changePct)],
                    ["Open",         `₹${fm(sel.open)}`],
                    ["High / Low",   `₹${fm(sel.high)} / ₹${fm(sel.low)}`],
                    ["Prev Close",   `₹${fm(sel.prevClose)}`],
                    ["Volume",       fi(sel.volume)],
                    ["Turnover",     sel.turnoverCr?`₹${sel.turnoverCr.toFixed(1)} Cr`:"–"],
                    ["52W High",     `₹${fm(sel.high52w)}`],
                    ["52W Low",      `₹${fm(sel.low52w)}`],
                    ["Futures",      `₹${fm(sel.futPrice)}`],
                    ["Basis",        sel.basis!=null?`₹${fm(sel.basis)} (${fm(sel.basisPct,3)}%)`:"–"],
                    ["Fut OI",       fi(sel.futOI)],
                    ["OI Change",    fp(sel.futOIChgPct)],
                    ["Max CE Strike",fi(sel.maxCEStrike)],
                    ["Max PE Strike",fi(sel.maxPEStrike)],
                    ["PCR",          sel.pcr?fm(sel.pcr,3):"–"],
                    ["Expiry",       sel.expiryDate||"–"],
                  ].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid var(--border2)",fontSize:12}}>
                      <span style={{color:"var(--text2)"}}>{l}</span>
                      <span style={{fontFamily:"var(--mono)",fontWeight:500}}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Module 2: Swing Trades ─────────────────────────────────────────────── */
const SWING_TEMPLATE = [
  {id:1,sym:"SRF",setup:"VCP – 3T",entry:2180,sl:2080,t1:2400,t2:2650,t3:3000,qty:46,date:"2026-02-12",status:"Open",conviction:"High",notes:"Stage 2, Burst Power 14.7, clean 3T"},
  {id:2,sym:"DIXON",setup:"IPO Base Cheat",entry:15400,sl:14800,t1:16800,t2:18500,t3:21000,qty:3,date:"2026-02-18",status:"Open",conviction:"Gold",notes:"Leader, RS >15, VDU active"},
  {id:3,sym:"PIIND",setup:"Flag",entry:2890,sl:2760,t1:3150,t2:3500,t3:4000,qty:17,date:"2026-01-28",status:"Partial",conviction:"High",notes:"Hit T1, trailing 50 EMA"},
  {id:4,sym:"COFORGE",setup:"Cup Handle",entry:7200,sl:6900,t1:7900,t2:8800,t3:10200,qty:7,date:"2026-02-05",status:"SL Hit",conviction:"Medium",notes:"Market turned"},
];

function SwingModule({stockData}) {
  const [trades,  setTrades]  = useState(SWING_TEMPLATE);
  const [showForm,setShowForm]= useState(false);
  const [form,    setForm]    = useState({sym:"",setup:"",entry:"",sl:"",t1:"",t2:"",t3:"",qty:"",conviction:"High",sa:"Decent Money",notes:""});

  const getCmp = sym => stockData[sym]?.cmp || null;
  const open   = trades.filter(t => t.status==="Open"||t.status==="Partial");
  const closed = trades.filter(t => t.status==="SL Hit"||t.status==="Closed");
  const unrealPnl = open.reduce((s,t)=>{ const c=getCmp(t.sym)||t.entry; return s+(c-t.entry)*t.qty; }, 0);

  const addTrade = () => {
    if (!form.sym || !form.entry || !form.sl) return;
    setTrades(p=>[...p,{...form,id:Date.now(),entry:+form.entry,sl:+form.sl,t1:+form.t1,t2:+form.t2,t3:+form.t3,qty:+form.qty,date:new Date().toISOString().slice(0,10),status:"Open"}]);
    setForm({sym:"",setup:"",entry:"",sl:"",t1:"",t2:"",t3:"",qty:"",conviction:"High",sa:"Decent Money",notes:""});
    setShowForm(false);
  };

  const updateStatus = (id, status) => setTrades(p=>p.map(t=>t.id===id?{...t,status}:t));
  const removeTrade  = id => setTrades(p=>p.filter(t=>t.id!==id));

  return (
    <div className="fade">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div><div style={{fontSize:16,fontWeight:700}}>Swing Trade Manager</div><div style={{fontSize:11,color:"var(--text2)",marginTop:2}}>Mr. Market Rulebook · Risk-first · EMA-aligned · CMP from Bhavcopy</div></div>
        <div style={{display:"flex",gap:8}}>
          <Btn variant="ghost" small onClick={()=>setShowForm(v=>!v)}>+ New Trade</Btn>
          <Btn variant="ghost" small onClick={()=>exportCSV("swing_trades.csv",[
            ["Symbol","Setup","SA","Entry","SL","T1","T2","T3","Qty","CMP","P&L","P&L%","1xRR","Date","Status","Conv","Notes"],
            ...trades.map(t=>{const c=getCmp(t.sym)||t.entry;return[t.sym,t.setup,t.sa,t.entry,t.sl,t.t1,t.t2,t.t3,t.qty,c,((c-t.entry)*t.qty).toFixed(0),(((c-t.entry)/t.entry)*100).toFixed(2),rr(t.entry,t.sl,t.t1),t.date,t.status,t.conviction,t.notes];})
          ])}>⬇ Export</Btn>
        </div>
      </div>

      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        <KpiCard label="Open Positions" value={open.length}  color="var(--blue)"  icon="📈" sub="Active trades"/>
        <KpiCard label="Unrealised P&L" value={`₹${fi(unrealPnl)}`} color={unrealPnl>=0?"var(--green)":"var(--red)"} icon={unrealPnl>=0?"▲":"▼"} sub="MTM vs entry"/>
        <KpiCard label="Win Rate" value={`${closed.length?Math.round(closed.filter(t=>t.status!=="SL Hit").length/closed.length*100):0}%`} color="var(--amber)" icon="🎯" sub={`${closed.length} closed`}/>
      </div>

      {showForm && (
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,padding:16,marginBottom:16}}>
          <div style={{fontWeight:600,marginBottom:12,fontSize:13}}>Add Swing Trade</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10}}>
            {[["sym","Symbol *"],["setup","Setup"],["entry","Entry ₹ *"],["sl","SL ₹ *"],["t1","T1 ₹"],["t2","T2 ₹"],["t3","T3 ₹"],["qty","Qty"]].map(([k,l])=>(
              <div key={k}><div style={{fontSize:10,color:"var(--text3)",marginBottom:3}}>{l}</div>
                <input value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:4,padding:"6px 8px",color:"var(--text)",fontSize:12}}/>
              </div>
            ))}
            {[["conviction","Conviction",["Gold","High","Medium","Low","Punt"]],["sa","SA (Market)",["Easy Money","Decent Money","Hard Money","No Money"]]].map(([k,l,opts])=>(
              <div key={k}><div style={{fontSize:10,color:"var(--text3)",marginBottom:3}}>{l}</div>
                <select value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:4,padding:"6px 8px",color:"var(--text)",fontSize:12}}>
                  {opts.map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div style={{marginTop:10}}><div style={{fontSize:10,color:"var(--text3)",marginBottom:3}}>Notes / Rationale</div>
            <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:4,padding:"6px 8px",color:"var(--text)",fontSize:12}} placeholder="Setup type, EMA alignment, Burst Power, VDU status…"/>
          </div>
          <div style={{display:"flex",gap:8,marginTop:12}}>
            <Btn onClick={addTrade}>Add Trade</Btn>
            <Btn variant="ghost" onClick={()=>setShowForm(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,overflow:"hidden",marginBottom:14}}>
        <div style={{padding:"8px 12px",borderBottom:"1px solid var(--border)",fontSize:12,fontWeight:600,color:"var(--green)"}}>⬤ Active ({open.length})</div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr><Th>Symbol</Th><Th>Setup</Th><Th>SA</Th><Th right>Entry</Th><Th right>SL</Th><Th right>T1 / T2</Th><Th right>Qty</Th><Th right>Live CMP</Th><Th right>P&L</Th><Th right>P&L%</Th><Th right>1×RR</Th><Th>Conv</Th><Th></Th></tr></thead>
            <tbody>{open.map(t=>{
              const c=getCmp(t.sym)||t.entry; const pnl=(c-t.entry)*t.qty; const pct=(c-t.entry)/t.entry*100;
              return(<tr key={t.id}>
                <Td><div style={{fontWeight:700,color:"var(--blue)"}}>{t.sym}</div><div style={{fontSize:10,color:"var(--text3)"}}>{t.date}</div></Td>
                <Td style={{fontSize:11,color:"var(--text2)"}}>{t.setup}</Td>
                <Td><span style={{fontSize:10,color:"var(--text3)"}}>{t.sa}</span></Td>
                <Td right mono>₹{fm(t.entry)}</Td>
                <Td right mono color="var(--red)">₹{fm(t.sl)}</Td>
                <Td right mono style={{fontSize:11}}><div>₹{fm(t.t1)}</div><div style={{color:"var(--text3)"}}>₹{fm(t.t2)}</div></Td>
                <Td right mono>{fi(t.qty)}</Td>
                <Td right mono color={c>t.entry?"var(--green)":"var(--red)"}>₹{fm(c)}{!getCmp(t.sym)&&<span style={{fontSize:9,color:"var(--text3)",marginLeft:4}}>est</span>}</Td>
                <Td right mono color={pnl>=0?"var(--green)":"var(--red)"}>₹{fi(pnl)}</Td>
                <Td right mono color={pct>=0?"var(--green)":"var(--red)"}>{fp(pct)}</Td>
                <Td right mono color="var(--amber)">{rr(t.entry,t.sl,t.t1)}</Td>
                <Td><ConvBadge c={t.conviction}/></Td>
                <Td>
                  <div style={{display:"flex",gap:4"}}>
                    <select onChange={e=>updateStatus(t.id,e.target.value)} value={t.status} style={{fontSize:10,background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:3,padding:"2px 4px",color:"var(--text)",cursor:"pointer"}}>
                      <option>Open</option><option>Partial</option><option>Closed</option><option>SL Hit</option>
                    </select>
                    <button onClick={()=>removeTrade(t.id)} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:13}}>✕</button>
                  </div>
                </Td>
              </tr>);
            })}</tbody>
          </table>
        </div>
      </div>

      {closed.length > 0 && (
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,overflow:"hidden"}}>
          <div style={{padding:"8px 12px",borderBottom:"1px solid var(--border)",fontSize:12,fontWeight:600,color:"var(--text2)"}}>Closed / SL Hit ({closed.length})</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr><Th>Symbol</Th><Th>Setup</Th><Th right>Entry</Th><Th right>SL</Th><Th right>Qty</Th><Th>Date</Th><Th>Status</Th><Th></Th></tr></thead>
              <tbody>{closed.map(t=>(
                <tr key={t.id}>
                  <Td style={{fontWeight:700}}>{t.sym}</Td><Td>{t.setup}</Td>
                  <Td right mono>₹{fm(t.entry)}</Td><Td right mono color="var(--red)">₹{fm(t.sl)}</Td>
                  <Td right mono>{fi(t.qty)}</Td><Td>{t.date}</Td>
                  <Td><span style={{fontSize:10,fontWeight:700,color:t.status==="SL Hit"?"var(--red)":"var(--text2)"}}>{t.status}</span></Td>
                  <Td><button onClick={()=>removeTrade(t.id)} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:13}}>✕</button></Td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Module 3: Result Trades (blank — fully manual) ─────────────────────── */
function ResultModule({stockData}) {
  // ── Starts EMPTY — user fills in their own trades ──────────────────────────
  const [trades,   setTrades]   = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form,     setForm]     = useState({
    sym:"", quarter:"", direction:"Long", conviction:"High",
    entry:"", qty:"",
    revEst:"", ebitdaEst:"", patEst:"",
    revAct:"", ebitdaAct:"", patAct:"",
    prePx:"", postPx:"", pnl:"", status:"Pre-Entry", notes:""
  });

  const getCmp    = sym => stockData[sym]?.cmp || null;
  const closed    = trades.filter(t => t.status==="Closed");
  const totalPnl  = closed.reduce((s,t) => s+(parseFloat(t.pnl)||0), 0);

  const addTrade = () => {
    if (!form.sym) return;
    setTrades(p=>[...p,{...form,id:Date.now(),entry:form.entry?+form.entry:null,qty:form.qty?+form.qty:null,revEst:form.revEst?+form.revEst:null,ebitdaEst:form.ebitdaEst?+form.ebitdaEst:null,patEst:form.patEst?+form.patEst:null,revAct:form.revAct?+form.revAct:null,ebitdaAct:form.ebitdaAct?+form.ebitdaAct:null,patAct:form.patAct?+form.patAct:null,prePx:form.prePx?+form.prePx:null,postPx:form.postPx?+form.postPx:null,pnl:form.pnl?+form.pnl:null}]);
    setForm({sym:"",quarter:"",direction:"Long",conviction:"High",entry:"",qty:"",revEst:"",ebitdaEst:"",patEst:"",revAct:"",ebitdaAct:"",patAct:"",prePx:"",postPx:"",pnl:"",status:"Pre-Entry",notes:""});
    setShowForm(false);
  };
  const updateField = (id,field,val) => setTrades(p=>p.map(t=>t.id===id?{...t,[field]:val}:t));
  const removeTrade = id => setTrades(p=>p.filter(t=>t.id!==id));

  return (
    <div className="fade">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div><div style={{fontSize:16,fontWeight:700}}>Result News Trading</div><div style={{fontSize:11,color:"var(--text2)",marginTop:2}}>Pre-result positioning · Bloomberg vs Street · Exit before results · No averaging</div></div>
        <div style={{display:"flex",gap:8}}>
          <Btn variant="ghost" small onClick={()=>setShowForm(v=>!v)}>+ New Trade</Btn>
          <Btn variant="ghost" small onClick={()=>exportCSV("result_trades.csv",[
            ["Symbol","Quarter","Dir","Conv","Entry","Qty","Rev Est","EBITDA Est","PAT Est","Rev Act","EBITDA Act","PAT Act","Rev Beat%","PAT Beat%","Pre-Px%","Post-Px%","P&L","Status","Notes"],
            ...trades.map(t=>[t.sym,t.quarter,t.direction,t.conviction,t.entry,t.qty,t.revEst,t.ebitdaEst,t.patEst,t.revAct,t.ebitdaAct,t.patAct,bm(t.revEst,t.revAct),bm(t.patEst,t.patAct),t.prePx,t.postPx,t.pnl,t.status,t.notes])
          ])}>⬇ Export</Btn>
        </div>
      </div>

      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        <KpiCard label="Total Realised" value={`₹${fi(totalPnl)}`} color={totalPnl>=0?"var(--green)":"var(--red)"} icon="💰" sub="Result trades P&L"/>
        <KpiCard label="Win Rate"       value={`${closed.length?Math.round(closed.filter(t=>(parseFloat(t.pnl)||0)>0).length/closed.length*100):0}%`} color="var(--amber)" icon="🎯" sub={`${closed.length} closed`}/>
        <KpiCard label="Active"         value={trades.filter(t=>t.status==="Active").length}    color="var(--blue)"   icon="⚡" sub="Pre-result held"/>
        <KpiCard label="Pipeline"       value={trades.filter(t=>t.status==="Pre-Entry").length} color="var(--purple)" icon="👁" sub="Watching"/>
      </div>

      {showForm && (
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,padding:16,marginBottom:16}}>
          <div style={{fontWeight:600,marginBottom:12,fontSize:13}}>Add Result Trade</div>

          {/* Row 1 — identity */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:10}}>
            {[["sym","Symbol *"],["quarter","Quarter (e.g. Q4 FY26)"],["entry","Entry ₹"],["qty","Qty"]].map(([k,l])=>(
              <div key={k}><div style={{fontSize:10,color:"var(--text3)",marginBottom:3}}>{l}</div>
                <input value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:4,padding:"6px 8px",color:"var(--text)",fontSize:12}}/>
              </div>
            ))}
            {[["direction","Direction",["Long","Short"]],["conviction","Conviction",["Gold","High","Medium","Low","Punt"]],["status","Status",["Pre-Entry","Active","Closed"]]].map(([k,l,opts])=>(
              <div key={k}><div style={{fontSize:10,color:"var(--text3)",marginBottom:3}}>{l}</div>
                <select value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:4,padding:"6px 8px",color:"var(--text)",fontSize:12}}>
                  {opts.map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
            ))}
          </div>

          {/* Row 2 — estimates */}
          <div style={{fontSize:10,color:"var(--text3)",marginBottom:6,textTransform:"uppercase",letterSpacing:.6}}>Estimates (₹ Cr)</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr 1fr",gap:10,marginBottom:10}}>
            {[["revEst","Rev Est"],["ebitdaEst","EBITDA Est"],["patEst","PAT Est"],["revAct","Rev Actual"],["ebitdaAct","EBITDA Actual"],["patAct","PAT Actual"]].map(([k,l])=>(
              <div key={k}><div style={{fontSize:10,color:"var(--text3)",marginBottom:3}}>{l}</div>
                <input type="number" value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:4,padding:"6px 8px",color:"var(--text)",fontSize:12}} placeholder="0"/>
              </div>
            ))}
          </div>

          {/* Row 3 — post trade */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:10}}>
            {[["prePx","Pre-Px% (45D)"],["postPx","Post-Px%"],["pnl","P&L ₹"]].map(([k,l])=>(
              <div key={k}><div style={{fontSize:10,color:"var(--text3)",marginBottom:3}}>{l}</div>
                <input type="number" value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:4,padding:"6px 8px",color:"var(--text)",fontSize:12}} placeholder="0"/>
              </div>
            ))}
          </div>

          <div style={{marginBottom:10}}><div style={{fontSize:10,color:"var(--text3)",marginBottom:3}}>Notes</div>
            <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:4,padding:"6px 8px",color:"var(--text)",fontSize:12}} placeholder="Whisper direction, HOS, management tone…"/>
          </div>

          <div style={{display:"flex",gap:8}}>
            <Btn onClick={addTrade}>Add Trade</Btn>
            <Btn variant="ghost" onClick={()=>setShowForm(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      {trades.length === 0 ? (
        <div style={{textAlign:"center",padding:"50px 20px",color:"var(--text3)",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8}}>
          <div style={{fontSize:28,marginBottom:10}}>📋</div>
          <div style={{fontSize:14,color:"var(--text2)",marginBottom:6}}>No result trades yet</div>
          <div style={{fontSize:12,marginBottom:16}}>Add your pre-result positioning using the form above</div>
          <Btn onClick={()=>setShowForm(true)}>+ Add First Trade</Btn>
        </div>
      ) : (
        <>
          <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,overflow:"hidden",marginBottom:14}}>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr>
                  <Th>Symbol</Th><Th>Quarter</Th><Th>Dir</Th><Th>Conv</Th>
                  <Th right>Entry</Th><Th right>Qty</Th>
                  <Th right>Rev Beat%</Th><Th right>PAT Beat%</Th>
                  <Th right>Pre-Px%</Th><Th right>Post-Px%</Th>
                  <Th right>P&L</Th><Th>Status</Th><Th></Th>
                </tr></thead>
                <tbody>{trades.map(t => {
                  const rb = bm(t.revEst, t.revAct), pb = bm(t.patEst, t.patAct);
                  return (
                    <tr key={t.id}>
                      <Td><div style={{fontWeight:700,color:"var(--blue)"}}>{t.sym}</div><div style={{fontSize:10,color:"var(--text3)"}}>{t.quarter}</div></Td>
                      <Td><span style={{fontSize:11,fontWeight:700,color:t.direction==="Long"?"var(--green)":"var(--red)"}}>{t.direction}</span></Td>
                      <Td><ConvBadge c={t.conviction}/></Td>
                      <Td right mono>{t.entry?`₹${fm(t.entry)}`:"–"}</Td>
                      <Td right mono>{t.qty?fi(t.qty):"–"}</Td>
                      <Td right mono color={rb===null?"var(--text3)":+rb>=0?"var(--green)":"var(--red)"}>{rb?(+rb>=0?"+":"")+rb+"%":"–"}</Td>
                      <Td right mono color={pb===null?"var(--text3)":+pb>=0?"var(--green)":"var(--red)"}>{pb?(+pb>=0?"+":"")+pb+"%":"–"}</Td>
                      <Td right mono color={t.prePx==null?"var(--text3)":t.prePx>=0?"var(--green)":"var(--red)"}>{t.prePx!=null?fp(t.prePx):"–"}</Td>
                      <Td right mono color={t.postPx==null?"var(--text3)":t.postPx>=0?"var(--green)":"var(--red)"}>{t.postPx!=null?fp(t.postPx):"–"}</Td>
                      <Td right mono color={t.pnl==null?"var(--text3)":+t.pnl>=0?"var(--green)":"var(--red)"}>{t.pnl!=null?`₹${fi(t.pnl)}`:"–"}</Td>
                      <Td>
                        <select value={t.status} onChange={e=>updateField(t.id,"status",e.target.value)} style={{fontSize:10,background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:3,padding:"2px 4px",color:"var(--text)",cursor:"pointer"}}>
                          <option>Pre-Entry</option><option>Active</option><option>Closed</option>
                        </select>
                      </Td>
                      <Td><button onClick={()=>removeTrade(t.id)} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:13}}>✕</button></Td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </div>

          {closed.length > 0 && (
            <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,padding:16}}>
              <div style={{fontSize:12,fontWeight:600,color:"var(--text2)",marginBottom:12}}>P&L — CLOSED RESULT TRADES</div>
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={closed}>
                  <XAxis dataKey="sym" tick={{fontSize:11,fill:"#7a9ab8"}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fontSize:11,fill:"#7a9ab8"}} axisLine={false} tickLine={false} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`}/>
                  <Tooltip contentStyle={{background:"var(--bg3)",border:"1px solid var(--border)",fontSize:11}} formatter={v=>`₹${fi(v)}`}/>
                  <Bar dataKey="pnl" radius={[3,3,0,0]}>{closed.map((t,i)=><Cell key={i} fill={(parseFloat(t.pnl)||0)>=0?"#10b981":"#ef4444"}/>)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Ticker tape ─────────────────────────────────────────────────────────── */
function TickerTape({watchlist, stockData}) {
  const stocks = watchlist.map(s => stockData[s]).filter(Boolean);
  if (!stocks.length) return null;
  const items  = [...stocks, ...stocks];
  return (
    <div style={{background:"var(--bg2)",borderBottom:"1px solid var(--border)",overflow:"hidden",height:26,display:"flex",alignItems:"center"}}>
      <div style={{whiteSpace:"nowrap",animation:"ticker 50s linear infinite",display:"flex"}}>
        {items.map((s,i)=>(
          <span key={i} style={{padding:"0 18px",fontSize:11,fontFamily:"var(--mono)",borderRight:"1px solid var(--border)"}}>
            <span style={{fontWeight:700,color:FO_SET.has(s.sym)?"var(--blue)":"var(--amber)"}}>{s.sym}</span>
            {s.cmp && <><span style={{color:"var(--text)",marginLeft:6}}>₹{fm(s.cmp)}</span><span style={{color:pc(s.changePct),marginLeft:5}}>{fp(s.changePct)}</span></>}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── Main App ───────────────────────────────────────────────────────────── */
export default function App() {
  const [module,     setModule]     = useState("oi");
  const [watchlist,  setWatchlist]  = useState(() => {
    try { return JSON.parse(localStorage.getItem("pj_wl3")||"[]"); } catch { return []; }
  });
  const [stockData,  setStockData]  = useState({});  // sym → bhavcopy data object
  const [dataDate,   setDataDate]   = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [blocked,    setBlocked]    = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [lastFetch,  setLastFetch]  = useState(null);

  // Persist watchlist
  useEffect(() => {
    try { localStorage.setItem("pj_wl3", JSON.stringify(watchlist)); } catch {}
  }, [watchlist]);

  // Fetch data for a single symbol or the full watchlist
  const fetchSymbols = useCallback(async (syms) => {
    if (!syms.length) return;
    setLoading(true);
    try {
      const query = syms.join(",");
      const res   = await fetch(`/api/bhavcopy?symbols=${encodeURIComponent(query)}`);
      const json  = await res.json();
      if (json.blocked) {
        setBlocked(true);
        setError("NSE auto-fetch blocked. Click ⬆ Upload CSVs to load data.");
        return;
      }
      if (!json.success) throw new Error(json.error || "Fetch failed");
      setStockData(prev => ({ ...prev, ...json.data }));
      setDataDate(json.date);
      setError(null); setBlocked(false);
      setLastFetch(new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true}));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load watchlist on mount + auto-refresh during market hours
  useEffect(() => {
    if (watchlist.length) fetchSymbols(watchlist);
    const interval = setInterval(() => {
      const ist = new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Kolkata"}));
      const h=ist.getHours(),m=ist.getMinutes(),day=ist.getDay();
      if (day>=1&&day<=5&&((h===9&&m>=15)||(h>9&&h<15)||(h===15&&m<=30))) {
        if (watchlist.length) fetchSymbols(watchlist);
      }
    }, 300000);
    return () => clearInterval(interval);
  }, []);  // intentionally no deps — runs once on mount

  const addSymbol = sym => {
    const s = sym.trim().toUpperCase();
    if (!s || s.length < 1 || s.length > 20) return;
    if (!/^[A-Z0-9&_\-]+$/.test(s)) return;
    if (watchlist.includes(s)) { setModule("oi"); return; }
    const newList = [...watchlist, s];
    setWatchlist(newList);
    setModule("oi");
    fetchSymbols([s]);   // fetch just this new symbol, merge into stockData
  };

  const removeSymbol = sym => {
    setWatchlist(p => p.filter(s => s !== sym));
    setStockData(p => { const n={...p}; delete n[sym]; return n; });
  };

  const handleUpload = json => {
    setStockData(prev => ({ ...prev, ...json.data }));
    setDataDate(json.date);
    setBlocked(false); setError(null); setShowUpload(false);
    setLastFetch(new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true}));
  };

  const ist    = new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Kolkata"}));
  const isLive = ist.getDay()>=1&&ist.getDay()<=5&&((ist.getHours()===9&&ist.getMinutes()>=15)||(ist.getHours()>9&&ist.getHours()<15)||(ist.getHours()===15&&ist.getMinutes()<=30));

  const nav = [
    {id:"oi",     icon:"◈",  label:"OI Dashboard",    badge:Object.values(stockData).filter(s=>s.signal==="Long Buildup").length||null},
    {id:"swing",  icon:"📈", label:"Swing Trades",     badge:null},
    {id:"result", icon:"⚡", label:"Result Trades",    badge:null},
  ];

  return (
    <>
      <Styles/>
      {showUpload && <UploadModal onUpload={handleUpload} onClose={()=>setShowUpload(false)}/>}

      <div style={{display:"flex",flexDirection:"column",height:"100vh",overflow:"hidden"}}>
        {/* Top bar */}
        <div style={{background:"var(--bg2)",borderBottom:"1px solid var(--border)",padding:"0 16px",display:"flex",alignItems:"center",gap:12,height:46,flexShrink:0,flexWrap:"wrap"}}>
          <div style={{fontSize:15,fontWeight:700,fontFamily:"var(--mono)",color:"var(--blue)",letterSpacing:1,whiteSpace:"nowrap"}}>MKTDESK</div>
          <div style={{fontSize:9,color:"var(--text3)",borderLeft:"1px solid var(--border)",paddingLeft:10,whiteSpace:"nowrap"}}>NSE Bhavcopy · Free · No Auth</div>

          {/* Search bar — always visible in topbar */}
          <SearchBar onAdd={addSymbol}/>

          <div style={{display:"flex",alignItems:"center",gap:10,marginLeft:"auto",flexShrink:0}}>
            {error && <span style={{fontSize:11,color:"var(--red)",background:"var(--red-dim)",padding:"2px 8px",borderRadius:4,maxWidth:240,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>⚠ {error}</span>}
            {blocked && <button onClick={()=>setShowUpload(true)} style={{fontSize:11,color:"var(--amber)",background:"var(--amber-dim)",border:"1px solid rgba(245,158,11,.4)",padding:"2px 10px",borderRadius:4,cursor:"pointer",fontFamily:"var(--sans)",fontWeight:600,whiteSpace:"nowrap"}}>⬆ Upload CSVs</button>}
            {lastFetch && <span style={{fontSize:10,color:"var(--text3)",whiteSpace:"nowrap"}}>↺ {lastFetch}</span>}
            <div style={{display:"flex",alignItems:"center",gap:4,fontSize:11}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:isLive?"var(--green)":"var(--amber)",display:"inline-block"}}/>
              <span style={{color:isLive?"var(--green)":"var(--amber)",fontWeight:600}}>{isLive?"LIVE":"EOD"}</span>
            </div>
            <span style={{fontSize:10,color:"var(--text3)",fontFamily:"var(--mono)"}}>{ist.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:true})} IST</span>
          </div>
        </div>

        {/* Ticker */}
        <TickerTape watchlist={watchlist} stockData={stockData}/>

        {/* Body */}
        <div style={{display:"flex",flex:1,overflow:"hidden"}}>
          {/* Sidebar — watchlist */}
          <div style={{width:185,background:"var(--bg2)",borderRight:"1px solid var(--border)",display:"flex",flexDirection:"column",flexShrink:0}}>
            <div style={{padding:"8px 12px 4px",fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:1,fontWeight:700}}>Watchlist</div>

            <div style={{flex:1,overflowY:"auto"}}>
              {watchlist.length === 0 ? (
                <div style={{padding:"16px 12px",color:"var(--text3)",fontSize:11,textAlign:"center",lineHeight:1.5}}>
                  Search any NSE symbol above to add stocks
                </div>
              ) : watchlist.map(sym => {
                const d = stockData[sym];
                return (
                  <div key={sym} onClick={()=>setModule("oi")}
                    style={{padding:"7px 12px",fontSize:12,cursor:"pointer",borderBottom:"1px solid rgba(26,47,69,.5)",display:"flex",justifyContent:"space-between",alignItems:"center",background:module==="oi"?"transparent":"transparent"}}>
                    <div>
                      <div style={{fontWeight:700,color:FO_SET.has(sym)?"var(--blue)":"var(--amber)",fontSize:12}}>{sym}</div>
                      {d?.cmp && <div style={{fontSize:10,fontFamily:"var(--mono)",color:pc(d.changePct)}}>{fp(d.changePct)}</div>}
                    </div>
                    <button onClick={e=>{e.stopPropagation();removeSymbol(sym);}} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:13,opacity:.5,lineHeight:1}}>✕</button>
                  </div>
                );
              })}
            </div>

            {/* Nav */}
            <div style={{borderTop:"1px solid var(--border)",paddingTop:8,paddingBottom:8}}>
              {nav.map(n=>(
                <div key={n.id} onClick={()=>setModule(n.id)} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",cursor:"pointer",borderRadius:5,margin:"1px 6px",background:module===n.id?"var(--blue-dim)":"transparent",borderLeft:module===n.id?"2px solid var(--blue)":"2px solid transparent",color:module===n.id?"var(--blue)":"var(--text2)",fontSize:12,fontWeight:module===n.id?600:400}}>
                  <span style={{fontSize:13}}>{n.icon}</span>
                  <span style={{flex:1}}>{n.label}</span>
                  {n.badge?<span style={{fontSize:10,background:"var(--blue-dim)",color:"var(--blue)",padding:"1px 5px",borderRadius:8,fontWeight:700}}>{n.badge}</span>:null}
                </div>
              ))}
            </div>

            {/* Data source info */}
            <div style={{padding:"8px 12px",borderTop:"1px solid var(--border)",fontSize:10,color:"var(--text3)",lineHeight:1.5}}>
              <div style={{color:"var(--green)",fontWeight:600,fontSize:11}}>NSE Bhavcopy</div>
              CM + FO · Released ~6 PM IST<br/>
              {dataDate&&<span style={{color:"var(--amber)"}}>Date: {dataDate}</span>}
            </div>
          </div>

          {/* Main content */}
          <div style={{flex:1,overflowY:"auto",padding:20,background:"var(--bg)"}}>
            {module==="oi"     && <OIModule watchlist={watchlist} stockData={stockData} dataDate={dataDate} loading={loading} onRefresh={()=>fetchSymbols(watchlist)} onShowUpload={()=>setShowUpload(true)} onRemove={removeSymbol}/>}
            {module==="swing"  && <SwingModule stockData={stockData}/>}
            {module==="result" && <ResultModule stockData={stockData}/>}
          </div>
        </div>
      </div>
    </>
  );
}
