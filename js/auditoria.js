// ══════════════════════════════════════════════════════════════
// auditoria.js — Panel de auditoría y log de cambios críticos
// Fuentes: `audit_log` (cambios sensibles) + `log_actividades` (operaciones)
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import { esc } from "./app.js";
import {
  collection, query, where, orderBy, limit,
  onSnapshot, getDocs, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let _unsub = null;

const fmtFecha = ts => {
  if (!ts) return "—";
  const ms = typeof ts === "number" ? ts : ts.toMillis?.() ?? ts;
  return new Date(ms).toLocaleString("es-MX", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
};

// Tipos de evento con su icono y nivel de severidad
const TIPOS = {
  // Audit log — cambios críticos
  PRECIO_EDITADO:         { icon: "💲", sev: "alta",  label: "Precio editado"         },
  DESCUENTO_APROBADO:     { icon: "🏷️", sev: "alta",  label: "Descuento aprobado"     },
  CLIENTE_DESBLOQUEADO:   { icon: "🔓", sev: "alta",  label: "Cliente desbloqueado"   },
  CLIENTE_BLOQUEADO:      { icon: "🔒", sev: "media", label: "Cliente bloqueado"       },
  DEVOLUCION_APROBADA:    { icon: "↩️", sev: "alta",  label: "Devolución aprobada"    },
  ANTICIPO_APROBADO:      { icon: "💵", sev: "alta",  label: "Anticipo aprobado"      },
  USUARIO_CREADO:         { icon: "👤", sev: "media", label: "Usuario creado"         },
  USUARIO_MODIFICADO:     { icon: "✏️", sev: "media", label: "Usuario modificado"     },
  ROL_CAMBIADO:           { icon: "🔑", sev: "alta",  label: "Rol cambiado"           },
  CONFIG_MODIFICADA:      { icon: "⚙️", sev: "media", label: "Configuración modificada"},
  // Log de actividades — operaciones normales
  PEDIDO_CONFIRMADO:      { icon: "🛒", sev: "baja",  label: "Pedido confirmado"      },
  PEDIDO_ENTREGADO:       { icon: "✅", sev: "baja",  label: "Pedido entregado"       },
  PEDIDO_CANCELADO:       { icon: "❌", sev: "media", label: "Pedido cancelado"       },
  REMISION_CREADA:        { icon: "📄", sev: "baja",  label: "Remisión creada"        },
  ABONO_REGISTRADO:       { icon: "💳", sev: "baja",  label: "Abono registrado"       },
  JORNADA_INICIO:         { icon: "🚀", sev: "baja",  label: "Jornada iniciada"       },
  JORNADA_FIN:            { icon: "🏁", sev: "baja",  label: "Jornada terminada"      },
  VISITA_REGISTRADA:      { icon: "📍", sev: "baja",  label: "Visita registrada"      },
};

const SEV_CLS = { alta: "badge-red", media: "badge-amber", baja: "badge-gray" };

const FUENTES = [
  { id: "audit",      label: "🔴 Cambios críticos (audit_log)"    },
  { id: "actividades",label: "📋 Actividades generales"            },
  { id: "ambas",      label: "📊 Todas"                            },
];

export const AuditoriaModule = {
  mount(container) {
    if (!_puedeVer()) {
      container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-sec)">
        Acceso restringido a administradores.</div>`;
      return;
    }
    container.innerHTML = _html();
    document.getElementById("aud-body").innerHTML = window.skeleton?.(5, 5) ?? "";
    _bindUI();
    _escuchar();
    return () => this.destroy();
  },
  destroy() { _unsub?.(); _unsub = null; }
};

function _puedeVer() {
  return Sesion.esSuperAdmin?.() || ["GERENTE","ADMINISTRADOR"].includes(Sesion.rol);
}

// ── HTML ─────────────────────────────────────────────────────
function _html() {
  const hoy = new Date().toISOString().slice(0, 10);
  const hace7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  return `
  <div class="mod-wrap">
    <div class="mod-topbar">
      <h2 class="mod-title">🔍 Panel de Auditoría</h2>
      <div class="mod-actions">
        <button id="aud-export-xlsx" style="padding:7px 12px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">⬇️ Excel</button>
      </div>
    </div>

    <!-- Filtros -->
    <div class="aud-filters">
      <select class="sel-sm" id="aud-fuente">
        ${FUENTES.map(f => `<option value="${f.id}">${f.label}</option>`).join("")}
      </select>
      <select class="sel-sm" id="aud-sev">
        <option value="">Todas las severidades</option>
        <option value="alta">🔴 Alta</option>
        <option value="media">🟡 Media</option>
        <option value="baja">⚪ Baja</option>
      </select>
      <input type="text" class="sel-sm" id="aud-usuario"
        placeholder="Filtrar por usuario…" style="width:160px">
      <span style="font-size:11px;color:var(--text-sec)">Desde</span>
      <input type="date" class="sel-sm" id="aud-desde" value="${hace7}">
      <span style="font-size:11px;color:var(--text-sec)">Hasta</span>
      <input type="date" class="sel-sm" id="aud-hasta" value="${hoy}">
      <button class="btn-primary" id="aud-filtrar">Filtrar</button>
    </div>

    <!-- Resumen de severidad -->
    <div class="kpi-row" style="margin-bottom:12px">
      <div class="kpi-card" style="border-left-color:#DC2626">
        <div class="kpi-icon">🔴</div>
        <div class="kpi-val" id="aud-kpi-alta">–</div>
        <div class="kpi-label">Severidad alta</div>
      </div>
      <div class="kpi-card" style="border-left-color:#D97706">
        <div class="kpi-icon">🟡</div>
        <div class="kpi-val" id="aud-kpi-media">–</div>
        <div class="kpi-label">Severidad media</div>
      </div>
      <div class="kpi-card" style="border-left-color:#6B7280">
        <div class="kpi-icon">📋</div>
        <div class="kpi-val" id="aud-kpi-total">–</div>
        <div class="kpi-label">Total eventos</div>
      </div>
    </div>

    <div style="overflow-x:auto">
      <table class="data-table" id="aud-table">
        <thead>
          <tr>
            <th>FECHA / HORA</th><th>TIPO</th><th>SEV.</th>
            <th>USUARIO</th><th>DESCRIPCIÓN</th><th>REFERENCIA</th>
          </tr>
        </thead>
        <tbody id="aud-body">
          <tr><td colspan="6" style="padding:24px;text-align:center;color:var(--text-sec)">Cargando…</td></tr>
        </tbody>
      </table>
    </div>
  </div>`;
}

// ── Bind ─────────────────────────────────────────────────────
function _bindUI() {
  document.getElementById("aud-filtrar")?.addEventListener("click", _escuchar);
  document.getElementById("aud-export-xlsx")?.addEventListener("click", _exportarExcel);
}

// ── Listener combinado ────────────────────────────────────────
let _rows = [];

function _escuchar() {
  if (_unsub) { _unsub(); _unsub = null; }

  const fuente   = document.getElementById("aud-fuente")?.value || "audit";
  const sevFiltro = document.getElementById("aud-sev")?.value;
  const desde    = document.getElementById("aud-desde")?.value;
  const hasta    = document.getElementById("aud-hasta")?.value;

  const [dy,dm,dd] = (desde || "").split("-").map(Number);
  const [hy,hm,hd] = (hasta  || "").split("-").map(Number);
  const desdeTs = desde ? new Date(dy,dm-1,dd,0,0,0).getTime()   : Date.now() - 7*86400000;
  const hastaTs = hasta ? new Date(hy,hm-1,hd,23,59,59).getTime(): Date.now();

  const coleccion = fuente === "actividades" ? "log_actividades" : "audit_log";

  let q = query(
    collection(db, coleccion),
    where("_ts", ">=", desdeTs),
    where("_ts", "<=", hastaTs),
    orderBy("_ts", "desc"),
    limit(500)
  );

  const tbody = document.getElementById("aud-body");
  if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="padding:24px;text-align:center">Cargando…</td></tr>`;

  _unsub = onSnapshot(q, snap => {
    let rows = snap.docs.map(d => ({ id: d.id, _fuente: coleccion, ...d.data() }));

    // Filtro adicional en cliente — usuario
    const uFilter = document.getElementById("aud-usuario")?.value.trim().toLowerCase();
    if (uFilter) rows = rows.filter(r =>
      (r.alias || r.usuario || r.quien || "").toLowerCase().includes(uFilter));
    if (sevFiltro) rows = rows.filter(r => {
      const cfg = TIPOS[r.tipo];
      return cfg?.sev === sevFiltro;
    });

    _rows = rows;
    _renderTabla(rows);
  }, err => {
    console.error("[Auditoria]", err);
    const tbody = document.getElementById("aud-body");
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="color:#DC2626;padding:16px;text-align:center">
      Error: ${esc(err.message)}</td></tr>`;
  });
}

// ── Render ────────────────────────────────────────────────────
function _renderTabla(rows) {
  const alta  = rows.filter(r => (TIPOS[r.tipo]?.sev || "baja") === "alta").length;
  const media = rows.filter(r => (TIPOS[r.tipo]?.sev || "baja") === "media").length;
  const el = id => document.getElementById(id);
  if (el("aud-kpi-alta"))  el("aud-kpi-alta").textContent  = alta;
  if (el("aud-kpi-media")) el("aud-kpi-media").textContent = media;
  if (el("aud-kpi-total")) el("aud-kpi-total").textContent = rows.length;

  const tbody = document.getElementById("aud-body");
  if (!tbody) return;
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:32px;text-align:center;color:var(--text-sec)">
      Sin eventos en el período seleccionado</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const cfg  = TIPOS[r.tipo] || { icon: "•", sev: "baja", label: r.tipo || "Evento" };
    const ts   = r._ts || r.timestamp?.toMillis?.() || 0;
    const desc = _descripcion(r);
    const ref  = r.folio || r.pedidoId || r.remision || r.clienteNombre || r.productoNombre || "–";
    const rowBg = cfg.sev === "alta" ? "background:rgba(220,38,38,.04)" : "";

    return `<tr style="${rowBg}">
      <td style="white-space:nowrap;font-size:12px;color:var(--text-sec)">${fmtFecha(ts)}</td>
      <td>
        <span style="font-size:14px">${cfg.icon}</span>
        <span style="font-size:11px;font-weight:700;margin-left:4px">${esc(cfg.label)}</span>
      </td>
      <td><span class="badge ${SEV_CLS[cfg.sev] || "badge-gray"}">${cfg.sev.toUpperCase()}</span></td>
      <td style="font-weight:600">${esc(r.alias || r.usuario || r.quien || r.quienRegistro || "–")}</td>
      <td style="font-size:12px;max-width:300px">${esc(desc)}</td>
      <td style="font-size:11px;color:var(--text-sec);white-space:nowrap">${esc(String(ref))}</td>
    </tr>`;
  }).join("");
}

function _descripcion(r) {
  switch (r.tipo) {
    case "PRECIO_EDITADO":
      return `${r.productoNombre || r.producto || "–"}: ${r.precioAntes ?? "?"} → ${r.precioDespues ?? "?"}`;
    case "DESCUENTO_APROBADO":
      return `${r.folio || "–"} · ${r.descuento ?? "?"}% · ${r.clienteNombre || "–"}`;
    case "CLIENTE_DESBLOQUEADO":
      return `${r.clienteNombre || "–"} desbloqueado${r.horas ? " por " + r.horas + "h" : ""}`;
    case "DEVOLUCION_APROBADA":
      return `${r.folio || "–"} · $${Number(r.monto || 0).toLocaleString("es-MX")}`;
    case "ANTICIPO_APROBADO":
      return `${r.alias || "–"} · $${Number(r.monto || 0).toLocaleString("es-MX")}`;
    case "ROL_CAMBIADO":
      return `${r.usuario || "–"}: ${r.rolAntes || "?"} → ${r.rolDespues || "?"}`;
    case "PEDIDO_CONFIRMADO":
      return `${r.folio || "–"} · $${Number(r.total || 0).toLocaleString("es-MX")} · ${r.clienteNombre || "–"}`;
    case "ABONO_REGISTRADO":
      return `$${Number(r.monto || 0).toLocaleString("es-MX")} → ${r.remision || "–"}`;
    default:
      return r.descripcion || r.detalle || r.notas || "–";
  }
}

// ── Exportar Excel ────────────────────────────────────────────
function _exportarExcel() {
  if (!_rows.length) { window.toast?.("Sin datos para exportar", "warning"); return; }
  const headers = ["Fecha/Hora","Tipo","Severidad","Usuario","Descripción","Referencia"];
  const data = _rows.map(r => {
    const cfg = TIPOS[r.tipo] || { label: r.tipo || "–", sev: "baja" };
    const ts  = r._ts || r.timestamp?.toMillis?.() || 0;
    return [
      fmtFecha(ts), cfg.label, cfg.sev,
      r.alias || r.usuario || r.quien || r.quienRegistro || "–",
      _descripcion(r),
      r.folio || r.pedidoId || r.remision || r.clienteNombre || "–"
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Auditoría");
  XLSX.writeFile(wb, `N10-auditoria-${new Date().toISOString().slice(0,10)}.xlsx`);
  window.toast?.("Exportando Excel…", "info");
}
