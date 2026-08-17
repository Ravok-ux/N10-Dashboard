// ══════════════════════════════════════════════════════════════
// comisiones.js — Configuración de comisiones por ingeniero
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { esc } from "./app.js";
import { Sesion } from "./auth.js";
import {
  collection, doc, onSnapshot, setDoc, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const fmtMXN = v => new Intl.NumberFormat("es-MX", { style:"currency", currency:"MXN" }).format(v || 0);

let _unsubs = [];

export const ComisionesModule = {
  mount(container) {
    if (!Sesion.esSuperAdmin() && Sesion.rol !== "GERENTE" && Sesion.rol !== "ADMINISTRADOR") {
      container.innerHTML = `
        <div class="empty-state" style="flex:1;justify-content:center">
          <div class="empty-state-icon">🔒</div>
          <div class="empty-state-title">Acceso restringido</div>
        </div>`;
      return;
    }
    container.innerHTML = _html();
    _bindAcciones();
    _escucharConfigs();
    _escucharLiquidaciones();
    return () => this.destroy();
  },

  destroy() {
    _unsubs.forEach(fn => fn && fn());
    _unsubs = [];
  }
};

// ── HTML ──────────────────────────────────────────────────────
function _html() {
  return `
  <div style="display:flex;flex-direction:column;height:100%;gap:0">

    <!-- Header -->
    <div style="display:flex;align-items:center;gap:10px;padding:16px 20px;
      border-bottom:1px solid var(--c-border);flex-shrink:0">
      <div>
        <div style="font-size:13px;font-weight:800;color:var(--c-text)">Comisiones e ingenieros</div>
        <div style="font-size:10.5px;color:#9CA3AF" id="com-subtitle">Cargando…</div>
      </div>
      <div style="flex:1"></div>
      <button onclick="ComisionesUI.nuevaConfig()"
        style="background:#166534;border:1px solid #16A34A;border-radius:7px;padding:7px 14px;
          font-size:11.5px;font-weight:700;color:#4ADE80;cursor:pointer">
        + Configurar ingeniero
      </button>
    </div>

    <!-- Dos paneles: configs y liquidaciones -->
    <div style="display:flex;flex:1;overflow:hidden;gap:0">

      <!-- Panel izquierdo: configuraciones -->
      <div style="flex:1;overflow-y:auto;border-right:1px solid var(--c-border);padding:16px">
        <div style="font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;
          letter-spacing:.07em;margin-bottom:12px">Configuración por ingeniero</div>
        <div id="com-configs-list">
          <div style="color:#9CA3AF;font-size:12px;text-align:center;padding:32px">Cargando…</div>
        </div>
      </div>

      <!-- Panel derecho: liquidaciones -->
      <div style="flex:1.2;overflow-y:auto;padding:16px">
        <div style="font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;
          letter-spacing:.07em;margin-bottom:12px">Historial de liquidaciones</div>
        <div id="com-liq-list">
          <div style="color:#9CA3AF;font-size:12px;text-align:center;padding:32px">Cargando…</div>
        </div>
      </div>

    </div>
  </div>

  <!-- Modal: configurar -->
  <div id="modal-comision" class="modal-overlay hidden">
    <div class="modal" style="max-width:500px">
      <div class="modal-title" id="com-modal-title">Configurar comisión</div>

      <div class="form-group">
        <label class="form-label">Ingeniero (alias)</label>
        <input id="com-alias" type="text" class="form-input" placeholder="Ramírez E." readonly>
      </div>

      <div class="form-group">
        <label class="form-label">Salario base mensual</label>
        <input id="com-salario" type="number" class="form-input" placeholder="0.00" min="0" step="100">
      </div>

      <div style="font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;
        letter-spacing:.06em;margin:14px 0 8px">Tramos de comisión (por volumen de ventas)</div>

      <div id="com-tramos">
        <!-- generado dinámicamente -->
      </div>

      <button onclick="ComisionesUI.agregarTramo()"
        style="font-size:11px;color:#60A5FA;background:none;border:none;cursor:pointer;padding:4px 0;margin-bottom:12px">
        + Agregar tramo
      </button>

      <div style="font-size:10px;color:#9CA3AF;padding:8px 10px;background:var(--c-surface);
        border-radius:6px;border:1px solid var(--c-border);margin-bottom:12px">
        💡 Cada tramo aplica el porcentaje sobre el intervalo entre la meta anterior y esta.
        Ejemplo: hasta $100k → 3%, hasta $150k → 5% = sobre los primeros $100k cobra 3%, sobre el tramo $100k-$150k cobra 5%.
      </div>

      <div class="modal-actions">
        <button class="btn-secondary" onclick="ComisionesUI.cerrarModal()">Cancelar</button>
        <button class="btn-primary" style="width:auto;padding:8px 20px"
          onclick="ComisionesUI.guardarConfig()">Guardar</button>
      </div>
    </div>
  </div>

  <!-- Modal: alias selector -->
  <div id="modal-alias" class="modal-overlay hidden">
    <div class="modal" style="max-width:360px">
      <div class="modal-title">Seleccionar ingeniero</div>
      <div id="alias-list" style="max-height:260px;overflow-y:auto;margin-bottom:16px">
        Cargando…
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" onclick="ComisionesUI.cerrarModal()">Cancelar</button>
      </div>
    </div>
  </div>`;
}

// ── Listeners Firestore ────────────────────────────────────────
function _escucharConfigs() {
  const q = query(collection(db, "comision_config"), orderBy("aliasIngeniero"));
  const unsub = onSnapshot(q, snap => {
    const el = document.getElementById("com-configs-list");
    if (!el) return;

    const sub = document.getElementById("com-subtitle");
    if (sub) sub.textContent = `${snap.size} ingenieros configurados`;

    if (snap.empty) {
      el.innerHTML = `<div style="color:#9CA3AF;font-size:12px;text-align:center;padding:32px">
        Sin configuraciones. Usa "+ Configurar ingeniero".</div>`;
      return;
    }

    el.innerHTML = snap.docs.map(d => {
      const c = d.data();
      const tramos = _descTramos(c.tramosJson);
      return `
        <div style="background:var(--c-surface);border:1px solid var(--c-border);border-radius:8px;
          padding:12px 14px;margin-bottom:8px">
          <div style="display:flex;align-items:center;margin-bottom:6px">
            <div style="flex:1;font-size:13px;font-weight:700;color:var(--c-text)">${esc(c.aliasIngeniero)}</div>
            <div style="font-size:12px;color:#4ADE80;font-weight:700">Base: ${fmtMXN(c.salarioBase)}</div>
          </div>
          <div style="font-size:11px;color:#9CA3AF;margin-bottom:8px">${tramos}</div>
          <button onclick="ComisionesUI.editarConfig('${d.id}')"
            style="font-size:11px;background:var(--c-surface2);border:1px solid var(--c-border);
              border-radius:5px;padding:4px 10px;cursor:pointer;color:var(--c-text)">
            ✏️ Editar
          </button>
        </div>`;
    }).join("");
  }, err => {
    console.error("[Comisiones:configs]", err);
    window.toast?.("Error al cargar configuraciones", "error");
  });
  _unsubs.push(unsub);
}

function _escucharLiquidaciones() {
  const q = query(collection(db, "liquidacion_comision"), orderBy("fechaInicio", "desc"));
  const unsub = onSnapshot(q, snap => {
    const el = document.getElementById("com-liq-list");
    if (!el) return;

    if (snap.empty) {
      el.innerHTML = `<div style="color:#9CA3AF;font-size:12px;text-align:center;padding:32px">
        Sin liquidaciones registradas.</div>`;
      return;
    }

    el.innerHTML = snap.docs.map(d => {
      const l = d.data();
      const statusColor = l.status === "PAGADO" ? "#4ADE80" : l.status === "CANCELADO" ? "#EF4444" : "#FBBF24";
      return `
        <div style="background:var(--c-surface);border:1px solid var(--c-border);border-radius:8px;
          padding:12px 14px;margin-bottom:8px">
          <div style="display:flex;align-items:center;margin-bottom:4px">
            <div style="flex:1;font-size:13px;font-weight:700;color:var(--c-text)">${esc(l.aliasIngeniero)}</div>
            <div style="font-size:11px;font-weight:700;color:${statusColor};
              background:${statusColor}22;border-radius:4px;padding:2px 8px">${esc(l.status || "PENDIENTE")}</div>
          </div>
          <div style="font-size:11px;color:#9CA3AF;margin-bottom:6px">${l.periodoLabel}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
            <div>
              <div style="font-size:9px;color:#6B7280;text-transform:uppercase">Ventas</div>
              <div style="font-size:12px;font-weight:700;color:var(--c-text)">${fmtMXN(l.totalVendido)}</div>
            </div>
            <div>
              <div style="font-size:9px;color:#6B7280;text-transform:uppercase">Comisión</div>
              <div style="font-size:12px;font-weight:700;color:#60A5FA">${fmtMXN(l.montoComision)}</div>
            </div>
            <div>
              <div style="font-size:9px;color:#6B7280;text-transform:uppercase">Total pago</div>
              <div style="font-size:12px;font-weight:700;color:#4ADE80">${fmtMXN(l.totalPago)}</div>
            </div>
          </div>
          ${Sesion.esSuperAdmin() || Sesion.rol === "ADMINISTRADOR" ? `
          <div style="margin-top:8px;display:flex;gap:8px">
            <button onclick="ComisionesUI.marcarPagado('${d.id}')"
              style="font-size:11px;background:#166534;border:1px solid #16A34A;border-radius:5px;
                padding:4px 10px;cursor:pointer;color:#4ADE80">
              ✔ Marcar pagado
            </button>
          </div>` : ""}
        </div>`;
    }).join("");
  }, err => {
    console.error("[Comisiones:liq]", err);
    window.toast?.("Error al cargar liquidaciones", "error");
  });
  _unsubs.push(unsub);
}

// ── Acciones ──────────────────────────────────────────────────
function _bindAcciones() {
  let _editandoAlias = null;
  let _tramos = [];

  window.ComisionesUI = {

    nuevaConfig() {
      _escucharIngenieros();
    },

    async editarConfig(alias) {
      _editandoAlias = alias;
      let snap;
      try {
        snap = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
          .then(m => m.getDoc(doc(db, "comision_config", alias)));
      } catch (e) {
        console.error("[comisiones] Error al cargar config:", e);
        window.toast?.("Error al cargar configuración. Intenta de nuevo.", "error");
        return;
      }
      const c = snap.exists() ? snap.data() : {};
      _tramos = _parseTramos(c.tramosJson) || [{ meta: 100000, pct: 3 }];

      document.getElementById("com-alias").value   = alias;
      document.getElementById("com-salario").value = c.salarioBase || 0;
      _renderTramos();
      document.getElementById("modal-alias").classList.add("hidden");
      document.getElementById("modal-comision").classList.remove("hidden");
    },

    cerrarModal() {
      document.querySelectorAll(".modal-overlay").forEach(m => m.classList.add("hidden"));
    },

    agregarTramo() {
      _tramos.push({ meta: 0, pct: 0 });
      _renderTramos();
    },

    eliminarTramo(idx) {
      _tramos.splice(idx, 1);
      _renderTramos();
    },

    async guardarConfig() {
      const alias   = document.getElementById("com-alias").value.trim();
      const salario = parseFloat(document.getElementById("com-salario").value) || 0;
      if (!alias) { window.toast?.("Alias requerido", "error"); return; }

      // Leer tramos del DOM
      _tramos = [];
      document.querySelectorAll(".tramo-row").forEach(row => {
        const meta = parseFloat(row.querySelector(".tramo-meta")?.value ?? "0") || 0;
        const pct  = parseFloat(row.querySelector(".tramo-pct")?.value  ?? "0") || 0;
        _tramos.push({ meta, pct });
      });
      _tramos.sort((a, b) => a.meta - b.meta);

      try {
        await setDoc(doc(db, "comision_config", alias), {
          aliasIngeniero: alias,
          salarioBase: salario,
          tramosJson: JSON.stringify(_tramos),
          actualizadoPor: Sesion.uid,
          actualizadoEn: serverTimestamp()
        });
        window.toast?.(`Configuración guardada para ${alias}`, "success");
        this.cerrarModal();
      } catch (e) {
        window.toast?.("Error: " + e.message, "error");
      }
    },

    async marcarPagado(liquidacionId) {
      if (!confirm("¿Marcar esta liquidación como pagada?")) return;
      try {
        const { updateDoc, doc: fsDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        await updateDoc(fsDoc(db, "liquidacion_comision", liquidacionId), {
          status: "PAGADO",
          pagadoPor: Sesion.uid,
          pagadoEn: serverTimestamp()
        });
        window.toast?.("Liquidación marcada como pagada", "success");
      } catch (e) {
        window.toast?.("Error: " + e.message, "error");
      }
    }
  };

  // Escuchar ingenieros disponibles para el selector
  function _escucharIngenieros() {
    const q = query(collection(db, "usuarios"), orderBy("alias"));
    const list = document.getElementById("alias-list");
    if (!list) return;

    onSnapshot(q, snap => {
      const ingenieros = snap.docs
        .filter(d => d.data().rol === "INGENIERO" && d.data().activo !== false);
      list.innerHTML = ingenieros.length === 0
        ? `<div style="color:#9CA3AF;text-align:center;padding:16px">Sin ingenieros registrados</div>`
        : ingenieros.map(d => {
            const u = d.data();
            return `
              <div onclick="ComisionesUI.editarConfig('${u.alias || d.id}')"
                style="padding:10px 12px;border-radius:6px;cursor:pointer;
                  border-bottom:1px solid var(--c-border);font-size:13px;color:var(--c-text);
                  font-weight:600">
                ${u.alias || d.id}
                <span style="font-size:10px;color:#9CA3AF;font-weight:400;margin-left:6px">${u.email || ""}</span>
              </div>`;
          }).join("");
    });
    document.getElementById("modal-alias").classList.remove("hidden");
  }

  function _renderTramos() {
    const el = document.getElementById("com-tramos");
    if (!el) return;
    el.innerHTML = _tramos.map((t, i) => `
      <div class="tramo-row" style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
        <div style="flex:1">
          <label style="font-size:10px;color:#9CA3AF">Meta ventas ($)</label>
          <input class="tramo-meta form-input" type="number" value="${t.meta}" min="0" step="1000"
            style="width:100%;margin-top:2px">
        </div>
        <div style="flex:0.6">
          <label style="font-size:10px;color:#9CA3AF">% comisión</label>
          <input class="tramo-pct form-input" type="number" value="${t.pct}" min="0" max="100" step="0.5"
            style="width:100%;margin-top:2px">
        </div>
        <button onclick="ComisionesUI.eliminarTramo(${i})"
          style="margin-top:16px;background:none;border:none;cursor:pointer;color:#EF4444;font-size:16px">✕</button>
      </div>`).join("");
  }
}

// ── Helpers ───────────────────────────────────────────────────
function _parseTramos(json) {
  try { return JSON.parse(json || "[]"); } catch { return []; }
}

function _descTramos(json) {
  const tramos = _parseTramos(json);
  if (!tramos.length) return "Sin tramos configurados";
  return tramos.map((t, i) => {
    const desde = i === 0 ? 0 : tramos[i - 1].meta;
    return `${new Intl.NumberFormat("es-MX", { notation:"compact", currency:"MXN" }).format(desde)}–${new Intl.NumberFormat("es-MX", { notation:"compact" }).format(t.meta)}: <b style="color:#60A5FA">${t.pct}%</b>`;
  }).join("  ·  ");
}
