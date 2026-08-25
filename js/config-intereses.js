// ══════════════════════════════════════════════════════════════
// config-intereses.js — Panel SUPER_ADMIN para tasas de interés
//
// Dos niveles de configuración:
//   1. Tasa global por defecto → config_intereses/default
//   2. Override por nota individual → remisiones_credito/{id}.tasaDiaria
//      (con historial de cambios embebido en cada nota)
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

const fmt2  = n => Number(n).toFixed(6);
// n es la tasa en decimal (ej. 0.01 = 1%)
const fmtPct    = n => (Number(n) * 100).toFixed(4) + "%";
const fmtPctSem = n => (Number(n) * 100).toFixed(4) + "% / sem";
// Mostrar tasa diaria como decimal puro (0.001428...) con 6 decimales
const fmtDiaria = n => Number(n).toFixed(6);
const fmtFecha  = iso => {
  const d = new Date(iso);
  return d.toLocaleDateString("es-MX", { day:"numeric", month:"short", year:"numeric",
    hour:"2-digit", minute:"2-digit" });
};

// ── Guardia de acceso ─────────────────────────────────────────
function _esSuperAdmin() { return Sesion.esSuperAdmin?.() === true; }

export const ConfigInteresesModule = {
  mount(container) {
    if (!_esSuperAdmin()) {
      container.innerHTML = `<div style="padding:40px;text-align:center;color:#9CA3AF">
        🔒 Solo el SUPER_ADMIN puede acceder a esta configuración.</div>`;
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

let _unsubNotas = null;
let _notasCache = [];

// ── HTML ──────────────────────────────────────────────────────
function _html() {
  return `
  <div style="display:flex;flex-direction:column;gap:0;height:100%;overflow:auto;padding:20px">

    <!-- ── Sección 1: Tasa global ── -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;
      padding:22px 24px;margin-bottom:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          <div style="font-size:13px;font-weight:800;color:var(--text-primary);margin-bottom:3px">
            📊 Tasa de interés global (por defecto)
          </div>
          <div style="font-size:11px;color:#9CA3AF">
            Aplica a todas las notas nuevas. Las notas existentes ya tienen su tasa congelada.
          </div>
        </div>
        <button id="ci-btn-editar-global"
          onclick="ConfigInteresesUI.abrirEditarGlobal()"
          style="padding:7px 16px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;
            background:#1B3A5C;border:1px solid #2563EB;color:#60A5FA">
          ✏️ Editar
        </button>
      </div>

      <!-- Valores actuales -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px" id="ci-kpis-global">
        ${_kpiEl("ci-k-tasa-sem",  "TASA SEMANAL",    "–")}
        ${_kpiEl("ci-k-tasa-dia",  "TASA DIARIA",     "–")}
        ${_kpiEl("ci-k-gracia",    "DÍAS DE GRACIA",  "–")}
      </div>

      <!-- Historial global -->
      <div style="font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;
        letter-spacing:.06em;margin-bottom:8px">Historial de cambios</div>
      <div id="ci-historial-global" style="font-size:11.5px;color:var(--text-primary)">
        <span style="color:#9CA3AF">Cargando…</span>
      </div>
    </div>

    <!-- ── Sección 2: Override por nota ── -->
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;
      padding:22px 24px">
      <div style="margin-bottom:14px">
        <div style="font-size:13px;font-weight:800;color:var(--text-primary);margin-bottom:3px">
          📝 Tasa diferenciada por nota
        </div>
        <div style="font-size:11px;color:#9CA3AF">
          Un cliente puede tener múltiples notas; aquí puedes asignar una tasa distinta
          a notas específicas (sin afectar las demás).
        </div>
      </div>

      <!-- Buscador -->
      <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">
        <div style="position:relative;flex:0 0 260px">
          <select id="ci-filtro-cliente"
            onchange="ConfigInteresesUI.filtrarNotas()"
            style="width:100%;padding:8px 30px 8px 12px;border-radius:7px;border:1px solid var(--border);
              background:var(--surface);color:var(--text-primary);font-size:12px;appearance:none;cursor:pointer">
            <option value="">Todos los clientes</option>
          </select>
          <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);
            pointer-events:none;color:#9CA3AF;font-size:10px">▼</span>
        </div>
        <input id="ci-buscar-nota" type="text" placeholder="Buscar por folio…"
          oninput="ConfigInteresesUI.filtrarNotas()"
          style="flex:1;min-width:140px;padding:8px 12px;border-radius:7px;border:1px solid var(--border);
            background:var(--surface);color:var(--text-primary);font-size:12px">
        <label style="display:flex;align-items:center;gap:6px;font-size:11.5px;color:#9CA3AF;
          white-space:nowrap;cursor:pointer;align-self:center">
          <input type="checkbox" id="ci-solo-override" onchange="ConfigInteresesUI.filtrarNotas()">
          Solo con override
        </label>
      </div>

      <!-- Tabla de notas -->
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:11.5px">
          <thead>
            <tr style="border-bottom:1px solid var(--border)">
              <th style="${_th()}">FOLIO</th>
              <th style="${_th()}">CLIENTE</th>
              <th style="${_th('right')}">MONTO ORIG.</th>
              <th style="${_th('right')}">TASA SEMANAL</th>
              <th style="${_th('right')}">TASA DIARIA</th>
              <th style="${_th('center')}">STATUS</th>
              <th style="${_th('center')}">OVERRIDE</th>
              <th style="${_th('center')}">ACCIÓN</th>
            </tr>
          </thead>
          <tbody id="ci-tbody-notas">
            <tr><td colspan="8" style="padding:24px;text-align:center;color:#9CA3AF">Cargando notas…</td></tr>
          </tbody>
        </table>
      </div>
    </div>

  </div>

  <!-- Modal: editar tasa global -->
  <div id="ci-modal-global" class="modal-overlay hidden">
    <div class="modal" style="max-width:420px">
      <div class="modal-title">Editar tasa global</div>
      <div style="background:var(--surface-2);border-radius:8px;
        padding:12px 14px;margin-bottom:16px;font-size:11.5px;color:#F59E0B;
        border:1px solid #92400E">
        ⚠️ Cambiar esta tasa solo afecta a las <b>notas nuevas</b>. Las notas ya creadas
        tienen su tasa congelada al momento de la emisión.
      </div>
      <div class="form-group">
        <label class="form-label">Tasa semanal (%) *</label>
        <div style="display:flex;align-items:center;gap:0">
          <input id="ci-g-tasa" type="number" class="form-input" step="0.01" min="0" max="100"
            placeholder="1.00"
            style="border-radius:8px 0 0 8px;border-right:none;flex:1">
          <span style="padding:8px 12px;background:var(--surface);border:1px solid var(--border);
            border-radius:0 8px 8px 0;font-size:13px;color:var(--text-sec);white-space:nowrap">%</span>
        </div>
        <div id="ci-g-tasa-preview" style="font-size:11px;color:#9CA3AF;margin-top:5px"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Días de gracia (sin interés desde creación)</label>
        <input id="ci-g-gracia" type="number" class="form-input" step="1" min="0" max="90"
          placeholder="14">
      </div>
      <div class="form-group">
        <label class="form-label">Motivo del cambio *</label>
        <textarea id="ci-g-motivo" class="form-input" rows="2"
          placeholder="Ej: Ajuste por acuerdo con dirección Q3 2026…"
          style="resize:vertical"></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" onclick="ConfigInteresesUI.cerrarGlobal()">Cancelar</button>
        <button class="btn-primary" style="width:auto;padding:8px 20px"
          onclick="ConfigInteresesUI.guardarGlobal()">Guardar cambio</button>
      </div>
    </div>
  </div>

  <!-- Modal: override por nota -->
  <div id="ci-modal-nota" class="modal-overlay hidden">
    <div class="modal" style="max-width:440px">
      <div class="modal-title">Tasa diferenciada para nota</div>
      <div id="ci-nota-info" style="background:var(--surface-2);
        border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:12px;
        line-height:1.7;border:1px solid var(--border)">
      </div>
      <div class="form-group">
        <label class="form-label">Nueva tasa semanal para esta nota (%)*</label>
        <div style="display:flex;align-items:center;gap:0">
          <input id="ci-n-tasa" type="number" class="form-input" step="0.01" min="0" max="100"
            placeholder="1.00"
            style="border-radius:8px 0 0 8px;border-right:none;flex:1">
          <span style="padding:8px 12px;background:var(--surface);border:1px solid var(--border);
            border-radius:0 8px 8px 0;font-size:13px;color:var(--text-sec);white-space:nowrap">%</span>
        </div>
        <div id="ci-n-tasa-preview" style="font-size:11px;color:#9CA3AF;margin-top:5px"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Motivo del cambio *</label>
        <textarea id="ci-n-motivo" class="form-input" rows="2"
          placeholder="Ej: Acuerdo especial con cliente por volumen…"
          style="resize:vertical"></textarea>
      </div>
      <div style="font-size:10.5px;color:#F59E0B;margin-bottom:14px;padding:8px 10px;
        background:rgba(245,158,11,.08);border-radius:6px;border:1px solid rgba(245,158,11,.2)">
        ⚠️ El nuevo interés se calculará con esta tasa desde el día 1 (retroactivo según las
        reglas del negocio). El cambio queda registrado en el historial de la nota.
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" onclick="ConfigInteresesUI.cerrarNota()">Cancelar</button>
        <button class="btn-danger"    onclick="ConfigInteresesUI.quitarOverride()"
          id="ci-n-btn-quitar" style="display:none">Restaurar tasa global</button>
        <button class="btn-primary"   style="width:auto;padding:8px 20px"
          onclick="ConfigInteresesUI.guardarNota()">Aplicar tasa</button>
      </div>
    </div>
  </div>`;
}

const _th = (align = "left") =>
  `padding:9px 14px;text-align:${align};font-weight:700;color:#9CA3AF;font-size:10px;
   text-transform:uppercase;letter-spacing:.06em;white-space:nowrap`;

function _kpiEl(id, label, val) {
  return `
  <div style="background:var(--surface-2);border:1px solid var(--border);
    border-radius:8px;padding:12px 14px">
    <div style="font-size:9.5px;color:#9CA3AF;font-weight:700;text-transform:uppercase;
      letter-spacing:.06em;margin-bottom:5px">${label}</div>
    <div style="font-size:15px;font-weight:800;color:var(--text-primary);font-variant-numeric:tabular-nums"
      id="${id}">${val}</div>
  </div>`;
}

// ── Bind UI ───────────────────────────────────────────────────
let _notaTarget = null;
let _configGlobal = null;

function _bindUI() {
  window.ConfigInteresesUI = {
    // ── Global ──
    abrirEditarGlobal() {
      const g = _configGlobal;
      // Mostrar en % (ej: 0.01 → "1")
      document.getElementById("ci-g-tasa").value   = ((g?.tasaSemanal ?? TASA_SEMANAL_DEFAULT) * 100).toFixed(2);
      document.getElementById("ci-g-gracia").value = g?.diasGracia  ?? DIAS_GRACIA_DEFAULT;
      document.getElementById("ci-g-motivo").value = "";
      _previewTasa("ci-g-tasa", "ci-g-tasa-preview");
      document.getElementById("ci-modal-global").classList.remove("hidden");
      document.getElementById("ci-g-tasa").oninput = () =>
        _previewTasa("ci-g-tasa", "ci-g-tasa-preview");
    },
    cerrarGlobal() {
      document.getElementById("ci-modal-global").classList.add("hidden");
    },
    async guardarGlobal() {
      // Input en %; convertir a decimal para Firestore
      const pct = parseFloat(document.getElementById("ci-g-tasa").value);
      const tasaSemanal = pct / 100;
      const diasGracia  = parseInt(document.getElementById("ci-g-gracia").value, 10);
      const motivo      = document.getElementById("ci-g-motivo").value.trim();
      if (!pct || pct <= 0 || pct > 100)
        { window.toast?.("Tasa inválida (0 < tasa ≤ 100%).", "error"); return; }
      if (!motivo) { window.toast?.("Escribe el motivo del cambio.", "error"); return; }

      const entrada = {
        fecha:           new Date().toISOString(),
        tasaAnterior:    _configGlobal?.tasaSemanal ?? TASA_SEMANAL_DEFAULT,
        tasaNueva:       tasaSemanal,
        diasGraciaAnterior: _configGlobal?.diasGracia ?? DIAS_GRACIA_DEFAULT,
        diasGraciaNueva: isNaN(diasGracia) ? (_configGlobal?.diasGracia ?? DIAS_GRACIA_DEFAULT) : diasGracia,
        modificadoPor:   Sesion.alias,
        motivo,
      };
      try {
        await setDoc(doc(db, "config_intereses", "default"), {
          tasaSemanal,
          diasGracia:   entrada.diasGraciaNueva,
          historial:    arrayUnion(entrada),
          actualizadoEn: serverTimestamp(),
          actualizadoPor: Sesion.alias,
        }, { merge: true });
        window.toast?.("✅ Tasa global actualizada.", "success");
        this.cerrarGlobal();
        _cargarGlobal(); // refresca KPIs e historial
      } catch(e) {
        window.toast?.("Error: " + e.message, "error");
      }
    },

    // ── Por nota ──
    abrirNota(id) {
      _notaTarget = _notasCache.find(r => r.id === id);
      if (!_notaTarget) return;
      const tasaActual = _notaTarget.tasaDiaria
        ? _notaTarget.tasaDiaria * 7
        : (_configGlobal?.tasaSemanal ?? TASA_SEMANAL_DEFAULT);
      const tieneOverride = !!_notaTarget.tasaDiaria;

      document.getElementById("ci-nota-info").innerHTML = `
        <b>${esc(_notaTarget.folio || _notaTarget.id)}</b> · ${esc(_notaTarget.clienteNombre || "–")}<br>
        Monto original: <b>$${(_notaTarget.montoOriginal ?? 0).toLocaleString("es-MX",
          {minimumFractionDigits:2})}</b><br>
        Tasa actual: <b>${fmtPctSem(tasaActual)}</b>
        ${tieneOverride ? ' <span style="color:#F59E0B;font-size:10px">(override activo)</span>' : ""}`;

      // Mostrar en % (ej: 0.01 → "1.00")
      document.getElementById("ci-n-tasa").value   = (tasaActual * 100).toFixed(2);
      document.getElementById("ci-n-motivo").value = "";
      document.getElementById("ci-n-btn-quitar").style.display = tieneOverride ? "" : "none";
      _previewTasa("ci-n-tasa", "ci-n-tasa-preview");
      document.getElementById("ci-modal-nota").classList.remove("hidden");
      document.getElementById("ci-n-tasa").oninput = () =>
        _previewTasa("ci-n-tasa", "ci-n-tasa-preview");
    },
    cerrarNota() {
      document.getElementById("ci-modal-nota").classList.add("hidden");
      _notaTarget = null;
    },
    async guardarNota() {
      if (!_notaTarget) return;
      const pct = parseFloat(document.getElementById("ci-n-tasa").value);
      const tasaSemanal = pct / 100;
      const motivo      = document.getElementById("ci-n-motivo").value.trim();
      if (!pct || pct <= 0 || pct > 100)
        { window.toast?.("Tasa inválida (0 < tasa ≤ 100%).", "error"); return; }
      if (!motivo) { window.toast?.("Escribe el motivo del cambio.", "error"); return; }

      const tasaDiariaAnterior = _notaTarget.tasaDiaria
        ?? ((_configGlobal?.tasaSemanal ?? TASA_SEMANAL_DEFAULT) / 7);
      const tasaDiariaNueva = tasaSemanal / 7;

      const entrada = {
        fecha:             new Date().toISOString(),
        tasaDiariaAnterior,
        tasaDiariaNueva,
        tasaSemanalAnterior: tasaDiariaAnterior * 7,
        tasaSemanalNueva:    tasaSemanal,
        modificadoPor:     Sesion.alias,
        motivo,
      };

      try {
        await updateDoc(doc(db, "remisiones_credito", _notaTarget.id), {
          tasaDiaria:    tasaDiariaNueva,
          tasaHistorial: arrayUnion(entrada),
          tasaModificadaEn: serverTimestamp(),
          tasaModificadaPor: Sesion.alias,
        });
        window.toast?.(`✅ Tasa de ${esc(_notaTarget.folio || _notaTarget.id)} actualizada.`, "success");
        this.cerrarNota();
      } catch(e) {
        window.toast?.("Error: " + e.message, "error");
      }
    },
    async quitarOverride() {
      if (!_notaTarget || !_notaTarget.tasaDiaria) return;
      const motivo = document.getElementById("ci-n-motivo").value.trim() ||
        "Restauración a tasa global";

      const entrada = {
        fecha:             new Date().toISOString(),
        tasaDiariaAnterior: _notaTarget.tasaDiaria,
        tasaDiariaNueva:    null,
        modificadoPor:     Sesion.alias,
        motivo: motivo + " [restaurado a tasa global]",
      };

      try {
        await updateDoc(doc(db, "remisiones_credito", _notaTarget.id), {
          tasaDiaria:    null,
          tasaHistorial: arrayUnion(entrada),
          tasaModificadaEn: serverTimestamp(),
          tasaModificadaPor: Sesion.alias,
        });
        window.toast?.("Tasa restaurada a global.", "success");
        this.cerrarNota();
      } catch(e) {
        window.toast?.("Error: " + e.message, "error");
      }
    },

    filtrarNotas() {
      const q = norm(document.getElementById("ci-buscar-nota")?.value ?? "");
      const clienteSel = document.getElementById("ci-filtro-cliente")?.value ?? "";
      const soloOverride = document.getElementById("ci-solo-override")?.checked;
      _renderNotas(
        _notasCache.filter(r => {
          const matchQ  = !q || norm(r.folio || "").includes(q);
          const matchCli = !clienteSel || (r.clienteNombre || "") === clienteSel;
          const ov = !soloOverride || !!r.tasaDiaria;
          return matchQ && matchCli && ov;
        })
      );
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

  // Historial
  const hist = [...(data.historial ?? [])].reverse(); // más reciente primero
  const el = document.getElementById("ci-historial-global");
  if (!el) return;
  if (!hist.length) {
    el.innerHTML = `<span style="color:#9CA3AF">Sin cambios registrados. Tasa inicial: ${fmtPctSem(TASA_SEMANAL_DEFAULT)}.</span>`;
    return;
  }
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:6px">
      ${hist.map(h => `
        <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 14px;
          padding:8px 12px;border-radius:7px;background:var(--surface-2);
          border:1px solid var(--border)">
          <div style="font-size:10px;color:#9CA3AF;white-space:nowrap;padding-top:1px">
            ${fmtFecha(h.fecha)}
          </div>
          <div>
            <span style="font-weight:700;color:var(--text-primary)">
              ${fmtPctSem(h.tasaAnterior)} → ${fmtPctSem(h.tasaNueva)}
            </span>
            ${h.diasGraciaAnterior !== h.diasGraciaNueva
              ? `&nbsp;· gracia ${h.diasGraciaAnterior}→${h.diasGraciaNueva} días` : ""}
            <br>
            <span style="font-size:10.5px;color:#9CA3AF">
              Por <b style="color:var(--text-primary)">${esc(h.modificadoPor)}</b> · ${esc(h.motivo)}
            </span>
          </div>
        </div>`).join("")}
    </div>`;
}

function _poblarDropdownClientes() {
  const sel = document.getElementById("ci-filtro-cliente");
  if (!sel) return;
  const actual = sel.value;
  const clientes = [...new Map(_notasCache
    .filter(r => r.clienteNombre)
    .map(r => [r.clienteNombre, r.clienteNombre])
  ).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  sel.innerHTML = `<option value="">Todos los clientes (${_notasCache.length})</option>` +
    clientes.map(([n]) => `<option value="${esc(n)}" ${n === actual ? "selected" : ""}>${esc(n)}</option>`).join("");
}

// ── Notas (listener en tiempo real) ──────────────────────────
function _escucharNotas() {
  const q = query(
    collection(db, "remisiones_credito"),
    orderBy("fechaCreacion", "desc"),
    limit(500)
  );
  _unsubNotas = onSnapshot(q, snap => {
    _notasCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _poblarDropdownClientes();
    window.ConfigInteresesUI?.filtrarNotas?.();
  }, err => {
    console.error("[ConfigIntereses]", err);
  });
}

function _renderNotas(lista) {
  const tbody = document.getElementById("ci-tbody-notas");
  if (!tbody) return;
  const tasaGlobal = _configGlobal?.tasaSemanal ?? TASA_SEMANAL_DEFAULT;

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:24px;text-align:center;color:#9CA3AF">
      Sin notas encontradas.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(r => {
    const tieneOverride = r.tasaDiaria != null;
    const tasaSem       = tieneOverride ? r.tasaDiaria * 7 : tasaGlobal;
    const esPagado      = r.status === "PAGADO";

    return `<tr style="border-bottom:1px solid var(--border);${esPagado ? "opacity:.5" : ""}">
      <td style="padding:8px 14px;font-family:monospace;font-weight:700;white-space:nowrap">
        ${esc(r.folio || r.id)}</td>
      <td style="padding:8px 14px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${esc(r.clienteNombre || "–")}</td>
      <td style="padding:8px 14px;text-align:right;font-variant-numeric:tabular-nums">
        $${(r.montoOriginal ?? 0).toLocaleString("es-MX",{minimumFractionDigits:2})}</td>
      <td style="padding:8px 14px;text-align:right;font-variant-numeric:tabular-nums;
        font-weight:${tieneOverride ? "700" : "400"};
        color:${tieneOverride ? "#F59E0B" : "var(--text-primary)"}">
        ${fmtPctSem(tasaSem)}</td>
      <td style="padding:8px 14px;text-align:right;font-variant-numeric:tabular-nums;color:#9CA3AF">
        ${fmtPct(tasaSem / 7)}/día</td>
      <td style="padding:8px 14px;text-align:center">
        <span style="font-size:9px;font-weight:800;padding:2px 7px;border-radius:6px;
          background:${esPagado ? "#16A34A22" : "#1E3A5F"};
          color:${esPagado ? "#22C55E" : "#60A5FA"}">
          ${r.status ?? "ACTIVA"}
        </span>
      </td>
      <td style="padding:8px 14px;text-align:center">
        ${tieneOverride
          ? `<span style="font-size:9px;font-weight:800;padding:2px 7px;border-radius:6px;
              background:#92400E22;color:#F59E0B">OVERRIDE</span>`
          : `<span style="color:#9CA3AF;font-size:10px">–</span>`}
      </td>
      <td style="padding:8px 14px;text-align:center">
        ${!esPagado
          ? `<button onclick="ConfigInteresesUI.abrirNota('${r.id}')"
              style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:5px;cursor:pointer;
                background:transparent;border:1px solid var(--border);color:#9CA3AF">
              ${tieneOverride ? "Editar tasa" : "Asignar tasa"}
            </button>`
          : "–"}
      </td>
    </tr>`;
  }).join("");
}

// ── Helpers ───────────────────────────────────────────────────
function _previewTasa(inputId, previewId) {
  // inputId contiene el valor en % (ej: 1 = 1%)
  const pct = parseFloat(document.getElementById(inputId)?.value) || 0;
  const el  = document.getElementById(previewId);
  if (!el) return;
  if (pct <= 0) { el.textContent = ""; return; }
  const tasaSem    = pct / 100;            // decimal semanal
  const tasaDiaria = tasaSem / 7;          // decimal diaria = %/100/7
  const tasaMes    = tasaSem * 4.333333;   // aprox mensual decimal
  el.innerHTML =
    `→ <b>${pct.toFixed(2)}%</b> / sem &nbsp;·&nbsp; ` +
    `tasa diaria: <b>${fmtDiaria(tasaDiaria)}</b> &nbsp;·&nbsp; ` +
    `~${(tasaMes * 100).toFixed(4)}% / mes`;
}

function _set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
