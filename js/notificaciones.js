// ══════════════════════════════════════════════════════════════
// notificaciones.js — Centro de notificaciones web en tiempo real
// Fuente: colección `notificaciones_web` en Firestore
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import { esc } from "./app.js";
import {
  collection, query, where, orderBy, limit,
  onSnapshot, updateDoc, doc, writeBatch, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let _unsub   = null;
let _bellEl  = null;
let _panelEl = null;
let _countEl = null;
let _lista   = [];

// ── Tipos y sus configuraciones visuales ──────────────────────
const TIPOS = {
  COTIZACION_NUEVA:       { icon: "📋", color: "#7C3AED", label: "Nueva cotización"        },
  COTIZACION_APROBADA:    { icon: "✅", color: "#16A34A", label: "Cotización aprobada"      },
  COTIZACION_RECHAZADA:   { icon: "❌", color: "#DC2626", label: "Cotización rechazada"     },
  PEDIDO_URGENTE:         { icon: "🚨", color: "#DC2626", label: "Pedido urgente"           },
  SOLICITUD_VISITA:       { icon: "📍", color: "#2563EB", label: "Solicitud de visita"      },
  DEVOLUCION_SOLICITADA:  { icon: "↩️",  color: "#D97706", label: "Solicitud de devolución" },
  DEVOLUCION_APROBADA:    { icon: "✅", color: "#16A34A", label: "Devolución aprobada"      },
  DEVOLUCION_RECHAZADA:   { icon: "❌", color: "#DC2626", label: "Devolución rechazada"     },
  STOCK_CRITICO:          { icon: "⚠️",  color: "#D97706", label: "Stock crítico"           },
  ALERTA_COBRANZA:        { icon: "💰", color: "#DC2626", label: "Cobranza vencida"         },
  GENERAL:                { icon: "🔔", color: "#6B7280", label: "Notificación"             },
};

// ── Inicializar el sistema de notificaciones ──────────────────
export function iniciarNotificaciones(bellEl, countEl) {
  _bellEl  = bellEl;
  _countEl = countEl;

  if (!Sesion.uid) return;

  // Query: notificaciones para este usuario o broadcast (destinatario = uid o "TODOS")
  const q = query(
    collection(db, "notificaciones_web"),
    where("destinatarios", "array-contains-any", [Sesion.uid, "TODOS"]),
    orderBy("timestamp", "desc"),
    limit(50)
  );

  _unsub = onSnapshot(q, snap => {
    _lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderCount();
    _renderPanel();
  }, err => console.error("[Notificaciones]", err));

  // Abrir/cerrar panel al clicar el botón
  if (_bellEl) _bellEl.addEventListener("click", _togglePanel);
}

export function detenerNotificaciones() {
  if (_unsub) { _unsub(); _unsub = null; }
  if (_panelEl) _panelEl.remove();
  _panelEl = null;
}

// ── Badge con contador de no leídas ──────────────────────────
function _renderCount() {
  const noLeidas = _lista.filter(n => !n.leida).length;
  if (!_countEl) return;
  _countEl.textContent = noLeidas > 99 ? "99+" : String(noLeidas);
  _countEl.style.display = noLeidas > 0 ? "flex" : "none";
}

// ── Panel desplegable ─────────────────────────────────────────
function _getOrCreatePanel() {
  if (_panelEl && document.contains(_panelEl)) return _panelEl;

  _panelEl = document.createElement("div");
  _panelEl.id = "notif-panel";
  _panelEl.innerHTML = `
    <div class="notif-header">
      <span class="notif-title">Notificaciones</span>
      <button class="notif-mark-all" id="notif-mark-all">Marcar todas leídas</button>
    </div>
    <div class="notif-list" id="notif-list"></div>`;

  document.body.appendChild(_panelEl);

  document.getElementById("notif-mark-all")?.addEventListener("click", _marcarTodasLeidas);

  // Cerrar al clicar fuera
  document.addEventListener("click", _clickFuera);
  return _panelEl;
}

function _togglePanel(e) {
  e.stopPropagation();
  const panel = _getOrCreatePanel();
  const visible = panel.classList.toggle("visible");
  if (visible) _renderPanel();
}

function _clickFuera(e) {
  if (_panelEl && !_panelEl.contains(e.target) && e.target !== _bellEl) {
    _panelEl.classList.remove("visible");
  }
}

function _renderPanel() {
  const listEl = document.getElementById("notif-list");
  if (!listEl) return;

  if (_lista.length === 0) {
    listEl.innerHTML = `<div class="notif-empty">Sin notificaciones</div>`;
    return;
  }

  listEl.innerHTML = _lista.map(n => {
    const cfg  = TIPOS[n.tipo] || TIPOS.GENERAL;
    const ts   = _tiempoRelativo(n.timestamp?.toMillis?.() || n._ts || 0);
    const cls  = n.leida ? "notif-item leida" : "notif-item";
    return `
      <div class="${cls}" data-id="${esc(n.id)}" style="border-left-color:${cfg.color}">
        <div class="notif-icon">${cfg.icon}</div>
        <div class="notif-body">
          <div class="notif-label">${esc(cfg.label)}</div>
          <div class="notif-msg">${esc(n.mensaje || "")}</div>
          <div class="notif-ts">${ts}</div>
        </div>
        ${n.accion ? `<button class="notif-go" data-view="${esc(n.accion.vista || '')}" data-id="${esc(n.accion.id || '')}">Ver →</button>` : ""}
      </div>`;
  }).join("");

  // Marcar leída al clicar
  listEl.querySelectorAll(".notif-item").forEach(el => {
    el.addEventListener("click", () => _marcarLeida(el.dataset.id));
  });

  // Botones de acción
  listEl.querySelectorAll(".notif-go").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      _marcarLeida(btn.closest(".notif-item").dataset.id);
      _panelEl?.classList.remove("visible");
      const vista = btn.dataset.view;
      if (vista) window.navigate?.(vista);
    });
  });
}

// ── CRUD ─────────────────────────────────────────────────────
async function _marcarLeida(id) {
  if (!id) return;
  try {
    await updateDoc(doc(db, "notificaciones_web", id), { leida: true });
  } catch (e) {
    console.error("[Notif] marcarLeida:", e);
    window.toast?.("No se pudo marcar como leída.", "error");
  }
}

async function _marcarTodasLeidas() {
  const noLeidas = _lista.filter(n => !n.leida);
  if (noLeidas.length === 0) return;
  const batch = writeBatch(db);
  noLeidas.forEach(n => batch.update(doc(db, "notificaciones_web", n.id), { leida: true }));
  await batch.commit().catch(e => console.error("[Notif] marcarTodas:", e));
}

// ── Helper tiempo relativo ───────────────────────────────────
function _tiempoRelativo(ms) {
  if (!ms) return "—";
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 60)   return "Hace " + diff + "s";
  if (diff < 3600) return "Hace " + Math.floor(diff / 60) + " min";
  if (diff < 86400) return "Hace " + Math.floor(diff / 3600) + "h";
  return new Date(ms).toLocaleDateString("es-MX");
}

// ── API pública: escribir una notificación desde el panel ────
// (La mayoría las escriben las Cloud Functions)
export async function crearNotificacion({ tipo, mensaje, destinatarios = ["TODOS"], accion = null }) {
  const { addDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  return addDoc(collection(db, "notificaciones_web"), {
    tipo,
    mensaje,
    destinatarios,
    accion,
    leida: false,
    timestamp: serverTimestamp(),
    _ts: Date.now(),
    creadaPor: Sesion.uid || "SISTEMA",
  });
}
