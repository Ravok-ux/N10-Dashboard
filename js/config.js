// ══════════════════════════════════════════════════════════════
// config.js — Configuración de tickets térmicos (header + footer)
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import { getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const DOC_PATH = "configuracion/tickets";

const DEFAULTS = {
    nombreEmpresa: "NUTRICIÓN DE 10",
    subtitulo:     "Agroquímicos y Nutrición",
    telefono:      "(667) 123-4567",
    sitioWeb:      "nutricionde10.com.mx",
    footerVenta:    "Precios sin IVA. Factura disponible en oficina con este folio.\nGracias por su preferencia.",
    footerAbono:    "Este recibo no cancela la deuda total.\nConserve su comprobante. Exija factura en oficina.",
    footerRemision: "El cliente acepta los productos en buen estado al recibir este comprobante.\nFactura disponible al liquidar el adeudo.",
};

function _puedeAcceder() {
    const rol = Sesion.rol;
    return rol === "SUPER_ADMIN" || rol === "GERENTE" || rol === "ADMINISTRADOR";
}

function _html() {
    return `
<div class="cfg-wrap">

  <div class="cfg-card">
    <div class="cfg-card-head">
      <div class="cfg-card-icon">🏢</div>
      <div>
        <div class="cfg-card-title">Encabezado del ticket</div>
        <div class="cfg-card-sub">Se imprime en todos los tipos de ticket</div>
      </div>
    </div>
    <div class="cfg-fields">
      <label class="cfg-label">Nombre de la empresa</label>
      <input class="cfg-input" id="cfg-nombre" type="text" maxlength="40" placeholder="NUTRICIÓN DE 10">

      <label class="cfg-label">Subtítulo / giro</label>
      <input class="cfg-input" id="cfg-subtitulo" type="text" maxlength="40" placeholder="Agroquímicos y Nutrición">

      <label class="cfg-label">Teléfono</label>
      <input class="cfg-input" id="cfg-telefono" type="tel" maxlength="20" placeholder="(667) 123-4567">

      <label class="cfg-label">Sitio web</label>
      <input class="cfg-input" id="cfg-sitioweb" type="text" maxlength="40" placeholder="nutricionde10.com.mx">
    </div>
  </div>

  <div class="cfg-card">
    <div class="cfg-card-head">
      <div class="cfg-card-icon">📝</div>
      <div>
        <div class="cfg-card-title">Pie de página por tipo de ticket</div>
        <div class="cfg-card-sub">Cada tipo tiene su propio pie; use saltos de línea para separar renglones</div>
      </div>
    </div>
    <div class="cfg-fields">
      <label class="cfg-label">Ticket de venta / pedido</label>
      <textarea class="cfg-textarea" id="cfg-footer-venta" rows="3" maxlength="200"></textarea>

      <label class="cfg-label">Recibo de abono</label>
      <textarea class="cfg-textarea" id="cfg-footer-abono" rows="3" maxlength="200"></textarea>

      <label class="cfg-label">Remisión a crédito</label>
      <textarea class="cfg-textarea" id="cfg-footer-remision" rows="3" maxlength="200"></textarea>
    </div>
  </div>

  <!-- Control operativo — feature toggles globales -->
  <div class="cfg-card" id="ctrl-card">
    <div class="cfg-card-head">
      <div class="cfg-card-icon">🎛️</div>
      <div>
        <div class="cfg-card-title">Control operativo</div>
        <div class="cfg-card-sub">Activa o desactiva módulos para TODOS los usuarios de la app al instante</div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:0">
      ${[
        ["credito",    "💳", "Módulo de crédito",    "Registro de remisiones, abonos y cartera"],
        ["pedidos",    "🛒", "Módulo de pedidos",    "Creación y seguimiento de pedidos de venta"],
        ["devolucion", "↩️", "Devoluciones",         "Registro de devoluciones de producto"],
        ["comisiones", "📊", "Comisiones / tablero", "Acceso al tablero de rendimiento y comisiones"]
      ].map(([key, icon, label, desc], i, arr) => `
        <div style="display:flex;align-items:center;gap:14px;padding:14px 0;
          ${i < arr.length - 1 ? "border-bottom:1px solid var(--border);" : ""}">
          <span style="font-size:20px;width:28px;text-align:center">${icon}</span>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:500;color:var(--text-primary)">${label}</div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:1px">${desc}</div>
          </div>
          <label class="ctrl-toggle" title="${label}">
            <input type="checkbox" id="ctrl-${key}" data-key="${key}" checked
              onchange="ControlUI.toggle('${key}', this.checked)">
            <span class="ctrl-slider"></span>
          </label>
          <span id="ctrl-lbl-${key}" style="font-size:10px;font-weight:700;width:52px;color:#16A34A">Activo</span>
        </div>`).join("")}
    </div>
    <div style="margin-top:10px;font-size:10.5px;color:#9CA3AF;line-height:1.5">
      ⚡ Los cambios se aplican en la próxima apertura de la app. La desactivación de un usuario
      activo se aplica en tiempo real. <span id="ctrl-ts" style="color:#6B7280"></span>
    </div>
  </div>

  <div class="cfg-actions">
    <div id="cfg-status" class="cfg-status hidden"></div>
    <button class="cfg-btn-secondary" id="cfg-btn-reset">Restaurar valores iniciales</button>
    <button class="cfg-btn-primary" id="cfg-btn-guardar">Guardar cambios</button>
  </div>

  <div class="cfg-preview-card">
    <div class="cfg-preview-head">Vista previa del encabezado en ticket</div>
    <div class="cfg-receipt" id="cfg-preview">
      <div class="cr-brand" id="pr-nombre">NUTRICIÓN DE 10</div>
      <div class="cr-sub" id="pr-subtitulo">Agroquímicos y Nutrición</div>
      <div class="cr-sub" id="pr-telefono">(667) 123-4567</div>
      <div class="cr-sub" id="pr-sitioweb">nutricionde10.com.mx</div>
      <div class="cr-div"></div>
      <div class="cr-footer" id="pr-footer-venta"></div>
    </div>
  </div>

  <!-- Alertas automáticas de cobranza -->
  <div class="cfg-card" id="cfg-alertas-cobranza-card">
    <div class="cfg-card-head">
      <div class="cfg-card-icon">💸</div>
      <div>
        <div class="cfg-card-title">Alertas automáticas de cobranza</div>
        <div class="cfg-card-sub">Se generan notificaciones diarias a las 09:00 AM</div>
      </div>
    </div>
    <div class="cfg-fields">
      <label class="cfg-label">
        <input type="checkbox" id="cfg-alert-activo" style="margin-right:6px"> Activar alertas de cobranza
      </label>
      <label class="cfg-label">Días de aviso previo al vencimiento</label>
      <input class="cfg-input" id="cfg-alert-aviso" type="number" min="1" max="30" value="3">
      <label class="cfg-label">Alertar cuando ya venció hace (días)</label>
      <input class="cfg-input" id="cfg-alert-postvenc" type="number" min="1" max="30" value="1">
    </div>
    <div style="display:flex;justify-content:flex-end;padding:12px 0 0">
      <button class="cfg-btn-guardar" id="cfg-alert-guardar">Guardar alertas</button>
    </div>
    <div id="cfg-alert-status" style="font-size:12px;color:#16A34A;height:16px;margin-top:4px"></div>
  </div>

</div>`;
}

const _css = `
.cfg-wrap {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 16px 40px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.cfg-card {
  background: var(--surface-2, #fff);
  border: 0.5px solid var(--border);
  border-radius: 12px;
  padding: 20px 24px;
}
.cfg-card-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 20px;
}
.cfg-card-icon { font-size: 22px; line-height: 1; margin-top: 2px; }
.cfg-card-title { font-size: 15px; font-weight: 500; color: var(--text-primary); }
.cfg-card-sub { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.cfg-fields { display: flex; flex-direction: column; gap: 14px; }
.cfg-label { font-size: 12px; color: var(--text-secondary); font-weight: 500; margin-bottom: -8px; }
.cfg-input, .cfg-textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--surface-1, #f9f9f9);
  border: 0.5px solid var(--border-strong);
  border-radius: var(--radius, 8px);
  padding: 8px 12px;
  font-size: 14px;
  color: var(--text-primary);
  font-family: inherit;
  resize: vertical;
}
.cfg-input:focus, .cfg-textarea:focus {
  outline: none;
  border-color: var(--border-accent);
  box-shadow: 0 0 0 2px var(--bg-accent);
}
.cfg-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.cfg-status {
  flex: 1;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: var(--radius, 8px);
}
.cfg-status.ok { background: var(--bg-success); color: var(--text-success); }
.cfg-status.err { background: var(--bg-danger); color: var(--text-danger); }
.cfg-status.hidden { display: none; }
.cfg-btn-primary {
  background: var(--fill-accent);
  color: var(--on-accent);
  border: none;
  border-radius: var(--radius, 8px);
  padding: 9px 20px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
.cfg-btn-primary:hover { background: var(--fill-accent-hover); }
.cfg-btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border: 0.5px solid var(--border-strong);
  border-radius: var(--radius, 8px);
  padding: 9px 20px;
  font-size: 14px;
  cursor: pointer;
  margin-left: auto;
}
.cfg-btn-secondary:hover { background: var(--surface-1); }
.cfg-preview-card {
  background: var(--surface-1, #f3f3f3);
  border: 0.5px solid var(--border);
  border-radius: 12px;
  padding: 20px 24px;
}
.cfg-preview-head {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 16px;
}
.cfg-receipt {
  width: 220px;
  background: #FAFAF6;
  border: 0.5px solid #CCC;
  border-top: 2px dashed #BBB;
  padding: 10px;
  font-family: 'Courier New', Courier, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: #111;
  margin: 0 auto;
}
.cr-brand { font-weight: bold; font-size: 13px; text-align: center; color: #1A5C2E; }
.cr-sub { text-align: center; color: #555; font-size: 10px; }
.cr-div { border-top: 1px dashed #888; margin: 6px 0; }
.cr-footer { font-size: 10px; color: #777; text-align: center; white-space: pre-line; }

/* ── Control operativo toggles ── */
.ctrl-toggle {
  position: relative; display: inline-block;
  width: 40px; height: 22px; cursor: pointer; flex-shrink: 0;
}
.ctrl-toggle input { opacity: 0; width: 0; height: 0; }
.ctrl-slider {
  position: absolute; inset: 0; border-radius: 22px;
  background: #374151; transition: background .2s;
}
.ctrl-slider::before {
  content: ""; position: absolute;
  width: 16px; height: 16px; border-radius: 50%;
  left: 3px; top: 3px; background: #fff; transition: transform .2s;
}
.ctrl-toggle input:checked + .ctrl-slider { background: #16A34A; }
.ctrl-toggle input:checked + .ctrl-slider::before { transform: translateX(18px); }
`;

// ── Control operativo ─────────────────────────────────────────
const CONTROL_DOC = "configuracion/control";
const FUNC_KEYS   = ["credito", "pedidos", "devolucion", "comisiones"];
let _ctrlUnsub = null;

function _iniciarControlListener() {
  _ctrlUnsub?.();
  const ref = doc(db, ...CONTROL_DOC.split("/"));
  _ctrlUnsub = onSnapshot(ref, snap => {
    const data = snap.exists() ? snap.data() : {};
    const func = data.funcionalidades ?? {};
    FUNC_KEYS.forEach(key => {
      const activo = func[key] !== false;
      const cb = document.getElementById(`ctrl-${key}`);
      const lbl = document.getElementById(`ctrl-lbl-${key}`);
      if (cb)  cb.checked = activo;
      if (lbl) { lbl.textContent = activo ? "Activo" : "Inactivo"; lbl.style.color = activo ? "#16A34A" : "#DC2626"; }
    });
    const ts = document.getElementById("ctrl-ts");
    if (ts && data.actualizadoEn) {
      const d = data.actualizadoEn.toDate ? data.actualizadoEn.toDate() : new Date(data.actualizadoEn);
      ts.textContent = `Último cambio: ${d.toLocaleString("es-MX")} por ${data.actualizadoPor ?? "–"}`;
    }
  }, err => console.error("[Control]", err));
}

window.ControlUI = {
  async toggle(key, activo) {
    const lbl = document.getElementById(`ctrl-lbl-${key}`);
    if (lbl) { lbl.textContent = activo ? "Activo" : "Inactivo"; lbl.style.color = activo ? "#16A34A" : "#DC2626"; }
    try {
      await setDoc(doc(db, ...CONTROL_DOC.split("/")), {
        funcionalidades: { [key]: activo },
        actualizadoPor: Sesion.alias,
        actualizadoEn: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      window.toast?.("Error al guardar control: " + e.message, "error");
      // Revertir toggle visualmente en caso de error
      const cb = document.getElementById(`ctrl-${key}`);
      if (cb) cb.checked = !activo;
      if (lbl) { lbl.textContent = !activo ? "Activo" : "Inactivo"; lbl.style.color = !activo ? "#16A34A" : "#DC2626"; }
    }
  }
};

export const ConfigModule = {

    _styleEl: null,

    mount(container) {
        if (!_puedeAcceder()) {
            container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-secondary)">
                Acceso restringido a administradores.</div>`;
            return;
        }

        if (!this._styleEl) {
            this._styleEl = document.createElement("style");
            this._styleEl.textContent = _css;
            document.head.appendChild(this._styleEl);
        }

        container.innerHTML = _html();
        _iniciarControlListener();
        this._cargarDatos(container);
        this._bindEventos(container);
        this._cargarAlertasCobranza();
        this._bindAlertasCobranza();
    },

    async _cargarDatos(container) {
        try {
            const db = getFirestore();
            const snap = await getDoc(doc(db, ...DOC_PATH.split("/")));
            const data = snap.exists() ? { ...DEFAULTS, ...snap.data() } : { ...DEFAULTS };
            this._poblarFormulario(data);
            this._actualizarPreview();
        } catch {
            this._poblarFormulario(DEFAULTS);
            this._actualizarPreview();
        }
    },

    _poblarFormulario(data) {
        document.getElementById("cfg-nombre").value        = data.nombreEmpresa ?? "";
        document.getElementById("cfg-subtitulo").value     = data.subtitulo     ?? "";
        document.getElementById("cfg-telefono").value      = data.telefono      ?? "";
        document.getElementById("cfg-sitioweb").value      = data.sitioWeb      ?? "";
        document.getElementById("cfg-footer-venta").value    = data.footerVenta    ?? "";
        document.getElementById("cfg-footer-abono").value   = data.footerAbono   ?? "";
        document.getElementById("cfg-footer-remision").value = data.footerRemision ?? "";
    },

    _leerFormulario() {
        return {
            nombreEmpresa: document.getElementById("cfg-nombre").value.trim().toUpperCase(),
            subtitulo:     document.getElementById("cfg-subtitulo").value.trim(),
            telefono:      document.getElementById("cfg-telefono").value.trim(),
            sitioWeb:      document.getElementById("cfg-sitioweb").value.trim(),
            footerVenta:    document.getElementById("cfg-footer-venta").value.trim(),
            footerAbono:    document.getElementById("cfg-footer-abono").value.trim(),
            footerRemision: document.getElementById("cfg-footer-remision").value.trim(),
        };
    },

    _actualizarPreview() {
        const nombre    = document.getElementById("cfg-nombre")?.value || "";
        const subtitulo = document.getElementById("cfg-subtitulo")?.value || "";
        const telefono  = document.getElementById("cfg-telefono")?.value || "";
        const sitioWeb  = document.getElementById("cfg-sitioweb")?.value || "";
        const footer    = document.getElementById("cfg-footer-venta")?.value || "";

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
        set("pr-nombre",       nombre.toUpperCase() || " ");
        set("pr-subtitulo",    subtitulo || " ");
        set("pr-telefono",     telefono || " ");
        set("pr-sitioweb",     sitioWeb || " ");
        set("pr-footer-venta", footer || " ");
    },

    _setStatus(msg, tipo) {
        const el = document.getElementById("cfg-status");
        if (!el) return;
        el.textContent = msg;
        el.className = `cfg-status ${tipo}`;
        if (tipo === "ok") setTimeout(() => { el.className = "cfg-status hidden"; }, 3000);
    },

    _bindEventos(container) {
        ["cfg-nombre","cfg-subtitulo","cfg-telefono","cfg-sitioweb","cfg-footer-venta"].forEach(id => {
            document.getElementById(id)?.addEventListener("input", () => this._actualizarPreview());
        });

        document.getElementById("cfg-btn-reset")?.addEventListener("click", async () => {
            if (!await window.modal({ title: "Restaurar valores", message: "¿Restaurar los valores iniciales? Se perderán los cambios no guardados." })) return;
            this._poblarFormulario(DEFAULTS);
            this._actualizarPreview();
        });

        document.getElementById("cfg-btn-guardar")?.addEventListener("click", () => this._guardar());
    },

    async _guardar() {
        const data = this._leerFormulario();

        if (!data.nombreEmpresa) {
            this._setStatus("El nombre de la empresa es obligatorio.", "err");
            return;
        }

        const btn = document.getElementById("cfg-btn-guardar");
        if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

        try {
            const db = getFirestore();
            await setDoc(doc(db, ...DOC_PATH.split("/")), {
                ...data,
                ultimoEditor:       Sesion.alias,
                fechaActualizacion: Date.now(),
            });
            this._setStatus("Configuración guardada correctamente.", "ok");
        } catch (e) {
            this._setStatus("Error al guardar. Verifique la conexión.", "err");
            console.error(e);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = "Guardar cambios"; }
        }
    },

    async _cargarAlertasCobranza() {
        try {
            const db = getFirestore();
            const snap = await getDoc(doc(db, "configuracion", "alertas_cobranza"));
            const d = snap.exists() ? snap.data() : {};
            const el = id => document.getElementById(id);
            if (el("cfg-alert-activo"))   el("cfg-alert-activo").checked  = d.activo !== false;
            if (el("cfg-alert-aviso"))    el("cfg-alert-aviso").value     = d.diasAviso ?? 3;
            if (el("cfg-alert-postvenc")) el("cfg-alert-postvenc").value  = d.diasPostVencimiento ?? 1;
        } catch (e) { console.error("[Config] alertas cobranza:", e); }
    },

    _bindAlertasCobranza() {
        document.getElementById("cfg-alert-guardar")?.addEventListener("click", async () => {
            const db     = getFirestore();
            const activo = document.getElementById("cfg-alert-activo")?.checked ?? true;
            const aviso  = Number(document.getElementById("cfg-alert-aviso")?.value)  || 3;
            const post   = Number(document.getElementById("cfg-alert-postvenc")?.value) || 1;
            const btn    = document.getElementById("cfg-alert-guardar");
            const status = document.getElementById("cfg-alert-status");
            if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }
            try {
                await setDoc(doc(db, "configuracion", "alertas_cobranza"),
                    { activo, diasAviso: aviso, diasPostVencimiento: post,
                      ultimoEditor: Sesion.alias, fechaActualizacion: Date.now() });
                if (status) status.textContent = "✓ Guardado";
                setTimeout(() => { if (status) status.textContent = ""; }, 3000);
            } catch (e) {
                if (status) { status.textContent = "Error: " + e.message; status.style.color = "#DC2626"; }
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = "Guardar alertas"; }
            }
        });
    },

    destroy() {
        _ctrlUnsub?.();
        _ctrlUnsub = null;
    }
};
