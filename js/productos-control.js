// ══════════════════════════════════════════════════════════════
// productos-control.js — Catálogo de productos (layout Pretoriano)
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import { exportarExcel, descargarPlantilla, importarExcel, toolbarHTML, puedeImportar } from "./excel-utils.js";
import {
  collection, doc, query, orderBy, onSnapshot,
  updateDoc, addDoc, serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Columnas Excel ────────────────────────────────────────────
const _COLS_PROD = [
  { key: "codigo",         header: "Código N10",       width: 14, required: true },
  { key: "nombre",         header: "Nombre",            width: 30, required: true },
  { key: "descripcion",    header: "Descripción",       width: 30 },
  { key: "marca",          header: "Marca",             width: 16 },
  { key: "categoria",      header: "Categoría",         width: 16 },
  { key: "subcategoria",   header: "Subcategoría",      width: 16 },
  { key: "precio_base",    header: "Precio cliente",    width: 14, tipo: "numero" },
  { key: "clave_sat",      header: "Clave SAT",         width: 12 },
  { key: "peso",           header: "Peso",              width: 10, tipo: "numero" },
  { key: "impuesto",       header: "Impuesto",          width: 16 },
  { key: "activo",         header: "Activo (SI/NO)",    width: 12, tipo: "booleano" },
];

// ── Funciones globales Excel ──────────────────────────────────
window.Prod_xlExport = async function() {
  try {
    const { getDocs, collection: col } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const { db: fdb } = await import("./firebase-config.js");
    const snap = await getDocs(col(fdb, "productos"));
    const rows = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    exportarExcel(rows, _COLS_PROD, "Productos", "Productos");
  } catch(e) { window.toast?.("Error al exportar.", "error"); }
};
window.Prod_xlPlantilla = function() { descargarPlantilla(_COLS_PROD, "Productos", "Productos"); };
window.Prod_xlImport = async function() {
  if (!puedeImportar()) { window.toast?.("Sin permisos para importar.", "error"); return; }
  try {
    const registros = await importarExcel(_COLS_PROD);
    if (!registros.length) return;
    const { doc: d, setDoc, serverTimestamp: st } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const { db: fdb } = await import("./firebase-config.js");
    let ok = 0, err = 0;
    for (const r of registros) {
      try {
        const id = r.codigo || r.id;
        await setDoc(d(fdb, "productos", id), { ...r, actualizadoPor: window.Sesion?.alias ?? "import", actualizadoEn: st() }, { merge: true });
        ok++;
      } catch { err++; }
    }
    window.toast?.(`Importación: ${ok} productos${err ? `, ${err} errores` : ""}.`, ok > 0 ? "success" : "error");
  } catch(e) { window.toast?.("Error en importación.", "error"); }
};

const fmtMXN = v => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(v || 0);

const ROLES_LECTURA = ["SUPER_ADMIN","GERENTE","ADMINISTRADOR","GERENTE_ZONA"];
const PUEDE_EDITAR  = () => Sesion.esSuperAdmin() || Sesion.tieneFlag?.("PUEDE_EDITAR_PRECIO") || Sesion.rol === "GERENTE";

let _unsubs       = [];
let _todos        = [];
let _busqueda     = "";
let _filtroActivo = "todos";

export const ProductosControlModule = {
  mount(container) {
    if (!ROLES_LECTURA.includes(Sesion.rol) && !Sesion.esSuperAdmin()) {
      container.innerHTML = `<div class="empty-state" style="flex:1;justify-content:center">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-title">Acceso restringido</div>
        <div class="empty-state-sub">Solo gerentes y administradores pueden ver el catálogo.</div>
      </div>`;
      return;
    }
    container.innerHTML = _html();
    _bindUI();
    _escuchar();
    return () => this.destroy();
  },
  destroy() {
    _unsubs.forEach(fn => fn && fn());
    _unsubs = []; _todos = []; _busqueda = ""; _filtroActivo = "todos";
  }
};

// ── HTML ──────────────────────────────────────────────────────
function _html() {
  return `
  <div style="display:flex;flex-direction:column;height:100%">

    <!-- Header -->
    <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;
      border-bottom:1px solid var(--c-border);flex-shrink:0;flex-wrap:wrap">
      <div>
        <div style="font-size:13px;font-weight:800;color:var(--c-text)">Catálogo de Productos</div>
        <div style="font-size:10.5px;color:#9CA3AF" id="pc-subtitle">Cargando…</div>
      </div>
      <div style="flex:1"></div>
      <input id="pc-buscar" type="text"
        placeholder="Buscar por Nombre / Descripción / Código / Clave SAT…"
        style="padding:7px 12px;border-radius:6px;border:1px solid var(--c-border);
          background:var(--c-surface);color:var(--c-text);font-size:12px;width:300px">
      ${PUEDE_EDITAR() ? `
        <button onclick="ProdCtrlUI.abrirAltaProducto()"
          style="padding:7px 16px;border-radius:6px;border:none;background:#1B5E20;
            color:#fff;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap">
          Nuevo Normal
        </button>
        <button onclick="ProdCtrlUI.abrirAltaExpress()"
          style="padding:7px 16px;border-radius:6px;border:1px solid var(--c-border);
            background:transparent;color:var(--c-text);font-size:12px;font-weight:700;
            cursor:pointer;white-space:nowrap">
          Nuevo Express
        </button>` : ""}
    </div>

    <!-- KPIs -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0;flex-shrink:0;
      border-bottom:1px solid var(--c-border)">
      ${[["pc-kpi-total","Total","#9CA3AF"],["pc-kpi-activos","Activos","#4ADE80"],
         ["pc-kpi-inact","Inactivos","#F87171"],["pc-kpi-sinprecio","Sin precio","#FBBF24"]
        ].map(([id,lbl,col]) => `
        <div style="padding:12px 18px;border-right:1px solid var(--c-border)">
          <div style="font-size:10px;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">${lbl}</div>
          <div id="${id}" style="font-size:18px;font-weight:800;color:${col}">–</div>
        </div>`).join("")}
    </div>

    <!-- Filtros + toolbar -->
    <div style="display:flex;align-items:center;gap:8px;padding:10px 20px;
      border-bottom:1px solid var(--c-border);flex-shrink:0;flex-wrap:wrap">
      ${["todos","activos","inactivos"].map(f => `
        <button class="filter-pill ${f==="todos"?"active":""}" data-filtro="${f}"
          onclick="ProdCtrlUI.setFiltro('${f}')">
          ${{todos:"Todos",activos:"Activos",inactivos:"Inactivos"}[f]}
        </button>`).join("")}
      <div style="flex:1"></div>
      ${toolbarHTML("Prod")}
    </div>

    <!-- Tabla -->
    <div style="flex:1;overflow-y:auto">
      <div style="overflow-x:auto;min-width:100%">
        <table style="width:100%;border-collapse:collapse;font-size:12px" id="pc-table">
          <thead>
            <tr style="background:var(--c-surface2,#1E293B);border-bottom:2px solid var(--c-border);
              position:sticky;top:0;z-index:1">
              <th style="${_th()}"><input type="checkbox" id="pc-chk-all" onchange="ProdCtrlUI.toggleTodos(this.checked)"
                style="cursor:pointer"></th>
              <th style="${_th()}">ID</th>
              <th style="${_th()}">CÓDIGO</th>
              <th style="${_th()}">CLAVE SAT</th>
              <th style="${_th()}">NOMBRE SUCURSAL</th>
              <th style="${_th(true)}">NOMBRE</th>
              <th style="${_th()}">PRECIO</th>
              <th style="${_th()}">MARCA</th>
              <th style="${_th()}">CATEGORÍA</th>
              <th style="${_th()}">PESO</th>
              <th style="${_th()}">STOCK</th>
              <th style="${_th(true)}">DESCRIPCIÓN</th>
              <th style="${_th()}">CON O SIN IMPUESTO</th>
              <th style="${_th()}">MAT. PRIMA</th>
              ${PUEDE_EDITAR() ? `<th style="${_th()}">ACCIONES</th>` : ""}
            </tr>
          </thead>
          <tbody id="pc-tbody">
            <tr><td colspan="15" style="text-align:center;color:#9CA3AF;padding:40px">Cargando…</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ── Modal Edición completa ── -->
    <div id="pc-modal-edit" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);
      z-index:1000;align-items:center;justify-content:center;padding:16px">
      <div style="background:var(--c-surface);border-radius:14px;width:560px;max-width:100%;
        max-height:90vh;overflow-y:auto;border:1px solid var(--c-border);padding:28px">
        <div style="font-size:15px;font-weight:800;color:var(--c-text);margin-bottom:20px"
          id="pc-edit-titulo">Editar producto</div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          ${_field("pc-e-nombre",      "Nombre*",          "text",   "Nombre del producto")}
          ${_field("pc-e-codigo",      "Código N10",       "text",   "N10-0001")}
          ${_field("pc-e-clave_sat",   "Clave SAT",        "text",   "Ej. 10101502")}
          ${_field("pc-e-nombre_suc",  "Nombre Sucursal",  "text",   "Nutricion de 10")}
          ${_field("pc-e-marca",       "Marca",            "text",   "BAYER")}
          ${_field("pc-e-categoria",   "Categoría",        "text",   "Herbicida")}
          ${_field("pc-e-subcategoria","Subcategoría",     "text",   "")}
          ${_field("pc-e-precio",      "Precio cliente ($)","number","0.00")}
          ${_field("pc-e-costo",       "Costo ($)",        "number", "0.00")}
          ${_field("pc-e-peso",        "Peso",             "number", "0.0")}
        </div>

        <div style="margin-bottom:12px">
          <label style="font-size:11px;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Descripción</label>
          <textarea id="pc-e-descripcion" rows="2"
            style="width:100%;padding:7px 10px;border:1px solid var(--c-border);border-radius:6px;
              font-size:12px;background:var(--c-surface);color:var(--c-text);box-sizing:border-box;
              resize:vertical;font-family:inherit"></textarea>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">
          <div>
            <label style="font-size:11px;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Impuesto</label>
            <select id="pc-e-impuesto"
              style="width:100%;padding:7px 10px;border:1px solid var(--c-border);border-radius:6px;
                font-size:12px;background:var(--c-surface);color:var(--c-text);box-sizing:border-box">
              <option value="Exento">Exento de Impuesto</option>
              <option value="IVA">Con IVA 16%</option>
              <option value="IEPS">Con IEPS</option>
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:10px;padding-top:18px">
            <label style="font-size:11px;font-weight:600;color:#6B7280">Materia prima</label>
            <input type="checkbox" id="pc-e-materia_prima" style="width:16px;height:16px;cursor:pointer">
            <label style="font-size:11px;font-weight:600;color:#6B7280;margin-left:16px">Activo</label>
            <input type="checkbox" id="pc-e-activo" style="width:16px;height:16px;cursor:pointer">
          </div>
        </div>

        <div id="pc-edit-error" style="display:none;background:#FEE2E2;border-radius:6px;
          padding:8px 12px;font-size:11.5px;color:#DC2626;margin-bottom:12px"></div>

        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button onclick="ProdCtrlUI.cerrarEdicion()"
            style="padding:8px 18px;border:1px solid var(--c-border);border-radius:6px;
              background:transparent;color:var(--c-text);font-size:12px;cursor:pointer">
            Cancelar
          </button>
          <button onclick="ProdCtrlUI.guardarEdicion()"
            style="padding:8px 22px;border:none;border-radius:6px;
              background:#1B5E20;color:#fff;font-size:12px;font-weight:700;cursor:pointer"
            id="pc-edit-save-btn">
            Guardar cambios
          </button>
        </div>
      </div>
    </div>

    <!-- ── Modal Nuevo Express (solo nombre + precio) ── -->
    <div id="pc-modal-express" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);
      z-index:1000;align-items:center;justify-content:center;padding:16px">
      <div style="background:var(--c-surface);border-radius:14px;width:360px;max-width:100%;
        border:1px solid var(--c-border);padding:24px">
        <div style="font-size:14px;font-weight:800;color:var(--c-text);margin-bottom:16px">Nuevo producto (express)</div>
        <div style="margin-bottom:12px">
          <label style="font-size:11px;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Nombre*</label>
          <input id="pe-nombre" type="text" maxlength="120" placeholder="Nombre del producto"
            style="width:100%;padding:7px 10px;border:1px solid var(--c-border);border-radius:6px;
              font-size:13px;background:var(--c-surface);color:var(--c-text);box-sizing:border-box">
        </div>
        <div style="margin-bottom:18px">
          <label style="font-size:11px;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">Precio cliente ($)</label>
          <input id="pe-precio" type="number" min="0" step="0.01" placeholder="0.00"
            style="width:100%;padding:7px 10px;border:1px solid var(--c-border);border-radius:6px;
              font-size:13px;background:var(--c-surface);color:var(--c-text);box-sizing:border-box">
        </div>
        <div id="pc-express-error" style="display:none;background:#FEE2E2;border-radius:6px;
          padding:8px 12px;font-size:11.5px;color:#DC2626;margin-bottom:12px"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button onclick="document.getElementById('pc-modal-express').style.display='none'"
            style="padding:8px 18px;border:1px solid var(--c-border);border-radius:6px;
              background:transparent;color:var(--c-text);font-size:12px;cursor:pointer">Cancelar</button>
          <button onclick="ProdCtrlUI.guardarExpress()"
            style="padding:8px 22px;border:none;border-radius:6px;
              background:#1B5E20;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
            Guardar
          </button>
        </div>
      </div>
    </div>
  </div>`;
}

function _th(wide) {
  return `padding:9px 10px;text-align:left;font-size:10px;font-weight:700;
    color:#9CA3AF;letter-spacing:.05em;white-space:nowrap;
    ${wide ? "min-width:180px;" : ""}`;
}

function _field(id, label, type, placeholder) {
  return `<div>
    <label style="font-size:11px;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">${label}</label>
    <input id="${id}" type="${type}" placeholder="${placeholder}"
      style="width:100%;padding:7px 10px;border:1px solid var(--c-border);border-radius:6px;
        font-size:12px;background:var(--c-surface);color:var(--c-text);box-sizing:border-box"
      ${type==="number" ? 'min="0" step="0.01"' : 'maxlength="120"'}>
  </div>`;
}

// ── Listener Firestore ────────────────────────────────────────
function _escuchar() {
  const q = query(collection(db, "productos"), orderBy("numero"), limit(2000));
  const unsub = onSnapshot(q, snap => {
    _todos = snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
    _renderizar();
  }, err => {
    console.error("[Productos]", err);
    window.toast?.("Error al cargar productos", "error");
  });
  _unsubs.push(unsub);
}

// ── Render ────────────────────────────────────────────────────
function _renderizar() {
  const tbody = document.getElementById("pc-tbody");
  if (!tbody) return;

  const filtrados   = _aplicarFiltros();
  const puedeEditar = PUEDE_EDITAR();

  // KPIs
  _setText("pc-kpi-total",    _todos.length);
  _setText("pc-kpi-activos",  _todos.filter(p => p.activo !== false).length);
  _setText("pc-kpi-inact",    _todos.filter(p => p.activo === false).length);
  _setText("pc-kpi-sinprecio",_todos.filter(p => !(p.precio_base > 0)).length);
  const sub = document.getElementById("pc-subtitle");
  if (sub) sub.textContent = `${filtrados.length} de ${_todos.length} productos`;

  if (!filtrados.length) {
    tbody.innerHTML = `<tr><td colspan="15" style="text-align:center;color:#9CA3AF;padding:40px">
      <div style="font-size:24px;margin-bottom:8px">📦</div>
      ${_busqueda ? "Sin resultados para la búsqueda." : "Sin productos en catálogo."}
    </td></tr>`;
    return;
  }

  const COL_TD = "padding:8px 10px;border-bottom:1px solid var(--c-border);white-space:nowrap;";

  tbody.innerHTML = filtrados.map((p, i) => {
    const activo   = p.activo !== false;
    const num      = p.numero ?? (i + 1);
    const codigo   = p.codigo ?? p._docId;
    const matPrima = p.materia_prima === true ? "Sí" : "–";
    const impuesto = p.impuesto
      ? (p.impuesto === "Exento" ? "Exento de Impuesto"
        : p.impuesto === "IVA"   ? "Con IVA 16%"
        : p.impuesto)
      : "Exento de Impuesto";

    return `<tr style="${!activo ? "opacity:.5;" : ""}background:${i%2===1?"var(--c-surface2,rgba(255,255,255,.02))":"transparent"}">
      <td style="${COL_TD}"><input type="checkbox" class="pc-chk-row" data-id="${esc(p._docId)}" style="cursor:pointer"></td>
      <td style="${COL_TD}color:#9CA3AF">${num}</td>
      <td style="${COL_TD}font-weight:600;color:var(--c-text)">${esc(codigo)}</td>
      <td style="${COL_TD}color:#6B7280">${esc(p.clave_sat || "Sin clave SAT")}</td>
      <td style="${COL_TD}color:#6B7280">${esc(p.nombre_sucursal || "Nutricion de 10")}</td>
      <td style="${COL_TD}max-width:220px;overflow:hidden;text-overflow:ellipsis;
        font-weight:600;color:var(--c-text)" title="${esc(p.nombre)}">${esc(p.nombre || "–")}</td>
      <td style="${COL_TD}text-align:right;font-weight:700;font-variant-numeric:tabular-nums;
        color:${p.precio_base > 0 ? "#4ADE80" : "#F87171"}">
        ${p.precio_base > 0 ? fmtMXN(p.precio_base) : "–"}
      </td>
      <td style="${COL_TD}color:#6B7280">${esc(p.marca || "–")}</td>
      <td style="${COL_TD}color:#6B7280">${esc(p.categoria || "–")}</td>
      <td style="${COL_TD}color:#6B7280;text-align:right">${p.peso > 0 ? p.peso : "–"}</td>
      <td style="${COL_TD}color:#6B7280;text-align:right">${p.stock ?? "–"}</td>
      <td style="${COL_TD}max-width:200px;overflow:hidden;text-overflow:ellipsis;
        color:#9CA3AF" title="${esc(p.descripcion)}">${esc(p.descripcion || "–")}</td>
      <td style="${COL_TD}color:#6B7280">${esc(impuesto)}</td>
      <td style="${COL_TD}color:#6B7280;text-align:center">${matPrima}</td>
      ${puedeEditar ? `<td style="${COL_TD}">
        <div style="display:flex;gap:6px;align-items:center">
          <button onclick="ProdCtrlUI.abrirEdicion('${esc(p._docId)}')" title="Editar"
            style="font-size:16px;background:transparent;border:none;cursor:pointer;padding:2px 4px;color:#FBBF24">✏</button>
          <button onclick="ProdCtrlUI.toggleActivo('${esc(p._docId)}',${!activo})" title="${activo?"Desactivar":"Activar"}"
            style="font-size:16px;background:transparent;border:none;cursor:pointer;padding:2px 4px;
              color:${activo?"#F87171":"#4ADE80"}">
            ${activo ? "⊘" : "✓"}
          </button>
        </div>
      </td>` : ""}
    </tr>`;
  }).join("");
}

function _aplicarFiltros() {
  let lista = _todos;
  if (_filtroActivo === "activos")   lista = lista.filter(p => p.activo !== false);
  if (_filtroActivo === "inactivos") lista = lista.filter(p => p.activo === false);
  if (_busqueda.length >= 2) {
    const q = _busqueda.toLowerCase();
    lista = lista.filter(p =>
      (p.nombre      || "").toLowerCase().includes(q) ||
      (p.descripcion || "").toLowerCase().includes(q) ||
      (p.codigo      || "").toLowerCase().includes(q) ||
      (p.clave_sat   || "").toLowerCase().includes(q) ||
      (p.marca       || "").toLowerCase().includes(q) ||
      (p.categoria   || "").toLowerCase().includes(q)
    );
  }
  return lista;
}

// ── UI Actions ────────────────────────────────────────────────
function _bindUI() {
  let _editandoId = null;

  const input = document.getElementById("pc-buscar");
  if (input) {
    let t;
    input.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => { _busqueda = input.value.trim(); _renderizar(); }, 250);
    });
  }

  window.ProdCtrlUI = {

    setFiltro(f) {
      _filtroActivo = f;
      document.querySelectorAll("[data-filtro]").forEach(b =>
        b.classList.toggle("active", b.dataset.filtro === f));
      _renderizar();
    },

    toggleTodos(checked) {
      document.querySelectorAll(".pc-chk-row").forEach(c => { c.checked = checked; });
    },

    // ── Editar producto completo ──────────────────────────────
    abrirEdicion(docId) {
      const p = _todos.find(x => x._docId === docId);
      if (!p) return;
      _editandoId = docId;

      _val("pc-e-nombre",       p.nombre      ?? "");
      _val("pc-e-codigo",       p.codigo      ?? docId);
      _val("pc-e-clave_sat",    p.clave_sat   ?? "");
      _val("pc-e-nombre_suc",   p.nombre_sucursal ?? "Nutricion de 10");
      _val("pc-e-marca",        p.marca       ?? "");
      _val("pc-e-categoria",    p.categoria   ?? "");
      _val("pc-e-subcategoria", p.subcategoria ?? "");
      _val("pc-e-precio",       p.precio_base ?? "");
      _val("pc-e-costo",        p.costo_base  ?? "");
      _val("pc-e-peso",         p.peso        ?? "");
      _val("pc-e-descripcion",  p.descripcion ?? "");

      const selImp = document.getElementById("pc-e-impuesto");
      if (selImp) selImp.value = p.impuesto ?? "Exento";

      const chkMat = document.getElementById("pc-e-materia_prima");
      if (chkMat) chkMat.checked = p.materia_prima === true;

      const chkAct = document.getElementById("pc-e-activo");
      if (chkAct) chkAct.checked = p.activo !== false;

      _setText("pc-edit-titulo", `Editar: ${p.nombre || docId}`);
      const err = document.getElementById("pc-edit-error");
      if (err) err.style.display = "none";
      document.getElementById("pc-modal-edit").style.display = "flex";
      setTimeout(() => document.getElementById("pc-e-nombre")?.focus(), 80);
    },

    cerrarEdicion() {
      document.getElementById("pc-modal-edit").style.display = "none";
      _editandoId = null;
    },

    async guardarEdicion() {
      if (!_editandoId) return;
      const nombre = document.getElementById("pc-e-nombre")?.value.trim();
      if (!nombre) {
        const err = document.getElementById("pc-edit-error");
        err.textContent = "El nombre es obligatorio."; err.style.display = "block"; return;
      }
      const btn = document.getElementById("pc-edit-save-btn");
      if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

      try {
        const data = {
          nombre,
          codigo:          document.getElementById("pc-e-codigo")?.value.trim() || _editandoId,
          clave_sat:       document.getElementById("pc-e-clave_sat")?.value.trim()    || "",
          nombre_sucursal: document.getElementById("pc-e-nombre_suc")?.value.trim()  || "Nutricion de 10",
          marca:           document.getElementById("pc-e-marca")?.value.trim()        || "",
          categoria:       document.getElementById("pc-e-categoria")?.value.trim()    || "",
          subcategoria:    document.getElementById("pc-e-subcategoria")?.value.trim() || "",
          descripcion:     document.getElementById("pc-e-descripcion")?.value.trim()  || "",
          precio_base:     parseFloat(document.getElementById("pc-e-precio")?.value) || 0,
          costo_base:      parseFloat(document.getElementById("pc-e-costo")?.value)  || 0,
          peso:            parseFloat(document.getElementById("pc-e-peso")?.value)   || 0,
          impuesto:        document.getElementById("pc-e-impuesto")?.value || "Exento",
          materia_prima:   document.getElementById("pc-e-materia_prima")?.checked === true,
          activo:          document.getElementById("pc-e-activo")?.checked !== false,
          modificadoPor:   Sesion.alias,
          modificadoEn:    serverTimestamp()
        };
        await updateDoc(doc(db, "productos", _editandoId), data);
        window.toast?.("Producto actualizado.", "success");
        this.cerrarEdicion();
      } catch(e) {
        const err = document.getElementById("pc-edit-error");
        err.textContent = "Error: " + e.message; err.style.display = "block";
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Guardar cambios"; }
      }
    },

    // ── Nuevo Express ─────────────────────────────────────────
    abrirAltaExpress() {
      _val("pe-nombre", ""); _val("pe-precio", "");
      const err = document.getElementById("pc-express-error");
      if (err) err.style.display = "none";
      document.getElementById("pc-modal-express").style.display = "flex";
      setTimeout(() => document.getElementById("pe-nombre")?.focus(), 80);
    },

    async guardarExpress() {
      const nombre = document.getElementById("pe-nombre")?.value.trim();
      const precio = parseFloat(document.getElementById("pe-precio")?.value) || 0;
      const err    = document.getElementById("pc-express-error");
      if (!nombre) { err.textContent = "Nombre obligatorio."; err.style.display = "block"; return; }
      try {
        const num = Math.max(..._todos.map(p => p.numero ?? 0), 0) + 1;
        await addDoc(collection(db, "productos"), {
          nombre, precio_base: precio, activo: true, numero: num,
          nombre_sucursal: "Nutricion de 10", impuesto: "Exento",
          materia_prima: false, peso: 0, clave_sat: "", costo_base: 0,
          creadoPor: Sesion.alias, creadoEn: serverTimestamp()
        });
        window.toast?.(`"${nombre}" agregado.`, "success");
        document.getElementById("pc-modal-express").style.display = "none";
      } catch(e) { err.textContent = "Error: " + e.message; err.style.display = "block"; }
    },

    // ── Nuevo Normal ──────────────────────────────────────────
    abrirAltaProducto() {
      _editandoId = null;
      ["pc-e-nombre","pc-e-codigo","pc-e-clave_sat","pc-e-nombre_suc",
       "pc-e-marca","pc-e-categoria","pc-e-subcategoria",
       "pc-e-precio","pc-e-costo","pc-e-peso","pc-e-descripcion"
      ].forEach(id => _val(id, id === "pc-e-nombre_suc" ? "Nutricion de 10" : ""));
      const selImp = document.getElementById("pc-e-impuesto");
      if (selImp) selImp.value = "Exento";
      const chkM = document.getElementById("pc-e-materia_prima"); if (chkM) chkM.checked = false;
      const chkA = document.getElementById("pc-e-activo"); if (chkA) chkA.checked = true;
      _setText("pc-edit-titulo", "Nuevo producto");
      const err = document.getElementById("pc-edit-error"); if (err) err.style.display = "none";
      document.getElementById("pc-modal-edit").style.display = "flex";
      setTimeout(() => document.getElementById("pc-e-nombre")?.focus(), 80);
    },

    async toggleActivo(docId, nuevoEstado) {
      const p = _todos.find(x => x._docId === docId);
      const accion = nuevoEstado ? "activar" : "desactivar";
      if (!confirm(`¿Deseas ${accion} "${p?.nombre ?? docId}"?`)) return;
      try {
        await updateDoc(doc(db, "productos", docId), {
          activo: nuevoEstado, modificadoPor: Sesion.alias, modificadoEn: serverTimestamp()
        });
        window.toast?.(`Producto ${nuevoEstado ? "activado" : "desactivado"}`, "success");
      } catch(e) { window.toast?.("Error: " + e.message, "error"); }
    }
  };
}

// ── Helpers ───────────────────────────────────────────────────
function _setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = String(val ?? ""); }
function _val(id, v)       { const el = document.getElementById(id); if (el) el.value = String(v ?? ""); }

function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
