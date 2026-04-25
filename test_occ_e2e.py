# ============================================================
#  OpenClawChain — TEST E2E  (v0.1)
#  Simula: Humano en Buenos Aires → Nodo en Tokio
#  Corre en: python scripts/test_occ_e2e.py
#  Requiere: Ledger y Dispatcher corriendo primero.
# ============================================================

import socketio
import time
import threading
import uuid

DISPATCHER_URL = "http://localhost:3001"

# ─── NODO TOKIO ──────────────────────────────────────────────
def run_tokyo_node(success: bool = True):
    sio = socketio.Client()
    node_id = f"node_jp_{str(uuid.uuid4())[:6]}"

    @sio.event
    def connect():
        print(f"\n🇯🇵 [TOKIO] Conectado | ID: {node_id}")
        sio.emit("register_node", { "id": node_id, "geo": "JP" })

    @sio.on("registered")
    def on_registered(data):
        print(f"🇯🇵 [TOKIO] Rep:{data['reputation']} | Trust:{data['trust_level']}")

    @sio.on("new_mission_broadcast")
    def on_mission(smc):
        mission = smc.get("mission", {})
        print(f"🇯🇵 [TOKIO] Misión recibida: {mission.get('intent','?')}")
        time.sleep(1)
        sio.emit("accept_mission", {
            "mission_id": mission["id"],
            "node_id":    node_id
        })

    @sio.on("mission_confirmed")
    def on_confirmed(data):
        print(f"🇯🇵 [TOKIO] ✅ Confirmado. Ejecutando...")
        time.sleep(3)  # simula navegación
        result = "success" if success else "failed"
        print(f"🇯🇵 [TOKIO] {'✅' if success else '❌'} Ejecución: {result.upper()}")
        sio.emit("submit_proof", {
            "mission_id": data["mission_id"],
            "node_id":    node_id,
            "status":     result,
            "dom_hash":   "abc123def456" if success else None
        })

    @sio.on("reputation_updated")
    def on_rep(data):
        emoji = "📈" if data["delta"] > 0 else "📉"
        print(f"🇯🇵 [TOKIO] {emoji} Rep final: {data['new_reputation']} (delta: {data['delta']:+d})")
        print(f"🇯🇵 [TOKIO] Razón: {data['reason']}")
        print(f"\n{'='*50}")
        print(f"✅ TEST COMPLETADO {'(EXITOSO)' if data['delta']>0 else '(FALLO — Factor 5 aplicado)'}")
        print(f"{'='*50}\n")
        sio.disconnect()

    sio.connect(DISPATCHER_URL)
    sio.wait()

# ─── HUMANO EN BUENOS AIRES ───────────────────────────────────
def run_bue_human(mission_intent: str = "Comprar entrada Tokyo Dome concierto 20/06"):
    sio = socketio.Client()
    time.sleep(2)  # esperar que el nodo Tokio se registre

    @sio.event
    def connect():
        print(f"\n🇦🇷 [BUE] Conectado. Enviando misión a la red...")
        smc = {
            "smc_version": "0.1",
            "mission": {
                "id":    f"MCN-{str(uuid.uuid4())[:6].upper()}",
                "intent": mission_intent,
                "steps": [
                    { "action": "navigate",   "url": "https://ticket.tokyo-dome.co.jp" },
                    { "action": "search",     "query": "concierto junio 2025" },
                    { "action": "screenshot", "label": "resultado_final" }
                ],
                "constraints": {
                    "geo":              "JP",
                    "trust_level_min":  0,
                    "timeout_seconds":  60,
                    "credits_offered":  10
                }
            },
            "proof_required": { "dom_hash": True, "screenshot": True },
            "requester": { "node_id": "human_bue_001", "reputation_score": 340 }
        }
        print(f"🇦🇷 [BUE] SMC: {smc['mission']['id']} → geo:JP credits:10")
        sio.emit("broadcast_mission", smc)

    @sio.on("mission_broadcasted")
    def on_broadcasted(data):
        print(f"🇦🇷 [BUE] 📡 Misión difundida a {data.get('recipients',0)} nodo(s) en JP")

    @sio.on("mission_claimed")
    def on_claimed(data):
        print(f"🇦🇷 [BUE] 🤝 Misión tomada por: {data['by']}")

    @sio.on("mission_resolved")
    def on_resolved(data):
        print(f"🇦🇷 [BUE] 🏁 Misión resuelta. Éxito: {data['success']}")
        time.sleep(1)
        sio.disconnect()

    sio.connect(DISPATCHER_URL)
    sio.wait()

# ─── RUNNER ──────────────────────────────────────────────────
def run_test(success=True):
    print(f"""
🦞⛓  OpenClawChain — Test E2E v0.1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ruta:   Buenos Aires → Tokio
Modo:   {'✅ ÉXITO (rep +10)' if success else '❌ FALLO (Factor 5: rep -50)'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
""")
    t1 = threading.Thread(target=run_tokyo_node, kwargs={"success": success})
    t2 = threading.Thread(target=run_bue_human)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

if __name__ == "__main__":
    import sys
    # Pasar "fail" como argumento para probar el Factor 5
    # python scripts/test_occ_e2e.py fail
    success = "--fail" not in sys.argv
    run_test(success=success)
