/**
 * MKTDESK — NSE Bhavcopy Edition
 * Data: NSE CM + FO Bhavcopy (released ~6 PM IST daily, free, no auth)
 * Auto-refreshes on load. During market hours polls every 5 min.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";

/* ─── Fonts ──────────────────────────────────────────────────────────────── */
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
      --purple:#8b5cf6;
      --text:#c9d8e8;--text2:#7a9ab8;--text3:#3d5a78;
      --mono:'IBM Plex Mono',monospace;--sans:'IBM Plex Sans',sans-serif;
    }
    body{background:var(--bg);color:var(--text);font-family:var(--sans)}
    input,select{font-family:var(--sans)}
    ::-webkit-scrollbar{width:4px;height:4px}
    ::-webkit-scrollbar-track{background:var(--bg2)}
    ::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
    @keyframes ticker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .fade-in{animation:fadeIn .25s ease forwards}
    .spin{animation:spin .9s linear infinite}
    .pulse{animation:pulse 2s ease-in-out infinite}
  `}</style>
);

/* ─── F&O Universe (sectors stay local; price/OI comes from Bhavcopy) ─────── */
const FO_META = [
  {sym:"RELIANCE",sector:"Oil Gas & Fuels"},{sym:"HDFCBANK",sector:"Pvt Bank"},
  {sym:"INFY",sector:"IT"},{sym:"TCS",sector:"IT"},{sym:"ICICIBANK",sector:"Pvt Bank"},
  {sym:"SRF",sector:"Chemicals"},{sym:"PIIND",sector:"Chemicals"},
  {sym:"DIXON",sector:"Consumer Dur"},{sym:"ZOMATO",sector:"Consumer Svc"},
  {sym:"BHARTIARTL",sector:"Telecom"},{sym:"SBIN",sector:"PSU Bank"},
  {sym:"AXISBANK",sector:"Pvt Bank"},{sym:"HCLTECH",sector:"IT"},
  {sym:"SUNPHARMA",sector:"Healthcare"},{sym:"TATAMOTORS",sector:"Automobile"},
  {sym:"MARUTI",sector:"Automobile"},{sym:"LT",sector:"Construction"},
  {sym:"WIPRO",sector:"IT"},{sym:"KOTAKBANK",sector:"Pvt Bank"},
  {sym:"BAJFINANCE",sector:"NBFC"},{sym:"ONGC",sector:"Oil Gas & Fuels"},
  {sym:"NTPC",sector:"Power"},{sym:"POWERGRID",sector:"Power"},
  {sym:"DLF",sector:"Realty"},{sym:"NAVINFLUOR",sector:"Chemicals"},
];

/* ─── Swing & Result trade templates (user edits) ──────────────────────────── */
const SWING_INIT = [
  {id:1,sym:"SRF",setup:"VCP – 3T",entry:2180,sl:2080,t1:2400,t2:2650,t3:3000,qty:46,date:"2026-02-12",status:"Open",conviction:"High",notes:"Stage 2, Burst Power 14.7, clean 3T"},
  {id:2,sym:"DIXON",setup:"IPO Base Cheat",entry:15400,sl:14800,t1:16800,t2:18500,t3:21000,qty:3,date:"2026-02-18",status:"Open",conviction:"Gold",notes:"Leader, RS >15, VDU active"},
  {id:3,sym:"PIIND",setup:"Flag",entry:2890,sl:2760,t1:3150,t2:3500,t3:4000,qty:17,date:"2026-01-28",status:"Partial",conviction:"High",notes:"Hit T1, trailing 50 EMA"},
  {id:4,sym:"COFORGE",setup:"Cup Handle",entry:7200,sl:6900,t1:7900,t2:8800,t3:10200,qty:7,date:"2026-02-05",status:"SL Hit",conviction:"Medium",notes:"Market turned"},
];
const RESULT_INIT = [
  {id:1,sym:"RELIANCE",quarter:"Q3 FY26",revEst:224000,revAct:231400,ebitdaEst:36200,ebitdaAct:38100,patEst:18200,patAct:19650,prePx:-4.2,postPx:3.8,conviction:"High",direction:"Long",qty:780,entry:1238,exit:1284,status:"Closed",pnl:35880},
  {id:2,sym:"INFY",quarter:"Q3 FY26",revEst:39800,revAct:38200,ebitdaEst:8200,ebitdaAct:7840,patEst:6800,patAct:6520,prePx:2.1,postPx:-3.4,conviction:"Gold",direction:"Short",qty:131,entry:1545,exit:1475,status:"Closed",pnl:9170},
  {id:3,sym:"SRF",quarter:"Q3 FY26",revEst:3400,revAct:null,ebitdaEst:720,ebitdaAct:null,patEst:380,patAct:null,prePx:8.2,postPx:null,conviction:"Medium",direction:"Long",qty:43,entry:2290,exit:null,status:"Active",pnl:null},
  {id:4,sym:"BHARTIARTL",quarter:"Q3 FY26",revEst:41200,revAct:43800,ebitdaEst:20100,ebitdaAct:21600,patEst:4200,patAct:5100,prePx:0.4,postPx:5.6,conviction:"High",direction:"Long",qty:265,entry:1789,exit:1892,status:"Closed",pnl:27295},
];
const FUND_DATA = [
  {sym:"SRF",sector:"Chemicals",rev:[2890,3120,3080,3200,2780,3010,2950,3400],opm:[18.2,19.1,18.8,20.3,17.9,18.5,19.0,20.1],eps:[42,48,46,52,38,44,47,54],pe:42.1,mktCap:69400,debtEq:0.82,roe:18.4,promoter:50.6},
  {sym:"DIXON",sector:"Consumer Dur",rev:[3200,3800,4100,4600,3100,3750,4200,5200],opm:[5.8,6.1,6.3,6.0,5.5,6.2,6.0,6.4],eps:[98,124,136,152,92,118,140,168],pe:96.7,mktCap:97500,debtEq:0.12,roe:28.6,promoter:34.1},
  {sym:"PIIND",sector:"Chemicals",rev:[1820,1940,2080,2200,1750,1890,2040,2340],opm:[22.1,23.4,22.8,24.1,21.5,22.9,23.2,24.8],eps:[62,68,72,78,58,65,71,80],pe:38.9,mktCap:46800,debtEq:0.22,roe:22.1,promoter:51.2},
  {sym:"BHARTIARTL",sector:"Telecom",rev:[38200,40100,41800,43800,36900,39000,41200,44500],opm:[51.2,52.4,51.8,53.1,50.8,51.9,52.3,53.6],eps:[14,18,21,26,12,16,20,28],pe:67.4,mktCap:1120000,debtEq:1.84,roe:14.2,promoter:56.2},
  {sym:"INFY",sector:"IT",rev:[36800,38200,37900,38200,36100,37400,38800,38200],opm:[21.3,20.8,21.1,20.5,21.8,21.2,20.9,20.5],eps:[60,62,63,62,58,61,63,62],pe:24.6,mktCap:634000,debtEq:0.0,roe:31.8,promoter:14.8},
];

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const fm = (v, d=2) => v==null||isNaN(v)?"–":Number(v).toLocaleString("en-IN",{minimumFractionDigits:d,maximumFractionDigits:d});
const fi = (v) => v==null||isNaN(v)?"–":Number(v).toLocaleString("en-IN",{maximumFractionDigits:0});
const fp = (v) => v==null||isNaN(v)?"–":(v>=0?"+":"")+Number(v).toFixed(2)+"%";
const fv = (v) => v==null||isNaN(v)?"–":Number(v).toFixed(1);
const pc = (v) => v==null?"":v>=0?"var(--green)":"var(--red)";
const rr = (e,sl,t) => e&&sl&&t?((t-e)/(e-sl)).toFixed(1)+"x":"–";
const bm = (est,act) => est&&act!==null&&act!==undefined?((act-est)/est*100).toFixed(1):null;

const SIG_COL = {"Long Buildup":"#10b981","Short Buildup":"#ef4444","Long Unwinding":"#f59e0b","Short Covering":"#1e90ff"};
const CONV_COL = {"Gold":"#f59e0b","High":"#10b981","Medium":"#1e90ff","Low":"#8b5cf6","Punt":"#7a9ab8"};

function exportCSV(name, rows) {
  const csv  = rows.map(r=>r.map(v=>`"${v??""}"`.replace(/\n/g," ")).join(",")).join("\n");
  const blob = new Blob([csv],{type:"text/csv"});
  const a    = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; a.click();
}

/* ─── Micro-components ───────────────────────────────────────────────────── */
const Btn = ({children,onClick,variant="primary",small})=>{
  const s={primary:{background:"var(--blue2)",color:"#fff",border:"1px solid var(--blue)"},ghost:{background:"transparent",color:"var(--blue)",border:"1px solid var(--border2)"},success:{background:"var(--green-dim)",color:"var(--green)",border:"1px solid rgba(16,185,129,.4)"},danger:{background:"var(--red-dim)",color:"var(--red)",border:"1px solid rgba(239,68,68,.4)"}};
  return <button onClick={onClick} style={{...s[variant],padding:small?"4px 10px":"7px 14px",borderRadius:5,fontSize:small?10:12,fontWeight:600,cursor:"pointer",fontFamily:"var(--sans)"}}>{children}</button>;
};
const Badge = ({text,color,bg,border})=><span style={{display:"inline-flex",alignItems:"center",padding:"2px 7px",borderRadius:3,fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:.4,background:bg,color,border:`1px solid ${border}`}}>{text}</span>;
const SigBadge = ({sig})=>{const c=SIG_COL[sig]||"#7a9ab8";return <Badge text={sig||"–"} color={c} bg={c+"22"} border={c+"44"}/>;};
const ConvBadge = ({c})=>{const col=CONV_COL[c]||"#7a9ab8";return <Badge text={c} color={col} bg={col+"22"} border={col+"44"}/>;};
const Th = ({children,right})=><th style={{fontSize:10,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.7,padding:"8px 10px",textAlign:right?"right":"left",borderBottom:"1px solid var(--border)",fontWeight:600,whiteSpace:"nowrap"}}>{children}</th>;
const Td = ({children,right,mono,color,style:sx})=><td style={{padding:"9px 10px",fontSize:12,textAlign:right?"right":"left",color:color||"var(--text)",fontFamily:mono?"var(--mono)":undefined,borderBottom:"1px solid var(--border2)",...sx}}>{children}</td>;

const KpiCard = ({label,value,sub,color,icon})=>(
  <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,padding:"14px 16px",flex:1,minWidth:130}}>
    <div style={{fontSize:10,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.8,marginBottom:6,display:"flex",justifyContent:"space-between"}}><span>{label}</span><span style={{fontSize:16}}>{icon}</span></div>
    <div style={{fontSize:22,fontWeight:700,color:color||"var(--text)",fontFamily:"var(--mono)"}}>{value}</div>
    {sub&&<div style={{fontSize:11,color:"var(--text2)",marginTop:3}}>{sub}</div>}
  </div>
);

/* ─── Module 1: OI Dashboard ─────────────────────────────────────────────── */
function OIModule({stocks,dataDate,loading,onRefresh}){
  const [sigFilter,setSigFilter]=useState("All");
  const [selected,setSelected]=useState(null);

  const filtered = stocks
    .filter(s=>sigFilter==="All"||s.signal===sigFilter)
    .sort((a,b)=>Math.abs(b.futOIChgPct||0)-Math.abs(a.futOIChgPct||0));

  const sel = selected || filtered[0] || stocks[0];

  if (loading && !stocks.length) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:300,gap:12,color:"var(--text2)"}}>
      <div className="spin" style={{width:28,height:28,border:"3px solid var(--border2)",borderTopColor:"var(--blue)",borderRadius:"50%"}}/>
      <div>Loading NSE Bhavcopy data…</div>
      <div style={{fontSize:11,color:"var(--text3)"}}>Fetching CM + FO Bhavcopy from NSE archives</div>
    </div>
  );

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:16,fontWeight:700}}>OI & Derivatives Dashboard</div>
          <div style={{fontSize:11,color:"var(--text2)",marginTop:2,display:"flex",alignItems:"center",gap:6}}>
            <span>NSE Bhavcopy · {dataDate||"loading…"}</span>
            {loading&&<span className="spin" style={{display:"inline-block",width:10,height:10,border:"2px solid var(--border2)",borderTopColor:"var(--blue)",borderRadius:"50%"}}/>}
          </div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn variant="ghost" small onClick={onRefresh}>↻ Refresh</Btn>
          <Btn variant="ghost" small onClick={()=>exportCSV("oi_bhavcopy.csv",[
            ["Symbol","Sector","CMP","Chg%","Futures","Basis%","FutOI","OI Chg%","PCR","MaxCE","MaxPE","Signal","Date"],
            ...stocks.map(s=>[s.sym,s.sector,s.cmp,s.changePct,s.futPrice,s.basisPct,s.futOI,s.futOIChgPct,s.pcr,s.maxCEStrike,s.maxPEStrike,s.signal,dataDate]),
          ])}>⬇ Export CSV</Btn>
        </div>
      </div>

      {/* KPIs */}
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        <KpiCard label="Long Buildups"  value={stocks.filter(s=>s.signal==="Long Buildup").length}  sub="Bullish positioning"  color="var(--green)"  icon="↑"/>
        <KpiCard label="Short Buildups" value={stocks.filter(s=>s.signal==="Short Buildup").length} sub="Bearish positioning"  color="var(--red)"    icon="↓"/>
        <KpiCard label="Avg PCR"        value={stocks.length?(stocks.reduce((a,b)=>a+(b.pcr||0),0)/stocks.filter(s=>s.pcr).length).toFixed(2):"–"} sub="Put-Call Ratio" color="var(--amber)" icon="⚖"/>
        <KpiCard label="Stocks Loaded"  value={stocks.length} sub="From Bhavcopy" color="var(--blue)" icon="◉"/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:14,alignItems:"start"}}>
        {/* Table */}
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,overflow:"hidden"}}>
          <div style={{padding:"8px 12px",borderBottom:"1px solid var(--border)",display:"flex",gap:6,flexWrap:"wrap"}}>
            {["All","Long Buildup","Short Buildup","Long Unwinding","Short Covering"].map(sig=>(
              <button key={sig} onClick={()=>setSigFilter(sig)} style={{padding:"3px 9px",borderRadius:4,fontSize:11,fontWeight:600,cursor:"pointer",background:sigFilter===sig?(SIG_COL[sig]||"var(--blue2)"):"transparent",color:sigFilter===sig?"#fff":"var(--text2)",border:`1px solid ${sigFilter===sig?(SIG_COL[sig]||"var(--blue)"):"var(--border)"}`}}>{sig}</button>
            ))}
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr>
                <Th>Symbol</Th><Th right>CMP</Th><Th right>Chg%</Th>
                <Th right>Futures</Th><Th right>Basis%</Th>
                <Th right>FutOI</Th><Th right>OI Δ%</Th>
                <Th right>PCR</Th><Th right>MaxCE</Th><Th right>MaxPE</Th>
                <Th>Signal</Th>
              </tr></thead>
              <tbody>
                {filtered.map(s=>(
                  <tr key={s.sym} onClick={()=>setSelected(s)} style={{cursor:"pointer",background:sel?.sym===s.sym?"var(--blue-dim)":"transparent"}}>
                    <Td><div style={{fontWeight:700,color:"var(--blue)"}}>{s.sym}</div><div style={{fontSize:10,color:"var(--text3)"}}>{s.sector}</div></Td>
                    <Td right mono>₹{fm(s.cmp)}</Td>
                    <Td right mono color={pc(s.changePct)}>{fp(s.changePct)}</Td>
                    <Td right mono>₹{fm(s.futPrice)}</Td>
                    <Td right mono color={pc(s.basisPct)}>{s.basisPct!=null?fm(s.basisPct,3)+"%":"–"}</Td>
                    <Td right mono>{fi(s.futOI)}</Td>
                    <Td right mono color={pc(s.futOIChgPct)}>{fp(s.futOIChgPct)}</Td>
                    <Td right mono color={s.pcr>1?"var(--green)":s.pcr<0.7?"var(--red)":"var(--amber)"}>{s.pcr?fm(s.pcr,3):"–"}</Td>
                    <Td right mono>{fi(s.maxCEStrike)}</Td>
                    <Td right mono>{fi(s.maxPEStrike)}</Td>
                    <Td><SigBadge sig={s.signal}/></Td>
                  </tr>
                ))}
                {!filtered.length&&<tr><td colSpan={11} style={{padding:20,textAlign:"center",color:"var(--text3)",fontSize:12}}>No data — Bhavcopy loads after 6 PM IST</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail panel */}
        {sel&&(
          <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,padding:16}}>
            <div style={{fontSize:18,fontWeight:700}}>{sel.sym}</div>
            <div style={{fontSize:11,color:"var(--text2)",marginBottom:10}}>{sel.sector}</div>
            <SigBadge sig={sel.signal}/>
            {[["CMP",`₹${fm(sel.cmp)}`],["Change",fp(sel.changePct)],["Futures",`₹${fm(sel.futPrice)}`],["Basis",`₹${fm(sel.basis)} (${fm(sel.basisPct,3)}%)`],["Fut OI",fi(sel.futOI)],["OI Chg",fp(sel.futOIChgPct)],["Max CE",fi(sel.maxCEStrike)],["Max PE",fi(sel.maxPEStrike)],["PCR",sel.pcr?fm(sel.pcr,3):"–"],["52W High",`₹${fm(sel.high52w)}`],["52W Low",`₹${fm(sel.low52w)}`],["Volume",fi(sel.volume)]].map(([l,v])=>(
              <div key={l} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid var(--border2)",fontSize:12}}>
                <span style={{color:"var(--text2)"}}>{l}</span>
                <span style={{fontFamily:"var(--mono)",fontWeight:500}}>{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Module 2: Swing Trades ─────────────────────────────────────────────── */
function SwingModule({stocks}){
  const [trades,setTrades]=useState(SWING_INIT);
  const [showForm,setShowForm]=useState(false);
  const [form,setForm]=useState({sym:"",setup:"",entry:"",sl:"",t1:"",t2:"",t3:"",qty:"",conviction:"High",notes:""});

  const getLatestCmp = sym=>stocks.find(s=>s.sym===sym)?.cmp||null;

  const open   = trades.filter(t=>t.status==="Open"||t.status==="Partial");
  const closed = trades.filter(t=>t.status==="SL Hit"||t.status==="Closed");
  const totalUnreal = open.reduce((s,t)=>{const c=getLatestCmp(t.sym)||t.entry;return s+(c-t.entry)*t.qty;},0);

  return(
    <div className="fade-in">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div><div style={{fontSize:16,fontWeight:700}}>Swing Trade Manager</div><div style={{fontSize:11,color:"var(--text2)",marginTop:2}}>CMP live from NSE Bhavcopy · Mr. Market Rulebook</div></div>
        <div style={{display:"flex",gap:8}}>
          <Btn variant="ghost" small onClick={()=>setShowForm(v=>!v)}>+ New Trade</Btn>
          <Btn variant="ghost" small onClick={()=>exportCSV("swing_trades.csv",[
            ["Symbol","Setup","Entry","SL","T1","T2","T3","Qty","CMP","Unreal P&L","P&L%","1x RR","Date","Status","Conviction","Notes"],
            ...trades.map(t=>{const c=getLatestCmp(t.sym)||t.entry;return[t.sym,t.setup,t.entry,t.sl,t.t1,t.t2,t.t3,t.qty,c,((c-t.entry)*t.qty).toFixed(0),(((c-t.entry)/t.entry)*100).toFixed(2),rr(t.entry,t.sl,t.t1),t.date,t.status,t.conviction,t.notes];})
          ])}>⬇ Export</Btn>
        </div>
      </div>
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        <KpiCard label="Open Positions" value={open.length} sub="Active" color="var(--blue)" icon="📈"/>
        <KpiCard label="Unrealised P&L" value={`₹${fi(totalUnreal)}`} sub="MTM (Bhavcopy CMP)" color={totalUnreal>=0?"var(--green)":"var(--red)"} icon={totalUnreal>=0?"▲":"▼"}/>
        <KpiCard label="Win Rate" value={`${closed.length?Math.round(closed.filter(t=>t.status!=="SL Hit").length/closed.length*100):0}%`} sub={`${closed.length} closed`} color="var(--amber)" icon="🎯"/>
      </div>

      {showForm&&(
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,padding:16,marginBottom:16}}>
          <div style={{fontWeight:600,marginBottom:12,fontSize:13}}>Add Swing Trade</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10}}>
            {[["sym","Symbol"],["setup","Setup"],["entry","Entry ₹"],["sl","SL ₹"],["t1","T1 ₹"],["t2","T2 ₹"],["t3","T3 ₹"],["qty","Qty"]].map(([k,l])=>(
              <div key={k}><div style={{fontSize:10,color:"var(--text3)",marginBottom:3}}>{l}</div>
                <input value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:4,padding:"6px 8px",color:"var(--text)",fontSize:12}}/>
              </div>
            ))}
            <div><div style={{fontSize:10,color:"var(--text3)",marginBottom:3}}>Conviction</div>
              <select value={form.conviction} onChange={e=>setForm(f=>({...f,conviction:e.target.value}))} style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:4,padding:"6px 8px",color:"var(--text)",fontSize:12}}>
                {["Gold","High","Medium","Low","Punt"].map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div style={{marginTop:8}}><div style={{fontSize:10,color:"var(--text3)",marginBottom:3}}>Notes</div>
            <input value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{width:"100%",background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:4,padding:"6px 8px",color:"var(--text)",fontSize:12}} placeholder="Setup rationale…"/>
          </div>
          <div style={{display:"flex",gap:8,marginTop:12}}>
            <Btn onClick={()=>{if(!form.sym)return;setTrades(p=>[...p,{...form,id:Date.now(),entry:+form.entry,sl:+form.sl,t1:+form.t1,t2:+form.t2,t3:+form.t3,qty:+form.qty,date:new Date().toISOString().slice(0,10),status:"Open"}]);setShowForm(false);}}>Add</Btn>
            <Btn variant="ghost" onClick={()=>setShowForm(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,overflow:"hidden",marginBottom:14}}>
        <div style={{padding:"8px 12px",borderBottom:"1px solid var(--border)",fontSize:12,fontWeight:600,color:"var(--green)"}}>⬤ Active Positions ({open.length})</div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr><Th>Symbol</Th><Th>Setup</Th><Th right>Entry</Th><Th right>SL</Th><Th right>T1/T2</Th><Th right>Qty</Th><Th right>Live CMP</Th><Th right>P&L</Th><Th right>P&L%</Th><Th right>1x RR</Th><Th>Conv</Th></tr></thead>
            <tbody>{open.map(t=>{const c=getLatestCmp(t.sym)||t.entry;const pnl=(c-t.entry)*t.qty;const pct=((c-t.entry)/t.entry*100);return(
              <tr key={t.id}>
                <Td><div style={{fontWeight:700,color:"var(--blue)"}}>{t.sym}</div><div style={{fontSize:10,color:"var(--text3)"}}>{t.date}</div></Td>
                <Td style={{fontSize:11,color:"var(--text2)"}}>{t.setup}</Td>
                <Td right mono>₹{fm(t.entry)}</Td><Td right mono color="var(--red)">₹{fm(t.sl)}</Td>
                <Td right mono style={{fontSize:11}}><div>₹{fm(t.t1)}</div><div style={{color:"var(--text3)"}}>₹{fm(t.t2)}</div></Td>
                <Td right mono>{fi(t.qty)}</Td>
                <Td right mono color={c>t.entry?"var(--green)":"var(--red)"}>₹{fm(c)}</Td>
                <Td right mono color={pnl>=0?"var(--green)":"var(--red)"}>₹{fi(pnl)}</Td>
                <Td right mono color={pct>=0?"var(--green)":"var(--red)"}>{fp(pct)}</Td>
                <Td right mono color="var(--amber)">{rr(t.entry,t.sl,t.t1)}</Td>
                <Td><ConvBadge c={t.conviction}/></Td>
              </tr>);
            })}</tbody>
          </table>
        </div>
      </div>
      {closed.length>0&&(
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,overflow:"hidden"}}>
          <div style={{padding:"8px 12px",borderBottom:"1px solid var(--border)",fontSize:12,fontWeight:600,color:"var(--text2)"}}>Closed Trades</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse"}}>
              <thead><tr><Th>Symbol</Th><Th>Setup</Th><Th right>Entry</Th><Th right>SL</Th><Th right>Qty</Th><Th>Date</Th><Th>Status</Th></tr></thead>
              <tbody>{closed.map(t=><tr key={t.id}><Td style={{fontWeight:700}}>{t.sym}</Td><Td>{t.setup}</Td><Td right mono>₹{fm(t.entry)}</Td><Td right mono color="var(--red)">₹{fm(t.sl)}</Td><Td right mono>{fi(t.qty)}</Td><Td>{t.date}</Td><Td><span style={{fontSize:10,fontWeight:700,color:t.status==="SL Hit"?"var(--red)":"var(--text2)"}}>{t.status}</span></Td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Module 3: Result Trades ────────────────────────────────────────────── */
function ResultModule(){
  const [trades,setTrades]=useState(RESULT_INIT);
  const closed=trades.filter(t=>t.status==="Closed");
  const totalPnl=closed.reduce((s,t)=>s+(t.pnl||0),0);
  return(
    <div className="fade-in">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div><div style={{fontSize:16,fontWeight:700}}>Result News Trading</div><div style={{fontSize:11,color:"var(--text2)",marginTop:2}}>Pre-result positioning · No post-result holds · Exit before results</div></div>
        <Btn variant="ghost" small onClick={()=>exportCSV("result_trades.csv",[
          ["Symbol","Quarter","Direction","Conv","Entry","Exit","Qty","Rev Est","Rev Act","Beat%","PAT Est","PAT Act","PAT Beat%","Pre-Px%","Post-Px%","P&L","Status"],
          ...trades.map(t=>[t.sym,t.quarter,t.direction,t.conviction,t.entry,t.exit,t.qty,t.revEst,t.revAct,bm(t.revEst,t.revAct),t.patEst,t.patAct,bm(t.patEst,t.patAct),t.prePx,t.postPx,t.pnl,t.status])
        ])}>⬇ Export</Btn>
      </div>
      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
        <KpiCard label="Total Realised" value={`₹${fi(totalPnl)}`} sub="Result trades P&L" color={totalPnl>=0?"var(--green)":"var(--red)"} icon="💰"/>
        <KpiCard label="Win Rate" value={`${closed.length?Math.round(closed.filter(t=>(t.pnl||0)>0).length/closed.length*100):0}%`} sub={`${closed.length} closed`} color="var(--amber)" icon="🎯"/>
        <KpiCard label="Active" value={trades.filter(t=>t.status==="Active").length} sub="Pre-result" color="var(--blue)" icon="⚡"/>
        <KpiCard label="Pipeline" value={trades.filter(t=>t.status==="Pre-Entry").length} sub="Watching" color="var(--purple)" icon="👁"/>
      </div>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,overflow:"hidden",marginBottom:14}}>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr><Th>Symbol</Th><Th>Quarter</Th><Th>Dir</Th><Th>Conv</Th><Th right>Entry</Th><Th right>Exit</Th><Th right>Qty</Th><Th right>Rev Beat%</Th><Th right>PAT Beat%</Th><Th right>Pre-Px%</Th><Th right>Post-Px%</Th><Th right>P&L</Th><Th>Status</Th></tr></thead>
            <tbody>{trades.map(t=>{const rb=bm(t.revEst,t.revAct);const pb=bm(t.patEst,t.patAct);return(
              <tr key={t.id}>
                <Td><div style={{fontWeight:700,color:"var(--blue)"}}>{t.sym}</div></Td>
                <Td style={{fontSize:11,color:"var(--text2)"}}>{t.quarter}</Td>
                <Td><span style={{fontSize:11,fontWeight:700,color:t.direction==="Long"?"var(--green)":"var(--red)"}}>{t.direction}</span></Td>
                <Td><ConvBadge c={t.conviction}/></Td>
                <Td right mono>{t.entry?`₹${fm(t.entry)}`:"–"}</Td>
                <Td right mono>{t.exit?`₹${fm(t.exit)}`:"–"}</Td>
                <Td right mono>{t.qty?fi(t.qty):"–"}</Td>
                <Td right mono color={rb===null?"var(--text3)":+rb>=0?"var(--green)":"var(--red)"}>{rb?(rb>=0?"+":"")+rb+"%":"–"}</Td>
                <Td right mono color={pb===null?"var(--text3)":+pb>=0?"var(--green)":"var(--red)"}>{pb?(pb>=0?"+":"")+pb+"%":"–"}</Td>
                <Td right mono color={t.prePx==null?"var(--text3)":t.prePx>=0?"var(--green)":"var(--red)"}>{t.prePx!=null?fp(t.prePx):"–"}</Td>
                <Td right mono color={t.postPx==null?"var(--text3)":t.postPx>=0?"var(--green)":"var(--red)"}>{t.postPx!=null?fp(t.postPx):"–"}</Td>
                <Td right mono color={t.pnl==null?"var(--text3)":t.pnl>=0?"var(--green)":"var(--red)"}>{t.pnl!=null?`₹${fi(t.pnl)}`:"–"}</Td>
                <Td><span style={{fontSize:10,fontWeight:700,color:t.status==="Closed"?"var(--text2)":t.status==="Active"?"var(--amber)":"var(--purple)"}}>{t.status}</span></Td>
              </tr>);
            })}</tbody>
          </table>
        </div>
      </div>
      {closed.length>0&&(
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,padding:16}}>
          <div style={{fontSize:12,fontWeight:600,color:"var(--text2)",marginBottom:12}}>RESULT TRADE P&L</div>
          <ResponsiveContainer width="100%" height={130}>
            <BarChart data={closed}>
              <XAxis dataKey="sym" tick={{fontSize:11,fill:"#7a9ab8"}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fontSize:11,fill:"#7a9ab8"}} axisLine={false} tickLine={false} tickFormatter={v=>`₹${(v/1000).toFixed(0)}k`}/>
              <Tooltip contentStyle={{background:"var(--bg3)",border:"1px solid var(--border)",fontSize:11}} formatter={v=>`₹${fi(v)}`}/>
              <Bar dataKey="pnl" radius={[3,3,0,0]}>{closed.map((t,i)=><Cell key={i} fill={(t.pnl||0)>=0?"#10b981":"#ef4444"}/>)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/* ─── Module 4: Fundamentals ─────────────────────────────────────────────── */
function FundModule(){
  const [sel,setSel]=useState(FUND_DATA[0]);
  const [view,setView]=useState("rev");
  const chartData=sel[view==="rev"?"rev":view==="opm"?"opm":"eps"].map((v,i)=>({q:`Q${i+1}`,v}));
  const cc=view==="rev"?"#1e90ff":view==="opm"?"#f59e0b":"#10b981";
  return(
    <div className="fade-in">
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div><div style={{fontSize:16,fontWeight:700}}>Fundamental Research</div><div style={{fontSize:11,color:"var(--text2)",marginTop:2}}>Revenue · EBITDA Margin · EPS · 8Q Trend</div></div>
        <Btn variant="ghost" small onClick={()=>exportCSV("fundamentals.csv",[["Symbol","Sector","MktCap Cr","P/E","ROE%","D/E","Promoter%","Latest Rev","OPM%","EPS"],...FUND_DATA.map(s=>[s.sym,s.sector,s.mktCap,s.pe,s.roe,s.debtEq,s.promoter,s.rev[s.rev.length-1],s.opm[s.opm.length-1],s.eps[s.eps.length-1]])])}>⬇ Export</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"200px 1fr",gap:14,alignItems:"start"}}>
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,overflow:"hidden"}}>
          {FUND_DATA.map(s=>{const g=s.rev.length>=5?((s.rev[s.rev.length-1]-s.rev[s.rev.length-5])/s.rev[s.rev.length-5]*100).toFixed(1):null;return(
            <div key={s.sym} onClick={()=>setSel(s)} style={{padding:"12px 14px",cursor:"pointer",borderBottom:"1px solid var(--border2)",background:sel.sym===s.sym?"var(--blue-dim)":"transparent",borderLeft:sel.sym===s.sym?"3px solid var(--blue)":"3px solid transparent"}}>
              <div style={{fontWeight:700,fontSize:13}}>{s.sym}</div>
              <div style={{fontSize:10,color:"var(--text3)",marginTop:1}}>{s.sector}</div>
              <div style={{display:"flex",gap:8,marginTop:4,fontSize:10}}><span style={{color:"var(--text2)"}}>₹{fi(s.mktCap)} Cr</span>{g&&<span style={{color:+g>=0?"var(--green)":"var(--red)",fontFamily:"var(--mono)"}}>{+g>=0?"+":""}{g}%</span>}</div>
            </div>);
          })}
        </div>
        <div>
          <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap"}}>
            {[["MktCap",`₹${fi(sel.mktCap)} Cr`,"var(--blue)","🏢"],["P/E",`${sel.pe}x`,"var(--amber)","📊"],["ROE",`${sel.roe}%`,"var(--green)","↩"],["D/E",`${sel.debtEq}x`,sel.debtEq>1?"var(--red)":"var(--green)","⚖"],["Promoter",`${sel.promoter}%`,sel.promoter>51?"var(--green)":"var(--amber)","👤"]].map(([l,v,c,i])=><KpiCard key={l} label={l} value={v} color={c} icon={i}/>)}
          </div>
          <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,padding:16,marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={{fontSize:13,fontWeight:600}}>{sel.sym} — 8Q Trend</div>
              <div style={{display:"flex",gap:6}}>
                {[["rev","Revenue"],["opm","OPM %"],["eps","EPS"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setView(k)} style={{padding:"4px 10px",borderRadius:4,fontSize:11,fontWeight:600,cursor:"pointer",background:view===k?(k==="rev"?"var(--blue2)":k==="opm"?"#b45309":"#065f46"):"transparent",color:view===k?"#fff":"var(--text2)",border:`1px solid ${view===k?"transparent":"var(--border)"}`}}>{l}</button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={chartData}>
                <XAxis dataKey="q" tick={{fontSize:11,fill:"#7a9ab8"}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:11,fill:"#7a9ab8"}} axisLine={false} tickLine={false} tickFormatter={v=>view==="rev"?`₹${(v/1000).toFixed(0)}k`:view==="opm"?`${v}%`:`₹${v}`}/>
                <Tooltip contentStyle={{background:"var(--bg3)",border:"1px solid var(--border)",fontSize:11}} formatter={v=>view==="rev"?`₹${fi(v)} Cr`:view==="opm"?`${v}%`:`₹${v}`}/>
                <Bar dataKey="v" radius={[3,3,0,0]}>{chartData.map((_,i)=><Cell key={i} fill={i===chartData.length-1?cc:cc+"66"}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,overflow:"hidden"}}>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr><Th>Metric</Th>{sel.rev.map((_,i)=><Th key={i} right>Q{i+1}{i===sel.rev.length-1?" ★":""}</Th>)}</tr></thead>
                <tbody>
                  <tr><Td>Revenue (₹ Cr)</Td>{sel.rev.map((v,i)=><Td key={i} right mono color={i===sel.rev.length-1?"var(--blue)":undefined}>{fi(v)}</Td>)}</tr>
                  <tr><Td>OPM %</Td>{sel.opm.map((v,i)=><Td key={i} right mono color={i===sel.opm.length-1?"var(--amber)":undefined}>{fv(v)}%</Td>)}</tr>
                  <tr><Td>EPS (₹)</Td>{sel.eps.map((v,i)=><Td key={i} right mono color={i===sel.eps.length-1?"var(--green)":undefined}>{fm(v)}</Td>)}</tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Ticker tape ─────────────────────────────────────────────────────────── */
const TickerTape = ({stocks})=>{
  const items=[...stocks,...stocks];
  return(
    <div style={{background:"var(--bg2)",borderBottom:"1px solid var(--border)",overflow:"hidden",height:27,display:"flex",alignItems:"center"}}>
      <div style={{whiteSpace:"nowrap",animation:"ticker 50s linear infinite",display:"flex"}}>
        {items.map((s,i)=>(
          <span key={i} style={{padding:"0 18px",fontSize:11,fontFamily:"var(--mono)",borderRight:"1px solid var(--border)"}}>
            <span style={{fontWeight:700,color:"var(--blue)"}}>{s.sym}</span>
            <span style={{color:"var(--text)",marginLeft:6}}>₹{fm(s.cmp)}</span>
            <span style={{color:pc(s.changePct),marginLeft:5}}>{fp(s.changePct)}</span>
          </span>
        ))}
      </div>
    </div>
  );
};

/* ─── Main App ───────────────────────────────────────────────────────────── */
export default function App(){
  const [module,setModule]=useState("oi");
  const [stocks,setStocks]=useState([]);
  const [dataDate,setDataDate]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(null);
  const [lastFetch,setLastFetch]=useState(null);

  const symbols = FO_META.map(s=>s.sym).join(",");

  const fetchBhavcopy = useCallback(async()=>{
    setLoading(true); setError(null);
    try{
      const res=await fetch(`/api/bhavcopy?symbols=${symbols}`);
      const json=await res.json();
      if(!json.success) throw new Error(json.error||"Bhavcopy fetch failed");
      // Merge API data with our meta (sector info)
      const merged = FO_META
        .filter(m=>json.data[m.sym])
        .map(m=>({ ...m, ...json.data[m.sym], sym:m.sym, sector:m.sector }));
      setStocks(merged);
      setDataDate(json.date);
      setLastFetch(new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true}));
    }catch(err){
      setError(err.message);
    }finally{
      setLoading(false);
    }
  },[symbols]);

  useEffect(()=>{
    fetchBhavcopy();
    // Auto-refresh every 5 min during market hours
    const interval=setInterval(()=>{
      const ist=new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Kolkata"}));
      const h=ist.getHours(),m=ist.getMinutes(),day=ist.getDay();
      if(day>=1&&day<=5&&((h===9&&m>=15)||(h>9&&h<15)||(h===15&&m<=30))) fetchBhavcopy();
    },300000);
    return()=>clearInterval(interval);
  },[fetchBhavcopy]);

  const ist=new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Kolkata"}));
  const h=ist.getHours(),m=ist.getMinutes(),day=ist.getDay();
  const isLive=day>=1&&day<=5&&((h===9&&m>=15)||(h>9&&h<15)||(h===15&&m<=30));

  const nav=[
    {id:"oi",  icon:"◈", label:"OI Dashboard",   badge:stocks.filter(s=>s.signal==="Long Buildup").length||null},
    {id:"swing",icon:"📈",label:"Swing Trades",   badge:null},
    {id:"result",icon:"⚡",label:"Result Trades", badge:null},
    {id:"fund", icon:"🔬",label:"Fundamentals",   badge:null},
  ];

  return(
    <>
      <FontLink/>
      <div style={{display:"flex",flexDirection:"column",height:"100vh",overflow:"hidden"}}>
        {/* Topbar */}
        <div style={{background:"var(--bg2)",borderBottom:"1px solid var(--border)",padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",height:46,flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <div style={{fontSize:15,fontWeight:700,fontFamily:"var(--mono)",color:"var(--blue)",letterSpacing:1}}>MKTDESK</div>
            <div style={{fontSize:10,color:"var(--text3)",borderLeft:"1px solid var(--border)",paddingLeft:12}}>NSE Bhavcopy · Free · No Auth</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            {error&&<span style={{fontSize:11,color:"var(--red)",background:"var(--red-dim)",padding:"2px 8px",borderRadius:4}}>⚠ {error.slice(0,60)}</span>}
            {lastFetch&&<span style={{fontSize:10,color:"var(--text3)"}}>Fetched {lastFetch}</span>}
            <div style={{display:"flex",alignItems:"center",gap:5,fontSize:11}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:isLive?"var(--green)":"var(--amber)",display:"inline-block"}}/>
              <span style={{color:isLive?"var(--green)":"var(--amber)",fontWeight:600}}>{isLive?"LIVE":"EOD"}</span>
            </div>
            <span style={{fontSize:11,color:"var(--text3)",fontFamily:"var(--mono)"}}>{ist.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",hour12:true})} IST</span>
          </div>
        </div>
        {stocks.length>0&&<TickerTape stocks={stocks}/>}
        <div style={{display:"flex",flex:1,overflow:"hidden"}}>
          {/* Sidebar */}
          <div style={{width:195,background:"var(--bg2)",borderRight:"1px solid var(--border)",display:"flex",flexDirection:"column",flexShrink:0,paddingTop:8}}>
            {nav.map(n=>(
              <div key={n.id} onClick={()=>setModule(n.id)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",cursor:"pointer",borderRadius:6,margin:"2px 6px",background:module===n.id?"var(--blue-dim)":"transparent",borderLeft:module===n.id?"2px solid var(--blue)":"2px solid transparent",color:module===n.id?"var(--blue)":"var(--text2)",fontSize:13,fontWeight:module===n.id?600:400}}>
                <span style={{fontSize:14}}>{n.icon}</span>
                <span style={{flex:1}}>{n.label}</span>
                {n.badge?<span style={{fontSize:10,background:"var(--blue-dim)",color:"var(--blue)",padding:"1px 5px",borderRadius:8,fontWeight:700}}>{n.badge}</span>:null}
              </div>
            ))}
            <div style={{marginTop:"auto",padding:"12px 14px",borderTop:"1px solid var(--border)"}}>
              <div style={{fontSize:9,color:"var(--text3)",textTransform:"uppercase",letterSpacing:.8,marginBottom:6}}>Data Source</div>
              <div style={{fontSize:11,color:"var(--green)",fontWeight:600,marginBottom:4}}>NSE Bhavcopy</div>
              <div style={{fontSize:10,color:"var(--text3)",lineHeight:1.5}}>CM + FO archives<br/>Released ~6 PM IST<br/>Free · No auth needed</div>
              {dataDate&&<div style={{fontSize:10,color:"var(--amber)",marginTop:4}}>Date: {dataDate}</div>}
            </div>
          </div>
          {/* Content */}
          <div style={{flex:1,overflowY:"auto",padding:20,background:"var(--bg)"}}>
            {module==="oi"    &&<OIModule stocks={stocks} dataDate={dataDate} loading={loading} onRefresh={fetchBhavcopy}/>}
            {module==="swing" &&<SwingModule stocks={stocks}/>}
            {module==="result"&&<ResultModule/>}
            {module==="fund"  &&<FundModule/>}
          </div>
        </div>
      </div>
    </>
  );
}
