// W5 — Recompensa y Lealtad
import { db } from './firebase-config.js';
import { Sesion } from './auth.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc,
  onSnapshot, query, orderBy, where, getDocs,
  serverTimestamp, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#x27;'}[c]));

export const PromocionesModule = (() => {
  let _unsubCampanas = null;
  let _unsubPuntos   = null;

  // ── Init ──────────────────────────────────────────────────────────────

  function init(container) {
    container.innerHTML = `
      <div class="view-header">
        <h2>Recompensa y Lealtad</h2>
        <button class="btn-primary" id="btnNuevaCampana">+ Nueva Campaña</button>
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
          <label>Tipo de campaña
            <select name="tipo" class="input-select">
              <option value="puntos_por_compra">Puntos por compra</option>
              <option value="descuento_directo">Descuento directo</option>
              <option value="producto_gratis">Producto gratis</option>
            </select>
          </label>
          <label>Puntos por MXN gastado <input name="puntosXPeso" type="number" class="input-text" min="0" step="0.01" value="1"></label>
          <label>Puntos para canjear recompensa <input name="puntosRecompensa" type="number" class="input-text" min="1" value="100"></label>
          <label>Descripción de recompensa <input name="recompensaDesc" class="input-text" maxlength="120"></label>
          <label>Fecha inicio <input name="fechaInicio" type="date" class="input-text" required></label>
          <label>Fecha fin <input name="fechaFin" type="date" class="input-text" required></label>
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

  // ── Campañas ──────────────────────────────────────────────────────────

  function _escucharCampanas(container) {
    if (_unsubCampanas) _unsubCampanas();
    const q = query(collection(db, 'promociones'), orderBy('fechaInicio', 'desc'));
    _unsubCampanas = onSnapshot(q, snap => {
      const grid = container.querySelector('#gridCampanas');
      if (!snap.docs.length) {
        grid.innerHTML = '<p class="empty-msg">Sin campañas aún.</p>';
        return;
      }
      grid.innerHTML = snap.docs.map(d => {
        const c = d.data();
        const activa = c.activa ? '<span class="badge-green">Activa</span>' : '<span class="badge-gray">Inactiva</span>';
        return `<div class="card" data-id="${esc(d.id)}">
          <div class="card-header">
            <span class="card-title">${esc(c.nombre)}</span>
            ${activa}
          </div>
          <p class="card-desc">${esc(c.descripcion || '')}</p>
          <div class="card-meta">
            <span>${esc(c.tipo || '')}</span>
            <span>${esc(c.fechaInicio || '')} – ${esc(c.fechaFin || '')}</span>
          </div>
          <div class="card-meta">
            <span>${esc(String(c.puntosXPeso || 1))} pto/MXN</span>
            <span>Recompensa: ${esc(String(c.puntosRecompensa || 0))} ptos</span>
          </div>
          <p class="card-desc">${esc(c.recompensaDesc || '')}</p>
          <div class="card-actions">
            <button class="btn-sm btn-edit" data-id="${esc(d.id)}">Editar</button>
            <button class="btn-sm btn-del" data-id="${esc(d.id)}">Eliminar</button>
          </div>
        </div>`;
      }).join('');

      grid.querySelectorAll('.btn-edit').forEach(btn =>
        btn.addEventListener('click', () => _abrirPanelCampana(container, snap.docs.find(d => d.id === btn.dataset.id))));
      grid.querySelectorAll('.btn-del').forEach(btn =>
        btn.addEventListener('click', () => _eliminarCampana(btn.dataset.id)));
    });
  }

  function _bindCampanas(container) {
    container.querySelector('#btnNuevaCampana').addEventListener('click', () =>
      _abrirPanelCampana(container, null));

    container.querySelector('#cerrarPanelCampana').addEventListener('click', () =>
      _cerrarPanelCampana(container));
    container.querySelector('#btnCancelarCampana').addEventListener('click', () =>
      _cerrarPanelCampana(container));

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

    if (docSnap) {
      titulo.textContent = 'Editar campaña';
      const c = docSnap.data();
      form.nombre.value           = c.nombre || '';
      form.descripcion.value      = c.descripcion || '';
      form.tipo.value             = c.tipo || 'puntos_por_compra';
      form.puntosXPeso.value      = c.puntosXPeso ?? 1;
      form.puntosRecompensa.value = c.puntosRecompensa ?? 100;
      form.recompensaDesc.value   = c.recompensaDesc || '';
      form.fechaInicio.value      = c.fechaInicio || '';
      form.fechaFin.value         = c.fechaFin || '';
      form.activa.checked         = c.activa !== false;
      form.dataset.editId         = docSnap.id;
    } else {
      titulo.textContent = 'Nueva campaña';
    }
    panel.classList.remove('hidden');
  }

  function _cerrarPanelCampana(container) {
    container.querySelector('#panelCampana').classList.add('hidden');
  }

  async function _guardarCampana(container, form) {
    const nombre = form.nombre.value.trim();
    if (!nombre) { alert('El nombre es obligatorio.'); return; }
    const fechaInicio = form.fechaInicio.value;
    const fechaFin    = form.fechaFin.value;
    if (!fechaInicio || !fechaFin) { alert('Las fechas son obligatorias.'); return; }
    if (fechaFin < fechaInicio) { alert('La fecha fin debe ser posterior a la fecha inicio.'); return; }

    const datos = {
      nombre:           nombre.slice(0, 80),
      descripcion:      form.descripcion.value.trim().slice(0, 300),
      tipo:             form.tipo.value,
      puntosXPeso:      parseFloat(form.puntosXPeso.value) || 1,
      puntosRecompensa: parseInt(form.puntosRecompensa.value, 10) || 100,
      recompensaDesc:   form.recompensaDesc.value.trim().slice(0, 120),
      fechaInicio,
      fechaFin,
      activa:           form.activa.checked,
      actualizadoEn:    serverTimestamp()
    };

    try {
      if (form.dataset.editId) {
        await updateDoc(doc(db, 'promociones', form.dataset.editId), datos);
      } else {
        datos.creadoEn = serverTimestamp();
        await addDoc(collection(db, 'promociones'), datos);
      }
      _cerrarPanelCampana(container);
    } catch (err) {
      alert('Error al guardar: ' + err.message);
    }
  }

  async function _eliminarCampana(id) {
    if (!confirm('¿Eliminar esta campaña?')) return;
    try {
      await deleteDoc(doc(db, 'promociones', id));
    } catch (err) {
      alert('Error al eliminar: ' + err.message);
    }
  }

  // ── Puntos por cliente ────────────────────────────────────────────────

  function _bindPuntos(container) {
    container.querySelector('#buscarCliente').addEventListener('input', e => {
      _cargarPuntos(container, e.target.value.trim());
    });

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
      let q = query(collection(db, 'puntos_cliente'), orderBy('puntos', 'desc'), limit(100));
      const snap = await getDocs(q);
      let docs = snap.docs;
      if (busqueda) {
        const lower = busqueda.toLowerCase();
        docs = docs.filter(d => (d.data().clienteNombre || '').toLowerCase().includes(lower) ||
                                 d.id.toLowerCase().includes(lower));
      }
      if (!docs.length) {
        tbody.innerHTML = '<tr><td colspan="4">Sin registros.</td></tr>';
        return;
      }
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
    const modal  = container.querySelector('#modalPuntos');
    const form   = container.querySelector('#formAjustePuntos');
    form.reset();
    form.clienteId.value = clienteId;
    container.querySelector('#modalPuntosTitulo').textContent = `Ajustar puntos — ${clienteNombre}`;

    // Poblar selector de campañas activas
    const sel = form.campanaId;
    sel.innerHTML = '<option value="">Sin campaña</option>';
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const snap = await getDocs(query(collection(db, 'promociones'),
        where('activa', '==', true), where('fechaFin', '>=', hoy)));
      snap.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.data().nombre;
        sel.appendChild(opt);
      });
    } catch (_) {}

    modal.classList.remove('hidden');
  }

  async function _confirmarAjustePuntos(container, form) {
    const clienteId = form.clienteId.value;
    const puntos    = parseInt(form.puntos.value, 10);
    const operacion = form.operacion.value;
    const campanaId = form.campanaId.value;
    const nota      = form.nota.value.trim().slice(0, 200);

    if (!clienteId || isNaN(puntos) || puntos < 1) {
      alert('Ingresa un número de puntos válido.');
      return;
    }

    const delta = operacion === 'sumar' ? puntos : -Math.abs(puntos);

    try {
      // Registrar en historial
      await addDoc(collection(db, 'historial_puntos'), {
        clienteId,
        campanaId:  campanaId || null,
        puntos:     delta,
        tipo:       operacion,
        nota,
        registradoEn: serverTimestamp(),
        registradoPor: Sesion.alias
      });

      // Actualizar saldo en puntos_cliente (merge)
      const ref = doc(db, 'puntos_cliente', clienteId);
      const snap = await getDocs(query(collection(db, 'puntos_cliente'), where('__name__', '==', clienteId)));
      const actual = snap.empty ? 0 : (snap.docs[0].data().puntos || 0);
      const nuevo  = Math.max(0, actual + delta);
      await setDoc(ref, { puntos: nuevo, ultimaActividad: Date.now() }, { merge: true });

      container.querySelector('#modalPuntos').classList.add('hidden');
      _cargarPuntos(container, '');
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  // ── Historial de canje ────────────────────────────────────────────────

  function _escucharHistorial(container) {
    if (_unsubPuntos) _unsubPuntos();
    const q = query(collection(db, 'historial_puntos'), orderBy('registradoEn', 'desc'), limit(200));
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
          <td class="num">${esc(signo + h.puntos)}</td>
          <td>${esc(h.tipo || '')}</td>
        </tr>`;
      }).join('');
    });
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  function destroy() {
    if (_unsubCampanas) { _unsubCampanas(); _unsubCampanas = null; }
    if (_unsubPuntos)   { _unsubPuntos();   _unsubPuntos   = null; }
  }

  return { init, mount: init, destroy };
})();
