// ══════════════════════════════════════════════════════════════
// app.js — Router principal, inicialización del shell
// ══════════════════════════════════════════════════════════════

import { Auth, Sesion, iniciarInactivityTimer, detenerInactivityTimer } from "./auth.js";
import { PreferenciasModule, aplicarPrefsIniciales } from "./preferencias.js";
import { DashboardModule }  from "./dashboard.js";
import { MapaModule }       from "./mapa.js";
import { FeedModule }       from "./feed.js";
import { UsuariosModule }   from "./usuarios.js";
import { ReportesModule }   from "./reportes.js";
import { PedidosModule }    from "./pedidos.js";
import { RemisionesModule } from "./remisiones.js";
import { CobranzaModule }   from "./cobranza.js";
import { IngenierosModule } from "./ingenieros.js";
import { ComisionesModule } from "./comisiones.js";
import { ComprasModule }       from "./compras.js";
import { ConfigModule }        from "./config.js";
import { ComentariosModule }   from "./comentarios.js";
import { PreciosModule }         from "./precios.js";
import { ProductosControlModule } from "./productos-control.js";
import { GeocercasModule }        from "./geocercas.js";
import { MetasModule }            from "./metas.js";
import { AutorizacionesModule }   from "./autorizaciones.js";
import { FormulariosModule }      from "./formularios.js";
import { PromocionesModule }      from "./promociones.js";
import { SegmentoPrecioModule }   from "./precios-segmento.js";
import { ClientesModule }         from "./clientes.js";
import { KardexModule }           from "./kardex.js";
import { CarteraModule }          from "./cartera.js";
import { VisitasModule }          from "./visitas.js";
import { CotizacionesPanelModule } from "./cotizaciones-panel.js";
import { DevolucionesModule }      from "./devoluciones.js";
import { ChatModule, iniciarChatBg, detenerChatBg } from "./chat.js";
import { RhModule }               from "./rh.js";
import { AuditoriaModule }        from "./auditoria.js";
import { InventarioModule }       from "./inventario.js";
import { CrmModule }              from "./crm.js";
import { LogisticaModule }        from "./logistica.js";
import { JuridicoModule }         from "./juridico.js";
import { ObservabilidadModule }   from "./observabilidad.js";
import { MiRhModule }             from "./mi-rh.js";
import { ManualesModule }          from "./manuales.js";
import { ConfigInteresesModule }   from "./config-intereses.js";
import { mount as rcMount, destroy as rcDestroy } from "./reportes-custom.js";
import { iniciarNotificaciones, detenerNotificaciones } from "./notificaciones.js";
import { iniciarFCM } from "./fcm.js";
import { db } from "./firebase-config.js";
import {
  collection, query, where, orderBy, limit as fsLimit, getDocs,
  startAt, endAt
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Sanitización XSS ──────────────────────────────────────────
// Usa esta función en TODOS los lugares donde datos de Firestore
// se insertan con innerHTML. Convierte caracteres peligrosos a
// entidades HTML para evitar XSS (Cross-Site Scripting).
const _escMap = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":"&#x27;" };
export function esc(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => _escMap[c]);
}
// Exponerlo globalmente para módulos que no usen import
window.esc = esc;

// ── Modal de confirmación ─────────────────────────────────────
// Reemplaza confirm() / prompt() nativos con un modal estilizado.
// Uso: const ok = await window.modal({ message:"¿Seguro?", danger:true })
// Uso prompt: const txt = await window.promptModal({ label:"Motivo" })
window.modal = ({ title = "", message = "", confirmLabel = "Confirmar", cancelLabel = "Cancelar", danger = false } = {}) =>
  new Promise(resolve => {
    const o = document.createElement("div");
    o.id = "_gmodal";
    o.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9990;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(2px)";
    const confirmStyle = danger
      ? "background:#DC2626;color:#fff;border:1px solid #B91C1C"
      : "background:var(--primary,#1D5C33);color:#fff;border:1px solid #16A34A";
    o.innerHTML = `
      <div style="background:var(--surface,#1e293b);border:1px solid var(--border,#334155);border-radius:12px;
        padding:24px 28px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.45)">
        ${title ? `<div style="font-size:14px;font-weight:700;color:var(--text,#f1f5f9);margin-bottom:10px">${esc(title)}</div>` : ""}
        <div style="font-size:13px;color:var(--text2,#94a3b8);line-height:1.6;margin-bottom:20px">${esc(message)}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="_gm-c" style="padding:8px 18px;border-radius:7px;font-size:12px;font-weight:600;
            cursor:pointer;border:1px solid var(--border,#334155);background:transparent;color:var(--text2,#94a3b8)">${esc(cancelLabel)}</button>
          <button id="_gm-ok" style="padding:8px 18px;border-radius:7px;font-size:12px;font-weight:600;
            cursor:pointer;${confirmStyle}">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    const close = r => { o.remove(); resolve(r); };
    o.querySelector("#_gm-c").onclick  = () => close(false);
    o.querySelector("#_gm-ok").onclick = () => close(true);
    o.addEventListener("click", e => { if (e.target === o) close(false); });
    const onKey = e => { if (e.key === "Escape") { close(false); document.removeEventListener("keydown", onKey); } };
    document.addEventListener("keydown", onKey);
    document.body.appendChild(o);
    o.querySelector("#_gm-ok").focus();
  });

// ── Skeleton loader ───────────────────────────────────────────
// Genera N filas skeleton para mostrar mientras carga Firestore.
// Uso: container.innerHTML = window.skeleton(5, 4); // 5 filas, 4 columnas
window.skeleton = (rows = 4, cols = 4) => {
  const cells = Array(cols).fill(`<td><div class="skel-cell"></div></td>`).join("");
  const trs   = Array(rows).fill(`<tr>${cells}</tr>`).join("");
  if (!document.getElementById("_skel-style")) {
    const s = document.createElement("style");
    s.id = "_skel-style";
    s.textContent = `
      .skel-cell { height:12px; border-radius:4px;
        background: linear-gradient(90deg, var(--border,#e2e8f0) 25%, var(--surface2,#f8fafc) 50%, var(--border,#e2e8f0) 75%);
        background-size:200% 100%; animation:skel-shine 1.4s ease infinite; }
      @keyframes skel-shine { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
    `;
    document.head.appendChild(s);
  }
  return `<table style="width:100%;border-collapse:collapse"><tbody>${trs}</tbody></table>`;
};

window.promptModal = ({ title = "", label = "", placeholder = "", confirmLabel = "Aceptar", cancelLabel = "Cancelar" } = {}) =>
  new Promise(resolve => {
    const o = document.createElement("div");
    o.id = "_gpmodal";
    o.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9990;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(2px)";
    o.innerHTML = `
      <div style="background:var(--surface,#1e293b);border:1px solid var(--border,#334155);border-radius:12px;
        padding:24px 28px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.45)">
        ${title ? `<div style="font-size:14px;font-weight:700;color:var(--text,#f1f5f9);margin-bottom:10px">${esc(title)}</div>` : ""}
        ${label ? `<label style="font-size:12px;color:var(--text2,#94a3b8);display:block;margin-bottom:6px">${esc(label)}</label>` : ""}
        <input id="_gpi" type="text" placeholder="${esc(placeholder)}"
          style="width:100%;padding:9px 12px;border:1px solid var(--border,#334155);border-radius:7px;
            font-size:13px;background:var(--bg,#0f172a);color:var(--text,#f1f5f9);margin-bottom:16px;outline:none">
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="_gpi-c" style="padding:8px 18px;border-radius:7px;font-size:12px;font-weight:600;
            cursor:pointer;border:1px solid var(--border,#334155);background:transparent;color:var(--text2,#94a3b8)">${esc(cancelLabel)}</button>
          <button id="_gpi-ok" style="padding:8px 18px;border-radius:7px;font-size:12px;font-weight:600;
            cursor:pointer;background:var(--primary,#1D5C33);color:#fff;border:1px solid #16A34A">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    const close = r => { o.remove(); resolve(r); };
    o.querySelector("#_gpi-c").onclick  = () => close(null);
    o.querySelector("#_gpi-ok").onclick = () => close(o.querySelector("#_gpi").value);
    o.addEventListener("click", e => { if (e.target === o) close(null); });
    const onKey = e => { if (e.key === "Escape") { close(null); document.removeEventListener("keydown", onKey); } };
    document.addEventListener("keydown", onKey);
    document.body.appendChild(o);
    o.querySelector("#_gpi").focus();
  });

// ── Módulos registrados por nombre de vista ────────────────────
const MODULES = {
  dashboard:  DashboardModule,
  mapa:       MapaModule,
  feed:       FeedModule,
  usuarios:   UsuariosModule,
  reportes:   ReportesModule,
  pedidos:    PedidosModule,
  remisiones: RemisionesModule,
  cobranza:   CobranzaModule,
  ingenieros: IngenierosModule,
  comisiones: ComisionesModule,
  compras:      ComprasModule,
  kardex:       KardexModule,
  cartera:      CarteraModule,
  visitas:      VisitasModule,
  cotizaciones: CotizacionesPanelModule,
  devoluciones: DevolucionesModule,
  chat:         ChatModule,
  rh:           RhModule,
  auditoria:    AuditoriaModule,
  inventario:   InventarioModule,
  crm:          CrmModule,
  logistica:    LogisticaModule,
  juridico:        JuridicoModule,
  observabilidad:  ObservabilidadModule,
  mi_rh:           MiRhModule,
  precios:      PreciosModule,
  productos:    ProductosControlModule,
  geocercas:      GeocercasModule,
  metas:          MetasModule,
  autorizaciones: AutorizacionesModule,
  formularios:    FormulariosModule,
  promociones:    PromocionesModule,
  precios_segmento: SegmentoPrecioModule,
  clientes:         ClientesModule,
  manuales:         ManualesModule,
  config:           ConfigModule,
  config_intereses: ConfigInteresesModule,
  comentarios:      ComentariosModule,
  reportes_custom:  { mount: rcMount, destroy: rcDestroy },
};

let vistaActual = null;
let _unsubscribers = [];

// ── Iniciar app ────────────────────────────────────────────────
Auth.observarSesion(
  () => {
    iniciarInactivityTimer();
    _initShell();
    // Listeners de fondo del chat: badge + sonido desde cualquier vista
    setTimeout(() => iniciarChatBg(), 1200);
    aplicarPrefsIniciales(Sesion.uid).then(() => {
      // Navegar a vista por defecto de prefs si existe
      const defView = Sesion.prefs?.defaultView;
      _navigate(defView && defView !== "dashboard" ? defView : "dashboard");
    }).catch(() => _navigate("dashboard"));
  },
  () => {
    detenerInactivityTimer();
    detenerNotificaciones();
    detenerChatBg();
    _destroyAll();
    document.getElementById("app-shell").classList.add("hidden");
    document.getElementById("login-screen").classList.remove("hidden");
  }
);

// ── Shell ──────────────────────────────────────────────────────
function _initShell() {
  const shell = document.getElementById("app-shell");
  const login = document.getElementById("login-screen");
  login.classList.add("hidden");
  shell.classList.remove("hidden");

  // Iniciales de usuario en topbar y sidebar
  const initiales = (Sesion.alias || "?").slice(0, 2).toUpperCase();
  document.getElementById("sb-ava").textContent   = initiales;
  document.getElementById("sb-uname").textContent = Sesion.alias;
  document.getElementById("sb-urole").textContent = (Sesion.rol || "").replace("_", " ");
  document.getElementById("tb-ava").textContent   = initiales;
  document.getElementById("tb-uname").textContent = Sesion.alias;

  _aplicarVisibilidadSidebar();

  // Firebase status verde
  _setStatus("firebase", true, "Firebase conectado");

  // Fecha en sub-header
  const hoy = new Date();
  const opts = { weekday:"long", day:"numeric", month:"long", year:"numeric" };
  document.getElementById("subhdr-sub").textContent =
    hoy.toLocaleDateString("es-MX", opts) + " · Semana " + _weekNumber(hoy);
  document.getElementById("date-chip").textContent = "📅 Hoy · " + hoy.toLocaleDateString("es-MX", { day:"numeric", month:"short", year:"numeric" });

  // Iniciar sync clock
  _syncClock();

  // Iniciar toast container
  if (!document.getElementById("toast-container")) {
    const tc = document.createElement("div");
    tc.id = "toast-container";
    document.body.appendChild(tc);
  }
  window.toast = _toast;

  // Iniciar sistema de notificaciones web
  iniciarNotificaciones(
    document.getElementById("tb-notif-bell"),
    document.getElementById("tb-notif-count")
  );

  // Iniciar FCM push notifications (después de que el SW esté listo)
  setTimeout(() => iniciarFCM(), 3000);

  // Sidebar nav — event delegation con guard de descarte + ripple
  document.getElementById("sidebar").addEventListener("click", e => {
    const item = e.target.closest("[data-view]");
    if (!item) return;
    e.preventDefault();
    // Ripple
    const rect = item.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top  - size / 2;
    const ripple = document.createElement("span");
    ripple.className = "sb-ripple";
    ripple.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px`;
    item.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
    _navigateGuarded(item.dataset.view);
  });

  // Sidebar toggle (móvil ≤800px)
  const sbToggle = document.getElementById("sb-toggle");
  const sbEl = document.getElementById("sidebar");
  if (sbToggle && sbEl) {
    sbToggle.addEventListener("click", () => sbEl.classList.toggle("sb-open"));
    document.querySelectorAll(".sb-item").forEach(el =>
      el.addEventListener("click", () => sbEl.classList.remove("sb-open"))
    );
  }

  // Secciones colapsables del sidebar
  _initSidebarCollapse();

  // ── Búsqueda global ─────────────────────────────────────────
  _initGlobalSearch();

  // ── User popover ────────────────────────────────────────────
  const sbUser   = document.querySelector(".sb-user");
  const sbPop    = document.getElementById("sb-popover");
  const darkTgl  = document.getElementById("dark-toggle");
  const sbpLogout= document.getElementById("sbp-logout");

  // Sincronizar datos en el popover
  if (document.getElementById("sbp-ava"))  document.getElementById("sbp-ava").textContent  = initiales;
  if (document.getElementById("sbp-name")) document.getElementById("sbp-name").textContent = Sesion.alias;
  if (document.getElementById("sbp-role")) document.getElementById("sbp-role").textContent = Sesion.rol.replace("_"," ");

  // Abrir/cerrar popover
  if (sbUser && sbPop) {
    sbUser.style.cursor = "pointer";
    sbUser.addEventListener("click", e => {
      e.stopPropagation();
      sbPop.classList.toggle("hidden");
    });
    document.addEventListener("click", () => sbPop.classList.add("hidden"));
    sbPop.addEventListener("click", e => e.stopPropagation());
  }

  // Dark mode — persistido en localStorage por usuario
  const _dmKey = "n10_theme_" + (Sesion.uid || "default");
  const _applyTheme = dark => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    if (darkTgl) darkTgl.checked = dark;
  };
  _applyTheme(localStorage.getItem(_dmKey) === "dark");
  if (darkTgl) {
    darkTgl.addEventListener("change", () => {
      const isDark = darkTgl.checked;
      localStorage.setItem(_dmKey, isDark ? "dark" : "light");
      _applyTheme(isDark);
    });
  }

  // Preferencias desde popover
  const sbpPrefs = document.getElementById("sbp-prefs");
  if (sbpPrefs) {
    sbpPrefs.addEventListener("click", () => {
      sbPop?.classList.add("hidden");
      PreferenciasModule.abrir();
    });
  }

  // Logout desde popover
  if (sbpLogout) {
    sbpLogout.addEventListener("click", async () => {
      const ok = await window.modal({
        title: "Cerrar sesión",
        message: "¿Seguro que quieres salir? Se perderán los cambios no guardados.",
        confirmLabel: "Cerrar sesión",
        cancelLabel: "Cancelar",
        danger: true
      });
      if (ok) Auth.logout();
    });
  }

  // Prevenir cierre de pestaña con cambios pendientes
  window.addEventListener("beforeunload", e => {
    if (window.DirtyGuard?.isDirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // API global para que módulos marquen formularios sucios
  window.DirtyGuard = {
    _msg: null,
    set(msg = "Hay cambios sin guardar. ¿Salir de todas formas?") { this._msg = msg; },
    clear() { this._msg = null; },
    isDirty() { return this._msg !== null; },
    confirm() {
      if (!this._msg) return true;
      return window.confirm(this._msg);
    }
  };
}

// ── Navegación ─────────────────────────────────────────────────
function _navigateGuarded(viewId) {
  if (vistaActual === viewId) return;
  if (window.DirtyGuard?.isDirty() && !window.DirtyGuard.confirm()) return;
  window.DirtyGuard?.clear();
  _navigate(viewId);
}

function _navigate(viewId) {
  if (vistaActual === viewId) return;

  // Desmontar módulo anterior y limpiar guard
  if (vistaActual && MODULES[vistaActual]?.destroy) {
    MODULES[vistaActual].destroy();
  }
  window.DirtyGuard?.clear();
  _unsubscribers.forEach(fn => fn());
  _unsubscribers = [];

  // Sidebar active
  document.querySelectorAll(".sb-item").forEach(el => {
    el.classList.toggle("active", el.dataset.view === viewId);
  });

  // Ocultar todas las vistas, mostrar la activa
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const el = document.getElementById("view-" + viewId);
  if (el) el.classList.add("active");

  // Breadcrumb
  const bc = { dashboard:"Dashboard", mapa:"Mapa en vivo", feed:"Feed en vivo",
    ingenieros:"Ingenieros", pedidos:"Pedidos", remisiones:"Remisiones",
    cobranza:"Cobranza", usuarios:"Usuarios y flags", reportes:"Reportes",
    comisiones:"Comisiones", compras:"Órdenes de compra", kardex:"Kardex",
    cartera:"Cartera vencida", visitas:"Visitas", precios:"Precios y costos", config:"Config. tickets",
    config_intereses:"Tasas de interés",
    geocercas:"Geocercas", metas:"Metas de venta", autorizaciones:"Autorizaciones",
    formularios:"Formularios", promociones:"Recompensas y lealtad", precios_segmento:"Precios por segmento",
    productos:"Control de productos", comentarios:"Comentarios de clientes",
    inventario:"Inventario", crm:"CRM — Prospectos", logistica:"Logística de visitas",
    clientes:"Clientes", auditoria:"Auditoría", devoluciones:"Devoluciones",
    rh:"Recursos Humanos", mi_rh:"Mi RH", chat:"Chat interno",
    juridico:"Jurídico", observabilidad:"Observabilidad", manuales:"Manuales y Políticas",
    cotizaciones:"Cotizaciones", reportes_custom:"Reportes Configurables" };
  const subs = { dashboard:"Resumen del día", mapa:"Ingenieros en campo",
    feed:"Actividades globales", usuarios:"Gestión de privilegios",
    reportes:"Generación de reportes", comisiones:"Nómina e incentivos por ingeniero",
    compras:"Órdenes a proveedores", cartera:"Cartera vencida por cliente", visitas:"Programación de visitas",
    geocercas:"Zonas autorizadas en mapa", metas:"Objetivos por ingeniero",
    autorizaciones:"Aprobación de pedidos pendientes", formularios:"Plantillas de campo",
    promociones:"Campañas y puntos de lealtad", precios_segmento:"Catálogo por segmento de cliente",
    productos:"Gestión del catálogo", comentarios:"Notas y seguimiento de clientes",
    inventario:"Stock en tiempo real por producto",
    crm:"Pipeline de prospectos y conversión a clientes",
    logistica:"Visitas programadas por frecuencia de cliente",
    clientes:"Directorio y saldos por cliente", auditoria:"Registro de cambios críticos",
    devoluciones:"Gestión de devoluciones y créditos", rh:"Gestión de personal",
    mi_rh:"Mi expediente y nómina", chat:"Mensajería interna del equipo",
    juridico:"Acuerdos de congelamiento y cobranza legal",
    observabilidad:"Salud del sistema y métricas operativas",
    manuales:"Diagramas de flujo y políticas operativas",
    cotizaciones:"Cotizaciones activas y vencidas",
    reportes_custom:"Reportes con campos configurables por fuente de datos" };
  document.getElementById("tb-bc").innerHTML =
    `${bc[viewId] ?? viewId} <span>/ ${subs[viewId] ?? ""}</span>`;
  document.getElementById("subhdr-title").textContent = bc[viewId] ?? viewId;

  // Montar módulo
  const mod = MODULES[viewId];
  if (mod?.mount) {
    const unsub = mod.mount(el);
    if (typeof unsub === "function") _unsubscribers.push(unsub);
  }

  vistaActual = viewId;
}

// ── Skeleton helpers (globales para todos los módulos) ──────────
window.skeletonRows = function(n = 5, cols = 4) {
  const cell = `<td style="padding:10px 8px"><div class="skeleton" style="height:12px;border-radius:3px"></div></td>`;
  return Array.from({ length: n }, () => `<tr>${cell.repeat(cols)}</tr>`).join("");
};

window.skeletonCards = function(n = 4) {
  return Array.from({ length: n }, () => `
    <div class="skeleton" style="height:72px;border-radius:8px;flex:1;min-width:140px"></div>`).join("");
};

// ── Helpers ────────────────────────────────────────────────────
function _destroyAll() {
  if (vistaActual && MODULES[vistaActual]?.destroy) MODULES[vistaActual].destroy();
  _unsubscribers.forEach(fn => fn());
  _unsubscribers = [];
  vistaActual = null;
}

function _setStatus(key, ok, text) {
  const el = document.getElementById("st-" + key);
  if (!el) return;
  el.innerHTML = `<span class="st-dot" style="background:${ok ? "#4ADE80" : "#EF4444"}"></span> ${text}`;
}

function _syncClock() {
  let count = 0;
  setInterval(() => {
    count++;
    document.getElementById("st-sync").textContent =
      count < 60 ? `🔄 Sync: hace ${count}s` : `🔄 Sync: hace ${Math.floor(count/60)}m`;
  }, 1000);
}

function _weekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

// ── Toast ──────────────────────────────────────────────────────
function _toast(msg, type = "info") {
  const tc = document.getElementById("toast-container");
  if (!tc) return;
  const icons = { success:"✅", error:"❌", info:"ℹ️" };
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type] ?? "•"}</span> ${msg}`;
  tc.appendChild(t);
  setTimeout(() => t.remove(), type === 'error' ? 6000 : 3500);
}

// ── Simple list placeholder (módulos pendientes) ───────────────
function SimpleListModule(id, title, subtitle) {
  return {
    mount(container) {
      container.innerHTML = `
        <div style="flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;color:#9CA3AF;padding:40px">
          <div style="font-size:40px">${title.split(" ")[0]}</div>
          <div style="font-size:15px;font-weight:700;color:#374151">${title.replace(/^[^ ]+ /, "")}</div>
          <div style="font-size:12px">${subtitle} — módulo en construcción</div>
        </div>`;
    }
  };
}

// ── Búsqueda global ───────────────────────────────────────────
function _initGlobalSearch() {
  const input = document.getElementById("global-search");
  if (!input) return;

  // Dropdown container
  const dropdown = document.createElement("div");
  dropdown.id = "gs-dropdown";
  dropdown.style.cssText = `
    position:absolute; top:calc(100% + 4px); left:0; right:0;
    background:var(--surface,#fff); border:1px solid var(--border,#ddd);
    border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,.15);
    max-height:360px; overflow-y:auto; z-index:9999; display:none;
  `;
  input.parentElement.style.position = "relative";
  input.parentElement.appendChild(dropdown);

  let _timer = null;

  input.addEventListener("input", () => {
    clearTimeout(_timer);
    const q = input.value.trim();
    if (q.length < 2) { dropdown.style.display = "none"; return; }
    _timer = setTimeout(() => _runSearch(q), 300);
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Escape") { dropdown.style.display = "none"; input.value = ""; }
  });

  document.addEventListener("click", e => {
    if (!input.parentElement.contains(e.target)) dropdown.style.display = "none";
  });

  async function _runSearch(q) {
    dropdown.innerHTML = `<div style="padding:12px;color:var(--text-muted,#888);font-size:13px">Buscando…</div>`;
    dropdown.style.display = "block";

    const qUp = q.toUpperCase();
    const results = [];

    try {
      // Pedidos — buscar por folio (string range)
      const pedSnap = await getDocs(
        query(collection(db, "pedidos"),
          orderBy("folio"), startAt(qUp), endAt(qUp + ""),
          fsLimit(5))
      );
      pedSnap.forEach(d => {
        const p = d.data();
        results.push({ tipo:"Pedido", label:`#${p.folio} — ${p.clienteNombre || ""}`, sub: p.status || "", view:"pedidos", id: d.id });
      });
    } catch(_) {}

    try {
      // Clientes — buscar por nombre
      const cliSnap = await getDocs(
        query(collection(db, "clientes"),
          orderBy("nombre"), startAt(q), endAt(q + ""),
          fsLimit(5))
      );
      cliSnap.forEach(d => {
        const c = d.data();
        results.push({ tipo:"Cliente", label: c.nombre || d.id, sub: c.ciudad || "", view:"clientes", id: d.id });
      });
    } catch(_) {}

    if (results.length === 0) {
      dropdown.innerHTML = `<div style="padding:12px;color:var(--text-muted,#888);font-size:13px">Sin resultados para "${esc(q)}"</div>`;
      return;
    }

    const html = results.map(r => `
      <div class="gs-item" data-view="${esc(r.view)}" data-id="${esc(r.id)}"
        style="padding:10px 14px;cursor:pointer;display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--border,#eee);">
        <span style="font-size:11px;background:var(--accent,#1a6fb5);color:#fff;border-radius:4px;padding:2px 6px;white-space:nowrap">${esc(r.tipo)}</span>
        <span style="font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.label)}</span>
        <span style="font-size:11px;color:var(--text-muted,#888)">${esc(r.sub)}</span>
      </div>`).join("");
    dropdown.innerHTML = html;

    dropdown.querySelectorAll(".gs-item").forEach(el => {
      el.addEventListener("mouseenter", () => el.style.background = "var(--hover-bg,#f5f7fa)");
      el.addEventListener("mouseleave", () => el.style.background = "");
      el.addEventListener("click", () => {
        dropdown.style.display = "none";
        input.value = "";
        _navigateGuarded(el.dataset.view);
      });
    });
  }
}

// ── Sidebar collapsible sections ──────────────────────────────
function _initSidebarCollapse() {
  const KEY = "n10_sb_";

  document.querySelectorAll(".sb-group[data-section]").forEach(grp => {
    const section = grp.dataset.section;
    const items   = grp.nextElementSibling;
    if (!items || !items.classList.contains("sb-section-items")) return;

    // Restaurar estado guardado
    if (localStorage.getItem(KEY + section) === "1") {
      grp.classList.add("sb-collapsed");
      items.classList.add("sb-collapsed");
    }

    grp.addEventListener("click", () => {
      const closing = !grp.classList.contains("sb-collapsed");
      grp.classList.toggle("sb-collapsed");
      items.classList.toggle("sb-collapsed");
      localStorage.setItem(KEY + section, closing ? "1" : "0");
    });
  });
}

// ── Exponer navigate globalmente ───────────────────────────────
window.navigate = _navigate;

// ── Detector de red (S6 Offline resilience) ────────────────────
(function _initNetworkDetector() {
  let _banner = null;

  function _showBanner() {
    if (_banner) return;
    _banner = document.createElement("div");
    _banner.id = "offline-banner";
    _banner.style.cssText = [
      "position:fixed", "top:0", "left:0", "right:0", "z-index:9999",
      "background:#B45309", "color:#fff", "text-align:center",
      "padding:7px 16px", "font-size:12px", "font-weight:600",
      "letter-spacing:.3px", "box-shadow:0 2px 8px rgba(0,0,0,.4)",
    ].join(";");
    _banner.textContent = "⚠️  Sin conexión — mostrando datos en caché";
    document.body.prepend(_banner);
    _setStatus("firebase", false, "Sin red");
  }

  function _hideBanner() {
    _banner?.remove();
    _banner = null;
    _setStatus("firebase", true, "Firebase conectado");
  }

  window.addEventListener("offline", _showBanner);
  window.addEventListener("online",  _hideBanner);

  // Estado inicial
  if (!navigator.onLine) _showBanner();
}());

// ── Visibilidad de sidebar por rol ────────────────────────────
function _aplicarVisibilidadSidebar() {
  const SA  = Sesion.esSuperAdmin();
  const rol = Sesion.rol;
  const f   = k => Sesion.tieneFlag(k); // SA siempre true via tieneFlag

  // pv: visible si es SA o alguno de los roles dados
  const pv  = (...roles) => SA || roles.includes(rol);
  // pvF: visible si pv(...roles) O tiene el flag k
  const pvF = (k, ...roles) => pv(...roles) || f(k);

  // Mapa vista → visible
  const vis = {
    // Principal: todos
    dashboard:  true,
    mapa:       true,
    feed:       true,
    // Campo
    ingenieros:  pv("GERENTE","MESA_CONTROL","ADMINISTRADOR"),
    clientes:    pvF("PUEDE_CREAR_CLIENTES","GERENTE","MESA_CONTROL","RECUPERADOR","INGENIERO","JURIDICO","ADMINISTRADOR"),
    pedidos:     pvF("PUEDE_VER_PEDIDOS","GERENTE","MESA_CONTROL","ADMINISTRADOR"),
    remisiones:  pvF("PUEDE_REGISTRAR_REMISION","GERENTE","MESA_CONTROL","RECUPERADOR","ADMINISTRADOR"),
    cobranza:    pvF("PUEDE_REGISTRAR_ABONO","GERENTE","MESA_CONTROL","RECUPERADOR","ADMINISTRADOR"),
    // Supervisión
    comentarios: pv("GERENTE","GERENTE_ZONA","ADMINISTRADOR","MESA_CONTROL"),
    // Admin — Operaciones
    usuarios:    pv("GERENTE"),
    comisiones:  pvF("PUEDE_VER_COMISIONES","GERENTE","ADMINISTRADOR","INGENIERO"),
    compras:     pv("GERENTE","ALMACENISTA","ADMINISTRADOR"),
    kardex:      pv("GERENTE","ALMACENISTA","ADMINISTRADOR"),
    cartera:     pvF("PUEDE_VER_CARTERA_GLOBAL","GERENTE","MESA_CONTROL","RECUPERADOR","ADMINISTRADOR"),
    visitas:     pv("GERENTE","MESA_CONTROL","INGENIERO","ADMINISTRADOR"),
    cotizaciones:pv("GERENTE","MESA_CONTROL","INGENIERO","ADMINISTRADOR"),
    inventario:  pvF("PUEDE_ACCESO_STOCK","GERENTE","ALMACENISTA","ADMINISTRADOR"),
    devoluciones:pv("GERENTE","MESA_CONTROL","RECUPERADOR","ADMINISTRADOR"),
    chat:        true,
    rh:          pvF("PUEDE_VER_RH","GERENTE","ADMINISTRADOR"),
    crm:         pv("GERENTE","MESA_CONTROL","JURIDICO","ADMINISTRADOR"),
    logistica:   pv("GERENTE","MESA_CONTROL","ADMINISTRADOR"),
    juridico:        pv("GERENTE","JURIDICO","RECUPERADOR","ADMINISTRADOR"),
    observabilidad:  pv("GERENTE","ADMINISTRADOR"),
    mi_rh:           pv("INGENIERO","RECUPERADOR","ALMACENISTA"),
    // Admin — Control
    precios:          pv("GERENTE","ADMINISTRADOR"),
    geocercas:        pv("GERENTE","ADMINISTRADOR"),
    metas:            pv("GERENTE","ADMINISTRADOR"),
    autorizaciones:   pv("GERENTE","MESA_CONTROL","ADMINISTRADOR"),
    auditoria:        pv("GERENTE","ADMINISTRADOR"),
    // Admin — Configuración
    formularios:      pv("GERENTE","ADMINISTRADOR"),
    promociones:      pv("GERENTE","ADMINISTRADOR"),
    precios_segmento: pv("GERENTE","ADMINISTRADOR"),
    productos:        pvF("PUEDE_IMPORTAR_CATALOGO","GERENTE","ALMACENISTA","ADMINISTRADOR"),
    config:           pv("GERENTE","ADMINISTRADOR"),
    config_intereses: SA,  // solo SUPER_ADMIN
    reportes:         pv("GERENTE","MESA_CONTROL","ADMINISTRADOR"),
    reportes_custom:  pv("GERENTE","MESA_CONTROL","ADMINISTRADOR"),
  };

  // Aplicar visibilidad a cada sb-item
  document.querySelectorAll(".sb-item[data-view]").forEach(el => {
    const v = el.dataset.view;
    el.style.display = vis[v] !== false ? "" : "none";
  });

  // Sección Supervisión
  const supVis = pv("GERENTE","GERENTE_ZONA","ADMINISTRADOR","MESA_CONTROL");
  const $sup   = id => document.getElementById(id);
  if ($sup("sb-grupo-supervision")) $sup("sb-grupo-supervision").style.display = supVis ? "" : "none";
  if ($sup("sbi-supervision"))      $sup("sbi-supervision").style.display      = supVis ? "" : "none";

  // Sección Admin: visible si tiene al menos un item visible
  const adminVis = pv("GERENTE","ADMINISTRADOR","MESA_CONTROL","ALMACENISTA","RECUPERADOR","JURIDICO","INGENIERO");
  if ($sup("sb-admin-group")) $sup("sb-admin-group").style.display = adminVis ? "" : "none";
  if ($sup("sbi-admin"))      $sup("sbi-admin").style.display      = adminVis ? "" : "none";

  // Sublabels y divisores — ocultar si ningún item visible en su grupo
  // Operaciones: usuarios → logistica (aprox las primeras 14 entradas del sbi-admin)
  const opsViews = ["usuarios","comisiones","compras","kardex","cartera","visitas","cotizaciones","inventario","devoluciones","chat","rh","crm","logistica"];
  const ctrlViews = ["precios","geocercas","metas","autorizaciones","auditoria"];
  const cfgViews  = ["formularios","promociones","precios_segmento","productos","config","config_intereses","reportes","reportes_custom"];

  const anyVis = views => views.some(v => vis[v]);
  const showEl = (id, show) => { const e = $sup(id); if (e) e.style.display = show ? "" : "none"; };

  showEl("sb-sublabel-ops", anyVis(opsViews));
  showEl("sb-sublabel-ctrl", anyVis(ctrlViews));
  showEl("sb-div-ctrl",      anyVis(ctrlViews));
  showEl("sb-sublabel-cfg",  anyVis(cfgViews));
  showEl("sb-div-cfg",       anyVis(cfgViews));
}
