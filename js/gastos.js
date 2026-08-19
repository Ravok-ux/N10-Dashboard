// gastos.js — Módulo de Gastos de Empleado (MESA_CONTROL / GERENTE)
import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import {
  collection, query, where, orderBy, onSnapshot,
  doc, updateDoc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CATEGORIAS = {
  GASOLINA:     { icon: "⛽", label: "Gasolina"      },
  ALIMENTACION: { icon: "🍽️", label: "Alimentación"  },
  HOSPEDAJE:    { icon: "🏨", label: "Hospedaje"      },
  TRANSPORTE:   { icon: "🚌", label: "Transporte"     },
  COMUNICACION: { icon: "📱", label: "Comunicación"   },
  OTRO:         { icon: "📎", label: "Otro"           },
};

const STATUS_CONFIG = {
  PENDIENTE:  { label: "⏳ Pendiente",  css: "badge-warning"  },
  APROBADO:   { label: "✅ Aprobado",   css: "badge-success"  },
  RECHAZADO:  { label: "❌ Rechazado",  css: "badge-danger"   },
};

let _unsub = null;
let _container = null;
let _filtroStatus = "PENDIENTE";
let _filtroAlias  = "";

export function mount(container) {
  _container = container;
  _container.innerHTML = _html();
  _bindFiltros();
  _cargar();
}

export function destroy() {
  if (_unsub) { _unsub(); _unsub = null; }
}

// ─── HTML ────────────────────────────────────────────────────────────────────

function _html() {
  return `
<div class="gastos-wrap">
  <div class="gastos-header">
    <h2>💸 Gastos de Empleados</h2>
    <div class="gastos-filtros">
      <select id="g-status">
        <option value="">Todos</option>
        <option value="PENDIENTE" selected>Pendientes</option>
        <option value="APROBADO">Aprobados</option>
        <option value="RECHAZADO">Rechazados</option>
      </select>
      <input id="g-alias" type="text" placeholder="Filtrar por alias…" />
    </div>
  </div>
  <div id="gastos-resumen" class="gastos-resumen"></div>
  <div id="gastos-tabla-wrap" class="tabla-scroll">
    <table class="tabla-gastos">
      <thead>
        <tr>
          <th>Empleado</th>
          <th>Categoría</th>
          <th>Monto</th>
          <th>Descripción</th>
          <th>Fecha</th>
          <th>Status</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody id="gastos-tbody"></tbody>
    </table>
    <p id="gastos-empty" style="display:none;text-align:center;color:var(--muted);padding:2rem">
      Sin gastos con estos filtros.
    </p>
  </div>
</div>
<style>
.gastos-wrap { padding: 1rem; }
.gastos-header { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:.5rem; margin-bottom:1rem; }
.gastos-filtros { display:flex; gap:.5rem; flex-wrap:wrap; }
.gastos-filtros select, .gastos-filtros input { padding:.4rem .6rem; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); font-size:.9rem; }
.gastos-resumen { font-size:.85rem; color:var(--muted); margin-bottom:.75rem; }
.tabla-scroll { overflow-x:auto; }
.tabla-gastos { width:100%; border-collapse:collapse; font-size:.9rem; }
.tabla-gastos th { background:var(--bg2); padding:.6rem .8rem; text-align:left; font-weight:600; border-bottom:2px solid var(--border); white-space:nowrap; }
.tabla-gastos td { padding:.55rem .8rem; border-bottom:1px solid var(--border); vertical-align:top; }
.tabla-gastos tr:hover td { background:var(--bg2); }
.monto-cell { font-weight:700; color:#1D4ED8; white-space:nowrap; }
.badge { display:inline-block; padding:.2rem .5rem; border-radius:4px; font-size:.75rem; font-weight:700; }
.badge-warning { background:#FEF3C7; color:#92400E; }
.badge-success { background:#D1FAE5; color:#065F46; }
.badge-danger  { background:#FEE2E2; color:#991B1B; }
.btn-aprobar  { background:#16A34A; color:#fff; border:none; border-radius:5px; padding:.3rem .7rem; cursor:pointer; font-size:.8rem; }
.btn-rechazar { background:#DC2626; color:#fff; border:none; border-radius:5px; padding:.3rem .7rem; cursor:pointer; font-size:.8rem; margin-left:.3rem; }
.btn-aprobar:hover { background:#15803D; }
.btn-rechazar:hover { background:#B91C1C; }
.comentario-input { width:100%; padding:.3rem; border:1px solid var(--border); border-radius:4px; background:var(--bg); color:var(--text); font-size:.8rem; margin-bottom:.3rem; }
</style>`;
}

// ─── Filtros ─────────────────────────────────────────────────────────────────

function _bindFiltros() {
  _container.querySelector("#g-status").addEventListener("change", e => {
    _filtroStatus = e.target.value;
    _cargar();
  });
  let timer;
  _container.querySelector("#g-alias").addEventListener("input", e => {
    clearTimeout(timer);
    timer = setTimeout(() => { _filtroAlias = e.target.value.trim().toLowerCase(); _render(_lastDocs); }, 300);
  });
}

// ─── Firestore ────────────────────────────────────────────────────────────────

let _lastDocs = [];

function _cargar() {
  if (_unsub) { _unsub(); _unsub = null; }
  let q = query(collection(db, "gastos_empleado"), orderBy("_ts", "desc"));
  if (_filtroStatus) q = query(collection(db, "gastos_empleado"), where("status", "==", _filtroStatus), orderBy("_ts", "desc"));
  _unsub = onSnapshot(q, snap => {
    _lastDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _render(_lastDocs);
  });
}

function _render(docs) {
  const tbody   = _container.querySelector("#gastos-tbody");
  const empty   = _container.querySelector("#gastos-empty");
  const resumen = _container.querySelector("#gastos-resumen");
  if (!tbody) return;

  const filtrados = _filtroAlias
    ? docs.filter(d => (d.alias || "").toLowerCase().includes(_filtroAlias))
    : docs;

  if (filtrados.length === 0) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    resumen.textContent = "Sin registros";
    return;
  }
  empty.style.display = "none";
  const total = filtrados.reduce((s, d) => s + (d.monto || 0), 0);
  resumen.textContent = `${filtrados.length} gastos · $${total.toLocaleString("es-MX", { minimumFractionDigits: 2 })} total`;

  tbody.innerHTML = filtrados.map(g => {
    const cat    = CATEGORIAS[g.categoria] || { icon: "📎", label: g.categoria };
    const st     = STATUS_CONFIG[g.status]  || STATUS_CONFIG.PENDIENTE;
    const fecha  = g._ts ? new Date(g._ts).toLocaleDateString("es-MX", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }) : "—";
    const monto  = `$${(g.monto || 0).toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;
    const fotoLink = g.fotoUrl ? `<a href="${g.fotoUrl}" target="_blank" style="font-size:.78rem;color:#2563EB;display:block;margin-bottom:.3rem">🖼️ Ver ticket</a>` : "";
    const acciones = g.status === "PENDIENTE" ? `
      <div>
        ${fotoLink}
        <input class="comentario-input" placeholder="Comentario (opcional)" data-id="${g.id}" />
        <button class="btn-aprobar"  data-id="${g.id}">Aprobar</button>
        <button class="btn-rechazar" data-id="${g.id}">Rechazar</button>
      </div>` : `<div>${fotoLink}<span style="color:var(--muted);font-size:.8rem">${g.aprobadoPor || "—"}</span></div>`;
    return `
<tr>
  <td>${g.alias || g.uid}</td>
  <td>${cat.icon} ${cat.label}</td>
  <td class="monto-cell">${monto}</td>
  <td style="max-width:200px;word-break:break-word">${g.descripcion || "—"}</td>
  <td style="white-space:nowrap;font-size:.8rem">${fecha}</td>
  <td><span class="badge ${st.css}">${st.label}</span></td>
  <td>${acciones}</td>
</tr>`;
  }).join("");

  // Bind botones
  tbody.querySelectorAll(".btn-aprobar").forEach(btn => {
    btn.addEventListener("click", () => {
      const id  = btn.dataset.id;
      const com = tbody.querySelector(`.comentario-input[data-id="${id}"]`)?.value.trim() || null;
      _setStatus(id, "APROBADO", com);
    });
  });
  tbody.querySelectorAll(".btn-rechazar").forEach(btn => {
    btn.addEventListener("click", () => {
      const id  = btn.dataset.id;
      const com = tbody.querySelector(`.comentario-input[data-id="${id}"]`)?.value.trim() || null;
      if (!com) { alert("Escribe un comentario para rechazar el gasto."); return; }
      _setStatus(id, "RECHAZADO", com);
    });
  });
}

async function _setStatus(id, status, comentario) {
  await updateDoc(doc(db, "gastos_empleado", id), {
    status,
    comentario: comentario || null,
    aprobadoPor: Sesion.uid,
    timestamp: serverTimestamp(),
  });
}
