// ============================================================
//  OpenClawChain — THE DISPATCHER  (v0.1)
//  Tablón de anuncios. Distribuye SMC en tiempo real.
//  Corre en: node dispatcher.js
// ============================================================

const { Server } = require("socket.io");
const axios      = require("axios");

const PORT       = process.env.OCC_PORT   || 3001;
const LEDGER_URL = process.env.LEDGER_URL || "http://localhost:8000";

const io = new Server(PORT, {
  cors: { origin: "*", methods: ["GET","POST"] }
});

// ── Estado en memoria (se pierde al reiniciar — por diseño) ───
const connectedNodes  = new Map();   // socket.id → nodeInfo
const activeMissions  = new Set();   // mission_ids ya aceptadas
const missionCache    = new Map();   // mission_id → SMC original

console.log(`🦞⛓  OCC Dispatcher v0.1 escuchando en :${PORT}`);
console.log(`📒  Ledger en ${LEDGER_URL}`);

// ── Utilidades ────────────────────────────────────────────────
function broadcastDirectory() {
  const dir = Array.from(connectedNodes.values());
  io.emit("directory-update", dir);
  console.log(`📡 Directorio: ${dir.length} nodos online`);
}

function timestamp() {
  return new Date().toISOString().slice(11,19);
}

// ── Conexiones ────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`🔌 [${timestamp()}] Conexión: ${socket.id}`);

  // ── 1. Registro de nodo ──────────────────────────────────
  socket.on("register_node", async (data) => {
    try {
      // Verificar o crear nodo en el Ledger
      let nodeInfo;
      try {
        const res = await axios.get(`${LEDGER_URL}/node/${data.id}`);
        nodeInfo = res.data;
      } catch (err) {
        if (err.response?.status === 404) {
          // Nodo nuevo: registrar en Ledger
          const res = await axios.post(`${LEDGER_URL}/register_node`, {
            node_id: data.id,
            geo:     data.geo
          });
          nodeInfo = res.data;
        } else throw err;
      }

      // Unirse al canal geográfico
      socket.join(`geo:${data.geo}`);
      socket.join(`trust:${nodeInfo.trust_level}`);

      socket.nodeInfo = {
        id:          nodeInfo.node_id,
        geo:         nodeInfo.geo,
        reputation:  nodeInfo.reputation,
        trust_level: nodeInfo.trust_level,
        socket_id:   socket.id
      };
      connectedNodes.set(socket.id, socket.nodeInfo);

      socket.emit("registered", socket.nodeInfo);
      console.log(`✅ [${timestamp()}] Nodo ${data.id} (${data.geo}) Trust:${nodeInfo.trust_level}`);
      broadcastDirectory();

    } catch (err) {
      console.error(`❌ Registro fallido para ${data.id}:`, err.message);
      socket.emit("register_error", { error: err.message });
    }
  });

  // ── 2. Broadcast de misión (desde humano/app) ────────────
  socket.on("broadcast_mission", (smc) => {
    const missionId  = smc?.mission?.id;
    const targetGeo  = smc?.mission?.constraints?.geo;
    const minTrust   = smc?.mission?.constraints?.trust_level_min || 0;
    const credits    = smc?.mission?.constraints?.credits_offered || 0;

    if (!missionId || !targetGeo) {
      socket.emit("mission_error", { error: "SMC inválido: falta mission.id o constraints.geo" });
      return;
    }

    // Guardar SMC para liquidación posterior
    missionCache.set(missionId, smc);

    console.log(`📣 [${timestamp()}] Misión ${missionId} → geo:${targetGeo} trust≥${minTrust} credits:${credits}`);

    // Emitir al canal geográfico
    io.to(`geo:${targetGeo}`).emit("new_mission_broadcast", smc);

    // Confirmar al emisor
    socket.emit("mission_broadcasted", {
      mission_id: missionId,
      target_geo: targetGeo,
      recipients: io.sockets.adapter.rooms.get(`geo:${targetGeo}`)?.size || 0
    });
  });

  // ── 3. Aceptación de misión (handshake) ──────────────────
  socket.on("accept_mission", (data) => {
    const { mission_id, node_id } = data;

    // Lock: solo el primero que llega se lleva la misión
    if (activeMissions.has(mission_id)) {
      socket.emit("mission_already_claimed", { mission_id });
      return;
    }

    activeMissions.add(mission_id);
    console.log(`🤝 [${timestamp()}] Misión ${mission_id} aceptada por ${node_id}`);

    // Avisar a toda la red que la misión fue tomada
    io.emit("mission_claimed", { mission_id, by: node_id });

    // Confirmar al nodo ganador con el SMC completo
    const smc = missionCache.get(mission_id) || {};
    socket.emit("mission_confirmed", { mission_id, node_id, smc });
  });

  // ── 4. Recepción de Proof of Result ──────────────────────
  socket.on("submit_proof", async (por) => {
    const { mission_id, node_id, status, dom_hash } = por;
    const success = status === "success";

    console.log(`🧐 [${timestamp()}] PoR misión ${mission_id} → ${status.toUpperCase()}`);

    // Obtener credits_offered del SMC original
    const smc           = missionCache.get(mission_id);
    const creditsOffered = smc?.mission?.constraints?.credits_offered || 5;

    try {
      const result = await axios.post(`${LEDGER_URL}/resolve_mission`, {
        mission_id,
        node_id,
        success,
        credits_offered: creditsOffered
      });

      const emoji = result.data.delta > 0 ? "📈" : "📉";
      console.log(`${emoji} Liquidación: delta ${result.data.delta} para ${node_id} → rep ${result.data.new_reputation}`);

      // Notificar al nodo ejecutor
      socket.emit("reputation_updated", {
        ...result.data,
        mission_id
      });

      // Notificar a toda la red (para el Dashboard)
      io.emit("mission_resolved", {
        mission_id,
        node_id,
        success,
        delta:          result.data.delta,
        new_reputation: result.data.new_reputation
      });

      // Limpiar caché
      missionCache.delete(mission_id);

    } catch (err) {
      console.error(`🔥 Error al liquidar en Ledger:`, err.message);
      socket.emit("ledger_error", { error: err.message, mission_id });
    }
  });

  // ── 5. Heartbeat del nodo ────────────────────────────────
  socket.on("heartbeat", (data) => {
    if (connectedNodes.has(socket.id)) {
      connectedNodes.get(socket.id).last_seen = Date.now();
      socket.emit("heartbeat_ack", { ts: Date.now() });
    }
  });

  // ── Desconexión ──────────────────────────────────────────
  socket.on("disconnect", () => {
    const node = connectedNodes.get(socket.id);
    if (node) {
      console.log(`🔴 [${timestamp()}] Nodo ${node.id} (${node.geo}) desconectado`);
      connectedNodes.delete(socket.id);
      broadcastDirectory();
    }
  });
});

// ── Health check HTTP simple ──────────────────────────────────
const http = require("http");
http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status:  "ok",
      nodes:   connectedNodes.size,
      missions: activeMissions.size
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(PORT + 1, () => {
  console.log(`🩺 Health check en :${PORT + 1}/health`);
});
