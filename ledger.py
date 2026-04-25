# ============================================================
#  OpenClawChain — THE LEDGER  (v0.1)
#  Fuente de verdad: identidades, reputación, transacciones.
#  Corre en: uvicorn ledger:app --port 8000 --reload
# ============================================================

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3, time, uuid

app = FastAPI(title="OCC Ledger", version="0.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = "occ_ledger.db"

# ── Base de datos ─────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS nodes (
            node_id       TEXT PRIMARY KEY,
            geo           TEXT NOT NULL,
            reputation    INTEGER DEFAULT 100,
            missions_ok   INTEGER DEFAULT 0,
            missions_fail INTEGER DEFAULT 0,
            joined_at     INTEGER NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            tx_id      TEXT PRIMARY KEY,
            mission_id TEXT NOT NULL,
            node_id    TEXT NOT NULL,
            delta      INTEGER NOT NULL,
            reason     TEXT NOT NULL,
            timestamp  INTEGER NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS missions (
            mission_id     TEXT PRIMARY KEY,
            smc_json       TEXT NOT NULL,
            status         TEXT DEFAULT 'pending',
            assigned_to    TEXT,
            created_at     INTEGER NOT NULL,
            completed_at   INTEGER
        )
    """)
    conn.commit()
    return conn

def get_trust_level(reputation: int, missions_ok: int) -> str:
    if missions_ok >= 500 and reputation >= 2000: return "Ghost"
    if missions_ok >= 50  and reputation >= 500:  return "Pilot"
    if missions_ok >= 10  and reputation >= 100:  return "Runner"
    return "Scout"

# ── Modelos ───────────────────────────────────────────────────
class NodeRegister(BaseModel):
    node_id: str
    geo: str

class MissionResult(BaseModel):
    mission_id: str
    node_id:    str
    success:    bool
    credits_offered: int

class MissionStore(BaseModel):
    mission_id: str
    smc_json:   str

# ── Endpoints ─────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "OCC Ledger online", "version": "0.1"}

@app.post("/register_node")
def register_node(data: NodeRegister):
    """Registra un nodo nuevo. Si ya existe, devuelve su estado actual."""
    db = get_db()
    existing = db.execute(
        "SELECT * FROM nodes WHERE node_id = ?", (data.node_id,)
    ).fetchone()

    if existing:
        return {
            "node_id":     existing["node_id"],
            "geo":         existing["geo"],
            "reputation":  existing["reputation"],
            "trust_level": get_trust_level(existing["reputation"], existing["missions_ok"]),
            "missions_ok": existing["missions_ok"],
            "registered":  False
        }

    db.execute(
        "INSERT INTO nodes VALUES (?,?,?,?,?,?)",
        (data.node_id, data.geo, 100, 0, 0, int(time.time()))
    )
    db.commit()
    return {
        "node_id":     data.node_id,
        "geo":         data.geo,
        "reputation":  100,
        "trust_level": "Scout",
        "missions_ok": 0,
        "registered":  True
    }

@app.get("/node/{node_id}")
def get_node(node_id: str):
    """Devuelve estado completo de un nodo."""
    db = get_db()
    node = db.execute(
        "SELECT * FROM nodes WHERE node_id = ?", (node_id,)
    ).fetchone()
    if not node:
        raise HTTPException(404, f"Nodo {node_id} no encontrado")
    return {
        "node_id":      node["node_id"],
        "geo":          node["geo"],
        "reputation":   node["reputation"],
        "trust_level":  get_trust_level(node["reputation"], node["missions_ok"]),
        "missions_ok":  node["missions_ok"],
        "missions_fail":node["missions_fail"],
        "joined_at":    node["joined_at"]
    }

@app.get("/nodes")
def list_nodes():
    """Lista todos los nodos registrados."""
    db = get_db()
    rows = db.execute("SELECT * FROM nodes ORDER BY reputation DESC").fetchall()
    return [
        {
            "node_id":     r["node_id"],
            "geo":         r["geo"],
            "reputation":  r["reputation"],
            "trust_level": get_trust_level(r["reputation"], r["missions_ok"]),
            "missions_ok": r["missions_ok"],
        }
        for r in rows
    ]

@app.post("/resolve_mission")
def resolve_mission(result: MissionResult):
    """
    Liquida una misión. Aplica Factor 5 si falla.
    Misión exitosa:  reputación += credits_offered
    Misión fallida:  reputación -= credits_offered × 5
    """
    db = get_db()
    node = db.execute(
        "SELECT * FROM nodes WHERE node_id = ?", (result.node_id,)
    ).fetchone()
    if not node:
        raise HTTPException(404, f"Nodo {result.node_id} no encontrado")

    if result.success:
        delta  = result.credits_offered
        reason = "mission_success"
        ok_inc, fail_inc = 1, 0
    else:
        delta  = -(result.credits_offered * 5)   # Factor 5
        reason = "mission_failed_factor5"
        ok_inc, fail_inc = 0, 1

    new_reputation = max(0, node["reputation"] + delta)

    db.execute(
        "UPDATE nodes SET reputation=?, missions_ok=missions_ok+?, missions_fail=missions_fail+? WHERE node_id=?",
        (new_reputation, ok_inc, fail_inc, result.node_id)
    )
    db.execute(
        "INSERT INTO transactions VALUES (?,?,?,?,?,?)",
        (str(uuid.uuid4()), result.mission_id, result.node_id, delta, reason, int(time.time()))
    )
    db.commit()

    return {
        "node_id":        result.node_id,
        "mission_id":     result.mission_id,
        "delta":          delta,
        "new_reputation": new_reputation,
        "trust_level":    get_trust_level(new_reputation, node["missions_ok"] + ok_inc),
        "reason":         reason
    }

@app.get("/transactions/{node_id}")
def get_transactions(node_id: str, limit: int = 20):
    """Historial de transacciones de un nodo."""
    db = get_db()
    rows = db.execute(
        "SELECT * FROM transactions WHERE node_id=? ORDER BY timestamp DESC LIMIT ?",
        (node_id, limit)
    ).fetchall()
    return [dict(r) for r in rows]

@app.get("/leaderboard")
def leaderboard():
    """Top 10 nodos por reputación."""
    db = get_db()
    rows = db.execute(
        "SELECT * FROM nodes ORDER BY reputation DESC LIMIT 10"
    ).fetchall()
    return [
        {
            "rank":        i+1,
            "node_id":     r["node_id"],
            "geo":         r["geo"],
            "reputation":  r["reputation"],
            "trust_level": get_trust_level(r["reputation"], r["missions_ok"]),
            "missions_ok": r["missions_ok"],
        }
        for i,r in enumerate(rows)
    ]
