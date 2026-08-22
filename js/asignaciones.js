// ══════════════════════════════════════════════════════════════
// asignaciones.js — Traspaso de clientes entre ingenieros
// Arquitectura: campo clientes/{id}.ingeniero = alias
// Log en colección: traspasos/{id}
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { esc } from "./app.js";
import { Sesion } from "./auth.js";
import {
  collection, query, orderBy, onSnapshot, getDocs,
  doc, updateDoc, addDoc, serverTimestamp, limit, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Estado ─────────────────────────────────────────────────────
let _unsubClientes   = null;
let _unsubTraspasos  = null;
let _clientes        = [];
let _ingenieros      = [];   // aliases de clientes (para panel izq)
let _usuariosIng     = [];   // aliases rol=INGENIERO (para dropdown destino)
let _selIngenieroOri = null;  // alias del ingeniero origen seleccionado
let _seleccionados   = new Set(); // ids de clientes seleccionados
let _tabActiva       = "asignar"; // "asignar" | "historial"

const fmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const fmtDt = ts => {
  if (!ts) return "—";
  try { return new Date(ts?.toDate?.() ?? ts).toLocaleDateString("es-MX",
    { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return "—"; }
};

// ── Módulo exportado ──────────────────────────────────────────
export const AsignacionesModule = {
  mount(container) {
    container.innerHTML = _htmlShell();
    _bindTabs();
    _escucharClientes();
    return () => this.destroy();
  },
  destroy() {
    _unsubClientes?.();
    _unsubTraspasos?.();
    _unsubClientes = _unsubTraspasos = null;
    _clientes = []; _ingenieros = [];
    _selIngenieroOri = null; _seleccionados.clear();
    _tabActiva = "asignar";
  }
};

// ── Shell HTML ────────────────────────────────────────────────
function _htmlShell() {
  return `
  <div style="display:flex;flex-direction:column;height:100%;gap:0">

    <!-- Header + tabs -->
    <div style="background:var(--surface);border-bottom:1px solid var(--border);padding:14px 16px 0;flex-shrink:0">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
        <div>
          <div style="font-size:1.1rem;font-weight:800;color:var(--text-primary)">🔄 Asignaciones</div>
          <div style="font-size:11px;color:var(--text-sec);margin-top:2px">
            Traspaso de clientes entre ingenieros con auditoría completa
          </div>
        </div>
        <div id="asig-kpis" style="display:flex;gap:10px;flex-wrap:wrap"></div>
      </div>
      <div style="display:flex;gap:0;border-bottom:1px solid var(--border)">
        <button class="asig-tab active" data-tab="asignar" onclick="AsigUI.setTab('asignar')"
          style="${_tabStyle(true)}">🔄 Reasignar clientes</button>
        <button class="asig-tab" data-tab="historial" onclick="AsigUI.setTab('historial')"
          style="${_tabStyle(false)}">📋 Historial de traspasos</button>
      </div>
    </div>

    <!-- Contenido -->
    <div id="asig-content" style="flex:1;overflow:hidden;display:flex;flex-direction:column"></div>

    <!-- Modal reasignar -->
    <div id="asig-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);
      z-index:1001;align-items:center;justify-content:center;padding:20px">
      <div style="background:var(--surface);border-radius:14px;width:480px;max-width:100%;
        border:1px solid var(--border);box-shadow:0 8px 32px rgba(0,0,0,.22);padding:24px">
        <div id="asig-modal-body"></div>
      </div>
    </div>
  </div>`;
}

function _tabStyle(activa) {
  return `padding:8px 18px;border:none;background:transparent;cursor:pointer;font-size:13px;
    font-weight:${activa ? "700" : "500"};color:${activa ? "#1565C0" : "var(--text-sec)"};
    border-bottom:${activa ? "2px solid #1565C0" : "2px solid transparent"};
    margin-bottom:-1px;transition:all .15s`;
}

// ── Tabs ──────────────────────────────────────────────────────
function _bindTabs() {
  window.AsigUI = {
    setTab(tab) {
      _tabActiva = tab;
      document.querySelectorAll(".asig-tab").forEach(b => {
        const activa = b.dataset.tab === tab;
        b.style.fontWeight    = activa ? "700" : "500";
        b.style.color         = activa ? "#1565C0" : "var(--text-sec)";
        b.style.borderBottom  = activa ? "2px solid #1565C0" : "2px solid transparent";
      });
      if (tab === "asignar")   _renderAsignar();
      if (tab === "historial") _renderHistorial();
    },
    seleccionarIngeniero(alias) { _seleccionarIngeniero(alias); },
    toggleCliente(id) {
      if (_seleccionados.has(id)) _seleccionados.delete(id);
      else _seleccionados.add(id);
      _renderListaClientes();
    },
    seleccionarTodos() {
      const lista = _selIngenieroOri === "__sin_asignar__"
        ? _clientes.filter(c => !c.ingeniero)
        : _clientesDeIngeniero(_selIngenieroOri);
      if (_seleccionados.size > 0 && _seleccionados.size === lista.length)
        _seleccionados.clear();
      else lista.forEach(c => _seleccionados.add(c.id));
      _renderListaClientes();
    },
    filtrarClientes(q) { _filtroClientes = q.toLowerCase(); _renderListaClientes(); },
    abrirModalReasignar() { _abrirModalReasignar(); },
    cerrarModal() { document.getElementById("asig-modal").style.display = "none"; },
    confirmarTraspaso() { _confirmarTraspaso(); }
  };
}

let _filtroClientes = "";

// ── Datos ─────────────────────────────────────────────────────
async function _cargarUsuariosIngenieros() {
  try {
    const snap = await getDocs(query(
      collection(db, "usuarios"),
      where("rol", "==", "INGENIERO")
    ));
    _usuariosIng = snap.docs
      .filter(d => d.data().activo !== false)
      .map(d => d.data().alias || d.data().email || d.id)
      .filter(Boolean)
      .sort();
  } catch { _usuariosIng = []; }
}

function _escucharClientes() {
  _cargarUsuariosIngenieros();
  _unsubClientes = onSnapshot(
    query(collection(db, "clientes"), orderBy("nombre")),
    snap => {
      _clientes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _ingenieros = [...new Set(_clientes.map(c => c.ingeniero).filter(Boolean))].sort();
      _renderKPIs();
      if (_tabActiva === "asignar") _renderAsignar();
    }
  );
}

function _clientesDeIngeniero(alias) {
  if (!alias) return [];
  const q = _filtroClientes;
  return _clientes.filter(c => {
    const esPropio     = c.ingeniero === alias;
    const esCompartido = c.compartido === true && (c.ingenierosCompartidos || []).includes(alias);
    if (!esPropio && !esCompartido) return false;
    return !q || (c.nombre||"").toLowerCase().includes(q) ||
                 (c.zona||"").toLowerCase().includes(q) ||
                 (c.ciudad||"").toLowerCase().includes(q);
  });
}

// ── KPIs ──────────────────────────────────────────────────────
function _renderKPIs() {
  const el = document.getElementById("asig-kpis");
  if (!el) return;
  const sinAsignar = _clientes.filter(c => !c.ingeniero).length;
  const kpi = (label, val, color) =>
    `<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;
      padding:8px 14px;text-align:center">
      <div style="font-size:18px;font-weight:800;color:${color}">${val}</div>
      <div style="font-size:10px;color:var(--text-sec);font-weight:600">${label}</div>
    </div>`;
  el.innerHTML =
    kpi("CLIENTES", _clientes.length, "var(--text-primary)") +
    kpi("INGENIEROS", _ingenieros.length, "#1565C0") +
    kpi("SIN ASIGNAR", sinAsignar, sinAsignar > 0 ? "#DC2626" : "#16A34A");
}

// ── Vista Reasignar ───────────────────────────────────────────
function _renderAsignar() {
  const content = document.getElementById("asig-content");
  if (!content) return;
  content.innerHTML = `
  <div style="display:flex;height:100%;overflow:hidden">
    <!-- Panel izquierdo: ingenieros -->
    <div style="width:240px;flex-shrink:0;border-right:1px solid var(--border);overflow-y:auto;padding:12px">
      <div style="font-size:10px;font-weight:800;color:var(--text-sec);letter-spacing:.06em;
        text-transform:uppercase;margin-bottom:8px">Ingenieros</div>
      ${_ingenieros.map(alias => {
        const count = _clientes.filter(c =>
          c.ingeniero === alias ||
          (c.compartido === true && (c.ingenierosCompartidos||[]).includes(alias))
        ).length;
        const activo = alias === _selIngenieroOri;
        return `<div onclick="AsigUI.seleccionarIngeniero('${esc(alias)}')"
          style="padding:10px 12px;border-radius:8px;cursor:pointer;margin-bottom:4px;
            background:${activo ? "#EFF6FF" : "transparent"};
            border:1px solid ${activo ? "#BFDBFE" : "transparent"};transition:all .1s"
          onmouseover="this.style.background='var(--surface-2)'"
          onmouseout="this.style.background='${activo ? "#EFF6FF" : "transparent"}'">
          <div style="font-size:12px;font-weight:${activo?"800":"600"};color:${activo?"#1565C0":"var(--text-primary)"}">
            ${esc(alias)}
          </div>
          <div style="font-size:11px;color:var(--text-sec)">${count} cliente${count!==1?"s":""}</div>
        </div>`;
      }).join("")}
      ${_clientes.filter(c => !c.ingeniero).length > 0
        ? `<div onclick="AsigUI.seleccionarIngeniero('__sin_asignar__')"
            style="padding:10px 12px;border-radius:8px;cursor:pointer;margin-bottom:4px;
              background:${_selIngenieroOri==='__sin_asignar__'?"#FEF2F2":"transparent"};
              border:1px solid ${_selIngenieroOri==='__sin_asignar__'?"#FECACA":"transparent"}">
            <div style="font-size:12px;font-weight:600;color:#DC2626">⚠️ Sin asignar</div>
            <div style="font-size:11px;color:var(--text-sec)">
              ${_clientes.filter(c=>!c.ingeniero).length} clientes
            </div>
          </div>`
        : ""}
    </div>

    <!-- Panel derecho: clientes del ingeniero seleccionado -->
    <div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
      <div id="asig-lista-header" style="padding:12px 16px;border-bottom:1px solid var(--border);
        flex-shrink:0;display:flex;gap:10px;align-items:center;flex-wrap:wrap"></div>
      <div id="asig-lista-clientes" style="flex:1;overflow-y:auto;padding:12px 16px"></div>
    </div>
  </div>`;

  _renderListaClientes();
}

function _seleccionarIngeniero(alias) {
  _selIngenieroOri = alias;
  _seleccionados.clear();
  _filtroClientes = "";
  _renderAsignar();
}

function _renderListaClientes() {
  const header = document.getElementById("asig-lista-header");
  const lista  = document.getElementById("asig-lista-clientes");
  if (!header || !lista) return;

  if (!_selIngenieroOri) {
    header.innerHTML = `<span style="font-size:13px;color:var(--text-sec)">
      ← Selecciona un ingeniero para ver sus clientes</span>`;
    lista.innerHTML = "";
    return;
  }

  const clientes = _selIngenieroOri === "__sin_asignar__"
    ? _clientes.filter(c => !c.ingeniero && (
        !_filtroClientes ||
        (c.nombre||"").toLowerCase().includes(_filtroClientes) ||
        (c.zona||"").toLowerCase().includes(_filtroClientes)
      ))
    : _clientesDeIngeniero(_selIngenieroOri);

  const label = _selIngenieroOri === "__sin_asignar__" ? "Sin asignar" : _selIngenieroOri;
  const nSel  = _seleccionados.size;

  header.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:var(--text-primary)">
      ${esc(label)} — ${clientes.length} cliente${clientes.length!==1?"s":""}
    </div>
    <input type="text" placeholder="Filtrar…" value="${esc(_filtroClientes)}"
      oninput="AsigUI.filtrarClientes(this.value)"
      style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;
        font-size:12px;background:var(--surface);color:var(--text-primary);width:180px">
    <button onclick="AsigUI.seleccionarTodos()"
      style="padding:5px 12px;border:1px solid var(--border);border-radius:6px;
        background:transparent;font-size:11px;cursor:pointer;color:var(--text-sec)">
      ${nSel === clientes.length && clientes.length > 0 ? "Deselect. todos" : "Sel. todos"}
    </button>
    ${nSel > 0
      ? `<button onclick="AsigUI.abrirModalReasignar()"
          style="padding:6px 16px;border:none;border-radius:6px;background:#1565C0;
            color:#fff;font-size:12px;font-weight:700;cursor:pointer;margin-left:auto">
          🔄 Reasignar ${nSel} cliente${nSel!==1?"s":""}
        </button>`
      : ""}`;

  if (!clientes.length) {
    lista.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-sec);font-size:13px">
      Sin clientes para este filtro.</div>`;
    return;
  }

  lista.innerHTML = `
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">
    ${clientes.map(c => {
      const sel = _seleccionados.has(c.id);
      const saldo = Number(c.saldo) || 0;
      return `<div onclick="AsigUI.toggleCliente('${esc(c.id)}')"
        style="background:${sel?"rgba(37,99,235,0.12)":"var(--surface)"};
          border:2px solid ${sel?"#2563EB":"var(--border)"};
          border-radius:10px;padding:12px;cursor:pointer;transition:all .1s">
        <div style="display:flex;align-items:flex-start;gap:8px">
          <input type="checkbox" ${sel?"checked":""} style="margin-top:3px;pointer-events:none"
            onclick="event.preventDefault()">
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:700;color:var(--text-primary);
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.nombre||"—")}</div>
            <div style="font-size:11px;color:var(--text-sec);margin-top:2px">
              ${esc(c.zona||"")}${c.ciudad?` · ${esc(c.ciudad)}`:""}
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center">
          ${c.segmento
            ? `<span style="font-size:10px;background:rgba(37,99,235,0.15);color:var(--blue,#2563EB);padding:2px 7px;
                border-radius:9px;font-weight:600">${esc(c.segmento)}</span>`
            : ""}
          ${saldo > 0
            ? `<span style="font-size:10px;background:rgba(220,38,38,0.12);color:#DC2626;padding:2px 7px;
                border-radius:9px;font-weight:600">${fmt.format(saldo)}</span>`
            : ""}
          ${c.estadoLegal && c.estadoLegal !== "Al corriente"
            ? `<span style="font-size:10px;background:rgba(217,119,6,0.15);color:#D97706;padding:2px 7px;
                border-radius:9px;font-weight:600">${esc(c.estadoLegal)}</span>`
            : ""}
        </div>
      </div>`;
    }).join("")}
  </div>`;
}

// ── Modal Reasignar ───────────────────────────────────────────
function _abrirModalReasignar() {
  if (_seleccionados.size === 0) { window.toast?.("Selecciona al menos un cliente.", "warn"); return; }
  const modal = document.getElementById("asig-modal");
  const body  = document.getElementById("asig-modal-body");
  if (!modal || !body) return;

  // Usar _usuariosIng (cargados de Firestore rol=INGENIERO) como fuente de verdad
  // Complementar con cualquier alias que aparezca en clientes pero no en usuarios
  const fusionados = [...new Set([
    ..._usuariosIng,
    ..._ingenieros.filter(a => a !== "__sin_asignar__")
  ])].sort();
  const optsIng = fusionados
    .filter(a => a !== _selIngenieroOri)
    .map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
  const razones = ["Cambio de ruta", "Ausencia de ingeniero", "Redistribución de zona",
                   "Solicitud del cliente", "Reorganización territorial", "Otra"];

  body.innerHTML = `
    <div style="font-size:16px;font-weight:800;color:var(--text-primary);margin-bottom:16px">
      🔄 Reasignar ${_seleccionados.size} cliente${_seleccionados.size!==1?"s":""}
    </div>

    <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;
      padding:10px 14px;margin-bottom:16px;font-size:12px;color:var(--text-sec)">
      <strong style="color:var(--text-primary)">Origen:</strong>
      ${esc(_selIngenieroOri === "__sin_asignar__" ? "Sin asignar" : _selIngenieroOri)}
      &nbsp;→&nbsp;
      <strong style="color:var(--blue,#2563EB)">Destino:</strong> (seleccionar abajo)
    </div>

    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:600;color:var(--text-sec);margin-bottom:4px">
        Ingeniero destino *
      </div>
      <select id="asig-destino" style="width:100%;padding:8px 10px;border:1px solid var(--border);
        border-radius:6px;font-size:13px;background:var(--surface);color:var(--text-primary)">
        <option value="">— Seleccionar —</option>
        ${optsIng}
      </select>
    </div>

    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:600;color:var(--text-sec);margin-bottom:4px">
        Razón del traspaso *
      </div>
      <select id="asig-razon-sel" onchange="document.getElementById('asig-razon-txt').style.display=this.value==='Otra'?'block':'none'"
        style="width:100%;padding:8px 10px;border:1px solid var(--border);
          border-radius:6px;font-size:13px;background:var(--surface);color:var(--text-primary);margin-bottom:6px">
        <option value="">— Seleccionar —</option>
        ${razones.map(r => `<option value="${r}">${r}</option>`).join("")}
      </select>
      <textarea id="asig-razon-txt" rows="2" placeholder="Describe la razón…"
        style="display:none;width:100%;padding:8px 10px;border:1px solid var(--border);
          border-radius:6px;font-size:12px;background:var(--surface);color:var(--text-primary);
          box-sizing:border-box;resize:vertical"></textarea>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button onclick="AsigUI.cerrarModal()"
        style="padding:9px 20px;border:1px solid var(--border);border-radius:6px;
          background:transparent;color:var(--text-sec);font-size:13px;cursor:pointer">
        Cancelar
      </button>
      <button id="asig-btn-confirmar" onclick="AsigUI.confirmarTraspaso()"
        style="padding:9px 24px;border:none;border-radius:6px;
          background:#1565C0;color:#fff;font-size:13px;font-weight:700;cursor:pointer">
        ✅ Confirmar traspaso
      </button>
    </div>`;

  modal.style.display = "flex";
}

async function _confirmarTraspaso() {
  const destino = document.getElementById("asig-destino")?.value?.trim();
  const razonSel = document.getElementById("asig-razon-sel")?.value;
  const razonTxt = document.getElementById("asig-razon-txt")?.value?.trim();
  const razon = razonSel === "Otra" ? razonTxt : razonSel;

  if (!destino) { window.toast?.("Selecciona el ingeniero destino.", "warn"); return; }
  if (!razon)   { window.toast?.("Indica la razón del traspaso.", "warn"); return; }

  const btn = document.getElementById("asig-btn-confirmar");
  if (btn) { btn.disabled = true; btn.textContent = "Procesando…"; }

  const clienteIds = [..._seleccionados];
  const origen = _selIngenieroOri === "__sin_asignar__" ? null : _selIngenieroOri;

  try {
    // Actualizar campo ingeniero en cada cliente
    for (const id of clienteIds) {
      await updateDoc(doc(db, "clientes", id), {
        ingeniero:         destino,
        ingenieroAnterior: origen,
        traspasoEn:        serverTimestamp(),
        traspasadoPor:     Sesion.alias ?? "web",
      });
    }

    // Cerrar modal y limpiar estado ANTES del log (no bloquear UI si el log falla)
    document.getElementById("asig-modal").style.display = "none";
    _seleccionados.clear();
    _filtroClientes = "";

    window.toast?.(
      `✅ ${clienteIds.length} cliente${clienteIds.length!==1?"s":""} traspasado${clienteIds.length!==1?"s":""} a ${destino}.`,
      "success"
    );

    // Registrar log en colección traspasos (best-effort)
    addDoc(collection(db, "traspasos"), {
      fecha:             serverTimestamp(),
      realizadoPor:      Sesion.alias ?? "web",
      realizadoPorUid:   Sesion.uid ?? null,
      ingenieroOrigen:   origen,
      ingenieroDestino:  destino,
      clienteIds,
      cantidadClientes:  clienteIds.length,
      razon,
      tipo: clienteIds.length === 1 ? "individual" : "masivo",
    }).catch(e => console.warn("[Asignaciones] Log traspaso:", e.message));

  } catch(e) {
    window.toast?.("Error en traspaso: " + e.message, "error");
    if (btn) { btn.disabled = false; btn.textContent = "✅ Confirmar traspaso"; }
  }
}

// ── Historial de traspasos ───────────────────────────────────
function _renderHistorial() {
  const content = document.getElementById("asig-content");
  if (!content) return;
  content.innerHTML = `
  <div style="padding:16px;height:100%;overflow-y:auto">
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <div style="padding:12px 16px;border-bottom:1px solid var(--border);
        display:flex;align-items:center;gap:10px">
        <span style="font-size:13px;font-weight:700;color:var(--text-primary)">Historial de traspasos</span>
        <span style="font-size:11px;color:var(--text-sec)" id="asig-hist-count"></span>
      </div>
      <div id="asig-hist-body" style="overflow-x:auto">
        <div style="padding:20px;text-align:center;color:var(--text-sec);font-size:13px">Cargando…</div>
      </div>
    </div>
  </div>`;
  _cargarHistorial();
}

async function _cargarHistorial() {
  const body = document.getElementById("asig-hist-body");
  const count = document.getElementById("asig-hist-count");
  if (!body) return;

  _unsubTraspasos?.();
  _unsubTraspasos = onSnapshot(
    query(collection(db, "traspasos"), orderBy("fecha", "desc"), limit(200)),
    snap => {
      const traspasos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (count) count.textContent = `${traspasos.length} registro${traspasos.length!==1?"s":""}`;
      if (!traspasos.length) {
        body.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-sec);font-size:13px">
          Sin traspasos registrados todavía.</div>`;
        return;
      }
      body.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:var(--surface-2);border-bottom:1px solid var(--border)">
            <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text-sec)">Fecha</th>
            <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text-sec)">Por</th>
            <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text-sec)">Origen</th>
            <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text-sec)">Destino</th>
            <th style="padding:10px 14px;text-align:center;font-weight:700;color:var(--text-sec)"># Clientes</th>
            <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text-sec)">Razón</th>
            <th style="padding:10px 14px;text-align:center;font-weight:700;color:var(--text-sec)">Tipo</th>
          </tr>
        </thead>
        <tbody>
          ${traspasos.map((t, i) => `
          <tr style="border-bottom:1px solid var(--border);
            ${i%2===1?"background:var(--surface-2)":""}">
            <td style="padding:10px 14px;color:var(--text-sec);white-space:nowrap">${fmtDt(t.fecha)}</td>
            <td style="padding:10px 14px;font-weight:600;color:var(--text-primary)">${esc(t.realizadoPor||"—")}</td>
            <td style="padding:10px 14px;color:#D97706">${esc(t.ingenieroOrigen||"Sin asignar")}</td>
            <td style="padding:10px 14px;color:var(--blue,#2563EB);font-weight:700">${esc(t.ingenieroDestino||"—")}</td>
            <td style="padding:10px 14px;text-align:center">
              <span style="font-size:13px;font-weight:800;color:var(--text-primary)">${t.cantidadClientes||t.clienteIds?.length||0}</span>
            </td>
            <td style="padding:10px 14px;color:var(--text-sec)">${esc(t.razon||"—")}</td>
            <td style="padding:10px 14px;text-align:center">
              <span style="font-size:10px;padding:2px 8px;border-radius:9px;font-weight:700;
                background:${t.tipo==="masivo"?"#EDE9FE":"#ECFDF5"};
                color:${t.tipo==="masivo"?"#7C3AED":"#15803D"}">
                ${t.tipo||"individual"}
              </span>
            </td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    },
    err => {
      console.error("[Asignaciones] historial:", err);
      if (body) body.innerHTML = `<div style="padding:32px;text-align:center;color:#DC2626;font-size:13px">
        Error al cargar historial: ${esc(err.message)}.<br>
        <small style="color:var(--text-sec)">Verifica las reglas de Firestore para la colección "traspasos".</small>
      </div>`;
    }
  );
}
