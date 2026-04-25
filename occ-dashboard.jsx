import { useState, useEffect, useRef, useCallback } from "react";

// ── Socket.io loader (se carga dinámicamente para no romper el artifact) ──
let _socket = null;
async function getSocket(url) {
  if (_socket) return _socket;
  try {
    const { io } = await import("https://cdn.socket.io/4.7.5/socket.io.esm.min.js");
    _socket = io(url, { transports:["websocket"], reconnectionAttempts:5, timeout:3000 });
    return _socket;
  } catch { return null; }
}

// ── Paleta & fuente ────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@400;700;900&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #050a0e;
    --panel:    #080f14;
    --border:   #0d2030;
    --green:    #00ff88;
    --green2:   #00cc66;
    --amber:    #ffaa00;
    --red:      #ff3355;
    --cyan:     #00e5ff;
    --dim:      #1a3a4a;
    --text:     #8ab8c8;
    --mono:     'Share Tech Mono', monospace;
    --display:  'Orbitron', monospace;
  }

  body { background: var(--bg); color: var(--text); font-family: var(--mono); }

  @keyframes scanline {
    0%   { transform: translateY(-100%); }
    100% { transform: translateY(100vh); }
  }
  @keyframes blink  { 0%,100%{opacity:1} 50%{opacity:0} }
  @keyframes pulse  { 0%,100%{box-shadow:0 0 0 0 rgba(0,255,136,.4)} 70%{box-shadow:0 0 0 12px rgba(0,255,136,0)} }
  @keyframes slide  { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:none} }
  @keyframes fadeIn { from{opacity:0} to{opacity:1} }
  @keyframes glow   {
    0%,100%{text-shadow:0 0 8px var(--green),0 0 20px var(--green2)}
    50%    {text-shadow:0 0 20px var(--green),0 0 40px var(--green2),0 0 60px rgba(0,255,136,.3)}
  }
  @keyframes lineMarch {
    0%  { stroke-dashoffset: 200 }
    100%{ stroke-dashoffset: 0   }
  }
  @keyframes barGrow {
    from { transform: scaleY(0); }
    to   { transform: scaleY(1); }
  }
`;

// ── Datos mock ─────────────────────────────────────────────────
const GEOS = [
  { id:"AR", label:"Buenos Aires", x:28,  y:72,  rep:340 },
  { id:"JP", label:"Tokyo",        x:83,  y:30,  rep:820 },
  { id:"DE", label:"Berlin",       x:50,  y:22,  rep:510 },
  { id:"US", label:"New York",     x:20,  y:35,  rep:670 },
  { id:"MX", label:"México DF",    x:16,  y:47,  rep:290 },
  { id:"AU", label:"Sydney",       x:85,  y:72,  rep:445 },
  { id:"BR", label:"São Paulo",    x:32,  y:65,  rep:380 },
  { id:"IN", label:"Mumbai",       x:68,  y:42,  rep:590 },
];

const MISSIONS_INIT = [
  { id:"MCN-001", from:"AR", to:"JP", intent:"Comprar entrada Tokyo Dome", status:"active",   trust:2, credits:10 },
  { id:"MCN-002", from:"DE", to:"US", intent:"Scraping precios Amazon",    status:"complete", trust:1, credits:5  },
  { id:"MCN-003", from:"MX", to:"AU", intent:"Reserva hotel Melbourne",   status:"pending",  trust:1, credits:7  },
];

const LOG_INIT = [
  { ts:"09:42:01", from:"AR", to:"JP", msg:"SMC_SEND: mision_001",           type:"send"    },
  { ts:"09:42:03", from:"JP", to:"AR", msg:"MISSION_CLAIMED: node_tok_001",  type:"claim"   },
  { ts:"09:41:55", from:"DE", to:"US", msg:"REPUTATION_UPDATE: +10",         type:"rep"     },
  { ts:"09:41:48", from:"MX", to:"AU", msg:"HANDSHAKE: node_aus_042",        type:"connect" },
  { ts:"09:41:30", from:"IN", to:"BR", msg:"PoR_SUBMITTED: dom_hash_ok",     type:"proof"   },
];

const STATUS_COLOR = { active:"var(--amber)", complete:"var(--green)", pending:"var(--dim)" };
const LOG_COLOR    = { send:"var(--cyan)", claim:"var(--amber)", rep:"var(--green)", connect:"var(--text)", proof:"var(--green2)" };

function rnd(min,max){ return Math.floor(Math.random()*(max-min))+min; }

// ── Componente principal ───────────────────────────────────────
export default function OCCDashboard() {
  const [nodes]      = useState(GEOS);
  const [missions,    setMissions]    = useState(MISSIONS_INIT);
  const [logs,        setLogs]        = useState(LOG_INIT);
  const [myRep,       setMyRep]       = useState(340);
  const [online,      setOnline]      = useState(1204);
  const [bpm,         setBpm]         = useState(72);
  const [beats,       setBeats]       = useState([4,10,32,12,4,2,20,8,4,16,32,6,4,12,8,24,4,2]);
  const [intent,      setIntent]      = useState("");
  const [killed,      setKilled]      = useState(false);
  const [activeConn,  setActiveConn]  = useState({ from:"AR", to:"JP" });
  const [dispUrl,     setDispUrl]     = useState("http://localhost:3001");
  const [connStatus,  setConnStatus]  = useState("mock"); // "mock" | "connecting" | "live" | "error"
  const [repFlash,    setRepFlash]    = useState(null);   // {delta, ts}
  const socketRef = useRef(null);
  const logRef    = useRef(null);

  const now = () => { const d=new Date(); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`; };

  const pushLog = useCallback((from,to,msg,type)=>{
    setLogs(l=>[{ts:now(),from,to,msg,type},...l].slice(0,20));
  },[]);

  // ── Conexión al Dispatcher real ────────────────────────────────
  async function connectToDispatcher() {
    if(killed) return;
    setConnStatus("connecting");
    pushLog("SYS","OCC",`Conectando a ${dispUrl}...`,"connect");

    const sock = await getSocket(dispUrl);
    if(!sock){ setConnStatus("error"); pushLog("SYS","OCC","Error: no se pudo cargar Socket.io","send"); return; }

    socketRef.current = sock;

    sock.on("connect", ()=>{
      setConnStatus("live");
      pushLog("SYS","OCC","LIVE: Dispatcher conectado","rep");
      // Anunciar nuestro nodo
      sock.emit("register_node",{ id:"node_ar_001", geo:"AR", reputation:myRep, trust_level:1 });
    });

    sock.on("disconnect", ()=>{
      setConnStatus("error");
      pushLog("SYS","OCC","DISCONNECTED: Dispatcher offline","send");
    });

    sock.on("connect_error", ()=>{
      setConnStatus("error");
      pushLog("SYS","OCC","ERROR: No hay Dispatcher en "+dispUrl,"send");
    });

    // Directorio de nodos online
    sock.on("directory-update", (arr)=>{
      setOnline(arr.length||0);
      pushLog("SYS","NET",`DIRECTORY: ${arr.length} nodos online`,"connect");
    });

    // Nueva misión en broadcast
    sock.on("new_mission_broadcast", (smc)=>{
      const id = smc?.mission?.id || "???";
      const geo = smc?.mission?.constraints?.geo || "?";
      const from = smc?.requester?.node_id?.slice(5,7)?.toUpperCase() || "?";
      setMissions(m=>[{
        id, from, to:geo,
        intent: smc?.mission?.intent || "Misión recibida",
        status:"pending", trust: smc?.mission?.constraints?.trust_level_min||0,
        credits: smc?.mission?.constraints?.credits_offered||5
      },...m].slice(0,6));
      setActiveConn({from, to:geo});
      pushLog(from, geo, `NEW_MISSION: ${id}`, "send");
    });

    // Misión aceptada
    sock.on("mission_claimed", (data)=>{
      setMissions(m=>m.map(x=>x.id===data.mission_id?{...x,status:"active"}:x));
      setActiveConn(ac=>({...ac})); // re-render línea
      pushLog("NET","NET",`CLAIMED: ${data.mission_id} por ${data.by}`,"claim");
    });

    // Liquidación de reputación
    sock.on("reputation_updated", (data)=>{
      setMissions(m=>m.map(x=>x.id===data.mission_id?{...x,status: data.delta>0?"complete":"failed"}:x));
      if(data.node_id==="node_ar_001"){
        setMyRep(r=>Math.max(0,r+data.delta));
        setRepFlash({delta:data.delta, ts:Date.now()});
        setTimeout(()=>setRepFlash(null),2500);
      }
      pushLog("LEDGER","NODE",`REP_UPDATE: ${data.delta>0?"+":""}${data.delta} (${data.reason})`,"rep");
    });
  }

  function disconnectDispatcher(){
    if(socketRef.current){ socketRef.current.disconnect(); socketRef.current=null; }
    setConnStatus("mock");
    pushLog("SYS","OCC","Desconectado del Dispatcher","connect");
  }

  // ── Mock heartbeat (solo cuando no hay conexión real) ──────────
  useEffect(()=>{
    if(killed || connStatus==="live") return;
    const t = setInterval(()=>{
      setBpm(()=>rnd(65,85));
      setOnline(n=>n+rnd(-3,8));
      setBeats(prev=>[...prev.slice(1),rnd(2,32)]);
      const pairs=[["AR","JP"],["DE","US"],["MX","AU"],["IN","BR"],["BR","DE"]];
      const msgs=[
        {msg:"HEARTBEAT: pong",type:"connect"},
        {msg:"REPUTATION_UPDATE: +5",type:"rep"},
        {msg:"PING: "+rnd(20,90)+"ms",type:"connect"},
        {msg:"NEW_SCOUT joined",type:"connect"},
        {msg:"PoR_VERIFIED: hash_match",type:"proof"},
      ];
      const [from,to]=pairs[rnd(0,pairs.length)];
      const {msg,type}=msgs[rnd(0,msgs.length)];
      setLogs(l=>[{ts:now(),from,to,msg,type},...l].slice(0,20));
      setActiveConn({from,to});
    },2000);
    return ()=>clearInterval(t);
  },[killed,connStatus]);

  // ── Beat visual (siempre activo) ──────────────────────────────
  useEffect(()=>{
    if(killed) return;
    const t = setInterval(()=>{
      setBpm(()=>rnd(65,85));
      setBeats(prev=>[...prev.slice(1),rnd(2,32)]);
    },1000);
    return()=>clearInterval(t);
  },[killed]);

  function sendMission(){
    if(!intent.trim()) return;
    const id = "MCN-"+String(rnd(100,999));
    const smc = {
      smc_version:"0.1",
      mission:{ id, intent, steps:[], constraints:{ geo:"JP", trust_level_min:1, timeout_seconds:60, credits_offered:8 }},
      proof_required:{ dom_hash:true, screenshot:true },
      requester:{ node_id:"node_ar_001", reputation_score:myRep }
    };
    setMissions(m=>[{id,from:"AR",to:"JP",intent,status:"pending",trust:1,credits:8},...m].slice(0,6));
    pushLog("AR","JP",`SMC_SEND: ${id}`,"send");
    setIntent("");

    if(connStatus==="live" && socketRef.current){
      // Enviar misión real al Dispatcher
      socketRef.current.emit("broadcast_mission", smc);
    } else {
      // Simulación local
      setTimeout(()=>{ setMissions(m=>m.map(x=>x.id===id?{...x,status:"active"}:x)); pushLog("JP","AR",`CLAIMED: ${id}`,"claim"); },1500);
      setTimeout(()=>{ setMissions(m=>m.map(x=>x.id===id?{...x,status:"complete"}:x)); setMyRep(r=>r+8); pushLog("LEDGER","AR","REP_UPDATE: +8 (mission_success)","rep"); },5000);
    }
  }

  function killSwitch(){
    if(!killed){ disconnectDispatcher(); }
    setKilled(k=>!k);
  }

  const connLabel = { mock:"● SIMULACIÓN", connecting:"◌ CONECTANDO...", live:"● LIVE", error:"✕ ERROR" };
  const connColor = { mock:"var(--dim)", connecting:"var(--amber)", live:"var(--green)", error:"var(--red)" };

  // conexión activa SVG
  const fromNode = nodes.find(n=>n.id===activeConn.from)||nodes[0];
  const toNode   = nodes.find(n=>n.id===activeConn.to)  ||nodes[1];

  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight:"100vh", background:"var(--bg)", padding:"16px", position:"relative", overflow:"hidden" }}>

        {/* scanline sutil */}
        <div style={{ position:"fixed", top:0, left:0, right:0, bottom:0, pointerEvents:"none", zIndex:99,
          background:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.03) 2px,rgba(0,0,0,.03) 4px)" }}/>

        {/* HEADER */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
          <div>
            <div style={{ fontFamily:"var(--display)", fontSize:22, fontWeight:900, color:"var(--green)",
              animation:"glow 3s ease-in-out infinite", letterSpacing:4 }}>
              🦞⛓ OPENCLAWCHAIN
            </div>
            <div style={{ fontSize:11, color:"var(--dim)", letterSpacing:3, marginTop:2 }}>
              INFRAESTRUCTURA DE ACCIÓN DESCENTRALIZADA · v0.1
            </div>
          </div>

          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:8 }}>
            {/* Estado de conexión */}
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ color:connColor[connStatus], fontFamily:"var(--display)", fontSize:11,
                animation: connStatus==="live"?"blink 2s infinite":"none" }}>
                {connLabel[connStatus]}
              </div>
              <div style={{ color: killed?"var(--red)":"var(--green)", fontSize:11,
                fontFamily:"var(--display)", animation: killed?"none":"blink 2s infinite" }}>
                {killed ? "OFFLINE" : "ACTIVO"}
              </div>
              <button onClick={killSwitch} style={{
                background: killed?"var(--green)":"rgba(255,51,85,.1)",
                border:`1px solid ${killed?"var(--green)":"var(--red)"}`,
                color: killed?"var(--bg)":"var(--red)",
                fontFamily:"var(--display)", fontSize:10, fontWeight:700,
                padding:"6px 12px", cursor:"pointer", letterSpacing:2
              }}>{killed?"▶ REINICIAR":"⬛ KILL SWITCH"}</button>
            </div>

            {/* Barra de conexión al Dispatcher */}
            {!killed && (
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <input
                  value={dispUrl}
                  onChange={e=>setDispUrl(e.target.value)}
                  placeholder="http://localhost:3001"
                  style={{ background:"var(--panel)", border:"1px solid var(--border)",
                    color:"var(--cyan)", fontFamily:"var(--mono)", fontSize:10,
                    padding:"4px 8px", width:200, outline:"none" }}
                />
                {connStatus==="live" ? (
                  <button onClick={disconnectDispatcher} style={{
                    background:"rgba(255,51,85,.1)", border:"1px solid var(--red)",
                    color:"var(--red)", fontFamily:"var(--display)", fontSize:9,
                    padding:"4px 10px", cursor:"pointer", letterSpacing:1 }}>
                    DESCONECTAR
                  </button>
                ) : (
                  <button onClick={connectToDispatcher} disabled={connStatus==="connecting"} style={{
                    background:"rgba(0,255,136,.1)", border:"1px solid var(--green2)",
                    color:"var(--green)", fontFamily:"var(--display)", fontSize:9,
                    padding:"4px 10px", cursor:"pointer", letterSpacing:1,
                    opacity: connStatus==="connecting"?.6:1 }}>
                    {connStatus==="connecting"?"CONECTANDO...":"CONECTAR LIVE"}
                  </button>
                )}
              </div>
            )}

            {/* Flash de reputación */}
            {repFlash && (
              <div style={{ fontFamily:"var(--display)", fontSize:14, fontWeight:700,
                color: repFlash.delta>0?"var(--green)":"var(--red)",
                animation:"fadeIn .2s ease" }}>
                {repFlash.delta>0?`+${repFlash.delta} ⭐`:`${repFlash.delta} ⬇`}
              </div>
            )}
          </div>
        </div>

        {/* STATS ROW */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:16 }}>
          {[
            { label:"NODOS GLOBALES", value: killed?"0":online.toLocaleString(), color:"var(--green)" },
            { label:"BPM DE RED",     value: killed?"0":bpm,                    color:"var(--amber)" },
            { label:"TU REPUTACIÓN",  value: killed?"---":myRep+" ⭐",          color:"var(--cyan)"  },
            { label:"TRUST LEVEL",    value: killed?"---":myRep>=500?"PILOT":myRep>=100?"RUNNER":"SCOUT", color:"var(--green2)" },
          ].map(s=>(
            <div key={s.label} style={{ border:"1px solid var(--border)", padding:"12px 14px",
              background:"var(--panel)", position:"relative", overflow:"hidden" }}>
              <div style={{ fontSize:9, letterSpacing:3, color:"var(--dim)", marginBottom:6 }}>{s.label}</div>
              <div style={{ fontFamily:"var(--display)", fontSize:20, fontWeight:700, color:s.color }}>{s.value}</div>
              <div style={{ position:"absolute", bottom:0, left:0, right:0, height:1,
                background:`linear-gradient(90deg,transparent,${s.color},transparent)`, opacity:.4 }}/>
            </div>
          ))}
        </div>

        {/* MAIN GRID */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 320px", gap:12 }}>

          {/* MAPA SVG */}
          <div style={{ border:"1px solid var(--border)", background:"var(--panel)", padding:12, position:"relative" }}>
            <div style={{ fontSize:10, letterSpacing:3, color:"var(--dim)", marginBottom:8 }}>
              MAPA DE RED GLOBAL
            </div>
            <svg viewBox="0 0 100 85" style={{ width:"100%", height:220 }}>
              {/* fondo oceánico */}
              <rect width="100" height="85" fill="#060d12"/>
              {/* continentes super-simplificados */}
              <path d="M10 20 Q18 15 25 18 Q30 22 28 30 Q22 35 15 32 Z" fill="#0d1f2d" stroke="var(--border)" strokeWidth=".3"/>
              <path d="M20 40 Q28 38 32 45 Q30 58 24 62 Q18 60 17 52 Z" fill="#0d1f2d" stroke="var(--border)" strokeWidth=".3"/>
              <path d="M44 15 Q55 12 62 20 Q65 30 58 35 Q48 36 44 28 Z" fill="#0d1f2d" stroke="var(--border)" strokeWidth=".3"/>
              <path d="M63 25 Q72 22 76 28 Q75 35 70 36 Q64 34 63 28 Z" fill="#0d1f2d" stroke="var(--border)" strokeWidth=".3"/>
              <path d="M78 24 Q88 22 90 28 Q88 36 82 36 Q78 34 78 28 Z" fill="#0d1f2d" stroke="var(--border)" strokeWidth=".3"/>
              <path d="M80 60 Q90 58 92 65 Q90 75 84 76 Q78 74 79 66 Z" fill="#0d1f2d" stroke="var(--border)" strokeWidth=".3"/>

              {/* línea activa animada */}
              {!killed && (
                <line
                  x1={fromNode.x} y1={fromNode.y} x2={toNode.x} y2={toNode.y}
                  stroke="var(--amber)" strokeWidth=".6" strokeDasharray="4 2"
                  style={{ animation:"lineMarch 1.5s linear infinite" }}
                  opacity=".8"
                />
              )}

              {/* nodos */}
              {nodes.map(n=>(
                <g key={n.id}>
                  <circle cx={n.x} cy={n.y} r="3" fill="var(--bg)" stroke="var(--green)" strokeWidth=".8"
                    opacity={killed?.3:1}/>
                  {!killed && <circle cx={n.x} cy={n.y} r="3" fill="transparent" stroke="var(--green)"
                    strokeWidth=".5" style={{ animation:"pulse 2s infinite", transformOrigin:`${n.x}px ${n.y}px` }}/>}
                  <circle cx={n.x} cy={n.y} r="1.2" fill={killed?"var(--dim)":"var(--green)"}/>
                  <text x={n.x+4} y={n.y+1} fontSize="3.5" fill="var(--text)" opacity=".8">{n.id}</text>
                </g>
              ))}
            </svg>
            <div style={{ fontSize:10, color:"var(--dim)", marginTop:4 }}>
              {killed ? "⬛ RED DESCONECTADA — Kill Switch activo" :
                `↗ ${activeConn.from} → ${activeConn.to} · misión activa`}
            </div>
          </div>

          {/* PANEL DERECHO */}
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>

            {/* MI NODO */}
            <div style={{ border:"1px solid var(--border)", background:"var(--panel)", padding:12 }}>
              <div style={{ fontSize:9, letterSpacing:3, color:"var(--dim)", marginBottom:8 }}>MI NODO</div>
              {[
                ["ID",     "node_ar_001"],
                ["GEO",    "AR · Buenos Aires"],
                ["MODO",   "WORKER + STAKE"],
                ["UPTIME", killed?"OFFLINE":"14h 32m"],
              ].map(([k,v])=>(
                <div key={k} style={{ display:"flex", justifyContent:"space-between", marginBottom:4, fontSize:11 }}>
                  <span style={{ color:"var(--dim)" }}>{k}</span>
                  <span style={{ color: k==="GEO"?"var(--cyan)":killed&&k==="UPTIME"?"var(--red)":"var(--text)" }}>{v}</span>
                </div>
              ))}
            </div>

            {/* HEARTBEAT */}
            <div style={{ border:"1px solid var(--border)", background:"var(--panel)", padding:12 }}>
              <div style={{ fontSize:9, letterSpacing:3, color:"var(--dim)", marginBottom:8 }}>PULSO DE RED</div>
              <div style={{ display:"flex", alignItems:"flex-end", gap:2, height:40, overflow:"hidden" }}>
                {beats.map((h,i)=>(
                  <div key={i} style={{
                    flex:1, background: killed?"var(--dim)":"var(--green2)",
                    height:`${(h/32)*100}%`, minHeight:2, opacity: .4+i/beats.length*.6,
                    transformOrigin:"bottom", animation:"barGrow .3s ease"
                  }}/>
                ))}
              </div>
            </div>

            {/* CONSOLA */}
            <div style={{ border:"1px solid var(--border)", background:"var(--panel)", padding:12, flex:1 }}>
              <div style={{ fontSize:9, letterSpacing:3, color:"var(--dim)", marginBottom:8 }}>CONSOLA DE MISIÓN</div>
              <textarea
                disabled={killed}
                placeholder={killed ? "Red offline..." : "Ej: Comprar entrada Tokyo Dome para junio..."}
                value={intent}
                onChange={e=>setIntent(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&(e.preventDefault(),sendMission())}
                rows={3}
                style={{
                  width:"100%", background:"rgba(0,255,136,.04)", border:"1px solid var(--border)",
                  color:"var(--green)", fontFamily:"var(--mono)", fontSize:11, padding:8, resize:"none",
                  outline:"none", marginBottom:8, opacity: killed?.5:1
                }}
              />
              <button onClick={sendMission} disabled={killed||!intent.trim()} style={{
                width:"100%", background: (!killed&&intent.trim())?"rgba(0,255,136,.15)":"transparent",
                border:`1px solid ${(!killed&&intent.trim())?"var(--green)":"var(--border)"}`,
                color: (!killed&&intent.trim())?"var(--green)":"var(--dim)",
                fontFamily:"var(--display)", fontSize:11, fontWeight:700,
                padding:"8px", cursor:(!killed&&intent.trim())?"pointer":"default",
                letterSpacing:3, transition:"all .2s"
              }}>
                ▶ TRANSMITIR MISIÓN
              </button>
            </div>
          </div>
        </div>

        {/* MISIONES + LOG */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginTop:12 }}>

          {/* MISIONES */}
          <div style={{ border:"1px solid var(--border)", background:"var(--panel)", padding:12 }}>
            <div style={{ fontSize:9, letterSpacing:3, color:"var(--dim)", marginBottom:8 }}>MISIONES ACTIVAS</div>
            {missions.slice(0,5).map(m=>(
              <div key={m.id} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6,
                borderLeft:`2px solid ${STATUS_COLOR[m.status]||"var(--dim)"}`, paddingLeft:8,
                animation:"slide .3s ease", fontSize:11 }}>
                <div style={{ flex:1 }}>
                  <div style={{ color:"var(--text)", marginBottom:1 }}>{m.intent}</div>
                  <div style={{ fontSize:10, color:"var(--dim)" }}>
                    {m.id} · {m.from}→{m.to} · Trust:{m.trust} · {m.credits}cr
                  </div>
                </div>
                <div style={{ color:STATUS_COLOR[m.status], fontSize:10, fontFamily:"var(--display)",
                  letterSpacing:1, whiteSpace:"nowrap" }}>
                  {m.status.toUpperCase()}
                </div>
              </div>
            ))}
          </div>

          {/* LOG */}
          <div style={{ border:"1px solid var(--border)", background:"var(--panel)", padding:12, overflow:"hidden" }}>
            <div style={{ fontSize:9, letterSpacing:3, color:"var(--dim)", marginBottom:8 }}>LOG DE RED</div>
            <div ref={logRef} style={{ fontSize:10, lineHeight:1.8 }}>
              {logs.slice(0,10).map((l,i)=>(
                <div key={i} style={{ display:"flex", gap:8, animation:"slide .2s ease", opacity:1-i*.07 }}>
                  <span style={{ color:"var(--dim)", minWidth:54 }}>{l.ts}</span>
                  <span style={{ color:"var(--dim)" }}>[{l.from}→{l.to}]</span>
                  <span style={{ color:LOG_COLOR[l.type]||"var(--text)" }}>{l.msg}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* FOOTER */}
        <div style={{ marginTop:12, display:"flex", justifyContent:"space-between", fontSize:9, color:"var(--dim)", letterSpacing:2 }}>
          <span>OPENCLAWCHAIN PROTOCOL v0.1 · OCC-P · SMC SCHEMA 0.1</span>
          <span style={{ color: connStatus==="live"?"var(--green)":connColor[connStatus], animation:"blink 3s infinite" }}>
            {killed ? "⬛ NODO DESCONECTADO" :
             connStatus==="live" ? `● LIVE · ${dispUrl}` :
             connStatus==="error" ? "✕ SIN DISPATCHER — modo simulación" :
             "● MOCK · pulse.openclawchain.io"}
          </span>
        </div>
      </div>
    </>
  );
}
