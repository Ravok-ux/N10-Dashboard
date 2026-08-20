// ══════════════════════════════════════════════════════════════
// pedidos.js — Historial de pedidos con filtros y detalle
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import {
  collection, query, orderBy, limit, where, onSnapshot, doc, updateDoc, getDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { registrarVentaN10, revertirVentaN10 } from "./comisiones-n10-engine.js";

let _unsub    = null;
let _filtroStatus  = "TODOS";
let _filtroAlias   = "TODOS";
let _pedidos  = [];

const STATUS = ["TODOS","BORRADOR","CONFIRMADO","EN_RUTA","ENTREGADO","FACTURADO","CANCELADO"];
const STATUS_COLOR = {
  BORRADOR:   "#9E9E9E", CONFIRMADO: "#1565C0", EN_RUTA:    "#E65100",
  ENTREGADO:  "#1B5E20", FACTURADO:  "#4527A0", CANCELADO:  "#B71C1C"
};
const fmt = new Intl.NumberFormat("es-MX", { style:"currency", currency:"MXN" });
const fmtDt = d => new Date(d?.toDate?.() ?? d).toLocaleDateString("es-MX", { day:"numeric", month:"short", year:"numeric" });

export const PedidosModule = {
  mount(container) {
    container.innerHTML = _html();
    document.getElementById("pd-tbody").innerHTML = window.skeleton?.(6, 7) ?? "";
    _bindUI();
    _escuchar();
    return () => this.destroy();
  },
  destroy() { _unsub?.(); _unsub = null; _pedidos = []; _filtroStatus = "TODOS"; _filtroAlias = "TODOS"; }
};

// ── HTML ──────────────────────────────────────────────────────
function _html() {
  return `
  <div style="padding:0 0 20px">

    <!-- Controles -->
    <div style="background:#fff;border-radius:10px;border:1px solid #E5E7EB;padding:12px 16px;
      margin-bottom:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;
      box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <span style="font-size:12px;font-weight:700;color:#374151">Estado:</span>
      ${STATUS.map(s => `
        <button class="filter-pill ${s==="TODOS"?"active":""}" data-status="${s}"
          onclick="PedidosUI.setStatus('${s}')">
          ${s === "TODOS" ? "Todos" : s.replace(/_/g," ")}
        </button>`).join("")}
      <div style="flex:1"></div>
      <select id="pd-sel-alias" onchange="PedidosUI.setAlias(this.value)"
        style="border:1px solid #D1D5DB;border-radius:6px;padding:4px 8px;font-size:12px">
        <option value="TODOS">Todos los ingenieros</option>
      </select>
    </div>

    <!-- KPIs rápidos -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px" id="pd-kpis">
      ${["Total","Confirmados","En ruta","Entregados"].map(l =>
        `<div style="background:#fff;border-radius:10px;border:1px solid #E5E7EB;padding:14px 16px;
          box-shadow:0 1px 3px rgba(0,0,0,.06)">
          <div style="font-size:20px;font-weight:800;color:#111827" id="pd-k-${l.replace(/ /g,"")}">–</div>
          <div style="font-size:11px;font-weight:600;color:#6B7280;margin-top:2px">${l.toUpperCase()}</div>
        </div>`).join("")}
    </div>

    <!-- Tabla -->
    <div style="background:var(--surface,#fff);border-radius:10px;border:1px solid var(--border,#E5E7EB);overflow:hidden;
      box-shadow:0 1px 3px rgba(0,0,0,.06)">
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:var(--surface2,#F9FAFB);border-bottom:1px solid var(--border,#E5E7EB)">
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text,#374151)">FOLIO</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text,#374151)">CLIENTE</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text,#374151)">INGENIERO</th>
              <th style="padding:10px 14px;text-align:left;font-weight:700;color:var(--text,#374151)">FECHA</th>
              <th style="padding:10px 14px;text-align:right;font-weight:700;color:var(--text,#374151)">TOTAL</th>
              <th style="padding:10px 14px;text-align:center;font-weight:700;color:var(--text,#374151)">STATUS</th>
              <th style="padding:10px 14px;text-align:center;font-weight:700;color:var(--text,#374151)">TIPO</th>
            </tr>
          </thead>
          <tbody id="pd-tbody">
            <tr><td colspan="7" style="padding:20px;text-align:center;color:#9CA3AF">Cargando…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

// ── UI Bind ───────────────────────────────────────────────────
function _bindUI() {
  window._pedCancelar  = _cancelarPedido;
  window._pedEditar    = _editarPedido;
  window._pedAvanzar   = _avanzarStatus;
  window._pedEntregado = _marcarEntregado;
  window.PedidosUI = {
    setStatus(s) {
      _filtroStatus = s;
      document.querySelectorAll("[data-status]").forEach(b =>
        b.classList.toggle("active", b.dataset.status === s));
      _renderTabla();
    },
    setAlias(a) { _filtroAlias = a; _renderTabla(); }
  };
}

// ── Firestore listener ────────────────────────────────────────
function _escuchar() {
  const q = query(collection(db, "pedidos"), orderBy("fechaPedido", "desc"), limit(500));
  _unsub = onSnapshot(q, snap => {
    _pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Poblar selector de ingenieros
    const aliases = [...new Set(_pedidos.map(p => p.ingenieroAlias || p.vendedor || "–").filter(Boolean))].sort();
    const sel = document.getElementById("pd-sel-alias");
    if (sel) {
      const prev = sel.value;
      sel.innerHTML = `<option value="TODOS">Todos los ingenieros</option>` +
        aliases.map(a => `<option value="${a}"${a === prev ? " selected" : ""}>${a}</option>`).join("");
    }

    _renderTabla();
  }, err => {
    console.error("[Pedidos]", err);
    window.toast?.("Error al cargar pedidos.", "error");
  });
}

// ── Render ────────────────────────────────────────────────────
function _renderTabla() {
  let lista = _pedidos;
  if (_filtroStatus !== "TODOS") lista = lista.filter(p => p.status === _filtroStatus);
  if (_filtroAlias  !== "TODOS") lista = lista.filter(p => (p.ingenieroAlias || p.vendedor) === _filtroAlias);

  // KPIs
  _setText("pd-k-Total",        String(lista.length));
  _setText("pd-k-Confirmados",  String(lista.filter(p => p.status === "CONFIRMADO").length));
  _setText("pd-k-Enruta",       String(lista.filter(p => p.status === "EN_RUTA").length));
  _setText("pd-k-Entregados",   String(lista.filter(p => p.status === "ENTREGADO").length));

  const tbody = document.getElementById("pd-tbody");
  if (!tbody) return;
  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:20px;text-align:center;color:#9CA3AF">
      Sin pedidos para este filtro.</td></tr>`;
    return;
  }
  const esc = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  tbody.innerHTML = lista.map(p => {
    const color = STATUS_COLOR[p.status] ?? "#9E9E9E";
    return `<tr style="border-bottom:1px solid #F3F4F6;cursor:pointer" data-id="${esc(p.id)}">
      <td style="padding:10px 14px;font-weight:700;font-variant-numeric:tabular-nums">${esc(p.folio || p.id)}</td>
      <td style="padding:10px 14px">${esc(p.clienteNombre || p.clienteId || "–")}</td>
      <td style="padding:10px 14px">${esc(p.ingenieroAlias || p.vendedor || "–")}</td>
      <td style="padding:10px 14px;color:#6B7280">${p.fechaPedido ? fmtDt(p.fechaPedido) : "–"}</td>
      <td style="padding:10px 14px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">
        ${fmt.format(p.total || 0)}</td>
      <td style="padding:10px 14px;text-align:center">
        <span style="font-size:9px;font-weight:800;padding:3px 8px;border-radius:8px;
          background:${color}1A;color:${color}">${esc(p.status?.replace(/_/g," ") || "–")}</span></td>
      <td style="padding:10px 14px;text-align:center;color:#6B7280;font-size:11px">
        ${esc(p.tipoVenta || "–")}</td>
    </tr>`;
  }).join("");

  // Click handler: expand/collapse fila de detalle (solo un listener por tbody)
  if (!tbody._detListenerAttached) {
  tbody.addEventListener("click", e => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const id = tr.dataset.id;
    const existing = tbody.querySelector(`tr.tr-detalle[data-for="${id}"]`);
    if (existing) { existing.remove(); return; }
    // Cerrar cualquier otro detalle abierto
    tbody.querySelectorAll("tr.tr-detalle").forEach(r => r.remove());
    const ped = _pedidos.find(p => p.id === id);
    if (!ped) return;
    const esc = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
    const det = document.createElement("tr");
    det.className = "tr-detalle";
    det.dataset.for = id;

    const puedeEditar   = Sesion.esSuperAdmin?.() || ["GERENTE","ADMINISTRADOR"].includes(Sesion.rol);
    const puedeMesa     = puedeEditar || Sesion.rol === "MESA_CONTROL";
    const yaCancel      = ped.status === "CANCELADO";
    const yaFacturado   = ped.status === "FACTURADO";

    const itms = ped.items || ped.productos || [];
    const itmsHtml = itms.length
      ? `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:8px">
          <tr style="color:#6B7280">
            <th style="text-align:left;padding:3px 6px;font-weight:600">Producto</th>
            <th style="text-align:center;padding:3px 6px;font-weight:600">Cant.</th>
            <th style="text-align:right;padding:3px 6px;font-weight:600">Precio</th>
            <th style="text-align:right;padding:3px 6px;font-weight:600">Subtotal</th>
          </tr>
          ${itms.map(it => `<tr>
            <td style="padding:3px 6px">${esc(it.nombre || it.producto || "–")}</td>
            <td style="padding:3px 6px;text-align:center">${it.cantidad ?? 1}</td>
            <td style="padding:3px 6px;text-align:right">$${(it.precio||0).toLocaleString("es-MX")}</td>
            <td style="padding:3px 6px;text-align:right;font-weight:700">
              $${((it.cantidad||1)*(it.precio||0)).toLocaleString("es-MX")}</td>
          </tr>`).join("")}
        </table>`
      : `<span style="color:#9CA3AF;font-size:11px">Sin detalle de productos</span>`;

    // ── Botones de workflow según status actual ─────────────────
    const btn = (txt, onclick, bg="#1D5C33") =>
      `<button onclick="${onclick}" style="font-size:11px;padding:4px 12px;
       background:${bg};color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600">${txt}</button>`;

    let acnsHtml;
    if (yaCancel) {
      acnsHtml = `<div style="margin-top:8px;font-size:11px;color:#B71C1C;font-weight:700">
        ✕ Cancelado${ped.motivoCancelacion ? ': ' + esc(ped.motivoCancelacion) : ''}</div>`;
    } else if (yaFacturado) {
      acnsHtml = `<div style="margin-top:8px;font-size:11px;color:#4527A0;font-weight:700">
        🧾 Facturado${ped.facturadoEn ? ' · ' + fmtDt(ped.facturadoEn) : ''}</div>`;
    } else {
      const btns = [];
      const s = ped.status;
      if (s === "BORRADOR"   && puedeEditar) btns.push(btn("✓ Confirmar",  `window._pedAvanzar('${esc(id)}','CONFIRMADO')`, "#1565C0"));
      if (s === "CONFIRMADO" && puedeMesa)   btns.push(btn("🚚 En ruta",   `window._pedAvanzar('${esc(id)}','EN_RUTA')`,    "#E65100"));
      if (s === "EN_RUTA"    && puedeMesa)   btns.push(btn("📦 Entregado", `window._pedEntregado('${esc(id)}')`,            "#1B5E20"));
      if (s === "ENTREGADO"  && puedeEditar) btns.push(btn("🧾 Facturado", `window._pedAvanzar('${esc(id)}','FACTURADO')`, "#4527A0"));
      if (puedeEditar) btns.push(btn("✏️ Cantidades", `window._pedEditar('${esc(id)}')`, "#374151"));
      if (puedeMesa)   btns.push(btn("✕ Cancelar",   `window._pedCancelar('${esc(id)}')`, "#DC2626"));
      acnsHtml = `<div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">${btns.join("")}</div>`;
    }

    det.innerHTML = `<td colspan="99" style="padding:12px 16px;background:var(--surface,#f8fafc)">
  <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#374151">
    <span><strong>Folio:</strong> ${esc(ped.folio || ped.id)}</span>
    <span><strong>Cliente:</strong> ${esc(ped.cliente || ped.clienteNombre || "–")}</span>
    <span><strong>Total:</strong> $${(ped.total||0).toLocaleString("es-MX",{minimumFractionDigits:2})}</span>
    <span><strong>Ingeniero:</strong> ${esc(ped.ingeniero || ped.ingenieroAlias || "–")}</span>
    ${ped.notas ? `<span><strong>Notas:</strong> ${esc(ped.notas)}</span>` : ""}
  </div>
  ${itmsHtml}
  ${acnsHtml}
</td>`;
    tr.insertAdjacentElement("afterend", det);
  });
  tbody._detListenerAttached = true;
  } // end if !_detListenerAttached
}

// ── Avanzar status ────────────────────────────────────────────
async function _avanzarStatus(pedidoId, nuevoStatus) {
  const labels = { CONFIRMADO:"confirmar", EN_RUTA:"marcar en ruta", FACTURADO:"marcar como facturado" };

  // Bloqueo de crédito al confirmar
  if (nuevoStatus === "CONFIRMADO") {
    const ped = _pedidos.find(p => p.id === pedidoId);
    const clienteId = ped?.clienteId;
    if (clienteId) {
      const cSnap = await getDoc(doc(db, "clientes", clienteId));
      if (cSnap.exists()) {
        const c = cSnap.data();
        const esGerente = Sesion.esSuperAdmin?.() || ["GERENTE","SUPER_ADMIN"].includes(Sesion.rol);
        const statusBloqueante = ["CRÍTICO","GRAVE"].includes(c.semaforoColor) || c.bloqueado;
        if (statusBloqueante && !esGerente) {
          const fmt = n => "$" + (n||0).toLocaleString("es-MX",{minimumFractionDigits:2});
          await window.modal?.({
            title:   "⛔ Crédito bloqueado",
            message: `${c.nombre || "Este cliente"} tiene semáforo ${c.semaforoColor ?? "bloqueado"}.\n` +
                     `Deuda: ${fmt(c.totalAPagarTotal ?? c.saldoPendiente)} (capital ${fmt(c.saldoCapitalTotal ?? c.saldoPendiente)} + interés ${fmt(c.interesTotal ?? 0)}).\n` +
                     `Solo GERENTE puede confirmar pedidos a clientes en mora crítica.`,
            confirm: "Entendido",
            cancel:  null,
            danger:  true,
          });
          return;
        }
        if (statusBloqueante && esGerente) {
          const fmt = n => "$" + (n||0).toLocaleString("es-MX",{minimumFractionDigits:2});
          const autorizar = await window.modal?.({
            title:   "⚠️ Cliente con mora crítica",
            message: `${c.nombre || "Este cliente"} tiene semáforo ${c.semaforoColor ?? "bloqueado"}.\n` +
                     `Deuda total: ${fmt(c.totalAPagarTotal ?? c.saldoPendiente)}.\n` +
                     `Como GERENTE puedes autorizar excepcionalmente.`,
            confirm: "Autorizar excepción",
            cancel:  "Cancelar",
            danger:  true,
          });
          if (!autorizar) return;
        }
      }
    }
  }

  const ok = await window.modal?.({
    title:   "Cambiar status",
    message: `¿${labels[nuevoStatus] || nuevoStatus} el pedido?`,
    confirm: "Sí, continuar",
    cancel:  "Cancelar"
  });
  if (!ok) return;
  const campos = {
    status: nuevoStatus,
    [`${nuevoStatus.toLowerCase()}En`]: Date.now(),
    [`${nuevoStatus.toLowerCase()}Por`]: Sesion.alias || Sesion.uid
  };
  // Mapeo de campo timestamp según status
  if (nuevoStatus === "CONFIRMADO")  { campos.confirmadoEn  = Date.now(); campos.confirmadoPor  = Sesion.alias || Sesion.uid; }
  if (nuevoStatus === "EN_RUTA")     { campos.enRutaEn      = Date.now(); campos.enRutaPor      = Sesion.alias || Sesion.uid; }
  if (nuevoStatus === "FACTURADO")   { campos.facturadoEn   = Date.now(); campos.facturadoPor   = Sesion.alias || Sesion.uid; }
  try {
    await updateDoc(doc(db, "pedidos", pedidoId), campos);
    window.toast?.(`Pedido marcado como ${nuevoStatus.replace(/_/g," ")}`, "success");
    document.querySelector(`tr.tr-detalle[data-for="${pedidoId}"]`)?.remove();
  } catch(e) {
    console.error("[Pedidos] avanzar:", e);
    window.toast?.("Error: " + e.message, "error");
  }
}

async function _marcarEntregado(pedidoId) {
  const receptor = await window.promptModal?.({
    title:       "Confirmar entrega",
    label:       "¿Quién recibió el pedido?",
    placeholder: "Nombre del receptor…"
  });
  if (receptor === null) return;
  if (!receptor.trim()) { window.toast?.("Ingresa el nombre del receptor", "warning"); return; }
  const entregadoEn = Date.now();
  try {
    await updateDoc(doc(db, "pedidos", pedidoId), {
      status:       "ENTREGADO",
      entregadoEn,
      entregadoPor: Sesion.alias || Sesion.uid,
      recibioCon:   receptor.trim()
    });
    window.toast?.("Entrega confirmada", "success");
    document.querySelector(`tr.tr-detalle[data-for="${pedidoId}"]`)?.remove();
    // Registrar comisión N10 en background — no bloquea el UI
    const ped = _pedidos.find(p => p.id === pedidoId);
    if (ped) _comisionN10Entrega({ ...ped, entregadoEn }).catch(e => console.warn("[N10 comision]", e));
  } catch(e) {
    console.error("[Pedidos] entregado:", e);
    window.toast?.("Error: " + e.message, "error");
  }
}

/**
 * Calcula litros N10 del pedido y los registra en comisiones_n10.
 * Busca metadata de producto en la colección "inventario" si el item no la trae.
 */
async function _comisionN10Entrega(ped) {
  const items = ped.items || ped.productos || [];
  if (!items.length) return;

  let litrosN10 = 0;
  for (const it of items) {
    // Metadata ya embebida en el item (pedidos nuevos)
    if (it.familia === "N10" && it.litros_por_unidad > 0) {
      litrosN10 += (it.cantidad ?? 1) * it.litros_por_unidad;
      continue;
    }
    // Fallback: lookup en inventario por productoId
    const pid = it.productoId || it.id;
    if (pid) {
      const snap = await getDoc(doc(db, "inventario", pid));
      if (snap.exists()) {
        const prod = snap.data();
        if (prod.familia === "N10" && prod.litros_por_unidad > 0) {
          litrosN10 += (it.cantidad ?? 1) * prod.litros_por_unidad;
        }
      }
    }
  }

  if (litrosN10 <= 0) return;

  const uid   = ped.ingenieroUid || ped.uid || ped.vendedorUid;
  const alias = ped.ingenieroAlias || ped.vendedor || ped.ingeniero || "–";
  if (!uid) { console.warn("[N10] Sin UID de ingeniero en pedido", ped.id); return; }

  const res = await registrarVentaN10({
    uid, alias, litros: litrosN10,
    ventaId: ped.id,
    cliente: ped.clienteNombre || ped.cliente || "–",
    fecha:   new Date(ped.entregadoEn || Date.now()),
  });
  console.info(`[N10] +${litrosN10}L → Tramo ${res.tramo} | Comisión: $${res.comisionNueva}`);
}

// ── Cancelar pedido ───────────────────────────────────────────
async function _cancelarPedido(pedidoId) {
  const razon = await window.promptModal({ title: "Cancelar pedido", label: "Motivo de cancelación", placeholder: "Motivo…" });
  if (razon === null) return; // usuario canceló el diálogo
  if (!razon.trim()) { window.toast?.("Ingresa un motivo", "warning"); return; }

  const ped = _pedidos.find(p => p.id === pedidoId);
  try {
    await updateDoc(doc(db, "pedidos", pedidoId), {
      status:             "CANCELADO",
      motivoCancelacion:  razon.trim(),
      canceladoEn:        Date.now(),
      canceladoPor:       Sesion.alias || Sesion.uid || "–"
    });
    window.toast?.("Pedido cancelado", "success");
    document.querySelector(`tr.tr-detalle[data-for="${pedidoId}"]`)?.remove();
    // Revertir comisión N10 si el pedido ya estaba entregado
    if (ped?.status === "ENTREGADO") _comisionN10Revertir(ped).catch(e => console.warn("[N10 revert]", e));
  } catch(e) {
    console.error("[Pedidos] cancelar:", e);
    window.toast?.("Error: " + e.message, "error");
  }
}

async function _comisionN10Revertir(ped) {
  const items = ped.items || ped.productos || [];
  let litrosN10 = 0;
  for (const it of items) {
    if (it.familia === "N10" && it.litros_por_unidad > 0) {
      litrosN10 += (it.cantidad ?? 1) * it.litros_por_unidad;
      continue;
    }
    const pid = it.productoId || it.id;
    if (pid) {
      const snap = await getDoc(doc(db, "inventario", pid));
      if (snap.exists()) {
        const prod = snap.data();
        if (prod.familia === "N10" && prod.litros_por_unidad > 0) {
          litrosN10 += (it.cantidad ?? 1) * prod.litros_por_unidad;
        }
      }
    }
  }
  if (litrosN10 <= 0) return;
  const uid = ped.ingenieroUid || ped.uid || ped.vendedorUid;
  if (!uid) return;
  await revertirVentaN10({ uid, litros: litrosN10, ventaId: ped.id, fecha: new Date(ped.entregadoEn || Date.now()) });
  console.info(`[N10] Revertidos ${litrosN10}L de pedido cancelado ${ped.id}`);
}

// ── Editar cantidades de pedido ───────────────────────────────
function _editarPedido(pedidoId) {
  const ped = _pedidos.find(p => p.id === pedidoId);
  if (!ped) return;
  const items = ped.items || ped.productos || [];
  if (!items.length) { window.toast?.("Este pedido no tiene items editables", "info"); return; }

  // Modal inline
  const overlay = document.createElement("div");
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;
    display:flex;align-items:center;justify-content:center`;
  const modal = document.createElement("div");
  modal.style.cssText = `background:var(--surface,#fff);border-radius:12px;padding:20px;
    width:380px;max-width:95vw;max-height:80vh;overflow-y:auto;
    box-shadow:0 8px 32px rgba(0,0,0,.2)`;
  const esc2 = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  modal.innerHTML = `
    <div style="font-weight:800;font-size:14px;margin-bottom:12px">
      ✏️ Editar cantidades — ${esc2(ped.folio || ped.id)}</div>
    <div style="font-size:11px;color:#6B7280;margin-bottom:10px">
      Solo cantidades. Los precios requieren autorización especial.</div>
    ${items.map((it, i) => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="flex:1;font-size:12px">${esc2(it.nombre || it.producto || "–")}</span>
        <input type="number" min="1" value="${it.cantidad || 1}" data-idx="${i}"
          style="width:64px;padding:4px 6px;border:1px solid #D1D5DB;border-radius:6px;
          font-size:12px;text-align:center" class="pd-edit-qty">
      </div>`).join("")}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button id="pd-edit-cancel" style="padding:6px 14px;border:1px solid #D1D5DB;border-radius:6px;
        background:none;cursor:pointer;font-size:12px">Cancelar</button>
      <button id="pd-edit-save" style="padding:6px 14px;background:#1D5C33;color:#fff;border:none;
        border-radius:6px;cursor:pointer;font-size:12px;font-weight:700">Guardar</button>
    </div>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.querySelector("#pd-edit-cancel").onclick = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  overlay.querySelector("#pd-edit-save").onclick = async () => {
    const newItems = items.map((it, i) => {
      const inp = overlay.querySelector(`.pd-edit-qty[data-idx="${i}"]`);
      const qty = Math.max(1, parseInt(inp?.value || it.cantidad || 1));
      return { ...it, cantidad: qty };
    });
    const newTotal = newItems.reduce((s, it) => s + (it.cantidad * (it.precio||0)), 0);
    try {
      await updateDoc(doc(db, "pedidos", pedidoId), {
        items:       newItems,
        productos:   newItems,
        total:       newTotal,
        editadoEn:   Date.now(),
        editadoPor:  Sesion.alias || Sesion.uid || "–"
      });
      window.toast?.("Pedido actualizado", "success");
      overlay.remove();
      document.querySelector(`tr.tr-detalle[data-for="${pedidoId}"]`)?.remove();
    } catch(e) {
      console.error("[Pedidos] editar:", e);
      window.toast?.("Error: " + e.message, "error");
    }
  };
}

function _setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
