/**
 * agroquimico.js — Módulo Agroquímico
 *
 * Tabs:
 *   calendario   — Alto/74  Calendario agrícola por cultivo/región con ventanas de aplicación óptima
 *   recetas      — Alto/77  Gestor de recetas de dosis y mezcla de productos
 *   trazabilidad — Medio/68 Trazabilidad campo → cultivo → venta
 */

import { db } from "./firebase-config.js";
import { esc } from "./app.js";
import {
  collection, query, where, orderBy, limit, getDocs, addDoc,
  doc, setDoc, getDoc, updateDoc, deleteDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { Sesion } from "./auth.js";

// ── Helpers ──────────────────────────────────────────────────
const el   = id => document.getElementById(id);
const fmt  = ts => ts ? new Date(ts).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"}) : "—";
const fmtMes = (y,m) => new Date(y,m-1,1).toLocaleDateString("es-MX",{month:"long",year:"numeric"});

const CULTIVOS = ["Maíz","Jitomate","Chile","Papa","Cebolla","Sorgo","Trigo","Frijol","Aguacate","Cítricos","Mango","Caña","Alfalfa","Otro"];
const ETAPAS   = ["Germinación","Plántula","Vegetativo","Floración","Fructificación","Maduración","Cosecha","Post-cosecha"];
const MESES    = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// ── Estado del módulo ─────────────────────────────────────────
let _container = null;
let _tab       = "calendario";
let _unsubs    = [];

const TABS = [
  { id:"calendario",   label:"🌱 Calendario agrícola" },
  { id:"recetas",      label:"🧪 Recetas / Dosis"     },
  { id:"trazabilidad", label:"🔗 Trazabilidad"         },
];

// ── Mount / Destroy ───────────────────────────────────────────
export const AgroquimicoModule = { mount, destroy };

function mount(container) {
  _container = container;
  _container.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;min-height:0;padding:20px 24px;gap:0">

      <!-- Header -->
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px;flex-wrap:wrap">
        <span style="font-size:28px">🌿</span>
        <div>
          <h2 style="margin:0;font-size:17px;font-weight:900;letter-spacing:-.3px">Agroquímico</h2>
          <div style="font-size:11px;color:#64748B">Calendario agrícola · Recetas de aplicación · Trazabilidad</div>
        </div>
      </div>

      <!-- Tabs -->
      <div style="display:flex;gap:6px;border-bottom:1px solid var(--border);padding-bottom:0;margin-bottom:20px;overflow-x:auto;flex-shrink:0">
        ${TABS.map(t => `
          <button id="tab-btn-${t.id}" data-tab="${t.id}"
            style="padding:9px 16px;border:none;border-bottom:2px solid transparent;
              background:transparent;cursor:pointer;font-size:12px;font-weight:600;
              color:#64748B;white-space:nowrap;transition:color .15s,border-color .15s">
            ${t.label}
          </button>`).join("")}
      </div>

      <!-- Contenido de cada tab -->
      ${TABS.map(t => `<div id="tab-${t.id}" style="display:none;flex:1;min-height:0;overflow-y:auto"></div>`).join("")}
    </div>`;

  // Bind tabs
  TABS.forEach(t => {
    el(`tab-btn-${t.id}`)?.addEventListener("click", () => _activarTab(t.id));
  });
  _activarTab("calendario");
}

function destroy() {
  _unsubs.forEach(u => u?.());
  _unsubs = [];
  if (_container) _container.innerHTML = "";
  _container = null;
}

function _activarTab(tab) {
  _tab = tab;
  _unsubs.forEach(u => u?.()); _unsubs = [];

  TABS.forEach(t => {
    const btn = el(`tab-btn-${t.id}`);
    const div = el(`tab-${t.id}`);
    const activo = t.id === tab;
    if (btn) {
      btn.style.color       = activo ? "#6366F1" : "#64748B";
      btn.style.borderColor = activo ? "#6366F1" : "transparent";
      btn.style.fontWeight  = activo ? "800" : "600";
    }
    if (div) div.style.display = activo ? "block" : "none";
  });

  if (tab === "calendario")   _montarCalendario();
  if (tab === "recetas")      _montarRecetas();
  if (tab === "trazabilidad") _montarTrazabilidad();
}

// ══════════════════════════════════════════════════════════════
// ALTO/74 — CALENDARIO AGRÍCOLA POR CULTIVO
// Colección: calendario_agricola
// Cada doc: { cultivo, region, etapa, mesInicio, mesFin, notas, _ts }
// ══════════════════════════════════════════════════════════════
function _montarCalendario() {
  const wrap = el("tab-calendario");
  if (!wrap) return;

  const mesActual = new Date().getMonth(); // 0-based

  wrap.innerHTML = `
    <!-- Barra de herramientas -->
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
      <h3 style="margin:0;font-size:15px;font-weight:800;flex:1">🌱 Calendario agrícola por cultivo</h3>
      <select class="sel-sm" id="cal-filtro-cultivo">
        <option value="">Todos los cultivos</option>
        ${CULTIVOS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
      </select>
      <button class="btn-primary" id="cal-nuevo-btn">+ Nueva ventana</button>
    </div>

    <!-- Leyenda de etapas -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
      ${_etapasColores().map(e =>
        `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;
          border-radius:20px;font-size:10px;font-weight:700;
          background:${e.bg};color:${e.col}">${esc(e.label)}</span>`).join("")}
    </div>

    <!-- Grid del año (12 meses) -->
    <div style="overflow-x:auto;margin-bottom:20px">
      <div id="cal-grid" style="min-width:700px"></div>
    </div>

    <!-- Lista editable -->
    <div style="font-size:13px;font-weight:700;margin-bottom:10px">Ventanas registradas</div>
    <div style="overflow-x:auto">
      <table class="data-table">
        <thead><tr>
          <th>CULTIVO</th><th>REGIÓN</th><th>ETAPA</th>
          <th>MESES</th><th>NOTAS</th><th style="width:80px"></th>
        </tr></thead>
        <tbody id="cal-body">
          <tr><td colspan="6" style="padding:24px;text-align:center;color:var(--text-sec)">Cargando…</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Modal nueva ventana -->
    <div class="modal-overlay hidden" id="cal-modal">
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;
        width:100%;max-width:480px;box-shadow:0 24px 64px rgba(0,0,0,.5)">
        <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
          <span style="font-size:20px">🌱</span>
          <div style="flex:1;font-size:13px;font-weight:800" id="cal-modal-title">Nueva ventana de aplicación</div>
          <button id="cal-modal-close" style="background:none;border:none;cursor:pointer;font-size:18px;color:#64748B">✕</button>
        </div>
        <div style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">CULTIVO *</label>
              <select class="form-input" id="cal-f-cultivo" style="width:100%">
                <option value="">— Seleccionar —</option>
                ${CULTIVOS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
              </select>
            </div>
            <div>
              <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">REGIÓN</label>
              <input class="form-input" id="cal-f-region" type="text" placeholder="Ej. Morelos, Puebla" style="width:100%">
            </div>
          </div>
          <div>
            <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">ETAPA FENOLÓGICA *</label>
            <select class="form-input" id="cal-f-etapa" style="width:100%">
              <option value="">— Seleccionar —</option>
              ${ETAPAS.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join("")}
            </select>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">MES INICIO *</label>
              <select class="form-input" id="cal-f-desde" style="width:100%">
                ${MESES.map((m,i) => `<option value="${i+1}">${m}</option>`).join("")}
              </select>
            </div>
            <div>
              <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">MES FIN *</label>
              <select class="form-input" id="cal-f-hasta" style="width:100%">
                ${MESES.map((m,i) => `<option value="${i+1}">${m}</option>`).join("")}
              </select>
            </div>
          </div>
          <div>
            <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">NOTAS / ALERTAS</label>
            <input class="form-input" id="cal-f-notas" type="text" placeholder="Ej. Aplicar antes de floración" style="width:100%">
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid var(--border)">
          <button id="cal-cancel" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border);
            background:transparent;color:#94A3B8;font-size:12px;cursor:pointer">Cancelar</button>
          <button id="cal-guardar" style="padding:8px 22px;border-radius:8px;border:none;
            background:#16A34A;color:#fff;font-size:12px;font-weight:700;cursor:pointer">Guardar</button>
        </div>
      </div>
    </div>`;

  // ── Cargar datos ──
  let _editId = null;
  let _datos = [];

  const cerrar = () => {
    el("cal-modal")?.classList.add("hidden");
    _editId = null;
    ["cal-f-cultivo","cal-f-etapa","cal-f-region","cal-f-notas"].forEach(id => { if(el(id)) el(id).value=""; });
    if (el("cal-f-desde")) el("cal-f-desde").value = "1";
    if (el("cal-f-hasta")) el("cal-f-hasta").value = "12";
    if (el("cal-modal-title")) el("cal-modal-title").textContent = "Nueva ventana de aplicación";
    if (el("cal-guardar")) el("cal-guardar").textContent = "Guardar";
  };

  el("cal-nuevo-btn")?.addEventListener("click", () => el("cal-modal")?.classList.remove("hidden"));
  el("cal-modal-close")?.addEventListener("click", cerrar);
  el("cal-cancel")?.addEventListener("click", cerrar);
  el("cal-modal")?.addEventListener("click", e => { if (e.target === el("cal-modal")) cerrar(); });

  el("cal-filtro-cultivo")?.addEventListener("change", () => _renderCalendario(_datos));

  el("cal-guardar")?.addEventListener("click", async () => {
    const cultivo  = el("cal-f-cultivo")?.value;
    const etapa    = el("cal-f-etapa")?.value;
    const region   = el("cal-f-region")?.value.trim();
    const desde    = parseInt(el("cal-f-desde")?.value || "1");
    const hasta    = parseInt(el("cal-f-hasta")?.value || "12");
    const notas    = el("cal-f-notas")?.value.trim();
    if (!cultivo || !etapa) { window.toast?.("Cultivo y etapa son requeridos","warn"); return; }
    if (desde > hasta) { window.toast?.("Mes inicio debe ser ≤ mes fin","warn"); return; }

    const btn = el("cal-guardar");
    btn.disabled = true; btn.textContent = "Guardando…";
    try {
      const datos = { cultivo, etapa, region: region||"", notas: notas||"",
        mesInicio: desde, mesFin: hasta, quienRegistro: Sesion.alias, _ts: Date.now() };
      if (_editId) {
        await setDoc(doc(db,"calendario_agricola",_editId), datos, { merge: true });
      } else {
        await addDoc(collection(db,"calendario_agricola"), datos);
      }
      window.toast?.(_editId ? "Actualizado" : "Ventana guardada","success");
      cerrar();
    } catch(e) { window.toast?.("Error: "+e.message,"error"); }
    finally { btn.disabled=false; btn.textContent="Guardar"; }
  });

  // Listener
  const q = query(collection(db,"calendario_agricola"), orderBy("_ts","desc"), limit(500));
  const unsub = onSnapshot(q, snap => {
    _datos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderCalendario(_datos);
  }, e => console.error("[Calendario]", e));
  _unsubs.push(unsub);

  function _renderCalendario(datos) {
    const filtro = el("cal-filtro-cultivo")?.value || "";
    const filtrado = filtro ? datos.filter(d => d.cultivo === filtro) : datos;
    const tbody = el("cal-body");
    const grid  = el("cal-grid");

    // ── Grid Gantt (12 meses) ──
    if (grid) {
      const cultivosUnicos = [...new Set(filtrado.map(d => d.cultivo))].sort();
      if (!cultivosUnicos.length) {
        grid.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-sec);font-size:12px">Sin registros</div>`;
      } else {
        grid.innerHTML = `
          <div style="display:grid;grid-template-columns:130px repeat(12,1fr);gap:2px;font-size:10px">
            <!-- Encabezado -->
            <div style="padding:6px;font-weight:700;color:#64748B;border-bottom:1px solid var(--border)">CULTIVO</div>
            ${MESES.map((m,i) =>
              `<div style="padding:6px 2px;text-align:center;font-weight:700;color:#64748B;border-bottom:1px solid var(--border);
                ${i === mesActual ? "background:#6366F120;border-radius:4px" : ""}">${m}</div>`).join("")}

            ${cultivosUnicos.map(cult => {
              const ventanas = filtrado.filter(d => d.cultivo === cult);
              return `
                <div style="padding:5px 6px;font-weight:700;font-size:11px;align-self:center;
                  border-right:1px solid var(--border)">${esc(cult)}</div>
                ${MESES.map((_,mi) => {
                  const v = ventanas.find(d => d.mesInicio <= mi+1 && d.mesFin >= mi+1);
                  if (!v) return `<div style="background:var(--surface-2);border-radius:3px;min-height:28px"></div>`;
                  const col = _etapaColor(v.etapa);
                  return `<div title="${esc(v.etapa)}${v.region?" · "+v.region:""}"
                    style="background:${col.bg};border-radius:3px;min-height:28px;display:flex;align-items:center;
                      justify-content:center;font-size:9px;color:${col.col};font-weight:700;cursor:default;
                      overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 2px">
                    ${v.etapa.slice(0,4)}
                  </div>`;
                }).join("")}`;
            }).join("")}
          </div>
          <div style="margin-top:6px;font-size:10px;color:#94A3B8;text-align:right">
            ▌ = mes actual
          </div>`;
      }
    }

    // ── Tabla ──
    if (!tbody) return;
    if (!filtrado.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:32px;text-align:center;color:var(--text-sec)">Sin ventanas registradas</td></tr>`;
      return;
    }
    tbody.innerHTML = filtrado.map(d => {
      const col = _etapaColor(d.etapa);
      return `<tr>
        <td style="font-weight:700">${esc(d.cultivo)}</td>
        <td style="font-size:11px;color:#64748B">${esc(d.region||"—")}</td>
        <td><span style="background:${col.bg};color:${col.col};padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700">
          ${esc(d.etapa)}</span></td>
        <td style="font-size:11px;white-space:nowrap">
          ${MESES[(d.mesInicio||1)-1]} – ${MESES[(d.mesFin||12)-1]}
        </td>
        <td style="font-size:11px;color:#64748B;max-width:180px">${esc(d.notas||"—")}</td>
        <td>
          <button data-id="${esc(d.id)}" class="cal-edit-btn"
            style="background:none;border:none;cursor:pointer;color:#6366F1;font-size:12px;padding:2px 6px">✏️</button>
          <button data-id="${esc(d.id)}" class="cal-del-btn"
            style="background:none;border:none;cursor:pointer;color:#DC2626;font-size:12px;padding:2px 6px">🗑️</button>
        </td>
      </tr>`;
    }).join("");

    tbody.querySelectorAll(".cal-edit-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const d = filtrado.find(x => x.id === btn.dataset.id);
        if (!d) return;
        _editId = d.id;
        if (el("cal-f-cultivo")) el("cal-f-cultivo").value = d.cultivo;
        if (el("cal-f-etapa"))   el("cal-f-etapa").value   = d.etapa;
        if (el("cal-f-region"))  el("cal-f-region").value  = d.region||"";
        if (el("cal-f-notas"))   el("cal-f-notas").value   = d.notas||"";
        if (el("cal-f-desde"))   el("cal-f-desde").value   = d.mesInicio||1;
        if (el("cal-f-hasta"))   el("cal-f-hasta").value   = d.mesFin||12;
        if (el("cal-modal-title")) el("cal-modal-title").textContent = "Editar ventana";
        if (el("cal-guardar"))   el("cal-guardar").textContent = "Actualizar";
        el("cal-modal")?.classList.remove("hidden");
      });
    });
    tbody.querySelectorAll(".cal-del-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("¿Eliminar esta ventana?")) return;
        try { await deleteDoc(doc(db,"calendario_agricola",btn.dataset.id)); }
        catch(e) { window.toast?.("Error: "+e.message,"error"); }
      });
    });
  }
}

function _etapaColor(etapa) {
  const mapa = {
    "Germinación":   { bg:"#DCFCE7", col:"#166534" },
    "Plántula":      { bg:"#D1FAE5", col:"#065F46" },
    "Vegetativo":    { bg:"#A7F3D0", col:"#064E3B" },
    "Floración":     { bg:"#FEF3C7", col:"#92400E" },
    "Fructificación":{ bg:"#FED7AA", col:"#9A3412" },
    "Maduración":    { bg:"#FECACA", col:"#991B1B" },
    "Cosecha":       { bg:"#E0E7FF", col:"#3730A3" },
    "Post-cosecha":  { bg:"#F3F4F6", col:"#374151" },
  };
  return mapa[etapa] ?? { bg:"#F1F5F9", col:"#475569" };
}
function _etapasColores() {
  return ETAPAS.map(e => ({ label: e, ..._etapaColor(e) }));
}

// ══════════════════════════════════════════════════════════════
// ALTO/77 — DOSIS Y MEZCLA DE PRODUCTOS (RECETAS)
// Colección: recetas_agroquimicas
// Cada receta: { nombre, cultivo, etapa, productos:[{id,nombre,dosis,unidad}],
//               litrosAgua, hectareas, notas, _ts }
// ══════════════════════════════════════════════════════════════
function _montarRecetas() {
  const wrap = el("tab-recetas");
  if (!wrap) return;

  wrap.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
      <h3 style="margin:0;font-size:15px;font-weight:800;flex:1">🧪 Recetas de dosis y mezcla</h3>
      <input class="sel-sm" type="text" id="rec-buscar" placeholder="🔍 Buscar receta…" style="width:200px">
      <select class="sel-sm" id="rec-filtro-cultivo">
        <option value="">Todos los cultivos</option>
        ${CULTIVOS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
      </select>
      <button class="btn-primary" id="rec-nuevo-btn">+ Nueva receta</button>
    </div>

    <!-- Cards de recetas -->
    <div id="rec-cards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px"></div>

    <!-- Panel lateral / Modal de detalle+edición -->
    <div class="modal-overlay hidden" id="rec-modal">
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;
        width:100%;max-width:580px;box-shadow:0 24px 64px rgba(0,0,0,.5);
        display:flex;flex-direction:column;max-height:90vh">
        <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-shrink:0">
          <span style="font-size:20px">🧪</span>
          <div style="flex:1;font-size:13px;font-weight:800" id="rec-modal-title">Nueva receta</div>
          <button id="rec-modal-close" style="background:none;border:none;cursor:pointer;font-size:18px;color:#64748B">✕</button>
        </div>
        <div style="padding:18px 20px;overflow-y:auto;display:flex;flex-direction:column;gap:12px">

          <div>
            <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">NOMBRE DE LA RECETA *</label>
            <input class="form-input" id="rec-f-nombre" type="text" placeholder="Ej. Arranque jitomate etapa vegetativa" style="width:100%">
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">CULTIVO *</label>
              <select class="form-input" id="rec-f-cultivo" style="width:100%">
                <option value="">— Seleccionar —</option>
                ${CULTIVOS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
              </select>
            </div>
            <div>
              <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">ETAPA *</label>
              <select class="form-input" id="rec-f-etapa" style="width:100%">
                <option value="">— Seleccionar —</option>
                ${ETAPAS.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join("")}
              </select>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">LITROS DE AGUA / HA</label>
              <input class="form-input" id="rec-f-agua" type="number" min="0" placeholder="Ej. 200" style="width:100%">
            </div>
            <div>
              <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">HECTÁREAS REFERENCIA</label>
              <input class="form-input" id="rec-f-ha" type="number" min="0" step="0.1" placeholder="Ej. 1" style="width:100%">
            </div>
          </div>

          <!-- Lista de productos en la mezcla -->
          <div>
            <div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;margin-bottom:8px">
              Productos en la mezcla
            </div>
            <div id="rec-prod-rows" style="display:flex;flex-direction:column;gap:6px"></div>
            <button id="rec-add-prod" type="button"
              style="margin-top:8px;padding:6px 14px;border:1px dashed var(--border);border-radius:7px;
                background:transparent;color:#64748B;font-size:11px;cursor:pointer;width:100%">
              + Agregar producto
            </button>
          </div>

          <div>
            <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">NOTAS / ADVERTENCIAS</label>
            <textarea class="form-input" id="rec-f-notas" rows="2"
              placeholder="Ej. No mezclar con productos alcalinos. Aplicar en horas frescas."
              style="width:100%;resize:vertical"></textarea>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid var(--border);flex-shrink:0">
          <button id="rec-cancel" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border);
            background:transparent;color:#94A3B8;font-size:12px;cursor:pointer">Cancelar</button>
          <button id="rec-guardar" style="padding:8px 22px;border-radius:8px;border:none;
            background:#6366F1;color:#fff;font-size:12px;font-weight:700;cursor:pointer">Guardar receta</button>
        </div>
      </div>
    </div>`;

  // Catálogo inventario para buscador
  let _catalogo = [];
  let _editId = null;
  let _datos = [];
  let _recProdCount = 0;

  async function _cargarCatalogo() {
    if (_catalogo.length) return;
    const snap = await getDocs(query(collection(db,"inventario"), orderBy("nombre"), limit(600)));
    _catalogo = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  const cerrar = () => {
    el("rec-modal")?.classList.add("hidden");
    _editId = null;
    if (el("rec-f-nombre")) el("rec-f-nombre").value = "";
    if (el("rec-f-cultivo")) el("rec-f-cultivo").value = "";
    if (el("rec-f-etapa")) el("rec-f-etapa").value = "";
    if (el("rec-f-agua")) el("rec-f-agua").value = "";
    if (el("rec-f-ha")) el("rec-f-ha").value = "";
    if (el("rec-f-notas")) el("rec-f-notas").value = "";
    if (el("rec-prod-rows")) el("rec-prod-rows").innerHTML = "";
    if (el("rec-modal-title")) el("rec-modal-title").textContent = "Nueva receta";
    if (el("rec-guardar")) el("rec-guardar").textContent = "Guardar receta";
    _recProdCount = 0;
  };

  el("rec-nuevo-btn")?.addEventListener("click", () => {
    cerrar();
    el("rec-modal")?.classList.remove("hidden");
    _agregarFilaProd();
  });
  el("rec-modal-close")?.addEventListener("click", cerrar);
  el("rec-cancel")?.addEventListener("click", cerrar);
  el("rec-modal")?.addEventListener("click", e => { if (e.target === el("rec-modal")) cerrar(); });

  function _agregarFilaProd(valorInicial = null) {
    const idx = _recProdCount++;
    const row = document.createElement("div");
    row.dataset.recIdx = idx;
    row.style.cssText = "display:grid;grid-template-columns:1fr 80px 80px auto;gap:6px;align-items:center";
    row.innerHTML = `
      <div style="position:relative">
        <input type="text" placeholder="Nombre del producto" data-rec-search="${idx}"
          style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;
            font-size:12px;background:var(--surface);color:var(--text-primary);box-sizing:border-box"
          value="${esc(valorInicial?.nombre||"")}">
        <div data-rec-lista="${idx}" style="display:none;position:absolute;top:calc(100%+2px);left:0;right:0;
          background:var(--surface);border:1px solid var(--border);border-radius:6px;
          max-height:130px;overflow-y:auto;z-index:999;box-shadow:0 8px 24px rgba(0,0,0,.4)"></div>
        <input type="hidden" data-rec-prod-id="${idx}" value="${esc(valorInicial?.productoId||"")}">
      </div>
      <input type="number" placeholder="Dosis" min="0" step="0.01" data-rec-dosis="${idx}"
        value="${valorInicial?.dosis||""}"
        style="padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;
          background:var(--surface);color:var(--text-primary);text-align:center">
      <select data-rec-unidad="${idx}"
        style="padding:7px 6px;border:1px solid var(--border);border-radius:6px;font-size:11px;
          background:var(--surface);color:var(--text-primary)">
        ${["L/ha","kg/ha","ml/ha","g/ha","L/100L","ml/100L","g/100L"].map(u =>
          `<option value="${u}" ${valorInicial?.unidad===u?"selected":""}>${u}</option>`).join("")}
      </select>
      <button type="button" data-rec-del="${idx}"
        style="background:none;border:none;cursor:pointer;color:#DC2626;font-size:16px;padding:2px 4px">✕</button>`;
    el("rec-prod-rows")?.appendChild(row);

    const searchInp = row.querySelector(`[data-rec-search="${idx}"]`);
    const listaEl   = row.querySelector(`[data-rec-lista="${idx}"]`);
    const prodIdInp = row.querySelector(`[data-rec-prod-id="${idx}"]`);

    searchInp?.addEventListener("focus", async () => {
      await _cargarCatalogo();
      _renderLista(listaEl, searchInp.value, prodIdInp, searchInp);
    });
    searchInp?.addEventListener("input", () => _renderLista(listaEl, searchInp.value, prodIdInp, searchInp));
    row.querySelector(`[data-rec-del="${idx}"]`)?.addEventListener("click", () => row.remove());
    document.addEventListener("click", e => {
      if (!listaEl?.contains(e.target) && e.target !== searchInp) listaEl && (listaEl.style.display="none");
    });
  }

  function _renderLista(listaEl, term, prodIdInp, searchInp) {
    if (!listaEl) return;
    const t = (term||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
    const matches = _catalogo.filter(p => !t || (p.nombre||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").includes(t)).slice(0,20);
    if (!matches.length) { listaEl.style.display="none"; return; }
    listaEl.innerHTML = matches.map((p,i) =>
      `<div data-i="${i}" style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:12px"
        onmouseenter="this.style.background='var(--surface-2)'" onmouseleave="this.style.background='transparent'">
        ${esc(p.nombre||"")}
      </div>`).join("");
    listaEl.querySelectorAll("[data-i]").forEach(el2 => {
      el2.addEventListener("click", () => {
        const p = matches[parseInt(el2.dataset.i)];
        if (prodIdInp) prodIdInp.value = p.id;
        if (searchInp) searchInp.value = p.nombre;
        listaEl.style.display = "none";
      });
    });
    listaEl.style.display = "block";
  }

  el("rec-add-prod")?.addEventListener("click", () => _agregarFilaProd());

  // Guardar
  el("rec-guardar")?.addEventListener("click", async () => {
    const nombre  = el("rec-f-nombre")?.value.trim();
    const cultivo = el("rec-f-cultivo")?.value;
    const etapa   = el("rec-f-etapa")?.value;
    const agua    = parseFloat(el("rec-f-agua")?.value||"0");
    const ha      = parseFloat(el("rec-f-ha")?.value||"1");
    const notas   = el("rec-f-notas")?.value.trim();
    if (!nombre || !cultivo || !etapa) { window.toast?.("Nombre, cultivo y etapa requeridos","warn"); return; }

    const filas = [...document.querySelectorAll("#rec-prod-rows > div")];
    const productos = filas.map(row => {
      const idx = row.dataset.recIdx;
      return {
        productoId: row.querySelector(`[data-rec-prod-id="${idx}"]`)?.value || "",
        nombre:     row.querySelector(`[data-rec-search="${idx}"]`)?.value || "",
        dosis:      parseFloat(row.querySelector(`[data-rec-dosis="${idx}"]`)?.value||"0"),
        unidad:     row.querySelector(`[data-rec-unidad="${idx}"]`)?.value || "L/ha",
      };
    }).filter(p => p.nombre && p.dosis > 0);
    if (!productos.length) { window.toast?.("Agrega al menos un producto con dosis","warn"); return; }

    const btn = el("rec-guardar");
    btn.disabled = true; btn.textContent = "Guardando…";
    try {
      const datos = { nombre, cultivo, etapa, litrosAgua: agua||0, hectareas: ha||1,
        productos, notas: notas||"", quienRegistro: Sesion.alias, _ts: Date.now() };
      if (_editId) await setDoc(doc(db,"recetas_agroquimicas",_editId), datos, { merge: true });
      else await addDoc(collection(db,"recetas_agroquimicas"), datos);
      window.toast?.(_editId ? "Receta actualizada" : "Receta guardada","success");
      cerrar();
    } catch(e) { window.toast?.("Error: "+e.message,"error"); }
    finally { btn.disabled=false; btn.textContent="Guardar receta"; }
  });

  // Filtros
  const filtrar = () => {
    const cult = el("rec-filtro-cultivo")?.value || "";
    const txt  = (el("rec-buscar")?.value || "").toLowerCase();
    const filtrado = _datos.filter(d =>
      (!cult || d.cultivo === cult) &&
      (!txt  || (d.nombre||"").toLowerCase().includes(txt) || (d.etapa||"").toLowerCase().includes(txt))
    );
    _renderCards(filtrado);
  };
  el("rec-filtro-cultivo")?.addEventListener("change", filtrar);
  el("rec-buscar")?.addEventListener("input", filtrar);

  // Listener
  const q = query(collection(db,"recetas_agroquimicas"), orderBy("_ts","desc"), limit(500));
  const unsub = onSnapshot(q, snap => {
    _datos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    filtrar();
  }, e => console.error("[Recetas]", e));
  _unsubs.push(unsub);

  function _renderCards(datos) {
    const cards = el("rec-cards");
    if (!cards) return;
    if (!datos.length) {
      cards.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-sec);font-size:12px;grid-column:1/-1">
        Sin recetas registradas. Presiona <strong>+ Nueva receta</strong> para comenzar.</div>`;
      return;
    }
    cards.innerHTML = datos.map(d => {
      const col = _etapaColor(d.etapa);
      return `
      <div style="border:1px solid var(--border);border-radius:12px;padding:16px;
        background:var(--surface);display:flex;flex-direction:column;gap:10px;
        transition:box-shadow .15s" class="rec-card-item" data-id="${esc(d.id)}">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <div style="flex:1">
            <div style="font-weight:800;font-size:13px;margin-bottom:3px">${esc(d.nombre)}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <span style="background:#E0F2FE;color:#0369A1;padding:1px 8px;border-radius:12px;font-size:10px;font-weight:700">
                ${esc(d.cultivo)}</span>
              <span style="background:${col.bg};color:${col.col};padding:1px 8px;border-radius:12px;font-size:10px;font-weight:700">
                ${esc(d.etapa)}</span>
            </div>
          </div>
          <div style="display:flex;gap:4px">
            <button data-id="${esc(d.id)}" class="rec-edit-btn"
              style="background:none;border:none;cursor:pointer;color:#6366F1;font-size:14px;padding:2px 5px">✏️</button>
            <button data-id="${esc(d.id)}" class="rec-del-btn"
              style="background:none;border:none;cursor:pointer;color:#DC2626;font-size:14px;padding:2px 5px">🗑️</button>
          </div>
        </div>

        <!-- Tabla de productos -->
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr style="color:#94A3B8;text-transform:uppercase;font-size:9px">
            <th style="text-align:left;padding:3px 0;font-weight:700">PRODUCTO</th>
            <th style="text-align:right;padding:3px 0;font-weight:700">DOSIS</th>
            <th style="text-align:right;padding:3px 0;font-weight:700">UNIDAD</th>
          </tr></thead>
          <tbody>
            ${(d.productos||[]).map(p => `<tr>
              <td style="padding:3px 0;border-top:1px solid var(--border)">${esc(p.nombre)}</td>
              <td style="text-align:right;padding:3px 0;border-top:1px solid var(--border);font-variant-numeric:tabular-nums">
                ${p.dosis}</td>
              <td style="text-align:right;padding:3px 0;border-top:1px solid var(--border);color:#64748B">${esc(p.unidad)}</td>
            </tr>`).join("")}
          </tbody>
        </table>

        ${d.litrosAgua ? `<div style="font-size:10px;color:#64748B">💧 ${d.litrosAgua} L/ha · ${d.hectareas||1} ha referencia</div>` : ""}
        ${d.notas ? `<div style="font-size:10px;color:#D97706;background:#FEF3C7;border-radius:6px;padding:5px 8px">
          ⚠️ ${esc(d.notas)}</div>` : ""}
      </div>`;
    }).join("");

    cards.querySelectorAll(".rec-edit-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const d = _datos.find(x => x.id === btn.dataset.id);
        if (!d) return;
        _editId = d.id;
        if (el("rec-f-nombre"))  el("rec-f-nombre").value  = d.nombre||"";
        if (el("rec-f-cultivo")) el("rec-f-cultivo").value = d.cultivo||"";
        if (el("rec-f-etapa"))   el("rec-f-etapa").value   = d.etapa||"";
        if (el("rec-f-agua"))    el("rec-f-agua").value    = d.litrosAgua||"";
        if (el("rec-f-ha"))      el("rec-f-ha").value      = d.hectareas||"";
        if (el("rec-f-notas"))   el("rec-f-notas").value   = d.notas||"";
        if (el("rec-prod-rows")) el("rec-prod-rows").innerHTML = "";
        _recProdCount = 0;
        (d.productos||[]).forEach(p => _agregarFilaProd(p));
        if (el("rec-modal-title")) el("rec-modal-title").textContent = "Editar receta";
        if (el("rec-guardar"))   el("rec-guardar").textContent = "Actualizar";
        el("rec-modal")?.classList.remove("hidden");
      });
    });
    cards.querySelectorAll(".rec-del-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("¿Eliminar esta receta?")) return;
        try { await deleteDoc(doc(db,"recetas_agroquimicas",btn.dataset.id)); }
        catch(e) { window.toast?.("Error: "+e.message,"error"); }
      });
    });
  }
}

// ══════════════════════════════════════════════════════════════
// MEDIO/68 — TRAZABILIDAD CAMPO → CULTIVO → VENTA
// Colección: trazabilidad_campo
// Cada doc: { ingenieroId, ingenieroAlias, clienteNombre, cultivo, parcela,
//             etapa, productosAplicados:[{id,nombre,dosis,unidad}],
//             fechaAplicacion, resultado, pedidoId, notas, _ts }
// ══════════════════════════════════════════════════════════════
function _montarTrazabilidad() {
  const wrap = el("tab-trazabilidad");
  if (!wrap) return;

  const hoy   = new Date().toISOString().slice(0,10);
  const hace30= new Date(Date.now()-30*86400000).toISOString().slice(0,10);

  let _ingenieros = [];

  wrap.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
      <h3 style="margin:0;font-size:15px;font-weight:800;flex:1">🔗 Trazabilidad campo → cultivo → venta</h3>
      <button class="btn-primary" id="trz-nuevo-btn">+ Registrar aplicación</button>
    </div>

    <!-- KPIs -->
    <div class="kpi-row" style="margin-bottom:16px">
      <div class="kpi-card" style="border-left-color:#6366F1">
        <div class="kpi-icon">🌿</div><div class="kpi-val" id="trz-kpi-apps">–</div>
        <div class="kpi-label">Aplicaciones</div>
      </div>
      <div class="kpi-card" style="border-left-color:#16A34A">
        <div class="kpi-icon">🌾</div><div class="kpi-val" id="trz-kpi-cultivos">–</div>
        <div class="kpi-label">Cultivos distintos</div>
      </div>
      <div class="kpi-card" style="border-left-color:#0369A1">
        <div class="kpi-icon">📦</div><div class="kpi-val" id="trz-kpi-productos">–</div>
        <div class="kpi-label">Productos aplicados</div>
      </div>
      <div class="kpi-card" style="border-left-color:#D97706">
        <div class="kpi-icon">🧑‍🌾</div><div class="kpi-val" id="trz-kpi-ings">–</div>
        <div class="kpi-label">Ingenieros activos</div>
      </div>
    </div>

    <!-- Filtros -->
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <select class="sel-sm" id="trz-f-ing">
        <option value="">Todos los ingenieros</option>
      </select>
      <select class="sel-sm" id="trz-f-cultivo">
        <option value="">Todos los cultivos</option>
        ${CULTIVOS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
      </select>
      <span style="font-size:11px;color:var(--text-sec)">Desde</span>
      <input type="date" class="sel-sm" id="trz-desde" value="${hace30}">
      <span style="font-size:11px;color:var(--text-sec)">Hasta</span>
      <input type="date" class="sel-sm" id="trz-hasta" value="${hoy}">
      <button class="btn-outline" id="trz-filtrar">Filtrar</button>
    </div>

    <!-- Tabla de trazabilidad -->
    <div style="overflow-x:auto">
      <table class="data-table">
        <thead><tr>
          <th>FECHA</th><th>INGENIERO</th><th>CLIENTE / PARCELA</th>
          <th>CULTIVO / ETAPA</th><th>PRODUCTOS</th><th>RESULTADO</th><th style="width:60px"></th>
        </tr></thead>
        <tbody id="trz-body">
          <tr><td colspan="7" style="padding:24px;text-align:center;color:var(--text-sec)">Cargando…</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Modal registro -->
    <div class="modal-overlay hidden" id="trz-modal">
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;
        width:100%;max-width:560px;box-shadow:0 24px 64px rgba(0,0,0,.5);
        display:flex;flex-direction:column;max-height:90vh">
        <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-shrink:0">
          <span style="font-size:20px">🔗</span>
          <div style="flex:1;font-size:13px;font-weight:800">Registrar aplicación</div>
          <button id="trz-modal-close" style="background:none;border:none;cursor:pointer;font-size:18px;color:#64748B">✕</button>
        </div>
        <div style="padding:18px 20px;overflow-y:auto;display:flex;flex-direction:column;gap:12px">

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">INGENIERO *</label>
              <select class="form-input" id="trz-f-ing-sel" style="width:100%">
                <option value="">— Seleccionar —</option>
              </select>
            </div>
            <div>
              <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">FECHA APLICACIÓN *</label>
              <input class="form-input" id="trz-f-fecha" type="date" value="${hoy}" style="width:100%">
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">CLIENTE *</label>
              <input class="form-input" id="trz-f-cliente" type="text" placeholder="Nombre del cliente" style="width:100%">
            </div>
            <div>
              <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">PARCELA / LOTE</label>
              <input class="form-input" id="trz-f-parcela" type="text" placeholder="Ej. Parcela Norte, Lote 3" style="width:100%">
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">CULTIVO *</label>
              <select class="form-input" id="trz-f-cultivo-sel" style="width:100%">
                <option value="">— Seleccionar —</option>
                ${CULTIVOS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
              </select>
            </div>
            <div>
              <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">ETAPA</label>
              <select class="form-input" id="trz-f-etapa-sel" style="width:100%">
                <option value="">— Seleccionar —</option>
                ${ETAPAS.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join("")}
              </select>
            </div>
          </div>

          <!-- Receta rápida -->
          <div>
            <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">CARGAR DESDE RECETA (opcional)</label>
            <select class="form-input" id="trz-f-receta" style="width:100%">
              <option value="">— Sin receta —</option>
            </select>
          </div>

          <!-- Productos aplicados -->
          <div>
            <div style="font-size:10px;font-weight:700;color:#64748B;text-transform:uppercase;margin-bottom:8px">Productos aplicados</div>
            <div id="trz-prod-rows" style="display:flex;flex-direction:column;gap:6px"></div>
            <button id="trz-add-prod" type="button"
              style="margin-top:8px;padding:6px 14px;border:1px dashed var(--border);border-radius:7px;
                background:transparent;color:#64748B;font-size:11px;cursor:pointer;width:100%">
              + Agregar producto
            </button>
          </div>

          <div>
            <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">RESULTADO / OBSERVACIONES</label>
            <textarea class="form-input" id="trz-f-resultado" rows="2"
              placeholder="Ej. Buena respuesta foliar. Cliente satisfecho. Se detectó trips en borde."
              style="width:100%;resize:vertical"></textarea>
          </div>

          <div>
            <label style="font-size:10px;font-weight:700;color:#64748B;display:block;margin-bottom:5px">PEDIDO ASOCIADO (opcional)</label>
            <input class="form-input" id="trz-f-pedido" type="text" placeholder="Folio del pedido" style="width:100%">
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid var(--border);flex-shrink:0">
          <button id="trz-cancel" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border);
            background:transparent;color:#94A3B8;font-size:12px;cursor:pointer">Cancelar</button>
          <button id="trz-guardar" style="padding:8px 22px;border-radius:8px;border:none;
            background:#6366F1;color:#fff;font-size:12px;font-weight:700;cursor:pointer">Registrar</button>
        </div>
      </div>
    </div>`;

  // ── Cargar ingenieros para selector ──
  let _trzProdCount = 0;
  let _recetasDisp = [];
  let _catalogo2 = [];

  async function _inicTrz() {
    try {
      const snap = await getDocs(query(collection(db,"usuarios"), where("activo","==",true), limit(200)));
      _ingenieros = snap.docs.map(d => ({ uid: d.id, ...d.data() }))
        .filter(u => ["INGENIERO","GERENTE","ADMINISTRADOR"].includes(u.rol||""));

      const addOpt = (selId, u) => {
        const opt = document.createElement("option");
        opt.value = u.uid; opt.textContent = u.alias||u.uid;
        document.getElementById(selId)?.appendChild(opt);
      };
      _ingenieros.forEach(u => {
        addOpt("trz-f-ing", u);
        addOpt("trz-f-ing-sel", u);
      });

      // Recetas disponibles para cargar rápido
      const rSnap = await getDocs(query(collection(db,"recetas_agroquimicas"), orderBy("nombre"), limit(200)));
      _recetasDisp = rSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const recSel = document.getElementById("trz-f-receta");
      _recetasDisp.forEach(r => {
        const opt = document.createElement("option");
        opt.value = r.id;
        opt.textContent = `${r.nombre} (${r.cultivo} · ${r.etapa})`;
        opt.dataset.productos = JSON.stringify(r.productos||[]);
        recSel?.appendChild(opt);
      });

      // Catálogo inventario
      const cSnap = await getDocs(query(collection(db,"inventario"), orderBy("nombre"), limit(600)));
      _catalogo2 = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) { console.error("[Trz init]", e); }
  }

  // Cargar receta seleccionada
  document.getElementById("trz-f-receta")?.addEventListener("change", () => {
    const sel = document.getElementById("trz-f-receta");
    const opt = sel?.selectedOptions[0];
    if (!opt || !opt.value) return;
    try {
      const prods = JSON.parse(opt.dataset.productos || "[]");
      if (document.getElementById("trz-prod-rows")) document.getElementById("trz-prod-rows").innerHTML = "";
      _trzProdCount = 0;
      prods.forEach(p => _agregarFilaTrz(p));
    } catch {}
  });

  function _agregarFilaTrz(val = null) {
    const idx = _trzProdCount++;
    const row = document.createElement("div");
    row.dataset.trzIdx = idx;
    row.style.cssText = "display:grid;grid-template-columns:1fr 80px 80px auto;gap:6px;align-items:center";
    row.innerHTML = `
      <div style="position:relative">
        <input type="text" placeholder="Producto" data-trz-search="${idx}"
          style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;
            font-size:12px;background:var(--surface);color:var(--text-primary);box-sizing:border-box"
          value="${esc(val?.nombre||"")}">
        <div data-trz-lista="${idx}" style="display:none;position:absolute;top:calc(100%+2px);left:0;right:0;
          background:var(--surface);border:1px solid var(--border);border-radius:6px;
          max-height:130px;overflow-y:auto;z-index:999;box-shadow:0 8px 24px rgba(0,0,0,.4)"></div>
        <input type="hidden" data-trz-pid="${idx}" value="${esc(val?.productoId||"")}">
      </div>
      <input type="number" placeholder="Dosis" min="0" step="0.01" data-trz-dosis="${idx}"
        value="${val?.dosis||""}"
        style="padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;
          background:var(--surface);color:var(--text-primary);text-align:center">
      <select data-trz-unidad="${idx}"
        style="padding:7px 6px;border:1px solid var(--border);border-radius:6px;font-size:11px;
          background:var(--surface);color:var(--text-primary)">
        ${["L/ha","kg/ha","ml/ha","g/ha","L/100L","ml/100L","g/100L"].map(u =>
          `<option value="${u}" ${val?.unidad===u?"selected":""}>${u}</option>`).join("")}
      </select>
      <button type="button" data-trz-del="${idx}"
        style="background:none;border:none;cursor:pointer;color:#DC2626;font-size:16px;padding:2px 4px">✕</button>`;
    document.getElementById("trz-prod-rows")?.appendChild(row);

    const searchInp = row.querySelector(`[data-trz-search="${idx}"]`);
    const listaEl   = row.querySelector(`[data-trz-lista="${idx}"]`);
    const pidInp    = row.querySelector(`[data-trz-pid="${idx}"]`);

    const renderL = () => {
      const t = (searchInp.value||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
      const matches = _catalogo2.filter(p => !t || (p.nombre||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").includes(t)).slice(0,20);
      if (!matches.length) { listaEl.style.display="none"; return; }
      listaEl.innerHTML = matches.map((p,i) =>
        `<div data-i="${i}" style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)"
          onmouseenter="this.style.background='var(--surface-2)'" onmouseleave="this.style.background='transparent'">
          ${esc(p.nombre||"")}</div>`).join("");
      listaEl.querySelectorAll("[data-i]").forEach(el2 => {
        el2.addEventListener("click", () => {
          const p = matches[parseInt(el2.dataset.i)];
          if (pidInp) pidInp.value = p.id;
          if (searchInp) searchInp.value = p.nombre;
          listaEl.style.display = "none";
        });
      });
      listaEl.style.display = "block";
    };
    searchInp?.addEventListener("focus", renderL);
    searchInp?.addEventListener("input", renderL);
    row.querySelector(`[data-trz-del="${idx}"]`)?.addEventListener("click", () => row.remove());
    document.addEventListener("click", e => {
      if (!listaEl?.contains(e.target) && e.target !== searchInp) listaEl && (listaEl.style.display="none");
    });
  }

  document.getElementById("trz-add-prod")?.addEventListener("click", () => _agregarFilaTrz());

  const cerrarTrz = () => {
    document.getElementById("trz-modal")?.classList.add("hidden");
    ["trz-f-ing-sel","trz-f-cultivo-sel","trz-f-etapa-sel","trz-f-receta"].forEach(id => { if(el(id)) el(id).value=""; });
    ["trz-f-cliente","trz-f-parcela","trz-f-resultado","trz-f-pedido"].forEach(id => { if(el(id)) el(id).value=""; });
    if (el("trz-f-fecha")) el("trz-f-fecha").value = hoy;
    if (el("trz-prod-rows")) el("trz-prod-rows").innerHTML = "";
    _trzProdCount = 0;
  };

  document.getElementById("trz-nuevo-btn")?.addEventListener("click", () => {
    cerrarTrz();
    document.getElementById("trz-modal")?.classList.remove("hidden");
    _agregarFilaTrz();
  });
  document.getElementById("trz-modal-close")?.addEventListener("click", cerrarTrz);
  document.getElementById("trz-cancel")?.addEventListener("click", cerrarTrz);
  document.getElementById("trz-modal")?.addEventListener("click", e => {
    if (e.target === document.getElementById("trz-modal")) cerrarTrz();
  });

  document.getElementById("trz-guardar")?.addEventListener("click", async () => {
    const ingSel = document.getElementById("trz-f-ing-sel");
    const ingId  = ingSel?.value;
    const ingAlias = ingSel?.selectedOptions[0]?.textContent || "";
    const fecha    = el("trz-f-fecha")?.value || hoy;
    const cliente  = el("trz-f-cliente")?.value.trim();
    const parcela  = el("trz-f-parcela")?.value.trim();
    const cultivo  = el("trz-f-cultivo-sel")?.value;
    const etapa    = el("trz-f-etapa-sel")?.value;
    const resultado= el("trz-f-resultado")?.value.trim();
    const pedidoId = el("trz-f-pedido")?.value.trim();

    if (!ingId)   { window.toast?.("Selecciona un ingeniero","warn"); return; }
    if (!cliente) { window.toast?.("Ingresa el cliente","warn"); return; }
    if (!cultivo) { window.toast?.("Selecciona el cultivo","warn"); return; }

    const filas = [...document.querySelectorAll("#trz-prod-rows > div")];
    const productos = filas.map(row => {
      const idx = row.dataset.trzIdx;
      return {
        productoId: row.querySelector(`[data-trz-pid="${idx}"]`)?.value || "",
        nombre:     row.querySelector(`[data-trz-search="${idx}"]`)?.value || "",
        dosis:      parseFloat(row.querySelector(`[data-trz-dosis="${idx}"]`)?.value||"0"),
        unidad:     row.querySelector(`[data-trz-unidad="${idx}"]`)?.value || "L/ha",
      };
    }).filter(p => p.nombre);

    const [y,m,d] = fecha.split("-").map(Number);
    const fechaTs = new Date(y,m-1,d,12,0,0).getTime();

    const btn = document.getElementById("trz-guardar");
    btn.disabled = true; btn.textContent = "Guardando…";
    try {
      await addDoc(collection(db,"trazabilidad_campo"), {
        ingenieroId: ingId, ingenieroAlias: ingAlias.trim(),
        clienteNombre: cliente, parcela: parcela||"",
        cultivo, etapa: etapa||"",
        productos, resultado: resultado||"",
        pedidoId: pedidoId||"",
        fechaAplicacion: fecha, fechaTs,
        quienRegistro: Sesion.alias, _ts: Date.now()
      });
      window.toast?.("Aplicación registrada","success");
      cerrarTrz();
    } catch(e) { window.toast?.("Error: "+e.message,"error"); }
    finally { btn.disabled=false; btn.textContent="Registrar"; }
  });

  // ── Cargar trazabilidad con filtros ──
  let _trzUnsub = null;
  function _cargarTrz() {
    if (_trzUnsub) { _trzUnsub(); _trzUnsub=null; }
    const ingId  = el("trz-f-ing")?.value || "";
    const cultivo= el("trz-f-cultivo")?.value || "";
    const desde  = el("trz-desde")?.value;
    const hasta  = el("trz-hasta")?.value;
    const [dy,dm,dd] = (desde||"").split("-").map(Number);
    const [hy,hm,hd] = (hasta||"").split("-").map(Number);
    const desdeTs = desde ? new Date(dy,dm-1,dd,0,0,0).getTime() : Date.now()-30*86400000;
    const hastaTs = hasta ? new Date(hy,hm-1,hd,23,59,59).getTime() : Date.now();

    let cs = [where("fechaTs",">=",desdeTs), where("fechaTs","<=",hastaTs),
      orderBy("fechaTs","desc"), limit(500)];
    if (ingId) cs = [where("ingenieroId","==",ingId), ...cs];
    const q = query(collection(db,"trazabilidad_campo"), ...cs);

    const tbody = el("trz-body");

    _trzUnsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const filtrado = cultivo ? rows.filter(r => r.cultivo === cultivo) : rows;

      // KPIs
      const cultivosSet = new Set(filtrado.map(r => r.cultivo));
      const ingsSet     = new Set(filtrado.map(r => r.ingenieroId));
      const prodSet     = new Set(filtrado.flatMap(r => (r.productos||[]).map(p => p.productoId||p.nombre)));
      if (el("trz-kpi-apps"))     el("trz-kpi-apps").textContent     = filtrado.length;
      if (el("trz-kpi-cultivos")) el("trz-kpi-cultivos").textContent = cultivosSet.size;
      if (el("trz-kpi-productos"))el("trz-kpi-productos").textContent= prodSet.size;
      if (el("trz-kpi-ings"))     el("trz-kpi-ings").textContent     = ingsSet.size;

      if (!tbody) return;
      if (!filtrado.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="padding:32px;text-align:center;color:var(--text-sec)">Sin registros en el período</td></tr>`;
        return;
      }
      tbody.innerHTML = filtrado.map(r => {
        const col = _etapaColor(r.etapa||"");
        return `<tr>
          <td style="font-size:11px;white-space:nowrap">${fmt(r.fechaTs)}</td>
          <td style="font-size:12px">${esc(r.ingenieroAlias||"–")}</td>
          <td>
            <div style="font-weight:700;font-size:12px">${esc(r.clienteNombre||"–")}</div>
            ${r.parcela ? `<div style="font-size:10px;color:#64748B">${esc(r.parcela)}</div>` : ""}
          </td>
          <td>
            <div style="font-weight:600;font-size:12px">${esc(r.cultivo||"–")}</div>
            ${r.etapa ? `<span style="background:${col.bg};color:${col.col};padding:1px 7px;border-radius:12px;font-size:9px;font-weight:700">${esc(r.etapa)}</span>` : ""}
          </td>
          <td style="font-size:11px;max-width:180px">
            ${(r.productos||[]).map(p =>
              `<span style="display:inline-block;background:var(--surface-2);border:1px solid var(--border);
                border-radius:5px;padding:1px 6px;margin:1px;font-size:10px">
                ${esc(p.nombre)} ${p.dosis?p.dosis+" "+esc(p.unidad||""):""}</span>`).join("")}
          </td>
          <td style="font-size:11px;color:var(--text-sec);max-width:160px">${esc(r.resultado||"–")}</td>
          <td>
            ${r.pedidoId ? `<span style="font-size:10px;background:#E0F2FE;color:#0369A1;padding:2px 6px;border-radius:6px">${esc(r.pedidoId)}</span>` : ""}
          </td>
        </tr>`;
      }).join("");
    }, e => console.error("[Trazabilidad]", e));
    _unsubs.push(_trzUnsub);
  }

  document.getElementById("trz-filtrar")?.addEventListener("click", _cargarTrz);
  document.getElementById("trz-f-ing")?.addEventListener("change", _cargarTrz);
  document.getElementById("trz-f-cultivo")?.addEventListener("change", _cargarTrz);

  _inicTrz().then(() => _cargarTrz());
}
