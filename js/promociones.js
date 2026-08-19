// W5 — Motor de Promociones S3
import { db } from './firebase-config.js';
import { Sesion } from './auth.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc,
  onSnapshot, query, orderBy, where, getDocs,
  serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#x27;'}[c]));

const TIPOS_PROMO = {
  DESCUENTO_MONTO_PEDIDO:    'Descuento $ en pedido',
  DESCUENTO_MONTO_PRODUCTO:  'Descuento $ en producto',
  PRODUCTO_GRATIS:           'Producto gratis',
  PRECIO_FLASH:              'Precio flash',
  PUNTOS_LEALTAD:            'Puntos de lealtad'
};

// Colección unificada usada por el motor del APK y el panel web
const COL_CAMPANAS   = 'campanas_promociones';
const COL_PUNTOS     = 'puntos_cliente';
const COL_HISTORIAL  = 'historial_puntos';

export const PromocionesModule = (() => {
  let _unsubCampanas = null;
  let _unsubPuntos   = null;

  function _puedeConfig() {
    return Sesion.tieneFlag('PUEDE_CONFIG_PROMOCIONES');
  }

  // ── Init ──────────────────────────────────────────────────────────────

  function init(container) {
    const btnNuevo = _puedeConfig()
      ? '<button class="btn-primary" id="btnNuevaCampana">+ Nueva Campaña</button>'
      : '';
    container.innerHTML = `
      <div class="view-header">
        <h2>Motor de Promociones</h2>
        ${btnNuevo}
      </div>

      <div class="promo-tabs">
        <button class="tab-btn active" data-tab="campanas">Campañas</button>
        <button class="tab-btn" data-tab="puntos">Puntos por cliente</button>
        <button class="tab-btn" data-tab="historial">Historial de canje</button>
      </div>

      <div id="tabCampanas" class="tab-panel">
        <div id="gridCampanas" class="cards-grid"></div>
      </div>

      <div id="tabPuntos" class="tab-panel hidden">
        <div class="filter-bar">
          <input id="buscarCliente" class="input-search" type="text" placeholder="Buscar cliente…">
        </div>
        <div id="listaPuntos" class="tabla-wrapper">
          <table class="tabla">
            <thead><tr>
              <th>Cliente</th><th>Puntos</th><th>Última actividad</th><th>Acciones</th>
            </tr></thead>
            <tbody id="tbodyPuntos"></tbody>
          </table>
        </div>
      </div>

      <div id="tabHistorial" class="tab-panel hidden">
        <div id="listaHistorial" class="tabla-wrapper">
          <table class="tabla">
            <thead><tr>
              <th>Fecha</th><th>Cliente</th><th>Campaña</th><th>Puntos</th><th>Tipo</th>
            </tr></thead>
            <tbody id="tbodyHistorial"></tbody>
          </table>
        </div>
      </div>

      <!-- Panel lateral de campaña -->
      <div id="panelCampana" class="side-panel hidden">
        <div class="side-panel-header">
          <h3 id="panelCampanaTitulo">Nueva campaña</h3>
          <button id="cerrarPanelCampana" class="btn-icon">✕</button>
        </div>
        <form id="formCampana" class="side-panel-form" novalidate>
          <label>Nombre <input name="nombre" class="input-text" required maxlength="80"></label>
          <label>Descripción <textarea name="descripcion" class="input-text" rows="2" maxlength="300"></textarea></label>
          <label>Tipo de promoción
            <select name="tipo" id="selectTipoPromo" class="input-select">
              ${Object.entries(TIPOS_PROMO).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}
            </select>
          </label>
          <label>Fecha inicio <input name="fechaInicio" type="date" class="input-text" required></label>
          <label>Fecha fin <input name="fechaFin" type="date" class="input-text" required></label>

          <!-- Campos dinámicos por tipo -->
          <div id="camposTipo"></div>

          <label class="label-check"><input name="activa" type="checkbox" checked> Activa</label>
          <div class="form-actions">
            <button type="button" id="btnCancelarCampana" class="btn-secondary">Cancelar</button>
            <button type="submit" class="btn-primary">Guardar</button>
          </div>
        </form>
      </div>

      <!-- Modal ajuste manual de puntos -->
      <div id="modalPuntos" class="modal-overlay hidden">
        <div class="modal-box">
          <h4 id="modalPuntosTitulo">Ajustar puntos</h4>
          <form id="formAjustePuntos" novalidate>
            <input type="hidden" name="clienteId">
            <label>Operación
              <select name="operacion" class="input-select">
                <option value="sumar">Sumar puntos</option>
                <option value="restar">Restar puntos</option>
                <option value="canje">Registrar canje</option>
              </select>
            </label>
            <label>Puntos <input name="puntos" type="number" class="input-text" min="1" required></label>
            <label>Campaña <select name="campanaId" class="input-select"><option value="">Sin campaña</option></select></label>
            <label>Nota <input name="nota" class="input-text" maxlength="200"></label>
            <div class="form-actions">
              <button type="button" id="btnCancelarPuntos" class="btn-secondary">Cancelar</button>
              <button type="submit" class="btn-primary">Confirmar</button>
            </div>
          </form>
        </div>
      </div>
    `;

    _bindTabs(container);
    _bindCampanas(container);
    _bindPuntos(container);
    _escucharCampanas(container);
    _escucharHistorial(container);
  }

  // ── Tabs ──────────────────────────────────────────────────────────────

  function _bindTabs(container) {
    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        container.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
        const panel = container.querySelector(`#tab${btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)}`);
        if (panel) panel.classList.remove('hidden');
        if (btn.dataset.tab === 'puntos') _cargarPuntos(container, '');
      });
    });
  }

  // ── Campos dinámicos según tipo ───────────────────────────────────────

  function _renderCamposTipo(tipo, datos = {}) {
    switch (tipo) {
      case 'DESCUENTO_MONTO_PEDIDO':
        return `
          <label>Umbral de pedido (MXN)
            <input name="umbralPedido" type="number" class="input-text" min="0" step="1" value="${datos.umbralPedido ?? 1000}" required>
          </label>
          <label>Monto de descuento (MXN $)
            <input name="montoDescuento" type="number" class="input-text" min="1" step="1" value="${datos.montoDescuento ?? 100}" required>
          </label>`;

      case 'DESCUENTO_MONTO_PRODUCTO':
        return `
          <label>ID Pretoriano del producto
            <input name="productoIdPretoriano" type="number" class="input-text" min="1" value="${datos.productoIdPretoriano ?? ''}" required placeholder="ej. 4521">
          </label>
          <label>Umbral de compra del producto (MXN $ — 0 = siempre aplica)
            <input name="umbralProducto" type="number" class="input-text" min="0" step="1" value="${datos.umbralProducto ?? 0}">
          </label>
          <label>Monto de descuento (MXN $)
            <input name="montoDescuento" type="number" class="input-text" min="1" step="1" value="${datos.montoDescuento ?? 50}" required>
          </label>`;

      case 'PRODUCTO_GRATIS':
        return `
          <label>Modo
            <select name="modoGratis" class="input-select">
              <option value="POR_MONTO" ${(datos.modoGratis ?? 'POR_MONTO') === 'POR_MONTO' ? 'selected' : ''}>Por monto de pedido</option>
              <option value="POR_PRODUCTO" ${datos.modoGratis === 'POR_PRODUCTO' ? 'selected' : ''}>Por compra de producto específico</option>
            </select>
          </label>
          <label>Umbral de monto (MXN $) — solo si modo = Por monto
            <input name="umbralMonto" type="number" class="input-text" min="0" step="1" value="${datos.umbralMonto ?? 2000}">
          </label>
          <label>ID Pretoriano del producto trigger — solo si modo = Por producto
            <input name="productoTriggerIdPretoriano" type="number" class="input-text" min="0" value="${datos.productoTriggerIdPretoriano ?? ''}" placeholder="0 = ignorar">
          </label>
          <label>Cantidad mínima trigger
            <input name="cantidadMinimaTrigger" type="number" class="input-text" min="1" step="1" value="${datos.cantidadMinimaTrigger ?? 1}">
          </label>
          <label>ID Pretoriano del producto GRATIS
            <input name="productoGratisIdPretoriano" type="number" class="input-text" min="1" value="${datos.productoGratisIdPretoriano ?? ''}" required>
          </label>
          <label>Nombre del producto gratis
            <input name="productoGratisNombre" class="input-text" maxlength="100" value="${esc(datos.productoGratisNombre ?? '')}" required>
          </label>
          <label>Cantidad a regalar
            <input name="cantidadGratis" type="number" class="input-text" min="1" step="1" value="${datos.cantidadGratis ?? 1}">
          </label>
          <label>Valor unitario referencia (MXN $)
            <input name="valorUnitarioGratis" type="number" class="input-text" min="0" step="0.01" value="${datos.valorUnitarioGratis ?? 0}">
          </label>`;

      case 'PRECIO_FLASH':
        return `
          <label>ID Pretoriano del producto
            <input name="productoIdPretoriano" type="number" class="input-text" min="1" value="${datos.productoIdPretoriano ?? ''}" required placeholder="ej. 3318">
          </label>
          <label>Precio flash (MXN $)
            <input name="precioFlash" type="number" class="input-text" min="0.01" step="0.01" value="${datos.precioFlash ?? ''}" required>
          </label>`;

      case 'PUNTOS_LEALTAD':
        return `
          <label>Puntos por cada MXN $1 de subtotal
            <input name="puntosPorPeso" type="number" class="input-text" min="0.01" step="0.01" value="${datos.puntosPorPeso ?? 1}" required>
          </label>`;

      default:
        return '';
    }
  }

  // ── Campañas ──────────────────────────────────────────────────────────

  function _escucharCampanas(container) {
    if (_unsubCampanas) _unsubCampanas();
    const q = query(collection(db, COL_CAMPANAS), orderBy('fechaInicioTs', 'desc'));
    _unsubCampanas = onSnapshot(q, snap => {
      const grid = container.querySelector('#gridCampanas');
      if (!snap.docs.length) {
        grid.innerHTML = '<p class="empty-msg">Sin campañas aún.</p>';
        return;
      }
      const ahora = Date.now();
      grid.innerHTML = snap.docs.map(d => {
        const c = d.data();
        const finTs = c.fechaFinTs || 0;
        const vigente = c.activa && finTs > ahora;
        const badge = vigente ? '<span class="badge-green">Activa</span>' : '<span class="badge-gray">Inactiva</span>';
        const tipoLabel = TIPOS_PROMO[c.tipo] || c.tipo || '—';
        const puedeEditar = _puedeConfig();
        return `<div class="card" data-id="${esc(d.id)}">
          <div class="card-header">
            <span class="card-title">${esc(c.nombre)}</span>${badge}
          </div>
          <p class="card-desc">${esc(tipoLabel)}</p>
          <p class="card-desc" style="color:var(--color-on-surface-variant);font-size:.85em">${esc(c.descripcion || '')}</p>
          <div class="card-meta">
            <span>${_tsToDate(c.fechaInicioTs)} – ${_tsToDate(c.fechaFinTs)}</span>
          </div>
          ${puedeEditar ? `<div class="card-actions">
            <button class="btn-sm btn-edit" data-id="${esc(d.id)}">Editar</button>
            <button class="btn-sm btn-del" data-id="${esc(d.id)}">Eliminar</button>
          </div>` : ''}
        </div>`;
      }).join('');

      if (_puedeConfig()) {
        grid.querySelectorAll('.btn-edit').forEach(btn =>
          btn.addEventListener('click', () => _abrirPanelCampana(container, snap.docs.find(d => d.id === btn.dataset.id))));
        grid.querySelectorAll('.btn-del').forEach(btn =>
          btn.addEventListener('click', () => _eliminarCampana(btn.dataset.id)));
      }
    });
  }

  function _bindCampanas(container) {
    if (!_puedeConfig()) return;

    container.querySelector('#btnNuevaCampana')?.addEventListener('click', () =>
      _abrirPanelCampana(container, null));
    container.querySelector('#cerrarPanelCampana').addEventListener('click', () =>
      _cerrarPanelCampana(container));
    container.querySelector('#btnCancelarCampana').addEventListener('click', () =>
      _cerrarPanelCampana(container));

    container.querySelector('#selectTipoPromo')?.addEventListener('change', e => {
      container.querySelector('#camposTipo').innerHTML = _renderCamposTipo(e.target.value);
    });

    container.querySelector('#formCampana').addEventListener('submit', async e => {
      e.preventDefault();
      await _guardarCampana(container, e.target);
    });
  }

  function _abrirPanelCampana(container, docSnap) {
    const panel  = container.querySelector('#panelCampana');
    const titulo = container.querySelector('#panelCampanaTitulo');
    const form   = container.querySelector('#formCampana');
    form.reset();
    delete form.dataset.editId;

    let tipo = 'DESCUENTO_MONTO_PEDIDO';
    let datos = {};

    if (docSnap) {
      titulo.textContent = 'Editar campaña';
      const c = docSnap.data();
      tipo = c.tipo || tipo;
      datos = c;
      form.nombre.value      = c.nombre || '';
      form.descripcion.value = c.descripcion || '';
      form.activa.checked    = c.activa !== false;
      form.fechaInicio.value = _tsToDateInput(c.fechaInicioTs);
      form.fechaFin.value    = _tsToDateInput(c.fechaFinTs);
      form.dataset.editId    = docSnap.id;
    } else {
      titulo.textContent = 'Nueva campaña';
    }

    const sel = form.querySelector('[name="tipo"]');
    if (sel) sel.value = tipo;
    container.querySelector('#camposTipo').innerHTML = _renderCamposTipo(tipo, datos);
    panel.classList.remove('hidden');
  }

  function _cerrarPanelCampana(container) {
    container.querySelector('#panelCampana').classList.add('hidden');
  }

  async function _guardarCampana(container, form) {
    const nombre     = form.nombre.value.trim();
    const fechaInicio = form.fechaInicio.value;
    const fechaFin   = form.fechaFin.value;
    if (!nombre)                        { alert('El nombre es obligatorio.'); return; }
    if (!fechaInicio || !fechaFin)      { alert('Las fechas son obligatorias.'); return; }
    if (fechaFin < fechaInicio)         { alert('La fecha fin debe ser posterior.'); return; }

    const tipo = form.tipo?.value || 'DESCUENTO_MONTO_PEDIDO';
    const fechaInicioTs = new Date(fechaInicio + 'T00:00:00').getTime();
    const fechaFinTs    = new Date(fechaFin    + 'T23:59:59').getTime();

    const datos = {
      nombre:       nombre.slice(0, 80),
      descripcion:  form.descripcion.value.trim().slice(0, 300),
      tipo,
      fechaInicio,
      fechaFin,
      fechaInicioTs,
      fechaFinTs,
      activa:       form.activa.checked,
      actualizadoEn: serverTimestamp(),
      actualizadoPor: Sesion.alias
    };

    // Campos específicos por tipo
    const fd = f => form.querySelector(`[name="${f}"]`);
    switch (tipo) {
      case 'DESCUENTO_MONTO_PEDIDO':
        datos.umbralPedido   = parseFloat(fd('umbralPedido')?.value) || 0;
        datos.montoDescuento = parseFloat(fd('montoDescuento')?.value) || 0;
        break;
      case 'DESCUENTO_MONTO_PRODUCTO':
        datos.productoIdPretoriano = parseInt(fd('productoIdPretoriano')?.value, 10) || 0;
        datos.umbralProducto       = parseFloat(fd('umbralProducto')?.value) || 0;
        datos.montoDescuento       = parseFloat(fd('montoDescuento')?.value) || 0;
        break;
      case 'PRODUCTO_GRATIS':
        datos.modoGratis                  = fd('modoGratis')?.value || 'POR_MONTO';
        datos.umbralMonto                 = parseFloat(fd('umbralMonto')?.value) || 0;
        datos.productoTriggerIdPretoriano = parseInt(fd('productoTriggerIdPretoriano')?.value, 10) || 0;
        datos.cantidadMinimaTrigger       = parseFloat(fd('cantidadMinimaTrigger')?.value) || 1;
        datos.productoGratisIdPretoriano  = parseInt(fd('productoGratisIdPretoriano')?.value, 10) || 0;
        datos.productoGratisNombre        = fd('productoGratisNombre')?.value.trim() || '';
        datos.cantidadGratis              = parseFloat(fd('cantidadGratis')?.value) || 1;
        datos.valorUnitarioGratis         = parseFloat(fd('valorUnitarioGratis')?.value) || 0;
        break;
      case 'PRECIO_FLASH':
        datos.productoIdPretoriano = parseInt(fd('productoIdPretoriano')?.value, 10) || 0;
        datos.precioFlash          = parseFloat(fd('precioFlash')?.value) || 0;
        break;
      case 'PUNTOS_LEALTAD':
        datos.puntosPorPeso = parseFloat(fd('puntosPorPeso')?.value) || 1;
        break;
    }

    try {
      if (form.dataset.editId) {
        await updateDoc(doc(db, COL_CAMPANAS, form.dataset.editId), datos);
      } else {
        datos.creadoEn  = serverTimestamp();
        datos.creadoPor = Sesion.alias;
        await addDoc(collection(db, COL_CAMPANAS), datos);
      }
      _cerrarPanelCampana(container);
    } catch (err) {
      alert('Error al guardar: ' + err.message);
    }
  }

  async function _eliminarCampana(id) {
    if (!await window.modal({ title: "Eliminar campaña", message: "¿Eliminar esta campaña?", danger: true, confirmLabel: "Eliminar" })) return;
    try { await deleteDoc(doc(db, COL_CAMPANAS, id)); }
    catch (err) { window.toast?.("Error al eliminar: " + err.message, "error"); }
  }

  // ── Puntos por cliente ────────────────────────────────────────────────

  function _bindPuntos(container) {
    container.querySelector('#buscarCliente').addEventListener('input', e =>
      _cargarPuntos(container, e.target.value.trim()));

    container.querySelector('#formAjustePuntos').addEventListener('submit', async e => {
      e.preventDefault();
      await _confirmarAjustePuntos(container, e.target);
    });
    container.querySelector('#btnCancelarPuntos').addEventListener('click', () =>
      container.querySelector('#modalPuntos').classList.add('hidden'));
  }

  async function _cargarPuntos(container, busqueda) {
    const tbody = container.querySelector('#tbodyPuntos');
    tbody.innerHTML = '<tr><td colspan="4">Cargando…</td></tr>';
    try {
      const snap = await getDocs(query(collection(db, COL_PUNTOS), orderBy('puntos', 'desc'), limit(100)));
      let docs = snap.docs;
      if (busqueda) {
        const lower = busqueda.toLowerCase();
        docs = docs.filter(d => (d.data().clienteNombre || '').toLowerCase().includes(lower));
      }
      if (!docs.length) { tbody.innerHTML = '<tr><td colspan="4">Sin registros.</td></tr>'; return; }
      tbody.innerHTML = docs.map(d => {
        const p = d.data();
        const fecha = p.ultimaActividad ? new Date(p.ultimaActividad).toLocaleDateString('es-MX') : '—';
        return `<tr>
          <td>${esc(p.clienteNombre || d.id)}</td>
          <td class="num">${esc(String(p.puntos || 0))}</td>
          <td>${esc(fecha)}</td>
          <td><button class="btn-sm" data-cid="${esc(d.id)}" data-cnombre="${esc(p.clienteNombre || d.id)}">Ajustar</button></td>
        </tr>`;
      }).join('');
      tbody.querySelectorAll('button[data-cid]').forEach(btn =>
        btn.addEventListener('click', () => _abrirModalPuntos(container, btn.dataset.cid, btn.dataset.cnombre)));
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="4">Error: ${esc(err.message)}</td></tr>`;
    }
  }

  async function _abrirModalPuntos(container, clienteId, clienteNombre) {
    const modal = container.querySelector('#modalPuntos');
    const form  = container.querySelector('#formAjustePuntos');
    form.reset();
    form.clienteId.value = clienteId;
    container.querySelector('#modalPuntosTitulo').textContent = `Ajustar puntos — ${clienteNombre}`;

    const sel = form.campanaId;
    sel.innerHTML = '<option value="">Sin campaña</option>';
    try {
      const ahora = Date.now();
      const snap = await getDocs(query(collection(db, COL_CAMPANAS),
        where('activa', '==', true), where('fechaFinTs', '>=', ahora)));
      snap.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id; opt.textContent = d.data().nombre;
        sel.appendChild(opt);
      });
    } catch (_) {}
    modal.classList.remove('hidden');
  }

  async function _confirmarAjustePuntos(container, form) {
    const clienteId = form.clienteId.value;
    const puntos    = parseInt(form.puntos.value, 10);
    if (!clienteId || isNaN(puntos) || puntos < 1) { alert('Ingresa un número de puntos válido.'); return; }
    const delta = form.operacion.value === 'sumar' ? puntos : -Math.abs(puntos);
    try {
      await addDoc(collection(db, COL_HISTORIAL), {
        clienteId,
        campanaId: form.campanaId.value || null,
        puntos: delta,
        tipo: form.operacion.value,
        nota: form.nota.value.trim().slice(0, 200),
        registradoEn:  serverTimestamp(),
        registradoPor: Sesion.alias
      });
      const ref  = doc(db, COL_PUNTOS, clienteId);
      const snap = await getDoc(ref);
      const nuevo = Math.max(0, (snap.exists() ? (snap.data().puntos || 0) : 0) + delta);
      await setDoc(ref, { puntos: nuevo, ultimaActividad: Date.now() }, { merge: true });
      container.querySelector('#modalPuntos').classList.add('hidden');
      _cargarPuntos(container, '');
    } catch (err) { alert('Error: ' + err.message); }
  }

  // ── Historial de canje ────────────────────────────────────────────────

  function _escucharHistorial(container) {
    if (_unsubPuntos) _unsubPuntos();
    const q = query(collection(db, COL_HISTORIAL), orderBy('registradoEn', 'desc'), limit(200));
    _unsubPuntos = onSnapshot(q, snap => {
      const tbody = container.querySelector('#tbodyHistorial');
      if (snap.empty) { tbody.innerHTML = '<tr><td colspan="5">Sin registros.</td></tr>'; return; }
      tbody.innerHTML = snap.docs.map(d => {
        const h = d.data();
        const fecha = h.registradoEn?.toDate ? h.registradoEn.toDate().toLocaleDateString('es-MX') : '—';
        const signo = h.puntos > 0 ? '+' : '';
        return `<tr>
          <td>${esc(fecha)}</td>
          <td>${esc(h.clienteId || '')}</td>
          <td>${esc(h.campanaId || '—')}</td>
          <td class="num">${signo}${esc(String(h.puntos))}</td>
          <td>${esc(h.tipo || '')}</td>
        </tr>`;
      }).join('');
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  function _tsToDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function _tsToDateInput(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function destroy() {
    if (_unsubCampanas) { _unsubCampanas(); _unsubCampanas = null; }
    if (_unsubPuntos)   { _unsubPuntos();   _unsubPuntos   = null; }
  }

  return { init, mount: init, destroy };
})();
