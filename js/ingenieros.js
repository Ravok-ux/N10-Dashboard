// ══════════════════════════════════════════════════════════════
// ingenieros.js — Listado de ingenieros con estado de jornada y KPIs
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import {
  collection, query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let _unsubUsuarios   = null;
let _unsubUbicaciones = null;
let _usuarios    = [];
let _ubicaciones = {};
let _filtroActivo = "TODOS";

const fmtHora = d => new Date(d?.toDate?.() ?? d).toLocaleTimeString("es-MX", { hour:"2-digit", minute:"2-digit" });
const fmtDt   = d => new Date(d?.toDate?.() ?? d).toLocaleDateString("es-MX", { day:"numeric", month:"short" });

export const IngenierosModule = {
  mount(container) {
    container.innerHTML = _html();
    _bindUI();
    _escuchar();
    return () => this.destroy();
  },
  destroy() {
    _unsubUsuarios?.();   _unsubUsuarios   = null;
    _unsubUbicaciones?.(); _unsubUbicaciones = null;
    _usuarios = []; _ubicaciones = {}; _filtroActivo = "TODOS";
  }
};

// ── HTML ──────────────────────────────────────────────────────
function _html() {
  return `
  <div style="padding:0 0 20px">

    <!-- Controles -->
    <div style="background:#fff;border-radius:10px;border:1px solid #E5E7EB;padding:12px 16px;
      margin-bottom:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
      box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <span style="font-size:12px;font-weight:700;color:#374151">Jornada:</span>
      ${["TODOS","EN_JORNADA","FUERA"].map(f => `
        <button class="filter-pill ${f==="TODOS"?"active":""}" data-ing-f="${f}"
          onclick="IngenierosUI.setFiltro('${f}')">
          ${{TODOS:"Todos",EN_JORNADA:"En jornada",FUERA:"Fuera"}[f]}
        </button>`).join("")}
    </div>

    <!-- Tarjetas de ingenieros -->
    <div id="ing-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">
      <div style="padding:30px;text-align:center;color:#9CA3AF;font-size:13px;
        grid-column:1/-1">Cargando ingenieros…</div>
    </div>
  </div>`;
}

// ── UI Bind ───────────────────────────────────────────────────
function _bindUI() {
  window.IngenierosUI = {
    setFiltro(f) {
      _filtroActivo = f;
      document.querySelectorAll("[data-ing-f]").forEach(b =>
        b.classList.toggle("active", b.dataset.ingF === f));
      _render();
    }
  };
}

// ── Firestore listeners ───────────────────────────────────────
function _escuchar() {
  _unsubUsuarios = onSnapshot(
    query(collection(db, "usuarios"), orderBy("alias")),
    snap => {
      _usuarios = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(u => u.activo !== false && u.rol !== "SUPER_ADMIN");
      _render();
    },
    err => {
      console.error("[Ingenieros:usuarios]", err);
      window.toast?.("Error al cargar ingenieros.", "error");
    }
  );

  _unsubUbicaciones = onSnapshot(
    collection(db, "ubicaciones"),
    snap => {
      _ubicaciones = {};
      snap.forEach(d => { _ubicaciones[d.id] = { id: d.id, ...d.data() }; });
      _render();
    },
    err => {
      console.error("[Ingenieros:ubicaciones]", err);
    }
  );
}

// ── Render ────────────────────────────────────────────────────
function _render() {
  const ahora = Date.now();
  let lista = _usuarios.map(u => {
    const ub   = _ubicaciones[u.id] || _ubicaciones[u.alias] || null;
    const ts   = ub?.timestamp?.toDate?.()?.getTime() ?? 0;
    const mins = ts ? Math.floor((ahora - ts) / 60000) : null;
    const enJornada = ub?.enJornada === true;
    return { ...u, ub, ts, mins, enJornada };
  });

  if (_filtroActivo === "EN_JORNADA") lista = lista.filter(u => u.enJornada);
  if (_filtroActivo === "FUERA")      lista = lista.filter(u => !u.enJornada);

  const grid = document.getElementById("ing-grid");
  if (!grid) return;
  if (lista.length === 0) {
    grid.innerHTML = `<div style="padding:30px;text-align:center;color:#9CA3AF;font-size:13px;
      grid-column:1/-1">Sin ingenieros para este filtro.</div>`;
    return;
  }

  grid.innerHTML = lista.map(u => {
    const enVivo     = u.mins !== null && u.mins < 5;
    const senalColor = enVivo ? "#16A34A" : u.mins !== null && u.mins < 60 ? "#D97706" : "#9CA3AF";
    const jornadaBadge = u.enJornada
      ? `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:9px;
          background:#DCFCE7;color:#16A34A">● En jornada</span>`
      : `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:9px;
          background:#F3F4F6;color:#6B7280">Fuera de jornada</span>`;
    const senalTxt = u.mins === null
      ? "Sin señal GPS"
      : u.mins < 5 ? "En vivo"
      : u.mins < 60 ? `${u.mins} min sin señal`
      : "Sin señal reciente";
    const rolColor = u.rol === "RECUPERADOR" ? "#15803D" : "#1565C0";

    return `<div style="background:#fff;border-radius:12px;border:1px solid #E5E7EB;padding:16px;
      box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:10px">
        <div style="width:40px;height:40px;border-radius:50%;background:${rolColor}1A;
          display:flex;align-items:center;justify-content:center;
          font-size:16px;font-weight:800;color:${rolColor};flex-shrink:0">
          ${(u.alias || u.email || "?").charAt(0).toUpperCase()}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700;color:#111827;white-space:nowrap;
            overflow:hidden;text-overflow:ellipsis">${u.alias || u.email}</div>
          <div style="font-size:11px;color:${rolColor};font-weight:600;margin-top:1px">${u.rol || "–"}</div>
        </div>
        ${jornadaBadge}
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <span style="width:8px;height:8px;border-radius:50%;background:${senalColor};flex-shrink:0"></span>
        <span style="font-size:11px;color:#6B7280">${senalTxt}</span>
        ${u.ts ? `<span style="font-size:11px;color:#9CA3AF;margin-left:auto">${fmtHora(new Date(u.ts))}</span>` : ""}
      </div>
      ${u.ub?.lat && u.ub?.lon
        ? `<a href="https://www.google.com/maps?q=${u.ub.lat},${u.ub.lon}" target="_blank"
            style="display:block;font-size:11px;color:#1565C0;text-decoration:none;font-weight:600">
            📍 Ver en Google Maps</a>`
        : `<span style="font-size:11px;color:#9CA3AF">Sin ubicación registrada</span>`}
    </div>`;
  }).join("");
}
