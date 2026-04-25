# 🦞⛓️ OpenClawChain (OCC)

> *"Blockchain descentralizó el dinero. OpenClawChain descentraliza la acción."*

**OpenClawChain** es una capa de red P2P que conecta instancias de [OpenClaw](https://github.com/openclaw/openclaw) dispersas en el mundo, transformando millones de asistentes de IA aislados en una **red coordinada de ejecución real**.

Un nodo en Tokio puede comprar una entrada de concierto. Un nodo en Berlín puede rellenar un formulario gubernamental. Vos, desde Buenos Aires, le das la orden.

---

## ¿Por qué existe esto?

OpenClaw ya corre en millones de máquinas. Cada instancia es un agente capaz de navegar, hacer clic, extraer datos y actuar en webs reales. El problema: **están solos**. No se conocen. No pueden colaborar.

OCC es el puente que faltaba. No reemplaza a OpenClaw. Lo conecta.

```
Sin OCC:   [OpenClaw AR]   [OpenClaw JP]   [OpenClaw DE]   ← islas
Con OCC:   [OpenClaw AR] ─── [OpenClaw JP] ─── [OpenClaw DE]  ← red viva
```

---

## Arquitectura

Tres capas desacopladas. Si una cae, las otras sobreviven.

```
┌─────────────────────────────────────────────────────┐
│  LEDGER  (Python / FastAPI / SQLite)                │
│  → Fuente de verdad. Reputación, identidades, PoR.  │
│  → No se puede editar localmente. Solo el Oracle.   │
├─────────────────────────────────────────────────────┤
│  DISPATCHER  (Node.js / Socket.io)                  │
│  → Tablón de anuncios. Distribuye misiones (SMC).   │
│  → Stateless. Puede reiniciarse sin perder datos.   │
├─────────────────────────────────────────────────────┤
│  NODES  (Python + OpenClaw)                         │
│  → Los músculos. Ejecutan en navegadores reales.    │
│  → Perfiles efímeros. Kill Switch instantáneo.      │
└─────────────────────────────────────────────────────┘
```

---

## Inicio Rápido

### Requisitos

- Python 3.9+
- Node.js 18+
- [OpenClaw](https://github.com/openclaw/openclaw) instalado

### 1. Clonar

```bash
git clone https://github.com/tu-usuario/openclawchain.git
cd openclawchain
```

### 2. Levantar el Ledger

```bash
# Terminal 1
pip install fastapi uvicorn
uvicorn ledger:app --port 8000 --reload
```

### 3. Levantar el Dispatcher

```bash
# Terminal 2
npm install socket.io axios
node dispatcher.js
```

### 4. Conectar el Dashboard

Abrí el Dashboard en el navegador. En la barra superior:
- URL: `http://localhost:3001`
- Presioná **CONECTAR LIVE**

El indicador pasa de `● SIMULACIÓN` → `● LIVE`.

### 5. Prueba E2E (Buenos Aires → Tokio)

```bash
# Terminal 3
pip install "python-socketio[client]"
python scripts/test_occ_e2e.py
```

Vas a ver en el Dashboard cómo una misión viaja de AR a JP, es aceptada, ejecutada y liquidada. Si el nodo falla, el **Factor 5** entra en acción.

---

## El Protocolo de Misión (SMC)

Cada tarea viaja por la red en un **Standard Mission Contract**:

```json
{
  "smc_version": "0.1",
  "mission": {
    "id": "MCN-001",
    "intent": "Comprar entrada Tokyo Dome concierto 20/06",
    "steps": [
      { "action": "navigate", "url": "https://ticket.tokyo-dome.co.jp" },
      { "action": "search",   "query": "concierto junio" },
      { "action": "screenshot", "label": "resultado_final" }
    ],
    "constraints": {
      "geo": "JP",
      "trust_level_min": 2,
      "timeout_seconds": 300,
      "credits_offered": 10
    }
  },
  "proof_required": {
    "dom_hash": true,
    "screenshot": true
  }
}
```

---

## Sistema de Reputación

OCC no tiene moderadores. La red se autorregula con incentivos asimétricos.

| Trust Level | Rango de Rep | Misiones habilitadas |
|---|---|---|
| **Scout** | 0 – 99 | Búsquedas y scraping público |
| **Runner** | 100 – 499 | Formularios, comparativas |
| **Pilot** | 500 – 1999 | Compras, acceso geográfico |
| **Ghost** | 2000+ | Misiones críticas, elite |

### El Factor 5

> Una misión fallida tras ser aceptada penaliza **5 veces** los créditos ofrecidos.

```
Misión exitosa:  reputación += credits_offered
Misión fallida:  reputación -= credits_offered × 5
```

Traicionar la red es económicamente irracional. Así se mantiene honesta.

---

## Seguridad: Dual-Shell

El OCC-Kernel **nunca** opera sobre el perfil principal del usuario.

- **Perfil efímero:** instancia de navegador en RAM, destruida al terminar la misión
- **Sandboxing:** el agente solo accede a la pestaña asignada
- **Kill Switch:** desconexión instantánea, sin riesgo para el equipo

El usuario decide qué permisos otorga. La máquina, las reglas.

---

## Estructura del Repositorio

```
openclawchain/
├── ledger.py          # API de reputación (FastAPI)
├── dispatcher.js      # Tablón de anuncios (Socket.io)
├── occ_node.py        # Cliente nodo (Python)
├── dashboard/
│   └── occ-dashboard.jsx   # Dashboard React
├── scripts/
│   └── test_occ_e2e.py     # Prueba Buenos Aires → Tokio
└── README.md
```

---

## Contribuir

El proyecto está en v0.1. Estas son las áreas abiertas con mayor impacto:

**Protocolo**
- [ ] WebRTC para comunicación P2P pura (eliminar el Dispatcher central)
- [ ] Gossip Protocol real entre nodos (sin servidor de señalización)
- [ ] DNS-Discovery via registro TXT en `pulse.openclawchain.io`

**Ejecución**
- [ ] Wrapper real de OpenClaw (conectar SMC steps a la API del agente)
- [ ] Proof of Result robusto (DOM hash + network trace verificable)
- [ ] Perfiles efímeros con herencia selectiva de cookies

**Economía**
- [ ] Sistema de créditos OCC (tiempo de agente como moneda)
- [ ] Integración opcional con Lightning Network

**Si tenés un OpenClaw corriendo, ya sos parte de la red.**

---

## Manifiesto

Internet se convirtió en un conjunto de silos. Uber captura la reputación de sus choferes. Mercado Libre captura la de sus vendedores. Fiverr la de sus freelancers. En todos los casos, **la reputación le pertenece a la plataforma, no a la persona**.

OpenClawChain nace con un principio distinto: **tu reputación es tuya**. Tu historial de trabajo, tu nivel de confianza, tu identidad en la red, viajan con vos. Ninguna empresa puede bloquearte y hacerte empezar de cero.

No somos una red de información. Somos una **red de acción**.

---

*Tu computadora no es solo una pantalla. Es una neurona de una inteligencia global lista para actuar donde sea, cuando sea.* 🦞⛓️

---

## Apoyar el proyecto 💛

OpenClawChain es un proyecto independiente creado desde Argentina. Si te fue útil o querés que siga creciendo:

**Mercado Pago** (Argentina / Latinoamérica)
- Alias: **benitez.247**
- Nombre: Oscar Ruben Benitez Ojeda

**Solana** (Internacional)
- Wallet: `7n23dZ1SddtHvgq11r5vYiCLVWqxoRwjcqdPWPXTmzfF`

**Licencia comercial**
- 📧 orbopy@gmail.com

*Cada donación financia nuevos nodos de desarrollo y funcionalidades.* 🦞
