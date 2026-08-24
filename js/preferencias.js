// ══════════════════════════════════════════════════════════════
// preferencias.js — Preferencias de usuario: perfil, módulos, campo
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import {
  doc, updateDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Catálogos ─────────────────────────────────────────────────

const MODULOS = [
  { key: "mapa",        label: "🗺 Mapa en vivo" },
  { key: "feed",        label: "📡 Feed en vivo" },
  { key: "ingenieros",  label: "👷 Ingenieros" },
  { key: "pedidos",     label: "📦 Pedidos" },
  { key: "remisiones",  label: "🚚 Remisiones" },
  { key: "cobranza",    label: "💰 Cobranza" },
  { key: "reportes",    label: "📈 Reportes" },
  { key: "comentarios", label: "💬 Comentarios" },
];

const COLORES = [
  { val: "#1D5C33", label: "Forestal" },
  { val: "#1565C0", label: "Azul" },
  { val: "#B91C1C", label: "Rojo" },
  { val: "#7C3AED", label: "Violeta" },
  { val: "#D97706", label: "Ámbar" },
  { val: "#FF1695", label: "Rosa" },
  { val: "#374151", label: "Grafito" },
];

const VISTAS = [
  { val: "dashboard",  label: "📊 Dashboard" },
  { val: "mapa",       label: "🗺 Mapa en vivo" },
  { val: "feed",       label: "📡 Feed" },
  { val: "pedidos",    label: "📦 Pedidos" },
  { val: "remisiones", label: "🚚 Remisiones" },
];

const CHIPS_APK = [
  { key: "chipPromesaVencida",   label: "💰 Promesa vencida" },
  { key: "chipAudienciaHoy",     label: "⚖️ Audiencia hoy" },
  { key: "chipAcuerdoVence",     label: "📋 Acuerdo vence" },
  { key: "chipSinContacto",      label: "🔁 Sin contacto" },
  { key: "chipSinVisitaReciente",label: "⏰ Sin visitar" },
  { key: "chipNuevosHoy",        label: "🆕 Nuevos hoy" },
  { key: "chipConFotos",         label: "📷 Con fotos" },
];

// ── Módulo principal ──────────────────────────────────────────

export const PreferenciasModule = {

  async abrir() {
    try {
      const ref  = doc(db, "usuarios", Sesion.uid);
      const snap = await getDoc(ref);
      const prefs = snap.exists() ? (snap.data().prefs || {}) : {};
      _render(prefs);
    } catch (e) {
      console.error("[prefs]", e);
      window.toast?.("No se pudo cargar preferencias", "error");
    }
  }
};

// ── Render ────────────────────────────────────────────────────

function _render(p) {
  document.getElementById("prefs-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id    = "prefs-overlay";
  overlay.className = "modal-overlay";
  overlay.innerHTML = _html(p);
  document.body.appendChild(overlay);

  _bindEvents(overlay, p);
}

function _html(p) {
  const hidden      = p.hiddenModules  || [];
  const color       = p.avatarColor    || "#1D5C33";
  const density     = p.listDensity    || "normal";
  const activeChips = p.activeChips    || [];
  const defView     = p.defaultView    || "dashboard";
  const defName     = p.displayName    || Sesion.alias || "";

  return `
  <div class="prefs-modal" role="dialog" aria-modal="true" aria-label="Preferencias">
    <div class="prefs-hdr">
      <span class="prefs-title">⚙ Mis preferencias</span>
      <button class="prefs-x" id="prefs-x" aria-label="Cerrar">✕</button>
    </div>

    <div class="prefs-body">

      <!-- ── PERFIL ── -->
      <section class="prefs-sec">
        <div class="prefs-sec-title">👤 Perfil</div>

        <label class="prefs-label">Nombre de pantalla</label>
        <input  class="prefs-input" id="prefs-name" type="text"
          placeholder="${Sesion.alias}" value="${esc(defName)}">
        <div class="prefs-hint">Reemplaza tu email en la barra lateral y encabezado.</div>

        <label class="prefs-label" style="margin-top:14px">Color de avatar</label>
        <div class="prefs-color-grid" id="prefs-color-grid">
          ${COLORES.map(c => `
            <button class="prefs-swatch ${color === c.val ? 'sel' : ''}"
              data-color="${c.val}" style="background:${c.val}"
              title="${c.label}" aria-pressed="${color === c.val}">
              ${color === c.val ? "✓" : ""}
            </button>`).join("")}
        </div>
      </section>

      <!-- ── VISTA INICIAL ── -->
      <section class="prefs-sec">
        <div class="prefs-sec-title">🏠 Vista al iniciar sesión</div>
        <div class="prefs-radio-grid">
          ${VISTAS.map(v => `
            <label class="prefs-radio-item">
              <input type="radio" name="defView" value="${v.val}"
                ${defView === v.val ? "checked" : ""}>
              <span>${v.label}</span>
            </label>`).join("")}
        </div>
      </section>

      <!-- ── MÓDULOS ── -->
      <section class="prefs-sec">
        <div class="prefs-sec-title">📋 Módulos visibles en el menú</div>
        <div class="prefs-hint">Dashboard siempre visible. Oculta lo que no uses en tu rol.</div>
        <div class="prefs-checks-grid">
          ${MODULOS.map(m => `
            <label class="prefs-check-item">
              <input type="checkbox" class="mod-chk" value="${m.key}"
                ${!hidden.includes(m.key) ? "checked" : ""}>
              <span>${m.label}</span>
            </label>`).join("")}
        </div>
      </section>

      <!-- ── CAMPO (APK) ── -->
      <section class="prefs-sec">
        <div class="prefs-sec-title">
          📱 Preferencias de campo
          <span class="prefs-badge">Solo APK</span>
        </div>

        <label class="prefs-label">Zona por defecto (filtro inicial)</label>
        <input class="prefs-input" id="prefs-zona" type="text"
          placeholder="Ej: Norte, Centro…" value="${esc(p.defaultZona || "")}">

        <label class="prefs-label" style="margin-top:14px">Densidad de lista</label>
        <div class="prefs-density-row">
          ${["compact","normal","spacious"].map((d, i) => `
            <button class="prefs-density-btn ${density === d ? "active" : ""}"
              data-density="${d}">
              ${ ["Compacta","Normal","Espaciada"][i] }
            </button>`).join("")}
        </div>

        <label class="prefs-label" style="margin-top:14px">Chips activos al abrir la app</label>
        <div class="prefs-checks-grid">
          ${CHIPS_APK.map(c => `
            <label class="prefs-check-item">
              <input type="checkbox" class="chip-chk" value="${c.key}"
                ${activeChips.includes(c.key) ? "checked" : ""}>
              <span>${c.label}</span>
            </label>`).join("")}
        </div>
      </section>

    </div><!-- /prefs-body -->

    <div class="prefs-footer">
      <button class="btn-secondary" id="prefs-cancel">Cancelar</button>
      <button class="prefs-save-btn" id="prefs-save">💾 Guardar preferencias</button>
    </div>
  </div>`;
}

// ── Eventos ───────────────────────────────────────────────────

function _bindEvents(overlay, _p) {
  const close = () => overlay.remove();

  overlay.querySelector("#prefs-x").addEventListener("click", close);
  overlay.querySelector("#prefs-cancel").addEventListener("click", close);
  overlay.addEventListener("click", e => { if (e.target === overlay) close(); });

  // Swatches de color
  overlay.querySelectorAll(".prefs-swatch").forEach(btn => {
    btn.addEventListener("click", () => {
      overlay.querySelectorAll(".prefs-swatch").forEach(b => {
        b.classList.remove("sel"); b.textContent = ""; b.setAttribute("aria-pressed","false");
      });
      btn.classList.add("sel"); btn.textContent = "✓"; btn.setAttribute("aria-pressed","true");
    });
  });

  // Densidad
  overlay.querySelectorAll(".prefs-density-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      overlay.querySelectorAll(".prefs-density-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  // Guardar
  overlay.querySelector("#prefs-save").addEventListener("click", () => _guardar(overlay));
}

// ── Guardar ───────────────────────────────────────────────────

async function _guardar(overlay) {
  const btn = overlay.querySelector("#prefs-save");
  btn.disabled  = true;
  btn.textContent = "Guardando…";

  const displayName = overlay.querySelector("#prefs-name").value.trim();
  const avatarColor = overlay.querySelector(".prefs-swatch.sel")?.dataset.color || "#1D5C33";
  const defaultView = overlay.querySelector("[name='defView']:checked")?.value  || "dashboard";
  const defaultZona = overlay.querySelector("#prefs-zona").value.trim();
  const listDensity = overlay.querySelector(".prefs-density-btn.active")?.dataset.density || "normal";

  const hiddenModules = [];
  overlay.querySelectorAll(".mod-chk").forEach(cb => { if (!cb.checked) hiddenModules.push(cb.value); });

  const activeChips = [];
  overlay.querySelectorAll(".chip-chk").forEach(cb => { if (cb.checked) activeChips.push(cb.value); });

  const prefs = { displayName, avatarColor, defaultView, hiddenModules, defaultZona, listDensity, activeChips };

  try {
    await updateDoc(doc(db, "usuarios", Sesion.uid), { prefs });
    Sesion.prefs = prefs;
    localStorage.setItem("n10_prefs_" + Sesion.uid, JSON.stringify(prefs));
    _aplicarPrefsUI(prefs);
    window.toast?.("Preferencias guardadas", "success");
    overlay.remove();
  } catch (e) {
    console.error("[prefs]", e);
    window.toast?.("Error al guardar. Intenta de nuevo.", "error");
    btn.disabled = false;
    btn.textContent = "💾 Guardar preferencias";
  }
}

// ── Aplicar prefs a la UI ─────────────────────────────────────

function _aplicarPrefsUI(p) {
  if (!p) return;

  // Nombre de pantalla
  const shown = (p.displayName || "").trim() || Sesion.alias;
  const ini   = shown.slice(0, 2).toUpperCase();
  ["sb-uname","tb-uname","sbp-name"].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = shown;
  });
  ["sb-ava","tb-ava","sbp-ava"].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = ini;
  });

  // Color de avatar
  if (p.avatarColor) {
    document.querySelectorAll(".sb-ava,.tb-ava,.sbp-ava").forEach(el => {
      el.style.background = p.avatarColor;
    });
  }

  // Módulos ocultos
  if (Array.isArray(p.hiddenModules)) {
    document.querySelectorAll(".sb-item[data-view]").forEach(el => {
      const v = el.dataset.view;
      if (!v || v === "dashboard") return;
      el.style.display = p.hiddenModules.includes(v) ? "none" : "";
    });
  }
}

// ── Carga en inicio de sesión (llamado desde app.js) ──────────

export async function aplicarPrefsIniciales(uid) {
  // Cache local primero (offline)
  try {
    const cached = localStorage.getItem("n10_prefs_" + uid);
    if (cached) {
      const p = JSON.parse(cached);
      _aplicarPrefsUI(p);
      Sesion.prefs = p;
    }
  } catch (_) { /* ignore */ }

  // Luego Firestore (puede llegar después)
  try {
    const snap = await getDoc(doc(db, "usuarios", uid));
    if (snap.exists()) {
      const p = snap.data().prefs || {};
      _aplicarPrefsUI(p);
      Sesion.prefs = p;
      localStorage.setItem("n10_prefs_" + uid, JSON.stringify(p));
    }
  } catch (e) {
    console.warn("[prefs] Firestore no disponible, usando cache:", e.message);
  }
}

// ── Helper XSS ────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
