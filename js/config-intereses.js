// ══════════════════════════════════════════════════════════════
// config-intereses.js — Panel SUPER_ADMIN para tasas de interés
// ══════════════════════════════════════════════════════════════

import { db }   from "./firebase-config.js";
import { esc, norm } from "./app.js";
import { Sesion } from "./auth.js";
import { TASA_SEMANAL_DEFAULT, DIAS_GRACIA_DEFAULT } from "./intereses-engine.js";
import {
  collection, query, orderBy, limit, onSnapshot,
  doc, getDoc, setDoc, updateDoc, serverTimestamp,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Formatters ────────────────────────────────────────────────
const fmtPctSem = n => (Number(n) * 100).toFixed(4) + "% / sem";
const fmtPct    = n => (Number(n) * 100).toFixed(4) + "%";
const fmtDiaria = n => Number(n).toFixed(6);
const fmtFecha  = iso => new Date(iso).toLocaleDateString("es-MX",
  { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
const fmtMXN    = n => (n ?? 0).toLocaleString("es-MX", { minimumFractionDigits:2 });

// ── CSS inyectado ─────────────────────────────────────────────
const CI_CSS = `
#ci-wrap { font-family: inherit; }

/* Section cards */
.ci-card {
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 12px;
  padding: 22px 24px;
  margin-bottom: 18px;
}

/* Section heading */
.ci-sec-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.ci-sec-accent {
  width: 4px; height: 22px;
  border-radius: 2px;
  background: var(--accent, #16a34a);
  flex-shrink: 0;
}
.ci-sec-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--text, #0f172a);
  flex: 1;
}
.ci-sec-sub {
  font-size: 11.5px;
  color: var(--text-muted, #64748b);
  margin-top: 2px;
}

/* KPI tiles */
.ci-kpis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}
.ci-kpi {
  background: var(--surface-2, #f8fafc);
  border: 1px solid var(--border, #e2e8f0);
  border-left: 4px solid var(--kc, #3b82f6);
  border-radius: 8px;
  padding: 12px 14px;
}
.ci-kpi-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .07em;
  color: var(--text-muted, #64748b);
  margin-bottom: 5px;
}
.ci-kpi-val {
  font-size: 17px;
  font-weight: 800;
  color: var(--kc, #3b82f6);
  font-variant-numeric: tabular-nums;
}

/* Historial timeline */
.ci-hist-list { display: flex; flex-direction: column; gap: 6px; }
.ci-hist-item {
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 8px 12px;
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--surface-2, #f8fafc);
  border: 1px solid var(--border, #e2e8f0);
  transition: background .1s;
}
.ci-hist-item:hover { background: var(--surface, #fff); }
.ci-hist-date { font-size: 10.5px; color: var(--text-muted, #94a3b8); padding-top: 2px; line-height: 1.4; }
.ci-hist-body { font-size: 12px; }
.ci-hist-change { font-weight: 700; color: var(--text, #0f172a); margin-bottom: 2px; }
.ci-hist-who { font-size: 10.5px; color: var(--text-muted, #94a3b8); }

/* Filters bar */
.ci-filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 12px;
}
.ci-filter-sel {
  flex: 0 0 240px;
  position: relative;
}
.ci-filter-sel select {
  width: 100%;
  padding: 8px 30px 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--border, #d1d5db);
  background: var(--surface, #fff);
  color: var(--text, #374151);
  font-size: 12.5px;
  appearance: none;
  cursor: pointer;
}
.ci-filter-chevron {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  color: var(--text-muted, #94a3b8);
  font-size: 10px;
}
.ci-filter-input {
  flex: 1;
  min-width: 140px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--border, #d1d5db);
  background: var(--surface, #fff);
  color: var(--text, #374151);
  font-size: 12.5px;
}
.ci-filter-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted, #64748b);
  cursor: pointer;
  white-space: nowrap;
  padding: 6px 0;
}
.ci-filter-check input { cursor: pointer; accent-color: var(--accent, #16a34a); }

/* Table */
.ci-tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.ci-tbl thead th {
  padding: 9px 14px;
  text-align: left;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--text-muted, #64748b);
  border-bottom: 2px solid var(--border, #e2e8f0);
  background: var(--surface-2, #f8fafc);
  white-space: nowrap;
}
.ci-tbl thead th.r { text-align: right; }
.ci-tbl thead th.c { text-align: center; }
.ci-tbl tbody tr { transition: background .1s; }
.ci-tbl tbody tr:hover { background: var(--surface-2, #f8fafc); }
.ci-tbl tbody td { padding: 9px 14px; border-bottom: 1px solid var(--border, #e2e8f0); vertical-align: middle; }
.ci-tbl tbody tr:last-child td { border-bottom: none; }
.ci-tbl td.r { text-align: right; font-variant-numeric: tabular-nums; }
.ci-tbl td.c { text-align: center; }
.ci-tbl tr.pagado { opacity: .45; }

/* Badges */
.ci-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 20px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .04em;
}

/* Row action button */
.ci-row-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border, #d1d5db);
  background: transparent;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  color: var(--text, #374151);
  transition: background .1s, border-color .1s;
}
.ci-row-btn:hover { background: var(--surface-2, #f1f5f9); border-color: var(--text-muted, #94a3b8); }
.ci-row-btn.override {
  border-color: #f59e0b;
  color: #b45309;
  background: #fef3c718;
}
.ci-row-btn.override:hover { background: #fef3c740; }

/* Main action button */
.ci-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  border: none;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: filter .1s;
}
.ci-btn:hover { filter: brightness(.93); }
.ci-btn-primary   { background: var(--accent, #16a34a); color: #fff; }
.ci-btn-secondary { background: transparent; border: 1px solid var(--border, #d1d5db); color: var(--text, #374151); }
.ci-btn-danger    { background: #ef4444; color: #fff; }
.ci-btn-outline   { background: transparent; border: 1.5px solid #2563eb; color: #2563eb; }
.ci-btn-outline:hover { background: #2563eb12; }

/* Warning banner */
.ci-warn {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 10px 14px;
  border-radius: 8px;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  color: #92400e;
  font-size: 12px;
  line-height: 1.5;
  margin-bottom: 16px;
}
.ci-warn-icon { font-size: 15px; flex-shrink: 0; margin-top: 1px; }

/* Modals */
.ci-modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.45);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
  z-index: 9100;
  animation: ciFadeIn .15s ease;
}
.ci-modal-overlay.hidden { display: none; }
@keyframes ciFadeIn { from { opacity: 0; } to { opacity: 1; } }
.ci-modal {
  background: var(--surface, #fff);
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0,0,0,.25);
  display: flex; flex-direction: column;
  max-height: 90vh;
  overflow: hidden;
  animation: ciSlideUp .18s ease;
}
@keyframes ciSlideUp { from { transform: translateY(14px); opacity: 0; } to { transform: none; opacity: 1; } }
.ci-modal-head {
  padding: 18px 22px 14px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  display: flex; align-items: center; justify-content: space-between;
}
.ci-modal-head h3 { margin: 0; font-size: 16px; font-weight: 800; }
.ci-modal-close {
  width: 30px; height: 30px; border-radius: 50%;
  border: none; background: var(--surface-2, #f1f5f9);
  font-size: 14px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-muted, #64748b);
}
.ci-modal-close:hover { background: var(--border); }
.ci-modal-body { padding: 20px 22px; overflow-y: auto; flex: 1; }
.ci-modal-foot {
  padding: 14px 22px;
  border-top: 1px solid var(--border, #e2e8f0);
  display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap;
}

/* Form fields */
.ci-field { margin-bottom: 14px; }
.ci-field:last-child { margin-bottom: 0; }
.ci-field label {
  display: block;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .05em;
  color: var(--text-muted, #64748b);
  margin-bottom: 5px;
}
.ci-input-wrap { display: flex; }
.ci-input-wrap .input { border-radius: 8px 0 0 8px; border-right: none; flex: 1; }
.ci-input-suffix {
  padding: 8px 12px;
  background: var(--surface-2, #f8fafc);
  border: 1px solid var(--border, #d1d5db);
  border-radius: 0 8px 8px 0;
  font-size: 13px;
  color: var(--text-muted, #64748b);
  white-space: nowrap;
  display: flex; align-items: center;
}
.ci-preview {
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--text-muted, #64748b);
  min-height: 16px;
}

/* Info box */
.ci-info-box {
  background: var(--surface-2, #f8fafc);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 16px;
  font-size: 12.5px;
  line-height: 1.7;
}

/* Access denied */
.ci-denied {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 24px;
  text-align: center;
  color: var(--text-muted, #94a3b8);
}
.ci-denied-icon { font-size: 40px; margin-bottom: 12px; }
.ci-denied-title { font-size: 15px; font-weight: 700; margin-bottom: 6px; }
.ci-denied-sub { font-size: 12.5px; }
`;

// ── Guardia de acceso ─────────────────────────────────────────
function _esSuperAdmin() { return Sesion.esSuperAdmin?.() === true; }

export const ConfigInteresesModule = {
  mount(container) {
    // CSS
    if (!document.getElementById('ci-styles')) {
      const s = document.createElement('style');
      s.id = 'ci-styles';
      s.textContent = CI_CSS;
      document.head.appendChild(s);
    }
    if (!_esSuperAdmin()) {
      container.innerHTML = `<div class="ci-denied">
        <div class="ci-denied-icon">🔒</div>
        <div class="ci-denied-title">Acceso restringido</div>
        <div class="ci-denied-sub">Solo el SUPER_ADMIN puede configurar las tasas de interés.</div>
      </div>`;
      return () => {};
    }
    container.innerHTML = _html();
    _bindUI();
    _cargarGlobal();
    _escucharNotas();
    return () => this.destroy();
  },
  destroy() {
    _unsubNotas?.(); _unsubNotas = null;
  }
};

let _unsubNotas   = null;
let _notasCache   = [];
let _notaTarget   = null;
let _configGlobal = null;

// ── HTML ──────────────────────────────────────────────────────
function _html() {
  return `<div id="ci-wrap" style="padding:20px;overflow:auto;height:100%">

    <!-- Sección 1: Tasa global -->
    <div class="ci-card">
      <div class="ci-sec-head">
        <div class="ci-sec-accent"></div>
        <div>
          <div class="ci-sec-title">📊 Tasa de interés global (por defecto)</div>
          <div class="ci-sec-sub">Aplica a todas las notas nuevas. Las notas existentes ya tienen su tasa congelada.</div>
        </div>
        <button class="ci-btn ci-btn-outline" onclick="ConfigInteresesUI.abrirEditarGlobal()" style="margin-left:auto">
          ✏️ Editar
        </button>
      </div>

      <div class="ci-kpis">
        <div class="ci-kpi" style="--kc:#3b82f6">
          <div class="ci-kpi-label">Tasa Semanal</div>
          <div class="ci-kpi-val" id="ci-k-tasa-sem">–</div>
        </div>
        <div class="ci-kpi" style="--kc:#8b5cf6">
          <div class="ci-kpi-label">Tasa Diaria</div>
          <div class="ci-kpi-val" id="ci-k-tasa-dia">–</div>
        </div>
        <div class="ci-kpi" style="--kc:#10b981">
          <div class="ci-kpi-label">Días de Gracia</div>
          <div class="ci-kpi-val" id="ci-k-gracia">–</div>
        </div>
      </div>

      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
        color:var(--text-muted,#64748b);margin-bottom:8px">Historial de cambios</div>
      <div id="ci-historial-global">
        <span style="color:var(--text-muted,#94a3b8);font-size:13px">Cargando…</span>
      </div>
    </div>

    <!-- Sección 2: Override por nota -->
    <div class="ci-card">
      <div class="ci-sec-head">
        <div class="ci-sec-accent" style="background:#f59e0b"></div>
        <div>
          <div class="ci-sec-title">📝 Tasa diferenciada por nota</div>
          <div class="ci-sec-sub">Asigna una tasa distinta a notas específicas sin afectar las demás.</div>
        </div>
      </div>

      <div class="ci-filters">
        <div class="ci-filter-sel">
          <select id="ci-filtro-cliente" onchange="ConfigInteresesUI.filtrarNotas()">
            <option value="">Todos los clientes (0)</option>
          </select>
          <span class="ci-filter-chevron">▼</span>
        </div>
        <input id="ci-buscar-nota" type="text" class="ci-filter-input"
          placeholder="🔍  Buscar por folio…"
          oninput="ConfigInteresesUI.filtrarNotas()">
        <label class="ci-filter-check">
          <input type="checkbox" id="ci-solo-override" onchange="ConfigInteresesUI.filtrarNotas()">
          Solo con override
        </label>
      </div>

      <div style="overflow-x:auto">
        <table class="ci-tbl">
          <thead><tr>
            <th>Folio</th>
            <th>Cliente</th>
            <th class="r">Monto Orig.</th>
            <th class="r">Tasa Semanal</th>
            <th class="r">Tasa Diaria</th>
            <th class="c">Status</th>
            <th class="c">Override</th>
            <th class="c">Acción</th>
          </tr></thead>
          <tbody id="ci-tbody-notas">
            <tr><td colspan="8" style="padding:28px;text-align:center;color:var(--text-muted,#94a3b8)">Cargando notas…</td></tr>
          </tbody>
        </table>
      </div>
    </div>

  </div>

  <!-- Modal: editar tasa global -->
  <div id="ci-modal-global" class="ci-modal-overlay hidden">
    <div class="ci-modal" style="width:440px">
      <div class="ci-modal-head">
        <h3>Editar tasa global</h3>
        <button class="ci-modal-close" onclick="ConfigInteresesUI.cerrarGlobal()">✕</button>
      </div>
      <div class="ci-modal-body">
        <div class="ci-warn">
          <span class="ci-warn-icon">⚠️</span>
          <span>Cambiar esta tasa solo afecta a las <b>notas nuevas</b>. Las notas ya creadas tienen su tasa congelada al momento de la emisión.</span>
        </div>
        <div class="ci-field">
          <label>Tasa semanal (%) *</label>
          <div class="ci-input-wrap">
            <input id="ci-g-tasa" type="number" class="input" step="0.01" min="0" max="100" placeholder="1.00">
            <span class="ci-input-suffix">%</span>
          </div>
          <div class="ci-preview" id="ci-g-tasa-preview"></div>
        </div>
        <div class="ci-field">
          <label>Días de gracia (sin interés desde creación)</label>
          <input id="ci-g-gracia" type="number" class="input" step="1" min="0" max="90" placeholder="14" style="width:100%;box-sizing:border-box">
        </div>
        <div class="ci-field">
          <label>Motivo del cambio *</label>
          <textarea id="ci-g-motivo" class="input" rows="2" style="width:100%;box-sizing:border-box;resize:vertical"
            placeholder="Ej: Ajuste por acuerdo con dirección Q3 2026…"></textarea>
        </div>
      </div>
      <div class="ci-modal-foot">
        <button class="ci-btn ci-btn-secondary" onclick="ConfigInteresesUI.cerrarGlobal()">Cancelar</button>
        <button class="ci-btn ci-btn-primary" onclick="ConfigInteresesUI.guardarGlobal()">Guardar cambio</button>
      </div>
    </div>
  </div>

  <!-- Modal: override por nota -->
  <div id="ci-modal-nota" class="ci-modal-overlay hidden">
    <div class="ci-modal" style="width:460px">
      <div class="ci-modal-head">
        <h3>Tasa diferenciada para nota</h3>
        <button class="ci-modal-close" onclick="ConfigInteresesUI.cerrarNota()">✕</button>
      </div>
      <div class="ci-modal-body">
        <div class="ci-info-box" id="ci-nota-info"></div>
        <div class="ci-field">
          <label>Nueva tasa semanal para esta nota (%) *</label>
          <div class="ci-input-wrap">
            <input id="ci-n-tasa" type="number" class="input" step="0.01" min="0" max="100" placeholder="1.00">
            <span class="ci-input-suffix">%</span>
          </div>
          <div class="ci-preview" id="ci-n-tasa-preview"></div>
        </div>
        <div class="ci-field">
          <label>Motivo del cambio *</label>
          <textarea id="ci-n-motivo" class="input" rows="2" style="width:100%;box-sizing:border-box;resize:vertical"
            placeholder="Ej: Acuerdo especial con cliente por volumen…"></textarea>
        </div>
        <div class="ci-warn">
          <span class="ci-warn-icon">⚠️</span>
          <span>El nuevo interés se calculará con esta tasa desde el día 1 (retroactivo según las reglas del negocio). El cambio queda registrado en el historial de la nota.</span>
        </div>
      </div>
      <div class="ci-modal-foot">
        <button class="ci-btn ci-btn-secondary" onclick="ConfigInteresesUI.cerrarNota()">Cancelar</button>
        <button class="ci-btn ci-btn-danger" id="ci-n-btn-quitar" style="display:none"
          onclick="ConfigInteresesUI.quitarOverride()">↩ Restaurar tasa global</button>
        <button class="ci-btn ci-btn-primary" onclick="ConfigInteresesUI.guardarNota()">Aplicar tasa</button>
      </div>
    </div>
  </div>`;
}

// ── Bind UI ───────────────────────────────────────────────────
function _bindUI() {
  window.ConfigInteresesUI = {
    abrirEditarGlobal() {
      const g = _configGlobal;
      document.getElementById("ci-g-tasa").value   = ((g?.tasaSemanal ?? TASA_SEMANAL_DEFAULT) * 100).toFixed(2);
      document.getElementById("ci-g-gracia").value = g?.diasGracia ?? DIAS_GRACIA_DEFAULT;
      document.getElementById("ci-g-motivo").value = "";
      _previewTasa("ci-g-tasa", "ci-g-tasa-preview");
      document.getElementById("ci-modal-global").classList.remove("hidden");
      document.getElementById("ci-g-tasa").oninput = () => _previewTasa("ci-g-tasa", "ci-g-tasa-preview");
    },
    cerrarGlobal() {
      document.getElementById("ci-modal-global").classList.add("hidden");
    },
    async guardarGlobal() {
      const pct       = parseFloat(document.getElementById("ci-g-tasa").value);
      const tasaSemanal = pct / 100;
      const diasGracia  = parseInt(document.getElementById("ci-g-gracia").value, 10);
      const motivo      = document.getElementById("ci-g-motivo").value.trim();
      if (!pct || pct <= 0 || pct > 100) { window.toast?.("Tasa inválida (0 < tasa ≤ 100%).", "error"); return; }
      if (!motivo) { window.toast?.("Escribe el motivo del cambio.", "error"); return; }
      const entrada = {
        fecha:              new Date().toISOString(),
        tasaAnterior:       _configGlobal?.tasaSemanal ?? TASA_SEMANAL_DEFAULT,
        tasaNueva:          tasaSemanal,
        diasGraciaAnterior: _configGlobal?.diasGracia ?? DIAS_GRACIA_DEFAULT,
        diasGraciaNueva:    isNaN(diasGracia) ? (_configGlobal?.diasGracia ?? DIAS_GRACIA_DEFAULT) : diasGracia,
        modificadoPor:      Sesion.alias,
        motivo,
      };
      try {
        await setDoc(doc(db, "config_intereses", "default"), {
          tasaSemanal,
          diasGracia:     entrada.diasGraciaNueva,
          historial:      arrayUnion(entrada),
          actualizadoEn:  serverTimestamp(),
          actualizadoPor: Sesion.alias,
        }, { merge: true });
        window.toast?.("✅ Tasa global actualizada.", "success");
        this.cerrarGlobal();
        _cargarGlobal();
      } catch(e) { window.toast?.("Error: " + e.message, "error"); }
    },

    abrirNota(id) {
      _notaTarget = _notasCache.find(r => r.id === id);
      if (!_notaTarget) return;
      const tasaActual    = _notaTarget.tasaDiaria
        ? _notaTarget.tasaDiaria * 7
        : (_configGlobal?.tasaSemanal ?? TASA_SEMANAL_DEFAULT);
      const tieneOverride = !!_notaTarget.tasaDiaria;

      document.getElementById("ci-nota-info").innerHTML = `
        <div style="font-size:14px;font-weight:800;margin-bottom:6px">${esc(_notaTarget.folio || _notaTarget.id)}</div>
        <div style="color:var(--text-muted,#64748b)">${esc(_notaTarget.clienteNombre || "–")}</div>
        <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div><span style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)">Monto original</span>
            <div style="font-weight:700;font-size:13px">$${fmtMXN(_notaTarget.montoOriginal)}</div></div>
          <div><span style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)">Tasa actual</span>
            <div style="font-weight:700;font-size:13px;color:${tieneOverride?'#b45309':'var(--text)'}">
              ${fmtPctSem(tasaActual)}
              ${tieneOverride?'<span style="font-size:9px;margin-left:4px;background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:4px;font-weight:700">OVERRIDE</span>':''}
            </div></div>
        </div>`;

      document.getElementById("ci-n-tasa").value   = (tasaActual * 100).toFixed(2);
      document.getElementById("ci-n-motivo").value = "";
      document.getElementById("ci-n-btn-quitar").style.display = tieneOverride ? "" : "none";
      _previewTasa("ci-n-tasa", "ci-n-tasa-preview");
      document.getElementById("ci-modal-nota").classList.remove("hidden");
      document.getElementById("ci-n-tasa").oninput = () => _previewTasa("ci-n-tasa", "ci-n-tasa-preview");
    },
    cerrarNota() {
      document.getElementById("ci-modal-nota").classList.add("hidden");
      _notaTarget = null;
    },
    async guardarNota() {
      if (!_notaTarget) return;
      const pct         = parseFloat(document.getElementById("ci-n-tasa").value);
      const tasaSemanal = pct / 100;
      const motivo      = document.getElementById("ci-n-motivo").value.trim();
      if (!pct || pct <= 0 || pct > 100) { window.toast?.("Tasa inválida (0 < tasa ≤ 100%).", "error"); return; }
      if (!motivo) { window.toast?.("Escribe el motivo del cambio.", "error"); return; }
      const tasaDiariaAnterior = _notaTarget.tasaDiaria
        ?? ((_configGlobal?.tasaSemanal ?? TASA_SEMANAL_DEFAULT) / 7);
      const tasaDiariaNueva = tasaSemanal / 7;
      const entrada = {
        fecha: new Date().toISOString(),
        tasaDiariaAnterior, tasaDiariaNueva,
        tasaSemanalAnterior: tasaDiariaAnterior * 7,
        tasaSemanalNueva:    tasaSemanal,
        modificadoPor: Sesion.alias, motivo,
      };
      try {
        await updateDoc(doc(db, "remisiones_credito", _notaTarget.id), {
          tasaDiaria:        tasaDiariaNueva,
          tasaHistorial:     arrayUnion(entrada),
          tasaModificadaEn:  serverTimestamp(),
          tasaModificadaPor: Sesion.alias,
        });
        window.toast?.(`✅ Tasa de ${esc(_notaTarget.folio || _notaTarget.id)} actualizada.`, "success");
        this.cerrarNota();
      } catch(e) { window.toast?.("Error: " + e.message, "error"); }
    },
    async quitarOverride() {
      if (!_notaTarget?.tasaDiaria) return;
      const motivo = document.getElementById("ci-n-motivo").value.trim() || "Restauración a tasa global";
      const entrada = {
        fecha: new Date().toISOString(),
        tasaDiariaAnterior: _notaTarget.tasaDiaria,
        tasaDiariaNueva:    null,
        modificadoPor: Sesion.alias,
        motivo: motivo + " [restaurado a tasa global]",
      };
      try {
        await updateDoc(doc(db, "remisiones_credito", _notaTarget.id), {
          tasaDiaria:        null,
          tasaHistorial:     arrayUnion(entrada),
          tasaModificadaEn:  serverTimestamp(),
          tasaModificadaPor: Sesion.alias,
        });
        window.toast?.("Tasa restaurada a global.", "success");
        this.cerrarNota();
      } catch(e) { window.toast?.("Error: " + e.message, "error"); }
    },
    filtrarNotas() {
      const q         = norm(document.getElementById("ci-buscar-nota")?.value ?? "");
      const clienteSel = document.getElementById("ci-filtro-cliente")?.value ?? "";
      const soloOv    = document.getElementById("ci-solo-override")?.checked;
      _renderNotas(_notasCache.filter(r => {
        const matchQ   = !q  || norm(r.folio || "").includes(q);
        const matchCli = !clienteSel || (r.clienteNombre || "") === clienteSel;
        return matchQ && matchCli && (!soloOv || !!r.tasaDiaria);
      }));
    },
  };
}

// ── Cargar config global ──────────────────────────────────────
async function _cargarGlobal() {
  const snap = await getDoc(doc(db, "config_intereses", "default"));
  const data = snap.exists()
    ? snap.data()
    : { tasaSemanal: TASA_SEMANAL_DEFAULT, diasGracia: DIAS_GRACIA_DEFAULT, historial: [] };
  _configGlobal = data;

  _set("ci-k-tasa-sem", fmtPctSem(data.tasaSemanal));
  _set("ci-k-tasa-dia", fmtDiaria(data.tasaSemanal / 7) + " / día");
  _set("ci-k-gracia",   (data.diasGracia ?? DIAS_GRACIA_DEFAULT) + " días");

  const hist = [...(data.historial ?? [])].reverse();
  const el   = document.getElementById("ci-historial-global");
  if (!el) return;
  if (!hist.length) {
    el.innerHTML = `<span style="color:var(--text-muted,#94a3b8);font-size:13px">
      Sin cambios registrados. Tasa inicial: ${fmtPctSem(TASA_SEMANAL_DEFAULT)}.</span>`;
    return;
  }
  el.innerHTML = `<div class="ci-hist-list">
    ${hist.map(h => `
      <div class="ci-hist-item">
        <div class="ci-hist-date">${fmtFecha(h.fecha)}</div>
        <div class="ci-hist-body">
          <div class="ci-hist-change">
            ${fmtPctSem(h.tasaAnterior)} → ${fmtPctSem(h.tasaNueva)}
            ${h.diasGraciaAnterior !== h.diasGraciaNueva
              ? `<span style="font-weight:400;color:var(--text-muted,#64748b)"> · gracia ${h.diasGraciaAnterior}→${h.diasGraciaNueva} días</span>` : ""}
          </div>
          <div class="ci-hist-who">
            Por <strong style="color:var(--text,#0f172a)">${esc(h.modificadoPor)}</strong> · ${esc(h.motivo)}
          </div>
        </div>
      </div>`).join("")}
  </div>`;
}

function _poblarDropdownClientes() {
  const sel = document.getElementById("ci-filtro-cliente");
  if (!sel) return;
  const actual   = sel.value;
  const clientes = [...new Map(_notasCache
    .filter(r => r.clienteNombre)
    .map(r => [r.clienteNombre, r.clienteNombre])
  ).entries()].sort((a,b) => a[0].localeCompare(b[0]));
  sel.innerHTML = `<option value="">Todos los clientes (${_notasCache.length})</option>` +
    clientes.map(([n]) => `<option value="${esc(n)}"${n===actual?" selected":""}>${esc(n)}</option>`).join("");
}

// ── Listener notas ────────────────────────────────────────────
function _escucharNotas() {
  const q = query(collection(db,"remisiones_credito"), orderBy("fechaCreacion","desc"), limit(500));
  _unsubNotas = onSnapshot(q, snap => {
    _notasCache = snap.docs.map(d => ({id:d.id,...d.data()}));
    _poblarDropdownClientes();
    window.ConfigInteresesUI?.filtrarNotas?.();
  }, err => console.error("[ConfigIntereses]", err));
}

// ── Render tabla notas ────────────────────────────────────────
function _renderNotas(lista) {
  const tbody     = document.getElementById("ci-tbody-notas");
  if (!tbody) return;
  const tasaGlobal = _configGlobal?.tasaSemanal ?? TASA_SEMANAL_DEFAULT;

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:28px;text-align:center;color:var(--text-muted,#94a3b8)">
      Sin notas encontradas.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(r => {
    const tieneOverride = r.tasaDiaria != null;
    const tasaSem       = tieneOverride ? r.tasaDiaria * 7 : tasaGlobal;
    const esPagado      = r.status === "PAGADO";

    const statusColor  = esPagado ? '#10b981' : '#3b82f6';
    const statusBg     = esPagado ? '#10b98118' : '#3b82f618';
    const statusLabel  = r.status ?? "ACTIVA";

    return `<tr class="${esPagado?'pagado':''}">
      <td style="font-family:monospace;font-weight:700;white-space:nowrap;font-size:12px">
        ${esc(r.folio || r.id)}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${esc(r.clienteNombre || "–")}</td>
      <td class="r" style="font-weight:600">$${fmtMXN(r.montoOriginal)}</td>
      <td class="r" style="font-weight:${tieneOverride?'700':'500'};color:${tieneOverride?'#b45309':'var(--text,#374151)'}">
        ${fmtPctSem(tasaSem)}</td>
      <td class="r" style="color:var(--text-muted,#64748b);font-size:11.5px">
        ${fmtPct(tasaSem/7)}/día</td>
      <td class="c">
        <span class="ci-badge" style="background:${statusBg};color:${statusColor}">${statusLabel}</span>
      </td>
      <td class="c">
        ${tieneOverride
          ? `<span class="ci-badge" style="background:#fef3c7;color:#92400e">OVERRIDE</span>`
          : `<span style="color:var(--text-muted,#94a3b8);font-size:12px">–</span>`}
      </td>
      <td class="c">
        ${!esPagado
          ? `<button class="ci-row-btn${tieneOverride?' override':''}"
               onclick="ConfigInteresesUI.abrirNota('${r.id}')">
               ${tieneOverride ? '✏️ Editar tasa' : '＋ Asignar tasa'}
             </button>`
          : '<span style="color:var(--text-muted,#94a3b8);font-size:11px">–</span>'}
      </td>
    </tr>`;
  }).join("");
}

// ── Helpers ───────────────────────────────────────────────────
function _previewTasa(inputId, previewId) {
  const pct    = parseFloat(document.getElementById(inputId)?.value) || 0;
  const el     = document.getElementById(previewId);
  if (!el) return;
  if (pct <= 0) { el.innerHTML = ""; return; }
  const tasaSem    = pct / 100;
  const tasaDiaria = tasaSem / 7;
  const tasaMes    = tasaSem * 4.333333;
  el.innerHTML = `→ <strong>${pct.toFixed(2)}%</strong> / sem &nbsp;·&nbsp; `
    + `diaria: <strong>${fmtDiaria(tasaDiaria)}</strong> &nbsp;·&nbsp; `
    + `~${(tasaMes*100).toFixed(4)}% / mes`;
}

function _set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
