import { useState, useEffect, useCallback, useRef } from "react";
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from "recharts";

/* ─── GOOGLE FONTS ─── */
const FontLink = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#060b11;--bg2:#0c1420;--bg3:#111d2c;--bg4:#16263a;
      --border:#1a2f45;--border2:#1f3a56;
      --blue:#1e90ff;--blue2:#0d6edf;--blue-dim:rgba(30,144,255,.12);
      --amber:#f59e0b;--amber-dim:rgba(245,158,11,.12);
      --green:#10b981;--green-dim:rgba(16,185,129,.12);
      --red:#ef4444;--red-dim:rgba(239,68,68,.12);
      --purple:#8b5cf6;--purple-dim:rgba(139,92,246,.12);
      --text:#c9d8e8;--text2:#7a9ab8;--text3:#3d5a78;
      --mono:'IBM Plex Mono',monospace;--sans:'IBM Plex Sans',sans-serif;
    }
    body{background:var(--bg);color:var(--text);font-family:var(--sans)}
    input,select,textarea{font-family:var(--sans)}
    ::-webkit-scrollbar{width:4px;height:4px}
    ::-webkit-scrollbar-track{background:var(--bg2)}
    ::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
    @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
    @keyframes ticker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
    .fade-in{animation:fadeIn .25s ease forwards}
    .live-dot{animation:pulse 1.5s ease-in-out infinite}
  `}</style>
);

/* ─── MOCK DATA ─── */
const STOCKS = [
  {sym:"RELIANCE",sector:"Oil Gas",cmp:1284.50,chg:-0.42,oi:24560000,oiChg:2.34,fut:1286.70,pcr:0.82,adr:1.81,burst:8.4,rs:−2.3,signal:"Short Buildup",maxCE:1300,maxPE:1250},
  {sym:"HDFCBANK",sector:"Pvt Bank",cmp:1741.20,chg:0.87,oi:18920000,oiChg:-1.20,fut:1743.50,pcr:1.12,adr:1.44,burst:6.2,rs:1.8,signal:"Short Covering",maxCE:1780,maxPE:1720},
  {sym:"INFY",sector:"IT",cmp:1523.80,chg:-1.34,oi:12340000,oiChg:4.56,fut:1525.10,pcr:0.71,adr:1.62,burst:11.3,rs:-4.1,signal:"Short Buildup",maxCE:1560,maxPE:1500},
  {sym:"TCS",sector:"IT",cmp:3892.40,chg:0.23,oi:8760000,oiChg:-0.87,fut:3895.00,pcr:0.95,adr:1.23,burst:7.8,rs:0.4,signal:"Short Covering",maxCE:3950,maxPE:3850},
  {sym:"ICICIBANK",sector:"Pvt Bank",cmp:1268.30,chg:1.12,oi:22180000,oiChg:3.21,fut:1270.00,pcr:1.08,adr:1.58,burst:9.1,rs:2.9,signal:"Long Buildup",maxCE:1300,maxPE:1240},
  {sym:"SRF",sector:"Chemicals",cmp:2341.60,chg:2.34,oi:3420000,oiChg:6.78,fut:2345.00,pcr:1.34,adr:2.12,burst:14.7,rs:8.2,signal:"Long Buildup",maxCE:2400,maxPE:2300},
  {sym:"PIIND",sector:"Chemicals",cmp:3108.90,chg:-0.89,oi:2890000,oiChg:1.23,fut:3112.00,pcr:0.88,adr:1.94,burst:12.1,rs:1.1,signal:"Long Buildup",maxCE:3200,maxPE:3050},
  {sym:"DIXON",sector:"Consumer Dur",cmp:16240.00,chg:1.67,oi:1240000,oiChg:8.90,fut:16270.00,pcr:1.41,adr:2.45,burst:18.3,rs:12.4,signal:"Long Buildup",maxCE:16500,maxPE:16000},
  {sym:"ZOMATO",sector:"Consumer Svc",cmp:238.45,chg:-2.10,oi:89400000,oiChg:5.67,fut:238.90,pcr:0.65,adr:2.88,burst:16.2,rs:-5.6,signal:"Short Buildup",maxCE:245,maxPE:230},
  {sym:"BHARTIARTL",sector:"Telecom",cmp:1892.30,chg:0.56,oi:14300000,oiChg:-2.34,fut:1894.00,pcr:1.18,adr:1.37,burst:7.3,rs:3.2,signal:"Long Unwinding",maxCE:1920,maxPE:1860},
];

const SWING_TRADES = [
  {id:1,sym:"SRF",setup:"VCP – 3T",entry:2180,sl:2080,t1:2400,t2:2650,t3:3000,qty:46,cmp:2341.60,date:"2026-02-12",status:"Open",sa:"Decent Money",conviction:"High",notes:"Stage 2, Burst Power 14.7, clean 3T"},
  {id:2,sym:"DIXON",setup:"IPO Base Cheat",entry:15400,sl:14800,t1:16800,t2:18500,t3:21000,qty:3,cmp:16240.00,date:"2026-02-18",status:"Open",sa:"Decent Money",conviction:"Gold",notes:"Leader, RS >15, VDU active"},
  {id:3,sym:"PIIND",setup:"Flag",entry:2890,sl:2760,t1:3150,t2:3500,t3:4000,qty:17,cmp:3108.90,date:"2026-01-28",status:"Partial",sa:"Easy Money",conviction:"High",notes:"Hit T1, trailing 50 EMA"},
  {id:4,sym:"COFORGE",setup:"Cup Handle",entry:7200,sl:6900,t1:7900,t2:8800,t3:10200,qty:7,cmp:6980,date:"2026-02-05",status:"SL Hit",sa:"Hard Money",conviction:"Medium",notes:"Market turned, SL triggered at 6900"},
  {id:5,sym:"ANGELONE",setup:"Low Cheat",entry:2950,sl:2820,t1:3200,t2:3600,t3:4200,qty:20,cmp:3080,date:"2026-03-01",status:"Open",sa:"Decent Money",conviction:"Medium",notes:"EMA alignment intact, watching"},
];

const RESULT_TRADES = [
  {id:1,sym:"RELIANCE",quarter:"Q3 FY26",revEst:224000,revAct:231400,ebitdaEst:36200,ebitdaAct:38100,patEst:18200,patAct:19650,prePx:-4.2,postPx:3.8,conviction:"High",direction:"Long",qty:780,entry:1238,exit:1284,status:"Closed",pnl:35880},
  {id:2,sym:"INFY",quarter:"Q3 FY26",revEst:39800,revAct:38200,ebitdaEst:8200,ebitdaAct:7840,patEst:6800,patAct:6520,prePx:2.1,postPx:-3.4,conviction:"Gold",direction:"Short",qty:131,entry:1545,exit:1475,status:"Closed",pnl:9170},
  {id:3,sym:"SRF",quarter:"Q3 FY26",revEst:3400,revAct:null,ebitdaEst:720,ebitdaAct:null,patEst:380,patAct:null,prePx:8.2,postPx:null,conviction:"Medium",direction:"Long",qty:43,entry:2290,exit:null,status:"Active",pnl:null},
  {id:4,sym:"DIXON",quarter:"Q4 FY26",revEst:5200,revAct:null,ebitdaEst:312,ebitdaAct:null,patEst:168,patAct:null,prePx:null,postPx:null,conviction:"Gold",direction:"Long",qty:10,entry:null,exit:null,status:"Pre-Entry",pnl:null},
  {id:5,sym:"BHARTIARTL",quarter:"Q3 FY26",revEst:41200,revAct:43800,ebitdaEst:20100,ebitdaAct:21600,patEst:4200,patAct:5100,prePx:0.4,postPx:5.6,conviction:"High",direction:"Long",qty:265,entry:1789,exit:1892,status:"Closed",pnl:27295},
];

const FUNDAMENTALS = [
  {sym:"SRF",sector:"Chemicals",rev:[2890,3120,3080,3200,2780,3010,2950,3400],opm:[18.2,19.1,18.8,20.3,17.9,18.5,19.0,20.1],eps:[42,48,46,52,38,44,47,54],pe:42.1,mktCap:69400,debtEq:0.82,roe:18.4,promoter:50.6},
  {sym:"DIXON",sector:"Consumer Dur",rev:[3200,3800,4100,4600,3100,3750,4200,5200],opm:[5.8,6.1,6.3,6.0,5.5,6.2,6.0,6.4],eps:[98,124,136,152,92,118,140,168],pe:96.7,mktCap:97500,debtEq:0.12,roe:28.6,promoter:34.1},
  {sym:"PIIND",sector:"Chemicals",rev:[1820,1940,2080,2200,1750,1890,2040,2340],opm:[22.1,23.4,22.8,24.1,21.5,22.9,23.2,24.8],eps:[62,68,72,78,58,65,71,80],pe:38.9,mktCap:46800,debtEq:0.22,roe:22.1,promoter:51.2},
  {sym:"BHARTIARTL",sector:"Telecom",rev:[38200,40100,41800,43800,36900,39000,41200,44500],opm:[51.2,52.4,51.8,53.1,50.8,51.9,52.3,53.6],eps:[14,18,21,26,12,16,20,28],pe:67.4,mktCap:1120000,debtEq:1.84,roe:14.2,promoter:56.2},
  {sym:"INFY",sector:"IT",rev:[36800,38200,37900,38200,36100,37400,38800,38200],opm:[21.3,20.8,21.1,20.5,21.8,21.2,20.9,20.5],eps:[60,62,63,62,58,61,63,62],pe:24.6,mktCap:634000,debtEq:0.0,roe:31.8,promoter:14.8},
];

/* ─── PRICE SERIES GENERATOR ─── */
function genPriceSeries(base, n=60, vol=0.015) {
  const data = []; let p = base;
  for (let i = 0; i < n; i++) {
    p = p * (1 + (Math.random() - 0.49) * vol);
    data.push({ i, price: Math.round(p * 100) / 100, vol: Math.floor(Math.random() * 8000000 + 2000000) });
  }
  return data;
}

function genPnlSeries(trades) {
  const closed = trades.filter(t => t.status === "Closed");
  let cum = 0;
  return closed.map((t, i) => { cum += t.pnl; return { trade: t.sym, pnl: t.pnl, cumPnl: cum }; });
}

/* ─── HELPERS ─── */
const fm = (v, d=2) => v == null ? "–" : Number(v).toLocaleString("en-IN", {minimumFractionDigits:d,maximumFractionDigits:d});
const fp = (v) => v == null ? "–" : (v>=0?"+":"") + v.toFixed(2) + "%";
const fi = (v) => v == null ? "–" : Number(v).toLocaleString("en-IN",{maximumFractionDigits:0});
const fCr = (v) => v == null ? "–" : v >= 100000 ? `₹${(v/100000).toFixed(1)}L Cr` : `₹${fi(v)} Cr`;
const pnlPct = (entry, cmp) => entry ? ((cmp - entry) / entry * 100) : 0;
const rr = (entry, sl, target) => sl && target && entry ? ((target-entry)/(entry-sl)).toFixed(1)+"x" : "–";
const SIG_COL = {"Long Buildup":"#10b981","Short Buildup":"#ef4444","Long Unwinding":"#f59e0b","Short Covering":"#1e90ff","Data Pending":"#7a9ab8"};
const CONV_COL = {"Gold":"#f59e0b","High":"#10b981","Medium":"#1e90ff","Low":"#8b5cf6","Punt":"#7a9ab8"};

/* ─── CSV EXPORT ─── */
function exportCSV(filename, rows) {
  const csv = rows.map(r => r.map(v => `"${v ?? ""}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

/* ─── SUB-COMPONENTS ─── */
function NavItem({ icon, label, active, onClick, badge }) {
  return (
    <div onClick={onClick} style={{
      display:"flex", alignItems:"center", gap:10, padding:"10px 16px",
      cursor:"pointer", borderRadius:6, margin:"2px 8px",
      background: active ? "var(--blue-dim)" : "transparent",
      borderLeft: active ? "2px solid var(--blue)" : "2px solid transparent",
      color: active ? "var(--blue)" : "var(--text2)",
      transition:"all .15s", fontSize:13, fontWeight: active ? 600 : 400,
    }}>
      <span style={{fontSize:15}}>{icon}</span>
      <span style={{flex:1}}>{label}</span>
      {badge && <span style={{fontSize:10,background:"var(--blue-dim)",color:"var(--blue)",padding:"1px 6px",borderRadius:10,fontWeight:700}}>{badge}</span>}
    </div>
  );
}

function KpiCard({ label, value, sub, color, icon }) {
  return (
    <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:8, padding:"14px 16px", flex:1, minWidth:140 }}>
      <div style={{ fontSize:10, color:"var(--text3)", textTransform:"uppercase", letterSpacing:.8, marginBottom:6, display:"flex", justifyContent:"space-between" }}>
        <span>{label}</span><span style={{fontSize:16}}>{icon}</span>
      </div>
      <div style={{ fontSize:22, fontWeight:700, color: color||"var(--text)", fontFamily:"var(--mono)" }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:"var(--text2)", marginTop:3 }}>{sub}</div>}
    </div>
  );
}

function SignalBadge({ signal }) {
  return (
    <span style={{
      fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:3,
      background: SIG_COL[signal]+"22", color: SIG_COL[signal]||"#7a9ab8",
      border: `1px solid ${SIG_COL[signal]||"#7a9ab8"}44`, textTransform:"uppercase", letterSpacing:.3
    }}>{signal||"–"}</span>
  );
}

function ConvBadge({ conv }) {
  return (
    <span style={{
      fontSize:10, fontWeight:700, padding:"2px 7px", borderRadius:3,
      background: (CONV_COL[conv]||"#7a9ab8")+"22", color: CONV_COL[conv]||"#7a9ab8",
      border: `1px solid ${CONV_COL[conv]||"#7a9ab8"}44`
    }}>{conv}</span>
  );
}

function Th({ children, right }) {
  return <th style={{ fontSize:10, color:"var(--text3)", textTransform:"uppercase", letterSpacing:.8, padding:"8px 10px", textAlign:right?"right":"left", borderBottom:"1px solid var(--border)", fontWeight:600, whiteSpace:"nowrap" }}>{children}</th>;
}
function Td({ children, right, mono, color, style:sx }) {
  return <td style={{ padding:"9px 10px", fontSize:12, textAlign:right?"right":"left", color:color||"var(--text)", fontFamily:mono?"var(--mono)":undefined, borderBottom:"1px solid var(--border2)", ...sx }}>{children}</td>;
}

function SectionHeader({ title, sub, children }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexWrap:"wrap", gap:8 }}>
      <div>
        <div style={{ fontSize:16, fontWeight:700, color:"var(--text)" }}>{title}</div>
        {sub && <div style={{ fontSize:11, color:"var(--text2)", marginTop:2 }}>{sub}</div>}
      </div>
      <div style={{ display:"flex", gap:8 }}>{children}</div>
    </div>
  );
}

function Btn({ children, onClick, variant="primary", small }) {
  const styles = {
    primary: { background:"var(--blue2)", color:"#fff", border:"1px solid var(--blue)" },
    ghost: { background:"transparent", color:"var(--blue)", border:"1px solid var(--border2)" },
    danger: { background:"var(--red-dim)", color:"var(--red)", border:"1px solid var(--red)44" },
    amber: { background:"var(--amber-dim)", color:"var(--amber)", border:"1px solid var(--amber)44" },
    success: { background:"var(--green-dim)", color:"var(--green)", border:"1px solid var(--green)44" },
  };
  return (
    <button onClick={onClick} style={{
      ...styles[variant], padding: small ? "5px 12px" : "7px 14px",
      borderRadius:5, fontSize:small?10:12, fontWeight:600, cursor:"pointer", fontFamily:"var(--sans)"
    }}>{children}</button>
  );
}

/* ─── CHART: Sparkline ─── */
function Spark({ data, color="#1e90ff" }) {
  return (
    <ResponsiveContainer width={80} height={30}>
      <LineChart data={data}>
        <Line type="monotone" dataKey="price" stroke={color} strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ─── MODULE 1: OI DASHBOARD ─── */
function OIDashboard({ stocks, priceData }) {
  const [filter, setFilter] = useState("All");
  const [sortKey, setSortKey] = useState("oiChg");
  const [selected, setSelected] = useState(stocks[0]);

  const signals = ["All","Long Buildup","Short Buildup","Long Unwinding","Short Covering"];
  const filtered = stocks
    .filter(s => filter === "All" || s.signal === filter)
    .sort((a,b) => Math.abs(b[sortKey]||0) - Math.abs(a[sortKey]||0));

  const selectedPriceData = priceData[selected.sym] || [];
  const lbCount = stocks.filter(s=>s.signal==="Long Buildup").length;
  const sbCount = stocks.filter(s=>s.signal==="Short Buildup").length;
  const avgPcr = (stocks.reduce((a,b)=>a+(b.pcr||0),0)/stocks.length).toFixed(2);

  return (
    <div className="fade-in">
      <SectionHeader title="OI & Derivatives Dashboard" sub="F&O Positioning · Option Chain · Futures OI">
        <Btn variant="ghost" small onClick={()=>exportCSV("oi_dashboard.csv",[
          ["Symbol","CMP","Chg%","Futures","Basis","OI","OI Chg%","PCR","MaxCE","MaxPE","ADR%","BurstPower","Signal"],
          ...stocks.map(s=>[s.sym,s.cmp,s.chg,s.fut,(s.fut-s.cmp).toFixed(2),s.oi,s.oiChg,s.pcr,s.maxCE,s.maxPE,s.adr,s.burst,s.signal])
        ])}>⬇ Export CSV</Btn>
      </SectionHeader>

      {/* KPIs */}
      <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        <KpiCard label="Long Buildups" value={lbCount} sub="Bullish OI positioning" color="var(--green)" icon="↑" />
        <KpiCard label="Short Buildups" value={sbCount} sub="Bearish OI positioning" color="var(--red)" icon="↓" />
        <KpiCard label="Avg PCR" value={avgPcr} sub="Put-Call Ratio universe" color={avgPcr>1?"var(--green)":"var(--red)"} icon="⚖" />
        <KpiCard label="Tracked Stocks" value={stocks.length} sub="F&O universe" color="var(--blue)" icon="◉" />
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 340px", gap:14, alignItems:"start" }}>
        {/* Main Table */}
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:8, overflow:"hidden" }}>
          {/* Filters */}
          <div style={{ padding:"10px 14px", borderBottom:"1px solid var(--border)", display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
            {signals.map(s => (
              <button key={s} onClick={()=>setFilter(s)} style={{
                padding:"4px 10px", borderRadius:4, fontSize:11, fontWeight:600, cursor:"pointer",
                background: filter===s ? SIG_COL[s]||"var(--blue2)" : "transparent",
                color: filter===s ? "#fff" : "var(--text2)",
                border: `1px solid ${filter===s ? SIG_COL[s]||"var(--blue)" : "var(--border)"}`,
              }}>{s}</button>
            ))}
          </div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr>
                  <Th>Symbol</Th><Th right>CMP</Th><Th right>Chg%</Th>
                  <Th right>Futures</Th><Th right>OI</Th>
                  <Th right onClick={()=>setSortKey("oiChg")} style={{cursor:"pointer"}}>OI Δ% {sortKey==="oiChg"?"▾":""}</Th>
                  <Th right>PCR</Th><Th right>ADR%</Th>
                  <Th right onClick={()=>setSortKey("burst")} style={{cursor:"pointer"}}>Burst {sortKey==="burst"?"▾":""}</Th>
                  <Th>Signal</Th><Th>Spark</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const sp = priceData[s.sym]||[];
                  const spCol = s.chg >= 0 ? "#10b981" : "#ef4444";
                  return (
                    <tr key={s.sym} onClick={()=>setSelected(s)} style={{ cursor:"pointer", background: selected.sym===s.sym ? "var(--blue-dim)" : "transparent" }}>
                      <Td><div style={{fontWeight:700,color:"var(--blue)"}}>{s.sym}</div><div style={{fontSize:10,color:"var(--text3)"}}>{s.sector}</div></Td>
                      <Td right mono>₹{fm(s.cmp)}</Td>
                      <Td right mono color={s.chg>=0?"var(--green)":"var(--red)"}>{fp(s.chg)}</Td>
                      <Td right mono>₹{fm(s.fut)}</Td>
                      <Td right mono>{fi(s.oi)}</Td>
                      <Td right mono color={s.oiChg>=0?"var(--green)":"var(--red)"}>{fp(s.oiChg)}</Td>
                      <Td right mono color={s.pcr>1?"var(--green)":s.pcr<0.7?"var(--red)":"var(--amber)"}>{s.pcr?.toFixed(2)}</Td>
                      <Td right mono color="var(--amber)">{s.adr?.toFixed(2)}%</Td>
                      <Td right mono color={s.burst>=15?"var(--green)":s.burst>=10?"var(--amber)":"var(--red)"}>{s.burst?.toFixed(1)}</Td>
                      <Td><SignalBadge signal={s.signal}/></Td>
                      <Td><Spark data={sp} color={spCol}/></Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail Panel */}
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:8, padding:16 }}>
          <div style={{ fontSize:18, fontWeight:700, marginBottom:2 }}>{selected.sym}</div>
          <div style={{ fontSize:11, color:"var(--text2)", marginBottom:14 }}>{selected.sector}</div>
          <SignalBadge signal={selected.signal}/>
          <div style={{ marginTop:14, marginBottom:10 }}>
            <ResponsiveContainer width="100%" height={110}>
              <AreaChart data={priceData[selected.sym]||[]}>
                <defs>
                  <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1e90ff" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#1e90ff" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="price" stroke="#1e90ff" strokeWidth={2} fill="url(#priceGrad)" dot={false}/>
                <Tooltip contentStyle={{background:"var(--bg3)",border:"1px solid var(--border)",fontSize:11}} formatter={v=>`₹${fm(v)}`} labelFormatter={()=>""} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {[
            ["CMP", `₹${fm(selected.cmp)}`], ["Futures", `₹${fm(selected.fut)}`],
            ["Basis", `₹${(selected.fut-selected.cmp).toFixed(2)}`],
            ["Open Interest", fi(selected.oi)], ["OI Change", fp(selected.oiChg)],
            ["PCR", selected.pcr?.toFixed(2)], ["Max CE Strike", fi(selected.maxCE)],
            ["Max PE Strike", fi(selected.maxPE)], ["ADR %", selected.adr?.toFixed(2)+"%"],
            ["Burst Power", selected.burst?.toFixed(1)],
          ].map(([l,v]) => (
            <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:"1px solid var(--border2)", fontSize:12 }}>
              <span style={{color:"var(--text2)"}}>{l}</span>
              <span style={{fontFamily:"var(--mono)",fontWeight:500}}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── MODULE 2: SWING TRADES ─── */
function SwingTrades({ trades, priceData }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({sym:"",setup:"",entry:"",sl:"",t1:"",t2:"",t3:"",qty:"",conviction:"High",notes:""});
  const [localTrades, setLocalTrades] = useState(trades);

  const open = localTrades.filter(t=>t.status==="Open"||t.status==="Partial");
  const closed = localTrades.filter(t=>t.status==="SL Hit"||t.status==="Closed");
  const totalPnl = open.reduce((s,t)=>{
    if(!t.entry) return s;
    return s + (t.cmp-t.entry)*t.qty;
  }, 0);
  const pnlSeries = genPnlSeries(localTrades.filter(t=>t.status==="SL Hit").map(t=>({...t,pnl:-(t.entry-t.sl)*t.qty, status:"Closed"})));

  const addTrade = () => {
    if (!form.sym || !form.entry) return;
    setLocalTrades(prev => [...prev, { ...form, id:Date.now(), entry:+form.entry, sl:+form.sl, t1:+form.t1, t2:+form.t2, t3:+form.t3, qty:+form.qty, cmp:+form.entry, date:new Date().toISOString().slice(0,10), status:"Open" }]);
    setForm({sym:"",setup:"",entry:"",sl:"",t1:"",t2:"",t3:"",qty:"",conviction:"High",notes:""});
    setShowForm(false);
  };

  return (
    <div className="fade-in">
      <SectionHeader title="Swing Trade Manager" sub="Mr. Market Rulebook · Risk-first · EMA-aligned">
        <Btn variant="ghost" small onClick={()=>setShowForm(v=>!v)}>+ New Trade</Btn>
        <Btn variant="ghost" small onClick={()=>exportCSV("swing_trades.csv",[
          ["Symbol","Setup","Entry","SL","T1","T2","T3","Qty","CMP","P&L","P&L%","1x RR","Date","Status","SA","Notes"],
          ...localTrades.map(t=>[t.sym,t.setup,t.entry,t.sl,t.t1,t.t2,t.t3,t.qty,t.cmp,((t.cmp-t.entry)*t.qty).toFixed(0),(pnlPct(t.entry,t.cmp)).toFixed(2),rr(t.entry,t.sl,t.t1),t.date,t.status,t.sa,t.notes])
        ])}>⬇ Export</Btn>
      </SectionHeader>

      {/* KPIs */}
      <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        <KpiCard label="Open Positions" value={open.length} sub="Active trades" color="var(--blue)" icon="📈"/>
        <KpiCard label="Unrealised P&L" value={`₹${fi(totalPnl)}`} sub="Mark to market" color={totalPnl>=0?"var(--green)":"var(--red)"} icon={totalPnl>=0?"▲":"▼"}/>
        <KpiCard label="Win Rate" value={`${Math.round(closed.filter(t=>t.status!=="SL Hit").length/Math.max(closed.length,1)*100)}%`} sub={`${closed.length} closed trades`} color="var(--amber)" icon="🎯"/>
        <KpiCard label="Closed P&L" value={`₹${fi(closed.reduce((s,t)=>s+(t.status==="SL Hit"?-(t.entry-t.sl)*t.qty:(t.cmp-t.entry)*t.qty),0))}`} sub="Realised" color="var(--green)" icon="✓"/>
      </div>

      {/* Add Trade Form */}
      {showForm && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:8, padding:16, marginBottom:16 }}>
          <div style={{ fontWeight:600, marginBottom:12, fontSize:13 }}>New Swing Trade</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:10 }}>
            {[["sym","Symbol"],["setup","Setup"],["entry","Entry ₹"],["sl","SL ₹"],["t1","T1 ₹"],["t2","T2 ₹"],["t3","T3 ₹"],["qty","Qty"]].map(([k,l])=>(
              <div key={k}>
                <div style={{fontSize:10,color:"var(--text3)",marginBottom:3,textTransform:"uppercase"}}>{l}</div>
                <input value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))}
                  style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:4,padding:"6px 8px",color:"var(--text)",fontSize:12}}/>
              </div>
            ))}
            <div>
              <div style={{fontSize:10,color:"var(--text3)",marginBottom:3,textTransform:"uppercase"}}>Conviction</div>
              <select value={form.conviction} onChange={e=>setForm(f=>({...f,conviction:e.target.value}))}
                style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:4,padding:"6px 8px",color:"var(--text)",fontSize:12}}>
                {["Gold","High","Medium","Low","Punt"].map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div style={{marginTop:10}}>
            <div style={{fontSize:10,color:"var(--text3)",marginBottom:3,textTransform:"uppercase"}}>Notes</div>
            <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}
              style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:4,padding:"6px 8px",color:"var(--text)",fontSize:12}} placeholder="Setup notes, reason..."/>
          </div>
          <div style={{display:"flex",gap:8,marginTop:12}}>
            <Btn onClick={addTrade}>Add Trade</Btn>
            <Btn variant="ghost" onClick={()=>setShowForm(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      {/* Active Trades */}
      <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:8, overflow:"hidden", marginBottom:14 }}>
        <div style={{padding:"10px 14px",borderBottom:"1px solid var(--border)",fontSize:12,fontWeight:600,color:"var(--green)"}}>⬤ Active Positions ({open.length})</div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead><tr>
              <Th>Symbol</Th><Th>Setup</Th><Th right>Entry</Th><Th right>SL</Th>
              <Th right>T1 / T2</Th><Th right>Qty</Th><Th right>CMP</Th>
              <Th right>P&L</Th><Th right>P&L%</Th><Th right>1x RR</Th>
              <Th>Conv</Th><Th>Status</Th>
            </tr></thead>
            <tbody>
              {open.map(t => {
                const pnl = (t.cmp - t.entry) * t.qty;
                const pct = pnlPct(t.entry, t.cmp);
                return (
                  <tr key={t.id}>
                    <Td><div style={{fontWeight:700,color:"var(--blue)"}}>{t.sym}</div><div style={{fontSize:10,color:"var(--text3)"}}>{t.date}</div></Td>
                    <Td><span style={{fontSize:11,color:"var(--text2)"}}>{t.setup}</span></Td>
                    <Td right mono>₹{fm(t.entry)}</Td>
                    <Td right mono color="var(--red)">₹{fm(t.sl)}</Td>
                    <Td right mono style={{fontSize:11}}><div>₹{fm(t.t1)}</div><div style={{color:"var(--text3)"}}>₹{fm(t.t2)}</div></Td>
                    <Td right mono>{fi(t.qty)}</Td>
                    <Td right mono>₹{fm(t.cmp)}</Td>
                    <Td right mono color={pnl>=0?"var(--green)":"var(--red)"}>₹{fi(pnl)}</Td>
                    <Td right mono color={pct>=0?"var(--green)":"var(--red)"}>{fp(pct)}</Td>
                    <Td right mono color="var(--amber)">{rr(t.entry,t.sl,t.t1)}</Td>
                    <Td><ConvBadge conv={t.conviction}/></Td>
                    <Td><span style={{fontSize:10,color:t.status==="Partial"?"var(--amber)":"var(--green)",fontWeight:600}}>{t.status}</span></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* P&L Chart */}
      {closed.length > 0 && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:8, padding:16 }}>
          <div style={{ fontSize:12, fontWeight:600, color:"var(--text2)", marginBottom:12 }}>CLOSED TRADE HISTORY</div>
          <div style={{ overflowX:"auto", marginBottom: 12 }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr><Th>Symbol</Th><Th>Setup</Th><Th right>Entry</Th><Th right>SL</Th><Th right>Qty</Th><Th right>P&L</Th><Th>Date</Th><Th>Status</Th></tr></thead>
              <tbody>
                {closed.map(t => {
                  const pnl = t.status==="SL Hit" ? -(t.entry-t.sl)*t.qty : (t.cmp-t.entry)*t.qty;
                  return (
                    <tr key={t.id}>
                      <Td><span style={{fontWeight:700}}>{t.sym}</span></Td>
                      <Td>{t.setup}</Td>
                      <Td right mono>₹{fm(t.entry)}</Td>
                      <Td right mono color="var(--red)">₹{fm(t.sl)}</Td>
                      <Td right mono>{fi(t.qty)}</Td>
                      <Td right mono color={pnl>=0?"var(--green)":"var(--red)"}>₹{fi(pnl)}</Td>
                      <Td>{t.date}</Td>
                      <Td><span style={{fontSize:10,color:t.status==="SL Hit"?"var(--red)":"var(--text2)",fontWeight:600}}>{t.status}</span></Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── MODULE 3: RESULT NEWS TRADING ─── */
function ResultTrading({ trades }) {
  const [localTrades, setLocalTrades] = useState(trades);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({sym:"",quarter:"",direction:"Long",conviction:"High",entry:"",qty:""});

  const closed = localTrades.filter(t=>t.status==="Closed");
  const totalRealised = closed.reduce((s,t)=>s+(t.pnl||0),0);
  const wins = closed.filter(t=>(t.pnl||0)>0).length;

  const beatMiss = (est,act) => {
    if (!est || !act) return null;
    return ((act-est)/est*100).toFixed(1);
  };

  return (
    <div className="fade-in">
      <SectionHeader title="Result News Trading" sub="Pre-result positioning · Bloomberg vs Street · No post-result holds">
        <Btn variant="ghost" small onClick={()=>setShowForm(v=>!v)}>+ New Position</Btn>
        <Btn variant="ghost" small onClick={()=>exportCSV("result_trades.csv",[
          ["Symbol","Quarter","Direction","Conviction","Entry","Exit","Qty","Rev Est","Rev Act","Beat/Miss%","PAT Est","PAT Act","Pre-Px%","Post-Px%","P&L","Status"],
          ...localTrades.map(t=>[t.sym,t.quarter,t.direction,t.conviction,t.entry,t.exit,t.qty,t.revEst,t.revAct,beatMiss(t.revEst,t.revAct),t.patEst,t.patAct,t.prePx,t.postPx,t.pnl,t.status])
        ])}>⬇ Export</Btn>
      </SectionHeader>

      <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
        <KpiCard label="Total Realised" value={`₹${fi(totalRealised)}`} sub="Result trades" color={totalRealised>=0?"var(--green)":"var(--red)"} icon="💰"/>
        <KpiCard label="Win Rate" value={`${closed.length ? Math.round(wins/closed.length*100) : 0}%`} sub={`${wins}W / ${closed.length-wins}L`} color="var(--amber)" icon="🎯"/>
        <KpiCard label="Active" value={localTrades.filter(t=>t.status==="Active").length} sub="Pre-result positions" color="var(--blue)" icon="⚡"/>
        <KpiCard label="Pipeline" value={localTrades.filter(t=>t.status==="Pre-Entry").length} sub="Watching" color="var(--purple)" icon="👁"/>
      </div>

      {showForm && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:8, padding:16, marginBottom:16 }}>
          <div style={{ fontWeight:600, marginBottom:12 }}>Add Result Trade</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:10 }}>
            {[["sym","Symbol"],["quarter","Quarter"],["entry","Entry ₹"],["qty","Qty"]].map(([k,l])=>(
              <div key={k}>
                <div style={{fontSize:10,color:"var(--text3)",marginBottom:3}}>{l}</div>
                <input value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))}
                  style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:4,padding:"6px 8px",color:"var(--text)",fontSize:12}}/>
              </div>
            ))}
            {[["direction","Direction",["Long","Short"]],["conviction","Conviction",["Gold","High","Medium","Low","Punt"]]].map(([k,l,opts])=>(
              <div key={k}>
                <div style={{fontSize:10,color:"var(--text3)",marginBottom:3}}>{l}</div>
                <select value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))}
                  style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:4,padding:"6px 8px",color:"var(--text)",fontSize:12}}>
                  {opts.map(o=><option key={o}>{o}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:8,marginTop:12}}>
            <Btn onClick={()=>{setLocalTrades(p=>[...p,{...form,id:Date.now(),entry:+form.entry,qty:+form.qty,status:"Active",pnl:null,revEst:null,revAct:null,patEst:null,patAct:null,prePx:null,postPx:null}]);setShowForm(false);}}>Add</Btn>
            <Btn variant="ghost" onClick={()=>setShowForm(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:8, overflow:"hidden" }}>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead><tr>
              <Th>Symbol</Th><Th>Quarter</Th><Th>Direction</Th><Th>Conv</Th>
              <Th right>Entry</Th><Th right>Exit</Th><Th right>Qty</Th>
              <Th right>Rev Beat/Miss</Th><Th right>PAT Beat/Miss</Th>
              <Th right>Pre-Px%</Th><Th right>Post-Px%</Th>
              <Th right>P&L</Th><Th>Status</Th>
            </tr></thead>
            <tbody>
              {localTrades.map(t => {
                const revBM = beatMiss(t.revEst, t.revAct);
                const patBM = beatMiss(t.patEst, t.patAct);
                return (
                  <tr key={t.id}>
                    <Td><div style={{fontWeight:700,color:"var(--blue)"}}>{t.sym}</div></Td>
                    <Td><span style={{fontSize:11,color:"var(--text2)"}}>{t.quarter}</span></Td>
                    <Td><span style={{fontSize:11,fontWeight:700,color:t.direction==="Long"?"var(--green)":"var(--red)"}}>{t.direction}</span></Td>
                    <Td><ConvBadge conv={t.conviction}/></Td>
                    <Td right mono>{t.entry?`₹${fm(t.entry)}`:"–"}</Td>
                    <Td right mono>{t.exit?`₹${fm(t.exit)}`:"–"}</Td>
                    <Td right mono>{t.qty?fi(t.qty):"–"}</Td>
                    <Td right mono color={revBM===null?"var(--text3)":+revBM>=0?"var(--green)":"var(--red)"}>
                      {revBM ? (revBM>=0?"+":"")+revBM+"%" : "–"}
                    </Td>
                    <Td right mono color={patBM===null?"var(--text3)":+patBM>=0?"var(--green)":"var(--red)"}>
                      {patBM ? (patBM>=0?"+":"")+patBM+"%" : "–"}
                    </Td>
                    <Td right mono color={t.prePx==null?"var(--text3)":t.prePx>=0?"var(--green)":"var(--red)"}>{t.prePx!=null?fp(t.prePx):"–"}</Td>
                    <Td right mono color={t.postPx==null?"var(--text3)":t.postPx>=0?"var(--green)":"var(--red)"}>{t.postPx!=null?fp(t.postPx):"–"}</Td>
                    <Td right mono color={t.pnl==null?"var(--text3)":t.pnl>=0?"var(--green)":"var(--red)"}>
                      {t.pnl!=null?`₹${fi(t.pnl)}`:"–"}
                    </Td>
                    <Td>
                      <span style={{fontSize:10,fontWeight:700,color:t.status==="Closed"?"var(--text2)":t.status==="Active"?"var(--amber)":t.status==="Pre-Entry"?"var(--purple)":"var(--text3)"}}>{t.status}</span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* P&L Bar Chart */}
      {closed.length > 0 && (
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:8, padding:16, marginTop:14 }}>
          <div style={{ fontSize:12, fontWeight:600, color:"var(--text2)", marginBottom:12 }}>RESULT TRADE P&L</div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={closed}>
              <XAxis dataKey="sym" tick={{fontSize:11,fill:"#7a9ab8"}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:11,fill:"#7a9ab8"}} axisLine={false} tickLine={false} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`}/>
              <Tooltip contentStyle={{background:"var(--bg3)",border:"1px solid var(--border)",fontSize:11}} formatter={v=>`₹${fi(v)}`}/>
              <Bar dataKey="pnl" radius={[3,3,0,0]}>
                {closed.map((t,i)=><Cell key={i} fill={(t.pnl||0)>=0?"#10b981":"#ef4444"}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/* ─── MODULE 4: FUNDAMENTALS ─── */
function Fundamentals({ data }) {
  const [selected, setSelected] = useState(data[0]);
  const [view, setView] = useState("rev");

  const chartData = selected[view==="rev"?"rev":view==="opm"?"opm":"eps"].map((v,i)=>({q:`Q${i+1}`,v}));
  const chartColor = view==="rev"?"#1e90ff":view==="opm"?"#f59e0b":"#10b981";
  const latestRev = selected.rev[selected.rev.length-1];
  const prevRev = selected.rev[selected.rev.length-5] || selected.rev[0];
  const revGrowth = prevRev ? ((latestRev-prevRev)/prevRev*100).toFixed(1) : null;
  const latestOpm = selected.opm[selected.opm.length-1];
  const latestEps = selected.eps[selected.eps.length-1];

  return (
    <div className="fade-in">
      <SectionHeader title="Fundamental Research" sub="Revenue · EBITDA Margin · EPS · 8-Quarter Trend">
        <Btn variant="ghost" small onClick={()=>exportCSV("fundamentals.csv",[
          ["Symbol","Sector","Mkt Cap (Cr)","P/E","ROE%","Debt/Eq","Promoter%","Latest Rev","Rev Growth YoY%","Latest OPM%","Latest EPS"],
          ...data.map(s=>[s.sym,s.sector,s.mktCap,s.pe,s.roe,s.debtEq,s.promoter,s.rev[s.rev.length-1],((s.rev[s.rev.length-1]-s.rev[s.rev.length-5])/s.rev[s.rev.length-5]*100).toFixed(1),s.opm[s.opm.length-1],s.eps[s.eps.length-1]])
        ])}>⬇ Export</Btn>
      </SectionHeader>

      <div style={{ display:"grid", gridTemplateColumns:"220px 1fr", gap:14, alignItems:"start" }}>
        {/* Stock list */}
        <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:8, overflow:"hidden" }}>
          {data.map(s => {
            const g = s.rev.length>=5?((s.rev[s.rev.length-1]-s.rev[s.rev.length-5])/s.rev[s.rev.length-5]*100).toFixed(1):null;
            return (
              <div key={s.sym} onClick={()=>setSelected(s)} style={{
                padding:"12px 14px", cursor:"pointer", borderBottom:"1px solid var(--border2)",
                background: selected.sym===s.sym?"var(--blue-dim)":"transparent",
                borderLeft: selected.sym===s.sym?"3px solid var(--blue)":"3px solid transparent",
              }}>
                <div style={{fontWeight:700,fontSize:13}}>{s.sym}</div>
                <div style={{fontSize:10,color:"var(--text3)",marginTop:1}}>{s.sector}</div>
                <div style={{display:"flex",gap:8,marginTop:4,fontSize:10}}>
                  <span style={{color:"var(--text2)"}}>₹{fi(s.mktCap)} Cr</span>
                  {g && <span style={{color:+g>=0?"var(--green)":"var(--red)",fontFamily:"var(--mono)"}}>{+g>=0?"+":""}{g}%</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail */}
        <div>
          {/* Header metrics */}
          <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
            <KpiCard label="Market Cap" value={fCr(selected.mktCap)} color="var(--blue)" icon="🏢"/>
            <KpiCard label="P/E Ratio" value={selected.pe?.toFixed(1)+"x"} color="var(--amber)" icon="📊"/>
            <KpiCard label="ROE %" value={selected.roe?.toFixed(1)+"%"} color="var(--green)" icon="↩"/>
            <KpiCard label="Debt/Equity" value={selected.debtEq?.toFixed(2)+"x"} color={selected.debtEq>1?"var(--red)":"var(--green)"} icon="⚖"/>
            <KpiCard label="Promoter %" value={selected.promoter?.toFixed(1)+"%"} color={selected.promoter>51?"var(--green)":"var(--amber)"} icon="👤"/>
          </div>

          {/* Chart */}
          <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:8, padding:16, marginBottom:14 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div style={{ fontSize:13, fontWeight:600 }}>{selected.sym} — 8Q Trend</div>
              <div style={{ display:"flex", gap:6 }}>
                {[["rev","Revenue"],["opm","OPM %"],["eps","EPS"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setView(k)} style={{
                    padding:"4px 10px", borderRadius:4, fontSize:11, fontWeight:600, cursor:"pointer",
                    background: view===k ? (k==="rev"?"var(--blue2)":k==="opm"?"#b45309":"#065f46") : "transparent",
                    color: view===k ? "#fff" : "var(--text2)", border:`1px solid ${view===k?(k==="rev"?"var(--blue)":"var(--border)"):"var(--border)"}`,
                  }}>{l}</button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData}>
                <XAxis dataKey="q" tick={{fontSize:11,fill:"#7a9ab8"}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:11,fill:"#7a9ab8"}} axisLine={false} tickLine={false}
                  tickFormatter={v=>view==="rev"?`₹${(v/1000).toFixed(0)}k`:view==="opm"?`${v}%`:`₹${v}`}/>
                <Tooltip contentStyle={{background:"var(--bg3)",border:"1px solid var(--border)",fontSize:11}}
                  formatter={v=>view==="rev"?`₹${fi(v)} Cr`:view==="opm"?`${v}%`:`₹${v}`}/>
                <Bar dataKey="v" radius={[3,3,0,0]}>
                  {chartData.map((_, i) => <Cell key={i} fill={i===chartData.length-1?chartColor:chartColor+"66"}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Detail table */}
          <div style={{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:8, overflow:"hidden" }}>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr>
                <Th>Metric</Th>
                {selected.rev.map((_,i)=><Th key={i} right>Q{i+1}{i===selected.rev.length-1?" (Latest)":""}</Th>)}
              </tr></thead>
              <tbody>
                <tr>
                  <Td>Revenue (₹ Cr)</Td>
                  {selected.rev.map((v,i)=><Td key={i} right mono color={i===selected.rev.length-1?"var(--blue)":undefined}>{fi(v)}</Td>)}
                </tr>
                <tr>
                  <Td>OPM %</Td>
                  {selected.opm.map((v,i)=><Td key={i} right mono color={i===selected.opm.length-1?"var(--amber)":undefined}>{v?.toFixed(1)}%</Td>)}
                </tr>
                <tr>
                  <Td>EPS (₹)</Td>
                  {selected.eps.map((v,i)=><Td key={i} right mono color={i===selected.eps.length-1?"var(--green)":undefined}>{fm(v)}</Td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── TICKER TAPE ─── */
function TickerTape({ stocks }) {
  const items = [...stocks, ...stocks];
  return (
    <div style={{ background:"var(--bg2)", borderBottom:"1px solid var(--border)", overflow:"hidden", height:28, display:"flex", alignItems:"center" }}>
      <div style={{ whiteSpace:"nowrap", animation:"ticker 40s linear infinite", display:"flex", gap:0 }}>
        {items.map((s,i) => (
          <span key={i} style={{ padding:"0 20px", fontSize:11, fontFamily:"var(--mono)", borderRight:"1px solid var(--border)" }}>
            <span style={{fontWeight:700,color:"var(--blue)"}}>{s.sym}</span>
            <span style={{color:"var(--text)",marginLeft:6}}>₹{fm(s.cmp)}</span>
            <span style={{color:s.chg>=0?"var(--green)":"var(--red)",marginLeft:5}}>{fp(s.chg)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─── MAIN APP ─── */
export default function App() {
  const [module, setModule] = useState("oi");
  const [tick, setTick] = useState(0);
  const [stocks, setStocks] = useState(STOCKS);

  // Simulate live price updates
  useEffect(() => {
    const interval = setInterval(() => {
      setStocks(prev => prev.map(s => ({
        ...s,
        cmp: +(s.cmp * (1 + (Math.random() - 0.499) * 0.002)).toFixed(2),
        chg: +(s.chg + (Math.random() - 0.5) * 0.05).toFixed(2),
        oiChg: +(s.oiChg + (Math.random() - 0.5) * 0.1).toFixed(2),
      })));
      setTick(t => t + 1);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Pre-generate price series
  const priceData = useRef({});
  if (Object.keys(priceData.current).length === 0) {
    STOCKS.forEach(s => { priceData.current[s.sym] = genPriceSeries(s.cmp); });
  }

  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const h = ist.getHours(), m = ist.getMinutes(), day = ist.getDay();
  const isLive = day >= 1 && day <= 5 && ((h===9&&m>=15)||(h>9&&h<15)||(h===15&&m<=30));

  const nav = [
    { id:"oi", icon:"◈", label:"OI Dashboard", badge: stocks.filter(s=>s.signal==="Long Buildup").length+"LB" },
    { id:"swing", icon:"📈", label:"Swing Trades", badge: SWING_TRADES.filter(t=>t.status==="Open").length },
    { id:"result", icon:"⚡", label:"Result Trades", badge: RESULT_TRADES.filter(t=>t.status==="Active").length },
    { id:"fund", icon:"🔬", label:"Fundamentals" },
  ];

  return (
    <>
      <FontLink/>
      <div style={{ display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden" }}>
        {/* Top bar */}
        <div style={{ background:"var(--bg2)", borderBottom:"1px solid var(--border)", padding:"0 20px", display:"flex", alignItems:"center", justifyContent:"space-between", height:48, flexShrink:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ fontSize:16, fontWeight:700, fontFamily:"var(--mono)", color:"var(--blue)", letterSpacing:1 }}>MKTDESK</div>
            <div style={{ fontSize:10, color:"var(--text3)", borderLeft:"1px solid var(--border)", paddingLeft:12 }}>Indian Equity · F&O · L/S</div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11 }}>
              <span className={isLive?"live-dot":""} style={{ width:7, height:7, borderRadius:"50%", background:isLive?"var(--green)":"var(--amber)", display:"inline-block" }}/>
              <span style={{ color:isLive?"var(--green)":"var(--amber)", fontWeight:600 }}>{isLive?"LIVE":"EOD"}</span>
            </div>
            <div style={{ fontSize:11, color:"var(--text3)", fontFamily:"var(--mono)" }}>
              {ist.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true})} IST
            </div>
            <div style={{ fontSize:11, color:"var(--text3)" }}>
              {ist.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}
            </div>
          </div>
        </div>

        {/* Ticker */}
        <TickerTape stocks={stocks}/>

        {/* Body */}
        <div style={{ display:"flex", flex:1, overflow:"hidden" }}>
          {/* Sidebar */}
          <div style={{ width:200, background:"var(--bg2)", borderRight:"1px solid var(--border)", display:"flex", flexDirection:"column", flexShrink:0, paddingTop:10 }}>
            {nav.map(n => (
              <NavItem key={n.id} icon={n.icon} label={n.label} active={module===n.id} onClick={()=>setModule(n.id)} badge={n.badge}/>
            ))}
            <div style={{ marginTop:"auto", padding:"12px 16px", borderTop:"1px solid var(--border)" }}>
              <div style={{ fontSize:9, color:"var(--text3)", textTransform:"uppercase", letterSpacing:.8, marginBottom:6 }}>Market Breadth</div>
              {[
                { label:"Nifty 500", val:"+0.34%", up:true },
                { label:"MBI Score", val:"612", up:true },
                { label:"% >20DMA", val:"54%", up:true },
              ].map(({label,val,up})=>(
                <div key={label} style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:4 }}>
                  <span style={{color:"var(--text3)"}}>{label}</span>
                  <span style={{color:up?"var(--green)":"var(--red)",fontFamily:"var(--mono)",fontWeight:600}}>{val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Content */}
          <div style={{ flex:1, overflowY:"auto", padding:20, background:"var(--bg)" }}>
            {module === "oi" && <OIDashboard stocks={stocks} priceData={priceData.current}/>}
            {module === "swing" && <SwingTrades trades={SWING_TRADES} priceData={priceData.current}/>}
            {module === "result" && <ResultTrading trades={RESULT_TRADES}/>}
            {module === "fund" && <Fundamentals data={FUNDAMENTALS}/>}
          </div>
        </div>
      </div>
    </>
  );
}
