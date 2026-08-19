// reportes-custom.js — Reportes configurables por el usuario
import { db, Sesion } from "./firebase-config.js";
import {
  collection, query, where, orderBy, getDocs,
  limit as fsLimit, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Fuentes de datos disponibles con sus campos
const FUENTES = {
  pedidos: {
    label: "Pedidos",
    icon: "📦",
    collection: "pedidos",
    campos: {
      folio:          { label: "Folio",          tipo: "texto"   },
      clienteNombre:  { label: "Cliente",        tipo: "texto"   },
      ingenieroAlias: { label: "Ingeniero",      tipo: "texto"   },
      status:         { label: "Status",         tipo: "texto"   },
      total:          { label: "Total",          tipo: "moneda"  },
      tipoPedido:     { label: "Tipo pedido",    tipo: "texto"   },
      tipoVenta:      { label: "Tipo venta",     tipo: "texto"   },
      moneda:         { label: "Moneda",         tipo: "texto"   },
      _ts:            { label: "Fecha",          tipo: "fecha"   },
    },
    filtros: ["status", "ingenieroAlias", "clienteNombre", "moneda"],
  },
  clientes: {
    label: "Clientes",
    icon: "👥",
    collection: "clientes",
    campos: {
      nombre:        { label: "Nombre",      tipo: "texto"  },
      rfc:           { label: "RFC",         tipo: "texto"  },
      telefono:      { label: "Teléfono",    tipo: "texto"  },
      ciudad:        { label: "Ciudad",      tipo: "texto"  },
      estado:        { label: "Estado",      tipo: "texto"  },
      saldoPendiente:{ label: "Saldo",       tipo: "moneda" },
      activo:        { label: "Activo",      tipo: "bool"   },
      _ts:           { label: "Alta",        tipo: "fecha"  },
    },
    filtros: ["activo", "estado", "ciudad"],
  },
  gastos_empleado: {
    label: "Gastos de Empleado",
    icon: "💸",
    collection: "gastos_empleado",
    campos: {
      alias:       { label: "Empleado",   tipo: "texto"  },
      categoria:   { label: "Categoría",  tipo: "texto"  },
      monto:       { label: "Monto",      tipo: "moneda" },
      descripcion: { label: "Descripción",tipo: "texto"  },
      status:      { label: "Status",     tipo: "texto"  },
      _ts:         { label: "Fecha",      tipo: "fecha"  },
    },
    filtros: ["status", "alias", "categoria"],
  },
  cortes_caja: {
    label: "Cortes de Caja",
    icon: "🏦",
    collection: "cortes_caja",
    campos: {
      alias:          { label: "Vendedor",        tipo: "texto"  },
      turno:          { label: "Turno",           tipo: "texto"  },
      totalDeclarado: { label: "Declarado",       tipo: "moneda" },
      totalSistema:   { label: "Sistema",         tipo: "moneda" },
      efectivo:       { label: "Efectivo",        tipo: "moneda" },
      tarjeta:        { label: "Tarjeta",         tipo: "moneda" },
      transferencia:  { label: "Transferencia",   tipo: "moneda" },
      status:         { label: "Status",          tipo: "texto"  },
      _ts:            { label: "Fecha",           tipo: "fecha"  },
    },
    filtros: ["status", "alias"],
  },
  liquidacion_comision: {
    label: "Comisiones",
    icon: "💰",
    collection: "liquidacion_comision",
    campos: {
      alias:         { label: "Ingeniero",     tipo: "texto"  },
      periodo:       { label: "Período",       tipo: "texto"  },
      totalVendido:  { label: "Total vendido", tipo: "moneda" },
      montoComision: { label: "Comisión",      tipo: "moneda" },
      totalPago:     { label: "Pago total",    tipo: "moneda" },
      status:        { label: "Status",        tipo: "texto"  },
    },
    filtros: ["status", "alias"],
  },
};

let _container = null;
let _fuenteActual = "pedidos";
let _resultados   = [];

export function mount(container) {
  _container = container;
  _container.innerHTML = _html();
  _bindEvents();
}

export function destroy() {}

// ─── HTML ─────────────────────────────────────────────────────────────────────

function _html() {
  const tabs = Object.entries(FUENTES).map(([k, f]) =>
    `<button class="rc-tab${k === _fuenteActual ? ' rc-tab-active' : ''}" data-fuente="${k}">${f.icon} ${f.label}</button>`
  ).join("");

  return `
<div class="rc-wrap">
  <div class="rc-header">
    <h2>📊 Reportes Configurables</h2>
  </div>

  <div class="rc-tabs">${tabs}</div>

  <div class="rc-config">
    <div class="rc-config-section">
      <label class="rc-label">Período</label>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center">
        <select id="rc-periodo" style="${estiloSelect}">
          <option value="hoy">Hoy</option>
          <option value="semana">Esta semana</option>
          <option value="mes" selected>Este mes</option>
          <option value="mes_ant">Mes anterior</option>
          <option value="custom">Personalizado</option>
        </select>
        <input id="rc-fecha-ini" type="date" style="${estiloSelect};display:none" />
        <input id="rc-fecha-fin" type="date" style="${estiloSelect};display:none" />
      </div>
    </div>

    <div class="rc-config-section">
      <label class="rc-label">Filtro adicional</label>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        <select id="rc-filtro-campo" style="${estiloSelect}"><option value="">Sin filtro</option></select>
        <input id="rc-filtro-valor" type="text" placeholder="Valor…" style="${estiloInput}" />
      </div>
    </div>

    <div class="rc-config-section">
      <label class="rc-label">Columnas a mostrar</label>
      <div id="rc-campos-check" style="display:flex;gap:.5rem;flex-wrap:wrap"></div>
    </div>

    <div style="margin-top:1rem;display:flex;gap:.5rem;flex-wrap:wrap">
      <button id="rc-btn-generar" style="background:#2563EB;color:#fff;border:none;border-radius:7px;padding:.55rem 1.4rem;font-weight:700;cursor:pointer">Generar reporte</button>
      <button id="rc-btn-csv" style="background:#16A34A;color:#fff;border:none;border-radius:7px;padding:.55rem 1.2rem;font-weight:700;cursor:pointer;display:none">⬇ Exportar CSV</button>
    </div>
  </div>

  <div id="rc-resumen" style="font-size:.85rem;color:var(--muted);margin:.75rem 0"></div>

  <div style="overflow-x:auto">
    <table id="rc-table" class="rc-tabla" style="display:none">
      <thead id="rc-thead"></thead>
      <tbody id="rc-tbody"></tbody>
    </table>
    <p id="rc-empty" style="color:var(--muted);text-align:center;padding:2rem;display:none">Sin resultados.</p>
    <p id="rc-instrucciones" style="color:var(--muted);text-align:center;padding:2rem">Configura el reporte y presiona <strong>Generar</strong>.</p>
  </div>
</div>

<style>
.rc-wrap { padding:1rem; }
.rc-header { margin-bottom:1rem; }
.rc-tabs { display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:1rem;border-bottom:2px solid var(--border);padding-bottom:.75rem; }
.rc-tab { background:none;border:1px solid var(--border);border-radius:6px;padding:.4rem .8rem;cursor:pointer;font-size:.85rem;color:var(--text); }
.rc-tab:hover { background:var(--bg2); }
.rc-tab-active { background:#2563EB;color:#fff;border-color:#2563EB;font-weight:700; }
.rc-config { background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:1rem;display:flex;flex-wrap:wrap;gap:1rem;align-items:flex-start; }
.rc-config-section { min-width:200px; }
.rc-label { display:block;font-size:.82rem;font-weight:700;margin-bottom:.35rem; }
.rc-campo-check { display:flex;align-items:center;gap:.3rem;font-size:.82rem;background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:.25rem .5rem;cursor:pointer; }
.rc-tabla { width:100%;border-collapse:collapse;font-size:.88rem; }
.rc-tabla th { background:var(--bg2);padding:.6rem .8rem;text-align:left;font-weight:600;border-bottom:2px solid var(--border);white-space:nowrap; }
.rc-tabla td { padding:.5rem .8rem;border-bottom:1px solid var(--border); }
.rc-tabla tr:hover td { background:var(--bg2); }
</style>`;
}

const estiloSelect = "padding:.4rem .6rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:.88rem";
const estiloInput  = "padding:.4rem .6rem;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font-size:.88rem;width:150px";

// ─── Eventos ─────────────────────────────────────────────────────────────────

function _bindEvents() {
  // Tabs
  _container.querySelectorAll(".rc-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      _fuenteActual = btn.dataset.fuente;
      _container.querySelectorAll(".rc-tab").forEach(b => b.classList.toggle("rc-tab-active", b === btn));
      _actualizarCampos();
      _actualizarFiltros();
    });
  });

  // Período custom
  _container.querySelector("#rc-periodo").addEventListener("change", e => {
    const custom = e.target.value === "custom";
    _container.querySelector("#rc-fecha-ini").style.display = custom ? "block" : "none";
    _container.querySelector("#rc-fecha-fin").style.display = custom ? "block" : "none";
  });

  // Generar
  _container.querySelector("#rc-btn-generar").addEventListener("click", _generar);

  // CSV
  _container.querySelector("#rc-btn-csv").addEventListener("click", _exportarCSV);

  _actualizarCampos();
  _actualizarFiltros();
}

function _actualizarCampos() {
  const fuente = FUENTES[_fuenteActual];
  const wrap   = _container.querySelector("#rc-campos-check");
  wrap.innerHTML = Object.entries(fuente.campos).map(([k, c]) => `
    <label class="rc-campo-check">
      <input type="checkbox" data-campo="${k}" checked /> ${c.label}
    </label>`).join("");
}

function _actualizarFiltros() {
  const fuente = FUENTES[_fuenteActual];
  const sel    = _container.querySelector("#rc-filtro-campo");
  sel.innerHTML = '<option value="">Sin filtro</option>' +
    fuente.filtros.map(f => `<option value="${f}">${fuente.campos[f]?.label || f}</option>`).join("");
}

// ─── Generación ───────────────────────────────────────────────────────────────

async function _generar() {
  const btn = _container.querySelector("#rc-btn-generar");
  btn.disabled = true; btn.textContent = "Generando…";

  try {
    const fuente     = FUENTES[_fuenteActual];
    const { ini, fin } = _rango();
    const filtroCampo = _container.querySelector("#rc-filtro-campo").value;
    const filtroValor = _container.querySelector("#rc-filtro-valor").value.trim();

    let q = query(
      collection(db, fuente.collection),
      where("_ts", ">=", ini),
      where("_ts", "<=", fin),
      orderBy("_ts", "desc"),
      fsLimit(500)
    );

    const snap = await getDocs(q);
    let docs   = snap.docs.map(d => ({ _id: d.id, ...d.data() }));

    // Filtro adicional en cliente (para campos no indexados)
    if (filtroCampo && filtroValor) {
      const v = filtroValor.toLowerCase();
      docs = docs.filter(d => String(d[filtroCampo] ?? "").toLowerCase().includes(v));
    }

    _resultados = docs;
    _renderTabla(fuente, docs);
  } catch (e) {
    _container.querySelector("#rc-instrucciones").textContent = `Error: ${e.message}`;
    _container.querySelector("#rc-instrucciones").style.display = "block";
  } finally {
    btn.disabled = false; btn.textContent = "Generar reporte";
  }
}

function _rango() {
  const periodo = _container.querySelector("#rc-periodo").value;
  const ahora   = new Date();
  let ini, fin;

  switch (periodo) {
    case "hoy":
      ini = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
      fin = ini + 86_400_000;
      break;
    case "semana": {
      const dow = ahora.getDay();
      ini = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - dow).getTime();
      fin = ini + 7 * 86_400_000;
      break;
    }
    case "mes_ant":
      ini = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1).getTime();
      fin = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();
      break;
    case "custom":
      ini = new Date(_container.querySelector("#rc-fecha-ini").value).getTime() || 0;
      fin = new Date(_container.querySelector("#rc-fecha-fin").value).getTime() + 86_400_000 || Date.now();
      break;
    default: // mes
      ini = new Date(ahora.getFullYear(), ahora.getMonth(), 1).getTime();
      fin = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1).getTime();
  }
  return { ini, fin };
}

function _camposSeleccionados() {
  return Array.from(_container.querySelectorAll("#rc-campos-check input:checked"))
    .map(el => el.dataset.campo);
}

function _renderTabla(fuente, docs) {
  const tabla    = _container.querySelector("#rc-table");
  const thead    = _container.querySelector("#rc-thead");
  const tbody    = _container.querySelector("#rc-tbody");
  const empty    = _container.querySelector("#rc-empty");
  const instruc  = _container.querySelector("#rc-instrucciones");
  const resumen  = _container.querySelector("#rc-resumen");
  const btnCsv   = _container.querySelector("#rc-btn-csv");

  instruc.style.display = "none";

  if (docs.length === 0) {
    tabla.style.display = "none";
    empty.style.display = "block";
    btnCsv.style.display = "none";
    resumen.textContent = "Sin resultados";
    return;
  }
  empty.style.display = "none";

  const campos = _camposSeleccionados();
  resumen.textContent = `${docs.length} registros encontrados`;
  btnCsv.style.display = "inline-block";

  // Encabezados
  thead.innerHTML = `<tr>${campos.map(c => `<th>${fuente.campos[c]?.label || c}</th>`).join("")}</tr>`;

  // Filas
  tbody.innerHTML = docs.map(d => `<tr>${campos.map(c => {
    const val  = d[c];
    const tipo = fuente.campos[c]?.tipo;
    if (tipo === "moneda")  return `<td style="font-variant-numeric:tabular-nums">$${(Number(val)||0).toLocaleString("es-MX",{minimumFractionDigits:2})}</td>`;
    if (tipo === "fecha")   return `<td style="white-space:nowrap;font-size:.8rem">${val ? new Date(val).toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"}) : "—"}</td>`;
    if (tipo === "bool")    return `<td>${val ? "✅" : "❌"}</td>`;
    return `<td>${val ?? "—"}</td>`;
  }).join("")}</tr>`).join("");

  tabla.style.display = "table";
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

function _exportarCSV() {
  const fuente = FUENTES[_fuenteActual];
  const campos = _camposSeleccionados();
  const header = campos.map(c => fuente.campos[c]?.label || c).join(",");
  const rows   = _resultados.map(d => campos.map(c => {
    const val  = d[c];
    const tipo = fuente.campos[c]?.tipo;
    if (tipo === "fecha")  return val ? new Date(val).toLocaleDateString("es-MX") : "";
    if (tipo === "bool")   return val ? "Sí" : "No";
    const str = String(val ?? "").replace(/"/g, '""');
    return str.includes(",") ? `"${str}"` : str;
  }).join(","));

  const csv  = [header, ...rows].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `reporte_${_fuenteActual}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
