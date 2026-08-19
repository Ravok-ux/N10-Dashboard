// ══════════════════════════════════════════════════════════════
// inventario.js — Stock en tiempo real + movimientos
// Colecciones: inventario / movimientos_stock
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import { esc } from "./app.js";
import {
  collection, doc, query, where, orderBy, limit,
  onSnapshot, addDoc, updateDoc, setDoc, getDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const fmtMXN   = v => Number(v || 0).toLocaleString("es-MX", { style:"currency", currency:"MXN" });
const fmtFecha = ts => ts
  ? new Date(typeof ts === "number" ? ts : ts.toMillis?.() ?? ts)
      .toLocaleDateString("es-MX", { day:"2-digit", month:"short", year:"numeric" })
  : "—";

const TABS = [
  { id:"stock",       label:"📦 Stock actual"  },
  { id:"movimientos", label:"🔄 Movimientos"   },
];

let _tab    = "stock";
let _unsubs = [];
let _allRows = [];

export const InventarioModule = {
  mount(container) {
    if (!_puedeVer()) {
      container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-muted)">
        Acceso restringido.</div>`;
      return;
    }
    container.innerHTML = `
    <div class="mod-wrap">
      <div class="mod-topbar"><h2 class="mod-title">📦 Inventario</h2></div>
      <div class="rh-tabs" id="inv-tabs">
        ${TABS.map((t,i) =>
          `<button class="rh-tab ${i===0?"active":""}" data-tab="${t.id}">${t.label}</button>`
        ).join("")}
      </div>
      <div id="inv-content"></div>
    </div>`;
    document.getElementById("inv-tabs")?.addEventListener("click", e => {
      const btn = e.target.closest("[data-tab]");
      if (!btn) return;
      document.querySelectorAll("#inv-tabs .rh-tab")
        .forEach(b => b.classList.toggle("active", b === btn));
      _activarTab(btn.dataset.tab);
    });
    _activarTab("stock");
    return () => this.destroy();
  },
  destroy() { _unsubs.forEach(u => u?.()); _unsubs = []; _allRows = []; }
};

function _puedeVer()    { return Sesion.esSuperAdmin?.() || ["GERENTE","ADMINISTRADOR","MESA_CONTROL","GERENTE_ZONA","INGENIERO","VENDEDOR"].includes(Sesion.rol); }
function _puedeEditar() { return Sesion.esSuperAdmin?.() || ["GERENTE","ADMINISTRADOR"].includes(Sesion.rol); }

function _activarTab(tab) {
  _tab = tab;
  _unsubs.forEach(u => u?.()); _unsubs = [];
  if (tab === "stock")        _montarStock();
  else if (tab === "movimientos") _montarMovimientos();
}

// ══════════════════════════════════════════════════════════════
// STOCK ACTUAL
// ══════════════════════════════════════════════════════════════
function _montarStock() {
  document.getElementById("inv-content").innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
      <input type="text" class="sel-sm" id="inv-buscar" placeholder="Buscar producto o SKU…" style="width:220px">
      <select class="sel-sm" id="inv-filtro-estado">
        <option value="">Todos</option>
        <option value="bajo">⚠️ Bajo mínimo</option>
        <option value="ok">✅ Con stock</option>
        <option value="cero">🔴 Sin stock</option>
      </select>
      ${_puedeEditar() ? `<button class="btn-primary" id="inv-ajuste-btn">+ Ajuste / editar mínimo</button>` : ""}
      <button class="btn-outline" id="inv-xlsx-btn">↓ Excel</button>
    </div>

    <div class="kpi-row" style="margin-bottom:16px">
      <div class="kpi-card" style="border-left-color:#1D4ED8">
        <div class="kpi-icon">📦</div><div class="kpi-val" id="inv-kpi-total">–</div>
        <div class="kpi-label">Productos</div>
      </div>
      <div class="kpi-card" style="border-left-color:#DC2626">
        <div class="kpi-icon">⚠️</div><div class="kpi-val" id="inv-kpi-bajo">–</div>
        <div class="kpi-label">Bajo mínimo</div>
      </div>
      <div class="kpi-card" style="border-left-color:#16A34A">
        <div class="kpi-icon">💰</div><div class="kpi-val" id="inv-kpi-valor">–</div>
        <div class="kpi-label">Valor estimado</div>
      </div>
    </div>

    <div style="overflow-x:auto">
      <table class="data-table">
        <thead><tr>
          <th>PRODUCTO</th><th>SKU</th>
          <th style="text-align:right">STOCK</th>
          <th style="text-align:right">MÍNIMO</th>
          <th>UNIDAD</th><th style="text-align:right">COSTO</th>
          <th>NIVEL</th><th>ÚLT. MOV.</th>
          ${_puedeEditar() ? "<th></th>" : ""}
        </tr></thead>
        <tbody id="inv-body">
          ${window.skeleton?.(5, 9) ?? ""}
        </tbody>
      </table>
    </div>

    <!-- Modal ajuste -->
    <div class="modal-overlay hidden" id="inv-modal">
      <div class="modal-box" style="max-width:440px">
        <div class="modal-hdr">
          <span class="modal-title" id="inv-modal-title">Ajuste de inventario</span>
          <button class="modal-close" id="inv-modal-close">✕</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
          <div class="form-group">
            <label class="form-label">Tipo</label>
            <select class="form-input" id="inv-tipo">
              <option value="AJUSTE_ENTRADA">➕ Entrada (suma al stock)</option>
              <option value="AJUSTE_SALIDA">➖ Salida (resta al stock)</option>
              <option value="AJUSTE_INVENTARIO">🔁 Inventario físico (reemplaza stock)</option>
              <option value="EDITAR_MINIMO">📏 Editar stock mínimo</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Producto (ID Pretoriano)</label>
            <input class="form-input" type="text" id="inv-prod-id" placeholder="ID del producto">
          </div>
          <div class="form-group">
            <label class="form-label">Nombre del producto</label>
            <input class="form-input" type="text" id="inv-prod-nom" placeholder="Nombre visible">
          </div>
          <div class="form-group">
            <label class="form-label" id="inv-cant-label">Cantidad</label>
            <input class="form-input" type="number" id="inv-cantidad" min="0" step="1" placeholder="0">
          </div>
          <div class="form-group">
            <label class="form-label">Motivo / referencia</label>
            <input class="form-input" type="text" id="inv-motivo" placeholder="Recepción de mercancía, conteo físico…">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" id="inv-cancel">Cancelar</button>
          <button class="btn-primary" id="inv-guardar">Guardar</button>
        </div>
      </div>
    </div>`;

  const cerrarModal = () => document.getElementById("inv-modal")?.classList.add("hidden");
  document.getElementById("inv-ajuste-btn")?.addEventListener("click", () => {
    const m = document.getElementById("inv-modal");
    document.getElementById("inv-prod-id").disabled  = false;
    document.getElementById("inv-prod-nom").disabled = false;
    document.getElementById("inv-modal-title").textContent = "Ajuste de inventario";
    m?.classList.remove("hidden");
  });
  document.getElementById("inv-modal-close")?.addEventListener("click", cerrarModal);
  document.getElementById("inv-cancel")?.addEventListener("click", cerrarModal);
  document.getElementById("inv-guardar")?.addEventListener("click", _guardarAjuste);
  document.getElementById("inv-tipo")?.addEventListener("change", e => {
    const label = document.getElementById("inv-cant-label");
    if (label) label.textContent = e.target.value === "EDITAR_MINIMO" ? "Nuevo mínimo" : "Cantidad";
  });

  const _filtrar = () => {
    const buscar = (document.getElementById("inv-buscar")?.value || "").toLowerCase();
    const estado = document.getElementById("inv-filtro-estado")?.value || "";
    let rows = _allRows;
    if (buscar) rows = rows.filter(r =>
      (r.nombre||"").toLowerCase().includes(buscar) || (r.sku||"").toLowerCase().includes(buscar));
    if (estado === "bajo")  rows = rows.filter(r => r.stockActual > 0 && r.stockActual <= (r.stockMinimo||0));
    if (estado === "ok")    rows = rows.filter(r => r.stockActual > (r.stockMinimo||0));
    if (estado === "cero")  rows = rows.filter(r => (r.stockActual||0) <= 0);
    _renderStock(rows);
  };
  document.getElementById("inv-buscar")?.addEventListener("input", _filtrar);
  document.getElementById("inv-filtro-estado")?.addEventListener("change", _filtrar);
  document.getElementById("inv-xlsx-btn")?.addEventListener("click", () => _exportXlsx(_allRows));

  const q = query(collection(db, "inventario"), orderBy("nombre"), limit(500));
  _unsubs.push(onSnapshot(q, snap => {
    _allRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _filtrar();
  }, err => console.error("[Inventario]", err)));
}

function _renderStock(rows) {
  const bajo  = rows.filter(r => (r.stockActual||0) > 0 && (r.stockActual||0) <= (r.stockMinimo||0));
  const valor = rows.reduce((s,r) => s + (r.stockActual||0)*(r.costo||0), 0);
  const el = id => document.getElementById(id);
  if (el("inv-kpi-total")) el("inv-kpi-total").textContent = rows.length;
  if (el("inv-kpi-bajo"))  el("inv-kpi-bajo").textContent  = bajo.length;
  if (el("inv-kpi-valor")) el("inv-kpi-valor").textContent = fmtMXN(valor);

  const tbody = document.getElementById("inv-body");
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="padding:32px;text-align:center;color:var(--text-muted)">Sin productos</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const stock = r.stockActual ?? 0;
    const min   = r.stockMinimo ?? 0;
    const sinStock  = stock <= 0;
    const bajoMin   = !sinStock && stock <= min && min > 0;
    const color = sinStock ? "#DC2626" : bajoMin ? "#D97706" : "#16A34A";
    const pct   = min > 0 ? Math.min(100, Math.round(stock/min*100)) : 100;
    const badge = sinStock
      ? `<span class="badge badge-red">SIN STOCK</span>`
      : bajoMin
      ? `<span class="badge badge-amber">BAJO MÍN</span>`
      : `<span class="badge" style="background:#DCFCE7;color:#15803D">OK</span>`;
    const rowBg = sinStock ? "background:rgba(220,38,38,.04)" : bajoMin ? "background:rgba(217,119,6,.03)" : "";
    const editBtn = _puedeEditar()
      ? `<button class="btn-sm btn-outline inv-edit-btn"
           data-id="${esc(r.id)}" data-nom="${esc(r.nombre||"")}"
           data-stock="${stock}" data-min="${min}">✏️</button>`
      : "";
    return `<tr style="${rowBg}">
      <td style="font-weight:700">${esc(r.nombre||"–")}</td>
      <td style="font-size:11px;color:var(--text-muted)">${esc(r.sku||"–")}</td>
      <td style="text-align:right;font-weight:800;font-size:15px;color:${color}">${stock}</td>
      <td style="text-align:right;color:var(--text-muted)">${min}</td>
      <td style="font-size:12px">${esc(r.unidad||"pza")}</td>
      <td style="text-align:right;font-size:12px">${fmtMXN(r.costo)}</td>
      <td>
        ${badge}
        <div style="margin-top:4px;height:5px;border-radius:3px;background:var(--border)">
          <div style="height:5px;border-radius:3px;background:${color};width:${pct}%;max-width:100%;transition:width .3s"></div>
        </div>
      </td>
      <td style="font-size:11px;color:var(--text-muted);white-space:nowrap">${fmtFecha(r._ts)}</td>
      ${_puedeEditar() ? `<td>${editBtn}</td>` : ""}
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".inv-edit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const { id, nom, stock, min } = btn.dataset;
      document.getElementById("inv-modal-title").textContent = `Editar: ${nom}`;
      const idEl  = document.getElementById("inv-prod-id");
      const nomEl = document.getElementById("inv-prod-nom");
      idEl.value  = id;  idEl.disabled  = true;
      nomEl.value = nom; nomEl.disabled = true;
      document.getElementById("inv-modal")?.classList.remove("hidden");
    });
  });
}

async function _guardarAjuste() {
  const tipo    = document.getElementById("inv-tipo")?.value;
  const prodId  = document.getElementById("inv-prod-id")?.value.trim();
  const prodNom = document.getElementById("inv-prod-nom")?.value.trim();
  const cant    = parseFloat(document.getElementById("inv-cantidad")?.value || "0");
  const motivo  = document.getElementById("inv-motivo")?.value.trim();

  if (!prodId || !prodNom) { window.toast?.("Ingresa ID y nombre del producto", "error"); return; }
  if (cant < 0) { window.toast?.("La cantidad no puede ser negativa", "error"); return; }

  const btn = document.getElementById("inv-guardar");
  btn.disabled = true; btn.textContent = "Guardando…";
  try {
    const invRef = doc(db, "inventario", prodId);
    const snap   = await getDoc(invRef);
    const stockAntes = snap.exists() ? (snap.data().stockActual ?? 0) : 0;
    let stockDespues = cant;

    if (tipo === "EDITAR_MINIMO") {
      await setDoc(invRef, { nombre: prodNom, stockMinimo: cant, _ts: Date.now() }, { merge: true });
      window.toast?.("Mínimo actualizado", "success");
    } else {
      if (tipo === "AJUSTE_ENTRADA")    stockDespues = stockAntes + cant;
      else if (tipo === "AJUSTE_SALIDA") stockDespues = Math.max(0, stockAntes - cant);

      await addDoc(collection(db, "movimientos_stock"), {
        productoId: prodId, nombreProducto: prodNom, tipo, cantidad: cant,
        stockAntes, stockDespues, motivo,
        quienRegistro: Sesion.alias, _ts: Date.now()
      });
      await setDoc(invRef, { nombre: prodNom, stockActual: stockDespues, _ts: Date.now() }, { merge: true });
      window.toast?.("Ajuste guardado", "success");
    }
    document.getElementById("inv-modal")?.classList.add("hidden");
    document.getElementById("inv-prod-id").disabled  = false;
    document.getElementById("inv-prod-nom").disabled = false;
    document.getElementById("inv-cantidad").value = "";
    document.getElementById("inv-motivo").value   = "";
  } catch(e) { window.toast?.("Error: " + e.message, "error"); }
  finally { btn.disabled = false; btn.textContent = "Guardar"; }
}

// ══════════════════════════════════════════════════════════════
// MOVIMIENTOS
// ══════════════════════════════════════════════════════════════
function _montarMovimientos() {
  const hoy   = new Date().toISOString().slice(0,10);
  const hace7 = new Date(Date.now()-7*86400000).toISOString().slice(0,10);
  document.getElementById("inv-content").innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
      <select class="sel-sm" id="mov-tipo">
        <option value="">Todos los tipos</option>
        <option value="SALIDA">🔴 Salida (pedido)</option>
        <option value="ENTRADA">🟢 Entrada</option>
        <option value="DEVOLUCION">🔵 Devolución</option>
        <option value="AJUSTE_ENTRADA">➕ Ajuste entrada</option>
        <option value="AJUSTE_SALIDA">➖ Ajuste salida</option>
        <option value="AJUSTE_INVENTARIO">🔁 Inventario físico</option>
      </select>
      <span style="font-size:11px;color:var(--text-muted)">Desde</span>
      <input type="date" class="sel-sm" id="mov-desde" value="${hace7}">
      <span style="font-size:11px;color:var(--text-muted)">Hasta</span>
      <input type="date" class="sel-sm" id="mov-hasta" value="${hoy}">
      <button class="btn-primary" id="mov-filtrar">Filtrar</button>
    </div>
    <div style="overflow-x:auto">
      <table class="data-table">
        <thead><tr>
          <th>FECHA</th><th>TIPO</th><th>PRODUCTO</th>
          <th style="text-align:right">CANT.</th>
          <th style="text-align:right">ANTES</th>
          <th style="text-align:right">DESPUÉS</th>
          <th>MOTIVO / REF.</th><th>REGISTRÓ</th>
        </tr></thead>
        <tbody id="mov-body">
          <tr><td colspan="8" style="padding:24px;text-align:center;color:var(--text-muted)">Cargando…</td></tr>
        </tbody>
      </table>
    </div>`;

  document.getElementById("mov-filtrar")?.addEventListener("click", _escucharMovimientos);
  _escucharMovimientos();
}

function _escucharMovimientos() {
  _unsubs.forEach(u => u?.()); _unsubs = [];
  const tipo  = document.getElementById("mov-tipo")?.value || "";
  const desde = document.getElementById("mov-desde")?.value;
  const hasta = document.getElementById("mov-hasta")?.value;
  const [dy,dm,dd] = (desde||"").split("-").map(Number);
  const [hy,hm,hd] = (hasta||"").split("-").map(Number);
  const desdeTs = desde ? new Date(dy,dm-1,dd,0,0,0).getTime() : Date.now()-7*86400000;
  const hastaTs = hasta ? new Date(hy,hm-1,hd,23,59,59).getTime() : Date.now();

  let constraints = [where("_ts",">=",desdeTs), where("_ts","<=",hastaTs),
    orderBy("_ts","desc"), limit(500)];
  if (tipo) constraints = [where("tipo","==",tipo), ...constraints];
  const q = query(collection(db, "movimientos_stock"), ...constraints);

  const tbody = document.getElementById("mov-body");
  const ICON = { SALIDA:"🔴", ENTRADA:"🟢", DEVOLUCION:"🔵",
    AJUSTE_ENTRADA:"➕", AJUSTE_SALIDA:"➖", AJUSTE_INVENTARIO:"🔁" };

  _unsubs.push(onSnapshot(q, snap => {
    if (!tbody) return;
    const rows = snap.docs.map(d => d.data());
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="padding:32px;text-align:center;color:var(--text-muted)">Sin movimientos</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => `<tr>
      <td style="font-size:11px;color:var(--text-muted);white-space:nowrap">${fmtFecha(r._ts)}</td>
      <td style="font-size:12px">${ICON[r.tipo]||"•"} ${esc(r.tipo||"–")}</td>
      <td style="font-weight:600">${esc(r.nombreProducto||r.productoId||"–")}</td>
      <td style="text-align:right;font-weight:700">${r.cantidad??""}</td>
      <td style="text-align:right;color:var(--text-muted)">${r.stockAntes??""}</td>
      <td style="text-align:right;font-weight:700">${r.stockDespues??""}</td>
      <td style="font-size:11px;color:var(--text-muted);max-width:200px">${esc(r.motivo||r.folio||r.pedidoId||"–")}</td>
      <td style="font-size:11px">${esc(r.quienRegistro||"sistema")}</td>
    </tr>`).join("");
  }, err => console.error("[Mov]", err)));
}

function _exportXlsx(rows) {
  if (!rows.length) { window.toast?.("Sin datos para exportar","warning"); return; }
  const h = ["Producto","SKU","Stock actual","Stock mínimo","Unidad","Costo unitario","Valor total","Actualizado"];
  const d = rows.map(r => [r.nombre||"",r.sku||"",r.stockActual??0,r.stockMinimo??0,
    r.unidad||"pza",r.costo||0,(r.stockActual||0)*(r.costo||0),fmtFecha(r._ts)]);
  const ws = XLSX.utils.aoa_to_sheet([h, ...d]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Inventario");
  XLSX.writeFile(wb, `N10-inventario-${new Date().toISOString().slice(0,10)}.xlsx`);
  window.toast?.("Exportando Excel…","info");
}
