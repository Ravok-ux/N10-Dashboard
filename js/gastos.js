// gastos.js — Módulo de Gastos de Empleado (MESA_CONTROL / GERENTE)
import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import {
  collection, query, where, orderBy, onSnapshot,
  doc, updateDoc, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { crearNotificacion } from "./notificaciones.js";
import { norm } from "./app.js";

const ROLES_APROBADOR = ["GERENTE", "ADMINISTRADOR", "SUPER_ADMIN"];

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
      <div style="position:relative">
        <input id="g-alias" type="text" placeholder="Filtrar por alias…" style="width:160px" />
        <div id="g-alias-dd" style="display:none;position:absolute;top:100%;left:0;right:0;
          background:var(--surface);border:1px solid var(--border);border-radius:6px;
          max-height:200px;overflow-y:auto;z-index:200;box-shadow:0 4px 16px #0002;margin-top:2px;min-width:160px"></div>
      </div>
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
.gastos-filtros select, .gastos-filtros input { padding:.4rem .6rem; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--text-primary); font-size:.9rem; }
.gastos-resumen { font-size:.85rem; color:var(--muted); margin-bottom:.75rem; }
.tabla-scroll { overflow-x:auto; }
.tabla-gastos { width:100%; border-collapse:collapse; font-size:.9rem; }
.tabla-gastos th { background:var(--surface-2); padding:.6rem .8rem; text-align:left; font-weight:600; border-bottom:2px solid var(--border); white-space:nowrap; }
.tabla-gastos td { padding:.55rem .8rem; border-bottom:1px solid var(--border); vertical-align:top; }
.tabla-gastos tr:hover td { background:var(--surface-2); }
.monto-cell { font-weight:700; color:#1D4ED8; white-space:nowrap; }
.badge { display:inline-block; padding:.2rem .5rem; border-radius:4px; font-size:.75rem; font-weight:700; }
.badge-warning { background:#FEF3C7; color:#92400E; }
.badge-success { background:#D1FAE5; color:#065F46; }
.badge-danger  { background:#FEE2E2; color:#991B1B; }
.btn-aprobar  { background:#16A34A; color:#fff; border:none; border-radius:5px; padding:.3rem .7rem; cursor:pointer; font-size:.8rem; }
.btn-rechazar { background:#DC2626; color:#fff; border:none; border-radius:5px; padding:.3rem .7rem; cursor:pointer; font-size:.8rem; margin-left:.3rem; }
.btn-aprobar:hover { background:#15803D; }
.btn-rechazar:hover { background:#B91C1C; }
.comentario-input { width:100%; padding:.3rem; border:1px solid var(--border); border-radius:4px; background:var(--surface); color:var(--text-primary); font-size:.8rem; margin-bottom:.3rem; }
</style>`;
}

// ─── Filtros ─────────────────────────────────────────────────────────────────

function _bindFiltros() {
  _container.querySelector("#g-status").addEventListener("change", e => {
    _filtroStatus = e.target.value;
    _cargar();
  });
  const gAlias = _container.querySelector("#g-alias");
  const gAliasDd = _container.querySelector("#g-alias-dd");
  let timer;
  gAlias?.addEventListener("input", e => {
    clearTimeout(timer);
    timer = setTimeout(() => { _filtroAlias = norm(e.target.value.trim()); _render(_lastDocs); }, 300);
    const q = norm(e.target.value.trim());
    if (q.length < 1 || !gAliasDd) { if (gAliasDd) gAliasDd.style.display = "none"; return; }
    const aliases = [...new Set(_lastDocs.map(d => d.alias).filter(Boolean))];
    const matches = aliases.filter(a => norm(a).includes(q)).slice(0, 12);
    if (!matches.length) { gAliasDd.style.display = "none"; return; }
    gAliasDd.innerHTML = matches.map(a =>
      `<div class="g-dd-item" data-nombre="${a.replace(/"/g, '&quot;')}"
        style="padding:7px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);color:var(--text-primary)">
        ${a.replace(/</g, '&lt;')}
      </div>`).join("");
    gAliasDd.style.display = "block";
    gAliasDd.querySelectorAll(".g-dd-item").forEach(el =>
      el.addEventListener("mousedown", ev => {
        ev.preventDefault();
        gAlias.value = el.dataset.nombre;
        _filtroAlias = norm(el.dataset.nombre);
        gAliasDd.style.display = "none";
        _render(_lastDocs);
      }));
  });
  gAlias?.addEventListener("blur",   () => setTimeout(() => { if (gAliasDd) gAliasDd.style.display = "none"; }, 150));
  gAlias?.addEventListener("keydown", e => { if (e.key === "Escape" && gAliasDd) gAliasDd.style.display = "none"; });
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
    ? docs.filter(d => norm(d.alias).includes(_filtroAlias))
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
    const esAprobador = ROLES_APROBADOR.includes(Sesion.rol);
    let acciones;
    if (g.status === "PENDIENTE" && esAprobador) {
      acciones = `<div>
        ${fotoLink}
        <button class="btn-aprobar"  data-id="${g.id}" data-uid="${g.uid}" data-alias="${g.alias || g.uid}" data-monto="${g.monto || 0}">✅ Aprobar</button>
        <button class="btn-rechazar" data-id="${g.id}" data-uid="${g.uid}" data-alias="${g.alias || g.uid}" data-monto="${g.monto || 0}">❌ Rechazar</button>
      </div>`;
    } else {
      const gestor = g.aprobadoPor || g.rechazadoPor || "—";
      acciones = `<div>${fotoLink}<span style="color:var(--muted);font-size:.8rem">${gestor}</span></div>`;
    }
    // Status badge + motivo rechazo si aplica
    const motivoHtml = g.status === "RECHAZADO" && g.motivoRechazo
      ? `<div style="font-size:.74rem;color:#991B1B;margin-top:.2rem">Motivo: ${g.motivoRechazo}</div>` : "";
    return `
<tr>
  <td>${g.alias || g.uid}</td>
  <td>${cat.icon} ${cat.label}</td>
  <td class="monto-cell">${monto}</td>
  <td style="max-width:200px;word-break:break-word">${g.descripcion || "—"}</td>
  <td style="white-space:nowrap;font-size:.8rem">${fecha}</td>
  <td><span class="badge ${st.css}">${st.label}</span>${motivoHtml}</td>
  <td>${acciones}</td>
</tr>`;
  }).join("");

  // Bind botones
  tbody.querySelectorAll(".btn-aprobar").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { id, uid, alias, monto } = btn.dataset;
      const confirmar = window.modal
        ? await window.modal({ title: "Aprobar gasto", body: `¿Aprobar el gasto de <b>${alias}</b> por <b>$${Number(monto).toLocaleString("es-MX", { minimumFractionDigits:2 })}</b>?`, ok: "Aprobar", cancel: "Cancelar" })
        : confirm(`¿Aprobar el gasto de ${alias} por $${Number(monto).toLocaleString("es-MX", { minimumFractionDigits:2 })}?`);
      if (!confirmar) return;
      await _setStatus({ id, empleadoUid: uid, empleadoAlias: alias, status: "APROBADO" });
    });
  });
  tbody.querySelectorAll(".btn-rechazar").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { id, uid, alias, monto } = btn.dataset;
      const motivo = window.promptModal
        ? await window.promptModal({ title: "Rechazar gasto", body: `Motivo de rechazo para el gasto de <b>${alias}</b> por <b>$${Number(monto).toLocaleString("es-MX", { minimumFractionDigits:2 })}</b>:`, placeholder: "Escribe el motivo…", ok: "Rechazar" })
        : prompt(`Motivo de rechazo para el gasto de ${alias}:`);
      if (!motivo || !motivo.trim()) return; // cancelado o vacío
      await _setStatus({ id, empleadoUid: uid, empleadoAlias: alias, status: "RECHAZADO", motivoRechazo: motivo.trim() });
    });
  });
}

async function _setStatus({ id, empleadoUid, empleadoAlias, status, motivoRechazo }) {
  const campos = {
    status,
    ...(status === "APROBADO"
      ? { aprobadoPor: Sesion.uid, _tsAprobacion: serverTimestamp() }
      : { rechazadoPor: Sesion.uid, _tsRechazo: serverTimestamp(), motivoRechazo: motivoRechazo || null }),
  };
  await updateDoc(doc(db, "gastos_empleado", id), campos);

  const tipo    = status === "APROBADO" ? "GASTO_APROBADO" : "GASTO_RECHAZADO";
  const msjBase = status === "APROBADO"
    ? `Tu gasto fue aprobado por ${Sesion.alias}`
    : `Tu gasto fue rechazado por ${Sesion.alias}${motivoRechazo ? ". Motivo: " + motivoRechazo : ""}`;
  await crearNotificacion({
    tipo,
    mensaje:       msjBase,
    destinatarios: empleadoUid ? [empleadoUid] : ["TODOS"],
  });

  window.toast?.(status === "APROBADO" ? "Gasto aprobado ✅" : "Gasto rechazado ❌", status === "APROBADO" ? "success" : "error");
}
