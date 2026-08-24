// Cotizaciones — Panel web S3
import { db } from './firebase-config.js';
import { Sesion } from './auth.js';
import { getTipoCambio, formatMoneda } from './multimoneda.js';
import {
  collection, doc, addDoc, updateDoc, getDoc,
  onSnapshot, query, orderBy, where, getDocs,
  serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#x27;'}[c]));
const fmtMXN = v => Number(v || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const fmtMoneda = (v, moneda) => moneda === 'USD'
  ? `USD $${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
  : fmtMXN(v);
const fmtFecha = ts => ts ? new Date(ts).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const STATUS_LABELS = {
  BORRADOR:   { label: 'Borrador',            cls: 'badge-gray'   },
  ENVIADA:    { label: 'Enviada',              cls: 'badge-yellow' },
  APROBADA:   { label: 'Aprobada',             cls: 'badge-green'  },
  RECHAZADA:  { label: 'Rechazada',            cls: 'badge-red'    },
  EXPIRADA:   { label: 'Expirada',             cls: 'badge-gray'   },
  CONVERTIDA: { label: 'Convertida en pedido', cls: 'badge-purple' }
};

export const CotizacionesPanelModule = (() => {
  let _unsub = null;
  let _vigenciaDias = 15;

  // ── Init ──────────────────────────────────────────────────────────────

  async function init(container) {
    // Leer vigencia desde /configuracion/cotizaciones
    try {
      const cfgSnap = await getDoc(doc(db, 'configuracion', 'cotizaciones'));
      if (cfgSnap.exists()) _vigenciaDias = cfgSnap.data().vigenciaDias || 15;
    } catch (_) {}

    container.innerHTML = `
      <style>
        .cot-kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; margin-bottom:16px; }
        .cot-kpi { background:var(--surface); border:1px solid var(--border); border-radius:10px;
          padding:12px 14px; display:flex; flex-direction:column; gap:4px; }
        .cot-kpi-num { font-size:22px; font-weight:800; color:var(--text-primary); font-variant-numeric:tabular-nums; }
        .cot-kpi-lbl { font-size:10px; font-weight:600; color:#9CA3AF; text-transform:uppercase; letter-spacing:.05em; }
        .cot-kpi-dot { width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:4px; }
        .cot-toolbar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
        #tablaCotizaciones tbody tr:hover { background:var(--surface); cursor:pointer; }
        #tablaCotizaciones tbody tr { transition:background .1s; }
        .cot-folio { font-weight:700; font-size:11.5px; color:var(--text-primary); font-family:monospace; }
        .cot-monto { font-variant-numeric:tabular-nums; font-weight:600; text-align:right; }
        .cot-vence-warn { color:#B91C1C; font-weight:700; }
      </style>

      <div class="view-header" style="margin-bottom:12px">
        <div>
          <h2 style="margin:0">Cotizaciones</h2>
          <div style="font-size:11px;color:#9CA3AF;margin-top:2px" id="cotSubtitulo">Cargando…</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn-secondary" id="btnConfigVigencia">⚙ Vigencia: ${_vigenciaDias}d</button>
        </div>
      </div>

      <!-- KPIs -->
      <div class="cot-kpi-grid" id="cotKpis">
        <div class="cot-kpi"><div class="cot-kpi-num" id="kpi-total">—</div><div class="cot-kpi-lbl">Total</div></div>
        <div class="cot-kpi"><div class="cot-kpi-num" style="color:#D97706" id="kpi-enviadas">—</div><div class="cot-kpi-lbl"><span class="cot-kpi-dot" style="background:#D97706"></span>Enviadas</div></div>
        <div class="cot-kpi"><div class="cot-kpi-num" style="color:#16A34A" id="kpi-aprobadas">—</div><div class="cot-kpi-lbl"><span class="cot-kpi-dot" style="background:#16A34A"></span>Aprobadas</div></div>
        <div class="cot-kpi"><div class="cot-kpi-num" style="color:#DC2626" id="kpi-rechazadas">—</div><div class="cot-kpi-lbl"><span class="cot-kpi-dot" style="background:#DC2626"></span>Rechazadas</div></div>
        <div class="cot-kpi"><div class="cot-kpi-num" style="color:#7C3AED" id="kpi-convertidas">—</div><div class="cot-kpi-lbl"><span class="cot-kpi-dot" style="background:#7C3AED"></span>Convertidas</div></div>
      </div>

      <!-- Filtro -->
      <div class="cot-toolbar">
        <span style="font-size:11px;font-weight:700;color:#6B7280">Filtrar:</span>
        ${Object.entries(STATUS_LABELS).map(([k,v]) =>
          `<button class="cot-filtro-btn" data-status="${k}"
            style="padding:4px 10px;border-radius:20px;border:1px solid var(--border);
              background:transparent;font-size:11px;font-weight:600;color:#6B7280;cursor:pointer">
            ${v.label}
          </button>`).join('')}
        <button class="cot-filtro-btn" data-status="" style="padding:4px 10px;border-radius:20px;
          border:1px solid var(--border);background:var(--surface);font-size:11px;
          font-weight:700;color:var(--text-primary);cursor:pointer">Todos</button>
        <input id="cotBusqueda" type="search" placeholder="Buscar folio / cliente…"
          style="margin-left:auto;padding:5px 10px;border:1px solid var(--border);border-radius:7px;
            background:var(--surface);color:var(--text-primary);font-size:11.5px;min-width:180px">
      </div>

      <div class="tabla-wrapper">
        <table class="tabla" id="tablaCotizaciones">
          <thead><tr>
            <th>Folio</th>
            <th>Cliente</th>
            <th>Ingeniero</th>
            <th style="text-align:right">Total</th>
            <th>Creada</th>
            <th>Vence</th>
            <th>Estado</th>
            <th>Acciones</th>
          </tr></thead>
          <tbody id="tbodyCot"></tbody>
        </table>
      </div>

      <!-- Panel detalle de cotización -->
      <div id="panelCot" class="side-panel hidden">
        <div class="side-panel-header">
          <h3 id="panelCotTitulo">Cotización</h3>
          <button id="cerrarPanelCot" class="btn-icon">✕</button>
        </div>
        <div id="panelCotBody"></div>
      </div>

      <!-- Modal config vigencia -->
      <div id="modalVigencia" class="modal-overlay hidden">
        <div class="modal-box">
          <h4>Vigencia por defecto</h4>
          <form id="formVigencia" novalidate>
            <label>Días de vigencia
              <input name="vigenciaDias" type="number" class="input-text" min="1" max="365" value="${_vigenciaDias}" required>
            </label>
            <div class="form-actions">
              <button type="button" id="btnCancelarVigencia" class="btn-secondary">Cancelar</button>
              <button type="submit" class="btn-primary">Guardar</button>
            </div>
          </form>
        </div>
      </div>
    `;

    _bindUI(container);
    _escuchar(container, '');
  }

  // ── Escucha Firestore ─────────────────────────────────────────────────

  function _escuchar(container, filtroStatus) {
    if (_unsub) _unsub();
    let q = query(collection(db, 'cotizaciones'), orderBy('creadaEn', 'desc'), limit(300));
    if (filtroStatus) q = query(collection(db, 'cotizaciones'), where('status', '==', filtroStatus), orderBy('creadaEn', 'desc'), limit(300));

    _unsub = onSnapshot(q, snap => {
      const tbody = container.querySelector('#tbodyCot');
      if (snap.empty) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#9CA3AF">Sin cotizaciones.</td></tr>'; return; }
      const ahora = Date.now();

      // KPIs
      const counts = { ENVIADA: 0, APROBADA: 0, RECHAZADA: 0, CONVERTIDA: 0 };
      snap.docs.forEach(d => { const s = d.data().status; if (counts[s] !== undefined) counts[s]++; });
      const setKpi = (id, val) => { const el = container.querySelector(id); if (el) el.textContent = val; };
      setKpi('#kpi-total', snap.size);
      setKpi('#kpi-enviadas', counts.ENVIADA);
      setKpi('#kpi-aprobadas', counts.APROBADA);
      setKpi('#kpi-rechazadas', counts.RECHAZADA);
      setKpi('#kpi-convertidas', counts.CONVERTIDA);
      const sub = container.querySelector('#cotSubtitulo');
      if (sub) sub.textContent = `${snap.size} cotizaciones · ${counts.APROBADA} aprobadas · ${counts.CONVERTIDA} convertidas en pedido`;

      tbody.innerHTML = snap.docs.map(d => {
        const c = d.data();
        const statusInfo = STATUS_LABELS[c.status] || { label: c.status, cls: 'badge-gray' };
        const expirada = c.venceEn > 0 && c.venceEn < ahora && c.status !== 'EXPIRADA' && c.status !== 'CONVERTIDA';
        return `<tr>
          <td><span class="cot-folio">${esc(c.folio)}</span></td>
          <td>${esc(c.clienteNombre)}</td>
          <td style="color:#9CA3AF;font-size:11px">${esc(c.ingenieroAlias)}</td>
          <td class="cot-monto">${fmtMoneda(c.total, c.moneda)}${c.moneda === 'USD' ? ` <small style="color:#9CA3AF">TC ${c.tipoCambio?.toFixed(2) || '?'}</small>` : ''}</td>
          <td style="font-size:11px;color:#9CA3AF">${fmtFecha(c.creadaEn)}</td>
          <td class="${expirada ? 'cot-vence-warn' : ''}" style="font-size:11px">${fmtFecha(c.venceEn)}${expirada ? ' ⚠️' : ''}</td>
          <td><span class="${statusInfo.cls}">${statusInfo.label}</span></td>
          <td>
            <div style="display:flex;gap:4px">
              <button class="btn-sm btn-ver-cot" data-id="${esc(d.id)}">Ver</button>
              ${_puedeConvertir(c) ? `<button class="btn-sm btn-convertir" data-id="${esc(d.id)}" style="background:var(--color-primary);color:#fff">→ Pedido</button>` : ''}
            </div>
          </td>
        </tr>`;
      }).join('');

      tbody.querySelectorAll('.btn-ver-cot').forEach(btn =>
        btn.addEventListener('click', () => {
          const docSnap = snap.docs.find(d => d.id === btn.dataset.id);
          if (docSnap) _abrirDetalle(container, docSnap);
        }));

      tbody.querySelectorAll('.btn-convertir').forEach(btn =>
        btn.addEventListener('click', () => _convertirEnPedido(btn.dataset.id)));
    });
  }

  function _puedeConvertir(c) {
    return ['ENVIADA', 'APROBADA'].includes(c.status);
  }

  // ── Detalle panel ─────────────────────────────────────────────────────

  function _abrirDetalle(container, docSnap) {
    const c = docSnap.data();
    const items = c.items || [];
    const panel = container.querySelector('#panelCot');
    container.querySelector('#panelCotTitulo').textContent = c.folio || 'Cotización';

    const statusInfo = STATUS_LABELS[c.status] || { label: c.status, cls: 'badge-gray' };
    const totalLine = items.reduce((s, i) => s + (i.subtotal || 0), 0);

    const itemsHtml = items.map(i => `
      <tr>
        <td>${esc(i.nombreProducto)}</td>
        <td class="num">${Number(i.cantidad).toLocaleString('es-MX')}</td>
        <td class="num">${fmtMXN(i.precioUnitario)}</td>
        <td class="num">${fmtMXN(i.subtotal)}</td>
      </tr>
    `).join('');

    container.querySelector('#panelCotBody').innerHTML = `
      <div style="padding:12px">
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <span class="${statusInfo.cls}">${statusInfo.label}</span>
          <span>Vigencia: ${c.vigenciaDias || 15} días</span>
          <span>Vence: ${fmtFecha(c.venceEn)}</span>
          ${c.moneda === 'USD' ? `<span style="background:#DBEAFE;color:#1E40AF;border-radius:4px;padding:.15rem .4rem;font-size:.78rem;font-weight:700">💱 USD · TC $${c.tipoCambio?.toFixed(4) || '?'} · MXN ${fmtMXN(c.totalMxn || (c.total * (c.tipoCambio || 1)))}</span>` : '<span style="background:#D1FAE5;color:#065F46;border-radius:4px;padding:.15rem .4rem;font-size:.78rem;font-weight:700">🇲🇽 MXN</span>'}
        </div>
        <p><strong>Cliente:</strong> ${esc(c.clienteNombre)}</p>
        <p><strong>Ingeniero:</strong> ${esc(c.ingenieroAlias)}</p>
        <p><strong>Creada:</strong> ${fmtFecha(c.creadaEn)}</p>
        ${c.notas ? `<p><strong>Notas:</strong> ${esc(c.notas)}</p>` : ''}
        <table class="tabla" style="margin-top:12px">
          <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
          <tbody>${itemsHtml}</tbody>
          <tfoot><tr>
            <td colspan="3" style="text-align:right;font-weight:bold">TOTAL</td>
            <td class="num"><strong>${fmtMXN(c.total || totalLine)}</strong></td>
          </tr></tfoot>
        </table>
        ${_puedeConvertir(c) ? `
        <div style="margin-top:16px;display:flex;gap:8px">
          <button class="btn-primary" id="btnPanelConvertir" data-id="${esc(docSnap.id)}">Convertir en pedido</button>
          <select id="selActualizarStatus" class="input-select">
            <option value="">Actualizar estado…</option>
            <option value="APROBADA">Aprobar</option>
            <option value="RECHAZADA">Rechazar</option>
          </select>
        </div>` : ''}
        ${c.pedidoFolio ? `<p style="margin-top:8px;color:var(--color-primary)">Pedido: <strong>${esc(c.pedidoFolio)}</strong></p>` : ''}
      </div>
    `;

    panel.querySelector('#btnPanelConvertir')?.addEventListener('click', e => {
      _convertirEnPedido(e.target.dataset.id);
    });
    panel.querySelector('#selActualizarStatus')?.addEventListener('change', async e => {
      const st = e.target.value;
      if (!st) return;
      if (!await window.modal({ title: "Actualizar status", message: `¿Marcar esta cotización como "${STATUS_LABELS[st]?.label}"?` })) { e.target.value = ''; return; }
      try {
        await updateDoc(doc(db, 'cotizaciones', docSnap.id), { status: st, actualizadoEn: serverTimestamp(), actualizadoPor: Sesion.alias });
        panel.classList.add('hidden');
      } catch (err) { window.toast?.("Error: " + err.message, "error"); }
    });

    panel.classList.remove('hidden');
  }

  // ── Convertir en pedido ───────────────────────────────────────────────

  async function _convertirEnPedido(cotizacionId) {
    if (!await window.modal({ title: "Convertir en pedido", message: "¿Convertir esta cotización en un pedido? Se registrará en Firestore.", confirmLabel: "Convertir" })) return;
    try {
      const cotSnap = await getDoc(doc(db, 'cotizaciones', cotizacionId));
      if (!cotSnap.exists()) { window.toast?.("Cotización no encontrada.", "error"); return; }
      const c = cotSnap.data();

      // Generar folio de pedido
      const cfgRef = doc(db, 'configuracion_erp', 'ULTIMO_FOLIO_PEDIDO_WEB');
      const cfgSnap = await getDoc(cfgRef);
      const ultimo = parseInt(cfgSnap.exists() ? cfgSnap.data().valor : '0', 10) || 0;
      const siguiente = ultimo + 1;
      const folioPed = 'N10-PED-' + String(siguiente).padStart(5, '0');
      await updateDoc(cfgRef.parent ? cfgRef : doc(db, 'configuracion_erp', 'ULTIMO_FOLIO_PEDIDO_WEB'), { valor: String(siguiente) }).catch(() =>
        addDoc(collection(db, 'configuracion_erp'), { clave: 'ULTIMO_FOLIO_PEDIDO_WEB', valor: String(siguiente) }));

      const pedido = {
        folio:          folioPed,
        clienteId:      c.clienteId,
        clienteNombre:  c.clienteNombre,
        ingenieroAlias: c.ingenieroAlias,
        tipoPedido:     'VENTA_RUTA',
        tipoVenta:      'CONTADO',
        status:         'BORRADOR',
        subtotal:       c.subtotal,
        total:          c.total,
        totalMxn:       c.totalMxn || c.total,
        moneda:         c.moneda || 'MXN',
        tipoCambio:     c.tipoCambio || 1,
        items:          c.items || [],
        cotizacionId:   cotizacionId,
        cotizacionFolio: c.folio,
        creadoEn:       serverTimestamp(),
        creadoPor:      Sesion.alias
      };
      const pedRef = await addDoc(collection(db, 'pedidos'), pedido);
      await updateDoc(doc(db, 'cotizaciones', cotizacionId), {
        status:         'CONVERTIDA',
        pedidoFirestoreId: pedRef.id,
        pedidoFolio:    folioPed,
        actualizadoEn:  serverTimestamp()
      });
      document.querySelector('#panelCot')?.classList.add('hidden');
      window.toast?.(`Pedido ${folioPed} creado`, 'success');
      if (await window.modal({ title: 'Pedido creado', message: `${folioPed} fue creado en borrador. ¿Ir al módulo de Pedidos?`, confirmLabel: 'Ir a Pedidos', cancelLabel: 'Quedarme' })) {
        window.navigate?.('pedidos');
      }
    } catch (err) {
      window.toast?.('Error al convertir: ' + err.message, 'error');
    }
  }

  // ── Config vigencia ───────────────────────────────────────────────────

  function _bindUI(container) {
    container.querySelector('#cerrarPanelCot').addEventListener('click', () =>
      container.querySelector('#panelCot').classList.add('hidden'));

    container.querySelector('#btnConfigVigencia').addEventListener('click', () =>
      container.querySelector('#modalVigencia').classList.remove('hidden'));

    container.querySelector('#btnCancelarVigencia').addEventListener('click', () =>
      container.querySelector('#modalVigencia').classList.add('hidden'));

    container.querySelector('#formVigencia').addEventListener('submit', async e => {
      e.preventDefault();
      const dias = parseInt(e.target.vigenciaDias.value, 10);
      if (isNaN(dias) || dias < 1) { window.toast?.('Ingresa días válidos (mínimo 1)', 'error'); return; }
      try {
        await updateDoc(doc(db, 'configuracion', 'cotizaciones'), { vigenciaDias: dias, actualizadoPor: Sesion.alias, actualizadoEn: serverTimestamp() }).catch(async () => {
          await addDoc(collection(db, 'configuracion'), { vigenciaDias: dias });
        });
        _vigenciaDias = dias;
        container.querySelector('#btnConfigVigencia').textContent = `⚙ Vigencia: ${dias}d`;
        container.querySelector('#modalVigencia').classList.add('hidden');
      } catch (err) { window.toast?.('Error: ' + err.message, 'error'); }
    });

    // Filtro por botones de estado
    let _filtroActivo = '';
    container.querySelectorAll('.cot-filtro-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _filtroActivo = btn.dataset.status;
        container.querySelectorAll('.cot-filtro-btn').forEach(b => {
          b.style.background = b === btn ? 'var(--surface)' : 'transparent';
          b.style.color = b === btn ? 'var(--text-primary)' : '#6B7280';
          b.style.borderColor = b === btn ? 'var(--color-primary,#3B82F6)' : 'var(--border)';
        });
        _escuchar(container, _filtroActivo);
      });
    });

    // Búsqueda local
    container.querySelector('#cotBusqueda').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      container.querySelectorAll('#tbodyCot tr').forEach(tr => {
        tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });
  }

  function destroy() {
    if (_unsub) { _unsub(); _unsub = null; }
  }

  return { init, mount: init, destroy };
})();
