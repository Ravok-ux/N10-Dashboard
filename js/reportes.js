// ══════════════════════════════════════════════════════════════
// reportes.js — Generación de reportes por período
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import {
  collection, query, where, getDocs, orderBy, Timestamp, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let _periodo  = "semana";
let _tipo     = "comisiones"; // cartera | visitas | comisiones

const META_KEY = "n10_meta_mensual";
function _getMeta() { return Number(localStorage.getItem(META_KEY)) || 150000; }
function _setMeta(v) { const n = Number(v); if (n > 0) localStorage.setItem(META_KEY, n); }

export const ReportesModule = {
  mount(container) {
    container.innerHTML = _html();
    _bindUI();
    _cargarDatos();
    return () => {};
  }
};

// ── HTML ──────────────────────────────────────────────────────
function _html() {
  const hoy = new Date();
  const fmtFecha = d => d.toLocaleDateString("es-MX", { day:"numeric", month:"short", year:"numeric" });

  return `
  <div class="report-body">

    <!-- Selector de tipo de reporte -->
    <div style="background:var(--c-surface);border-radius:10px;border:1px solid var(--c-border);
      padding:10px 18px;margin-bottom:10px;display:flex;align-items:center;gap:8px;
      box-shadow:0 1px 3px rgba(0,0,0,.06);flex-wrap:wrap">
      <span style="font-size:11px;font-weight:700;color:var(--c-text-secondary)">REPORTE:</span>
      ${[
        ["comisiones","📊 Comisiones / Rendimiento"],
        ["cartera",   "📋 Cartera de clientes"],
        ["visitas",   "🗺️ Historial de visitas"]
      ].map(([t, lbl]) => `
        <button class="filter-pill ${t==="comisiones"?"active":""}" data-tipo="${t}"
          onclick="ReportUI.setTipo('${t}')">${lbl}</button>`).join("")}
      <div style="flex:1"></div>
      <button onclick="ReportUI.exportarPDF()" class="btn-export pdf">↓ PDF</button>
      <button onclick="ReportUI.exportarCSV()" class="btn-export xls">↓ CSV</button>
    </div>

    <!-- Selector de período (oculto para cartera) -->
    <div id="rp-periodo-bar" style="background:var(--c-surface);border-radius:10px;border:1px solid var(--c-border);
      padding:10px 18px;margin-bottom:10px;display:flex;align-items:center;gap:10px;
      box-shadow:0 1px 3px rgba(0,0,0,.06);flex-wrap:wrap">
      <span style="font-size:12px;font-weight:700;color:var(--c-text)">Período:</span>
      ${["hoy","semana","mes"].map(p => `
        <button class="filter-pill ${p==="semana"?"active":""}" data-periodo="${p}"
          onclick="ReportUI.setPeriodo('${p}')">
          ${{hoy:"Hoy",semana:"Esta semana",mes:"Este mes"}[p]}
        </button>`).join("")}
      <div style="flex:1"></div>
      <label id="rp-meta-wrap" style="font-size:11px;font-weight:700;color:#6B7280;display:flex;align-items:center;gap:6px">
        META $
        <input id="rp-meta-input" type="number" min="1" step="1000" value="${_getMeta()}"
          style="width:90px;padding:3px 7px;border:1px solid var(--c-border);border-radius:6px;
                 font-size:12px;font-weight:700;color:var(--c-text);background:var(--c-surface)"
          onchange="ReportUI.setMeta(this.value)">
      </label>
    </div>

    <!-- Papel del reporte -->
    <div class="report-paper" id="reporte-papel">
      <!-- Header -->
      <div class="report-header">
        <div>
          <div class="report-logo">N·10</div>
          <div class="report-logo-sub">NUTRICIÓN DE 10</div>
        </div>
        <div class="report-meta">
          <strong id="rp-titulo">Reporte de comisiones y rendimiento</strong>
          <span id="rp-periodo-label">Semana actual · ${fmtFecha(hoy)}</span>
        </div>
      </div>

      <!-- KPIs resumen -->
      <div class="report-kpis" id="rp-kpis"></div>

      <!-- Tabla principal -->
      <div class="report-table-wrap">
        <div class="report-section-title" id="rp-section-title">Rendimiento por ingeniero</div>
        <div style="overflow-x:auto">
          <table class="report-table" id="rp-tabla">
            <thead id="rp-thead"></thead>
            <tbody id="rp-tbody">
              <tr><td colspan="9" style="padding:20px;text-align:center;color:#9CA3AF;font-size:12px">
                Cargando datos…
              </td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Footer -->
      <div class="report-footer">
        <span>N-10 Analytics ERP · Generado por ${Sesion.alias}</span>
        <span id="rp-footer-ts">–</span>
      </div>
    </div>
  </div>`;
}

// ── Bind UI ───────────────────────────────────────────────────
function _bindUI() {
  window.ReportUI = {
    setTipo(t) {
      _tipo = t;
      document.querySelectorAll("[data-tipo]").forEach(b =>
        b.classList.toggle("active", b.dataset.tipo === t));
      // Ocultar período y meta para cartera
      const periodoBar = document.getElementById("rp-periodo-bar");
      const metaWrap   = document.getElementById("rp-meta-wrap");
      if (periodoBar) periodoBar.style.display = t === "cartera" ? "none" : "";
      if (metaWrap)   metaWrap.style.display   = t !== "comisiones" ? "none" : "";
      _cargarDatos();
    },
    setPeriodo(p) {
      _periodo = p;
      document.querySelectorAll("[data-periodo]").forEach(b =>
        b.classList.toggle("active", b.dataset.periodo === p));
      _cargarDatos();
    },
    setMeta(v) { _setMeta(v); _cargarDatos(); },
    exportarPDF() { window.print(); },
    exportarCSV() { _exportarCSV(); }
  };
}

// ── Despacho de carga ─────────────────────────────────────────
function _cargarDatos() {
  _setText("rp-footer-ts", "Datos al " + new Date().toLocaleString("es-MX"));
  _setLoading();
  if (_tipo === "cartera")   _cargarCartera();
  else if (_tipo === "visitas") _cargarVisitas();
  else                         _cargarComisiones();
}

function _setLoading(cols = 6) {
  const tbody = document.getElementById("rp-tbody");
  if (tbody) tbody.innerHTML = window.skeletonRows?.(6, cols) ??
    `<tr><td colspan="${cols}" style="padding:20px;text-align:center;color:#9CA3AF">
      <div class="spinner" style="margin:0 auto"></div>
    </td></tr>`;
}

// ── REPORTE 1: Comisiones / Rendimiento ───────────────────────
async function _cargarComisiones() {
  _setText("rp-titulo", "Reporte de comisiones y rendimiento");
  _setText("rp-section-title", "Rendimiento por ingeniero");

  const { desde, hasta, label } = _rangoPeriodo();
  _setText("rp-periodo-label", label);

  const thead = document.getElementById("rp-thead");
  if (thead) thead.innerHTML = `<tr style="border-bottom:2px solid var(--c-border)">
    <th>#</th><th>INGENIERO</th><th>VENDIDO</th><th>META</th>
    <th>AVANCE</th><th>COBRADO</th><th>PEDIDOS</th><th>CARTERA</th><th>STATUS</th>
  </tr>`;

  try {
    const [pedidosSnap, abonosSnap] = await Promise.all([
      getDocs(query(collection(db,"pedidos"),
        where("timestamp",">=",Timestamp.fromDate(desde)),
        where("timestamp","<=",Timestamp.fromDate(hasta)))),
      getDocs(query(collection(db,"abonos_remision"),
        where("timestamp",">=",Timestamp.fromMillis(desde.getTime())),
        where("timestamp","<=",Timestamp.fromMillis(hasta.getTime()))))
    ]);

    const stats = {};
    pedidosSnap.forEach(d => {
      const p = d.data(), alias = p.vendedor || p.alias || "–";
      if (!stats[alias]) stats[alias] = { vendido:0, cobrado:0, pedidos:0 };
      stats[alias].vendido  += p.total || 0;
      stats[alias].pedidos  += 1;
    });
    abonosSnap.forEach(d => {
      const a = d.data(), alias = a.quienRegistro || a.alias || "–";
      if (!stats[alias]) stats[alias] = { vendido:0, cobrado:0, pedidos:0 };
      stats[alias].cobrado += a.monto || 0;
    });

    const META = _getMeta();
    const ranking = Object.entries(stats).sort((a,b) => b[1].vendido - a[1].vendido);
    const totalVendido = ranking.reduce((s,[,v]) => s + v.vendido, 0);
    const totalCobrado = ranking.reduce((s,[,v]) => s + v.cobrado, 0);
    const totalPedidos = ranking.reduce((s,[,v]) => s + v.pedidos, 0);

    _renderKPIs([
      [_fmt(totalVendido),"TOTAL VENDIDO"],
      [_fmt(totalCobrado),"COBRADO"],
      [String(totalPedidos),"PEDIDOS"],
      [String(ranking.length),"INGENIEROS"]
    ]);

    _renderTabla(ranking.length === 0 ? null : ranking.map(([alias, s], i) => {
      const pct  = Math.min(Math.round((s.vendido / META) * 100), 100);
      const barC = pct >= 70 ? "#16A34A" : pct >= 40 ? "#D97706" : "#DC2626";
      const tag  = pct >= 70 ? ["tg","✓ Meta cercana"] : pct >= 40 ? ["ta","⚠ Atención"] : ["tr","✗ Bajo meta"];
      return `<tr>
        <td style="font-weight:800;color:${barC}">${i+1}</td>
        <td style="font-weight:700">${esc(alias)}</td>
        <td style="font-weight:700;font-variant-numeric:tabular-nums">${_fmt(s.vendido)}</td>
        <td>${_fmt(META)}</td>
        <td>
          <div style="font-size:10px;font-weight:700;color:${barC}">${pct}%</div>
          <div style="height:4px;background:#E5E7EB;border-radius:2px;margin-top:2px;width:70px">
            <div style="height:100%;border-radius:2px;width:${pct}%;background:${barC}"></div>
          </div>
        </td>
        <td style="font-variant-numeric:tabular-nums">${_fmt(s.cobrado)}</td>
        <td style="text-align:center">${s.pedidos}</td>
        <td>–</td>
        <td><span style="font-size:8.5px;font-weight:700;padding:2px 6px;border-radius:7px"
          class="rtag-${tag[0]}">${tag[1]}</span></td>
      </tr>`;
    }), 9);

    _csvData = [
      ["#","Ingeniero","Vendido","Meta","Avance %","Cobrado","Pedidos","Status"],
      ...ranking.map(([alias, s], i) => {
        const pct = Math.min(Math.round((s.vendido / META) * 100), 100);
        return [i+1, alias, s.vendido, META, pct+"%", s.cobrado, s.pedidos, pct>=70?"Bueno":pct>=40?"Atención":"Bajo"];
      })
    ];
  } catch (e) { _renderError(e, 9); }
}

// ── REPORTE 2: Cartera de clientes ───────────────────────────
async function _cargarCartera() {
  _setText("rp-titulo", "Cartera de clientes — saldo actual");
  _setText("rp-section-title", "Notas de crédito activas y vencidas");
  _setText("rp-periodo-label", "Estado actual al " + _fmtD(new Date()));
  _setLoading(7);

  const thead = document.getElementById("rp-thead");
  if (thead) thead.innerHTML = `<tr style="border-bottom:2px solid var(--c-border)">
    <th style="text-align:left">CLIENTE</th>
    <th style="text-align:left">NOTA</th>
    <th style="text-align:right">TOTAL</th>
    <th style="text-align:right">ABONADO</th>
    <th style="text-align:right">SALDO</th>
    <th style="text-align:left">STATUS</th>
    <th style="text-align:left">VENDEDOR</th>
  </tr>`;

  try {
    const snap = await getDocs(query(
      collection(db,"remisiones_credito"),
      where("status","in",["ACTIVA","VENCIDA"]),
      orderBy("clienteNombre"),
      limit(500)
    ));

    const rows = snap.docs.map(d => d.data());
    rows.sort((a,b) => {
      if (a.status !== b.status) return a.status === "VENCIDA" ? -1 : 1;
      return (a.clienteNombre||"").localeCompare(b.clienteNombre||"");
    });

    const totalSaldo   = rows.reduce((s,r) => s + ((r.total||0) - (r.totalAbonado||0)), 0);
    const totalAbonado = rows.reduce((s,r) => s + (r.totalAbonado||0), 0);
    const vencidas     = rows.filter(r => r.status === "VENCIDA").length;

    _renderKPIs([
      [String(rows.length), "NOTAS ACTIVAS"],
      [String(vencidas),    "VENCIDAS"],
      [_fmt(totalSaldo),    "SALDO TOTAL"],
      [_fmt(totalAbonado),  "ABONADO"]
    ]);

    _renderTabla(rows.length === 0 ? null : rows.map(r => {
      const saldo  = (r.total||0) - (r.totalAbonado||0);
      const isVenc = r.status === "VENCIDA";
      return `<tr style="border-bottom:1px solid var(--c-border)">
        <td style="font-weight:600;padding:7px 8px">${esc(r.clienteNombre||"–")}</td>
        <td style="padding:7px 8px;color:#6B7280">${esc(r.remisionNumero||"–")}</td>
        <td style="padding:7px 8px;text-align:right;font-variant-numeric:tabular-nums">${_fmt(r.total||0)}</td>
        <td style="padding:7px 8px;text-align:right;color:#16A34A;font-variant-numeric:tabular-nums">${_fmt(r.totalAbonado||0)}</td>
        <td style="padding:7px 8px;text-align:right;font-weight:700;color:${isVenc?"#DC2626":"#D97706"};font-variant-numeric:tabular-nums">${_fmt(saldo)}</td>
        <td style="padding:7px 8px">
          <span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:7px;
            background:${isVenc?"#FEE2E2":"#FEF9C3"};color:${isVenc?"#DC2626":"#92400E"}">
            ${r.status}
          </span>
        </td>
        <td style="padding:7px 8px;color:#6B7280;font-size:11px">${esc(r.aliasVendedor||"–")}</td>
      </tr>`;
    }), 7);

    _csvData = [
      ["Cliente","Nota","Total","Abonado","Saldo","Status","Vendedor"],
      ...rows.map(r => [
        r.clienteNombre||"–", r.remisionNumero||"–",
        r.total||0, r.totalAbonado||0,
        (r.total||0)-(r.totalAbonado||0),
        r.status, r.aliasVendedor||"–"
      ])
    ];
  } catch (e) { _renderError(e, 7); }
}

// ── REPORTE 3: Historial de visitas ───────────────────────────
async function _cargarVisitas() {
  _setText("rp-titulo", "Historial de visitas por ingeniero");
  _setText("rp-section-title", "Visitas registradas en el período");

  const { desde, hasta, label } = _rangoPeriodo();
  _setText("rp-periodo-label", label);
  _setLoading(6);

  const thead = document.getElementById("rp-thead");
  if (thead) thead.innerHTML = `<tr style="border-bottom:2px solid var(--c-border)">
    <th style="text-align:left">FECHA</th>
    <th style="text-align:left">INGENIERO</th>
    <th style="text-align:left">CLIENTE</th>
    <th style="text-align:left">TIPO</th>
    <th style="text-align:left">GPS</th>
    <th style="text-align:left">STATUS</th>
  </tr>`;

  try {
    const snap = await getDocs(query(
      collection(db,"visitas"),
      where("timestamp",">=",Timestamp.fromMillis(desde.getTime())),
      where("timestamp","<=",Timestamp.fromMillis(hasta.getTime())),
      orderBy("timestamp","desc"),
      limit(1000)
    ));

    const rows = snap.docs.map(d => d.data());

    // KPIs agrupados por ingeniero
    const byIng = {};
    rows.forEach(v => {
      const k = v.aliasVendedor || "–";
      if (!byIng[k]) byIng[k] = { total:0, sosp:0 };
      byIng[k].total++;
      if (v.flagSospechosa) byIng[k].sosp++;
    });
    const ingenieros    = Object.keys(byIng).length;
    const sospechosas   = rows.filter(v => v.flagSospechosa).length;

    _renderKPIs([
      [String(rows.length),   "TOTAL VISITAS"],
      [String(ingenieros),    "INGENIEROS"],
      [String(sospechosas),   "SOSPECHOSAS"],
      [rows.length > 0 ? _fmtD(new Date(rows[rows.length-1].timestamp)) : "–", "PRIMERA VISITA"]
    ]);

    _renderTabla(rows.length === 0 ? null : rows.map(v => {
      const ts      = v.timestamp ? new Date(v.timestamp) : null;
      const sosp    = v.flagSospechosa;
      const gpsOk   = v.distanciaMetros >= 0 && v.distanciaMetros <= 200;
      const gpsTxt  = sosp ? `⚠ ${v.distanciaMetros?.toFixed(0)||"?"}m` : gpsOk ? "✓ OK" : "–";
      return `<tr style="border-bottom:1px solid var(--c-border)${sosp?";background:#FFF5F5":""}">
        <td style="padding:7px 8px;white-space:nowrap;font-size:11px;color:#6B7280">
          ${ts ? ts.toLocaleDateString("es-MX",{day:"2-digit",month:"short"})+" "+ts.toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"}) : "–"}
        </td>
        <td style="padding:7px 8px;font-weight:600">${esc(v.aliasVendedor||"–")}</td>
        <td style="padding:7px 8px">${esc(v.clienteNombre||"–")}</td>
        <td style="padding:7px 8px;font-size:11px;color:#6B7280">${esc(v.tipo||"–")}</td>
        <td style="padding:7px 8px;font-size:11px;color:${sosp?"#DC2626":gpsOk?"#16A34A":"#9CA3AF"}">${gpsTxt}</td>
        <td style="padding:7px 8px">
          ${sosp ? `<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:7px;background:#FEE2E2;color:#DC2626">SOSPECHOSA</span>` : ""}
        </td>
      </tr>`;
    }), 6);

    _csvData = [
      ["Fecha","Ingeniero","Cliente","Tipo","Distancia (m)","Sospechosa"],
      ...rows.map(v => {
        const ts = v.timestamp ? new Date(v.timestamp).toLocaleString("es-MX") : "";
        return [ts, v.aliasVendedor||"–", v.clienteNombre||"–", v.tipo||"–",
          v.distanciaMetros??"-", v.flagSospechosa?"SÍ":"NO"];
      })
    ];
  } catch (e) { _renderError(e, 6); }
}

// ── CSV export ────────────────────────────────────────────────
let _csvData = [];
function _exportarCSV() {
  if (!_csvData.length) { window.toast?.("Sin datos para exportar","warning"); return; }
  const csv  = _csvData.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type:"text/csv;charset=utf-8;" });
  const a    = document.createElement("a");
  a.href     = URL.createObjectURL(blob);
  a.download = `N10-${_tipo}-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  window.toast?.("Exportando CSV…","info");
}

// ── Helpers de render ─────────────────────────────────────────
function _renderKPIs(items) {
  const el = document.getElementById("rp-kpis");
  if (!el) return;
  el.innerHTML = items.map(([v,l]) => `
    <div class="rk-item"><div class="rk-val">${v}</div><div class="rk-lbl">${l}</div></div>`).join("");
}

function _renderTabla(rows, cols) {
  const tbody = document.getElementById("rp-tbody");
  if (!tbody) return;
  if (!rows) {
    tbody.innerHTML = `<tr><td colspan="${cols}">
      <div class="empty-state" style="padding:20px">
        <div class="empty-state-icon">📊</div>
        <div class="empty-state-title">Sin datos en este período</div>
      </div>
    </td></tr>`;
    return;
  }
  tbody.innerHTML = rows.join("");
}

function _renderError(e, cols) {
  console.error("[Reportes]", e);
  if (!window.manejarErrorFirestore?.(e)) {
    const tbody = document.getElementById("rp-tbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="${cols}"
      style="color:#DC2626;padding:16px;text-align:center">
      Error al cargar datos: ${e.message}
    </td></tr>`;
  }
}

// ── Helpers de fecha ──────────────────────────────────────────
function _rangoPeriodo() {
  const hoy    = new Date();
  const inicio = d => { const n = new Date(d); n.setHours(0,0,0,0); return n; };
  const fin    = d => { const n = new Date(d); n.setHours(23,59,59,999); return n; };
  switch (_periodo) {
    case "hoy":
      return { desde: inicio(hoy), hasta: fin(hoy), label: "Hoy · " + _fmtD(hoy) };
    case "semana": {
      const lunes = new Date(hoy);
      lunes.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
      return { desde: inicio(lunes), hasta: fin(hoy),
        label: `Semana ${_semana(hoy)} · ${_fmtD(lunes)} — ${_fmtD(hoy)}` };
    }
    case "mes": {
      const p = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      return { desde: inicio(p), hasta: fin(hoy),
        label: hoy.toLocaleDateString("es-MX", { month:"long", year:"numeric" }) };
    }
    default: return { desde: inicio(hoy), hasta: fin(hoy), label: "Hoy" };
  }
}

function _semana(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function _fmtD(d) { return d.toLocaleDateString("es-MX", { day:"numeric", month:"short" }); }
function _fmt(n)  {
  if (typeof n !== "number") return "–";
  return n >= 1000 ? "$" + (n/1000).toFixed(1)+"k" : "$" + n.toLocaleString("es-MX");
}
function _setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// CSS de tags del reporte
const style = document.createElement("style");
style.textContent = `
  .rtag-tg { background:#DCFCE7; color:#166534; }
  .rtag-ta { background:#FEF9C3; color:#92400E; }
  .rtag-tr { background:#FEE2E2; color:#DC2626; }
  @media print {
    .sidebar,.topbar,.subhdr,.statusbar,.report-body>:not(:last-child) { display:none !important; }
    body { overflow:visible; }
    .views-container,.view.active,.report-body { overflow:visible; height:auto; }
    .report-paper { box-shadow:none; }
  }
`;
if (!document.getElementById("report-styles")) {
  style.id = "report-styles";
  document.head.appendChild(style);
}
