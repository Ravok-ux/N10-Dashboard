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
  precios:      PreciosModule,
  productos:    ProductosControlModule,
  geocercas:      GeocercasModule,
  metas:          MetasModule,
  autorizaciones: AutorizacionesModule,
  formularios:    FormulariosModule,
  promociones:    PromocionesModule,
  precios_segmento: SegmentoPrecioModule,
  config:       ConfigModule,
  comentarios:  ComentariosModule,
};

let vistaActual = null;
let _unsubscribers = [];

// ── Iniciar app ────────────────────────────────────────────────
Auth.observarSesion(
  () => {
    iniciarInactivityTimer();
    _initShell();
    aplicarPrefsIniciales(Sesion.uid).then(() => {
      // Navegar a vista por defecto de prefs si existe
      const defView = Sesion.prefs?.defaultView;
      _navigate(defView && defView !== "dashboard" ? defView : "dashboard");
    }).catch(() => _navigate("dashboard"));
  },
  () => {
    detenerInactivityTimer();
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

  // Sección Admin solo para SUPER_ADMIN y GERENTE
  const isAdmin = Sesion.esSuperAdmin() || Sesion.rol === "GERENTE";
  document.querySelectorAll(".admin-only").forEach(el => {
    el.style.display = isAdmin ? "" : "none";
  });

  // Sección Comentarios: MESA_CONTROL, ADMINISTRADOR, GERENTE_ZONA, GERENTE, SUPER_ADMIN
  const puedeVerComentarios = Sesion.esSuperAdmin() ||
    ["GERENTE","GERENTE_ZONA","ADMINISTRADOR","MESA_CONTROL"].includes(Sesion.rol);
  const elCom      = document.getElementById("sb-comentarios");
  const elGrupoSup = document.getElementById("sb-grupo-supervision");
  const elSupItems = document.getElementById("sbi-supervision");
  if (elCom)      elCom.style.display      = puedeVerComentarios ? "" : "none";
  if (elGrupoSup) elGrupoSup.style.display = puedeVerComentarios ? "" : "none";
  if (elSupItems) elSupItems.style.display = puedeVerComentarios ? "" : "none";

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

  // Sidebar nav — event delegation con guard de descarte
  document.getElementById("sidebar").addEventListener("click", e => {
    const item = e.target.closest("[data-view]");
    if (!item) return;
    e.preventDefault();
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
    sbpLogout.addEventListener("click", () => {
      if (confirm("¿Seguro que quieres cerrar sesión? Se perderán los cambios no guardados.")) {
        Auth.logout?.() || import("./auth.js").then(m => m.Auth.cerrarSesion?.());
      }
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
    comisiones:"Comisiones", compras:"Órdenes de compra", precios:"Precios y costos", config:"Config. tickets",
    geocercas:"Geocercas", metas:"Metas de venta", autorizaciones:"Autorizaciones",
    formularios:"Formularios", promociones:"Recompensas y lealtad", precios_segmento:"Precios por segmento",
    productos:"Control de productos", comentarios:"Comentarios de clientes" };
  const subs = { dashboard:"Resumen del día", mapa:"Ingenieros en campo",
    feed:"Actividades globales", usuarios:"Gestión de privilegios",
    reportes:"Generación de reportes", comisiones:"Nómina e incentivos por ingeniero",
    compras:"Órdenes a proveedores",
    geocercas:"Zonas autorizadas en mapa", metas:"Objetivos por ingeniero",
    autorizaciones:"Aprobación de pedidos pendientes", formularios:"Plantillas de campo",
    promociones:"Campañas y puntos de lealtad", precios_segmento:"Catálogo por segmento de cliente",
    productos:"Gestión del catálogo", comentarios:"Notas y seguimiento de clientes" };
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
