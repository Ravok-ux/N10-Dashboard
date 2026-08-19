// ══════════════════════════════════════════════════════════════
// visitas.js — Programación automática + solicitudes atemporales
// ══════════════════════════════════════════════════════════════

import { db }    from "./firebase-config.js";
import { Sesion } from "./auth.js";
import { esc }   from "./app.js";
import {
  collection, query, orderBy, onSnapshot, where,
  doc, getDoc, updateDoc, addDoc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const fmtDt = ts => {
  if (!ts) return "—";
  const d = ts?.toDate?.() ?? new Date(ts);
  return d.toLocaleDateString("es-MX", { weekday:"short", day:"numeric", month:"short" });
};
const fmtDtLong = ts => {
  if (!ts) return "—";
  const d = ts?.toDate?.() ?? new Date(ts);
  return d.toLocaleDateString("es-MX", { day:"numeric", month:"long", year:"numeric" });
};
const diasHastaTs = ts => {
  if (!ts) return null;
  const d = ts?.toDate?.() ?? new Date(ts);
  return Math.ceil((d - new Date()) / 86400000);
};

let _unsubSol  = null;
let _unsubCli  = null;
let _solicitudes = [];
let _clientes    = [];
let _tabActiva   = "calendario"; // calendario | solicitudes

const _puedeAutorizar = () =>
  Sesion.esSuperAdmin() ||
  ["GERENTE","GERENTE_ZONA","MESA_CONTROL"].includes(Sesion.rol) ||
  Sesion.flags?.PUEDE_AUTORIZAR_VISITAS === true;

// ── Módulo exportado ──────────────────────────────────────────
export const VisitasModule = {
  mount(container) {
    container.innerHTML = _html();
    _bindUI(container);
    _escucharSolicitudes();
    _escucharClientes();
    return () => this.destroy();
  },
  destroy() {
    _unsubSol?.(); _unsubSol = null;
    _unsubCli?.(); _unsubCli = null;
    _solicitudes = [];
    _clientes    = [];
  }
};

// ── HTML base ─────────────────────────────────────────────────
function _html() {
  return `
  <div style="padding:0 0 24px">

    <div style="display:flex;gap:4px;margin-bottom:16px;border-bottom:2px solid var(--border)">
      <button class="vis-tab active" data-tab="calendario" style="${_tabStyle(true)}">📅 Calendario de visitas</button>
      <button class="vis-tab" data-tab="solicitudes" style="${_tabStyle(false)}">
        📋 Solicitudes atemporales
        <span id="vis-badge-sol" style="display:none;background:#EF4444;color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;margin-left:4px">0</span>
      </button>
    </div>

    <!-- Panel Calendario -->
    <div id="vis-panel-calendario">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        <input id="vis-search" type="text" placeholder="🔍 Buscar cliente o ingeniero…"
          style="flex:1;min-width:200px;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text);font-size:13px">
        <select id="vis-filter-freq" style="padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text);font-size:13px">
          <option value="TODOS">Todas las frecuencias</option>
          <option value="VENCE_HOY">⚠️ Visita hoy o vencida</option>
          <option value="ESTA_SEMANA">📅 Esta semana</option>
          <option value="SIN_VISITA">❌ Sin programar</option>
        </select>
      </div>
      <div style="overflow-x:auto">
        <table id="vis-tabla-cal" style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:var(--bg2);text-align:left">
              <th style="padding:8px 10px">Cliente</th>
              <th style="padding:8px 10px">Ingeniero</th>
              <th style="padding:8px 10px;text-align:center">Frecuencia</th>
              <th style="padding:8px 10px;text-align:center">Última visita</th>
              <th style="padding:8px 10px;text-align:center">Próxima visita</th>
              <th style="padding:8px 10px;text-align:center">Estado</th>
            </tr>
          </thead>
          <tbody id="vis-tbody-cal">${window.skeleton?.(8, 6) ?? ""}</tbody>
        </table>
      </div>
    </div>

    <!-- Panel Solicitudes -->
    <div id="vis-panel-solicitudes" style="display:none">
      <div id="vis-solicitudes-content">
        <div class="skeleton" style="height:60px;border-radius:8px;margin-bottom:8px"></div>
        <div class="skeleton" style="height:60px;border-radius:8px;margin-bottom:8px"></div>
      </div>
    </div>

  </div>`;
}

function _tabStyle(active) {
  return `padding:8px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:${active?"700":"400"};
    color:${active?"var(--accent)":"var(--text2)"};border-bottom:${active?"2px solid var(--accent)":"2px solid transparent"};margin-bottom:-2px`;
}

// ── Escuchas ──────────────────────────────────────────────────
function _escucharSolicitudes() {
  _unsubSol = onSnapshot(
    query(collection(db, "solicitudes_visita"), orderBy("creadaEn", "desc")),
    snap => {
      _solicitudes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const pendientes = _solicitudes.filter(s => s.status === "PENDIENTE").length;
      const badge = document.getElementById("vis-badge-sol");
      if (badge) {
        badge.textContent = pendientes;
        badge.style.display = pendientes > 0 ? "" : "none";
      }
      _renderSolicitudes();
    }
  );
}

function _escucharClientes() {
  _unsubCli = onSnapshot(
    query(collection(db, "clientes"), orderBy("proximaVisita", "asc")),
    snap => {
      _clientes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _renderCalendario();
    }
  );
}

// ── Render calendario ─────────────────────────────────────────
function _renderCalendario() {
  const tbody = document.getElementById("vis-tbody-cal");
  if (!tbody) return;
  const q    = (document.getElementById("vis-search")?.value || "").toLowerCase();
  const fil  = document.getElementById("vis-filter-freq")?.value || "TODOS";
  const hoy  = new Date(); hoy.setHours(0,0,0,0);
  const en7  = new Date(hoy); en7.setDate(en7.getDate() + 7);

  let lista = _clientes.filter(c => {
    if (q && !(c.nombre||"").toLowerCase().includes(q) && !(c.vendedor||"").toLowerCase().includes(q)) return false;
    if (fil === "VENCE_HOY") {
      const pv = c.proximaVisita?.toDate?.() ?? (c.proximaVisita ? new Date(c.proximaVisita) : null);
      return pv && pv <= hoy;
    }
    if (fil === "ESTA_SEMANA") {
      const pv = c.proximaVisita?.toDate?.() ?? (c.proximaVisita ? new Date(c.proximaVisita) : null);
      return pv && pv >= hoy && pv <= en7;
    }
    if (fil === "SIN_VISITA") return !c.proximaVisita && !c.frecuenciaVisitaId;
    return true;
  });

  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text2)">Sin clientes que mostrar</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.slice(0, 100).map(c => {
    const pv   = c.proximaVisita?.toDate?.() ?? (c.proximaVisita ? new Date(c.proximaVisita) : null);
    const uv   = c.fechaUltimaVisita ? (c.fechaUltimaVisita?.toDate?.() ?? new Date(c.fechaUltimaVisita)) : null;
    const dias = pv ? Math.ceil((pv - new Date()) / 86400000) : null;

    let estadoChip = "";
    if (dias === null)      estadoChip = `<span style="color:var(--text2);font-size:11px">Sin programar</span>`;
    else if (dias < 0)      estadoChip = `<span style="padding:2px 8px;background:#FEE2E2;color:#991B1B;border-radius:12px;font-size:11px">⚠️ Vencida hace ${-dias}d</span>`;
    else if (dias === 0)    estadoChip = `<span style="padding:2px 8px;background:#FEF9C3;color:#854D0E;border-radius:12px;font-size:11px">🔔 Hoy</span>`;
    else if (dias <= 3)     estadoChip = `<span style="padding:2px 8px;background:#FFEDD5;color:#9A3412;border-radius:12px;font-size:11px">📅 En ${dias}d</span>`;
    else                    estadoChip = `<span style="padding:2px 8px;background:#DCFCE7;color:#166534;border-radius:12px;font-size:11px">✓ En ${dias}d</span>`;

    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:9px 10px;font-weight:600">${esc(c.nombre || c.id)}</td>
      <td style="padding:9px 10px;color:var(--text2)">${esc(c.vendedor || "—")}</td>
      <td style="padding:9px 10px;text-align:center;font-size:12px">${esc(c.frecuenciaVisitaLabel || c.frecuenciaVisita || "—")}</td>
      <td style="padding:9px 10px;text-align:center;font-size:12px;color:var(--text2)">${uv ? uv.toLocaleDateString("es-MX",{day:"numeric",month:"short"}) : "Nunca"}</td>
      <td style="padding:9px 10px;text-align:center;font-size:12px">${pv ? fmtDtLong(pv) : "—"}</td>
      <td style="padding:9px 10px;text-align:center">${estadoChip}</td>
    </tr>`;
  }).join("");
}

// ── Render solicitudes ────────────────────────────────────────
function _renderSolicitudes() {
  const el = document.getElementById("vis-solicitudes-content");
  if (!el) return;
  const puedeAut = _puedeAutorizar();

  if (_solicitudes.length === 0) {
    el.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text2)">Sin solicitudes de visita atemporal</div>`;
    return;
  }

  el.innerHTML = _solicitudes.map(s => {
    const statusColor = { PENDIENTE:"#FEF9C3;color:#854D0E", APROBADA:"#DCFCE7;color:#166534", RECHAZADA:"#FEE2E2;color:#991B1B" }[s.status] || "#F3F4F6;color:#374151";
    const acciones = s.status === "PENDIENTE" && puedeAut ? `
      <button onclick="VisitasUI.aprobar('${s.id}')" style="padding:4px 10px;background:#DCFCE7;color:#166534;border:none;border-radius:4px;cursor:pointer;font-size:12px">✓ Aprobar</button>
      <button onclick="VisitasUI.rechazar('${s.id}')" style="padding:4px 10px;background:#FEE2E2;color:#991B1B;border:none;border-radius:4px;cursor:pointer;font-size:12px">✕ Rechazar</button>` : "";

    return `<div style="background:var(--bg2);border-radius:8px;padding:14px 16px;margin-bottom:8px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
      <div>
        <div style="font-weight:600;margin-bottom:2px">${esc(s.clienteNombre || "—")}</div>
        <div style="font-size:12px;color:var(--text2)">Solicitado por <b>${esc(s.solicitadoPor||"—")}</b> · ${fmtDtLong(s.creadaEn)}</div>
        ${s.motivo ? `<div style="font-size:12px;margin-top:4px;color:var(--text2)">Motivo: ${esc(s.motivo)}</div>` : ""}
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="padding:3px 10px;background:${statusColor};border-radius:12px;font-size:11px;font-weight:600;white-space:nowrap">${s.status}</span>
        ${acciones}
      </div>
    </div>`;
  }).join("");
}

// ── Bind UI ───────────────────────────────────────────────────
function _bindUI(container) {
  container.addEventListener("click", e => {
    const tab = e.target.closest(".vis-tab");
    if (tab) _cambiarTab(tab.dataset.tab, container);
  });
  container.addEventListener("input", e => {
    if (e.target.id === "vis-search" || e.target.id === "vis-filter-freq") _renderCalendario();
  });
  container.addEventListener("change", e => {
    if (e.target.id === "vis-filter-freq") _renderCalendario();
  });

  window.VisitasUI = {
    aprobar:  async (id) => _resolverSolicitud(id, "APROBADA"),
    rechazar: async (id) => _resolverSolicitud(id, "RECHAZADA"),
  };
}

function _cambiarTab(tab, container) {
  _tabActiva = tab;
  container.querySelectorAll(".vis-tab").forEach(b => {
    const active = b.dataset.tab === tab;
    b.style.fontWeight   = active ? "700" : "400";
    b.style.color        = active ? "var(--accent)" : "var(--text2)";
    b.style.borderBottom = active ? "2px solid var(--accent)" : "2px solid transparent";
  });
  document.getElementById("vis-panel-calendario").style.display  = tab === "calendario"   ? "" : "none";
  document.getElementById("vis-panel-solicitudes").style.display = tab === "solicitudes"  ? "" : "none";
  if (tab === "solicitudes") _renderSolicitudes();
}

async function _resolverSolicitud(id, nuevoStatus) {
  const accion = nuevoStatus === "APROBADA" ? "¿Aprobar esta solicitud de visita?" : "¿Rechazar esta solicitud de visita?";
  if (!await window.modal({ title: nuevoStatus === "APROBADA" ? "Aprobar solicitud" : "Rechazar solicitud", message: accion })) return;
  try {
    await updateDoc(doc(db, "solicitudes_visita", id), {
      status:         nuevoStatus,
      resueltaPor:    Sesion.alias,
      resueltaEn:     serverTimestamp()
    });
    toast?.(`✅ Solicitud ${nuevoStatus.toLowerCase()}`, "success");
  } catch (e) { toast?.("❌ " + e.message, "error"); }
}
