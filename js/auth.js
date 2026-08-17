// ══════════════════════════════════════════════════════════════
// auth.js — Autenticación Firebase + sesión de usuario web
// ══════════════════════════════════════════════════════════════

import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Emails con SUPER_ADMIN automático ──────────────────────────
const EMAILS_SUPER_ADMIN = new Set([
  "josanceb@gmail.com",
  "sismas-proyectos1@outlook.com",
  "sismassistemasdos@gmail.com"
]);

// ── Estado de sesión ───────────────────────────────────────────
export const Sesion = {
  uid:    "",
  email:  "",
  alias:  "",
  rol:    "",
  flags:  {},
  esSuperAdmin() { return this.rol === "SUPER_ADMIN"; },
  tieneFlag(f)    { return this.esSuperAdmin() || this.flags[f] === true; },
  clear() { this.uid=""; this.email=""; this.alias=""; this.rol=""; this.flags={}; }
};

// ── Autenticación ──────────────────────────────────────────────
export const Auth = {

  async login() {
    const email    = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const errEl    = document.getElementById("login-error");
    const btnEl    = document.getElementById("login-btn");
    const loadEl   = document.getElementById("login-loading");

    // Validaciones básicas
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return _showLoginError("Ingresa un correo válido.");
    }
    if (!password) {
      return _showLoginError("La contraseña no puede estar vacía.");
    }

    errEl.classList.add("hidden");
    btnEl.classList.add("hidden");
    loadEl.classList.remove("hidden");

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await _cargarPerfil(cred.user);
    } catch (e) {
      btnEl.classList.remove("hidden");
      loadEl.classList.add("hidden");
      const msgs = {
        "auth/invalid-credential":      "Correo o contraseña incorrectos.",
        "auth/user-not-found":          "No existe una cuenta con ese correo.",
        "auth/wrong-password":          "Contraseña incorrecta.",
        "auth/too-many-requests":       "Demasiados intentos. Espera unos minutos.",
        "auth/user-disabled":           "Esta cuenta está deshabilitada.",
        "auth/network-request-failed":  "Sin conexión a internet. Revisa tu red.",
        "auth/internal-error":          "Error interno. Intenta de nuevo."
      };
      _showLoginError(msgs[e.code] ?? `Error: ${e.message}`);
    }
  },

  async logout() {
    if (!confirm("¿Seguro que quieres cerrar sesión? Se perderán los cambios no guardados.")) return;
    await signOut(auth);
    Sesion.clear();
    _mostrarLogin();
    window.toast?.("Sesión cerrada", "info");
  },

  // Llamado por app.js al iniciar
  observarSesion(onLogin, onLogout) {
    let primeraVez = true;
    onAuthStateChanged(auth, async user => {
      if (user) {
        try {
          await _cargarPerfil(user);
        } catch (e) {
          console.error("[auth] Error cargando perfil:", e);
          window.manejarErrorFirestore?.(e);
          primeraVez = false;
          onLogout();
          return;
        }
        primeraVez = false;
        onLogin();
      } else {
        if (!primeraVez) {
          // Sesión terminada mientras el usuario estaba activo
          _mostrarModalSesionExpirada();
        }
        primeraVez = false;
        onLogout();
      }
    });
  }
};

// ── Interceptor global de errores Firestore ────────────────────
// Los módulos llaman window.manejarErrorFirestore(err) en sus catch.
// Si el error es de autenticación o permisos, fuerza re-login.
window.manejarErrorFirestore = function(err) {
  const codigo = err?.code ?? "";
  if (codigo === "permission-denied" || codigo === "unauthenticated") {
    signOut(auth).catch(() => {});
    Sesion.clear();
    _mostrarLogin();
    _mostrarModalSesionExpirada();
    return true; // fue manejado
  }
  return false; // error normal, el módulo puede mostrar su toast
};

// Exponer globalmente para onclick inline
window.Auth = Auth;

// ── Inactivity timeout (30 min) ────────────────────────────────
const TIMEOUT_MS = 30 * 60 * 1000;
let _inactivityTimer = null;

function _resetTimer() {
  clearTimeout(_inactivityTimer);
  _inactivityTimer = setTimeout(() => {
    signOut(auth);
    Sesion.clear();
    _mostrarLogin();
    window.toast?.("Sesión cerrada por inactividad", "warning");
  }, TIMEOUT_MS);
}

export function iniciarInactivityTimer() {
  ["mousemove","keydown","pointerdown","scroll"].forEach(ev =>
    document.addEventListener(ev, _resetTimer, { passive: true })
  );
  _resetTimer();
}

export function detenerInactivityTimer() {
  clearTimeout(_inactivityTimer);
  ["mousemove","keydown","pointerdown","scroll"].forEach(ev =>
    document.removeEventListener(ev, _resetTimer)
  );
}

// ── Internos ──────────────────────────────────────────────────
async function _cargarPerfil(user) {
  const ref  = doc(db, "usuarios", user.uid);
  const snap = await getDoc(ref);

  const esSA = EMAILS_SUPER_ADMIN.has(user.email);

  if (!snap.exists()) {
    // Primer login: crear perfil
    const perfil = {
      email:    user.email,
      alias:    user.email.split("@")[0],
      rol:      esSA ? "SUPER_ADMIN" : "INGENIERO",
      activo:   true,
      flags:    _flagsDefault(esSA),
      creadoEn: serverTimestamp()
    };
    await setDoc(ref, perfil);
    _aplicarSesion(user.uid, user.email, perfil);
  } else {
    const data = snap.data();
    if (!data.activo) {
      await signOut(auth);
      _showLoginError("Tu cuenta está desactivada. Contacta al administrador.");
      return;
    }
    // Garantizar SUPER_ADMIN a emails predefinidos
    if (esSA && data.rol !== "SUPER_ADMIN") {
      await setDoc(ref, { rol: "SUPER_ADMIN" }, { merge: true });
      data.rol = "SUPER_ADMIN";
    }
    _aplicarSesion(user.uid, user.email, data);
  }
}

function _aplicarSesion(uid, email, data) {
  Sesion.uid   = uid;
  Sesion.email = email;
  Sesion.alias = data.alias || email.split("@")[0];
  Sesion.rol   = data.rol   || "INGENIERO";
  Sesion.flags = data.flags || {};
}

function _flagsDefault(esSuperAdmin) {
  if (esSuperAdmin) {
    return {
      PUEDE_EDITAR_PRECIO:      true,
      PUEDE_CANCELAR_PEDIDO:    true,
      PUEDE_VER_CARTERA_GLOBAL: true,
      PUEDE_IMPORTAR_CATALOGO:  true,
      PUEDE_EXPORTAR_BACKUP:    true,
      PUEDE_REGISTRAR_REMISION: true,
      PUEDE_REGISTRAR_ABONO:    true
    };
  }
  return {
    PUEDE_EDITAR_PRECIO:      false,
    PUEDE_CANCELAR_PEDIDO:    false,
    PUEDE_VER_CARTERA_GLOBAL: false,
    PUEDE_IMPORTAR_CATALOGO:  false,
    PUEDE_EXPORTAR_BACKUP:    false,
    PUEDE_REGISTRAR_REMISION: true,
    PUEDE_REGISTRAR_ABONO:    true
  };
}

function _mostrarModalSesionExpirada() {
  // Evitar duplicados
  if (document.getElementById("modal-sesion-expirada")) return;
  const m = document.createElement("div");
  m.id = "modal-sesion-expirada";
  m.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;
    display:flex;align-items:center;justify-content:center;padding:20px`;
  m.innerHTML = `
    <div style="background:var(--c-surface,#1a1d27);border:1px solid #EF444455;border-radius:12px;
      padding:28px 32px;max-width:380px;width:100%;text-align:center">
      <div style="font-size:32px;margin-bottom:12px">🔐</div>
      <div style="font-size:15px;font-weight:700;color:#E6EDF3;margin-bottom:8px">Sesión terminada</div>
      <div style="font-size:13px;color:#8B949E;margin-bottom:20px;line-height:1.55">
        Tu sesión ha caducado o fue cerrada desde otro dispositivo.<br>
        Inicia sesión de nuevo para continuar.
      </div>
      <button onclick="document.getElementById('modal-sesion-expirada').remove()"
        style="background:#166534;border:1px solid #16A34A;border-radius:7px;padding:9px 24px;
          font-size:13px;font-weight:700;color:#4ADE80;cursor:pointer;width:100%">
        Ir al inicio de sesión
      </button>
    </div>`;
  document.body.appendChild(m);
}

function _showLoginError(msg) {
  const el = document.getElementById("login-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function _mostrarLogin() {
  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("login-password").value = "";
  document.getElementById("login-error").classList.add("hidden");
  document.getElementById("login-btn").classList.remove("hidden");
  document.getElementById("login-loading").classList.add("hidden");
}
