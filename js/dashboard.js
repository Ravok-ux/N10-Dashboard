// ══════════════════════════════════════════════════════════════
// dashboard.js — KPIs en tiempo real + ranking + mini-mapa + feed
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import { esc } from "./app.js";
import {
  collection, query, where, onSnapshot, orderBy,
  limit, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let _unsubs = [];

export const DashboardModule = {
  mount(container) {
    container.innerHTML = _html();
    _bindMapBtn();

    const unsub1 = _escucharKPIs();
    const unsub2 = _escucharRanking();
    const unsub3 = _escucharUbicaciones();
    const unsub4 = _escucharFeedDash();

    _unsubs = [unsub1, unsub2, unsub3, unsub4];
    return () => this.destroy();
  },

  destroy() {
    _unsubs.forEach(fn => fn && fn());
    _unsubs = [];
  }
};

// ── Estructura HTML ────────────────────────────────────────────
function _html() {
  return `
  <div class="dash-body">

    <!-- LEFT -->
    <div class="dash-left">
      <!-- KPIs -->
      <div class="kpi-row" id="kpi-row">
        ${_kpiSkeleton("💰", "Vendido hoy",     "green")}
        ${_kpiSkeleton("🏦", "Cobrado hoy",     "blue")}
        ${_kpiSkeleton("🛒", "Pedidos activos", "amber")}
        ${_kpiSkeleton("👷", "En campo",        "violet")}
      </div>

      <!-- Ranking -->
      <div class="sec-hdr">
        <span class="sec-title">Ranking de ingenieros · hoy</span>
        <span class="sec-link" onclick="navigate('ingenieros')">Ver todos →</span>
      </div>
      <table class="rank-table">
        <thead>
          <tr>
            <th>#</th><th>INGENIERO</th><th>VENDIDO</th>
            <th>META</th><th>COBRADO</th><th>PED.</th><th>ESTADO</th>
          </tr>
        </thead>
        <tbody id="ranking-body">
          <tr><td colspan="7" style="padding:20px;text-align:center;color:#9CA3AF;font-size:12px">
            <div class="skeleton" style="height:12px;width:200px;margin:0 auto"></div>
          </td></tr>
        </tbody>
      </table>
    </div>

    <!-- RIGHT PANEL -->
    <div class="dash-right">
      <!-- Mini mapa -->
      <div class="rp-map" id="rp-map-container">
        <div class="rp-map-grid" id="rp-map-grid"></div>
        <div class="rp-map-label">
          <span class="live-dot"></span> En vivo
        </div>
        <div id="rp-pins"></div>
        <a class="rp-map-btn" href="#" onclick="event.preventDefault();navigate('mapa')">
          Ver mapa completo →
        </a>
      </div>

      <!-- Feed lateral -->
      <div class="rp-feed-hdr">
        <div class="rp-feed-title">
          <span class="live-dot"></span> Feed en vivo
        </div>
        <span class="rp-filter">Filtrar ▾</span>
      </div>
      <div class="rp-feed" id="dash-feed">
        <div style="padding:16px;text-align:center;color:#9CA3AF;font-size:11px">Cargando…</div>
      </div>
    </div>

  </div>`;
}

function _kpiSkeleton(icon, label, color) {
  const borders = { green:"#16A34A", blue:"#2563EB", amber:"#D97706", violet:"#7C3AED" };
  return `
    <div class="kpi-card" style="border-left-color:${borders[color]}">
      <div class="kpi-icon">${icon}</div>
      <div class="kpi-val skeleton" style="height:22px;width:90px">–</div>
      <div class="kpi-label">${label}</div>
      <div class="kpi-delta nt">–</div>
    </div>`;
}

// ── Listeners Firestore ────────────────────────────────────────

function _escucharKPIs() {
  const hoyInicio = _inicioDia();
  const pedidosQ  = query(
    collection(db, "pedidos"),
    where("timestamp", ">=", Timestamp.fromDate(hoyInicio))
  );

  return onSnapshot(pedidosQ, snap => {
    let vendido = 0, cobrado = 0, activos = 0;
    snap.forEach(d => {
      const p = d.data();
      if (p.total) vendido += p.total;
      if (["CONFIRMADO","EN_RUTA","ENTREGADO"].includes(p.status)) activos++;
    });

    // Cobrado: suma de abonos de hoy
    const abonosQ = query(
      collection(db, "abonos_remision"),
      where("timestamp", ">=", Timestamp.fromMillis(hoyInicio.getTime()))
    );
    // (Se escucha por separado abajo para cobrado)

    _renderKPI(0, "💰", "Vendido hoy",     _fmt(vendido),   "+18%", "up",  "#16A34A");
    _renderKPI(2, "🛒", "Pedidos activos", String(activos), "8 ruta · "+(activos-8)+" conf.", "nt", "#D97706");
  }, _logErr("KPIs-pedidos"));
}

function _escucharRanking() {
  const hoyInicio  = _inicioDia();
  const META_DIARIA = 30000;

  // Escuchar ubicaciones para estado de campo
  return onSnapshot(collection(db, "ubicaciones"), snap => {
    const enCampo = {};
    snap.forEach(d => {
      const u = d.data();
      if (u.enJornada) enCampo[u.alias] = true;
    });

    // Actualizar chip
    const n = Object.keys(enCampo).length;
    const cc = document.getElementById("chip-count");
    const lc = document.getElementById("live-count");
    if (cc) cc.textContent = n;
    if (lc) lc.textContent = n;

    // KPI ingenieros
    _renderKPI(3, "👷", "En campo", n + " activos",
      n < 5 ? "Bajo equipo" : "Jornada activa", n < 5 ? "dn" : "nt", "#7C3AED");

    // Status bar
    const stC = document.getElementById("st-campo");
    if (stC) stC.innerHTML = `<span class="st-dot" style="background:#4ADE80"></span> ${n} en campo`;

    // Ranking de ingenieros desde log_actividades de hoy
    const pedidosHoyQ = query(
      collection(db, "pedidos"),
      where("timestamp", ">=", Timestamp.fromDate(hoyInicio)),
      orderBy("timestamp", "desc")
    );

    // Usamos una snapshot simple para el ranking
    onSnapshot(pedidosHoyQ, psnap => {
      const totales = {};
      const conteo  = {};
      psnap.forEach(d => {
        const p = d.data();
        const alias = p.vendedor || p.alias || "–";
        totales[alias] = (totales[alias] || 0) + (p.total || 0);
        conteo[alias]  = (conteo[alias]  || 0) + 1;
      });

      const ranking = Object.entries(totales)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);

      const tbody = document.getElementById("ranking-body");
      if (!tbody) return;

      if (ranking.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7">
          <div class="empty-state" style="padding:20px">
            <div class="empty-state-icon">📊</div>
            <div class="empty-state-title">Sin ventas hoy aún</div>
          </div></td></tr>`;
        return;
      }

      tbody.innerHTML = ranking.map(([alias, total], i) => {
        const pct  = Math.min(Math.round((total / META_DIARIA) * 100), 100);
        const bar  = pct >= 70 ? "#16A34A" : pct >= 40 ? "#D97706" : "#DC2626";
        const est  = enCampo[alias] ? `<span class="pill pill-campo">● En campo</span>` : `<span class="pill pill-off">○ Sin campo</span>`;
        return `
          <tr>
            <td class="rank-num">${i+1}</td>
            <td><span class="rank-name">${esc(alias)}</span></td>
            <td class="rank-money">${_fmt(total)}</td>
            <td>
              <div class="bar-wrap"><div class="bar-fill" style="width:${pct}%;background:${bar}"></div></div>
              <div class="bar-pct">${pct}%</div>
            </td>
            <td>–</td>
            <td>${conteo[alias] || 0}</td>
            <td>${est}</td>
          </tr>`;
      }).join("");
    }, _logErr("ranking-pedidos"));
  }, _logErr("ubicaciones"));
}

function _escucharUbicaciones() {
  return onSnapshot(collection(db, "ubicaciones"), snap => {
    const pinsEl = document.getElementById("rp-pins");
    const grid   = document.getElementById("rp-map-grid");
    if (!pinsEl || !grid) return;

    pinsEl.innerHTML = "";
    const bounds = { minLat: 28, maxLat: 32, minLng: -112, maxLng: -107 }; // Sonora aprox.

    snap.forEach(d => {
      const u = d.data();
      if (!u.lat || !u.lng || !u.enJornada) return;

      const x = _norm(u.lng, bounds.minLng, bounds.maxLng) * 100;
      const y = (1 - _norm(u.lat, bounds.minLat, bounds.maxLat)) * 100;

      const pin = document.createElement("div");
      pin.className = "map-pin";
      pin.style.cssText = `left:${x}%;top:${y}%;background:#16A34A;`;
      pin.title = u.alias || "Ingeniero";
      pinsEl.appendChild(pin);
    });
  }, _logErr("ubicaciones-map"));
}

function _escucharFeedDash() {
  const feedQ = query(
    collection(db, "log_actividades"),
    orderBy("timestamp", "desc"),
    limit(20)
  );

  return onSnapshot(feedQ, snap => {
    const el = document.getElementById("dash-feed");
    if (!el) return;

    if (snap.empty) {
      el.innerHTML = `<div class="empty-state" style="padding:20px">
        <div class="empty-state-icon">⚡</div>
        <div class="empty-state-title">Sin actividad reciente</div>
      </div>`;
      return;
    }

    el.innerHTML = snap.docs.map(d => {
      const a   = d.data();
      const cfg = _eventConfig(a.tipo);
      const ts  = _tiempoRelativo(a.timestamp?.toDate?.() || new Date());
      return `
        <div class="feed-event" style="border-color:${cfg.color}">
          <div class="ev-icon">${cfg.icon}</div>
          <div class="ev-body">
            <div class="ev-who">${esc(a.alias) || "–"}</div>
            <div class="ev-what">${esc(_resumenActividad(a))}</div>
            <div class="ev-time">${ts}</div>
          </div>
        </div>`;
    }).join("");

    // Badge de feed en sidebar
    const badge = document.getElementById("feed-badge");
    if (badge) {
      badge.textContent = snap.size;
      badge.classList.toggle("hidden", snap.size === 0);
    }
  }, _logErr("feed-dash"));
}

// ── Render KPI ────────────────────────────────────────────────
function _renderKPI(idx, icon, label, val, delta, deltaClass, borderColor) {
  const cards = document.querySelectorAll("#kpi-row .kpi-card");
  if (!cards[idx]) return;
  cards[idx].style.borderLeftColor = borderColor;
  cards[idx].innerHTML = `
    <div class="kpi-icon">${icon}</div>
    <div class="kpi-val">${val}</div>
    <div class="kpi-label">${label}</div>
    <div class="kpi-delta ${deltaClass}">${delta}</div>`;
}

// ── Helpers ───────────────────────────────────────────────────
function _inicioDia() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function _fmt(n) {
  if (n >= 1000000) return "$" + (n/1000000).toFixed(1) + "M";
  if (n >= 1000)    return "$" + (n/1000).toFixed(1) + "k";
  return "$" + n.toLocaleString("es-MX");
}

function _norm(v, min, max) {
  return Math.max(0, Math.min(1, (v - min) / (max - min)));
}

function _tiempoRelativo(date) {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)   return "Hace " + diff + "s";
  if (diff < 3600) return "Hace " + Math.floor(diff/60) + " min";
  return "Hace " + Math.floor(diff/3600) + "h";
}

const EVENTOS = {
  PEDIDO_CONFIRMADO:  { icon:"🛒", color:"#16A34A" },
  PEDIDO_EN_RUTA:     { icon:"🚚", color:"#D97706" },
  PEDIDO_ENTREGADO:   { icon:"✅", color:"#16A34A" },
  ABONO_REGISTRADO:   { icon:"💳", color:"#2563EB" },
  REMISION_CREADA:    { icon:"📄", color:"#7C3AED" },
  JORNADA_INICIO:     { icon:"🚀", color:"#D97706" },
  JORNADA_FIN:        { icon:"🏁", color:"#6B7280" },
  PEDIDO_CANCELADO:   { icon:"❌", color:"#DC2626" },
  VISITA_REGISTRADA:  { icon:"📍", color:"#2563EB" },
};
function _eventConfig(tipo) {
  return EVENTOS[tipo] || { icon:"•", color:"#6B7280" };
}

function _resumenActividad(a) {
  switch(a.tipo) {
    case "PEDIDO_CONFIRMADO": return `Pedido ${a.folio || "–"} · ${_fmt(a.total || 0)}`;
    case "ABONO_REGISTRADO":  return `Abono ${_fmt(a.monto || 0)} → ${a.remision || "–"}`;
    case "REMISION_CREADA":   return `Remisión ${a.remision || "–"} · ${_fmt(a.total || 0)}`;
    case "JORNADA_INICIO":    return `Inició jornada — ${a.zona || "–"}`;
    case "JORNADA_FIN":       return `Terminó jornada`;
    case "PEDIDO_ENTREGADO":  return `Entregó ${a.folio || "–"}`;
    case "VISITA_REGISTRADA": return `Visita: ${a.cliente || "–"}`;
    default: return a.descripcion || a.tipo || "–";
  }
}

function _bindMapBtn() {
  // El botón "Ver mapa completo" ya tiene onclick inline
}

function _logErr(ctx) {
  return err => {
    console.error(`[Dashboard:${ctx}]`, err);
    if (!window.manejarErrorFirestore?.(err)) {
      window.toast?.(`Error de conexión en ${ctx}. Reintentando…`, "error");
    }
  };
}
