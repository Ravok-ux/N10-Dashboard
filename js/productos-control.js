// ══════════════════════════════════════════════════════════════
// productos-control.js — Catálogo de productos: activo/inactivo
//                        y edición de precio/costo (web panel)
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import {
  collection, doc, query, orderBy, onSnapshot,
  updateDoc, addDoc, serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const fmtMXN   = v => new Intl.NumberFormat("es-MX", { style:"currency", currency:"MXN" }).format(v || 0);
const fmtPct   = v => v != null ? v.toFixed(1) + "%" : "–";
const margen   = (p, c) => c > 0 ? ((p - c) / c) * 100 : null;

const ROLES_LECTURA  = ["SUPER_ADMIN","GERENTE","ADMINISTRADOR","GERENTE_ZONA"];
const PUEDE_PRECIOS  = () => Sesion.esSuperAdmin() || Sesion.tieneFlag?.("PUEDE_EDITAR_PRECIO") ||
                             Sesion.rol === "GERENTE";

let _unsubs   = [];
let _todos    = [];
let _busqueda = "";
let _filtroActivo = "todos"; // todos | activos | inactivos

export const ProductosControlModule = {
  mount(container) {
    if (!ROLES_LECTURA.includes(Sesion.rol) && !Sesion.esSuperAdmin()) {
      container.innerHTML = `
        <div class="empty-state" style="flex:1;justify-content:center">
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
  const puedeEditar = PUEDE_PRECIOS();
  return `
  <div style="display:flex;flex-direction:column;height:100%">

    <!-- Header -->
    <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;
      border-bottom:1px solid var(--c-border);flex-shrink:0;flex-wrap:wrap">
      <div>
        <div style="font-size:13px;font-weight:800;color:var(--c-text)">Catálogo de productos</div>
        <div style="font-size:10.5px;color:#9CA3AF" id="pc-subtitle">Cargando…</div>
      </div>
      <div style="flex:1"></div>
      <input id="pc-buscar" type="text" placeholder="Buscar producto…"
        style="padding:6px 10px;border-radius:6px;border:1px solid var(--c-border);
          background:var(--c-surface);color:var(--c-text);font-size:12px;width:220px">
      <div style="display:flex;gap:6px">
        ${["todos","activos","inactivos"].map(f => `
          <button class="filter-pill ${f==="todos"?"active":""}" data-filtro="${f}"
            onclick="ProdCtrlUI.setFiltro('${f}')">
            ${{todos:"Todos",activos:"Activos",inactivos:"Inactivos"}[f]}
          </button>`).join("")}
      </div>
    </div>

    <!-- KPIs -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0;flex-shrink:0;
      border-bottom:1px solid var(--c-border)">
      ${[
        ["pc-kpi-total",    "Total productos", "#9CA3AF"],
        ["pc-kpi-activos",  "Activos",         "#4ADE80"],
        ["pc-kpi-inact",    "Inactivos",       "#F87171"],
        ["pc-kpi-sinprecio","Sin precio",      "#FBBF24"]
      ].map(([id, lbl, col]) => `
        <div style="padding:12px 18px;border-right:1px solid var(--c-border)">
          <div style="font-size:10px;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">${lbl}</div>
          <div id="${id}" style="font-size:18px;font-weight:800;color:${col}">–</div>
        </div>`).join("")}
    </div>

    ${!puedeEditar ? `<div style="padding:8px 20px;font-size:11px;color:#F59E0B;
      background:#FEF3C7;border-bottom:1px solid var(--c-border);flex-shrink:0">
      ⚠️ Solo visualización — tu rol no tiene permiso para editar precios o activar/desactivar productos.
    </div>` : ""}

    <!-- Tabla -->
    <div style="flex:1;overflow-y:auto;padding:0 20px 20px">
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:12px">
          <thead>
            <tr style="border-bottom:2px solid var(--c-border)">
              <th style="padding:8px;text-align:left;color:#6B7280;font-weight:600">Producto</th>
              <th style="padding:8px;text-align:left;color:#6B7280;font-weight:600">Categoría</th>
              <th style="padding:8px;text-align:right;color:#6B7280;font-weight:600">Precio cliente</th>
              <th style="padding:8px;text-align:right;color:#6B7280;font-weight:600">Costo</th>
              <th style="padding:8px;text-align:right;color:#6B7280;font-weight:600">Margen</th>
              <th style="padding:8px;text-align:center;color:#6B7280;font-weight:600">Estado</th>
              ${puedeEditar ? `<th style="padding:8px;text-align:center;color:#6B7280;font-weight:600">Acciones</th>` : ""}
            </tr>
          </thead>
          <tbody id="pc-tbody">
            <tr><td colspan="${puedeEditar ? 7 : 6}" style="text-align:center;color:#9CA3AF;padding:40px">
              ${window.skeletonRows ? "" : "Cargando…"}
            </td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modal editar precio/costo -->
    <div id="pc-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);
      z-index:1000;align-items:center;justify-content:center">
      <div style="background:var(--c-surface);border-radius:12px;padding:24px;
        width:360px;max-width:90vw;border:1px solid var(--c-border)">
        <div style="font-size:14px;font-weight:800;color:var(--c-text);margin-bottom:4px"
          id="pc-modal-nombre">Producto</div>
        <div style="font-size:11px;color:#9CA3AF;margin-bottom:18px" id="pc-modal-clave"></div>
        <label style="font-size:11px;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">
          Precio al cliente ($)
        </label>
        <input id="pc-modal-precio" type="number" min="0" step="0.01"
          style="width:100%;padding:8px 10px;border:1px solid var(--c-border);border-radius:6px;
            font-size:13px;background:var(--c-surface);color:var(--c-text);box-sizing:border-box;margin-bottom:14px">
        <label style="font-size:11px;font-weight:600;color:#6B7280;display:block;margin-bottom:4px">
          Costo de adquisición ($)
        </label>
        <input id="pc-modal-costo" type="number" min="0" step="0.01"
          style="width:100%;padding:8px 10px;border:1px solid var(--c-border);border-radius:6px;
            font-size:13px;background:var(--c-surface);color:var(--c-text);box-sizing:border-box;margin-bottom:6px">
        <div id="pc-modal-margen" style="font-size:11px;color:#9CA3AF;margin-bottom:18px"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button onclick="ProdCtrlUI.cerrarModal()"
            style="padding:8px 18px;border:1px solid var(--c-border);border-radius:6px;
              background:transparent;color:var(--c-text);font-size:12px;cursor:pointer">
            Cancelar
          </button>
          <button onclick="ProdCtrlUI.guardarPrecio()"
            style="padding:8px 18px;border:none;border-radius:6px;
              background:#16A34A;color:#fff;font-size:12px;font-weight:700;cursor:pointer">
            Guardar
          </button>
        </div>
      </div>
    </div>
  </div>`;
}

// ── Listener Firestore ────────────────────────────────────────
function _escuchar() {
  const q = query(
    collection(db, "productos"),
    orderBy("nombre"),
    limit(2000)
  );
  const unsub = onSnapshot(q, snap => {
    _todos = snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
    _renderizar();
  }, err => {
    console.error("[Productos]", err);
    if (!window.manejarErrorFirestore?.(err)) {
      window.toast?.("Error al cargar productos", "error");
    }
  });
  _unsubs.push(unsub);
}

// ── Render ────────────────────────────────────────────────────
function _renderizar() {
  const tbody = document.getElementById("pc-tbody");
  const sub   = document.getElementById("pc-subtitle");
  if (!tbody) return;

  const filtrados = _aplicarFiltros();
  const puedeEditar = PUEDE_PRECIOS();
  const cols = puedeEditar ? 7 : 6;

  // KPIs
  const total    = _todos.length;
  const activos  = _todos.filter(p => p.activo !== false).length;
  const inact    = total - activos;
  const sinPrecio = _todos.filter(p => !p.precioBase || p.precioBase <= 0).length;
  _setText("pc-kpi-total",    total);
  _setText("pc-kpi-activos",  activos);
  _setText("pc-kpi-inact",    inact);
  _setText("pc-kpi-sinprecio", sinPrecio);
  if (sub) sub.textContent = `${filtrados.length} de ${total} productos`;

  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${cols}">
      <div class="empty-state" style="padding:30px">
        <div class="empty-state-icon">📦</div>
        <div class="empty-state-title">${_busqueda ? "Sin resultados" : "Sin productos en Firestore"}</div>
        <div class="empty-state-sub">${_busqueda ? "" : "Los productos se sincronizan desde el APK en el primer sync."}</div>
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(p => {
    const activo   = p.activo !== false;
    const mg       = margen(p.precioBase, p.costoBase);
    const mgColor  = mg == null ? "#9CA3AF" : mg >= 20 ? "#4ADE80" : mg >= 5 ? "#FBBF24" : "#F87171";
    const idPret   = p.idPretoriano ?? p._docId;
    return `
      <tr style="border-bottom:1px solid var(--c-border);${!activo ? "opacity:.5" : ""}">
        <td style="padding:8px;max-width:260px">
          <div style="font-weight:600;color:var(--c-text);overflow:hidden;text-overflow:ellipsis;
            white-space:nowrap" title="${esc(p.nombre)}">${esc(p.nombre || "–")}</div>
          <div style="font-size:10px;color:#9CA3AF">${esc(p.clave || "")} ${p.presentacion ? "· "+esc(p.presentacion) : ""}</div>
        </td>
        <td style="padding:8px;color:#6B7280;font-size:11px">${esc(p.categoria || "–")}</td>
        <td style="padding:8px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;
          color:${p.precioBase > 0 ? "#4ADE80" : "#F87171"}">
          ${p.precioBase > 0 ? fmtMXN(p.precioBase) : "Sin precio"}
        </td>
        <td style="padding:8px;text-align:right;font-variant-numeric:tabular-nums;color:#FBBF24">
          ${p.costoBase > 0 ? fmtMXN(p.costoBase) : "–"}
        </td>
        <td style="padding:8px;text-align:right;font-weight:700;color:${mgColor}">
          ${mg != null ? fmtPct(mg) : "–"}
        </td>
        <td style="padding:8px;text-align:center">
          ${activo
            ? `<span style="font-size:9px;font-weight:700;padding:3px 8px;border-radius:7px;background:#DCFCE7;color:#166534">ACTIVO</span>`
            : `<span style="font-size:9px;font-weight:700;padding:3px 8px;border-radius:7px;background:#FEE2E2;color:#DC2626">INACTIVO</span>`}
        </td>
        ${puedeEditar ? `
        <td style="padding:8px;text-align:center">
          <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap">
            <button onclick="ProdCtrlUI.abrirModal('${idPret}')"
              style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:5px;
                border:1px solid #374151;background:transparent;color:var(--c-text);cursor:pointer">
              💲 Precio
            </button>
            <button onclick="ProdCtrlUI.toggleActivo('${idPret}',${!activo})"
              style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:5px;border:none;
                background:${activo ? "#FEE2E2" : "#DCFCE7"};
                color:${activo ? "#DC2626" : "#166534"};cursor:pointer">
              ${activo ? "Desactivar" : "Activar"}
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
      (p.nombre || "").toLowerCase().includes(q) ||
      (p.clave  || "").toLowerCase().includes(q) ||
      (p.categoria || "").toLowerCase().includes(q)
    );
  }
  return lista;
}

// ── UI Actions ────────────────────────────────────────────────
function _bindUI() {
  // Búsqueda
  const input = document.getElementById("pc-buscar");
  if (input) {
    let t;
    input.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => { _busqueda = input.value.trim(); _renderizar(); }, 250);
    });
  }

  // Preview de margen en modal
  ["pc-modal-precio","pc-modal-costo"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", _actualizarMargenModal);
  });

  let _editandoId = null;

  window.ProdCtrlUI = {
    setFiltro(f) {
      _filtroActivo = f;
      document.querySelectorAll("[data-filtro]").forEach(b =>
        b.classList.toggle("active", b.dataset.filtro === f));
      _renderizar();
    },

    abrirModal(idPret) {
      const p = _todos.find(x => String(x.idPretoriano ?? x._docId) === String(idPret));
      if (!p) return;
      _editandoId = idPret;
      _setText("pc-modal-nombre", p.nombre || "–");
      _setText("pc-modal-clave",  `ID Pretoriano: ${idPret}`);
      document.getElementById("pc-modal-precio").value = p.precioBase ?? "";
      document.getElementById("pc-modal-costo").value  = p.costoBase  ?? "";
      _actualizarMargenModal();
      document.getElementById("pc-modal").style.display = "flex";
    },

    cerrarModal() {
      document.getElementById("pc-modal").style.display = "none";
      _editandoId = null;
    },

    async guardarPrecio() {
      if (!_editandoId) return;
      const precio = parseFloat(document.getElementById("pc-modal-precio").value);
      const costo  = parseFloat(document.getElementById("pc-modal-costo").value);
      if (isNaN(precio) || precio < 0) { window.toast?.("Precio inválido", "error"); return; }
      if (isNaN(costo)  || costo  < 0) { window.toast?.("Costo inválido",  "error"); return; }

      const p = _todos.find(x => String(x.idPretoriano ?? x._docId) === String(_editandoId));
      if (!p) return;

      try {
        await updateDoc(doc(db, "productos", String(_editandoId)), {
          precioBase:    precio,
          costoBase:     costo,
          modificadoPor: Sesion.alias,
          modificadoEn:  serverTimestamp()
        });

        // Registrar en historial_precios
        await addDoc(collection(db, "historial_precios"), {
          productoId:    0,  // Room ID desconocido desde el web panel
          idPretoriano:  Number(_editandoId),
          nombreProducto: p.nombre || "",
          precioBase:    precio,
          costoBase:     costo,
          fechaCambio:   Date.now(),
          cambiadoPor:   Sesion.alias
        });

        window.toast?.("Precio actualizado — se sincronizará con la app en segundos", "success");
        this.cerrarModal();
      } catch (e) {
        window.toast?.("Error al guardar: " + e.message, "error");
      }
    },

    async toggleActivo(idPret, nuevoEstado) {
      const p = _todos.find(x => String(x.idPretoriano ?? x._docId) === String(idPret));
      const accion = nuevoEstado ? "activar" : "desactivar";
      if (!confirm(`¿Deseas ${accion} "${p?.nombre ?? idPret}"?`)) return;
      try {
        await updateDoc(doc(db, "productos", String(idPret)), {
          activo:        nuevoEstado,
          modificadoPor: Sesion.alias,
          modificadoEn:  serverTimestamp()
        });
        window.toast?.(`Producto ${nuevoEstado ? "activado" : "desactivado"}`, "success");
      } catch (e) {
        window.toast?.("Error: " + e.message, "error");
      }
    }
  };
}

function _actualizarMargenModal() {
  const precio = parseFloat(document.getElementById("pc-modal-precio")?.value ?? "0");
  const costo  = parseFloat(document.getElementById("pc-modal-costo")?.value  ?? "0");
  const el = document.getElementById("pc-modal-margen");
  if (!el) return;
  if (costo > 0 && precio > 0) {
    const mg = ((precio - costo) / costo) * 100;
    const col = mg >= 20 ? "#4ADE80" : mg >= 5 ? "#FBBF24" : "#F87171";
    el.innerHTML = `Margen: <strong style="color:${col}">${mg.toFixed(1)}%</strong>`;
  } else {
    el.textContent = "";
  }
}

function _setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
