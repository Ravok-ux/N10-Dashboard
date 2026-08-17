// ══════════════════════════════════════════════════════════════
// remisiones.js — Cartera de crédito activa con saldos
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import {
  collection, query, orderBy, limit, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let _unsub      = null;
let _filtroStatus = "TODOS";
let _remisiones = [];

const STATUS = ["TODOS","ACTIVA","VENCIDA","LIQUIDADA"];
const STATUS_COLOR = { ACTIVA:"#1565C0", VENCIDA:"#B71C1C", LIQUIDADA:"#1B5E20", PARCIAL:"#E65100" };
const fmt    = new Intl.NumberFormat("es-MX", { style:"currency", currency:"MXN" });
const fmtDia = d => new Date(d?.toDate?.() ?? d).toLocaleDateString("es-MX", { day:"numeric", month:"short", year:"numeric" });

export const RemisionesModule = {
  mount(container) {
    container.innerHTML = _html();
    _bindUI();
    _escuchar();
    return () => this.destroy();
  },
  destroy() { _unsub?.(); _unsub = null; _remisiones = []; _filtroStatus = "TODOS"; }
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
        <button class="filter-pill ${s==="TODOS"?"active":""}" data-rst="${s}"
          onclick="RemisionesUI.setStatus('${s}')">
          ${s === "TODOS" ? "Todos" : s}
        </button>`).join("")}
    </div>

    <!-- KPIs cartera -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${[["rst-k-total","TOTAL CARTERA"],["rst-k-activas","ACTIVAS"],["rst-k-vencidas","VENCIDAS"],["rst-k-monto","SALDO TOTAL"]].map(([id,l]) =>
        `<div style="background:#fff;border-radius:10px;border:1px solid #E5E7EB;padding:14px 16px;
          box-shadow:0 1px 3px rgba(0,0,0,.06)">
          <div style="font-size:20px;font-weight:800;color:#111827" id="${id}">–</div>
          <div style="font-size:11px;font-weight:600;color:#6B7280;margin-top:2px">${l}</div>
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
              <th style="padding:10px 14px;text-align:right;font-weight:700;color:#374151">MONTO</th>
              <th style="padding:10px 14px;text-align:right;font-weight:700;color:#374151">SALDO</th>
              <th style="padding:10px 14px;text-align:center;font-weight:700;color:#374151">VENCE</th>
              <th style="padding:10px 14px;text-align:center;font-weight:700;color:#374151">STATUS</th>
            </tr>
          </thead>
          <tbody id="rst-tbody">
            <tr><td colspan="7" style="padding:20px;text-align:center;color:#9CA3AF">Cargando…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

// ── UI Bind ───────────────────────────────────────────────────
function _bindUI() {
  window.RemisionesUI = {
    setStatus(s) {
      _filtroStatus = s;
      document.querySelectorAll("[data-rst]").forEach(b =>
        b.classList.toggle("active", b.dataset.rst === s));
      _renderTabla();
    }
  };
}

// ── Firestore listener ────────────────────────────────────────
function _escuchar() {
  const q = query(collection(db, "remisiones_credito"), orderBy("fechaCreacion", "desc"), limit(500));
  _unsub = onSnapshot(q, snap => {
    _remisiones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderTabla();
  }, err => {
    console.error("[Remisiones]", err);
    window.toast?.("Error al cargar remisiones.", "error");
  });
}

// ── Render ────────────────────────────────────────────────────
function _renderTabla() {
  const hoy = Date.now();
  let lista = _remisiones.map(r => {
    const saldo = (r.montoTotal || 0) - (r.totalAbonado || 0);
    const venceTs = r.fechaVencimiento?.toDate?.()?.getTime() ?? 0;
    const status = saldo <= 0 ? "LIQUIDADA" : venceTs < hoy ? "VENCIDA" : "ACTIVA";
    return { ...r, saldo, status };
  });

  if (_filtroStatus !== "TODOS") lista = lista.filter(r => r.status === _filtroStatus);

  // KPIs
  const todas   = _remisiones.length;
  const activas = _remisiones.filter(r => {
    const saldo = (r.montoTotal || 0) - (r.totalAbonado || 0);
    const venceTs = r.fechaVencimiento?.toDate?.()?.getTime() ?? 0;
    return saldo > 0 && venceTs >= hoy;
  }).length;
  const vencidas = _remisiones.filter(r => {
    const saldo = (r.montoTotal || 0) - (r.totalAbonado || 0);
    const venceTs = r.fechaVencimiento?.toDate?.()?.getTime() ?? 0;
    return saldo > 0 && venceTs < hoy;
  }).length;
  const saldoTotal = _remisiones.reduce((s, r) => s + Math.max(0, (r.montoTotal || 0) - (r.totalAbonado || 0)), 0);

  _setText("rst-k-total",   String(todas));
  _setText("rst-k-activas", String(activas));
  _setText("rst-k-vencidas",String(vencidas));
  _setText("rst-k-monto",   fmt.format(saldoTotal));

  const tbody = document.getElementById("rst-tbody");
  if (!tbody) return;
  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;text-align:center;color:#9CA3AF">
      Sin remisiones para este filtro.</td></tr>`;
    return;
  }
  const esc = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  tbody.innerHTML = lista.map(r => {
    const color = STATUS_COLOR[r.status] ?? "#9E9E9E";
    const venceStr = r.fechaVencimiento ? fmtDia(r.fechaVencimiento) : "–";
    const saldoColor = r.status === "VENCIDA" ? "#B71C1C" : r.status === "LIQUIDADA" ? "#1B5E20" : "#111827";
    return `<tr style="border-bottom:1px solid #F3F4F6">
      <td style="padding:10px 14px;font-weight:700">${esc(r.folio || r.remisionNumero || r.id)}</td>
      <td style="padding:10px 14px">${esc(r.clienteNombre || r.clienteId || "–")}</td>
      <td style="padding:10px 14px">${esc(r.ingenieroAlias || "–")}</td>
      <td style="padding:10px 14px;text-align:right;font-variant-numeric:tabular-nums">
        ${fmt.format(r.montoTotal || 0)}</td>
      <td style="padding:10px 14px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;color:${saldoColor}">
        ${fmt.format(r.saldo)}</td>
      <td style="padding:10px 14px;text-align:center;color:#6B7280">${venceStr}</td>
      <td style="padding:10px 14px;text-align:center">
        <span style="font-size:9px;font-weight:800;padding:3px 8px;border-radius:8px;
          background:${color}1A;color:${color}">${esc(r.status)}</span></td>
    </tr>`;
  }).join("");
}

function _setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
