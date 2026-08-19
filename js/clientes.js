// ══════════════════════════════════════════════════════════════
// clientes.js — Directorio de clientes con KPIs, búsqueda y ficha detalle
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { esc } from "./app.js";
import {
  collection, query, orderBy, onSnapshot,
  doc, updateDoc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { exportarExcel } from "./excel-utils.js";

// ── Columnas Excel ────────────────────────────────────────────
const _COLS = [
  { key: "nombre",       header: "Nombre",           width: 30, required: true },
  { key: "telefono",     header: "Teléfono",         width: 16 },
  { key: "direccion",    header: "Dirección",        width: 36 },
  { key: "colonia",      header: "Colonia",          width: 20 },
  { key: "ciudad",       header: "Ciudad",           width: 18 },
  { key: "segmento",     header: "Segmento",         width: 16 },
  { key: "saldo",        header: "Saldo ($)",        width: 14, tipo: "numero" },
  { key: "ingeniero",    header: "Ingeniero asig.",  width: 18 },
  { key: "zona",         header: "Zona",             width: 14 },
  { key: "ultimaVisita", header: "Última visita",    width: 18, fmt: "fecha" },
  { key: "activo",       header: "Activo",           width: 10 },
];

const fmt   = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const fmtDt = d => {
  if (!d) return "—";
  try { return new Date(d?.toDate?.() ?? d).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return "—"; }
};

let _unsub      = null;
let _clientes   = [];
let _filtrados  = [];

// ── Filtros activos ───────────────────────────────────────────
let _fBusqueda  = "";
let _fSegmento  = "TODOS";
let _fIngeniero = "TODOS";
let _fEstado    = "TODOS";   // TODOS | activos | inactivos
let _fSaldo     = "TODOS";   // TODOS | con_saldo | sin_saldo

let _detalleId  = null;

// ── Módulo exportado ──────────────────────────────────────────
export const ClientesModule = {
  mount(container) {
    container.innerHTML = _html();
    document.getElementById("cli-tbody").innerHTML = window.skeleton?.(5, 7) ?? "";
    _bindUI();
    _escuchar();
    return () => this.destroy();
  },
  destroy() {
    _unsub?.();
    _unsub = null;
    _clientes = [];
    _filtrados = [];
    _fBusqueda = ""; _fSegmento = "TODOS"; _fIngeniero = "TODOS";
    _fEstado = "TODOS"; _fSaldo = "TODOS"; _detalleId = null;
  }
};

// ── HTML ──────────────────────────────────────────────────────
function _html() {
  return `
  <div style="padding:0 0 24px">

    <!-- KPIs -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:14px">
      ${_kpi("cli-k-total",  "CLIENTES")}
      ${_kpi("cli-k-activos","ACTIVOS")}
      ${_kpi("cli-k-saldo",  "SALDO TOTAL")}
      ${_kpi("cli-k-visita", "CON VISITA HOY")}
      ${_kpi("cli-k-segs",   "SEGMENTOS")}
    </div>

    <!-- Barra de controles -->
    <div style="background:var(--c-surface,#fff);border-radius:10px;border:1px solid var(--c-border,#E5E7EB);
      padding:12px 16px;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
      box-shadow:0 1px 3px rgba(0,0,0,.06)">

      <!-- Búsqueda -->
      <div style="position:relative;flex:1;min-width:180px">
        <span style="position:absolute;left:9px;top:50%;transform:translateY(-50%);
          font-size:13px;color:#9CA3AF;pointer-events:none">🔍</span>
        <input id="cli-search" type="text" placeholder="Buscar nombre, teléfono, dirección…"
          oninput="ClientesUI.buscar(this.value)"
          style="width:100%;padding:7px 10px 7px 30px;border:1px solid var(--c-border,#D1D5DB);
            border-radius:6px;font-size:12px;background:var(--c-surface,#fff);
            color:var(--c-text,#111);box-sizing:border-box">
      </div>

      <!-- Segmento -->
      <select id="cli-sel-seg" onchange="ClientesUI.setSegmento(this.value)"
        style="border:1px solid var(--c-border,#D1D5DB);border-radius:6px;padding:6px 8px;
          font-size:12px;background:var(--c-surface,#fff);color:var(--c-text,#111)">
        <option value="TODOS">Todos los segmentos</option>
      </select>

      <!-- Ingeniero -->
      <select id="cli-sel-ing" onchange="ClientesUI.setIngeniero(this.value)"
        style="border:1px solid var(--c-border,#D1D5DB);border-radius:6px;padding:6px 8px;
          font-size:12px;background:var(--c-surface,#fff);color:var(--c-text,#111)">
        <option value="TODOS">Todos los ingenieros</option>
      </select>

      <!-- Estado -->
      <select id="cli-sel-estado" onchange="ClientesUI.setEstado(this.value)"
        style="border:1px solid var(--c-border,#D1D5DB);border-radius:6px;padding:6px 8px;
          font-size:12px;background:var(--c-surface,#fff);color:var(--c-text,#111)">
        <option value="TODOS">Activos e inactivos</option>
        <option value="activos">Solo activos</option>
        <option value="inactivos">Solo inactivos</option>
      </select>

      <!-- Saldo -->
      <select id="cli-sel-saldo" onchange="ClientesUI.setSaldo(this.value)"
        style="border:1px solid var(--c-border,#D1D5DB);border-radius:6px;padding:6px 8px;
          font-size:12px;background:var(--c-surface,#fff);color:var(--c-text,#111)">
        <option value="TODOS">Con y sin saldo</option>
        <option value="con_saldo">Con saldo pendiente</option>
        <option value="sin_saldo">Sin saldo</option>
      </select>

      <!-- Exportar -->
      <button onclick="ClientesUI.exportar()"
        style="padding:6px 14px;border:1px solid #D1D5DB;border-radius:6px;background:transparent;
          color:var(--c-text,#374151);font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">
        ⬇ Excel
      </button>

      <!-- Contador -->
      <span id="cli-count-txt"
        style="font-size:11px;color:#6B7280;white-space:nowrap;margin-left:auto"></span>
    </div>

    <!-- Tabla -->
    <div style="background:var(--c-surface,#fff);border-radius:10px;border:1px solid var(--c-border,#E5E7EB);
      overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px" id="cli-table">
          <thead>
            <tr style="background:var(--c-surface2,#F9FAFB);border-bottom:1px solid var(--c-border,#E5E7EB)">
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:#374151;white-space:nowrap">CLIENTE</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:#374151;white-space:nowrap">SEGMENTO</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:#374151;white-space:nowrap">INGENIERO</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:#374151;white-space:nowrap">ZONA</th>
              <th style="padding:10px 14px;text-align:right;font-weight:700;color:#374151;white-space:nowrap">SALDO</th>
              <th style="padding:10px 14px;text-align:center;font-weight:700;color:#374151;white-space:nowrap">ÚLTIMA VISITA</th>
              <th style="padding:10px 14px;text-align:center;font-weight:700;color:#374151;white-space:nowrap">ESTADO</th>
              <th style="padding:10px 14px;text-align:center;font-weight:700;color:#374151"></th>
            </tr>
          </thead>
          <tbody id="cli-tbody">
            <tr><td colspan="8" style="padding:32px;text-align:center;color:#9CA3AF">Cargando clientes…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ── Modal detalle ── -->
  <div id="cli-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);
    z-index:1000;align-items:center;justify-content:center;padding:16px">
    <div style="background:var(--c-surface,#fff);border-radius:16px;width:520px;max-width:100%;
      max-height:90vh;overflow-y:auto;border:1px solid var(--c-border,#E5E7EB);
      box-shadow:0 8px 32px rgba(0,0,0,.18)">
      <div id="cli-modal-body" style="padding:24px"></div>
    </div>
  </div>`;
}

function _kpi(id, label) {
  return `<div style="background:var(--c-surface,#fff);border-radius:10px;border:1px solid var(--c-border,#E5E7EB);
    padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.06)">
    <div style="font-size:20px;font-weight:800;color:var(--c-text,#111827)" id="${id}">–</div>
    <div style="font-size:11px;font-weight:600;color:#6B7280;margin-top:2px">${label}</div>
  </div>`;
}

// ── Bind UI ───────────────────────────────────────────────────
function _bindUI() {
  window.ClientesUI = {
    buscar(v)      { _fBusqueda = v.toLowerCase(); _applyFilters(); },
    setSegmento(v) { _fSegmento = v; _applyFilters(); },
    setIngeniero(v){ _fIngeniero = v; _applyFilters(); },
    setEstado(v)   { _fEstado = v; _applyFilters(); },
    setSaldo(v)    { _fSaldo = v; _applyFilters(); },

    exportar() {
      if (!_filtrados.length) { window.toast?.("No hay clientes para exportar.", "info"); return; }
      exportarExcel(_filtrados, _COLS, "Clientes", "Clientes");
    },

    abrirDetalle(id) { _abrirDetalle(id); },

    cerrarDetalle() {
      document.getElementById("cli-modal").style.display = "none";
      _detalleId = null;
    },

    async guardarNota() {
      const nota = document.getElementById("cli-det-nota")?.value?.trim() ?? "";
      if (!_detalleId) return;
      const btn = document.getElementById("cli-det-guardar");
      if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
      try {
        await updateDoc(doc(db, "clientes", _detalleId), {
          notaWeb: nota,
          notaWebActualizado: serverTimestamp(),
          notaWebPor: window.Sesion?.alias ?? "web"
        });
        window.toast?.("Nota guardada.", "success");
        document.getElementById("cli-modal").style.display = "none";
        _detalleId = null;
      } catch(e) {
        window.toast?.("Error al guardar nota: " + e.message, "error");
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Guardar nota"; }
      }
    }
  };

  // Cerrar modal al hacer clic en fondo
  document.getElementById("cli-modal")?.addEventListener("click", e => {
    if (e.target.id === "cli-modal") window.ClientesUI.cerrarDetalle();
  });
}

// ── Firestore listener ────────────────────────────────────────
function _escuchar() {
  _unsub = onSnapshot(
    query(collection(db, "clientes"), orderBy("nombre")),
    snap => {
      _clientes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _poblarFiltros();
      _applyFilters();
    },
    err => {
      console.error("[Clientes]", err);
      window.toast?.("Error al cargar clientes.", "error");
    }
  );
}

// ── Poblar selects de segmento e ingeniero ────────────────────
function _poblarFiltros() {
  const segmentos  = [...new Set(_clientes.map(c => c.segmento).filter(Boolean))].sort();
  const ingenieros = [...new Set(_clientes.map(c => c.ingeniero).filter(Boolean))].sort();

  const selSeg = document.getElementById("cli-sel-seg");
  if (selSeg) {
    const val = selSeg.value;
    selSeg.innerHTML = `<option value="TODOS">Todos los segmentos</option>` +
      segmentos.map(s => `<option value="${esc(s)}" ${val===s?"selected":""}>${esc(s)}</option>`).join("");
  }

  const selIng = document.getElementById("cli-sel-ing");
  if (selIng) {
    const val = selIng.value;
    selIng.innerHTML = `<option value="TODOS">Todos los ingenieros</option>` +
      ingenieros.map(i => `<option value="${esc(i)}" ${val===i?"selected":""}>${esc(i)}</option>`).join("");
  }
}

// ── Aplicar filtros y renderizar ──────────────────────────────
function _applyFilters() {
  let lista = [..._clientes];

  if (_fEstado === "activos")   lista = lista.filter(c => c.activo !== false);
  if (_fEstado === "inactivos") lista = lista.filter(c => c.activo === false);

  if (_fSegmento  !== "TODOS") lista = lista.filter(c => c.segmento  === _fSegmento);
  if (_fIngeniero !== "TODOS") lista = lista.filter(c => c.ingeniero === _fIngeniero);

  if (_fSaldo === "con_saldo") lista = lista.filter(c => (c.saldo ?? 0) > 0);
  if (_fSaldo === "sin_saldo") lista = lista.filter(c => !c.saldo || c.saldo === 0);

  if (_fBusqueda) {
    lista = lista.filter(c =>
      (c.nombre    ?? "").toLowerCase().includes(_fBusqueda) ||
      (c.telefono  ?? "").toLowerCase().includes(_fBusqueda) ||
      (c.direccion ?? "").toLowerCase().includes(_fBusqueda) ||
      (c.colonia   ?? "").toLowerCase().includes(_fBusqueda) ||
      (c.ciudad    ?? "").toLowerCase().includes(_fBusqueda) ||
      (c.ingeniero ?? "").toLowerCase().includes(_fBusqueda)
    );
  }

  _filtrados = lista;
  _renderKPIs();
  _renderTabla();
}

// ── KPIs ──────────────────────────────────────────────────────
function _renderKPIs() {
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const set = el => v => { const e = document.getElementById(el); if (e) e.textContent = v; };

  set("cli-k-total")(_clientes.length.toLocaleString("es-MX"));
  set("cli-k-activos")(_clientes.filter(c => c.activo !== false).length.toLocaleString("es-MX"));

  const saldoTotal = _filtrados.reduce((s, c) => s + (Number(c.saldo) || 0), 0);
  set("cli-k-saldo")(fmt.format(saldoTotal));

  const visitasHoy = _filtrados.filter(c => {
    if (!c.ultimaVisita) return false;
    try {
      const d = new Date(c.ultimaVisita?.toDate?.() ?? c.ultimaVisita);
      d.setHours(0,0,0,0);
      return d.getTime() === hoy.getTime();
    } catch { return false; }
  }).length;
  set("cli-k-visita")(visitasHoy.toLocaleString("es-MX"));

  const segs = new Set(_clientes.map(c => c.segmento).filter(Boolean)).size;
  set("cli-k-segs")(segs.toLocaleString("es-MX"));

  const cnt = document.getElementById("cli-count-txt");
  if (cnt) cnt.textContent = `${_filtrados.length} de ${_clientes.length} clientes`;
}

// ── Tabla ─────────────────────────────────────────────────────
function _renderTabla() {
  const tbody = document.getElementById("cli-tbody");
  if (!tbody) return;

  if (!_filtrados.length) {
    tbody.innerHTML = `<tr><td colspan="8"
      style="padding:32px;text-align:center;color:#9CA3AF;font-size:13px">
      Sin clientes para los filtros seleccionados.</td></tr>`;
    return;
  }

  tbody.innerHTML = _filtrados.map((c, i) => {
    const saldo  = Number(c.saldo) || 0;
    const activo = c.activo !== false;

    const saldoColor = saldo > 0 ? "#DC2626" : "#16A34A";
    const saldoTxt   = saldo > 0 ? fmt.format(saldo) : "—";

    const segBg = _segColor(c.segmento);

    return `<tr style="border-bottom:1px solid var(--c-border,#F3F4F6);
      ${i % 2 === 1 ? "background:var(--c-surface2,#FAFAFA)" : ""}
      cursor:pointer" onclick="ClientesUI.abrirDetalle('${esc(c.id)}')">
      <td style="padding:10px 14px">
        <div style="font-weight:700;font-size:12px;color:var(--c-text,#111827)">${esc(c.nombre || "—")}</div>
        ${c.telefono ? `<div style="font-size:11px;color:#6B7280">${esc(c.telefono)}</div>` : ""}
        ${c.ciudad || c.colonia ? `<div style="font-size:10px;color:#9CA3AF">${esc([c.colonia,c.ciudad].filter(Boolean).join(", "))}</div>` : ""}
      </td>
      <td style="padding:10px 14px">
        ${c.segmento
          ? `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:9px;
              background:${segBg}22;color:${segBg}">${esc(c.segmento)}</span>`
          : `<span style="color:#D1D5DB;font-size:11px">—</span>`}
      </td>
      <td style="padding:10px 14px;font-size:12px;color:var(--c-text,#374151)">${esc(c.ingeniero || "—")}</td>
      <td style="padding:10px 14px;font-size:11px;color:#6B7280">${esc(c.zona || "—")}</td>
      <td style="padding:10px 14px;text-align:right;font-size:12px;font-weight:700;color:${saldoColor}">${saldoTxt}</td>
      <td style="padding:10px 14px;text-align:center;font-size:11px;color:#6B7280">${fmtDt(c.ultimaVisita)}</td>
      <td style="padding:10px 14px;text-align:center">
        <span style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:9px;
          background:${activo?"#DCFCE7":"#F3F4F6"};color:${activo?"#16A34A":"#9CA3AF"}">
          ${activo ? "Activo" : "Inactivo"}
        </span>
      </td>
      <td style="padding:10px 14px;text-align:center">
        <span style="font-size:16px">›</span>
      </td>
    </tr>`;
  }).join("");
}

// ── Colores de segmento ───────────────────────────────────────
const _SEG_COLORS = ["#1565C0","#15803D","#7E22CE","#B45309","#0E7490","#BE123C","#475569"];
const _segCache = {};
let _segIdx = 0;
function _segColor(seg) {
  if (!seg) return "#9CA3AF";
  if (!_segCache[seg]) _segCache[seg] = _SEG_COLORS[_segIdx++ % _SEG_COLORS.length];
  return _segCache[seg];
}

// ── Detalle de cliente ────────────────────────────────────────
async function _abrirDetalle(id) {
  _detalleId = id;
  const modal = document.getElementById("cli-modal");
  const body  = document.getElementById("cli-modal-body");
  if (!modal || !body) return;

  body.innerHTML = `<div style="padding:20px;text-align:center;color:#9CA3AF">Cargando…</div>`;
  modal.style.display = "flex";

  // Buscar en caché local primero
  let c = _clientes.find(x => x.id === id);
  if (!c) {
    try {
      const snap = await getDoc(doc(db, "clientes", id));
      if (!snap.exists()) { body.innerHTML = `<p style="color:#DC2626">Cliente no encontrado.</p>`; return; }
      c = { id: snap.id, ...snap.data() };
    } catch(e) {
      body.innerHTML = `<p style="color:#DC2626">Error al cargar: ${esc(e.message)}</p>`;
      return;
    }
  }

  const saldo  = Number(c.saldo) || 0;
  const activo = c.activo !== false;
  const segCol = _segColor(c.segmento);

  body.innerHTML = `
    <!-- Header -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="width:48px;height:48px;border-radius:50%;background:${segCol}22;
          display:flex;align-items:center;justify-content:center;
          font-size:20px;font-weight:800;color:${segCol}">
          ${esc((c.nombre || "?").charAt(0).toUpperCase())}
        </div>
        <div>
          <div style="font-size:16px;font-weight:800;color:var(--c-text,#111)">${esc(c.nombre || "—")}</div>
          <div style="font-size:12px;color:#6B7280;margin-top:2px">
            ${c.segmento ? `<span style="font-weight:600;color:${segCol}">${esc(c.segmento)}</span> · ` : ""}
            <span style="font-weight:600;color:${activo?"#16A34A":"#9CA3AF"}">${activo?"Activo":"Inactivo"}</span>
          </div>
        </div>
      </div>
      <button onclick="ClientesUI.cerrarDetalle()"
        style="border:none;background:transparent;font-size:20px;cursor:pointer;
          color:#9CA3AF;padding:4px 8px;border-radius:6px">✕</button>
    </div>

    <!-- Grid de datos -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">
      ${_campo("📞 Teléfono", c.telefono)}
      ${_campo("👷 Ingeniero", c.ingeniero)}
      ${_campo("📍 Zona", c.zona)}
      ${_campo("🏙 Ciudad", [c.colonia, c.ciudad].filter(Boolean).join(", ") || null)}
      ${_campo("🏠 Dirección", c.direccion)}
      ${_campo("📅 Última visita", fmtDt(c.ultimaVisita))}
    </div>

    <!-- Saldo -->
    <div style="background:${saldo>0?"#FEF2F2":"#F0FDF4"};border:1px solid ${saldo>0?"#FECACA":"#BBF7D0"};
      border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:12px;font-weight:600;color:${saldo>0?"#DC2626":"#16A34A"}">
        ${saldo > 0 ? "⚠️ Saldo pendiente" : "✅ Sin saldo pendiente"}
      </span>
      <span style="font-size:18px;font-weight:800;color:${saldo>0?"#DC2626":"#16A34A"}">
        ${saldo > 0 ? fmt.format(saldo) : "$0.00"}
      </span>
    </div>

    <!-- Nota web -->
    <div style="margin-bottom:16px">
      <label style="font-size:11px;font-weight:700;color:#374151;display:block;margin-bottom:6px">
        📝 Nota interna (solo panel web)
      </label>
      <textarea id="cli-det-nota" rows="3" placeholder="Agrega una nota sobre este cliente…"
        style="width:100%;padding:9px 12px;border:1px solid var(--c-border,#D1D5DB);border-radius:8px;
          font-size:12px;resize:vertical;background:var(--c-surface,#fff);
          color:var(--c-text,#111);box-sizing:border-box;font-family:inherit"
      >${esc(c.notaWeb || "")}</textarea>
      ${c.notaWebActualizado
        ? `<div style="font-size:10px;color:#9CA3AF;margin-top:3px">
            Última edición: ${fmtDt(c.notaWebActualizado)} por ${esc(c.notaWebPor || "—")}
          </div>`
        : ""}
    </div>

    <!-- Acciones -->
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button onclick="ClientesUI.cerrarDetalle()"
        style="padding:8px 18px;border:1px solid var(--c-border,#D1D5DB);border-radius:6px;
          background:transparent;color:var(--c-text,#374151);font-size:12px;cursor:pointer">
        Cerrar
      </button>
      <button id="cli-det-guardar" onclick="ClientesUI.guardarNota()"
        style="padding:8px 22px;border:none;border-radius:6px;
          background:#1B5E20;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
        Guardar nota
      </button>
    </div>`;
}

function _campo(label, valor) {
  return `<div style="background:var(--c-surface2,#F9FAFB);border-radius:8px;padding:10px 12px;
    border:1px solid var(--c-border,#F3F4F6)">
    <div style="font-size:10px;font-weight:700;color:#9CA3AF;margin-bottom:3px">${label}</div>
    <div style="font-size:12px;font-weight:600;color:var(--c-text,#111)">${esc(valor) || `<span style="color:#D1D5DB">—</span>`}</div>
  </div>`;
}
