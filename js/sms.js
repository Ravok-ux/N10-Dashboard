// sms.js — Módulo de SMS Masivo vía SendPulse (GERENTE / MESA_CONTROL)
import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import {
  collection, addDoc, query, orderBy, onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let _unsub = null;
let _container = null;

export function mount(container) {
  _container = container;
  _container.innerHTML = _html();
  _bindEvents();
  _cargarHistorial();
}

export function destroy() {
  if (_unsub) { _unsub(); _unsub = null; }
}

// ─── HTML ────────────────────────────────────────────────────────────────────

function _html() {
  return `
<div class="sms-wrap">
  <div class="sms-header">
    <h2>📱 SMS Masivo</h2>
    <span class="sms-badge" id="sms-creditos">SendPulse</span>
  </div>

  <div class="sms-panel">
    <div class="sms-form-card">
      <h3>Nueva campaña SMS</h3>

      <label>Destinatarios</label>
      <select id="sms-seg" style="margin-bottom:.75rem">
        <option value="todos">Todos los clientes activos</option>
        <option value="deudores">Con deuda vencida</option>
        <option value="sin_compra_30">Sin compra en 30+ días</option>
        <option value="manual">Números manuales</option>
      </select>

      <div id="sms-manual-wrap" style="display:none;margin-bottom:.75rem">
        <label>Teléfonos (uno por línea, formato 10 dígitos)</label>
        <textarea id="sms-telefonos" rows="4" placeholder="5512345678&#10;5598765432"></textarea>
      </div>

      <label>Mensaje <span id="sms-chars" style="float:right;color:var(--muted)">0/160</span></label>
      <textarea id="sms-mensaje" rows="4" maxlength="160"
        placeholder="Ej: Hola {nombre}, tienes un pago pendiente. Llámanos al 55-XXXX-XXXX."></textarea>
      <p class="sms-hint">Usa <code>{nombre}</code> para personalizar con el nombre del cliente.</p>

      <label>Remitente (Sender ID)</label>
      <input id="sms-sender" type="text" value="N10ERP" maxlength="11"
        placeholder="Hasta 11 caracteres" style="margin-bottom:.75rem" />

      <button id="sms-btn-enviar" class="btn-primario">Enviar campaña SMS</button>
      <div id="sms-error" class="sms-error" style="display:none"></div>
    </div>

    <div class="sms-historial-card">
      <h3>Historial de campañas</h3>
      <div id="sms-historial-list">
        <p style="color:var(--muted);font-size:.9rem">Cargando…</p>
      </div>
    </div>
  </div>
</div>

<style>
.sms-wrap { padding:1rem; }
.sms-header { display:flex; align-items:center; gap:1rem; margin-bottom:1rem; }
.sms-badge { background:#7C3AED; color:#fff; border-radius:12px; padding:.25rem .8rem; font-size:.8rem; font-weight:700; }
.sms-panel { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
@media(max-width:700px) { .sms-panel { grid-template-columns:1fr; } }
.sms-form-card, .sms-historial-card { background:var(--bg2); border:1px solid var(--border); border-radius:10px; padding:1.25rem; }
.sms-form-card h3, .sms-historial-card h3 { margin:0 0 1rem; font-size:1rem; }
.sms-form-card label { display:block; font-size:.82rem; font-weight:700; margin-bottom:.3rem; }
.sms-form-card select,
.sms-form-card input,
.sms-form-card textarea { width:100%; padding:.5rem; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); font-size:.9rem; box-sizing:border-box; }
.sms-form-card textarea { resize:vertical; }
.sms-hint { font-size:.78rem; color:var(--muted); margin:.25rem 0 .75rem; }
.btn-primario { background:#7C3AED; color:#fff; border:none; border-radius:7px; padding:.65rem 1.4rem; font-size:.95rem; font-weight:700; cursor:pointer; width:100%; }
.btn-primario:hover { background:#6D28D9; }
.btn-primario:disabled { opacity:.5; cursor:default; }
.sms-error { background:#FEE2E2; color:#991B1B; border-radius:6px; padding:.6rem; font-size:.85rem; margin-top:.5rem; }
.sms-camp-item { border-bottom:1px solid var(--border); padding:.75rem 0; }
.sms-camp-item:last-child { border-bottom:none; }
.sms-camp-meta { font-size:.8rem; color:var(--muted); margin-top:.25rem; }
.sms-camp-msg { font-size:.88rem; margin:.25rem 0; background:var(--bg); border-radius:5px; padding:.4rem .6rem; word-break:break-word; }
.badge-env  { background:#D1FAE5; color:#065F46; border-radius:4px; padding:.15rem .4rem; font-size:.75rem; font-weight:700; }
.badge-err  { background:#FEE2E2; color:#991B1B; border-radius:4px; padding:.15rem .4rem; font-size:.75rem; font-weight:700; }
.badge-pend { background:#FEF3C7; color:#92400E; border-radius:4px; padding:.15rem .4rem; font-size:.75rem; font-weight:700; }
</style>`;
}

// ─── Eventos ──────────────────────────────────────────────────────────────────

function _bindEvents() {
  _container.querySelector("#sms-seg").addEventListener("change", e => {
    const manual = _container.querySelector("#sms-manual-wrap");
    manual.style.display = e.target.value === "manual" ? "block" : "none";
  });

  _container.querySelector("#sms-mensaje").addEventListener("input", e => {
    _container.querySelector("#sms-chars").textContent = `${e.target.value.length}/160`;
  });

  _container.querySelector("#sms-btn-enviar").addEventListener("click", _enviar);
}

// ─── Enviar ───────────────────────────────────────────────────────────────────

async function _enviar() {
  const btn     = _container.querySelector("#sms-btn-enviar");
  const errEl   = _container.querySelector("#sms-error");
  const segVal  = _container.querySelector("#sms-seg").value;
  const mensaje = _container.querySelector("#sms-mensaje").value.trim();
  const sender  = _container.querySelector("#sms-sender").value.trim() || "N10ERP";
  const telRaw  = _container.querySelector("#sms-telefonos")?.value || "";

  errEl.style.display = "none";

  if (!mensaje) { _mostrarError("Escribe el mensaje antes de enviar."); return; }

  let destinatarios = [];

  if (segVal === "manual") {
    destinatarios = telRaw.split(/[\n,;]+/).map(t => t.trim().replace(/\D/g, "")).filter(t => t.length === 10);
    if (destinatarios.length === 0) { _mostrarError("Agrega al menos un número válido de 10 dígitos."); return; }
  } else {
    // Obtener teléfonos desde Firestore según segmento
    destinatarios = await _obtenerDestinatarios(segVal);
    if (destinatarios.length === 0) { _mostrarError("No se encontraron clientes para este segmento."); return; }
  }

  const confirmMsg = `¿Enviar ${destinatarios.length} SMS?\nRemitente: ${sender}\nMensaje: ${mensaje.substring(0,60)}…`;
  if (!confirm(confirmMsg)) return;

  btn.disabled = true;
  btn.textContent = "Enviando…";

  try {
    // Encolar campaña en Firestore → CF onSmsCampanaCreada la procesa con SendPulse
    await addDoc(collection(db, "sms_campanas"), {
      segmento:      segVal,
      destinatarios,
      mensaje,
      sender,
      status:        "PENDIENTE",
      creadoPor:     Sesion.uid,
      alias:         Sesion.alias || "",
      total:         destinatarios.length,
      enviados:      0,
      errores:       0,
      _ts:           Date.now(),
      timestamp:     serverTimestamp(),
    });
    btn.textContent = "¡Campaña encolada!";
    _container.querySelector("#sms-mensaje").value = "";
    _container.querySelector("#sms-chars").textContent = "0/160";
    setTimeout(() => { btn.disabled = false; btn.textContent = "Enviar campaña SMS"; }, 3000);
  } catch (e) {
    _mostrarError(`Error al encolar campaña: ${e.message}`);
    btn.disabled = false;
    btn.textContent = "Enviar campaña SMS";
  }
}

function _mostrarError(msg) {
  const el = _container.querySelector("#sms-error");
  el.textContent = msg;
  el.style.display = "block";
}

// ─── Segmentos ────────────────────────────────────────────────────────────────

async function _obtenerDestinatarios(segmento) {
  const { getDocs, where } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  let q;
  const col = collection(db, "clientes");

  if (segmento === "todos") {
    q = query(col, where("activo", "==", true));
  } else if (segmento === "deudores") {
    q = query(col, where("activo", "==", true), where("saldoPendiente", ">", 0));
  } else if (segmento === "sin_compra_30") {
    const hace30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
    q = query(col, where("activo", "==", true), where("ultimaCompra", "<", hace30));
  } else {
    return [];
  }

  const snap = await getDocs(q);
  return snap.docs
    .map(d => (d.data().telefono || "").replace(/\D/g, ""))
    .filter(t => t.length === 10);
}

// ─── Historial ────────────────────────────────────────────────────────────────

function _cargarHistorial() {
  const q = query(collection(db, "sms_campanas"), orderBy("_ts", "desc"));
  _unsub = onSnapshot(q, snap => {
    const list = _container.querySelector("#sms-historial-list");
    if (!list) return;
    if (snap.empty) { list.innerHTML = '<p style="color:var(--muted);font-size:.9rem">Sin campañas aún.</p>'; return; }
    list.innerHTML = snap.docs.slice(0, 20).map(doc => {
      const d    = doc.data();
      const fecha = d._ts ? new Date(d._ts).toLocaleDateString("es-MX", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }) : "—";
      const badgeCls = d.status === "COMPLETADO" ? "badge-env" : d.status === "ERROR" ? "badge-err" : "badge-pend";
      return `
<div class="sms-camp-item">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <span style="font-weight:600;font-size:.88rem">${d.alias || d.creadoPor}</span>
    <span class="${badgeCls}">${d.status}</span>
  </div>
  <div class="sms-camp-msg">${(d.mensaje || "").substring(0, 100)}${d.mensaje?.length > 100 ? "…" : ""}</div>
  <div class="sms-camp-meta">${fecha} · ${d.total || 0} destinos · ${d.enviados || 0} enviados · ${d.errores || 0} errores</div>
</div>`;
    }).join("");
  });
}
