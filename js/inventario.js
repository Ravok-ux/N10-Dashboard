// ══════════════════════════════════════════════════════════════
// inventario.js — Stock en tiempo real + movimientos
// Colecciones: inventario / movimientos_stock
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import { esc, logAudit } from "./app.js";
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
      container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-sec)">
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
function _puedeEditar() { return Sesion.esSuperAdmin?.() || ["GERENTE","ADMINISTRADOR"].includes(Sesion.rol) || Sesion.flags?.PUEDE_AJUSTAR_INVENTARIO; }

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
      <button id="inv-xlsx-btn" style="padding:7px 12px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">⬇️ Excel</button>
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

    <!-- Modal ajuste — rediseñado -->
    <div class="modal-overlay hidden" id="inv-modal">
      <div style="background:var(--surface);border:1px solid var(--border);
        border-radius:14px;width:100%;max-width:480px;box-shadow:0 24px 64px rgba(0,0,0,.5);
        overflow:hidden;display:flex;flex-direction:column">

        <!-- Header del modal -->
        <div style="display:flex;align-items:center;gap:12px;padding:18px 20px;
          border-bottom:1px solid var(--border)">
          <div style="width:36px;height:36px;border-radius:9px;background:#6366F122;
            display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">
            📦
          </div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:800;color:var(--text-primary)"
              id="inv-modal-title">Ajuste de inventario</div>
            <div style="font-size:11px;color:#64748B;margin-top:1px">
              Registra entradas, salidas o edita mínimos
            </div>
          </div>
          <button id="inv-modal-close"
            style="width:28px;height:28px;border-radius:6px;border:1px solid var(--border);
              background:transparent;cursor:pointer;color:#64748B;font-size:14px;
              display:flex;align-items:center;justify-content:center">✕</button>
        </div>

        <!-- Cuerpo -->
        <div style="padding:18px 20px;display:flex;flex-direction:column;gap:16px;overflow-y:auto;max-height:72vh">

          <!-- Selector de tipo: tarjetas -->
          <div>
            <div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;
              letter-spacing:.08em;margin-bottom:8px">Tipo de operación</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px" id="inv-tipo-grid">
              ${[
                { v:"AJUSTE_ENTRADA",    ico:"➕", lbl:"Entrada",        desc:"Suma al stock"            },
                { v:"AJUSTE_SALIDA",     ico:"➖", lbl:"Salida",         desc:"Resta al stock"           },
                { v:"AJUSTE_INVENTARIO", ico:"🔁", lbl:"Inventario",     desc:"Reemplaza el stock"       },
                { v:"EDITAR_MINIMO",     ico:"📏", lbl:"Editar mínimo",  desc:"Cambia stock mínimo"      },
              ].map((op, i) => `
                <button type="button" data-inv-tipo="${op.v}"
                  onclick="window._invSelTipo('${op.v}')"
                  style="display:flex;align-items:center;gap:10px;padding:10px 12px;
                    border-radius:8px;cursor:pointer;text-align:left;width:100%;
                    border:1.5px solid ${i===0?"#6366F1":"var(--border)"};
                    background:${i===0?"#6366F114":"transparent"};
                    transition:border-color .15s,background .15s">
                  <span style="font-size:18px;line-height:1">${op.ico}</span>
                  <span>
                    <span style="display:block;font-size:12px;font-weight:700;
                      color:${i===0?"#6366F1":"var(--text-primary)"}" class="inv-tipo-lbl">${op.lbl}</span>
                    <span style="display:block;font-size:10px;color:#64748B">${op.desc}</span>
                  </span>
                </button>`).join("")}
            </div>
            <!-- select oculto que mantiene el valor para el código existente -->
            <select id="inv-tipo" style="display:none">
              <option value="AJUSTE_ENTRADA">AJUSTE_ENTRADA</option>
              <option value="AJUSTE_SALIDA">AJUSTE_SALIDA</option>
              <option value="AJUSTE_INVENTARIO">AJUSTE_INVENTARIO</option>
              <option value="EDITAR_MINIMO">EDITAR_MINIMO</option>
            </select>
          </div>

          <!-- Producto: buscador desde catálogo -->
          <div style="background:var(--surface-2);border:1px solid var(--border);
            border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:10px">
            <div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;
              letter-spacing:.08em">Producto del catálogo</div>

            <!-- Buscador autocomplete -->
            <div style="position:relative">
              <label style="font-size:10px;color:#94A3B8;font-weight:600;display:block;margin-bottom:4px">
                Buscar producto
              </label>
              <div style="position:relative">
                <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);
                  font-size:13px;pointer-events:none">🔍</span>
                <input type="text" id="inv-prod-search"
                  placeholder="Escribe para buscar…"
                  autocomplete="off"
                  style="width:100%;padding:8px 10px 8px 32px;border:1px solid var(--border);
                    border-radius:8px;background:var(--surface);color:var(--text-primary);
                    font-size:12px;box-sizing:border-box">
              </div>
              <!-- Lista de resultados -->
              <div id="inv-prod-lista"
                style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;
                  background:var(--surface);border:1px solid var(--border);
                  border-radius:8px;max-height:200px;overflow-y:auto;z-index:999;
                  box-shadow:0 8px 24px rgba(0,0,0,.4)">
              </div>
            </div>

            <!-- Producto seleccionado (chip) -->
            <div id="inv-prod-chip" style="display:none;align-items:center;gap:10px;
              background:#6366F114;border:1px solid #6366F140;border-radius:8px;padding:10px 12px">
              <div style="flex:1">
                <div style="font-size:12px;font-weight:700;color:var(--text-primary)"
                  id="inv-chip-nombre">—</div>
                <div style="font-size:10px;color:#64748B;margin-top:2px;font-family:monospace"
                  id="inv-chip-codigo">—</div>
              </div>
              <button type="button" onclick="window._invLimpiarProducto()"
                style="background:none;border:none;cursor:pointer;color:#64748B;font-size:16px;padding:2px 4px"
                title="Cambiar producto">✕</button>
            </div>

            <!-- Campos ocultos usados por _guardarAjuste -->
            <input type="hidden" id="inv-prod-id">
            <input type="hidden" id="inv-prod-nom">
          </div>

          <!-- Cantidad + Motivo -->
          <div style="display:flex;gap:10px">
            <div style="flex:0.7">
              <label style="font-size:10px;color:#94A3B8;font-weight:700;text-transform:uppercase;
                letter-spacing:.06em;display:block;margin-bottom:5px" id="inv-cant-label">
                Cantidad
              </label>
              <input class="form-input" type="number" id="inv-cantidad" min="0" step="1" placeholder="0"
                style="width:100%;font-size:16px;font-weight:700;text-align:center;
                  font-variant-numeric:tabular-nums">
            </div>
            <div style="flex:1.3">
              <label style="font-size:10px;color:#94A3B8;font-weight:700;text-transform:uppercase;
                letter-spacing:.06em;display:block;margin-bottom:5px">
                Motivo / referencia
              </label>
              <input class="form-input" type="text" id="inv-motivo"
                placeholder="Recepción, conteo físico…" style="width:100%">
            </div>
          </div>

          <!-- Sección N10 -->
          <div style="border-radius:10px;border:1.5px solid #6366F140;
            background:linear-gradient(135deg,#6366F108,#818CF808);overflow:hidden">
            <div style="padding:10px 14px;border-bottom:1px solid #6366F130;
              display:flex;align-items:center;gap:8px">
              <span style="font-size:15px">💧</span>
              <div>
                <div style="font-size:11px;font-weight:800;color:#818CF8">Familia Nutrición de 10 (N10)</div>
                <div style="font-size:9.5px;color:#64748B">Requerido para comisiones automáticas por litro</div>
              </div>
            </div>
            <div style="padding:12px 14px;display:flex;gap:10px">
              <div style="flex:1">
                <label style="font-size:10px;color:#94A3B8;font-weight:600;display:block;margin-bottom:4px">
                  Familia
                </label>
                <select class="form-input" id="inv-familia"
                  onchange="document.getElementById('inv-litros-wrap').style.opacity=this.value==='N10'?'1':'.4'"
                  style="width:100%">
                  <option value="">— Otra familia —</option>
                  <option value="N10">Nutrición de 10 (N10)</option>
                </select>
              </div>
              <div style="flex:1;opacity:.4;transition:opacity .2s" id="inv-litros-wrap">
                <label style="font-size:10px;color:#94A3B8;font-weight:600;display:block;margin-bottom:4px">
                  Litros por unidad
                </label>
                <div style="position:relative">
                  <input class="form-input" type="number" id="inv-litros-u"
                    min="0" step="0.5" placeholder="20"
                    style="width:100%;padding-right:28px">
                  <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);
                    font-size:10px;color:#64748B;pointer-events:none">L</span>
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- Footer -->
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;
          padding:14px 20px;border-top:1px solid var(--border)">
          <button id="inv-cancel"
            style="padding:8px 18px;border-radius:8px;border:1px solid var(--border);
              background:transparent;color:#94A3B8;font-size:12px;font-weight:600;cursor:pointer">
            Cancelar
          </button>
          <button id="inv-guardar"
            style="padding:8px 22px;border-radius:8px;border:none;
              background:#6366F1;color:#fff;font-size:12px;font-weight:700;cursor:pointer;
              display:flex;align-items:center;gap:6px;transition:background .15s">
            <span>✔</span> Guardar ajuste
          </button>
        </div>
      </div>
    </div>`;

  // Selector visual de tipo por tarjetas
  window._invSelTipo = (val) => {
    document.getElementById("inv-tipo").value = val;
    document.querySelectorAll("[data-inv-tipo]").forEach(btn => {
      const sel = btn.dataset.invTipo === val;
      btn.style.borderColor  = sel ? "#6366F1" : "var(--border)";
      btn.style.background   = sel ? "#6366F114" : "transparent";
      btn.querySelector(".inv-tipo-lbl").style.color = sel ? "#6366F1" : "var(--text-primary)";
    });
    const label = document.getElementById("inv-cant-label");
    if (label) label.textContent = val === "EDITAR_MINIMO" ? "Nuevo mínimo" : "Cantidad";
  };

  // ── Autocomplete de producto desde colección "productos" ──────
  let _catalogoCache = [];

  async function _cargarCatalogo() {
    if (_catalogoCache.length) return _catalogoCache;
    const { getDocs, query: q2, collection: col2, orderBy: ob2 } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const snap = await getDocs(q2(col2(db, "productos"), ob2("nombre")));
    _catalogoCache = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.activo !== false);
    return _catalogoCache;
  }

  function _invSelProducto(prod) {
    document.getElementById("inv-prod-id").value  = prod.codigo || prod.id;
    document.getElementById("inv-prod-nom").value = prod.nombre;
    document.getElementById("inv-chip-nombre").textContent = prod.nombre;
    document.getElementById("inv-chip-codigo").textContent = `Código: ${prod.codigo || prod.id}`;
    document.getElementById("inv-prod-chip").style.display   = "flex";
    document.getElementById("inv-prod-search").style.display = "none";
    document.getElementById("inv-prod-lista").style.display  = "none";
    // Pre-poblar N10 si el producto ya tiene familia definida
    if (prod.familia) {
      const famEl = document.getElementById("inv-familia");
      const litEl = document.getElementById("inv-litros-u");
      const wrap  = document.getElementById("inv-litros-wrap");
      if (famEl) famEl.value = prod.familia;
      if (litEl) litEl.value = prod.litros_por_unidad || "";
      if (wrap)  wrap.style.opacity = prod.familia === "N10" ? "1" : ".4";
    }
  }

  window._invLimpiarProducto = () => {
    document.getElementById("inv-prod-id").value  = "";
    document.getElementById("inv-prod-nom").value = "";
    document.getElementById("inv-prod-chip").style.display   = "none";
    document.getElementById("inv-prod-search").style.display = "";
    document.getElementById("inv-prod-search").value = "";
    document.getElementById("inv-prod-search").focus();
  };

  const searchEl = document.getElementById("inv-prod-search");
  const listaEl  = document.getElementById("inv-prod-lista");

  searchEl?.addEventListener("focus", async () => {
    await _cargarCatalogo();
    _renderLista(searchEl.value);
  });

  searchEl?.addEventListener("input", () => _renderLista(searchEl.value));

  document.addEventListener("click", e => {
    if (!listaEl?.contains(e.target) && e.target !== searchEl)
      listaEl && (listaEl.style.display = "none");
  });

  function _renderLista(term) {
    if (!listaEl) return;
    const t = term.toLowerCase().trim();
    const matches = _catalogoCache.filter(p =>
      !t ||
      (p.nombre||"").toLowerCase().includes(t) ||
      (p.codigo||"").toLowerCase().includes(t) ||
      (p.categoria||"").toLowerCase().includes(t)
    ).slice(0, 40);

    if (!matches.length) {
      listaEl.innerHTML = `<div style="padding:12px 14px;font-size:12px;color:#64748B;text-align:center">
        Sin resultados para "${esc(term)}"</div>`;
      listaEl.style.display = "block";
      return;
    }

    listaEl.innerHTML = matches.map(p => {
      const n10 = p.familia === "N10"
        ? `<span style="font-size:9px;background:#6366F122;color:#818CF8;border-radius:4px;
            padding:1px 5px;margin-left:4px;font-weight:700">N10</span>` : "";
      return `
        <div data-prod-idx="${_catalogoCache.indexOf(p)}"
          style="padding:9px 14px;cursor:pointer;border-bottom:1px solid var(--border);
            display:flex;align-items:center;gap:10px;transition:background .1s"
          onmouseenter="this.style.background='#6366F110'"
          onmouseleave="this.style.background='transparent'">
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:600;color:var(--text-primary);
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${esc(p.nombre)}${n10}
            </div>
            <div style="font-size:10px;color:#64748B;margin-top:1px">
              ${p.codigo ? `<span style="font-family:monospace">${esc(p.codigo)}</span>` : ""}
              ${p.categoria ? ` · ${esc(p.categoria)}` : ""}
              ${p.precio_base ? ` · $${Number(p.precio_base).toLocaleString("es-MX")}` : ""}
            </div>
          </div>
        </div>`;
    }).join("");

    listaEl.querySelectorAll("[data-prod-idx]").forEach(el => {
      el.addEventListener("click", () => {
        const prod = _catalogoCache[parseInt(el.dataset.prodIdx)];
        if (prod) _invSelProducto(prod);
      });
    });

    listaEl.style.display = "block";
  }

  // ── Modal lifecycle ───────────────────────────────────────────
  const cerrarModal = () => {
    document.getElementById("inv-modal")?.classList.add("hidden");
    // Resetear buscador
    window._invLimpiarProducto?.();
    document.getElementById("inv-cantidad").value = "";
    document.getElementById("inv-motivo").value   = "";
    document.getElementById("inv-familia").value  = "";
    document.getElementById("inv-litros-u").value = "";
    document.getElementById("inv-litros-wrap").style.opacity = ".4";
  };

  document.getElementById("inv-ajuste-btn")?.addEventListener("click", async () => {
    document.getElementById("inv-modal-title").textContent = "Ajuste de inventario";
    window._invSelTipo("AJUSTE_ENTRADA");
    document.getElementById("inv-modal")?.classList.remove("hidden");
    // Precarga catálogo en background para que el buscador sea inmediato
    _cargarCatalogo();
  });
  document.getElementById("inv-modal-close")?.addEventListener("click", cerrarModal);
  document.getElementById("inv-cancel")?.addEventListener("click", cerrarModal);
  document.getElementById("inv-guardar")?.addEventListener("click", _guardarAjuste);
  document.getElementById("inv-modal")?.addEventListener("click", e => {
    if (e.target === document.getElementById("inv-modal")) cerrarModal();
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
    tbody.innerHTML = `<tr><td colspan="9" style="padding:32px;text-align:center;color:var(--text-sec)">Sin productos</td></tr>`;
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
      <td style="font-size:11px;color:var(--text-sec)">${esc(r.sku||"–")}</td>
      <td style="text-align:right;font-weight:800;font-size:15px;color:${color}">${stock}</td>
      <td style="text-align:right;color:var(--text-sec)">${min}</td>
      <td style="font-size:12px">${esc(r.unidad||"pza")}</td>
      <td style="text-align:right;font-size:12px">${fmtMXN(r.costo)}</td>
      <td>
        ${badge}
        <div style="margin-top:4px;height:5px;border-radius:3px;background:var(--border)">
          <div style="height:5px;border-radius:3px;background:${color};width:${pct}%;max-width:100%;transition:width .3s"></div>
        </div>
      </td>
      <td style="font-size:11px;color:var(--text-sec);white-space:nowrap">${fmtFecha(r._ts)}</td>
      ${_puedeEditar() ? `<td>${editBtn}</td>` : ""}
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".inv-edit-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { id, nom } = btn.dataset;
      document.getElementById("inv-modal-title").textContent = `Editar: ${nom}`;
      window._invSelTipo?.("AJUSTE_ENTRADA");

      // Mostrar chip del producto (fijo, el user no puede cambiarlo aquí)
      document.getElementById("inv-prod-id").value  = id;
      document.getElementById("inv-prod-nom").value = nom;
      document.getElementById("inv-chip-nombre").textContent = nom;
      document.getElementById("inv-chip-codigo").textContent = `ID: ${id}`;
      document.getElementById("inv-prod-chip").style.display   = "flex";
      document.getElementById("inv-prod-search").style.display = "none";

      // Pre-poblar campos N10 desde Firestore
      try {
        const snap = await getDoc(doc(db, "inventario", id));
        if (snap.exists()) {
          const d = snap.data();
          const famEl  = document.getElementById("inv-familia");
          const litEl  = document.getElementById("inv-litros-u");
          const wrap   = document.getElementById("inv-litros-wrap");
          if (famEl) famEl.value = d.familia || "";
          if (litEl) litEl.value = d.litros_por_unidad || "";
          if (wrap)  wrap.style.opacity = d.familia === "N10" ? "1" : ".4";
        }
      } catch { /* no bloquear si falla */ }
      document.getElementById("inv-modal")?.classList.remove("hidden");
    });
  });
}

async function _guardarAjuste() {
  const tipo      = document.getElementById("inv-tipo")?.value;
  const prodId    = document.getElementById("inv-prod-id")?.value.trim();
  const prodNom   = document.getElementById("inv-prod-nom")?.value.trim();
  const cant      = parseFloat(document.getElementById("inv-cantidad")?.value || "0");
  const motivo    = document.getElementById("inv-motivo")?.value.trim();
  const familia   = document.getElementById("inv-familia")?.value || "";
  const litrosU   = parseFloat(document.getElementById("inv-litros-u")?.value || "0");

  if (!prodId || !prodNom) { window.toast?.("Selecciona un producto del catálogo", "error"); return; }
  if (cant < 0) { window.toast?.("La cantidad no puede ser negativa", "error"); return; }

  const n10Meta = familia === "N10" ? { familia: "N10", litros_por_unidad: litrosU || 0 }
                                    : { familia: familia || null, litros_por_unidad: 0 };

  const btn = document.getElementById("inv-guardar");
  btn.disabled = true; btn.textContent = "Guardando…";
  try {
    const invRef = doc(db, "inventario", prodId);
    const snap   = await getDoc(invRef);
    const stockAntes = snap.exists() ? (snap.data().stockActual ?? 0) : 0;
    let stockDespues = cant;

    if (tipo === "EDITAR_MINIMO") {
      await setDoc(invRef, { nombre: prodNom, stockMinimo: cant, ...n10Meta, _ts: Date.now() }, { merge: true });
      window.toast?.("Mínimo actualizado", "success");
    } else {
      if (tipo === "AJUSTE_ENTRADA")    stockDespues = stockAntes + cant;
      else if (tipo === "AJUSTE_SALIDA") stockDespues = Math.max(0, stockAntes - cant);

      await addDoc(collection(db, "movimientos_stock"), {
        productoId: prodId, nombreProducto: prodNom, tipo, cantidad: cant,
        stockAntes, stockDespues, motivo,
        quienRegistro: Sesion.alias, _ts: Date.now()
      });
      await setDoc(invRef, { nombre: prodNom, stockActual: stockDespues, ...n10Meta, _ts: Date.now() }, { merge: true });
      logAudit(tipo === "AJUSTE_ENTRADA" ? "STOCK_ENTRADA" : tipo === "AJUSTE_SALIDA" ? "STOCK_SALIDA" : "AJUSTE_INVENTARIO",
        { productoId: prodId, productoNombre: prodNom, cantidad: cant, stockAntes, stockDespues, motivo });
      window.toast?.("Ajuste guardado", "success");
    }
    document.getElementById("inv-modal")?.classList.add("hidden");
    document.getElementById("inv-prod-id").disabled  = false;
    document.getElementById("inv-prod-nom").disabled = false;
    document.getElementById("inv-cantidad").value  = "";
    document.getElementById("inv-motivo").value    = "";
    document.getElementById("inv-familia").value   = "";
    document.getElementById("inv-litros-u").value  = "";
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
      <span style="font-size:11px;color:var(--text-sec)">Desde</span>
      <input type="date" class="sel-sm" id="mov-desde" value="${hace7}">
      <span style="font-size:11px;color:var(--text-sec)">Hasta</span>
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
          <tr><td colspan="8" style="padding:24px;text-align:center;color:var(--text-sec)">Cargando…</td></tr>
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
      tbody.innerHTML = `<tr><td colspan="8" style="padding:32px;text-align:center;color:var(--text-sec)">Sin movimientos</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => `<tr>
      <td style="font-size:11px;color:var(--text-sec);white-space:nowrap">${fmtFecha(r._ts)}</td>
      <td style="font-size:12px">${ICON[r.tipo]||"•"} ${esc(r.tipo||"–")}</td>
      <td style="font-weight:600">${esc(r.nombreProducto||r.productoId||"–")}</td>
      <td style="text-align:right;font-weight:700">${r.cantidad??""}</td>
      <td style="text-align:right;color:var(--text-sec)">${r.stockAntes??""}</td>
      <td style="text-align:right;font-weight:700">${r.stockDespues??""}</td>
      <td style="font-size:11px;color:var(--text-sec);max-width:200px">${esc(r.motivo||r.folio||r.pedidoId||"–")}</td>
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
