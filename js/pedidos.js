// ══════════════════════════════════════════════════════════════
// pedidos.js — Historial de pedidos con filtros y detalle
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import {
  collection, query, orderBy, limit, where, onSnapshot, doc, updateDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
  window._pedCancelar = _cancelarPedido;
  window._pedEditar   = _editarPedido;
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

    const puedeEditar = Sesion.esSuperAdmin?.() ||
      ["GERENTE","ADMINISTRADOR"].includes(Sesion.rol);
    const puedeCancelar = puedeEditar || Sesion.rol === "MESA_CONTROL";
    const yaCancel = ped.status === "CANCELADO";

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

    const acnsHtml = yaCancel
      ? `<div style="margin-top:8px;font-size:11px;color:#B71C1C;font-weight:700">
           ✕ Cancelado${ped.motivoCancelacion ? ': ' + esc(ped.motivoCancelacion) : ''}</div>`
      : `<div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
          ${puedeCancelar
            ? `<button onclick="window._pedCancelar('${esc(id)}')" style="font-size:11px;padding:4px 12px;
               background:#DC2626;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600">
               ✕ Cancelar</button>` : ""}
          ${puedeEditar
            ? `<button onclick="window._pedEditar('${esc(id)}')" style="font-size:11px;padding:4px 12px;
               background:#1D5C33;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600">
               ✏️ Editar cantidades</button>` : ""}
        </div>`;

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

// ── Cancelar pedido ───────────────────────────────────────────
async function _cancelarPedido(pedidoId) {
  const razon = window.prompt("Motivo de cancelación:");
  if (razon === null) return; // usuario canceló el diálogo
  if (!razon.trim()) { window.toast?.("Ingresa un motivo", "warning"); return; }

  try {
    await updateDoc(doc(db, "pedidos", pedidoId), {
      status:             "CANCELADO",
      motivoCancelacion:  razon.trim(),
      canceladoEn:        Date.now(),
      canceladoPor:       Sesion.alias || Sesion.uid || "–"
    });
    window.toast?.("Pedido cancelado", "success");
    document.querySelector(`tr.tr-detalle[data-for="${pedidoId}"]`)?.remove();
  } catch(e) {
    console.error("[Pedidos] cancelar:", e);
    window.toast?.("Error: " + e.message, "error");
  }
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
