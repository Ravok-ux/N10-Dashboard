// ══════════════════════════════════════════════════════════════
// cartera.js — Aging de cuentas por cobrar, semáforo y desbloqueos
// ══════════════════════════════════════════════════════════════

import { db }    from "./firebase-config.js";
import { Sesion } from "./auth.js";
import { esc }   from "./app.js";
import {
  collection, doc, query, orderBy, onSnapshot,
  getDoc, getDocs, updateDoc, setDoc, where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { exportarExcel } from "./excel-utils.js";

const fmt    = new Intl.NumberFormat("es-MX", { style:"currency", currency:"MXN" });
const fmtDt  = ts => ts ? new Date(ts).toLocaleDateString("es-MX", { day:"numeric", month:"short", year:"numeric" }) : "—";

// ── Estado ────────────────────────────────────────────────────
let _unsub        = null;
let _clientes     = [];
let _filtrados    = [];
let _config       = { semaforo:{ verde:15, amarillo:30, naranja:60 }, bloqueoAutoActivo:true,
                       frecuencias:[], horasDesbloqueo:[4,8,24] };
let _fColor       = "TODOS";  // TODOS | CRÍTICO | GRAVE | MODERADO | LEVE | POR_VENCER
let _fBusqueda    = "";
let _tabActiva    = "aging";   // aging | config

// Colores del semáforo según motor de intereses (intereses-engine.js)
const COLORES = {
  CRÍTICO:   { bg:"#C0504D", text:"#FFFFFF", label:"Crítico (+61 d)" },
  GRAVE:     { bg:"#F79646", text:"#FFFFFF", label:"Grave (44–61 d)" },
  MODERADO:  { bg:"#8DB4E2", text:"#1A3A5C", label:"Moderado (30–43 d)" },
  LEVE:      { bg:"#FFFF99", text:"#5A4A00", label:"Leve (16–29 d)" },
  POR_VENCER:{ bg:"#92D050", text:"#2A4A00", label:"Por vencer (≤15 d)" },
  PAGADO:    { bg:"#DCFCE7", text:"#166534", label:"Pagado" },
  FUTURA:    { bg:"#E5E7EB", text:"#6B7280", label:"Futura" },
};

const _puedeDesbloquear = () => {
  const rol = Sesion.rol;
  return Sesion.esSuperAdmin() ||
    ["GERENTE","GERENTE_ZONA","MESA_CONTROL"].includes(rol) ||
    Sesion.flags?.PUEDE_DESBLOQUEAR_CARTERA === true;
};

// ── Módulo exportado ──────────────────────────────────────────
export const CarteraModule = {
  mount(container) {
    _cargarConfig().then(() => {
      container.innerHTML = _html();
      document.getElementById("cart-tbody").innerHTML = window.skeleton?.(5, 7) ?? "";
      _bindUI(container);
      _escuchar();
    });
    return () => this.destroy();
  },
  destroy() {
    _unsub?.();
    _unsub = null;
    _clientes = [];
    _filtrados = [];
  }
};

// ── Cargar config desde Firestore ─────────────────────────────
async function _cargarConfig() {
  try {
    const snap = await getDoc(doc(db, "configuracion", "cartera"));
    if (snap.exists()) _config = { ..._config, ...snap.data() };
  } catch (_) {}
}

// ── Escucha de clientes ───────────────────────────────────────
function _escuchar() {
  _unsub?.();
  _unsub = onSnapshot(
    query(collection(db, "clientes"), orderBy("diasMaxVencidos", "desc")),
    snap => {
      _clientes = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => (c.saldoPendiente > 0 || c.totalAPagarTotal > 0 || c.diasMaxVencidos > 0 || c.semaforoColor));
      _aplicarFiltros();
    },
    err => console.error("[cartera] escucha error:", err)
  );
}

// ── Filtros ───────────────────────────────────────────────────
function _aplicarFiltros() {
  const q = _fBusqueda.toLowerCase();
  _filtrados = _clientes.filter(c => {
    if (_fColor !== "TODOS" && c.semaforoColor !== _fColor) return false;
    if (q && !(c.nombre||"").toLowerCase().includes(q) && !(c.vendedor||"").toLowerCase().includes(q)) return false;
    return true;
  });
  _renderTabla();
  _renderKpis();
}

// ── HTML base ─────────────────────────────────────────────────
function _html() {
  return `
  <div style="padding:0 0 24px">

    <!-- Tabs -->
    <div style="display:flex;gap:4px;margin-bottom:16px;border-bottom:2px solid var(--border)">
      <button class="cart-tab active" data-tab="aging" style="${_tabStyle(true)}">📊 Aging / Cartera</button>
      <button class="cart-tab" data-tab="config" style="${_tabStyle(false)}">⚙️ Configuración</button>
    </div>

    <!-- Panel Aging -->
    <div id="cart-panel-aging">
      <!-- KPIs -->
      <div id="cart-kpis" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:16px">
        <div class="skeleton" style="height:72px;border-radius:8px"></div>
        <div class="skeleton" style="height:72px;border-radius:8px"></div>
        <div class="skeleton" style="height:72px;border-radius:8px"></div>
        <div class="skeleton" style="height:72px;border-radius:8px"></div>
        <div class="skeleton" style="height:72px;border-radius:8px"></div>
      </div>

      <!-- Controles -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        <input id="cart-search" type="text" placeholder="🔍 Buscar cliente o ingeniero…"
          style="flex:1;min-width:200px;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--text-primary);font-size:13px">
        <select id="cart-color-filter" style="padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface-2);color:var(--text-primary);font-size:13px">
          <option value="TODOS">Todos los semáforos</option>
          <option value="CRÍTICO">🔴 Crítico (+61 d)</option>
          <option value="GRAVE">🟠 Grave (44–61 d)</option>
          <option value="MODERADO">🔵 Moderado (30–43 d)</option>
          <option value="LEVE">🟡 Leve (16–29 d)</option>
          <option value="POR_VENCER">🟢 Por vencer (≤15 d)</option>
        </select>
        <button onclick="CarteraUI.exportar()" style="padding:7px 12px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">⬇️ Excel</button>
      </div>

      <!-- Tabla -->
      <div style="overflow-x:auto">
        <table id="cart-table" style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:var(--surface-2);text-align:left">
              <th style="padding:8px 10px">Cliente</th>
              <th style="padding:8px 10px">Ingeniero</th>
              <th style="padding:8px 10px;text-align:right">Capital</th>
              <th style="padding:8px 10px;text-align:right">Interés gen.</th>
              <th style="padding:8px 10px;text-align:right;color:#F59E0B;font-weight:800">Total a pagar</th>
              <th style="padding:8px 10px;text-align:center">Días vencido</th>
              <th style="padding:8px 10px;text-align:center">Semáforo</th>
              <th style="padding:8px 10px;text-align:center">Estado</th>
              <th style="padding:8px 10px;text-align:center">Acciones</th>
            </tr>
          </thead>
          <tbody id="cart-tbody">
            ${window.skeletonRows?.(8, 7) ?? ""}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Panel Config -->
    <div id="cart-panel-config" style="display:none">
      ${_htmlConfig()}
    </div>

  </div>`;
}

function _tabStyle(active) {
  return `padding:8px 16px;border:none;background:none;cursor:pointer;font-size:13px;font-weight:${active?"700":"400"};
    color:${active?"var(--accent)":"var(--text-sec)"};border-bottom:${active?"2px solid var(--accent)":"2px solid transparent"};margin-bottom:-2px`;
}

function _htmlConfig() {
  const s = _config.semaforo || {};
  const h = (_config.horasDesbloqueo || [4,8,24]).join(", ");
  const freqs = (_config.frecuencias || []).map((f,i) =>
    `<tr>
      <td style="padding:4px 8px"><input data-fi="${i}" data-fk="label" value="${esc(f.label)}" style="${_inputStyle()}"></td>
      <td style="padding:4px 8px"><input type="number" data-fi="${i}" data-fk="dias" value="${f.dias}" style="${_inputStyle()} width:70px"></td>
      <td style="padding:4px 8px"><button onclick="CarteraUI.eliminarFrecuencia(${i})" style="background:#FEE2E2;color:#991B1B;border:none;border-radius:4px;padding:4px 8px;cursor:pointer">✕</button></td>
    </tr>`
  ).join("");

  return `
  <div style="max-width:640px;display:flex;flex-direction:column;gap:24px">

    <div style="background:var(--surface-2);border-radius:10px;padding:20px">
      <div style="font-weight:700;margin-bottom:14px;font-size:14px">🚦 Umbrales del semáforo (días vencidos)</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
        <label style="font-size:12px;color:var(--text-sec)">🟢 Verde hasta
          <input id="cfg-verde" type="number" value="${s.verde??15}" min="1" style="${_inputStyle()} margin-top:4px">
        </label>
        <label style="font-size:12px;color:var(--text-sec)">🟡 Amarillo hasta
          <input id="cfg-amarillo" type="number" value="${s.amarillo??30}" min="1" style="${_inputStyle()} margin-top:4px">
        </label>
        <label style="font-size:12px;color:var(--text-sec)">🟠 Naranja hasta
          <input id="cfg-naranja" type="number" value="${s.naranja??60}" min="1" style="${_inputStyle()} margin-top:4px">
        </label>
      </div>
      <div style="margin-top:12px;display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="cfg-bloqueo" ${_config.bloqueoAutoActivo!==false?"checked":""}>
        <label for="cfg-bloqueo" style="font-size:13px">Bloqueo automático de pedidos cuando semáforo es 🔴 Rojo</label>
      </div>
    </div>

    <div style="background:var(--surface-2);border-radius:10px;padding:20px">
      <div style="font-weight:700;margin-bottom:14px;font-size:14px">🔓 Horas de desbloqueo temporal</div>
      <div style="font-size:12px;color:var(--text-sec);margin-bottom:8px">Opciones disponibles para el menú (separadas por coma)</div>
      <input id="cfg-horas" value="${esc(h)}" style="${_inputStyle()} width:200px">
    </div>

    <div style="background:var(--surface-2);border-radius:10px;padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-weight:700;font-size:14px">📅 Categorías de frecuencia de visita</div>
        <button onclick="CarteraUI.agregarFrecuencia()" style="padding:5px 12px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px">+ Agregar</button>
      </div>
      <table id="cfg-freqs-table" style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="color:var(--text-sec);font-size:12px">
          <th style="padding:4px 8px;text-align:left">Nombre</th>
          <th style="padding:4px 8px;text-align:left">Días</th>
          <th></th>
        </tr></thead>
        <tbody id="cfg-freqs-tbody">${freqs}</tbody>
      </table>
    </div>

    <button id="cfg-guardar" style="padding:10px 24px;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:14px;align-self:flex-start">
      💾 Guardar configuración
    </button>
  </div>`;
}

function _inputStyle() {
  return "width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text-primary);font-size:13px;box-sizing:border-box;";
}

// ── Render tabla ──────────────────────────────────────────────
function _renderTabla() {
  const tbody = document.getElementById("cart-tbody");
  if (!tbody) return;
  if (_filtrados.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-sec)">Sin clientes con saldo pendiente</td></tr>`;
    return;
  }
  tbody.innerHTML = _filtrados.map(c => {
    const col    = COLORES[c.semaforoColor] || COLORES.POR_VENCER;
    const dias   = c.diasMaxVencidos || 0;
    const bloq   = c.bloqueado;
    const desbl  = c.desbloqueoHasta > Date.now();
    const puedeDesbl = _puedeDesbloquear();
    const capital  = c.saldoCapitalTotal ?? c.saldoPendiente ?? 0;
    const interes  = c.interesTotal ?? 0;
    const totalAP  = c.totalAPagarTotal ?? (capital + interes);

    const estadoChip = bloq
      ? (desbl
          ? `<span style="padding:2px 8px;background:#FEF9C3;color:#854D0E;border-radius:12px;font-size:11px">🔓 Desbloqueado temp.</span>`
          : `<span style="padding:2px 8px;background:#FEE2E2;color:#991B1B;border-radius:12px;font-size:11px">🔒 Bloqueado</span>`)
      : `<span style="padding:2px 8px;background:#DCFCE7;color:#166534;border-radius:12px;font-size:11px">✓ Activo</span>`;

    const accionDesbl = (bloq && !desbl && puedeDesbl)
      ? `<button onclick="CarteraUI.abrirDesbloqueo('${c.id}','${esc(c.nombre)}')" style="padding:3px 8px;background:#DBEAFE;color:#1E40AF;border:none;border-radius:4px;cursor:pointer;font-size:11px">🔓 Desbloquear</button>`
      : "";
    const accionRebloq = (desbl && puedeDesbl)
      ? `<button onclick="CarteraUI.rebloqueaCliente('${c.id}')" style="padding:3px 8px;background:#FEE2E2;color:#991B1B;border:none;border-radius:4px;cursor:pointer;font-size:11px">🔒 Revocar</button>`
      : "";

    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:9px 10px;font-weight:600">${esc(c.nombre || c.id)}</td>
      <td style="padding:9px 10px;color:var(--text-sec)">${esc(c.vendedor || "—")}</td>
      <td style="padding:9px 10px;text-align:right;font-variant-numeric:tabular-nums;color:var(--text-sec)">${fmt.format(capital)}</td>
      <td style="padding:9px 10px;text-align:right;font-variant-numeric:tabular-nums;color:${interes>0?"#F59E0B":"var(--text-sec)"}">
        ${interes > 0 ? fmt.format(interes) : "—"}</td>
      <td style="padding:9px 10px;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:#F97316">
        ${fmt.format(totalAP)}</td>
      <td style="padding:9px 10px;text-align:center;font-weight:700;color:${col.text}">${dias > 0 ? dias : "—"}</td>
      <td style="padding:9px 10px;text-align:center">
        <span style="padding:2px 10px;background:${col.bg};color:${col.text};border-radius:12px;font-size:11px;font-weight:600">${col.label}</span>
      </td>
      <td style="padding:9px 10px;text-align:center">${estadoChip}</td>
      <td style="padding:9px 10px;text-align:center;display:flex;gap:4px;justify-content:center">${accionDesbl}${accionRebloq}</td>
    </tr>`;
  }).join("");
}

// ── KPIs ──────────────────────────────────────────────────────
function _renderKpis() {
  const el = document.getElementById("cart-kpis");
  if (!el) return;
  const total     = _clientes.length;
  const capitalT  = _clientes.reduce((s,c) => s + (c.saldoCapitalTotal ?? c.saldoPendiente ?? 0), 0);
  const interesT  = _clientes.reduce((s,c) => s + (c.interesTotal ?? 0), 0);
  const totalAPT  = _clientes.reduce((s,c) => s + (c.totalAPagarTotal ?? (c.saldoCapitalTotal ?? c.saldoPendiente ?? 0) + (c.interesTotal ?? 0)), 0);
  const rojos     = _clientes.filter(c => c.semaforoColor === "CRÍTICO" || c.semaforoColor === "GRAVE").length;
  const bloq      = _clientes.filter(c => c.bloqueado).length;
  const desbloq   = _clientes.filter(c => c.desbloqueoHasta > Date.now()).length;

  const kpi = (val, label, color="var(--text-primary)") =>
    `<div style="background:var(--surface);border-radius:8px;border:1px solid var(--border);padding:14px 16px">
      <div style="font-size:18px;font-weight:700;color:${color};font-variant-numeric:tabular-nums">${val}</div>
      <div style="font-size:11px;color:var(--text-sec);margin-top:2px">${label}</div>
    </div>`;

  el.innerHTML =
    kpi(total, "Clientes en cartera") +
    kpi(fmt.format(capitalT), "Capital pendiente", "#3B82F6") +
    kpi(fmt.format(interesT), "Interés generado", "#F59E0B") +
    kpi(fmt.format(totalAPT), "Total a pagar", "#F97316") +
    kpi(rojos, "Crítico / Grave", "#EF4444") +
    kpi(bloq,  "Bloqueados", "#F59E0B") +
    kpi(desbloq, "Desbloqueados temp.", "#8B5CF6");
}

// ── Bind UI ───────────────────────────────────────────────────
function _bindUI(container) {
  container.addEventListener("click", e => {
    const tab = e.target.closest(".cart-tab");
    if (tab) _cambiarTab(tab.dataset.tab, container);
  });

  container.querySelector("#cart-search")?.addEventListener("input", e => {
    _fBusqueda = e.target.value.trim();
    _aplicarFiltros();
  });
  container.querySelector("#cart-color-filter")?.addEventListener("change", e => {
    _fColor = e.target.value;
    _aplicarFiltros();
  });

  container.querySelector("#cfg-guardar")?.addEventListener("click", () => _guardarConfig(container));

  window.CarteraUI = {
    exportar: _exportar,
    abrirDesbloqueo: _abrirDesbloqueo,
    rebloqueaCliente: _rebloqueaCliente,
    agregarFrecuencia: () => _agregarFrecuencia(container),
    eliminarFrecuencia: (i) => _eliminarFrecuencia(i, container),
  };
}

function _cambiarTab(tab, container) {
  _tabActiva = tab;
  container.querySelectorAll(".cart-tab").forEach(b => {
    const active = b.dataset.tab === tab;
    b.style.fontWeight  = active ? "700" : "400";
    b.style.color       = active ? "var(--accent)" : "var(--text-sec)";
    b.style.borderBottom = active ? "2px solid var(--accent)" : "2px solid transparent";
  });
  document.getElementById("cart-panel-aging").style.display  = tab === "aging"  ? "" : "none";
  document.getElementById("cart-panel-config").style.display = tab === "config" ? "" : "none";
}

// ── Desbloqueo temporal ───────────────────────────────────────
function _abrirDesbloqueo(clienteId, clienteNombre) {
  const horas = _config.horasDesbloqueo || [4, 8, 24];
  const opts  = horas.map(h => `<option value="${h}">${h} horas</option>`).join("");
  const modal = document.createElement("div");
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999;display:flex;align-items:center;justify-content:center";
  modal.innerHTML = `
    <div style="background:var(--surface);border-radius:12px;padding:24px;width:360px;box-shadow:0 20px 40px rgba(0,0,0,.3)">
      <h3 style="margin:0 0 4px">🔓 Desbloqueo temporal</h3>
      <p style="margin:0 0 16px;font-size:13px;color:var(--text-sec)">${esc(clienteNombre)}</p>
      <label style="font-size:13px;display:block;margin-bottom:8px">Duración del desbloqueo:
        <select id="dl-horas" style="width:100%;margin-top:4px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text-primary)">${opts}</select>
      </label>
      <label style="font-size:13px;display:block;margin-bottom:16px">Motivo (opcional):
        <textarea id="dl-motivo" rows="2" style="width:100%;margin-top:4px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text-primary);resize:none;box-sizing:border-box" placeholder="Ej. Autorizado por gerencia para pedido urgente"></textarea>
      </label>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="dl-cancel" style="padding:8px 16px;border:1px solid var(--border);background:none;border-radius:6px;cursor:pointer;color:var(--text-primary)">Cancelar</button>
        <button id="dl-ok" style="padding:8px 16px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700">Desbloquear</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector("#dl-cancel").onclick = () => modal.remove();
  modal.querySelector("#dl-ok").onclick = async () => {
    const h      = Number(modal.querySelector("#dl-horas").value) || 4;
    const motivo = modal.querySelector("#dl-motivo").value.trim();
    const hasta  = Date.now() + h * 3600000;
    try {
      await updateDoc(doc(db, "clientes", clienteId), {
        bloqueado: false,
        desbloqueoHasta: hasta,
        desbloqueoMotivo: motivo || "",
        desbloqueadoPor:  Sesion.alias,
        desbloqueoEn:     serverTimestamp()
      });
      toast?.(`✅ ${esc(clienteNombre)} desbloqueado por ${h}h`, "success");
    } catch (e) { toast?.("❌ Error: " + e.message, "error"); }
    modal.remove();
  };
}

async function _rebloqueaCliente(clienteId) {
  if (!await window.modal({ title: "Revocar desbloqueo", message: "¿Revocar el desbloqueo temporal y volver a bloquear este cliente?", danger: true })) return;
  try {
    await updateDoc(doc(db, "clientes", clienteId), { bloqueado: true, desbloqueoHasta: 0 });
    toast?.("✅ Cliente bloqueado nuevamente", "success");
  } catch (e) { toast?.("❌ Error: " + e.message, "error"); }
}

// ── Config: guardar ───────────────────────────────────────────
async function _guardarConfig(container) {
  const verde    = parseInt(document.getElementById("cfg-verde")?.value) || 15;
  const amarillo = parseInt(document.getElementById("cfg-amarillo")?.value) || 30;
  const naranja  = parseInt(document.getElementById("cfg-naranja")?.value) || 60;
  const bloqueo  = document.getElementById("cfg-bloqueo")?.checked !== false;
  const horasRaw = (document.getElementById("cfg-horas")?.value || "4,8,24")
    .split(",").map(h => parseInt(h.trim())).filter(h => h > 0);

  // Leer frecuencias del DOM
  const filas = document.querySelectorAll("#cfg-freqs-tbody tr");
  const frecuencias = Array.from(filas).map(tr => ({
    label: tr.querySelector("[data-fk='label']")?.value.trim() || "",
    dias:  parseInt(tr.querySelector("[data-fk='dias']")?.value) || 7
  })).filter(f => f.label);

  const nuevo = { semaforo:{ verde, amarillo, naranja }, bloqueoAutoActivo: bloqueo,
                  horasDesbloqueo: horasRaw, frecuencias,
                  actualizadoPor: Sesion.alias, actualizadoEn: serverTimestamp() };
  try {
    await setDoc(doc(db, "configuracion", "cartera"), nuevo, { merge: true });
    _config = { ..._config, ...nuevo };
    toast?.("✅ Configuración guardada", "success");
  } catch (e) { toast?.("❌ " + e.message, "error"); }
}

function _agregarFrecuencia(container) {
  _config.frecuencias = [...(_config.frecuencias || []), { label: "Nueva categoría", dias: 7 }];
  document.getElementById("cart-panel-config").innerHTML = _htmlConfig();
  _bindConfigUI(container);
}

function _eliminarFrecuencia(i, container) {
  _config.frecuencias = (_config.frecuencias || []).filter((_, idx) => idx !== i);
  document.getElementById("cart-panel-config").innerHTML = _htmlConfig();
  _bindConfigUI(container);
}

function _bindConfigUI(container) {
  document.getElementById("cfg-guardar")?.addEventListener("click", () => _guardarConfig(container));
}

// ── Exportar ──────────────────────────────────────────────────
function _exportar() {
  const rows = _filtrados.map(c => ({
    cliente:      c.nombre || c.id,
    ingeniero:    c.vendedor || "—",
    capital:      c.saldoCapitalTotal ?? c.saldoPendiente ?? 0,
    interes:      c.interesTotal ?? 0,
    totalAPagar:  c.totalAPagarTotal ?? (c.saldoCapitalTotal ?? c.saldoPendiente ?? 0) + (c.interesTotal ?? 0),
    diasVencidos: c.diasMaxVencidos || 0,
    semaforo:     c.semaforoColor || "VERDE",
    bloqueado:    c.bloqueado ? "Sí" : "No",
  }));
  exportarExcel(rows, [
    { key:"cliente",     header:"Cliente",           width:30 },
    { key:"ingeniero",   header:"Ingeniero",          width:20 },
    { key:"capital",     header:"Capital ($)",        width:16, tipo:"numero" },
    { key:"interes",     header:"Interés gen. ($)",   width:16, tipo:"numero" },
    { key:"totalAPagar", header:"Total a pagar ($)",  width:18, tipo:"numero" },
    { key:"diasVencidos",header:"Días vencidos",      width:14, tipo:"numero" },
    { key:"semaforo",    header:"Semáforo",           width:12 },
    { key:"bloqueado",   header:"Bloqueado",          width:10 },
  ], "Cartera_" + new Date().toISOString().slice(0,10));
}
