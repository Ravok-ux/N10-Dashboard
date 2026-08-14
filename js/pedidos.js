// ══════════════════════════════════════════════════════════════
// pedidos.js — Historial de pedidos con filtros y detalle
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import {
  collection, query, orderBy, limit, where, onSnapshot, doc, updateDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let _unsub    = null;
let _filtroStatus  = "TODOS";
let _filtroAlias   = "TODOS";
let _pedidos  = [];

const STATUS = ["TODOS","BORRADOR","CONFIRMADO","EN_RUTA","ENTREGADO","FACTURADO","CANCELADO"];
const STATUS_COLOR = {
  BORRADOR:   "#9E9E9E", CONFIRMADO: "#1565C0", EN_RUTA:    "#E65100",
  ENTREGADO:  "#1B5E20", FACTURADO:  "#4527A0", CANCELADO:  "#B71C1C"
};
const fmt = new Intl.NumberFormat("es-MX", { style:"currency", currency:"MXN" });
const fmtDt = d => new Date(d?.toDate?.() ?? d).toLocaleDateString("es-MX", { day:"numeric", month:"short", year:"numeric" });

export const PedidosModule = {
  mount(container) {
    container.innerHTML = _html();
    _bindUI();
    _escuchar();
    return () => this.destroy();
  },
  destroy() { _unsub?.(); _unsub = null; _pedidos = []; _filtroStatus = "TODOS"; _filtroAlias = "TODOS"; }
};

// ── HTML ──────────────────────────────────────────────────────
function _html() {
  return `
  <div style="padding:0 0 20px">

    <!-- Controles -->
    <div style="background:#fff;border-radius:10px;border:1px solid #E5E7EB;padding:12px 16px;
      margin-bottom:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
      box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <span style="font-size:12px;font-weight:700;color:#374151">Estado:</span>
      ${STATUS.map(s => `
        <button class="filter-pill ${s==="TODOS"?"active":""}" data-status="${s}"
          onclick="PedidosUI.setStatus('${s}')">
          ${s === "TODOS" ? "Todos" : s.replace(/_/g," ")}
        </button>`).join("")}
      <div style="flex:1"></div>
      <select id="pd-sel-alias" onchange="PedidosUI.setAlias(this.value)"
        style="border:1px solid #D1D5DB;border-radius:6px;padding:4px 8px;font-size:12px">
        <option value="TODOS">Todos los ingenieros</option>
      </select>
    </div>

    <!-- KPIs rápidos -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px" id="pd-kpis">
      ${["Total","Confirmados","En ruta","Entregados"].map(l =>
        `<div style="background:#fff;border-radius:10px;border:1px solid #E5E7EB;padding:14px 16px;
          box-shadow:0 1px 3px rgba(0,0,0,.06)">
          <div style="font-size:20px;font-weight:800;color:#111827" id="pd-k-${l.replace(/ /g,"")}">–</div>
          <div style="font-size:11px;font-weight:600;color:#6B7280;margin-top:2px">${l.toUpperCase()}</div>
        </div>`).join("")}
    </div>

    <!-- Tabla -->
    <div style="background:#fff;border-radius:10px;border:1px solid #E5E7EB;overflow:hidden;
      box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:#F9FAFB;border-bottom:1px solid #E5E7EB">
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:#374151">FOLIO</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:#374151">CLIENTE</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:#374151">INGENIERO</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:#374151">FECHA</th>
              <th style="padding:10px 14px;text-align:right;font-weight:700;color:#374151">TOTAL</th>
              <th style="padding:10px 14px;text-align:center;font-weight:700;color:#374151">STATUS</th>
              <th style="padding:10px 14px;text-align:center;font-weight:700;color:#374151">TIPO</th>
            </tr>
          </thead>
          <tbody id="pd-tbody">
            <tr><td colspan="7" style="padding:20px;text-align:center;color:#9CA3AF">Cargando…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

// ── UI Bind ───────────────────────────────────────────────────
function _bindUI() {
  window.PedidosUI = {
    setStatus(s) {
      _filtroStatus = s;
      document.querySelectorAll("[data-status]").forEach(b =>
        b.classList.toggle("active", b.dataset.status === s));
      _renderTabla();
    },
    setAlias(a) { _filtroAlias = a; _renderTabla(); }
  };
}

// ── Firestore listener ────────────────────────────────────────
function _escuchar() {
  const q = query(collection(db, "pedidos"), orderBy("fechaPedido", "desc"), limit(500));
  _unsub = onSnapshot(q, snap => {
    _pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Poblar selector de ingenieros
    const aliases = [...new Set(_pedidos.map(p => p.ingenieroAlias || p.vendedor || "–").filter(Boolean))].sort();
    const sel = document.getElementById("pd-sel-alias");
    if (sel) {
      const prev = sel.value;
      sel.innerHTML = `<option value="TODOS">Todos los ingenieros</option>` +
        aliases.map(a => `<option value="${a}"${a === prev ? " selected" : ""}>${a}</option>`).join("");
    }

    _renderTabla();
  }, err => {
    console.error("[Pedidos]", err);
    window.toast?.("Error al cargar pedidos.", "error");
  });
}

// ── Render ────────────────────────────────────────────────────
function _renderTabla() {
  let lista = _pedidos;
  if (_filtroStatus !== "TODOS") lista = lista.filter(p => p.status === _filtroStatus);
  if (_filtroAlias  !== "TODOS") lista = lista.filter(p => (p.ingenieroAlias || p.vendedor) === _filtroAlias);

  // KPIs
  _setText("pd-k-Total",        String(lista.length));
  _setText("pd-k-Confirmados",  String(lista.filter(p => p.status === "CONFIRMADO").length));
  _setText("pd-k-Enruta",       String(lista.filter(p => p.status === "EN_RUTA").length));
  _setText("pd-k-Entregados",   String(lista.filter(p => p.status === "ENTREGADO").length));

  const tbody = document.getElementById("pd-tbody");
  if (!tbody) return;
  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;text-align:center;color:#9CA3AF">
      Sin pedidos para este filtro.</td></tr>`;
    return;
  }
  tbody.innerHTML = lista.map(p => {
    const color = STATUS_COLOR[p.status] ?? "#9E9E9E";
    return `<tr style="border-bottom:1px solid #F3F4F6">
      <td style="padding:10px 14px;font-weight:700;font-variant-numeric:tabular-nums">${p.folio || p.id}</td>
      <td style="padding:10px 14px">${p.clienteNombre || p.clienteId || "–"}</td>
      <td style="padding:10px 14px">${p.ingenieroAlias || p.vendedor || "–"}</td>
      <td style="padding:10px 14px;color:#6B7280">${p.fechaPedido ? fmtDt(p.fechaPedido) : "–"}</td>
      <td style="padding:10px 14px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">
        ${fmt.format(p.total || 0)}</td>
      <td style="padding:10px 14px;text-align:center">
        <span style="font-size:9px;font-weight:800;padding:3px 8px;border-radius:8px;
          background:${color}1A;color:${color}">${p.status?.replace(/_/g," ") || "–"}</span></td>
      <td style="padding:10px 14px;text-align:center;color:#6B7280;font-size:11px">
        ${p.tipoVenta || "–"}</td>
    </tr>`;
  }).join("");
}

function _setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
