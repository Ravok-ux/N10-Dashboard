// ══════════════════════════════════════════════════════════════
// kardex.js — Historial de movimientos de inventario
// Muestra entradas, salidas y ajustes por producto
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import { esc } from "./app.js";
import {
  collection, query, orderBy, limit, where, onSnapshot,
  getDocs, doc, getDoc, startAfter
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { exportarExcel } from "./excel-utils.js";

const fmt    = v => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(v || 0);
const fmtNum = v => new Intl.NumberFormat("es-MX").format(v ?? 0);
const fmtTs  = ts => {
  if (!ts) return "–";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const TIPO_COLOR = {
  ENTRADA:  { bg: "#14532D", text: "#4ADE80", label: "↑ ENTRADA"  },
  SALIDA:   { bg: "#7F1D1D", text: "#FCA5A5", label: "↓ SALIDA"   },
  AJUSTE:   { bg: "#1E3A5F", text: "#93C5FD", label: "± AJUSTE"   },
  DEVOLUCION:{ bg:"#4A1D4A", text: "#E879F9", label: "↩ DEVOLUCIÓN"},
  TRASLADO: { bg: "#1A1A2E", text: "#94A3B8", label: "⇄ TRASLADO" },
};

let _unsub        = null;
let _filtroTipo   = "";
let _filtroProd   = "";
let _movimientos  = [];
let _alertasUnsub = null;

export const KardexModule = {
  mount(container) {
    if (!Sesion.esSuperAdmin() && !["GERENTE","ADMINISTRADOR","ALMACENISTA"].includes(Sesion.rol)) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔒</div>
        <div class="empty-state-title">Acceso restringido</div></div>`;
      return;
    }
    container.innerHTML = _html();
    document.getElementById("kx-tbody").innerHTML = window.skeleton?.(5, 5) ?? "";
    _bindUI();
    _escuchar();
    _escucharAlertas();
    return () => this.destroy();
  },
  destroy() {
    _unsub?.();        _unsub = null;
    _alertasUnsub?.(); _alertasUnsub = null;
    _movimientos = [];  _filtroTipo = ""; _filtroProd = "";
    window.KardexUI = undefined;
  }
};

// ── HTML ─────────────────────────────────────────────────────
function _html() {
  return `
  <div style="display:flex;flex-direction:column;height:100%">

    <!-- Header -->
    <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;
      border-bottom:1px solid var(--c-border);flex-shrink:0;flex-wrap:wrap">
      <div>
        <div style="font-size:13px;font-weight:800;color:var(--c-text)">📋 Kardex de inventario</div>
        <div style="font-size:10.5px;color:#9CA3AF" id="kx-subtitle">Cargando…</div>
      </div>
      <div style="flex:1"></div>

      <!-- Búsqueda por producto -->
      <input id="kx-buscar" type="text" placeholder="Buscar producto…"
        oninput="KardexUI.buscar(this.value)"
        style="border:1px solid var(--c-border);border-radius:6px;padding:6px 10px;
          font-size:12px;background:var(--c-surface);color:var(--c-text);width:200px">

      <!-- Filtro tipo -->
      <select id="kx-tipo" onchange="KardexUI.setTipo(this.value)"
        style="border:1px solid var(--c-border);border-radius:6px;padding:5px 8px;
          font-size:12px;background:var(--c-surface);color:var(--c-text)">
        <option value="">Todos los tipos</option>
        ${Object.keys(TIPO_COLOR).map(t => `<option value="${t}">${t}</option>`).join("")}
      </select>

      <button onclick="KardexUI.exportar()"
        style="background:var(--c-surface);border:1px solid var(--c-border);border-radius:6px;
          padding:6px 12px;font-size:11.5px;font-weight:700;color:var(--c-text);cursor:pointer">
        ⬇ Excel
      </button>
    </div>

    <!-- KPIs -->
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:0;flex-shrink:0;
      border-bottom:1px solid var(--c-border)">
      ${[
        ["kx-k-total",   "Total movimientos", "#9CA3AF"],
        ["kx-k-entrada", "Entradas",          "#4ADE80"],
        ["kx-k-salida",  "Salidas",           "#FCA5A5"],
        ["kx-k-ajuste",  "Ajustes",           "#93C5FD"],
        ["kx-k-alertas", "Alertas stock bajo","#FBBF24"],
      ].map(([id, label, color]) => `
        <div style="padding:12px 16px;border-right:1px solid var(--c-border)">
          <div style="font-size:10px;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">${label}</div>
          <div id="${id}" style="font-size:20px;font-weight:800;color:${color}">–</div>
        </div>`).join("")}
    </div>

    <!-- Alertas de stock bajo (colapsable) -->
    <div id="kx-alertas-bar" style="display:none;background:#78350F22;border-bottom:1px solid #FBBF2444;
      padding:8px 20px;font-size:11.5px;color:#FBBF24;flex-shrink:0">
      <span style="font-weight:700">⚠ Productos bajo stock mínimo:</span>
      <span id="kx-alertas-lista" style="margin-left:8px"></span>
      <button onclick="KardexUI.resolverAlertas()" style="margin-left:12px;font-size:10px;
        font-weight:700;color:#FBBF24;background:transparent;border:1px solid #FBBF2466;
        border-radius:4px;padding:2px 8px;cursor:pointer">Marcar revisadas</button>
    </div>

    <!-- Tabla de movimientos -->
    <div style="flex:1;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px" id="kx-tabla">
        <thead>
          <tr style="background:var(--c-surface-2,#F9FAFB);position:sticky;top:0;z-index:1">
            <th style="padding:9px 14px;text-align:left;font-weight:700;color:#6B7280;border-bottom:1px solid var(--c-border)">TIPO</th>
            <th style="padding:9px 14px;text-align:left;font-weight:700;color:#6B7280;border-bottom:1px solid var(--c-border)">PRODUCTO</th>
            <th style="padding:9px 14px;text-align:right;font-weight:700;color:#6B7280;border-bottom:1px solid var(--c-border)">CANTIDAD</th>
            <th style="padding:9px 14px;text-align:right;font-weight:700;color:#6B7280;border-bottom:1px solid var(--c-border)">ANTES</th>
            <th style="padding:9px 14px;text-align:right;font-weight:700;color:#6B7280;border-bottom:1px solid var(--c-border)">DESPUÉS</th>
            <th style="padding:9px 14px;text-align:left;font-weight:700;color:#6B7280;border-bottom:1px solid var(--c-border)">MOTIVO / REF</th>
            <th style="padding:9px 14px;text-align:left;font-weight:700;color:#6B7280;border-bottom:1px solid var(--c-border)">REGISTRADO POR</th>
            <th style="padding:9px 14px;text-align:left;font-weight:700;color:#6B7280;border-bottom:1px solid var(--c-border)">FECHA</th>
          </tr>
        </thead>
        <tbody id="kx-tbody">
          <tr><td colspan="8" style="padding:40px;text-align:center;color:#9CA3AF">Cargando movimientos…</td></tr>
        </tbody>
      </table>
    </div>

  </div>`;
}

// ── Listener principal ────────────────────────────────────────
function _escuchar() {
  const q = query(
    collection(db, "movimientos_stock"),
    orderBy("_ts", "desc"),
    limit(200)
  );

  _unsub = onSnapshot(q, snap => {
    _movimientos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderKPIs();
    _renderTabla();
    const el = document.getElementById("kx-subtitle");
    if (el) el.textContent = `${_movimientos.length} movimientos recientes`;
  }, err => {
    console.error("[Kardex]", err);
    window.toast?.("Error al cargar kardex", "error");
  });
}

function _escucharAlertas() {
  const q = query(
    collection(db, "alertas_stock"),
    where("resuelta", "==", false),
    orderBy("_ts", "desc"),
    limit(50)
  );
  _alertasUnsub = onSnapshot(q, snap => {
    const alertas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const bar  = document.getElementById("kx-alertas-bar");
    const lista = document.getElementById("kx-alertas-lista");
    const kxAl  = document.getElementById("kx-k-alertas");
    if (!bar) return;

    if (kxAl) kxAl.textContent = alertas.length;

    if (alertas.length === 0) {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "";
    if (lista) {
      lista.textContent = alertas
        .slice(0, 5)
        .map(a => `${esc(a.nombreProducto)} (${a.stockActual}/${a.stockMinimo})`)
        .join(" · ");
    }

    // Badge global en sidebar
    _setBadgeSidebar(alertas.length);
  });
}

// ── Render ────────────────────────────────────────────────────
function _renderKPIs() {
  const total   = _movimientos.length;
  const entradas = _movimientos.filter(m => m.tipo === "ENTRADA").length;
  const salidas  = _movimientos.filter(m => m.tipo === "SALIDA").length;
  const ajustes  = _movimientos.filter(m => m.tipo === "AJUSTE").length;
  _setText("kx-k-total",   total);
  _setText("kx-k-entrada", entradas);
  _setText("kx-k-salida",  salidas);
  _setText("kx-k-ajuste",  ajustes);
}

function _renderTabla() {
  const tbody = document.getElementById("kx-tbody");
  if (!tbody) return;

  let lista = _movimientos;
  if (_filtroTipo)  lista = lista.filter(m => m.tipo === _filtroTipo);
  if (_filtroProd)  {
    const q = _filtroProd.toLowerCase();
    lista = lista.filter(m => (m.nombreProducto || "").toLowerCase().includes(q));
  }

  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:40px;text-align:center;color:#9CA3AF">
      Sin movimientos para los filtros seleccionados</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map((m, i) => {
    const tc  = TIPO_COLOR[m.tipo] || TIPO_COLOR.AJUSTE;
    const bg  = i % 2 === 0 ? "transparent" : "rgba(255,255,255,.02)";
    const ref = m.folioPedido ? `Pedido ${esc(m.folioPedido)}` : esc(m.motivo || "–");
    return `
      <tr style="border-bottom:1px solid var(--c-border);background:${bg}">
        <td style="padding:8px 14px">
          <span style="font-size:10px;font-weight:700;background:${tc.bg};color:${tc.text};
            border-radius:4px;padding:2px 8px;white-space:nowrap">${tc.label}</span>
        </td>
        <td style="padding:8px 14px;color:var(--c-text);font-weight:600;max-width:220px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(m.nombreProducto)}">
          ${esc(m.nombreProducto || "–")}
        </td>
        <td style="padding:8px 14px;text-align:right;font-weight:700;
          color:${m.tipo==='SALIDA'?'#FCA5A5':m.tipo==='ENTRADA'?'#4ADE80':'#93C5FD'}">
          ${m.tipo === "SALIDA" ? "−" : "+"}${fmtNum(m.cantidad)}
        </td>
        <td style="padding:8px 14px;text-align:right;color:#9CA3AF">${fmtNum(m.stockAntes)}</td>
        <td style="padding:8px 14px;text-align:right;font-weight:600;color:var(--c-text)">${fmtNum(m.stockDespues)}</td>
        <td style="padding:8px 14px;color:#9CA3AF;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
          title="${ref}">${ref}</td>
        <td style="padding:8px 14px;color:#9CA3AF">${esc(m.quienRegistro || m.ingenieroAlias || "–")}</td>
        <td style="padding:8px 14px;color:#9CA3AF;white-space:nowrap">${fmtTs(m.timestamp)}</td>
      </tr>`;
  }).join("");
}

// ── Acciones UI ───────────────────────────────────────────────
function _bindUI() {
  window.KardexUI = {
    setTipo(t)   { _filtroTipo = t; _renderTabla(); },
    buscar(q)    { _filtroProd = q.trim(); _renderTabla(); },

    async resolverAlertas() {
      if (!await window.modal({ title: "Resolver alertas", message: "¿Marcar como revisadas todas las alertas de stock bajo?", confirmLabel: "Marcar todas" })) return;
      const { updateDoc, doc: fsDoc } = await import(
        "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
      );
      const snap = await getDocs(
        query(collection(db, "alertas_stock"), where("resuelta", "==", false))
      );
      const proms = snap.docs.map(d => updateDoc(d.ref, {
        resuelta: true, fechaResolucion: new Date()
      }));
      await Promise.all(proms);
      window.toast?.("Alertas marcadas como revisadas", "success");
    },

    exportar() {
      const rows = _movimientos.map(m => ({
        tipo:           m.tipo || "",
        nombreProducto: m.nombreProducto || "",
        cantidad:       m.cantidad ?? 0,
        stockAntes:     m.stockAntes ?? 0,
        stockDespues:   m.stockDespues ?? 0,
        motivo:         m.folioPedido || m.motivo || "",
        quienRegistro:  m.quienRegistro || m.ingenieroAlias || "",
        fecha:          m.timestamp ? fmtTs(m.timestamp) : "",
      }));
      exportarExcel(rows, [
        { key: "tipo",           header: "Tipo",          width: 14 },
        { key: "nombreProducto", header: "Producto",       width: 30 },
        { key: "cantidad",       header: "Cantidad",       width: 12, fmt: "numero" },
        { key: "stockAntes",     header: "Stock antes",    width: 12, fmt: "numero" },
        { key: "stockDespues",   header: "Stock después",  width: 14, fmt: "numero" },
        { key: "motivo",         header: "Motivo / Ref",   width: 20 },
        { key: "quienRegistro",  header: "Registrado por", width: 18 },
        { key: "fecha",          header: "Fecha",          width: 20 },
      ], "Kardex_Inventario", "Kardex");
    }
  };
}

// ── Helpers ───────────────────────────────────────────────────
function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _setBadgeSidebar(count) {
  // Badge rojo en el ítem del sidebar de inventario/compras
  const sbItem = document.querySelector('[data-view="compras"]') ||
                 document.querySelector('[data-view="kardex"]');
  if (!sbItem) return;
  let badge = sbItem.querySelector(".sb-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "sb-badge";
    badge.style.cssText = `background:#EF4444;color:#fff;font-size:9px;font-weight:800;
      border-radius:999px;padding:1px 5px;margin-left:auto`;
    sbItem.appendChild(badge);
  }
  badge.textContent = count > 0 ? count : "";
  badge.style.display = count > 0 ? "" : "none";
}
