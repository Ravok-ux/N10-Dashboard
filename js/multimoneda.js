// multimoneda.js — Gestión de tipo de cambio y configuración multi-moneda
import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import {
  doc, getDoc, setDoc, onSnapshot, collection, query,
  orderBy, limit, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─── API pública ──────────────────────────────────────────────────────────────
// Usar desde otros módulos: import { getTipoCambio, convertir } from "./multimoneda.js"

let _tcCache = null;
let _tcUnsub = null;

/** Suscribe al tipo de cambio en tiempo real. Llama a callback(tc) cuando cambia. */
export function suscribirTipoCambio(callback) {
  if (_tcUnsub) return; // ya suscrito
  _tcUnsub = onSnapshot(doc(db, "config", "tipo_cambio"), snap => {
    _tcCache = snap.exists() ? (snap.data().usdMxn || 17.5) : 17.5;
    callback(_tcCache);
  });
}

/** Retorna el tipo de cambio actual (desde caché o valor default). */
export async function getTipoCambio() {
  if (_tcCache !== null) return _tcCache;
  const snap = await getDoc(doc(db, "config", "tipo_cambio"));
  _tcCache = snap.exists() ? (snap.data().usdMxn || 17.5) : 17.5;
  return _tcCache;
}

/** Convierte monto de `monedaOrigen` a MXN. */
export async function convertirAMxn(monto, monedaOrigen) {
  if (monedaOrigen === "MXN") return monto;
  const tc = await getTipoCambio();
  return monto * tc;
}

/** Formatea monto con símbolo de moneda. */
export function formatMoneda(monto, moneda = "MXN") {
  const opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return moneda === "USD"
    ? `USD $${monto.toLocaleString("en-US", opts)}`
    : `$${monto.toLocaleString("es-MX", opts)}`;
}

// ─── Módulo web (mount/destroy) ───────────────────────────────────────────────

let _container = null;
let _histUnsub = null;

export function mount(container) {
  _container = container;
  _container.innerHTML = _html();
  _bindEvents();
  _cargar();
}

export function destroy() {
  if (_histUnsub) { _histUnsub(); _histUnsub = null; }
}

function _html() {
  return `
<div class="mm-wrap">
  <div class="mm-header">
    <h2>💱 Tipo de Cambio</h2>
  </div>

  <div class="mm-panel">
    <div class="mm-config-card">
      <h3>Configuración actual</h3>
      <div class="mm-tc-display">
        <span class="mm-tc-label">1 USD =</span>
        <span id="mm-tc-valor" class="mm-tc-valor">—</span>
        <span class="mm-tc-label">MXN</span>
      </div>
      <p id="mm-tc-fecha" style="font-size:.8rem;color:var(--muted);margin:.5rem 0 1.5rem"></p>

      <label style="display:block;font-size:.82rem;font-weight:700;margin-bottom:.4rem">Nuevo tipo de cambio (USD → MXN)</label>
      <div style="display:flex;gap:.5rem;align-items:center">
        <input id="mm-input-tc" type="number" min="1" step="0.01" placeholder="Ej: 17.25"
          style="padding:.5rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text-primary);font-size:1rem;width:140px" />
        <button id="mm-btn-actualizar" style="background:#2563EB;color:#fff;border:none;border-radius:7px;padding:.5rem 1.2rem;font-weight:700;cursor:pointer">Actualizar</button>
      </div>
      <p class="mm-hint">El tipo de cambio se aplica a todos los pedidos y cotizaciones nuevos en USD.</p>
    </div>

    <div class="mm-hist-card">
      <h3>Historial de cambios</h3>
      <div id="mm-historial"></div>
    </div>
  </div>

  <div class="mm-info-card">
    <h3>Cómo funciona</h3>
    <ul style="font-size:.88rem;line-height:1.8;padding-left:1.2rem;color:var(--text-primary)">
      <li>Pedidos y cotizaciones pueden crearse en <strong>MXN</strong> o <strong>USD</strong>.</li>
      <li>El sistema almacena siempre el total en <strong>MXN</strong> (usando el TC del momento de la captura) para reportes y cartera consistentes.</li>
      <li>El TC capturado queda registrado en cada documento para auditoría.</li>
      <li>Solo GERENTE y MESA_CONTROL pueden modificar el tipo de cambio.</li>
    </ul>
  </div>
</div>

<style>
.mm-wrap { padding:1rem; }
.mm-header { margin-bottom:1rem; }
.mm-panel { display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem; }
@media(max-width:680px) { .mm-panel { grid-template-columns:1fr; } }
.mm-config-card, .mm-hist-card, .mm-info-card { background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:1.25rem; }
.mm-config-card h3, .mm-hist-card h3, .mm-info-card h3 { margin:0 0 1rem;font-size:1rem; }
.mm-tc-display { display:flex;align-items:baseline;gap:.5rem;margin-bottom:.25rem; }
.mm-tc-label { font-size:1rem;color:var(--muted); }
.mm-tc-valor { font-size:2.5rem;font-weight:900;color:#2563EB;font-variant-numeric:tabular-nums; }
.mm-hint { font-size:.78rem;color:var(--muted);margin:.5rem 0 0; }
.mm-hist-item { display:flex;justify-content:space-between;align-items:center;padding:.5rem 0;border-bottom:1px solid var(--border);font-size:.88rem; }
.mm-hist-item:last-child { border-bottom:none; }
.mm-tc-chip { background:#DBEAFE;color:#1E40AF;border-radius:5px;padding:.15rem .5rem;font-weight:700;font-size:.82rem; }
</style>`;
}

function _bindEvents() {
  _container.querySelector("#mm-btn-actualizar").addEventListener("click", _actualizar);
}

async function _cargar() {
  // Tipo de cambio actual
  onSnapshot(doc(db, "config", "tipo_cambio"), snap => {
    const data   = snap.exists() ? snap.data() : {};
    const tc     = data.usdMxn || 17.5;
    _tcCache     = tc;
    _container.querySelector("#mm-tc-valor").textContent = tc.toFixed(4);
    const fecha  = data.timestamp?.toDate ? data.timestamp.toDate().toLocaleString("es-MX") : "—";
    _container.querySelector("#mm-tc-fecha").textContent = `Actualizado: ${fecha} · por ${data.actualizadoPor || "sistema"}`;
  });

  // Historial
  _histUnsub = onSnapshot(
    query(collection(db, "historial_tipo_cambio"), orderBy("_ts", "desc"), limit(20)),
    snap => {
      const div = _container?.querySelector("#mm-historial");
      if (!div) return;
      if (snap.empty) { div.innerHTML = '<p style="color:var(--muted);font-size:.88rem">Sin historial.</p>'; return; }
      div.innerHTML = snap.docs.map(d => {
        const h     = d.data();
        const fecha = h._ts ? new Date(h._ts).toLocaleString("es-MX") : "—";
        return `<div class="mm-hist-item">
          <span style="color:var(--muted);font-size:.8rem">${fecha}</span>
          <span class="mm-tc-chip">$${h.usdMxn?.toFixed(4) || "—"}</span>
          <span style="color:var(--muted);font-size:.8rem">${h.alias || h.uid || "—"}</span>
        </div>`;
      }).join("");
    }
  );
}

async function _actualizar() {
  const input = _container.querySelector("#mm-input-tc");
  const tc    = parseFloat(input.value);
  if (!tc || tc < 1) { window.toast?.("Ingresa un tipo de cambio válido (mayor a 1).", "warn"); return; }

  const btn = _container.querySelector("#mm-btn-actualizar");
  btn.disabled = true; btn.textContent = "Guardando…";

  try {
    await setDoc(doc(db, "config", "tipo_cambio"), {
      usdMxn:        tc,
      actualizadoPor: Sesion.alias || Sesion.uid,
      uid:           Sesion.uid,
      _ts:           Date.now(),
      timestamp:     serverTimestamp(),
    });

    await addDoc(collection(db, "historial_tipo_cambio"), {
      usdMxn:  tc,
      alias:   Sesion.alias || "",
      uid:     Sesion.uid,
      _ts:     Date.now(),
      timestamp: serverTimestamp(),
    });

    input.value = "";
    btn.textContent = "✓ Actualizado";
    setTimeout(() => { btn.disabled = false; btn.textContent = "Actualizar"; }, 2000);
  } catch (e) {
    window.toast?.(`Error: ${e.message}`, "error");
    btn.disabled = false; btn.textContent = "Actualizar";
  }
}
