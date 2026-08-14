// W7 — Catálogo de Precios por Segmento
import { exportarExcel, descargarPlantilla, importarExcel, toolbarHTML, puedeImportar } from "./excel-utils.js";
import { db } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, getDocs, where,
  serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#x27;'}[c]));

const _COLS_SEG = [
  { key: "segmento",         header: "Segmento",          width: 16, required: true, ejemplo: "Premium" },
  { key: "codigo_producto",  header: "Código producto",   width: 16, required: true, ejemplo: "PROD-001" },
  { key: "nombre_producto",  header: "Nombre producto",   width: 28, ejemplo: "Proteína Whey 1kg" },
  { key: "precio",           header: "Precio",            width: 12, tipo: "numero", required: true, ejemplo: "380.00" },
  { key: "descuento_pct",    header: "Descuento %",       width: 14, tipo: "numero", ejemplo: "15" },
  { key: "notas",            header: "Notas",             width: 24, ejemplo: "Precio especial distribuidor" },
];

export const SegmentoPrecioModule = (() => {
  let _unsubSegmentos  = null;
  let _unsubClientes   = null;
  let _segmentosCache  = [];
  let _segmentoActivo  = null; // id del segmento en edición de matriz

  // ── Init ──────────────────────────────────────────────────────────────

  function init(container) {
    container.innerHTML = `
      <div class="view-header">
        <h2>Precios por Segmento</h2>
        <button class="btn-primary" id="btnNuevoSegmento">+ Nuevo segmento</button>
      </div>

      ${toolbarHTML("Seg")}

      <div class="promo-tabs">
        <button class="tab-btn active" data-tab="segmentos">Segmentos</button>
        <button class="tab-btn" data-tab="matriz">Matriz de precios</button>
        <button class="tab-btn" data-tab="clientes">Clientes por segmento</button>
      </div>

      <!-- Tab segmentos -->
      <div id="tabSegmentos" class="tab-panel">
        <div id="gridSegmentos" class="cards-grid"></div>
      </div>

      <!-- Tab matriz de precios -->
      <div id="tabMatriz" class="tab-panel hidden">
        <div class="filter-bar">
          <label>Segmento
            <select id="selectSegmentoMatriz" class="input-select">
              <option value="">— selecciona —</option>
            </select>
          </label>
          <button class="btn-primary" id="btnGuardarMatriz">Guardar cambios</button>
        </div>
        <div id="tablaMatrizWrapper" class="tabla-wrapper">
          <table class="tabla" id="tablaMatriz">
            <thead><tr>
              <th>ID Pretoriano</th><th>Producto</th><th>Precio base</th>
              <th>Precio segmento</th><th>Activo</th>
            </tr></thead>
            <tbody id="tbodyMatriz"></tbody>
          </table>
        </div>
      </div>

      <!-- Tab clientes -->
      <div id="tabClientes" class="tab-panel hidden">
        <div class="filter-bar">
          <label>Segmento
            <select id="selectSegmentoCliente" class="input-select">
              <option value="">— selecciona —</option>
            </select>
          </label>
        </div>
        <div id="listaClientesSegmento" class="tabla-wrapper">
          <table class="tabla">
            <thead><tr><th>Cliente</th><th>Alias vendedor</th><th>Segmento actual</th><th>Acciones</th></tr></thead>
            <tbody id="tbodyClientesSegmento"></tbody>
          </table>
        </div>
      </div>

      <!-- Panel lateral de segmento -->
      <div id="panelSegmento" class="side-panel hidden">
        <div class="side-panel-header">
          <h3 id="panelSegmentoTitulo">Nuevo segmento</h3>
          <button id="cerrarPanelSegmento" class="btn-icon">✕</button>
        </div>
        <form id="formSegmento" class="side-panel-form" novalidate>
          <label>Nombre <input name="nombre" class="input-text" required maxlength="60"></label>
          <label>Descripción <textarea name="descripcion" class="input-text" rows="2" maxlength="200"></textarea></label>
          <label>Color
            <input name="color" type="color" value="#3B82F6">
          </label>
          <label class="label-check"><input name="activo" type="checkbox" checked> Activo</label>
          <div class="form-actions">
            <button type="button" id="btnCancelarSegmento" class="btn-secondary">Cancelar</button>
            <button type="submit" class="btn-primary">Guardar</button>
          </div>
        </form>
      </div>
    `;

    _bindTabs(container);
    _bindSegmentos(container);
    _bindMatriz(container);
    _bindClientesSegmento(container);
    _escucharSegmentos(container);
  }

  // ── Tabs ──────────────────────────────────────────────────────────────

  function _bindTabs(container) {
    container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        container.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
        const key = btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1);
        container.querySelector(`#tab${key}`).classList.remove('hidden');
      });
    });
  }

  // ── Segmentos CRUD ────────────────────────────────────────────────────

  function _escucharSegmentos(container) {
    if (_unsubSegmentos) _unsubSegmentos();
    const q = query(collection(db, 'segmentos'), orderBy('nombre'));
    _unsubSegmentos = onSnapshot(q, snap => {
      _segmentosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _renderGridSegmentos(container, snap.docs);
      _actualizarSelectores(container);
    });
  }

  function _renderGridSegmentos(container, docs) {
    const grid = container.querySelector('#gridSegmentos');
    if (!docs.length) {
      grid.innerHTML = '<p class="empty-msg">Sin segmentos. Crea el primero.</p>';
      return;
    }
    grid.innerHTML = docs.map(d => {
      const s = d.data();
      const activo = s.activo !== false ? '<span class="badge-green">Activo</span>' : '<span class="badge-gray">Inactivo</span>';
      const color  = s.color || '#3B82F6';
      return `<div class="card" data-id="${esc(d.id)}">
        <div class="card-header">
          <span class="color-dot" style="background:${esc(color)}"></span>
          <span class="card-title">${esc(s.nombre)}</span>
          ${activo}
        </div>
        <p class="card-desc">${esc(s.descripcion || '')}</p>
        <div class="card-actions">
          <button class="btn-sm btn-edit" data-id="${esc(d.id)}">Editar</button>
          <button class="btn-sm btn-precios" data-id="${esc(d.id)}" title="Ver y editar precios de este segmento"
            style="background:#EFF6FF;color:#1E40AF;border-color:#BFDBFE">💲 Precios</button>
          <button class="btn-sm btn-del" data-id="${esc(d.id)}">Eliminar</button>
        </div>
      </div>`;
    }).join('');

    grid.querySelectorAll('.btn-edit').forEach(btn =>
      btn.addEventListener('click', () => _abrirPanelSegmento(container, docs.find(d => d.id === btn.dataset.id))));
    grid.querySelectorAll('.btn-precios').forEach(btn =>
      btn.addEventListener('click', () => {
        // Activar tab Matriz
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        container.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
        const tabBtn = [...container.querySelectorAll('.tab-btn')].find(b => b.dataset.tab === 'matriz');
        if (tabBtn) tabBtn.classList.add('active');
        container.querySelector('#tabMatriz')?.classList.remove('hidden');
        // Preseleccionar segmento
        const sel = container.querySelector('#selectSegmentoMatriz');
        if (sel) { sel.value = btn.dataset.id; sel.dispatchEvent(new Event('change')); }
      }));
    grid.querySelectorAll('.btn-del').forEach(btn =>
      btn.addEventListener('click', () => _eliminarSegmento(btn.dataset.id)));
  }

  function _actualizarSelectores(container) {
    const opciones = _segmentosCache.map(s =>
      `<option value="${esc(s.id)}">${esc(s.nombre)}</option>`).join('');
    const vacío = '<option value="">— selecciona —</option>';
    [container.querySelector('#selectSegmentoMatriz'),
     container.querySelector('#selectSegmentoCliente')].forEach(sel => {
      if (!sel) return;
      const val = sel.value;
      sel.innerHTML = vacío + opciones;
      if (val) sel.value = val;
    });
  }

  function _bindSegmentos(container) {
    container.querySelector('#btnNuevoSegmento').addEventListener('click', () =>
      _abrirPanelSegmento(container, null));
    container.querySelector('#cerrarPanelSegmento').addEventListener('click', () =>
      container.querySelector('#panelSegmento').classList.add('hidden'));
    container.querySelector('#btnCancelarSegmento').addEventListener('click', () =>
      container.querySelector('#panelSegmento').classList.add('hidden'));
    container.querySelector('#formSegmento').addEventListener('submit', async e => {
      e.preventDefault();
      await _guardarSegmento(container, e.target);
    });
  }

  function _abrirPanelSegmento(container, docSnap) {
    const panel  = container.querySelector('#panelSegmento');
    const titulo = container.querySelector('#panelSegmentoTitulo');
    const form   = container.querySelector('#formSegmento');
    form.reset();
    delete form.dataset.editId;

    if (docSnap) {
      titulo.textContent = 'Editar segmento';
      const s = docSnap.data();
      form.nombre.value      = s.nombre || '';
      form.descripcion.value = s.descripcion || '';
      form.color.value       = s.color || '#3B82F6';
      form.activo.checked    = s.activo !== false;
      form.dataset.editId    = docSnap.id;
    } else {
      titulo.textContent = 'Nuevo segmento';
    }
    panel.classList.remove('hidden');
  }

  async function _guardarSegmento(container, form) {
    const nombre = form.nombre.value.trim();
    if (!nombre) { alert('El nombre es obligatorio.'); return; }

    const datos = {
      nombre:      nombre.slice(0, 60),
      descripcion: form.descripcion.value.trim().slice(0, 200),
      color:       form.color.value,
      activo:      form.activo.checked,
      actualizadoEn: serverTimestamp()
    };

    try {
      if (form.dataset.editId) {
        await updateDoc(doc(db, 'segmentos', form.dataset.editId), datos);
      } else {
        datos.creadoEn = serverTimestamp();
        await addDoc(collection(db, 'segmentos'), datos);
      }
      container.querySelector('#panelSegmento').classList.add('hidden');
    } catch (err) {
      alert('Error al guardar: ' + err.message);
    }
  }

  async function _eliminarSegmento(id) {
    if (!confirm('¿Eliminar este segmento? Los precios asociados también se eliminarán.')) return;
    try {
      // Borrar precios_segmento asociados
      const preciosSnap = await getDocs(query(collection(db, 'precios_segmento'),
        where('segmentoId', '==', id)));
      const batch = writeBatch(db);
      preciosSnap.forEach(d => batch.delete(d.ref));
      batch.delete(doc(db, 'segmentos', id));
      await batch.commit();
    } catch (err) {
      alert('Error al eliminar: ' + err.message);
    }
  }

  // ── Matriz de precios ─────────────────────────────────────────────────

  function _bindMatriz(container) {
    container.querySelector('#selectSegmentoMatriz').addEventListener('change', e => {
      _segmentoActivo = e.target.value || null;
      if (_segmentoActivo) _cargarMatriz(container, _segmentoActivo);
      else container.querySelector('#tbodyMatriz').innerHTML = '';
    });

    container.querySelector('#btnGuardarMatriz').addEventListener('click', async () => {
      if (!_segmentoActivo) { alert('Selecciona un segmento.'); return; }
      await _guardarMatriz(container, _segmentoActivo);
    });
  }

  async function _cargarMatriz(container, segmentoId) {
    const tbody = container.querySelector('#tbodyMatriz');
    tbody.innerHTML = '<tr><td colspan="5">Cargando productos…</td></tr>';

    try {
      const [productosSnap, preciosSnap] = await Promise.all([
        getDocs(query(collection(db, 'productos'), orderBy('nombre'))),
        getDocs(query(collection(db, 'precios_segmento'), where('segmentoId', '==', segmentoId)))
      ]);

      const preciosMap = {};
      preciosSnap.forEach(d => {
        const p = d.data();
        preciosMap[p.idPretoriano] = { docId: d.id, precio: p.precio, activo: p.activo !== false };
      });

      if (!productosSnap.docs.length) {
        tbody.innerHTML = '<tr><td colspan="5">Sin productos en catálogo.</td></tr>';
        return;
      }

      tbody.innerHTML = productosSnap.docs.map(d => {
        const p    = d.data();
        const prev = preciosMap[p.idPretoriano] || {};
        const precio  = prev.precio ?? '';
        const activo  = prev.activo !== false;
        return `<tr data-idpretoriano="${esc(String(p.idPretoriano))}"
                    data-docid="${esc(prev.docId || '')}"
                    data-nombre="${esc(p.nombre)}">
          <td>${esc(String(p.idPretoriano))}</td>
          <td>${esc(p.nombre)}</td>
          <td class="num">${esc(p.precioBase != null ? '$' + p.precioBase.toFixed(2) : '—')}</td>
          <td><input type="number" class="input-precio" min="0" step="0.01"
               value="${esc(String(precio))}" placeholder="Sin precio"></td>
          <td><input type="checkbox" class="chk-activo" ${activo ? 'checked' : ''}></td>
        </tr>`;
      }).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5">Error: ${esc(err.message)}</td></tr>`;
    }
  }

  async function _guardarMatriz(container, segmentoId) {
    const filas = container.querySelectorAll('#tbodyMatriz tr[data-idpretoriano]');
    if (!filas.length) return;

    const batch = writeBatch(db);
    let cambios = 0;

    filas.forEach(fila => {
      const idPretoriano = parseInt(fila.dataset.idpretoriano, 10);
      const nombreProducto = fila.dataset.nombre;
      const precioInput = fila.querySelector('.input-precio').value.trim();
      const activo = fila.querySelector('.chk-activo').checked;
      const precio  = parseFloat(precioInput);
      const docId   = fila.dataset.docid;

      if (precioInput === '' && !docId) return; // sin precio y sin doc previo → omitir

      const datos = {
        segmentoId,
        idPretoriano,
        nombreProducto,
        precio:    isNaN(precio) ? 0 : precio,
        activo,
        syncTs:    Date.now()
      };

      if (docId) {
        batch.update(doc(db, 'precios_segmento', docId), datos);
      } else if (precioInput !== '') {
        const ref = doc(collection(db, 'precios_segmento'));
        batch.set(ref, datos);
      }
      cambios++;
    });

    if (!cambios) { alert('Sin cambios para guardar.'); return; }

    try {
      await batch.commit();
      alert('Matriz de precios guardada.');
    } catch (err) {
      alert('Error al guardar: ' + err.message);
    }
  }

  // ── Clientes por segmento ─────────────────────────────────────────────

  function _bindClientesSegmento(container) {
    container.querySelector('#selectSegmentoCliente').addEventListener('change', e => {
      _cargarClientesDeSegmento(container, e.target.value || null);
    });
  }

  async function _cargarClientesDeSegmento(container, segmentoId) {
    const tbody = container.querySelector('#tbodyClientesSegmento');
    if (!segmentoId) { tbody.innerHTML = ''; return; }
    tbody.innerHTML = '<tr><td colspan="4">Cargando…</td></tr>';

    try {
      const snap = await getDocs(query(collection(db, 'clientes'),
        where('segmentoId', '==', segmentoId)));

      if (snap.empty) {
        tbody.innerHTML = '<tr><td colspan="4">Sin clientes en este segmento.</td></tr>';
        return;
      }

      tbody.innerHTML = snap.docs.map(d => {
        const c = d.data();
        return `<tr>
          <td>${esc(c.nombre || d.id)}</td>
          <td>${esc(c.aliasVendedor || '—')}</td>
          <td>${esc(c.segmentoId || '—')}</td>
          <td>
            <select class="sel-segmento input-select-sm" data-cid="${esc(d.id)}">
              <option value="">Sin segmento</option>
              ${_segmentosCache.map(s =>
                `<option value="${esc(s.id)}" ${s.id === c.segmentoId ? 'selected' : ''}>${esc(s.nombre)}</option>`
              ).join('')}
            </select>
          </td>
        </tr>`;
      }).join('');

      tbody.querySelectorAll('.sel-segmento').forEach(sel => {
        sel.addEventListener('change', async e => {
          const nuevoSegmento = e.target.value;
          try {
            await updateDoc(doc(db, 'clientes', e.target.dataset.cid),
              { segmentoId: nuevoSegmento, actualizadoEn: serverTimestamp() });
          } catch (err) {
            alert('Error al actualizar cliente: ' + err.message);
            e.target.value = e.target.dataset.prevVal || '';
          }
          e.target.dataset.prevVal = nuevoSegmento;
        });
        sel.dataset.prevVal = sel.value;
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="4">Error: ${esc(err.message)}</td></tr>`;
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  function destroy() {
    if (_unsubSegmentos) { _unsubSegmentos(); _unsubSegmentos = null; }
    _unsubClientes = null;
  }

  return { init, mount: init, destroy };
})();

// ── Excel: Exportar ───────────────────────────────────────────
window.Seg_xlExport = async function() {
  try {
    const { getDocs, collection } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const { db } = await import("./firebase-config.js");
    const snap = await getDocs(collection(db, "precios_segmento"));
    const rows = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    exportarExcel(rows, _COLS_SEG, "PreciosSegmento", "Precios por Segmento");
  } catch(e) { window.toast?.("Error al exportar.", "error"); }
};

// ── Excel: Plantilla ──────────────────────────────────────────
window.Seg_xlPlantilla = function() {
  descargarPlantilla(_COLS_SEG, "PreciosSegmento", "Precios por Segmento");
};

// ── Excel: Importar ───────────────────────────────────────────
window.Seg_xlImport = async function() {
  if (!puedeImportar()) { window.toast?.("Sin permisos.", "error"); return; }
  try {
    const registros = await importarExcel(_COLS_SEG);
    if (!registros.length) return;
    const { doc, setDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const { db } = await import("./firebase-config.js");
    let ok = 0, err = 0;
    for (const r of registros) {
      try {
        const id = `${r.segmento}_${r.codigo_producto}`;
        await setDoc(doc(db, "precios_segmento", id), {
          ...r, actualizadoPor: window.Sesion?.alias ?? "import", actualizadoEn: serverTimestamp()
        }, { merge: true });
        ok++;
      } catch(e2) { err++; }
    }
    window.toast?.(`Importación: ${ok} precios${err ? `, ${err} errores` : ""}.`, ok > 0 ? "success" : "error");
  } catch(e) { window.toast?.("Error en importación.", "error"); }
};
