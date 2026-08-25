// ══════════════════════════════════════════════════════════════
// precios.js — Historial de precios y costos de productos
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { esc, norm } from "./app.js";
import { Sesion } from "./auth.js";
import {
  collection, query, orderBy, limit, onSnapshot, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const fmtMXN = v => new Intl.NumberFormat("es-MX", { style:"currency", currency:"MXN" }).format(v || 0);
const fmtFecha = ts => {
  if (!ts) return "–";
  const d = ts.toDate ? ts.toDate() : new Date(typeof ts === "number" ? ts : ts);
  return d.toLocaleDateString("es-MX", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
};

const _ROLES_PERMITIDOS = ["SUPER_ADMIN","GERENTE","ADMINISTRADOR"];

let _unsubs = [];
let _todos = [];
let _busqueda = "";
let _productosCache = [];  // [{id, nombre, codigo}]

export const PreciosModule = {
  mount(container) {
    if (!_puedeVer()) {
      container.innerHTML = `
        <div class="empty-state" style="flex:1;justify-content:center">
          <div class="empty-state-icon">🔒</div>
          <div class="empty-state-title">Acceso restringido</div>
          <div class="empty-state-sub">Solo Gerentes y Administradores pueden ver el historial de precios.</div>
        </div>`;
      return;
    }
    container.innerHTML = _html();
    document.getElementById("hp-tbody").innerHTML = window.skeleton?.(5, 5) ?? "";
    _cargarProductos();
    _bindBusqueda();
    _escucharHistorial();
    return () => this.destroy();
  },

  destroy() {
    _unsubs.forEach(fn => fn && fn());
    _unsubs = [];
    _todos = [];
    _busqueda = "";
    PreciosModule._cleanupKey?.();
    PreciosModule._cleanupKey = null;
  }
};

function _puedeVer() {
  return Sesion.esSuperAdmin() || _ROLES_PERMITIDOS.includes(Sesion.rol);
}

// ── HTML ──────────────────────────────────────────────────────
function _html() {
  return `
  <div style="display:flex;flex-direction:column;height:100%">

    <!-- Header -->
    <div style="display:flex;align-items:center;gap:10px;padding:14px 20px;
      border-bottom:1px solid var(--border);flex-shrink:0;flex-wrap:wrap">
      <div>
        <div style="font-size:13px;font-weight:800;color:var(--text-primary)">Historial de precios y costos</div>
        <div style="font-size:10.5px;color:#9CA3AF" id="hp-subtitle">Cargando…</div>
      </div>
      <div style="flex:1"></div>
      <div style="position:relative;width:280px">
        <input id="hp-buscar" type="text" placeholder="Buscar producto…" autocomplete="off"
          style="width:100%;padding:6px 10px;border-radius:6px;border:1px solid var(--border);
            background:var(--surface);color:var(--text-primary);font-size:12px;box-sizing:border-box">
        <div id="hp-dd" style="display:none;position:absolute;top:100%;left:0;right:0;
          background:var(--surface);border:1px solid var(--border);border-radius:6px;
          box-shadow:0 4px 12px rgba(0,0,0,.15);z-index:200;max-height:220px;overflow-y:auto;margin-top:2px">
        </div>
      </div>
    </div>

    <!-- KPIs -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0;flex-shrink:0;
      border-bottom:1px solid var(--border)">
      ${[
        ["Cambios registrados","hp-kpi-total","#9CA3AF"],
        ["Productos afectados","hp-kpi-prods","#60A5FA"],
        ["Último cambio",      "hp-kpi-ultimo","#FBBF24"]
      ].map(([lbl,id,col]) => `
        <div style="padding:14px 20px;border-right:1px solid var(--border)">
          <div style="font-size:10px;color:#6B7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">${lbl}</div>
          <div id="${id}" style="font-size:18px;font-weight:800;color:${col}">–</div>
        </div>`).join("")}
    </div>

    <!-- Tabla -->
    <div style="flex:1;overflow-y:auto;padding:12px 20px">
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px" id="hp-tabla">
          <thead>
            <tr style="border-bottom:2px solid var(--border)">
              <th style="padding:8px;text-align:left;color:#6B7280;font-weight:600;white-space:nowrap">Producto</th>
              <th style="padding:8px;text-align:right;color:#6B7280;font-weight:600">Precio (cliente)</th>
              <th style="padding:8px;text-align:right;color:#6B7280;font-weight:600">Costo (nosotros)</th>
              <th style="padding:8px;text-align:right;color:#6B7280;font-weight:600">Margen %</th>
              <th style="padding:8px;text-align:left;color:#6B7280;font-weight:600">Registrado por</th>
              <th style="padding:8px;text-align:left;color:#6B7280;font-weight:600;white-space:nowrap">Fecha</th>
            </tr>
          </thead>
          <tbody id="hp-tbody">
            <tr><td colspan="6" style="text-align:center;color:#9CA3AF;padding:40px">Cargando…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

// ── Listener Firestore ────────────────────────────────────────
function _escucharHistorial() {
  const q = query(
    collection(db, "historial_precios"),
    orderBy("fechaCambio", "desc"),
    limit(300)
  );

  const unsub = onSnapshot(q, snap => {
    _todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderizar();
  }, err => {
    console.error("[Precios]", err);
    if (!window.manejarErrorFirestore?.(err)) {
      window.toast?.("Error al cargar historial de precios", "error");
    }
  });
  _unsubs.push(unsub);
}

function _renderizar() {
  const tbody = document.getElementById("hp-tbody");
  const sub   = document.getElementById("hp-subtitle");
  if (!tbody) return;

  const filtrados = _busqueda.length >= 2
    ? _todos.filter(e => norm(e.nombreProducto || "").includes(norm(_busqueda)))
    : _todos;

  // KPIs
  const prodIds = new Set(_todos.map(e => e.productoId));
  _setText("hp-kpi-total",  _todos.length);
  _setText("hp-kpi-prods",  prodIds.size);
  _setText("hp-kpi-ultimo", _todos.length ? fmtFecha(_todos[0].fechaCambio) : "–");
  if (sub) sub.textContent = `${filtrados.length} registros`;

  if (filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#9CA3AF;padding:40px">
      ${_busqueda ? "Sin resultados para la búsqueda" : "Sin registros en historial"}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtrados.map(e => {
    const margen = e.costoBase > 0
      ? (((e.precioBase - e.costoBase) / e.costoBase) * 100).toFixed(1) + "%"
      : "–";
    const margenColor = e.costoBase > 0 && e.precioBase > e.costoBase ? "#4ADE80" : "#EF4444";
    return `
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:8px;color:var(--text-primary);font-weight:600;max-width:240px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
          title="${esc(e.nombreProducto)}">${esc(e.nombreProducto || "–")}</td>
        <td style="padding:8px;text-align:right;font-weight:700;color:#4ADE80">${fmtMXN(e.precioBase)}</td>
        <td style="padding:8px;text-align:right;color:#FBBF24">${fmtMXN(e.costoBase)}</td>
        <td style="padding:8px;text-align:right;font-weight:700;color:${margenColor}">${margen}</td>
        <td style="padding:8px;color:#9CA3AF">${esc(e.cambiadoPor || "–")}</td>
        <td style="padding:8px;color:#6B7280;white-space:nowrap">${fmtFecha(e.fechaCambio)}</td>
      </tr>`;
  }).join("");
}

// ── Cargar productos para autocomplete ───────────────────────
async function _cargarProductos() {
  try {
    const snap = await getDocs(query(collection(db, "productos"), orderBy("nombre")));
    _productosCache = snap.docs.map(d => ({
      id: d.id,
      nombre: d.data().nombre || "",
      codigo: d.data().codigo || ""
    }));
  } catch(e) { /* silencioso */ }
}

// ── Búsqueda con autocomplete ────────────────────────────────
function _bindBusqueda() {
  const input = document.getElementById("hp-buscar");
  const dd    = document.getElementById("hp-dd");
  if (!input || !dd) return;

  input.addEventListener("input", () => {
    const q = norm(input.value.trim());
    _busqueda = input.value.trim();
    _renderizar();

    if (q.length < 2) { dd.style.display = "none"; return; }
    const source = _productosCache.length > 0 ? _productosCache
      : [...new Set(_todos.map(e => e.nombreProducto).filter(Boolean))].sort()
          .map(n => ({ nombre: n, codigo: "" }));
    const matches = source
      .filter(p => norm(p.nombre).includes(q) || norm(p.codigo).includes(q))
      .slice(0, 12);
    if (!matches.length) { dd.style.display = "none"; return; }

    dd.innerHTML = matches.map(p =>
      `<div data-nombre="${p.nombre.replace(/"/g,'&quot;')}"
        style="padding:8px 12px;cursor:pointer;font-size:12px;
          border-bottom:1px solid var(--border);color:var(--text-primary)"
        onmouseover="this.style.background='var(--surface-2)'"
        onmouseout="this.style.background=''"
        onmousedown="event.preventDefault()">
        <span style="font-weight:600">${p.nombre}</span>
        <span style="font-size:10px;color:#9CA3AF;margin-left:6px">${p.codigo}</span>
      </div>`
    ).join("");
    dd.style.display = "block";

    dd.querySelectorAll("div[data-nombre]").forEach(el => {
      el.addEventListener("click", () => {
        input.value = el.dataset.nombre;
        _busqueda = el.dataset.nombre;
        dd.style.display = "none";
        _renderizar();
      });
    });
  });

  input.addEventListener("blur", () => setTimeout(() => { dd.style.display = "none"; }, 150));
  const _onKey = e => { if (e.key === "Escape") dd.style.display = "none"; };
  document.addEventListener("keydown", _onKey);
  PreciosModule._cleanupKey = () => document.removeEventListener("keydown", _onKey);
}

function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
