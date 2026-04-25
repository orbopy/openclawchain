# ============================================================
#  OpenClawChain — OCC NODE CLIENT  (v0.1)
#  El agente que conecta tu OpenClaw a la red.
#  Corre en: python occ_node.py --geo JP --id mi_nodo
# ============================================================

import socketio
import argparse
import time
import json
import hashlib
import threading

# ── Configuración por argumento de línea de comandos ──────────
parser = argparse.ArgumentParser(description="OCC Node Client")
parser.add_argument("--dispatcher", default="http://localhost:3001", help="URL del Dispatcher")
parser.add_argument("--geo",        default="AR",                    help="Código de país (AR, JP, DE...)")
parser.add_argument("--id",         default=None,                    help="ID del nodo (se genera si no se pasa)")
parser.add_argument("--mode",       default="worker",                help="worker | observer")
parser.add_argument("--min-credits",default=3, type=int,             help="Créditos mínimos para aceptar misión")
args = parser.parse_args()

import uuid
NODE_ID = args.id or f"node_{args.geo.lower()}_{str(uuid.uuid4())[:8]}"

# ── Estado del nodo ───────────────────────────────────────────
reputation    = 100
active_mission = None   # SMC actualmente en ejecución
sio = socketio.Client(reconnection=True, reconnection_attempts=10)

# ── Helpers ───────────────────────────────────────────────────
def log(emoji, msg):
    ts = time.strftime("%H:%M:%S")
    print(f"[{ts}] {emoji}  [{NODE_ID[:12]}] {msg}")

def dom_hash(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()[:16]

# ── Ejecución real de la misión ───────────────────────────────
def execute_mission(smc: dict) -> dict:
    """
    Aquí se conecta con OpenClaw real.
    Por ahora simula la ejecución paso a paso.
    Para conectar con OpenClaw real, reemplazá este bloque
    con llamadas a la API Gateway de OpenClaw (ws://127.0.0.1:18789).
    """
    mission = smc.get("mission", {})
    steps   = mission.get("steps", [])

    log("🛠️", f"Ejecutando {len(steps)} pasos para: {mission.get('intent','???')}")

    results = []
    for i, step in enumerate(steps):
        action = step.get("action", "unknown")
        log("▶", f"Paso {i+1}: {action}")
        time.sleep(0.5)  # simula tiempo de navegación

        # ── INTEGRACIÓN REAL CON OPENCLAW ──────────────────
        # Reemplazar por:
        #   from openclaw_client import OpenClawClient
        #   client = OpenClawClient("ws://127.0.0.1:18789", token="TU_TOKEN")
        #   if action == "navigate": client.browser_navigate(step["url"])
        #   if action == "search":   client.browser_act(f'search for {step["query"]}')
        #   if action == "screenshot": screenshot = client.browser_screenshot()
        # ──────────────────────────────────────────────────

        results.append({ "step": i+1, "action": action, "status": "ok" })

    # Generar Proof of Result
    proof = {
        "dom_hash":      dom_hash(json.dumps(results)),
        "network_trace": f"trace_{NODE_ID}_{mission.get('id','?')}",
        "steps_results": results,
        "completed_at":  int(time.time())
    }
    return proof

# ── Heartbeat ─────────────────────────────────────────────────
def heartbeat_loop():
    while True:
        try:
            if sio.connected:
                sio.emit("heartbeat", {"node_id": NODE_ID})
        except Exception:
            pass
        time.sleep(30)

# ── Eventos Socket.io ─────────────────────────────────────────

@sio.event
def connect():
    log("🌐", f"Conectado al Dispatcher")
    sio.emit("register_node", {
        "id":   NODE_ID,
        "geo":  args.geo,
        "mode": args.mode
    })

@sio.event
def disconnect():
    log("🔴", "Desconectado del Dispatcher")

@sio.on("registered")
def on_registered(data):
    global reputation
    reputation = data.get("reputation", 100)
    trust      = data.get("trust_level", "Scout")
    log("✅", f"Registrado | Rep:{reputation} | Trust:{trust} | Geo:{args.geo}")
    log("👂", f"Escuchando misiones para geo:{args.geo} (mín {args.min_credits} créditos)")

@sio.on("register_error")
def on_register_error(data):
    log("❌", f"Error de registro: {data.get('error')}")

@sio.on("new_mission_broadcast")
def on_mission_broadcast(smc):
    global active_mission
    if active_mission:
        return  # ya tenemos una misión activa

    mission     = smc.get("mission", {})
    constraints = mission.get("constraints", {})
    mission_id  = mission.get("id", "?")
    credits     = constraints.get("credits_offered", 0)
    geo_req     = constraints.get("geo", "?")
    trust_req   = constraints.get("trust_level_min", 0)

    log("📡", f"Misión disponible: {mission_id} | geo:{geo_req} credits:{credits}")

    # Filtro de auto-selección
    if geo_req != args.geo:
        return  # no es para mi geo
    if credits < args.min_credits:
        log("💤", f"Créditos insuficientes ({credits} < {args.min_credits}), ignorando")
        return

    log("🙋", f"Aceptando misión {mission_id}...")
    sio.emit("accept_mission", {
        "mission_id": mission_id,
        "node_id":    NODE_ID
    })

@sio.on("mission_already_claimed")
def on_already_claimed(data):
    log("⚡", f"Misión {data.get('mission_id')} ya fue tomada, llegué tarde")

@sio.on("mission_claimed")
def on_claimed(data):
    if data.get("by") != NODE_ID:
        log("👁️", f"Misión {data.get('mission_id')} tomada por {data.get('by')}")

@sio.on("mission_confirmed")
def on_mission_confirmed(data):
    global active_mission
    mission_id = data.get("mission_id")
    smc        = data.get("smc", {})

    log("🚀", f"¡CONFIRMADO! Ejecutando misión {mission_id}")
    active_mission = mission_id

    def run():
        global active_mission, reputation
        try:
            proof = execute_mission(smc)
            log("📦", f"Proof of Result generado: {proof['dom_hash']}")
            sio.emit("submit_proof", {
                "mission_id": mission_id,
                "node_id":    NODE_ID,
                "status":     "success",
                **proof
            })
        except Exception as e:
            log("💥", f"Error en ejecución: {e}")
            sio.emit("submit_proof", {
                "mission_id": mission_id,
                "node_id":    NODE_ID,
                "status":     "failed",
                "error":      str(e)
            })
        finally:
            active_mission = None

    threading.Thread(target=run, daemon=True).start()

@sio.on("reputation_updated")
def on_reputation(data):
    global reputation
    delta      = data.get("delta", 0)
    reputation = data.get("new_reputation", reputation)
    emoji      = "📈" if delta > 0 else "📉"
    reason     = data.get("reason", "?")
    log(emoji, f"Reputación: {reputation} (delta: {delta:+d}) | {reason}")

@sio.on("mission_resolved")
def on_resolved(data):
    if data.get("node_id") != NODE_ID:
        log("📊", f"Red: misión {data.get('mission_id')} resuelta, delta {data.get('delta'):+d}")

@sio.on("ledger_error")
def on_ledger_error(data):
    log("🔥", f"Error del Ledger: {data.get('error')}")

# ── Main ──────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"""
🦞⛓  OpenClawChain Node v0.1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ID       : {NODE_ID}
Geo      : {args.geo}
Mode     : {args.mode}
Dispatcher: {args.dispatcher}
Min Credits: {args.min_credits}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
""")
    # Iniciar heartbeat en segundo plano
    threading.Thread(target=heartbeat_loop, daemon=True).start()

    try:
        sio.connect(args.dispatcher)
        sio.wait()
    except KeyboardInterrupt:
        log("⬛", "Kill Switch activado. Nodo desconectado.")
        sio.disconnect()
