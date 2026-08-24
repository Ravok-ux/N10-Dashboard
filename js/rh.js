// ══════════════════════════════════════════════════════════════
// rh.js — Módulo de Recursos Humanos básico
// Asistencia · Vacaciones · Anticipos
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import { esc } from "./app.js";
import {
  collection, doc, addDoc, updateDoc, onSnapshot,
  query, orderBy, where, getDocs, serverTimestamp, limit, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const fmtMXN   = v => Number(v || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const fmtFecha = ts => ts ? new Date(typeof ts === "number" ? ts : ts.toMillis?.() ?? ts)
  .toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtHora  = ts => ts ? new Date(typeof ts === "number" ? ts : ts.toMillis?.() ?? ts)
  .toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "—";

const TABS = [
  { id: "asistencia", label: "📅 Asistencia"  },
  { id: "vacaciones", label: "🏖️ Vacaciones"  },
  { id: "anticipos",  label: "💵 Anticipos"   },
  { id: "nomina",     label: "💼 Nómina"      },
];

let _tabActiva  = "asistencia";
let _unsubs     = [];
let _usuarios   = [];

export const RhModule = {
  mount(container) {
    if (!_puedeVer()) {
      container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-sec)">
        Acceso restringido a administradores y gerentes.</div>`;
      return;
    }
    container.innerHTML = _html();
    _bindTabs();
    _cargarUsuarios().then(() => _activarTab("asistencia"));
    return () => this.destroy();
  },
  destroy() { _unsubs.forEach(u => u?.()); _unsubs = []; }
};

function _puedeVer() {
  return Sesion.esSuperAdmin?.() || ["GERENTE","ADMINISTRADOR"].includes(Sesion.rol) || Sesion.tieneFlag("PUEDE_VER_RH");
}
function _puedeAprobar() {
  return Sesion.esSuperAdmin?.() || ["GERENTE","ADMINISTRADOR"].includes(Sesion.rol);
}

// ── HTML ─────────────────────────────────────────────────────
function _html() {
  return `
  <div class="mod-wrap">
    <div class="mod-topbar">
      <h2 class="mod-title">👥 Recursos Humanos</h2>
    </div>
    <div class="rh-tabs" id="rh-tabs">
      ${TABS.map(t => `
        <button class="rh-tab ${t.id === "asistencia" ? "active" : ""}" data-tab="${t.id}">
          ${t.label}
        </button>`).join("")}
    </div>
    <div id="rh-content"></div>
  </div>`;
}

// ── Tabs ─────────────────────────────────────────────────────
function _bindTabs() {
  document.getElementById("rh-tabs")?.addEventListener("click", e => {
    const btn = e.target.closest("[data-tab]");
    if (!btn) return;
    document.querySelectorAll(".rh-tab").forEach(b => b.classList.toggle("active", b === btn));
    _activarTab(btn.dataset.tab);
  });
}

function _activarTab(tab) {
  _tabActiva = tab;
  _unsubs.forEach(u => u?.()); _unsubs = [];
  if (tab === "asistencia") _montarAsistencia();
  else if (tab === "vacaciones") _montarVacaciones();
  else if (tab === "anticipos")  _montarAnticipos();
  else if (tab === "nomina")     _montarNomina();
}

// ── Cargar lista de usuarios ──────────────────────────────────
async function _cargarUsuarios() {
  try {
    const snap = await getDocs(query(collection(db, "usuarios"), where("activo", "==", true), orderBy("alias")));
    _usuarios = snap.docs
      .filter(d => ["INGENIERO","RECUPERADOR"].includes(d.data().rol))
      .map(d => ({ uid: d.id, ...d.data() }));
  } catch(e) { _usuarios = []; }
}

function _optUsuarios(extraOpt = "") {
  return `<option value="">Todos los ingenieros</option>` + extraOpt +
    _usuarios.map(u => `<option value="${esc(u.uid)}">${esc(u.alias || u.uid)}</option>`).join("");
}

// ══════════════════════════════════════════════════════════════
// ASISTENCIA
// ══════════════════════════════════════════════════════════════
function _montarAsistencia() {
  const content = document.getElementById("rh-content");
  const hoy = new Date(); hoy.setHours(0,0,0,0);

  content.innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
      <select class="sel-sm" id="asi-filtro-uid">${_optUsuarios()}</select>
      <input type="date" class="sel-sm" id="asi-filtro-fecha"
        value="${new Date().toISOString().slice(0,10)}">
      <button class="btn-primary" id="asi-reg-btn">+ Registrar asistencia</button>
    </div>

    <!-- KPIs del día -->
    <div class="kpi-row" style="margin-bottom:16px">
      <div class="kpi-card" style="border-left-color:#16A34A">
        <div class="kpi-icon">✅</div>
        <div class="kpi-val" id="asi-kpi-pres">–</div>
        <div class="kpi-label">Presentes hoy</div>
      </div>
      <div class="kpi-card" style="border-left-color:#DC2626">
        <div class="kpi-icon">❌</div>
        <div class="kpi-val" id="asi-kpi-aus">–</div>
        <div class="kpi-label">Ausentes</div>
      </div>
      <div class="kpi-card" style="border-left-color:#D97706">
        <div class="kpi-icon">⏰</div>
        <div class="kpi-val" id="asi-kpi-tard">–</div>
        <div class="kpi-label">Tardanzas</div>
      </div>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>INGENIERO</th><th>FECHA</th><th>CHECK-IN</th>
          <th>CHECK-OUT</th><th>HORAS</th><th>STATUS</th><th>NOTAS</th>
        </tr>
      </thead>
      <tbody id="asi-body">
        ${window.skeleton?.(5, 7) ?? ""}
      </tbody>
    </table>

    <!-- Modal registro -->
    <div class="modal-overlay hidden" id="asi-modal">
      <div class="modal-box" style="max-width:420px">
        <div class="modal-hdr">
          <span class="modal-title">Registrar asistencia</span>
          <button class="modal-close" id="asi-modal-close">✕</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
          <div class="form-group">
            <label class="form-label">Ingeniero</label>
            <select class="form-input" id="asi-uid">${_optUsuarios()}</select>
          </div>
          <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label class="form-label">Fecha</label>
              <input class="form-input" type="date" id="asi-fecha" value="${new Date().toISOString().slice(0,10)}">
            </div>
            <div class="form-group">
              <label class="form-label">Status</label>
              <select class="form-input" id="asi-status">
                <option value="PRESENTE">Presente</option>
                <option value="AUSENTE">Ausente</option>
                <option value="TARDANZA">Tardanza</option>
                <option value="PERMISO">Permiso</option>
                <option value="VACACIONES">Vacaciones</option>
              </select>
            </div>
          </div>
          <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label class="form-label">Check-in</label>
              <input class="form-input" type="time" id="asi-checkin" value="08:00">
            </div>
            <div class="form-group">
              <label class="form-label">Check-out</label>
              <input class="form-input" type="time" id="asi-checkout" value="17:00">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Notas</label>
            <input class="form-input" type="text" id="asi-notas" placeholder="Opcional">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" id="asi-cancel">Cancelar</button>
          <button class="btn-primary" id="asi-guardar">Guardar</button>
        </div>
      </div>
    </div>`;

  // Bind
  document.getElementById("asi-reg-btn")?.addEventListener("click", () =>
    document.getElementById("asi-modal")?.classList.remove("hidden"));
  document.getElementById("asi-modal-close")?.addEventListener("click", () =>
    document.getElementById("asi-modal")?.classList.add("hidden"));
  document.getElementById("asi-cancel")?.addEventListener("click", () =>
    document.getElementById("asi-modal")?.classList.add("hidden"));
  document.getElementById("asi-guardar")?.addEventListener("click", _guardarAsistencia);
  document.getElementById("asi-filtro-uid")?.addEventListener("change", _escucharAsistencia);
  document.getElementById("asi-filtro-fecha")?.addEventListener("change", _escucharAsistencia);

  _escucharAsistencia();
}

function _escucharAsistencia() {
  _unsubs.forEach(u => u?.()); _unsubs = [];
  const uid   = document.getElementById("asi-filtro-uid")?.value;
  const fecha = document.getElementById("asi-filtro-fecha")?.value || new Date().toISOString().slice(0,10);
  const [y,m,d] = fecha.split("-").map(Number);
  const desde = new Date(y,m-1,d,0,0,0).getTime();
  const hasta = new Date(y,m-1,d,23,59,59).getTime();

  let q = query(collection(db, "rh_asistencia"),
    where("fechaTs", ">=", desde), where("fechaTs", "<=", hasta),
    orderBy("fechaTs", "desc"), limit(200));
  if (uid) q = query(collection(db, "rh_asistencia"),
    where("uid", "==", uid),
    where("fechaTs", ">=", desde), where("fechaTs", "<=", hasta),
    orderBy("fechaTs", "desc"), limit(200));

  const unsub = onSnapshot(q, snap => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderAsistencia(rows);
  }, err => console.error("[RH-Asistencia]", err));
  _unsubs.push(unsub);
}

function _renderAsistencia(rows) {
  const presentes  = rows.filter(r => r.status === "PRESENTE").length;
  const ausentes   = rows.filter(r => r.status === "AUSENTE").length;
  const tardanzas  = rows.filter(r => r.status === "TARDANZA").length;
  const el = id => document.getElementById(id);
  if (el("asi-kpi-pres"))  el("asi-kpi-pres").textContent  = presentes;
  if (el("asi-kpi-aus"))   el("asi-kpi-aus").textContent   = ausentes;
  if (el("asi-kpi-tard"))  el("asi-kpi-tard").textContent  = tardanzas;

  const STATUS_CLS = {
    PRESENTE: "badge-green", AUSENTE: "badge-red",
    TARDANZA: "badge-amber", PERMISO: "badge-yellow", VACACIONES: "badge-purple"
  };
  const tbody = document.getElementById("asi-body");
  if (!tbody) return;
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--text-sec)">Sin registros</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const horas = r.checkIn && r.checkOut
      ? ((r.checkOutTs - r.checkInTs) / 3600000).toFixed(1) + "h" : "–";
    return `<tr>
      <td><b>${esc(r.alias || "–")}</b></td>
      <td>${fmtFecha(r.fechaTs)}</td>
      <td>${r.checkIn || "–"}</td>
      <td>${r.checkOut || "–"}</td>
      <td>${horas}</td>
      <td><span class="badge ${STATUS_CLS[r.status] || "badge-gray"}">${esc(r.status)}</span></td>
      <td style="color:var(--text-sec);font-size:12px">${esc(r.notas || "")}</td>
    </tr>`;
  }).join("");
}

async function _guardarAsistencia() {
  const uid     = document.getElementById("asi-uid")?.value;
  const fecha   = document.getElementById("asi-fecha")?.value;
  const status  = document.getElementById("asi-status")?.value;
  const checkIn = document.getElementById("asi-checkin")?.value;
  const checkOut= document.getElementById("asi-checkout")?.value;
  const notas   = document.getElementById("asi-notas")?.value.trim();

  if (!uid || !fecha) { window.toast?.("Selecciona un ingeniero y fecha", "error"); return; }

  const usuario = _usuarios.find(u => u.uid === uid);
  const [y,m,d] = fecha.split("-").map(Number);
  const fechaTs = new Date(y,m-1,d,0,0,0).getTime();
  const [hi,mi] = (checkIn || "08:00").split(":").map(Number);
  const [ho,mo] = (checkOut|| "17:00").split(":").map(Number);
  const checkInTs  = new Date(y,m-1,d,hi,mi).getTime();
  const checkOutTs = new Date(y,m-1,d,ho,mo).getTime();

  const btn = document.getElementById("asi-guardar");
  btn.disabled = true; btn.textContent = "Guardando…";
  try {
    await addDoc(collection(db, "rh_asistencia"), {
      uid, alias: usuario?.alias || uid, status,
      fecha, fechaTs, checkIn, checkOut, checkInTs, checkOutTs,
      notas, registradoPor: Sesion.alias, timestamp: serverTimestamp(), _ts: Date.now()
    });
    window.toast?.("Asistencia registrada", "success");
    document.getElementById("asi-modal")?.classList.add("hidden");
  } catch(e) { window.toast?.("Error: " + e.message, "error"); }
  finally { btn.disabled = false; btn.textContent = "Guardar"; }
}

// ══════════════════════════════════════════════════════════════
// VACACIONES
// ══════════════════════════════════════════════════════════════
function _montarVacaciones() {
  const content = document.getElementById("rh-content");
  const puedeApr = _puedeAprobar();

  content.innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
      <select class="sel-sm" id="vac-filtro-status">
        <option value="">Todos los estados</option>
        <option value="PENDIENTE">Pendiente</option>
        <option value="APROBADA">Aprobada</option>
        <option value="RECHAZADA">Rechazada</option>
      </select>
      <button class="btn-primary" id="vac-nueva-btn">+ Nueva solicitud</button>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>INGENIERO</th><th>DESDE</th><th>HASTA</th><th>DÍAS</th>
          <th>MOTIVO</th><th>STATUS</th><th>SOLICITADA</th>
          ${puedeApr ? "<th>ACCIÓN</th>" : ""}
        </tr>
      </thead>
      <tbody id="vac-body">
        <tr><td colspan="8" style="padding:24px;text-align:center;color:var(--text-sec)">Cargando…</td></tr>
      </tbody>
    </table>

    <!-- Modal solicitud -->
    <div class="modal-overlay hidden" id="vac-modal">
      <div class="modal-box" style="max-width:420px">
        <div class="modal-hdr">
          <span class="modal-title">Solicitud de vacaciones</span>
          <button class="modal-close" id="vac-modal-close">✕</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
          <div class="form-group">
            <label class="form-label">Ingeniero</label>
            <select class="form-input" id="vac-uid">${_optUsuarios()}</select>
          </div>
          <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label class="form-label">Fecha inicio</label>
              <input class="form-input" type="date" id="vac-desde">
            </div>
            <div class="form-group">
              <label class="form-label">Fecha fin</label>
              <input class="form-input" type="date" id="vac-hasta">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Motivo / notas</label>
            <textarea class="form-input" id="vac-motivo" rows="2" placeholder="Vacaciones anuales, permiso médico…"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" id="vac-cancel">Cancelar</button>
          <button class="btn-primary" id="vac-guardar">Solicitar</button>
        </div>
      </div>
    </div>`;

  document.getElementById("vac-nueva-btn")?.addEventListener("click", () =>
    document.getElementById("vac-modal")?.classList.remove("hidden"));
  document.getElementById("vac-modal-close")?.addEventListener("click", () =>
    document.getElementById("vac-modal")?.classList.add("hidden"));
  document.getElementById("vac-cancel")?.addEventListener("click", () =>
    document.getElementById("vac-modal")?.classList.add("hidden"));
  document.getElementById("vac-guardar")?.addEventListener("click", _guardarVacacion);
  document.getElementById("vac-filtro-status")?.addEventListener("change", _escucharVacaciones);

  _escucharVacaciones();
}

function _escucharVacaciones() {
  _unsubs.forEach(u => u?.()); _unsubs = [];
  const st = document.getElementById("vac-filtro-status")?.value;
  let q = query(collection(db, "rh_vacaciones"), orderBy("_ts", "desc"), limit(200));
  if (st) q = query(collection(db, "rh_vacaciones"), where("status", "==", st), orderBy("_ts", "desc"), limit(200));

  const unsub = onSnapshot(q, snap => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderVacaciones(rows);
  }, err => console.error("[RH-Vacaciones]", err));
  _unsubs.push(unsub);
}

function _renderVacaciones(rows) {
  const puedeApr = _puedeAprobar();
  const ST = { PENDIENTE:"badge-yellow", APROBADA:"badge-green", RECHAZADA:"badge-red" };
  const tbody = document.getElementById("vac-body");
  if (!tbody) return;
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:24px;text-align:center;color:var(--text-sec)">Sin solicitudes</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const dias = r.desdeTs && r.hastaTs
      ? Math.round((r.hastaTs - r.desdeTs) / 86400000) + 1 : "–";
    const accBtn = puedeApr && r.status === "PENDIENTE"
      ? `<button class="btn-sm btn-green" data-id="${r.id}" data-act="apr">✓</button>
         <button class="btn-sm btn-red"   data-id="${r.id}" data-act="rec" style="margin-left:4px">✗</button>`
      : `<span style="font-size:11px;color:var(--text-sec)">${r.aprobadaPor || r.rechazadaPor || "—"}</span>`;
    return `<tr>
      <td><b>${esc(r.alias || "–")}</b></td>
      <td>${fmtFecha(r.desdeTs)}</td>
      <td>${fmtFecha(r.hastaTs)}</td>
      <td style="text-align:center">${dias}</td>
      <td style="font-size:12px;color:var(--text-sec)">${esc(r.motivo || "–")}</td>
      <td><span class="badge ${ST[r.status] || "badge-gray"}">${esc(r.status)}</span></td>
      <td style="font-size:11px;color:var(--text-sec)">${fmtFecha(r._ts)}</td>
      ${puedeApr ? `<td class="td-actions">${accBtn}</td>` : ""}
    </tr>`;
  }).join("");

  if (puedeApr) {
    tbody.querySelectorAll("[data-act]").forEach(btn => {
      btn.addEventListener("click", () => {
        const { id, act } = btn.dataset;
        if (act === "apr") _aprobarVacacion(id);
        else _rechazarVacacion(id);
      });
    });
  }
}

async function _guardarVacacion() {
  const uid    = document.getElementById("vac-uid")?.value;
  const desde  = document.getElementById("vac-desde")?.value;
  const hasta  = document.getElementById("vac-hasta")?.value;
  const motivo = document.getElementById("vac-motivo")?.value.trim();
  if (!uid || !desde || !hasta) { window.toast?.("Completa todos los campos", "error"); return; }
  const usuario = _usuarios.find(u => u.uid === uid);
  const [dy,dm,dd] = desde.split("-").map(Number);
  const [hy,hm,hd] = hasta.split("-").map(Number);
  const desdeTs = new Date(dy,dm-1,dd).getTime();
  const hastaTs = new Date(hy,hm-1,hd,23,59,59).getTime();
  if (hastaTs < desdeTs) { window.toast?.("La fecha de fin debe ser posterior a la de inicio", "error"); return; }
  const btn = document.getElementById("vac-guardar");
  btn.disabled = true; btn.textContent = "Enviando…";
  try {
    await addDoc(collection(db, "rh_vacaciones"), {
      uid, alias: usuario?.alias || uid, desde, hasta, desdeTs, hastaTs,
      motivo, status: "PENDIENTE", solicitadaPor: Sesion.alias,
      timestamp: serverTimestamp(), _ts: Date.now()
    });
    window.toast?.("Solicitud enviada", "success");
    document.getElementById("vac-modal")?.classList.add("hidden");
  } catch(e) { window.toast?.("Error: " + e.message, "error"); }
  finally { btn.disabled = false; btn.textContent = "Solicitar"; }
}

async function _aprobarVacacion(id) {
  await updateDoc(doc(db, "rh_vacaciones", id), {
    status: "APROBADA", aprobadaPor: Sesion.alias, aprobadaEn: serverTimestamp()
  }).catch(e => window.toast?.("Error: " + e.message, "error"));
  window.toast?.("Vacaciones aprobadas", "success");
}
async function _rechazarVacacion(id) {
  const motivo = await window.promptModal({ title: "Rechazar vacaciones", label: "Motivo del rechazo (opcional)", placeholder: "Motivo…" });
  if (motivo === null) return;
  await updateDoc(doc(db, "rh_vacaciones", id), {
    status: "RECHAZADA", rechazadaPor: Sesion.alias, motivoRechazo: motivo
  }).catch(e => window.toast?.("Error: " + e.message, "error"));
  window.toast?.("Solicitud rechazada", "success");
}

// ══════════════════════════════════════════════════════════════
// ANTICIPOS
// ══════════════════════════════════════════════════════════════
function _montarAnticipos() {
  const content = document.getElementById("rh-content");
  const puedeApr = _puedeAprobar();

  content.innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
      <select class="sel-sm" id="ant-filtro-uid">${_optUsuarios()}</select>
      <select class="sel-sm" id="ant-filtro-status">
        <option value="">Todos los estados</option>
        <option value="PENDIENTE">Pendiente</option>
        <option value="APROBADO">Aprobado</option>
        <option value="RECHAZADO">Rechazado</option>
        <option value="DESCONTADO">Descontado de nómina</option>
      </select>
      <button class="btn-primary" id="ant-nueva-btn">+ Nuevo anticipo</button>
    </div>

    <!-- KPIs de anticipos -->
    <div class="kpi-row" style="margin-bottom:16px">
      <div class="kpi-card" style="border-left-color:#D97706">
        <div class="kpi-icon">⏳</div>
        <div class="kpi-val" id="ant-kpi-pend">–</div>
        <div class="kpi-label">Por aprobar</div>
      </div>
      <div class="kpi-card" style="border-left-color:#DC2626">
        <div class="kpi-icon">💵</div>
        <div class="kpi-val" id="ant-kpi-monto">–</div>
        <div class="kpi-label">Aprobados pendientes de descuento</div>
      </div>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>INGENIERO</th><th>MONTO</th><th>MOTIVO</th>
          <th>STATUS</th><th>FECHA</th>
          ${puedeApr ? "<th>ACCIÓN</th>" : ""}
        </tr>
      </thead>
      <tbody id="ant-body">
        <tr><td colspan="6" style="padding:24px;text-align:center;color:var(--text-sec)">Cargando…</td></tr>
      </tbody>
    </table>

    <!-- Modal solicitud -->
    <div class="modal-overlay hidden" id="ant-modal">
      <div class="modal-box" style="max-width:400px">
        <div class="modal-hdr">
          <span class="modal-title">Solicitar anticipo</span>
          <button class="modal-close" id="ant-modal-close">✕</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
          <div class="form-group">
            <label class="form-label">Ingeniero</label>
            <select class="form-input" id="ant-uid">${_optUsuarios()}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Monto solicitado</label>
            <input class="form-input" type="number" id="ant-monto" min="1" step="50" placeholder="0.00">
          </div>
          <div class="form-group">
            <label class="form-label">Motivo</label>
            <input class="form-input" type="text" id="ant-motivo" placeholder="Urgencia médica, gastos de viaje…">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" id="ant-cancel">Cancelar</button>
          <button class="btn-primary" id="ant-guardar">Solicitar</button>
        </div>
      </div>
    </div>`;

  document.getElementById("ant-nueva-btn")?.addEventListener("click", () =>
    document.getElementById("ant-modal")?.classList.remove("hidden"));
  document.getElementById("ant-modal-close")?.addEventListener("click", () =>
    document.getElementById("ant-modal")?.classList.add("hidden"));
  document.getElementById("ant-cancel")?.addEventListener("click", () =>
    document.getElementById("ant-modal")?.classList.add("hidden"));
  document.getElementById("ant-guardar")?.addEventListener("click", _guardarAnticipo);
  document.getElementById("ant-filtro-uid")?.addEventListener("change", _escucharAnticipos);
  document.getElementById("ant-filtro-status")?.addEventListener("change", _escucharAnticipos);

  _escucharAnticipos();
}

function _escucharAnticipos() {
  _unsubs.forEach(u => u?.()); _unsubs = [];
  const uid = document.getElementById("ant-filtro-uid")?.value;
  const st  = document.getElementById("ant-filtro-status")?.value;

  let constraints = [orderBy("_ts", "desc"), limit(200)];
  if (uid) constraints = [where("uid", "==", uid), ...constraints];
  if (st)  constraints = [where("status", "==", st), ...constraints];
  const q = query(collection(db, "rh_anticipos"), ...constraints);

  const unsub = onSnapshot(q, snap => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderAnticipos(rows);
  }, err => console.error("[RH-Anticipos]", err));
  _unsubs.push(unsub);
}

function _renderAnticipos(rows) {
  const puedeApr = _puedeAprobar();
  const ST = { PENDIENTE:"badge-yellow", APROBADO:"badge-green", RECHAZADO:"badge-red", DESCONTADO:"badge-purple" };
  const pending = rows.filter(r => r.status === "PENDIENTE").length;
  const montoAprobado = rows.filter(r => r.status === "APROBADO").reduce((s,r) => s + (r.monto||0), 0);
  const el = id => document.getElementById(id);
  if (el("ant-kpi-pend"))  el("ant-kpi-pend").textContent  = pending;
  if (el("ant-kpi-monto")) el("ant-kpi-monto").textContent = fmtMXN(montoAprobado);

  const tbody = document.getElementById("ant-body");
  if (!tbody) return;
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--text-sec)">Sin anticipos</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const accBtn = puedeApr && r.status === "PENDIENTE"
      ? `<button class="btn-sm btn-green" data-id="${r.id}" data-act="apr">✓ Aprobar</button>
         <button class="btn-sm btn-red"   data-id="${r.id}" data-act="rec" style="margin-left:4px">✗ Rechazar</button>`
      : puedeApr && r.status === "APROBADO"
      ? `<button class="btn-sm btn-outline" data-id="${r.id}" data-act="desc">✓ Descontar de nómina</button>`
      : `<span style="font-size:11px;color:var(--text-sec)">${r.aprobadoPor || r.rechazadoPor || "—"}</span>`;
    return `<tr>
      <td><b>${esc(r.alias || "–")}</b></td>
      <td style="font-weight:700">${fmtMXN(r.monto)}</td>
      <td style="font-size:12px">${esc(r.motivo || "–")}</td>
      <td><span class="badge ${ST[r.status] || "badge-gray"}">${esc(r.status)}</span></td>
      <td style="font-size:11px;color:var(--text-sec)">${fmtFecha(r._ts)}</td>
      ${puedeApr ? `<td class="td-actions">${accBtn}</td>` : ""}
    </tr>`;
  }).join("");

  if (puedeApr) {
    tbody.querySelectorAll("[data-act]").forEach(btn => {
      btn.addEventListener("click", () => {
        const { id, act } = btn.dataset;
        if (act === "apr")  _aprobarAnticipo(id);
        else if (act === "rec")  _rechazarAnticipo(id);
        else if (act === "desc") _descontarAnticipo(id);
      });
    });
  }
}

async function _guardarAnticipo() {
  const uid    = document.getElementById("ant-uid")?.value;
  const monto  = parseFloat(document.getElementById("ant-monto")?.value || "0");
  const motivo = document.getElementById("ant-motivo")?.value.trim();
  if (!uid || monto <= 0) { window.toast?.("Completa todos los campos", "error"); return; }
  const usuario = _usuarios.find(u => u.uid === uid);
  const btn = document.getElementById("ant-guardar");
  btn.disabled = true; btn.textContent = "Enviando…";
  try {
    await addDoc(collection(db, "rh_anticipos"), {
      uid, alias: usuario?.alias || uid, monto, motivo,
      status: "PENDIENTE", solicitadoPor: Sesion.alias,
      timestamp: serverTimestamp(), _ts: Date.now()
    });
    window.toast?.("Solicitud enviada", "success");
    document.getElementById("ant-modal")?.classList.add("hidden");
  } catch(e) { window.toast?.("Error: " + e.message, "error"); }
  finally { btn.disabled = false; btn.textContent = "Solicitar"; }
}

async function _aprobarAnticipo(id) {
  await updateDoc(doc(db, "rh_anticipos", id), {
    status: "APROBADO", aprobadoPor: Sesion.alias, aprobadoEn: serverTimestamp()
  }).catch(e => window.toast?.("Error: " + e.message, "error"));
  window.toast?.("Anticipo aprobado", "success");
}
async function _rechazarAnticipo(id) {
  const motivo = await window.promptModal({ title: "Rechazar anticipo", label: "Motivo del rechazo", placeholder: "Motivo…" });
  if (motivo === null) return;
  if (!motivo.trim()) { window.toast?.("Ingresa un motivo", "warning"); return; }
  await updateDoc(doc(db, "rh_anticipos", id), {
    status: "RECHAZADO", rechazadoPor: Sesion.alias, motivoRechazo: motivo.trim()
  }).catch(e => window.toast?.("Error: " + e.message, "error"));
  window.toast?.("Anticipo rechazado", "success");
}
async function _descontarAnticipo(id) {
  if (!await window.modal({ title: "Descontar de nómina", message: "¿Marcar este anticipo como descontado de nómina?", confirmLabel: "Confirmar" })) return;
  await updateDoc(doc(db, "rh_anticipos", id), {
    status: "DESCONTADO", descontadoPor: Sesion.alias, descontadoEn: serverTimestamp()
  }).catch(e => window.toast?.("Error: " + e.message, "error"));
  window.toast?.("Marcado como descontado", "success");
}

// ══════════════════════════════════════════════════════════════
// NÓMINA SEMANAL
// Cálculo: salario_semanal − anticipos_descontados_semana
//          − (ausencias × valor_día)
// ══════════════════════════════════════════════════════════════
function _montarNomina() {
  if (!_puedeAprobar()) {
    document.getElementById("rh-content").innerHTML =
      `<div style="padding:32px;text-align:center;color:var(--text-sec)">Solo gerentes y administradores.</div>`;
    return;
  }
  const hoy    = new Date();
  // Lunes de la semana actual
  const lunes  = new Date(hoy); lunes.setDate(hoy.getDate() - ((hoy.getDay()+6)%7)); lunes.setHours(0,0,0,0);
  const domingo= new Date(lunes); domingo.setDate(lunes.getDate()+6); domingo.setHours(23,59,59,999);
  const semanaLabel = `${lunes.toLocaleDateString("es-MX",{day:"numeric",month:"short"})} – ${domingo.toLocaleDateString("es-MX",{day:"numeric",month:"short",year:"numeric"})}`;

  const fmtIso = d => d.toISOString().slice(0,10);

  document.getElementById("rh-content").innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
      <span style="font-size:11px;color:var(--text-sec)">Semana:</span>
      <input type="date" class="sel-sm" id="nom-desde" value="${fmtIso(lunes)}">
      <span style="font-size:11px;color:var(--text-sec)">–</span>
      <input type="date" class="sel-sm" id="nom-hasta" value="${fmtIso(domingo)}">
      <button class="btn-primary" id="nom-calcular">Calcular nómina</button>
      <button id="nom-xlsx" style="padding:7px 12px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">⬇️ Excel</button>
    </div>
    <div id="nom-semana-label" style="font-size:12px;color:var(--text-sec);margin-bottom:16px">
      Semana: ${semanaLabel}
    </div>

    <div style="overflow-x:auto">
      <table class="data-table" id="nom-table">
        <thead><tr>
          <th>INGENIERO</th>
          <th style="text-align:right">SALARIO SEMANAL</th>
          <th style="text-align:right">DÍAS PRESENTES</th>
          <th style="text-align:right">AUSENCIAS</th>
          <th style="text-align:right">DESC. AUSENCIAS</th>
          <th style="text-align:right">DESC. ANTICIPOS</th>
          <th style="text-align:right">NETO A PAGAR</th>
          <th>ACCIÓN</th>
        </tr></thead>
        <tbody id="nom-body">
          <tr><td colspan="8" style="padding:32px;text-align:center;color:var(--text-sec)">
            Presiona "Calcular nómina" para generar el resumen</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Modal editar salario -->
    <div class="modal-overlay hidden" id="nom-sal-modal">
      <div class="modal-box" style="max-width:380px">
        <div class="modal-hdr">
          <span class="modal-title" id="nom-sal-title">Salario semanal</span>
          <button class="modal-close" id="nom-sal-close">✕</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
          <p style="font-size:12px;color:var(--text-sec);margin:0">
            El salario semanal se guarda en el perfil del usuario y se usa para cálculos futuros.
          </p>
          <div class="form-group">
            <label class="form-label">Salario semanal (MXN)</label>
            <input class="form-input" type="number" id="nom-sal-val" min="0" step="50" placeholder="0.00">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-outline" id="nom-sal-cancel">Cancelar</button>
          <button class="btn-primary" id="nom-sal-ok">Guardar</button>
        </div>
      </div>
    </div>`;

  document.getElementById("nom-calcular")?.addEventListener("click", _calcularNomina);
  document.getElementById("nom-xlsx")?.addEventListener("click", _exportarNomina);
  document.getElementById("nom-sal-close")?.addEventListener("click", () =>
    document.getElementById("nom-sal-modal")?.classList.add("hidden"));
  document.getElementById("nom-sal-cancel")?.addEventListener("click", () =>
    document.getElementById("nom-sal-modal")?.classList.add("hidden"));
  document.getElementById("nom-sal-ok")?.addEventListener("click", _guardarSalario);

  document.getElementById("nom-desde")?.addEventListener("change", () => {
    const desde = document.getElementById("nom-desde")?.value;
    const hasta = document.getElementById("nom-hasta")?.value;
    if (desde && hasta) {
      const d1 = new Date(desde); const d2 = new Date(hasta);
      document.getElementById("nom-semana-label").textContent =
        `Semana: ${d1.toLocaleDateString("es-MX",{day:"numeric",month:"short"})} – ${d2.toLocaleDateString("es-MX",{day:"numeric",month:"short",year:"numeric"})}`;
    }
  });

  // Calcular al montar
  _calcularNomina();
}

let _nominaData = [];

async function _calcularNomina() {
  const desde = document.getElementById("nom-desde")?.value;
  const hasta = document.getElementById("nom-hasta")?.value;
  if (!desde || !hasta) return;

  const [dy,dm,dd] = desde.split("-").map(Number);
  const [hy,hm,hd] = hasta.split("-").map(Number);
  const desdeTs = new Date(dy,dm-1,dd,0,0,0).getTime();
  const hastaTs = new Date(hy,hm-1,hd,23,59,59).getTime();
  const diasPeriodo = Math.round((hastaTs - desdeTs) / 86400000) + 1;

  const tbody = document.getElementById("nom-body");
  if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="padding:24px;text-align:center">Calculando…</td></tr>`;

  try {
    // 1. Asistencia del período
    const asiSnap = await getDocs(query(
      collection(db,"rh_asistencia"),
      where("fechaTs",">=",desdeTs), where("fechaTs","<=",hastaTs),
      orderBy("fechaTs","asc"), limit(2000)
    ));
    const asiRows = asiSnap.docs.map(d => d.data());

    // 2. Anticipos APROBADOS/DESCONTADOS del período
    const antSnap = await getDocs(query(
      collection(db,"rh_anticipos"),
      where("_ts",">=",desdeTs), where("_ts","<=",hastaTs),
      where("status","in",["APROBADO","DESCONTADO"]),
      orderBy("_ts","asc"), limit(500)
    ));
    const antRows = antSnap.docs.map(d => d.data());

    // Agrupar por usuario
    const porUid = {};
    for (const u of _usuarios) {
      porUid[u.uid] = {
        uid: u.uid, alias: u.alias || u.uid,
        salarioSemanal: u.salarioSemanal || 0,
        asistencias: [], anticipos: []
      };
    }
    asiRows.forEach(r => { if (porUid[r.uid]) porUid[r.uid].asistencias.push(r); });
    antRows.forEach(r => { if (porUid[r.uid]) porUid[r.uid].anticipos.push(r); });

    _nominaData = Object.values(porUid).map(u => {
      const presentes = u.asistencias.filter(a => ["PRESENTE","TARDANZA"].includes(a.status)).length;
      const ausencias = u.asistencias.filter(a => a.status === "AUSENTE").length;
      const salario   = u.salarioSemanal;
      const valorDia  = diasPeriodo > 0 ? salario / diasPeriodo : 0;
      const descAus   = ausencias * valorDia;
      const descAnt   = u.anticipos.reduce((s,a) => s + (a.monto||0), 0);
      const neto      = Math.max(0, salario - descAus - descAnt);
      return { ...u, presentes, ausencias, salario, valorDia, descAus, descAnt, neto };
    });

    _renderNomina(_nominaData);
  } catch(e) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="padding:16px;text-align:center;color:#DC2626">${esc(e.message)}</td></tr>`;
    console.error("[Nomina]", e);
  }
}

function _renderNomina(rows) {
  const tbody = document.getElementById("nom-body");
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:32px;text-align:center;color:var(--text-sec)">Sin empleados</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const sinSalario = r.salario <= 0;
    return `<tr style="${sinSalario ? "opacity:.55" : ""}">
      <td style="font-weight:700">${esc(r.alias)}</td>
      <td style="text-align:right">
        ${fmtMXN(r.salario)}
        <button class="btn-sm btn-outline" data-uid="${r.uid}" data-alias="${esc(r.alias)}"
          data-sal="${r.salario}" data-act="editar-sal"
          style="margin-left:6px;font-size:10px">✏️</button>
      </td>
      <td style="text-align:right">${r.presentes}</td>
      <td style="text-align:right;color:${r.ausencias>0?"#DC2626":"inherit"}">${r.ausencias}</td>
      <td style="text-align:right;color:#DC2626">${fmtMXN(r.descAus)}</td>
      <td style="text-align:right;color:#D97706">${fmtMXN(r.descAnt)}</td>
      <td style="text-align:right;font-weight:800;font-size:15px;color:${r.neto>0?"var(--primary)":"#DC2626"}">${fmtMXN(r.neto)}</td>
      <td>
        ${r.neto > 0 ? `<button class="btn-sm btn-green" data-uid="${r.uid}" data-act="pagar">✓ Registrar pago</button>` : "–"}
      </td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-act='editar-sal']").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("nom-sal-title").textContent = `Salario semanal: ${btn.dataset.alias}`;
      document.getElementById("nom-sal-val").value = btn.dataset.sal || "0";
      document.getElementById("nom-sal-modal").dataset.uid = btn.dataset.uid;
      document.getElementById("nom-sal-modal")?.classList.remove("hidden");
    });
  });

  tbody.querySelectorAll("[data-act='pagar']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const row = _nominaData.find(r => r.uid === btn.dataset.uid);
      if (!row) return;
      if (!await window.modal({ title: "Registrar pago", message: `¿Registrar pago de ${fmtMXN(row.neto)} para ${row.alias}?`, confirmLabel: "Registrar" })) return;
      try {
        const desde = document.getElementById("nom-desde")?.value;
        const hasta  = document.getElementById("nom-hasta")?.value;
        const periodo = `${desde} al ${hasta}`;
        const ahora   = Date.now();

        await addDoc(collection(db,"rh_pagos_nomina"), {
          uid: row.uid, alias: row.alias,
          desde, hasta,
          salarioSemanal: row.salario,
          descAusencias: row.descAus,
          descAnticipos: row.descAnt,
          neto: row.neto,
          pagadoPor: Sesion.alias, _ts: ahora
        });

        // Recibo individual visible en "Mis recibos" del empleado
        await addDoc(collection(db,"rh_nomina"), {
          uid:                row.uid,
          alias:              row.alias,
          periodo,
          salarioBase:        row.salario,
          diasPresentes:      row.presentes,
          ausencias:          row.ausencias,
          deducciones:        row.descAus,
          descuentoAnticipos: row.descAnt,
          netoPagado:         row.neto,
          status:             "PAGADO",
          pagadoPor:          Sesion.alias,
          pagoEn:             ahora,
          _ts:                ahora,
        });

        // Marcar anticipos del período como DESCONTADO
        for (const ant of row.anticipos.filter(a => a.status === "APROBADO")) {
          await updateDoc(doc(db,"rh_anticipos",ant.id || ant._id || ""), {
            status:"DESCONTADO", descontadoPor: Sesion.alias
          }).catch(() => {});
        }
        window.toast?.(`Pago registrado para ${row.alias}`,"success");
        _calcularNomina();
      } catch(e) { window.toast?.(e.message,"error"); }
    });
  });
}

async function _guardarSalario() {
  const uid = document.getElementById("nom-sal-modal")?.dataset.uid;
  const sal = parseFloat(document.getElementById("nom-sal-val")?.value || "0");
  if (!uid || sal < 0) return;

  const btn = document.getElementById("nom-sal-ok");
  btn.disabled = true; btn.textContent = "Guardando…";
  try {
    await updateDoc(doc(db,"usuarios",uid), { salarioSemanal: sal });
    // Actualizar local
    const u = _usuarios.find(x => x.uid === uid);
    if (u) u.salarioSemanal = sal;
    window.toast?.("Salario actualizado","success");
    document.getElementById("nom-sal-modal")?.classList.add("hidden");
    _calcularNomina();
  } catch(e) { window.toast?.(e.message,"error"); }
  finally { btn.disabled = false; btn.textContent = "Guardar"; }
}

function _exportarNomina() {
  if (!_nominaData.length) { window.toast?.("Calcula primero la nómina","warning"); return; }
  const desde = document.getElementById("nom-desde")?.value || "";
  const hasta  = document.getElementById("nom-hasta")?.value  || "";
  const h = ["Ingeniero","Salario semanal","Días presentes","Ausencias","Desc. ausencias","Desc. anticipos","Neto a pagar"];
  const d = _nominaData.map(r => [r.alias,r.salario,r.presentes,r.ausencias,r.descAus.toFixed(2),r.descAnt.toFixed(2),r.neto.toFixed(2)]);
  const ws = XLSX.utils.aoa_to_sheet([h, ...d]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Nómina");
  XLSX.writeFile(wb, `N10-nomina-${desde}-${hasta}.xlsx`);
  window.toast?.("Exportando Excel…","info");
}
