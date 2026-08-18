// ══════════════════════════════════════════════════════════════
// cobranza.js — Abonos registrados y resumen de cobro por ingeniero
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import { esc } from "./app.js";
import {
  collection, query, orderBy, limit, where, onSnapshot, Timestamp,
  doc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let _unsub      = null;
let _abonos     = [];
let _filtroPeriodo = "semana";
let _filtroAlias   = "TODOS";

const fmt    = new Intl.NumberFormat("es-MX", { style:"currency", currency:"MXN" });
const fmtDt  = d => new Date(d?.toDate?.() ?? d).toLocaleDateString("es-MX", { day:"numeric", month:"short" });

export const CobranzaModule = {
  mount(container) {
    container.innerHTML = _html();
    document.getElementById("cob-tbody").innerHTML = window.skeleton?.(5, 7) ?? "";
    _bindUI();
    _escuchar();
    return () => this.destroy();
  },
  destroy() { _unsub?.(); _unsub = null; _abonos = []; _filtroPeriodo = "semana"; _filtroAlias = "TODOS"; }
};

// ── HTML ──────────────────────────────────────────────────────
function _html() {
  return `
  <div style="padding:0 0 20px">

    <!-- Controles -->
    <div style="background:var(--surface,#fff);border-radius:10px;border:1px solid var(--border,#E5E7EB);padding:12px 16px;
      margin-bottom:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
      box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <span style="font-size:12px;font-weight:700;color:var(--text,#374151)">Período:</span>
      ${["hoy","semana","mes"].map(p => `
        <button class="filter-pill ${p==="semana"?"active":""}" data-cob-p="${p}"
          onclick="CobranzaUI.setPeriodo('${p}')">
          ${{hoy:"Hoy",semana:"Esta semana",mes:"Este mes"}[p]}
        </button>`).join("")}
      <div style="flex:1"></div>
      <select id="cob-sel-alias" onchange="CobranzaUI.setAlias(this.value)"
        style="border:1px solid #D1D5DB;border-radius:6px;padding:4px 8px;font-size:12px">
        <option value="TODOS">Todos los recuperadores</option>
      </select>
    </div>

    <!-- KPIs cobranza -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
      ${[["cob-k-abonos","ABONOS"],["cob-k-total","COBRADO"],["cob-k-prom","PROMEDIO"],["cob-k-ingenieros","RECUPERADORES"]].map(([id,l]) =>
        `<div style="background:var(--surface,#fff);border-radius:10px;border:1px solid var(--border,#E5E7EB);padding:14px 16px;
          box-shadow:0 1px 3px rgba(0,0,0,.06)">
          <div style="font-size:20px;font-weight:800;color:#111827" id="${id}">–</div>
          <div style="font-size:11px;font-weight:600;color:#6B7280;margin-top:2px">${l}</div>
        </div>`).join("")}
    </div>

    <!-- Ranking por recuperador -->
    <div style="background:var(--surface,#fff);border-radius:10px;border:1px solid var(--border,#E5E7EB);padding:16px;
      margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <div style="font-size:11px;font-weight:700;color:var(--text,#374151);text-transform:uppercase;
        letter-spacing:.05em;margin-bottom:10px">Ranking de cobranza</div>
      <div id="cob-ranking"></div>
    </div>

    <!-- Tabla de abonos -->
    <div style="background:var(--surface,#fff);border-radius:10px;border:1px solid var(--border,#E5E7EB);overflow:hidden;
      box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:var(--surface2,#F9FAFB);border-bottom:1px solid var(--border,#E5E7EB)">
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text,#374151)">FECHA</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text,#374151)">CLIENTE</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text,#374151)">RECUPERADOR</th>
              <th style="padding:10px 14px;text-align:right;font-weight:700;color:var(--text,#374151)">MONTO</th>
              <th style="padding:10px 14px;text-align:center;font-weight:700;color:var(--text,#374151)">FORMA DE PAGO</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text,#374151)">REMISIÓN</th>
              <th style="padding:10px 14px;text-align:center;font-weight:700;color:var(--text,#374151)">CONCILIAR</th>
            </tr>
          </thead>
          <tbody id="cob-tbody">
            <tr><td colspan="6" style="padding:20px;text-align:center;color:#9CA3AF">Cargando…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

// ── Conciliar abono ───────────────────────────────────────────
async function _conciliarAbono(id) {
  try {
    await updateDoc(doc(db, "abonos_remision", id), {
      confirmado:        true,
      fechaConfirmacion: Date.now(),
      confirmadoPor:     Sesion.alias || Sesion.uid || "–"
    });
    window.toast?.("Abono conciliado correctamente", "success");
  } catch(e) {
    console.error("[Cobranza] conciliar:", e);
    window.toast?.("Error: " + e.message, "error");
  }
}

// ── UI Bind ───────────────────────────────────────────────────
function _bindUI() {
  window._cobConc = _conciliarAbono;
  window.CobranzaUI = {
    setPeriodo(p) {
      _filtroPeriodo = p;
      document.querySelectorAll("[data-cob-p]").forEach(b =>
        b.classList.toggle("active", b.dataset.cobP === p));
      _renderTabla();
    },
    setAlias(a) { _filtroAlias = a; _renderTabla(); }
  };
}

// ── Firestore listener ────────────────────────────────────────
function _escuchar() {
  const q = query(collection(db, "abonos_remision"), orderBy("fecha", "desc"), limit(500));
  _unsub = onSnapshot(q, snap => {
    _abonos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const aliases = [...new Set(_abonos.map(a => a.quienRegistro || a.alias || "–").filter(Boolean))].sort();
    const sel = document.getElementById("cob-sel-alias");
    if (sel) {
      const prev = sel.value;
      sel.innerHTML = `<option value="TODOS">Todos los recuperadores</option>` +
        aliases.map(a => `<option value="${esc(a)}"${a === prev ? " selected":""}>${esc(a)}</option>`).join("");
    }

    _renderTabla();
  }, err => {
    console.error("[Cobranza]", err);
    if (!window.manejarErrorFirestore?.(err)) {
      window.toast?.("Error al cargar cobranza.", "error");
    }
  });
}

// ── Render ────────────────────────────────────────────────────
function _renderTabla() {
  const { desde } = _rango();
  let lista = _abonos.filter(a => {
    const ts = a.fecha?.toDate?.()?.getTime() ?? (typeof a.fecha === "number" ? a.fecha : 0);
    return ts >= desde;
  });
  if (_filtroAlias !== "TODOS") lista = lista.filter(a => (a.quienRegistro || a.alias) === _filtroAlias);

  // KPIs
  const totalCobrado = lista.reduce((s, a) => s + (a.monto || 0), 0);
  const recuperadores = new Set(lista.map(a => a.quienRegistro || a.alias).filter(Boolean));
  _setText("cob-k-abonos",     String(lista.length));
  _setText("cob-k-total",      fmt.format(totalCobrado));
  _setText("cob-k-prom",       lista.length ? fmt.format(totalCobrado / lista.length) : "$–");
  _setText("cob-k-ingenieros", String(recuperadores.size));

  // Ranking
  const rankingEl = document.getElementById("cob-ranking");
  if (rankingEl) {
    const por = {};
    lista.forEach(a => {
      const alias = a.quienRegistro || a.alias || "–";
      por[alias] = (por[alias] || 0) + (a.monto || 0);
    });
    const ranked = Object.entries(por).sort((a, b) => b[1] - a[1]);
    const maxVal = ranked[0]?.[1] || 1;
    rankingEl.innerHTML = ranked.length
      ? ranked.map(([alias, monto], i) => {
          const pct = Math.round((monto / maxVal) * 100);
          return `<div style="margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
              <span style="font-weight:600">${i+1}. ${esc(alias)}</span>
              <span style="font-weight:700;font-variant-numeric:tabular-nums">${fmt.format(monto)}</span>
            </div>
            <div style="height:5px;background:#E5E7EB;border-radius:3px">
              <div style="height:100%;border-radius:3px;width:${pct}%;background:#16A34A"></div>
            </div>
          </div>`;
        }).join("")
      : `<div style="color:#9CA3AF;font-size:12px">Sin cobranza en este período.</div>`;
  }

  // Tabla
  const tbody = document.getElementById("cob-tbody");
  if (!tbody) return;
  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:#9CA3AF">
      Sin abonos en este período.</td></tr>`;
    return;
  }
  const puedeConc = Sesion.esSuperAdmin?.() ||
    ["GERENTE","ADMINISTRADOR","MESA_CONTROL"].includes(Sesion.rol);

  tbody.innerHTML = lista.map(a => {
    const concBtn = a.confirmado
      ? `<span style="font-size:11px;color:#16A34A;font-weight:700">✓ Conciliado</span>`
      : puedeConc
        ? `<button onclick="window._cobConc('${esc(a.id)}')"
             style="font-size:11px;padding:3px 10px;background:#1D5C33;color:#fff;border:none;
             border-radius:6px;cursor:pointer;font-weight:600">Conciliar</button>`
        : `<span style="font-size:11px;color:#9CA3AF">Pendiente</span>`;
    return `<tr style="border-bottom:1px solid #F3F4F6;${a.confirmado ? "opacity:.75" : ""}">
    <td style="padding:10px 14px;color:#6B7280">${a.fecha ? fmtDt(a.fecha) : "–"}</td>
    <td style="padding:10px 14px">${esc(a.clienteNombre || a.clienteId || "–")}</td>
    <td style="padding:10px 14px">${esc(a.quienRegistro || a.alias || "–")}</td>
    <td style="padding:10px 14px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;color:#1B5E20">
      ${fmt.format(a.monto || 0)}</td>
    <td style="padding:10px 14px;text-align:center;color:#6B7280">${a.formaPago || "–"}</td>
    <td style="padding:10px 14px;color:#6B7280;font-size:11px">${a.remisionNumero || a.remisionId || "–"}</td>
    <td style="padding:10px 14px;text-align:center">${concBtn}</td>
  </tr>`;
  }).join("");
}

function _rango() {
  const ahora = Date.now();
  if (_filtroPeriodo === "hoy") {
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    return { desde: hoy.getTime() };
  }
  if (_filtroPeriodo === "mes") {
    const m = new Date(); m.setDate(1); m.setHours(0,0,0,0);
    return { desde: m.getTime() };
  }
  // semana
  const s = new Date(); s.setDate(s.getDate() - s.getDay() + 1); s.setHours(0,0,0,0);
  return { desde: s.getTime() };
}

function _setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
