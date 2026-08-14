// ══════════════════════════════════════════════════════════════
// comentarios.js — Bitácora de comentarios y notas por cliente
// Visible: MESA_CONTROL, ADMINISTRADOR, GERENTE_ZONA, GERENTE, SUPER_ADMIN
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import { esc } from "./app.js";
import {
  collection, query, orderBy, limit, where,
  onSnapshot, addDoc, serverTimestamp, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let _unsubs = [];
let _filtroAlias  = "TODOS";
let _filtroTipo   = "TODOS";
let _busqueda     = "";
let _ultimoSnap   = null;
let _ultimoSnapLog = null;

const TIPOS_LABEL = {
  TODOS:             "Todos",
  COMENTARIO_MANUAL: "Comentarios",
  VISITA_REGISTRADA: "Visitas",
  VISITA_SOSPECHOSA: "Visitas sospechosas",
  CONGELAMIENTO:     "Congelamientos",
  ACUERDO_CONGELAMIENTO: "Acuerdos",
  PROMESA_PAGO:      "Promesas de pago",
  EDICION:           "Ediciones",
  VISITA:            "Visitas (log)"
};

export const ComentariosModule = {
  mount(container) {
    if (!_puedeVer()) {
      container.innerHTML = `<div style="padding:40px;text-align:center;color:#9CA3AF">
        Sin acceso a este módulo.</div>`;
      return () => {};
    }
    container.innerHTML = _html();
    _bindUI();
    _escuchar();
    return () => this.destroy();
  },
  destroy() {
    _unsubs.forEach(fn => fn?.());
    _unsubs = [];
    _filtroAlias = "TODOS";
    _filtroTipo  = "TODOS";
    _busqueda    = "";
    _ultimoSnap  = null;
    _ultimoSnapLog = null;
  }
};

// ── Control de acceso ─────────────────────────────────────────
function _puedeVer() {
  return Sesion.esSuperAdmin() ||
    ["GERENTE","GERENTE_ZONA","ADMINISTRADOR","MESA_CONTROL"].includes(Sesion.rol);
}
function _puedeEscribir() {
  return Sesion.esSuperAdmin() ||
    ["GERENTE","GERENTE_ZONA","ADMINISTRADOR","MESA_CONTROL"].includes(Sesion.rol);
}

// ── HTML ──────────────────────────────────────────────────────
function _html() {
  return `
  <div style="display:flex;flex-direction:column;height:100%;overflow:hidden">

    <!-- Barra de herramientas -->
    <div style="background:var(--c-surface);border-bottom:1px solid var(--c-border);
      padding:10px 18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0">

      <input id="com-busqueda" type="text" placeholder="🔍 Buscar cliente, alias o nota…"
        oninput="ComentariosUI.buscar(this.value)"
        style="border:1px solid var(--c-border);border-radius:6px;padding:5px 10px;
          font-size:12px;flex:1;min-width:160px;background:var(--c-surface2);color:var(--c-text)" />

      <select id="com-alias" onchange="ComentariosUI.filtrarAlias(this.value)"
        style="border:1px solid var(--c-border);border-radius:6px;padding:5px 8px;
          font-size:12px;background:var(--c-surface2);color:var(--c-text)">
        <option value="TODOS">Todos los usuarios</option>
      </select>

      <select id="com-tipo" onchange="ComentariosUI.filtrarTipo(this.value)"
        style="border:1px solid var(--c-border);border-radius:6px;padding:5px 8px;
          font-size:12px;background:var(--c-surface2);color:var(--c-text)">
        ${Object.entries(TIPOS_LABEL).map(([k,v]) =>
          `<option value="${k}">${v}</option>`).join("")}
      </select>

      <span id="com-count" style="font-size:11px;color:#9CA3AF;white-space:nowrap">– registros</span>
    </div>

    <!-- Panel dividido: lista izquierda + formulario nuevo comentario derecha -->
    <div style="flex:1;display:flex;overflow:hidden;gap:0">

      <!-- Lista de comentarios -->
      <div id="com-lista" style="flex:1;overflow-y:auto;padding:14px 18px">
        <div style="text-align:center;padding:24px;color:#9CA3AF;font-size:12px">Cargando…</div>
      </div>

      <!-- Panel de nuevo comentario (solo roles con permiso) -->
      ${_puedeEscribir() ? `
      <div style="width:280px;flex-shrink:0;border-left:1px solid var(--c-border);
        padding:16px;overflow-y:auto;background:var(--c-surface2)">

        <div style="font-size:11px;font-weight:700;color:var(--c-text);
          letter-spacing:.05em;margin-bottom:12px">AGREGAR COMENTARIO</div>

        <div style="margin-bottom:8px">
          <label style="font-size:11px;color:#9CA3AF;display:block;margin-bottom:4px">
            Nombre / ID del cliente</label>
          <input id="com-new-cliente" type="text" placeholder="Nombre del cliente…"
            style="width:100%;border:1px solid var(--c-border);border-radius:6px;
              padding:6px 8px;font-size:12px;background:var(--c-surface);color:var(--c-text);
              box-sizing:border-box" />
        </div>

        <div style="margin-bottom:8px">
          <label style="font-size:11px;color:#9CA3AF;display:block;margin-bottom:4px">
            Comentario / nota</label>
          <textarea id="com-new-texto" rows="5" placeholder="Escribe aquí el comentario o nota sobre el cliente…"
            style="width:100%;border:1px solid var(--c-border);border-radius:6px;
              padding:6px 8px;font-size:12px;background:var(--c-surface);color:var(--c-text);
              resize:vertical;box-sizing:border-box"></textarea>
        </div>

        <div style="margin-bottom:12px">
          <label style="font-size:11px;color:#9CA3AF;display:block;margin-bottom:4px">
            Categoría</label>
          <select id="com-new-categoria"
            style="width:100%;border:1px solid var(--c-border);border-radius:6px;
              padding:6px 8px;font-size:12px;background:var(--c-surface);color:var(--c-text)">
            <option value="SEGUIMIENTO">Seguimiento</option>
            <option value="ACUERDO">Acuerdo</option>
            <option value="RIESGO">Riesgo</option>
            <option value="INFORMACION">Información</option>
            <option value="ALERTA">Alerta</option>
          </select>
        </div>

        <button onclick="ComentariosUI.guardarComentario()"
          style="width:100%;padding:8px;background:#166534;color:#fff;border:none;
            border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">
          Guardar comentario
        </button>

        <div id="com-new-msg" style="font-size:11px;margin-top:8px;text-align:center"></div>
      </div>` : ""}
    </div>
  </div>`;
}

// ── Bind UI ───────────────────────────────────────────────────
function _bindUI() {
  window.ComentariosUI = {
    buscar(val) {
      _busqueda = val.toLowerCase();
      _render();
    },
    filtrarAlias(val) {
      _filtroAlias = val;
      _render();
    },
    filtrarTipo(val) {
      _filtroTipo = val;
      _render();
    },
    async guardarComentario() {
      const cliente  = document.getElementById("com-new-cliente")?.value.trim();
      const texto    = document.getElementById("com-new-texto")?.value.trim();
      const categoria = document.getElementById("com-new-categoria")?.value;
      const msgEl    = document.getElementById("com-new-msg");

      if (!cliente || !texto) {
        if (msgEl) { msgEl.textContent = "Completa el cliente y el comentario."; msgEl.style.color = "#DC2626"; }
        return;
      }
      if (texto.length > 1000) {
        if (msgEl) { msgEl.textContent = "El comentario supera 1000 caracteres."; msgEl.style.color = "#DC2626"; }
        return;
      }
      // Sanitizar antes de guardar en Firestore
      const clienteSan = cliente.replace(/[<>"'&]/g, "").substring(0, 100);
      const textoSan   = texto.replace(/[<>"']/g, "").substring(0, 1000);

      try {
        await addDoc(collection(db, "comentarios_cliente"), {
          clienteNombre: clienteSan,
          texto:         textoSan,
          categoria:     categoria,
          alias:         Sesion.alias,
          rol:           Sesion.rol,
          uid:           Sesion.uid,
          tipoAccion:    "COMENTARIO_MANUAL",
          timestamp:     serverTimestamp()
        });
        document.getElementById("com-new-cliente").value = "";
        document.getElementById("com-new-texto").value   = "";
        if (msgEl) { msgEl.textContent = "✓ Comentario guardado."; msgEl.style.color = "#16A34A"; }
        setTimeout(() => { if (msgEl) msgEl.textContent = ""; }, 3000);
      } catch (e) {
        console.error("[Comentarios]", e);
        if (msgEl) { msgEl.textContent = "Error al guardar: " + e.message; msgEl.style.color = "#DC2626"; }
      }
    }
  };
}

// ── Listeners Firestore ───────────────────────────────────────
function _escuchar() {
  // 1. Comentarios manuales de usuarios del panel
  const q1 = query(
    collection(db, "comentarios_cliente"),
    orderBy("timestamp", "desc"),
    limit(300)
  );
  _unsubs.push(onSnapshot(q1, snap => {
    _ultimoSnap = snap;
    _actualizarAliasSelect(snap);
    _render();
  }, err => {
    console.error("[Comentarios:comentarios_cliente]", err);
    window.manejarErrorFirestore?.(err);
  }));

  // 2. Log de cambios de clientes (visitas, acuerdos, promesas) — fuente desde la APK
  const q2 = query(
    collection(db, "log_actividades"),
    where("tipoAccion", "in", [
      "VISITA_REGISTRADA", "VISITA_SOSPECHOSA",
      "ACUERDO_CONGELAMIENTO", "PROMESA_PAGO"
    ]),
    orderBy("timestamp", "desc"),
    limit(200)
  );
  _unsubs.push(onSnapshot(q2, snap => {
    _ultimoSnapLog = snap;
    _actualizarAliasSelect(snap);
    _render();
  }, err => {
    console.error("[Comentarios:log_actividades]", err);
    window.manejarErrorFirestore?.(err);
  }));
}

// ── Render ────────────────────────────────────────────────────
function _render() {
  const el = document.getElementById("com-lista");
  if (!el) return;

  // Mezclar ambas fuentes
  const docs1 = (_ultimoSnap?.docs  || []).map(d => ({ ...d.data(), _src: "comentario" }));
  const docs2 = (_ultimoSnapLog?.docs || []).map(d => ({ ...d.data(), _src: "log" }));
  let todos = [...docs1, ...docs2].sort((a, b) => {
    const ta = a.timestamp?.toMillis?.() ?? (typeof a.timestamp === "number" ? a.timestamp : 0);
    const tb = b.timestamp?.toMillis?.() ?? (typeof b.timestamp === "number" ? b.timestamp : 0);
    return tb - ta;
  });

  // Filtros
  if (_filtroAlias !== "TODOS") {
    todos = todos.filter(d =>
      (d.alias || d.usuarioAlias || "") === _filtroAlias);
  }
  if (_filtroTipo !== "TODOS") {
    todos = todos.filter(d => d.tipoAccion === _filtroTipo);
  }
  if (_busqueda) {
    todos = todos.filter(d => {
      const haystack = [
        d.clienteNombre, d.cliente, d.alias, d.usuarioAlias,
        d.texto, d.descripcion, d.folio
      ].join(" ").toLowerCase();
      return haystack.includes(_busqueda);
    });
  }

  // Contador
  const cntEl = document.getElementById("com-count");
  if (cntEl) cntEl.textContent = `${todos.length} registros`;

  if (todos.length === 0) {
    el.innerHTML = `<div style="text-align:center;padding:40px;color:#9CA3AF;font-size:13px">
      Sin registros para los filtros seleccionados.</div>`;
    return;
  }

  el.innerHTML = todos.map(d => _tarjeta(d)).join("");
}

function _tarjeta(d) {
  const ts      = _fmtTs(d.timestamp);
  const alias   = esc(d.alias || d.usuarioAlias || "–");
  const cliente = esc(d.clienteNombre || d.cliente || "–");
  const texto   = esc(d.texto || d.descripcion || d.detalle || "–");
  const tipo    = d.tipoAccion || "–";
  const cfg     = _tipoCfg(tipo);
  const categoria = d.categoria ? `<span style="font-size:10px;padding:1px 6px;border-radius:10px;
    background:${_catColor(d.categoria)}22;color:${_catColor(d.categoria)};font-weight:700;
    margin-left:6px">${esc(d.categoria)}</span>` : "";

  const alertaBadge = (tipo === "VISITA_SOSPECHOSA")
    ? `<span style="font-size:10px;padding:1px 6px;border-radius:10px;
        background:#DC262622;color:#DC2626;font-weight:700;margin-left:4px">⚠ SOSPECHOSA</span>`
    : "";

  return `
    <div style="background:var(--c-surface);border:1px solid var(--c-border);border-radius:10px;
      padding:12px 16px;margin-bottom:8px;border-left:3px solid ${cfg.color}">
      <div style="display:flex;align-items:flex-start;gap:12px">
        <div style="font-size:20px;flex-shrink:0">${cfg.icon}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px">
            <span style="font-size:12px;font-weight:700;color:var(--c-text)">${cliente}</span>
            <span style="font-size:10px;color:#9CA3AF">·</span>
            <span style="font-size:11px;color:#6B7280">${cfg.label}</span>
            ${alertaBadge}
            ${categoria}
          </div>
          <div style="font-size:12px;color:var(--c-text);margin-bottom:6px;line-height:1.4">${texto}</div>
          <div style="font-size:10px;color:#9CA3AF">
            👤 ${alias} · 🕐 ${ts}
          </div>
        </div>
      </div>
    </div>`;
}

function _actualizarAliasSelect(snap) {
  const sel = document.getElementById("com-alias");
  if (!sel) return;
  const prev = sel.value;
  const aliasSet = new Set();
  (_ultimoSnap?.docs || []).forEach(d => {
    const a = d.data().alias;
    if (a) aliasSet.add(a);
  });
  (_ultimoSnapLog?.docs || []).forEach(d => {
    const a = d.data().alias || d.data().usuarioAlias;
    if (a) aliasSet.add(a);
  });
  sel.innerHTML = `<option value="TODOS">Todos los usuarios</option>` +
    [...aliasSet].sort().map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
  if (aliasSet.has(prev)) sel.value = prev;
}

// ── Helpers ───────────────────────────────────────────────────
function _tipoCfg(tipo) {
  const M = {
    COMENTARIO_MANUAL:     { color:"#2563EB", icon:"💬", label:"Comentario" },
    VISITA_REGISTRADA:     { color:"#16A34A", icon:"📍", label:"Visita registrada" },
    VISITA_SOSPECHOSA:     { color:"#DC2626", icon:"🚨", label:"Visita sospechosa" },
    ACUERDO_CONGELAMIENTO: { color:"#7C3AED", icon:"❄️", label:"Acuerdo congelamiento" },
    PROMESA_PAGO:          { color:"#D97706", icon:"📅", label:"Promesa de pago" },
    CONGELAMIENTO:         { color:"#7C3AED", icon:"❄️", label:"Congelamiento" },
    VISITA:                { color:"#16A34A", icon:"📍", label:"Visita" },
    EDICION:               { color:"#6B7280", icon:"✏️", label:"Edición" }
  };
  return M[tipo] ?? { color:"#9CA3AF", icon:"•", label: tipo };
}

function _catColor(cat) {
  const M = {
    SEGUIMIENTO:"#2563EB", ACUERDO:"#7C3AED", RIESGO:"#DC2626",
    INFORMACION:"#0891B2", ALERTA:"#D97706"
  };
  return M[cat] ?? "#6B7280";
}

function _fmtTs(ts) {
  if (!ts) return "–";
  const d = ts?.toDate?.() ?? (typeof ts === "number" ? new Date(ts) : new Date());
  return d.toLocaleString("es-MX", {
    day:"numeric", month:"short", year:"numeric",
    hour:"2-digit", minute:"2-digit"
  });
}
