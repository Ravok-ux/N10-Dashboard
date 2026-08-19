// ══════════════════════════════════════════════════════════════
// chat.js — Mensajería interna panel ↔ APK
// Colección Firestore: `mensajes_internos`
// Canales: "GENERAL" | "MESA_CONTROL" | uid del ingeniero (hilo privado)
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import { esc } from "./app.js";
import {
  collection, doc, addDoc, onSnapshot, query,
  orderBy, limit, where, getDocs, serverTimestamp, updateDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let _unsubMensajes = null;
let _unsubCanales  = null;
let _canalActivo   = "GENERAL";

// ── Sonidos Web Audio ─────────────────────────────────────────
function _sonidoRecibir() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.18);
    ctx.close && setTimeout(() => ctx.close(), 300);
  } catch (_) {}
}

function _sonidoEnviar() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.12);
    ctx.close && setTimeout(() => ctx.close(), 250);
  } catch (_) {}
}

// ── Badge global (sidebar + topbar campana) ───────────────────
const _noLeido = {};   // { canalId: count }

function _actualizarBadge() {
  const total = Object.values(_noLeido).reduce((s, n) => s + n, 0);

  // Sidebar badge
  const sb = document.getElementById("chat-badge");
  if (sb) {
    sb.textContent = total > 99 ? "99+" : String(total);
    sb.classList.toggle("hidden", total === 0);
  }

  // Topbar campana
  const tb = document.getElementById("tb-chat-bell");
  const tc = document.getElementById("tb-chat-count");
  if (tb) tb.style.display = total > 0 ? "" : "none";
  if (tc) {
    tc.textContent = total > 99 ? "99+" : String(total);
    tc.style.display = total > 0 ? "" : "none";
  }
}

function _marcarLeido(canalId) {
  _noLeido[canalId] = 0;
  sessionStorage.setItem("chat_visto_" + canalId, String(Date.now()));
  _actualizarBadge();
}

// ── Listeners background (canales fijos) ──────────────────────
const _bgUnsubs = [];

function _iniciarBgListeners() {
  CANALES_FIJOS.forEach(c => _bgListenerCanal(c.id));
}

function _bgListenerCanal(canalId) {
  let maxTs = parseInt(sessionStorage.getItem("chat_visto_" + canalId) || "0");
  let isFirst = true;

  const q = query(
    collection(db, "mensajes_internos"),
    where("canal", "==", canalId),
    limit(100)
  );

  const unsub = onSnapshot(q, snap => {
    const ahora = snap.docs.map(d => d.data()._ts || 0);
    const nuevoMax = ahora.length ? Math.max(...ahora) : maxTs;

    if (!isFirst) {
      const nuevos = snap.docs.filter(d => {
        const ts = d.data()._ts || 0;
        return ts > maxTs && d.data().uid !== Sesion.uid;
      });
      if (nuevos.length > 0 && _canalActivo !== canalId) {
        _noLeido[canalId] = (_noLeido[canalId] || 0) + nuevos.length;
        _actualizarBadge();
        _sonidoRecibir();
      }
    }

    maxTs = nuevoMax;
    isFirst = false;
  }, err => console.warn("[Chat bg]", canalId, err));

  _bgUnsubs.push(unsub);
}

const fmtHora = ts => {
  if (!ts) return "–";
  const d = new Date(ts);
  const hoy = new Date();
  if (d.toDateString() === hoy.toDateString())
    return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) + " " +
    d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
};

const CANALES_FIJOS = [
  { id: "GENERAL",      label: "# General",      desc: "Canal abierto a todos" },
  { id: "MESA_CONTROL", label: "# Mesa de Control", desc: "Coordinación operativa" },
  { id: "ALERTAS",      label: "🔔 Alertas",     desc: "Notificaciones del sistema" },
];

export const ChatModule = {
  mount(container) {
    container.innerHTML = _html();
    _bindUI();
    _escucharCanales();
    _activarCanal("GENERAL");
    // Iniciar listeners de fondo si no están corriendo
    if (_bgUnsubs.length === 0) _iniciarBgListeners();
    return () => this.destroy();
  },
  destroy() {
    _unsubMensajes?.(); _unsubMensajes = null;
    _unsubCanales?.();  _unsubCanales  = null;
    // Los _bgUnsubs se mantienen vivos para seguir detectando mensajes nuevos
  },
  // Llamado desde app.js cuando se desmonta toda la sesión
  destroyAll() {
    _bgUnsubs.forEach(fn => fn?.());
    _bgUnsubs.length = 0;
  }
};

export function iniciarChatBg() {
  if (_bgUnsubs.length === 0) _iniciarBgListeners();
}

export function detenerChatBg() {
  _bgUnsubs.forEach(fn => fn?.());
  _bgUnsubs.length = 0;
}

// ── HTML ─────────────────────────────────────────────────────
function _html() {
  return `
  <div class="chat-layout">

    <!-- Sidebar de canales -->
    <div class="chat-sidebar">
      <div class="chat-sb-hdr">
        <span class="chat-sb-title">Canales</span>
      </div>
      <div class="chat-canal-list" id="chat-canal-list">
        ${CANALES_FIJOS.map(c => `
          <div class="chat-canal-item ${c.id === "GENERAL" ? "active" : ""}"
               data-canal="${esc(c.id)}" title="${esc(c.desc)}">
            ${esc(c.label)}
            <span class="chat-badge hidden" id="badge-${esc(c.id)}">0</span>
          </div>`).join("")}
      </div>
      <div class="chat-sb-section">Hilos directos</div>
      <div class="chat-canal-list" id="chat-directos-list">
        <div style="padding:8px 12px;font-size:11px;color:var(--text-muted)">Cargando ingenieros…</div>
      </div>
    </div>

    <!-- Área de mensajes -->
    <div class="chat-main">
      <div class="chat-main-hdr">
        <span class="chat-canal-nombre" id="chat-canal-nombre"># General</span>
        <span class="chat-canal-desc"  id="chat-canal-desc">Canal abierto a todos</span>
      </div>

      <div class="chat-mensajes" id="chat-mensajes">
        <div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px">
          Cargando mensajes…
        </div>
      </div>

      <div class="chat-input-bar">
        <textarea id="chat-input" class="chat-input" rows="1"
          placeholder="Escribe un mensaje… (Enter para enviar, Shift+Enter para nueva línea)"></textarea>
        <button class="chat-send-btn" id="chat-send">↑ Enviar</button>
      </div>
    </div>

  </div>`;
}

// ── Editar alias de usuario ───────────────────────────────────
async function _editarAlias(btn) {
  const uid     = btn.dataset.uid;
  const current = btn.dataset.current || "";
  const item    = btn.closest(".chat-canal-item");
  if (!item) return;

  // Reemplazar el ítem por un formulario inline
  const prevHTML = item.innerHTML;
  item.innerHTML = `
    <input id="chat-alias-inp" type="text" value="${esc(current)}"
      style="flex:1;padding:4px 7px;border:1.5px solid #1D5C33;border-radius:6px;
      font-size:12px;outline:none;min-width:0"
      placeholder="Nombre / alias…" maxlength="40">
    <button id="chat-alias-ok"
      style="padding:3px 9px;background:#1D5C33;color:#fff;border:none;
      border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap">OK</button>
    <button id="chat-alias-cancel"
      style="padding:3px 7px;background:none;border:1px solid #D1D5DB;
      border-radius:6px;font-size:11px;cursor:pointer">✕</button>`;

  const inp = item.querySelector("#chat-alias-inp");
  inp?.focus();
  inp?.select();

  const restore = () => { item.innerHTML = prevHTML; };

  item.querySelector("#chat-alias-cancel").onclick = restore;

  item.querySelector("#chat-alias-ok").onclick = async () => {
    const nuevoAlias = inp.value.trim();
    if (!nuevoAlias) { inp.focus(); return; }
    try {
      await updateDoc(doc(db, "usuarios", uid), { alias: nuevoAlias });
      window.toast?.(`Alias actualizado: ${nuevoAlias}`, "success");
      // El onSnapshot de _escucharCanales recargará la lista automáticamente
    } catch(e) {
      console.error("[Chat] alias:", e);
      window.toast?.("Error al guardar: " + e.message, "error");
      restore();
    }
  };

  inp?.addEventListener("keydown", e => {
    if (e.key === "Enter")  item.querySelector("#chat-alias-ok").click();
    if (e.key === "Escape") restore();
  });
}

// ── Bind UI ──────────────────────────────────────────────────
function _bindUI() {
  window._chatEditAlias = _editarAlias;
  // Click en canal
  document.getElementById("chat-canal-list")?.addEventListener("click", e => {
    const item = e.target.closest("[data-canal]");
    if (item) _activarCanal(item.dataset.canal);
  });
  document.getElementById("chat-directos-list")?.addEventListener("click", e => {
    const item = e.target.closest("[data-canal]");
    if (item) _activarCanal(item.dataset.canal, item.dataset.label);
  });

  // Enviar con Enter
  const input = document.getElementById("chat-input");
  input?.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      _enviarMensaje();
    }
  });
  // Auto-resize textarea
  input?.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  document.getElementById("chat-send")?.addEventListener("click", _enviarMensaje);
}

// ── Cargar lista de ingenieros para hilos directos ────────────
function _escucharCanales() {
  const q = query(collection(db, "usuarios"), where("activo", "==", true));
  _unsubCanales = onSnapshot(q, snap => {
    const el = document.getElementById("chat-directos-list");
    if (!el) return;
    const ingenieros = snap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .filter(u => u.uid !== Sesion.uid)
      .sort((a, b) => (a.alias || "").localeCompare(b.alias || ""));

    if (ingenieros.length === 0) {
      el.innerHTML = `<div style="padding:8px 12px;font-size:11px;color:var(--text-muted)">Sin usuarios</div>`;
      return;
    }

    const puedeEditarAlias = Sesion.esSuperAdmin?.() ||
      ["GERENTE","ADMINISTRADOR"].includes(Sesion.rol);

    el.innerHTML = ingenieros.map(u => {
      // Nombre a mostrar: alias > nombre > prefijo limpio del uid/email
      const displayName = u.alias || u.nombre ||
        (u.uid || "").replace(/@.*$/, "").replace(/[._]/g, " ").trim() || "–";
      const initials = displayName.slice(0,2).toUpperCase();
      const sinAlias = !u.alias;

      return `
      <div class="chat-canal-item" data-canal="DM_${esc(u.uid)}"
           data-label="@${esc(displayName)}" data-uid="${esc(u.uid)}">
        <span class="chat-dm-ava" style="${sinAlias ? "background:#9CA3AF" : ""}">${initials}</span>
        <span class="chat-dm-nombre">${esc(displayName)}</span>
        ${sinAlias ? `<span style="font-size:9px;color:#D97706;margin-left:2px" title="Sin alias">⚠</span>` : ""}
        <span class="chat-badge hidden" id="badge-DM_${esc(u.uid)}">0</span>
        ${puedeEditarAlias
          ? `<button class="chat-alias-edit" data-uid="${esc(u.uid)}"
               data-current="${esc(displayName)}"
               title="Editar alias" onclick="event.stopPropagation();window._chatEditAlias(this)">✏️</button>`
          : ""}
      </div>`;
    }).join("");
  }, err => console.error("[Chat] canales:", err));
}

// ── Activar canal ────────────────────────────────────────────
function _activarCanal(canalId, label = null) {
  _canalActivo = canalId;
  _marcarLeido(canalId);

  // Actualizar items activos
  document.querySelectorAll(".chat-canal-item").forEach(el => {
    el.classList.toggle("active", el.dataset.canal === canalId);
  });

  // Nombre y desc del canal
  const fijo = CANALES_FIJOS.find(c => c.id === canalId);
  const nombre = label || fijo?.label || canalId;
  const desc   = fijo?.desc || "Hilo directo";
  const el = id => document.getElementById(id);
  if (el("chat-canal-nombre")) el("chat-canal-nombre").textContent = nombre;
  if (el("chat-canal-desc"))   el("chat-canal-desc").textContent   = desc;

  _escucharMensajes(canalId);
}

// ── Listener de mensajes del canal activo ─────────────────────
function _escucharMensajes(canalId) {
  if (_unsubMensajes) { _unsubMensajes(); _unsubMensajes = null; }

  const q = query(
    collection(db, "mensajes_internos"),
    where("canal", "==", canalId),
    limit(100)
  );

  const el = document.getElementById("chat-mensajes");
  if (el) el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted)">Cargando…</div>`;

  let maxTsActivo = parseInt(sessionStorage.getItem("chat_visto_" + canalId) || "0");
  let isFirstMsj  = true;

  _unsubMensajes = onSnapshot(q, snap => {
    if (!el) return;

    // Detectar mensajes nuevos de otros (sonido al recibir, estando en el chat)
    if (!isFirstMsj) {
      const nuevos = snap.docs.filter(d => {
        const ts = d.data()._ts || 0;
        return ts > maxTsActivo && d.data().uid !== Sesion.uid;
      });
      if (nuevos.length > 0) _sonidoRecibir();
    }
    const tsArr = snap.docs.map(d => d.data()._ts || 0);
    if (tsArr.length) maxTsActivo = Math.max(...tsArr);
    isFirstMsj = false;
    if (snap.empty) {
      el.innerHTML = `<div class="chat-empty">Sé el primero en escribir en este canal.</div>`;
      return;
    }

    // Ordenar en cliente por _ts (evita índice compuesto en Firestore)
    const docs = [...snap.docs].sort((a, b) => (a.data()._ts || 0) - (b.data()._ts || 0));

    let prevAlias = null;
    el.innerHTML = docs.map(d => {
      const m = d.data();
      const esMio   = m.uid === Sesion.uid;
      const cambio  = m.alias !== prevAlias;
      prevAlias     = m.alias;
      return `
        <div class="chat-msg ${esMio ? "chat-msg-mio" : ""}" data-id="${esc(d.id)}">
          ${cambio && !esMio ? `<div class="chat-msg-alias">${esc(m.alias || "–")}</div>` : ""}
          <div class="chat-bubble ${esMio ? "chat-bubble-mio" : ""}">
            <span class="chat-texto">${esc(m.texto || "").replace(/\n/g, "<br>")}</span>
            <span class="chat-hora">${fmtHora(m._ts)}</span>
          </div>
        </div>`;
    }).join("");

    // Scroll al fondo
    el.scrollTop = el.scrollHeight;
  }, err => {
    console.error("[Chat] mensajes:", err);
    if (el) el.innerHTML = `<div class="chat-empty" style="color:#DC2626">Error al cargar mensajes</div>`;
  });
}

// ── Enviar mensaje ───────────────────────────────────────────
async function _enviarMensaje() {
  const input  = document.getElementById("chat-input");
  const texto  = input?.value.trim();
  if (!texto) return;

  input.value  = "";
  input.style.height = "auto";

  try {
    await addDoc(collection(db, "mensajes_internos"), {
      canal:     _canalActivo,
      texto,
      uid:       Sesion.uid   || "–",
      alias:     Sesion.alias || "–",
      rol:       Sesion.rol   || "–",
      timestamp: serverTimestamp(),
      _ts:       Date.now(),
    });
    _sonidoEnviar();
  } catch (e) {
    console.error("[Chat] enviar:", e);
    window.toast?.("Error al enviar: " + e.message, "error");
    if (input) input.value = texto; // restaurar si falla
  }
}
