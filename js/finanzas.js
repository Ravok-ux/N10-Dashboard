import { db } from './firebase-config.js';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, getDocs, query, where, orderBy, limit,
  serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { Sesion } from './auth.js';

// ─── Estado del módulo ────────────────────────────────────────────────────────
let _unsubs = [];
let _tabActivo = 'gl';
// Listener handles para cancelación al cambiar filtros dentro del mismo tab
let _unsubPolizas = null;
let _unsubFacturas = null;
let _unsubPresupuesto = null;
let _unsubCCLista = null;

const TABS = [
  { id: 'gl',           label: '📒 Contabilidad GL' },
  { id: 'ap',           label: '🧾 Cuentas por Pagar' },
  { id: 'conciliacion', label: '🏦 Conciliación Bancaria' },
  { id: 'estados',      label: '📊 Estados Financieros' },
  { id: 'presupuesto',  label: '📅 Presupuesto' },
  { id: 'centros',      label: '🏷️ Centros de Costo' },
];

const TIPOS_CUENTA = ['ACTIVO', 'PASIVO', 'CAPITAL', 'INGRESO', 'GASTO'];
const TIPOS_POLIZA = ['DIARIO', 'INGRESOS', 'EGRESOS', 'APERTURA', 'CIERRE'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function fmt(n) { return Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-MX');
}
function hoy() { return new Date().toISOString().slice(0, 10); }

// ─── mount / destroy ─────────────────────────────────────────────────────────
export const FinanzasModule = {
  mount(container) {
    container.innerHTML = `
      <div class="mod-header"><h2>💰 Finanzas</h2></div>
      <div class="tabs-bar" id="fin-tabs"></div>
      <div id="fin-content" style="margin-top:16px"></div>`;
    _renderTabs();
    _activarTab('gl');
  },
  destroy() {
    _unsubs.forEach(u => u());
    _unsubs = [];
    _unsubPolizas = null;
    _unsubFacturas = null;
    _unsubPresupuesto = null;
    _unsubCCLista = null;
    _tabActivo = 'gl';
  }
};

function _renderTabs() {
  const bar = el('fin-tabs');
  if (!bar) return;
  bar.innerHTML = TABS.map(t =>
    `<button class="tab-btn${t.id === _tabActivo ? ' active' : ''}"
       onclick="window._finTab('${t.id}')">${t.label}</button>`
  ).join('');
  window._finTab = (id) => _activarTab(id);
}

function _activarTab(id) {
  _unsubs.forEach(u => u());
  _unsubs = [];
  _tabActivo = id;
  _renderTabs();
  const c = el('fin-content');
  if (!c) return;
  c.innerHTML = '<div class="loading">Cargando…</div>';
  ({
    gl:           _montarGL,
    ap:           _montarAP,
    conciliacion: _montarConciliacion,
    estados:      _montarEstados,
    presupuesto:  _montarPresupuesto,
    centros:      _montarCentros,
  }[id] || (() => {}))();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB GL — Contabilidad General
// ═══════════════════════════════════════════════════════════════════════════════
function _montarGL() {
  const c = el('fin-content');
  c.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <!-- Catálogo de cuentas -->
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <b>Catálogo de Cuentas</b>
          <button class="btn-sm btn-primary" onclick="window._glNuevaCuenta()">+ Cuenta</button>
        </div>
        <div id="gl-cuentas-lista">Cargando…</div>
      </div>
      <!-- Pólizas -->
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <b>Pólizas Contables</b>
          <button class="btn-sm btn-primary" onclick="window._glNuevaPoliza()">+ Póliza</button>
        </div>
        <div style="margin-bottom:8px;display:flex;gap:8px">
          <select id="gl-filtro-tipo" onchange="window._glFiltrarPolizas()" style="flex:1">
            <option value="">Todos los tipos</option>
            ${TIPOS_POLIZA.map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
          <input type="month" id="gl-filtro-mes" value="${hoy().slice(0,7)}"
            onchange="window._glFiltrarPolizas()" style="flex:1">
        </div>
        <div id="gl-polizas-lista">Cargando…</div>
      </div>
    </div>
    <!-- Libro Mayor -->
    <div class="card" style="margin-top:16px">
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
        <b>Libro Mayor</b>
        <select id="gl-cuenta-sel" style="flex:1" onchange="window._glVerLibro()">
          <option value="">— Seleccionar cuenta —</option>
        </select>
        <input type="month" id="gl-libro-mes" value="${hoy().slice(0,7)}"
          onchange="window._glVerLibro()">
      </div>
      <div id="gl-libro-contenido"></div>
    </div>`;

  _glCargarCuentas();
  _glCargarPolizas();

  window._glNuevaCuenta = () => _glModalCuenta(null);
  window._glNuevaPoliza = () => _glModalPoliza(null);
  window._glFiltrarPolizas = () => _glCargarPolizas();
  window._glVerLibro = () => _glCargarLibro();
}

function _glCargarCuentas() {
  const q = query(collection(db, 'cuentas_contables'), orderBy('codigo'));
  const unsub = onSnapshot(q, snap => {
    const cuentas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Poblar selector de libro mayor
    const sel = el('gl-cuenta-sel');
    if (sel) {
      const prev = sel.value;
      sel.innerHTML = '<option value="">— Seleccionar cuenta —</option>' +
        cuentas.map(c => `<option value="${c.id}">${c.codigo} — ${c.nombre}</option>`).join('');
      if (prev) sel.value = prev;
    }
    const lista = el('gl-cuentas-lista');
    if (!lista) return;
    if (!cuentas.length) { lista.innerHTML = '<p class="empty">Sin cuentas registradas</p>'; return; }
    lista.innerHTML = `<table class="tbl" style="font-size:12px">
      <thead><tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Saldo</th><th></th></tr></thead>
      <tbody>${cuentas.map(c => `
        <tr>
          <td><code>${c.codigo}</code></td>
          <td>${c.nombre}</td>
          <td><span class="badge">${c.tipo}</span></td>
          <td class="num">$${fmt(c.saldo || 0)}</td>
          <td>
            <button class="btn-icon" onclick="window._glEditCuenta('${c.id}')">✏️</button>
            <button class="btn-icon" onclick="window._glDelCuenta('${c.id}','${c.nombre}')">🗑️</button>
          </td>
        </tr>`).join('')}
      </tbody></table>`;
    window._glEditCuenta = (id) => _glModalCuenta(cuentas.find(c => c.id === id));
    window._glDelCuenta = async (id, nombre) => {
      if (!confirm(`¿Eliminar cuenta "${nombre}"?`)) return;
      await deleteDoc(doc(db, 'cuentas_contables', id));
    };
  });
  _unsubs.push(unsub);
}

function _glCargarPolizas() {
  if (_unsubPolizas) { _unsubPolizas(); _unsubPolizas = null; }
  const tipo = el('gl-filtro-tipo')?.value || '';
  const mes  = el('gl-filtro-mes')?.value || hoy().slice(0,7);
  const inicio = new Date(mes + '-01');
  const fin    = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0, 23, 59, 59);

  let q = query(collection(db, 'polizas'),
    where('fecha', '>=', Timestamp.fromDate(inicio)),
    where('fecha', '<=', Timestamp.fromDate(fin)),
    orderBy('fecha', 'desc'));

  const unsub = onSnapshot(q, snap => {
    let polizas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (tipo) polizas = polizas.filter(p => p.tipo === tipo);
    const lista = el('gl-polizas-lista');
    if (!lista) return;
    if (!polizas.length) { lista.innerHTML = '<p class="empty">Sin pólizas en el período</p>'; return; }
    lista.innerHTML = `<table class="tbl" style="font-size:12px">
      <thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Monto</th><th></th></tr></thead>
      <tbody>${polizas.map(p => `
        <tr>
          <td>${fmtDate(p.fecha)}</td>
          <td><span class="badge">${p.tipo}</span></td>
          <td>${p.concepto || '—'}</td>
          <td class="num">$${fmt(p.total)}</td>
          <td><button class="btn-icon" onclick="window._glVerPoliza('${p.id}')">👁️</button>
              <button class="btn-icon" onclick="window._glDelPoliza('${p.id}')">🗑️</button></td>
        </tr>`).join('')}
      </tbody></table>`;
    window._glVerPoliza = (id) => _glModalPoliza(polizas.find(p => p.id === id), true);
    window._glDelPoliza = async (id) => {
      if (!confirm('¿Eliminar póliza?')) return;
      await deleteDoc(doc(db, 'polizas', id));
    };
  });
  _unsubPolizas = unsub;
  _unsubs.push(unsub);
}

async function _glCargarLibro() {
  const cuentaId = el('gl-cuenta-sel')?.value;
  const mes      = el('gl-libro-mes')?.value || hoy().slice(0,7);
  const div      = el('gl-libro-contenido');
  if (!div) return;
  if (!cuentaId) { div.innerHTML = '<p class="empty">Selecciona una cuenta</p>'; return; }

  const inicio = new Date(mes + '-01');
  const fin    = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0, 23, 59, 59);

  const snap = await getDocs(query(collection(db, 'polizas'),
    where('fecha', '>=', Timestamp.fromDate(inicio)),
    where('fecha', '<=', Timestamp.fromDate(fin)),
    orderBy('fecha')));

  let movs = [];
  snap.docs.forEach(d => {
    const p = d.data();
    (p.movimientos || []).forEach(m => {
      if (m.cuentaId === cuentaId) movs.push({ ...m, fecha: p.fecha, concepto: p.concepto });
    });
  });

  if (!movs.length) { div.innerHTML = '<p class="empty">Sin movimientos en el período</p>'; return; }

  let saldo = 0;
  div.innerHTML = `<table class="tbl" style="font-size:12px">
    <thead><tr><th>Fecha</th><th>Concepto</th><th>Cargo</th><th>Abono</th><th>Saldo</th></tr></thead>
    <tbody>${movs.map(m => {
      saldo += (m.cargo || 0) - (m.abono || 0);
      return `<tr>
        <td>${fmtDate(m.fecha)}</td>
        <td>${m.concepto || '—'}</td>
        <td class="num">${m.cargo ? '$'+fmt(m.cargo) : ''}</td>
        <td class="num">${m.abono ? '$'+fmt(m.abono) : ''}</td>
        <td class="num"><b>$${fmt(saldo)}</b></td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

function _glModalCuenta(cuenta) {
  const editar = !!cuenta;
  const html = `
    <div class="modal-overlay" id="modal-cuenta">
      <div class="modal" style="width:400px">
        <h3>${editar ? 'Editar' : 'Nueva'} Cuenta</h3>
        <label>Código SAT</label>
        <input id="mc-codigo" class="input" placeholder="1.1.01" value="${cuenta?.codigo || ''}">
        <label>Nombre</label>
        <input id="mc-nombre" class="input" placeholder="Caja y Bancos" value="${cuenta?.nombre || ''}">
        <label>Tipo</label>
        <select id="mc-tipo" class="input">
          ${TIPOS_CUENTA.map(t => `<option value="${t}"${cuenta?.tipo===t?' selected':''}>${t}</option>`).join('')}
        </select>
        <label>Descripción</label>
        <input id="mc-desc" class="input" placeholder="Opcional" value="${cuenta?.descripcion || ''}">
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn-primary" onclick="window._glGuardarCuenta('${cuenta?.id||''}')">Guardar</button>
          <button class="btn-secondary" onclick="document.getElementById('modal-cuenta').remove()">Cancelar</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  window._glGuardarCuenta = async (id) => {
    const data = {
      codigo:      el('mc-codigo').value.trim(),
      nombre:      el('mc-nombre').value.trim(),
      tipo:        el('mc-tipo').value,
      descripcion: el('mc-desc').value.trim(),
    };
    if (!data.codigo || !data.nombre) return alert('Código y nombre son requeridos');
    if (id) await updateDoc(doc(db, 'cuentas_contables', id), data);
    else await addDoc(collection(db, 'cuentas_contables'), { ...data, saldo: 0, creadoEn: serverTimestamp() });
    el('modal-cuenta').remove();
  };
}

function _glModalPoliza(poliza, soloVer = false) {
  const editar = !!poliza && !soloVer;
  const lineas = poliza?.movimientos || [{ cuentaId: '', cargo: 0, abono: 0 }];
  const html = `
    <div class="modal-overlay" id="modal-poliza">
      <div class="modal" style="width:560px;max-height:80vh;overflow-y:auto">
        <h3>${soloVer ? 'Ver' : editar ? 'Editar' : 'Nueva'} Póliza</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
          <div>
            <label>Tipo</label>
            <select id="mp-tipo" class="input" ${soloVer?'disabled':''}>
              ${TIPOS_POLIZA.map(t => `<option value="${t}"${poliza?.tipo===t?' selected':''}>${t}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Fecha</label>
            <input type="date" id="mp-fecha" class="input" value="${poliza?.fecha ? fmtDateISO(poliza.fecha) : hoy()}" ${soloVer?'disabled':''}>
          </div>
          <div>
            <label>Concepto</label>
            <input id="mp-concepto" class="input" placeholder="Concepto" value="${poliza?.concepto||''}" ${soloVer?'disabled':''}>
          </div>
        </div>
        <div id="mp-lineas">
          ${lineas.map((l, i) => _glLineaPoliza(l, i, soloVer)).join('')}
        </div>
        ${!soloVer ? `<button class="btn-sm btn-secondary" onclick="window._glAgregarLinea()" style="margin-top:8px">+ Línea</button>` : ''}
        <div style="display:flex;gap:8px;margin-top:12px">
          ${!soloVer ? `<button class="btn-primary" onclick="window._glGuardarPoliza('${poliza?.id||''}')">Guardar</button>` : ''}
          <button class="btn-secondary" onclick="document.getElementById('modal-poliza').remove()">Cerrar</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  let numLineas = lineas.length;
  window._glAgregarLinea = () => {
    el('mp-lineas').insertAdjacentHTML('beforeend', _glLineaPoliza({}, numLineas++, false));
  };
  window._glGuardarPoliza = async (id) => {
    const movimientos = [];
    let total = 0;
    document.querySelectorAll('.mp-linea').forEach(row => {
      const cargo = parseFloat(row.querySelector('.mp-cargo').value) || 0;
      const abono = parseFloat(row.querySelector('.mp-abono').value) || 0;
      movimientos.push({ cuentaId: row.querySelector('.mp-cuenta').value, cargo, abono });
      total += cargo;
    });
    const data = {
      tipo:         el('mp-tipo').value,
      fecha:        Timestamp.fromDate(new Date(el('mp-fecha').value)),
      concepto:     el('mp-concepto').value.trim(),
      movimientos,
      total,
      usuario:      Sesion.uid || '',
    };
    if (id) await updateDoc(doc(db, 'polizas', id), data);
    else await addDoc(collection(db, 'polizas'), { ...data, creadoEn: serverTimestamp() });
    el('modal-poliza').remove();
  };
}

function _glLineaPoliza(l, i, disabled) {
  return `<div class="mp-linea" style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:6px;margin-bottom:4px">
    <input class="input mp-cuenta" placeholder="ID cuenta" value="${l.cuentaId||''}" ${disabled?'disabled':''} style="font-size:12px">
    <input type="number" class="input mp-cargo" placeholder="Cargo" value="${l.cargo||''}" ${disabled?'disabled':''} style="font-size:12px">
    <input type="number" class="input mp-abono" placeholder="Abono" value="${l.abono||''}" ${disabled?'disabled':''} style="font-size:12px">
  </div>`;
}

function fmtDateISO(ts) {
  if (!ts) return hoy();
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB AP — Cuentas por Pagar
// ═══════════════════════════════════════════════════════════════════════════════
function _montarAP() {
  const c = el('fin-content');
  c.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px" id="ap-kpis"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <b>Facturas de Proveedores</b>
          <button class="btn-sm btn-primary" onclick="window._apNuevaFactura()">+ Factura</button>
        </div>
        <div style="margin-bottom:8px;display:flex;gap:8px">
          <select id="ap-filtro-estado" onchange="window._apRecargar()" style="flex:1">
            <option value="">Todos</option>
            <option value="PENDIENTE">Pendiente</option>
            <option value="PARCIAL">Parcial</option>
            <option value="PAGADA">Pagada</option>
            <option value="VENCIDA">Vencida</option>
          </select>
          <input type="month" id="ap-filtro-mes" value="${hoy().slice(0,7)}"
            onchange="window._apRecargar()" style="flex:1">
        </div>
        <div id="ap-facturas-lista">Cargando…</div>
      </div>
      <div class="card">
        <b>Calendario de Vencimientos</b>
        <div id="ap-calendario" style="margin-top:12px"></div>
      </div>
    </div>`;

  _apCargarFacturas();
  window._apNuevaFactura = () => _apModalFactura(null);
  window._apRecargar = () => _apCargarFacturas();
}

function _apCargarFacturas() {
  if (_unsubFacturas) { _unsubFacturas(); _unsubFacturas = null; }
  const estado = el('ap-filtro-estado')?.value || '';
  const mes    = el('ap-filtro-mes')?.value || hoy().slice(0,7);
  const inicio = new Date(mes + '-01');
  const fin    = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0, 23, 59, 59);

  const q = query(collection(db, 'facturas_proveedor'),
    where('fechaEmision', '>=', Timestamp.fromDate(inicio)),
    where('fechaEmision', '<=', Timestamp.fromDate(fin)),
    orderBy('fechaEmision', 'desc'));

  const unsub = onSnapshot(q, snap => {
    let facturas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const hoyTs = Date.now();

    // Calcular estado automático
    facturas = facturas.map(f => {
      if (f.estado !== 'PAGADA') {
        const venc = f.fechaVencimiento?.toDate?.()?.getTime() || 0;
        if (venc < hoyTs && f.estado !== 'PAGADA') f._vencida = true;
      }
      return f;
    });

    if (estado) {
      facturas = facturas.filter(f =>
        estado === 'VENCIDA' ? f._vencida : f.estado === estado);
    }

    // KPIs
    const total   = facturas.reduce((s, f) => s + (f.total || 0), 0);
    const pagado  = facturas.reduce((s, f) => s + (f.pagado || 0), 0);
    const pendiente = total - pagado;
    const vencidas = facturas.filter(f => f._vencida).reduce((s, f) => s + (f.total - (f.pagado || 0)), 0);
    const kpis = el('ap-kpis');
    if (kpis) kpis.innerHTML = [
      ['Total AP', '$'+fmt(total), '#3b82f6'],
      ['Pagado', '$'+fmt(pagado), '#10b981'],
      ['Por pagar', '$'+fmt(pendiente), '#f59e0b'],
      ['Vencido', '$'+fmt(vencidas), '#ef4444'],
    ].map(([l, v, color]) => `<div class="card" style="text-align:center;border-top:3px solid ${color}">
      <div style="font-size:11px;color:var(--text-muted)">${l}</div>
      <div style="font-size:18px;font-weight:700">${v}</div>
    </div>`).join('');

    // Calendario de vencimientos (próximos 30 días)
    const cal = el('ap-calendario');
    if (cal) {
      const proximas = facturas
        .filter(f => f.estado !== 'PAGADA' && f.fechaVencimiento)
        .sort((a, b) => a.fechaVencimiento.seconds - b.fechaVencimiento.seconds)
        .slice(0, 10);
      if (!proximas.length) { cal.innerHTML = '<p class="empty">Sin vencimientos próximos</p>'; }
      else cal.innerHTML = proximas.map(f => {
        const dias = Math.round((f.fechaVencimiento.toDate() - new Date()) / 86400000);
        const color = dias < 0 ? '#ef4444' : dias < 7 ? '#f59e0b' : '#10b981';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-size:12px;font-weight:600">${f.proveedor || '—'}</div>
            <div style="font-size:11px;color:var(--text-muted)">${fmtDate(f.fechaVencimiento)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:12px;font-weight:700">$${fmt(f.total - (f.pagado||0))}</div>
            <div style="font-size:11px;color:${color}">${dias < 0 ? `Vencida ${Math.abs(dias)}d` : `${dias}d`}</div>
          </div>
        </div>`;
      }).join('');
    }

    const lista = el('ap-facturas-lista');
    if (!lista) return;
    if (!facturas.length) { lista.innerHTML = '<p class="empty">Sin facturas en el período</p>'; return; }
    lista.innerHTML = `<table class="tbl" style="font-size:11px">
      <thead><tr><th>Proveedor</th><th>Vence</th><th>Total</th><th>Estado</th><th></th></tr></thead>
      <tbody>${facturas.map(f => `
        <tr>
          <td>${f.proveedor || '—'}</td>
          <td>${fmtDate(f.fechaVencimiento)}</td>
          <td class="num">$${fmt(f.total)}</td>
          <td><span class="badge" style="background:${f._vencida?'#ef4444':f.estado==='PAGADA'?'#10b981':'#f59e0b'};color:#fff">${f._vencida?'VENCIDA':f.estado}</span></td>
          <td>
            <button class="btn-icon" onclick="window._apPagar('${f.id}')">💳</button>
            <button class="btn-icon" onclick="window._apDelFact('${f.id}')">🗑️</button>
          </td>
        </tr>`).join('')}
      </tbody></table>`;

    window._apPagar = (id) => _apModalPago(facturas.find(f => f.id === id));
    window._apDelFact = async (id) => {
      if (!confirm('¿Eliminar factura?')) return;
      await deleteDoc(doc(db, 'facturas_proveedor', id));
    };
  });
  _unsubFacturas = unsub;
  _unsubs.push(unsub);
}

function _apModalFactura(factura) {
  const html = `
    <div class="modal-overlay" id="modal-ap">
      <div class="modal" style="width:480px">
        <h3>Nueva Factura de Proveedor</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div><label>Proveedor</label><input id="ap-prov" class="input" placeholder="Nombre proveedor" value="${factura?.proveedor||''}"></div>
          <div><label>RFC Proveedor</label><input id="ap-rfc" class="input" placeholder="RFC" value="${factura?.rfc||''}"></div>
          <div><label>Folio/UUID</label><input id="ap-folio" class="input" placeholder="Folio" value="${factura?.folio||''}"></div>
          <div><label>Fecha Emisión</label><input type="date" id="ap-emision" class="input" value="${factura?.fechaEmision?fmtDateISO(factura.fechaEmision):hoy()}"></div>
          <div><label>Fecha Vencimiento</label><input type="date" id="ap-vencimiento" class="input" value="${factura?.fechaVencimiento?fmtDateISO(factura.fechaVencimiento):hoy()}"></div>
          <div><label>Subtotal</label><input type="number" id="ap-subtotal" class="input" placeholder="0.00" value="${factura?.subtotal||''}"></div>
          <div><label>IVA</label><input type="number" id="ap-iva" class="input" placeholder="0.00" value="${factura?.iva||''}"></div>
          <div><label>Retención ISR</label><input type="number" id="ap-ret-isr" class="input" placeholder="0.00" value="${factura?.retIsr||''}"></div>
          <div><label>Retención IVA</label><input type="number" id="ap-ret-iva" class="input" placeholder="0.00" value="${factura?.retIva||''}"></div>
          <div><label>Concepto</label><input id="ap-concepto" class="input" placeholder="Descripción" value="${factura?.concepto||''}"></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn-primary" onclick="window._apGuardar('${factura?.id||''}')">Guardar</button>
          <button class="btn-secondary" onclick="document.getElementById('modal-ap').remove()">Cancelar</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  window._apGuardar = async (id) => {
    const subtotal = parseFloat(el('ap-subtotal').value) || 0;
    const iva      = parseFloat(el('ap-iva').value) || 0;
    const retIsr   = parseFloat(el('ap-ret-isr').value) || 0;
    const retIva   = parseFloat(el('ap-ret-iva').value) || 0;
    const total    = subtotal + iva - retIsr - retIva;
    const data = {
      proveedor:        el('ap-prov').value.trim(),
      rfc:              el('ap-rfc').value.trim().toUpperCase(),
      folio:            el('ap-folio').value.trim(),
      fechaEmision:     Timestamp.fromDate(new Date(el('ap-emision').value)),
      fechaVencimiento: Timestamp.fromDate(new Date(el('ap-vencimiento').value)),
      concepto:         el('ap-concepto').value.trim(),
      subtotal, iva, retIsr, retIva, total,
      estado: 'PENDIENTE', pagado: 0,
    };
    if (!data.proveedor || !data.total) return alert('Proveedor y total son requeridos');
    if (id) await updateDoc(doc(db, 'facturas_proveedor', id), data);
    else await addDoc(collection(db, 'facturas_proveedor'), { ...data, creadoEn: serverTimestamp() });
    el('modal-ap').remove();
  };
}

function _apModalPago(factura) {
  if (!factura) return;
  const pendiente = (factura.total || 0) - (factura.pagado || 0);
  const html = `
    <div class="modal-overlay" id="modal-pago-ap">
      <div class="modal" style="width:360px">
        <h3>Registrar Pago</h3>
        <p style="font-size:13px">Proveedor: <b>${factura.proveedor}</b></p>
        <p style="font-size:13px">Pendiente: <b>$${fmt(pendiente)}</b></p>
        <label>Monto a pagar</label>
        <input type="number" id="pago-monto" class="input" value="${pendiente}">
        <label>Forma de pago</label>
        <select id="pago-forma" class="input">
          <option>Transferencia</option><option>Cheque</option><option>Efectivo</option>
        </select>
        <label>Fecha</label>
        <input type="date" id="pago-fecha" class="input" value="${hoy()}">
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn-primary" onclick="window._apConfirmarPago('${factura.id}',${factura.total},${factura.pagado||0})">Confirmar</button>
          <button class="btn-secondary" onclick="document.getElementById('modal-pago-ap').remove()">Cancelar</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  window._apConfirmarPago = async (id, total, pagadoPrev) => {
    const monto = parseFloat(el('pago-monto').value) || 0;
    const nuevoPagado = pagadoPrev + monto;
    const estado = nuevoPagado >= total ? 'PAGADA' : 'PARCIAL';
    await updateDoc(doc(db, 'facturas_proveedor', id), { pagado: nuevoPagado, estado });
    el('modal-pago-ap').remove();
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB CONCILIACIÓN BANCARIA
// ═══════════════════════════════════════════════════════════════════════════════
function _montarConciliacion() {
  const c = el('fin-content');
  c.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <b>Conciliación Bancaria</b>
      <p style="font-size:13px;color:var(--text-muted);margin:4px 0 12px">
        Carga el estado de cuenta bancario (CSV) y concilia contra los movimientos internos.
      </p>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label>Banco / Cuenta</label>
          <input id="conc-banco" class="input" placeholder="Banamex ****1234">
        </div>
        <div>
          <label>Mes a conciliar</label>
          <input type="month" id="conc-mes" class="input" value="${hoy().slice(0,7)}">
        </div>
        <div>
          <label>Saldo inicial banco</label>
          <input type="number" id="conc-saldo-ini" class="input" placeholder="0.00">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
        <div>
          <label>Col. fecha (1-based)</label>
          <input type="number" id="conc-col-fecha" class="input" value="1">
        </div>
        <div>
          <label>Col. descripción</label>
          <input type="number" id="conc-col-desc" class="input" value="2">
        </div>
        <div>
          <label>Col. importe</label>
          <input type="number" id="conc-col-monto" class="input" value="3">
        </div>
      </div>
      <div style="display:flex;gap:12px;align-items:center">
        <label class="btn-secondary" style="cursor:pointer;padding:6px 14px;border-radius:6px;font-size:13px">
          📎 Cargar CSV
          <input type="file" accept=".csv,.txt" style="display:none" id="conc-file" onchange="window._concCargarCSV(this)">
        </label>
        <span id="conc-file-nombre" style="font-size:12px;color:var(--text-muted)">Sin archivo</span>
      </div>
    </div>
    <div id="conc-resultados"></div>
    <div class="card" style="margin-top:16px">
      <b>Historial de Conciliaciones</b>
      <div id="conc-historial" style="margin-top:8px">Cargando…</div>
    </div>`;

  _concCargarHistorial();

  window._concCargarCSV = (input) => {
    const file = input.files[0];
    if (!file) return;
    el('conc-file-nombre').textContent = file.name;
    const reader = new FileReader();
    reader.onload = e => _concProcesar(e.target.result);
    reader.readAsText(file, 'UTF-8');
  };
}

async function _concProcesar(texto) {
  const div = el('conc-resultados');
  div.innerHTML = '<div class="loading">Procesando…</div>';

  const colFecha = parseInt(el('conc-col-fecha').value) - 1;
  const colDesc  = parseInt(el('conc-col-desc').value) - 1;
  const colMonto = parseInt(el('conc-col-monto').value) - 1;
  const mes      = el('conc-mes').value;
  const banco    = el('conc-banco').value.trim() || 'Banco';
  const saldoIni = parseFloat(el('conc-saldo-ini').value) || 0;

  // Detectar delimitador
  const primera = texto.split('\n')[0] || '';
  const delim = primera.includes(';') ? ';' : primera.includes('\t') ? '\t' : ',';

  const lineas = texto.split('\n')
    .map(l => l.trim())
    .filter(l => l)
    .slice(1); // skip header

  const movsBanco = lineas.map(linea => {
    const cols = linea.split(delim).map(c => c.replace(/^"|"$/g, '').trim());
    return {
      fecha:       cols[colFecha] || '',
      descripcion: cols[colDesc]  || '',
      monto:       parseFloat((cols[colMonto] || '0').replace(/,/g, '')) || 0,
    };
  }).filter(m => m.monto !== 0);

  // Cargar movimientos internos del mes
  const inicio = new Date(mes + '-01');
  const fin    = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0, 23, 59, 59);

  const [snapCobranza, snapCaja] = await Promise.all([
    getDocs(query(collection(db, 'cobranza'),
      where('fecha', '>=', Timestamp.fromDate(inicio)),
      where('fecha', '<=', Timestamp.fromDate(fin)))),
    getDocs(query(collection(db, 'movimientos_caja'),
      where('fecha', '>=', Timestamp.fromDate(inicio)),
      where('fecha', '<=', Timestamp.fromDate(fin)))),
  ]);

  const movsInterno = [
    ...snapCobranza.docs.map(d => ({ ...d.data(), _col: 'cobranza', id: d.id })),
    ...snapCaja.docs.map(d => ({ ...d.data(), _col: 'caja', id: d.id })),
  ];

  // Algoritmo de conciliación: match por referencia o monto (±1 MXN)
  const conciliados = [];
  const sinMatch    = [];
  const noEnBanco   = [];

  const usados = new Set();
  movsBanco.forEach(mb => {
    const match = movsInterno.find((mi, idx) => {
      if (usados.has(idx)) return false;
      const montoOk = Math.abs((mi.monto || mi.importe || 0) - Math.abs(mb.monto)) <= 1;
      const refOk   = mi.referencia && mb.descripcion.toLowerCase().includes(String(mi.referencia).toLowerCase());
      return montoOk || refOk;
    });
    if (match) {
      const idx = movsInterno.indexOf(match);
      usados.add(idx);
      conciliados.push({ banco: mb, interno: match });
    } else {
      sinMatch.push(mb);
    }
  });

  movsInterno.forEach((mi, idx) => {
    if (!usados.has(idx)) noEnBanco.push(mi);
  });

  const totalBanco    = movsBanco.reduce((s, m) => s + m.monto, 0);
  const totalConcil   = conciliados.reduce((s, m) => s + m.banco.monto, 0);
  const diferencia    = totalBanco - totalConcil;

  div.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
      ${[
        ['Mov. banco', movsBanco.length, '#3b82f6'],
        ['Conciliados', conciliados.length, '#10b981'],
        ['Sin match banco', sinMatch.length, '#f59e0b'],
        ['No en banco', noEnBanco.length, '#ef4444'],
      ].map(([l, v, color]) => `<div class="card" style="text-align:center;border-top:3px solid ${color}">
        <div style="font-size:11px;color:var(--text-muted)">${l}</div>
        <div style="font-size:22px;font-weight:700;color:${color}">${v}</div>
      </div>`).join('')}
    </div>
    <div class="card" style="margin-bottom:12px">
      <b>Resumen</b>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:8px;font-size:13px">
        <div>Saldo inicial: <b>$${fmt(saldoIni)}</b></div>
        <div>Total banco: <b>$${fmt(totalBanco)}</b></div>
        <div>Diferencia: <b style="color:${Math.abs(diferencia)<1?'#10b981':'#ef4444'}">$${fmt(diferencia)}</b></div>
      </div>
    </div>
    ${sinMatch.length ? `<div class="card" style="margin-bottom:12px">
      <b>Sin match en sistema (${sinMatch.length})</b>
      <table class="tbl" style="margin-top:8px;font-size:11px">
        <thead><tr><th>Fecha</th><th>Descripción</th><th>Monto</th></tr></thead>
        <tbody>${sinMatch.map(m => `<tr>
          <td>${m.fecha}</td><td>${m.descripcion}</td>
          <td class="num" style="color:#f59e0b">$${fmt(m.monto)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>` : ''}
    ${noEnBanco.length ? `<div class="card">
      <b>En sistema, no en banco (${noEnBanco.length})</b>
      <table class="tbl" style="margin-top:8px;font-size:11px">
        <thead><tr><th>Referencia</th><th>Concepto</th><th>Monto</th><th>Fuente</th></tr></thead>
        <tbody>${noEnBanco.map(m => `<tr>
          <td>${m.referencia||'—'}</td>
          <td>${m.concepto||m.descripcion||'—'}</td>
          <td class="num" style="color:#ef4444">$${fmt(m.monto||m.importe)}</td>
          <td><span class="badge">${m._col}</span></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>` : ''}
    <div style="margin-top:12px;text-align:right">
      <button class="btn-primary" onclick="window._concGuardar()">Guardar conciliación</button>
    </div>`;

  window._concGuardar = async () => {
    await addDoc(collection(db, 'conciliaciones_bancarias'), {
      banco, mes,
      movsBanco: movsBanco.length,
      conciliados: conciliados.length,
      sinMatch: sinMatch.length,
      noEnBanco: noEnBanco.length,
      saldoInicial: saldoIni,
      totalBanco,
      diferencia,
      usuario: Sesion.uid || '',
      creadoEn: serverTimestamp(),
    });
    alert('Conciliación guardada.');
  };
}

function _concCargarHistorial() {
  const q = query(collection(db, 'conciliaciones_bancarias'), orderBy('creadoEn', 'desc'), limit(20));
  const unsub = onSnapshot(q, snap => {
    const div = el('conc-historial');
    if (!div) return;
    if (snap.empty) { div.innerHTML = '<p class="empty">Sin conciliaciones guardadas</p>'; return; }
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    div.innerHTML = `<table class="tbl" style="font-size:12px">
      <thead><tr><th>Banco</th><th>Mes</th><th>Mov. banco</th><th>Conciliados</th><th>Sin match</th><th>Diferencia</th><th>Usuario</th><th>Fecha</th></tr></thead>
      <tbody>${rows.map(r => {
        const color = Math.abs(r.diferencia || 0) < 1 ? '#10b981' : '#ef4444';
        return `<tr>
          <td>${r.banco || '—'}</td>
          <td>${r.mes || '—'}</td>
          <td class="num">${r.movsBanco || 0}</td>
          <td class="num" style="color:#10b981">${r.conciliados || 0}</td>
          <td class="num" style="color:#f59e0b">${r.sinMatch || 0}</td>
          <td class="num" style="color:${color}">$${fmt(r.diferencia || 0)}</td>
          <td>${r.usuario || '—'}</td>
          <td>${fmtDate(r.creadoEn)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  });
  _unsubs.push(unsub);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB ESTADOS FINANCIEROS
// ═══════════════════════════════════════════════════════════════════════════════
function _montarEstados() {
  const c = el('fin-content');
  c.innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px">
      <select id="ef-tipo" class="input" style="width:220px" onchange="window._efGenerar()">
        <option value="balance">Balance General</option>
        <option value="resultados">Estado de Resultados</option>
        <option value="flujo">Flujo de Efectivo</option>
      </select>
      <input type="month" id="ef-mes" class="input" style="width:160px" value="${hoy().slice(0,7)}" onchange="window._efGenerar()">
      <button class="btn-primary" onclick="window._efGenerar()">Generar</button>
    </div>
    <div id="ef-contenido"><p class="empty">Selecciona tipo y período, luego presiona Generar.</p></div>`;

  window._efGenerar = () => _efGenerar();
}

async function _efGenerar() {
  const tipo = el('ef-tipo')?.value || 'balance';
  const mes  = el('ef-mes')?.value || hoy().slice(0,7);
  const div  = el('ef-contenido');
  if (!div) return;
  div.innerHTML = '<div class="loading">Calculando…</div>';

  const inicio = new Date(mes + '-01');
  const fin    = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0, 23, 59, 59);

  // Cargar cuentas y pólizas del período
  const [snapCuentas, snapPolizas] = await Promise.all([
    getDocs(query(collection(db, 'cuentas_contables'), orderBy('codigo'))),
    getDocs(query(collection(db, 'polizas'),
      where('fecha', '>=', Timestamp.fromDate(inicio)),
      where('fecha', '<=', Timestamp.fromDate(fin)))),
  ]);

  const cuentas = Object.fromEntries(snapCuentas.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  // Acumular movimientos
  const saldos = {};
  snapPolizas.docs.forEach(d => {
    const p = d.data();
    (p.movimientos || []).forEach(m => {
      if (!saldos[m.cuentaId]) saldos[m.cuentaId] = 0;
      saldos[m.cuentaId] += (m.cargo || 0) - (m.abono || 0);
    });
  });

  const porTipo = (tipo) => Object.values(cuentas)
    .filter(c => c.tipo === tipo)
    .map(c => ({ ...c, saldoPeriodo: saldos[c.id] || 0 }));

  if (tipo === 'balance') {
    const activos   = porTipo('ACTIVO');
    const pasivos   = porTipo('PASIVO');
    const capital   = porTipo('CAPITAL');
    const totalAct  = activos.reduce((s, c) => s + (c.saldo||0) + c.saldoPeriodo, 0);
    const totalPas  = pasivos.reduce((s, c) => s + (c.saldo||0) + c.saldoPeriodo, 0);
    const totalCap  = capital.reduce((s, c) => s + (c.saldo||0) + c.saldoPeriodo, 0);
    div.innerHTML = _efTabla('Balance General', mes, [
      { titulo: 'ACTIVOS', rows: activos, total: totalAct, color: '#3b82f6' },
      { titulo: 'PASIVOS', rows: pasivos, total: totalPas, color: '#ef4444' },
      { titulo: 'CAPITAL', rows: capital, total: totalCap, color: '#10b981' },
    ]);
  } else if (tipo === 'resultados') {
    const ingresos  = porTipo('INGRESO');
    const gastos    = porTipo('GASTO');
    const totalIng  = ingresos.reduce((s, c) => s + c.saldoPeriodo, 0);
    const totalGas  = gastos.reduce((s, c) => s + c.saldoPeriodo, 0);
    const utilidad  = totalIng - totalGas;
    div.innerHTML = _efTabla('Estado de Resultados', mes, [
      { titulo: 'INGRESOS', rows: ingresos, total: totalIng, color: '#10b981' },
      { titulo: 'GASTOS',   rows: gastos,   total: totalGas, color: '#ef4444' },
    ]) + `<div class="card" style="margin-top:12px;text-align:center">
      <div style="font-size:13px;color:var(--text-muted)">Utilidad / Pérdida del período</div>
      <div style="font-size:28px;font-weight:700;color:${utilidad>=0?'#10b981':'#ef4444'}">$${fmt(utilidad)}</div>
    </div>`;
  } else {
    // Flujo de efectivo simplificado
    const efectivo = porTipo('ACTIVO').filter(c => c.codigo?.startsWith('1.1'));
    const total    = efectivo.reduce((s, c) => s + c.saldoPeriodo, 0);
    div.innerHTML = `<div class="card">
      <h3 style="margin-bottom:12px">Flujo de Efectivo — ${mes}</h3>
      <p style="color:var(--text-muted);font-size:13px">Variación neta en cuentas de efectivo y equivalentes (código 1.1.xx)</p>
      <table class="tbl" style="margin-top:12px">
        <thead><tr><th>Cuenta</th><th>Código</th><th>Variación</th></tr></thead>
        <tbody>${efectivo.map(c => `<tr>
          <td>${c.nombre}</td>
          <td><code>${c.codigo}</code></td>
          <td class="num" style="color:${c.saldoPeriodo>=0?'#10b981':'#ef4444'}">$${fmt(c.saldoPeriodo)}</td>
        </tr>`).join('')}</tbody>
      </table>
      <div style="margin-top:8px;text-align:right;font-weight:700">
        Flujo neto: <span style="color:${total>=0?'#10b981':'#ef4444'}">$${fmt(total)}</span>
      </div>
    </div>`;
  }
}

function _efTabla(titulo, mes, secciones) {
  return `<div class="card">
    <h3 style="margin-bottom:4px">${titulo}</h3>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Período: ${mes}</p>
    ${secciones.map(s => `
      <div style="margin-bottom:16px">
        <div style="font-weight:700;color:${s.color};font-size:12px;letter-spacing:1px;margin-bottom:6px">${s.titulo}</div>
        <table class="tbl" style="font-size:12px">
          <thead><tr><th>Código</th><th>Cuenta</th><th>Saldo acum.</th><th>Período</th><th>Total</th></tr></thead>
          <tbody>${s.rows.map(c => `<tr>
            <td><code>${c.codigo}</code></td>
            <td>${c.nombre}</td>
            <td class="num">$${fmt(c.saldo||0)}</td>
            <td class="num">$${fmt(c.saldoPeriodo)}</td>
            <td class="num"><b>$${fmt((c.saldo||0)+c.saldoPeriodo)}</b></td>
          </tr>`).join('')}</tbody>
        </table>
        <div style="text-align:right;font-weight:700;font-size:13px;margin-top:4px">Total ${s.titulo}: $${fmt(s.total)}</div>
      </div>`).join('')}
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB PRESUPUESTO
// ═══════════════════════════════════════════════════════════════════════════════
function _montarPresupuesto() {
  const c = el('fin-content');
  c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div style="display:flex;gap:8px;align-items:center">
        <input type="month" id="pres-mes" class="input" value="${hoy().slice(0,7)}"
          onchange="window._presCargar()">
      </div>
      <button class="btn-sm btn-primary" onclick="window._presNueva()">+ Partida</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px" id="pres-kpis"></div>
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
      <div class="card" id="pres-tabla-wrap">Cargando…</div>
      <div class="card">
        <b>Tensión de Liquidez</b>
        <div id="pres-liquidez" style="margin-top:8px"></div>
      </div>
    </div>`;

  _presCargar();
  window._presNueva   = () => _presModal(null);
  window._presCargar  = () => _presCargar();
}

function _presCargar() {
  if (_unsubPresupuesto) { _unsubPresupuesto(); _unsubPresupuesto = null; }
  const mes = el('pres-mes')?.value || hoy().slice(0,7);
  const q   = query(collection(db, 'presupuestos'), where('mes', '==', mes), orderBy('categoria'));
  const unsub = onSnapshot(q, snap => {
    const partidas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _presRenderizar(partidas, mes);
  });
  _unsubPresupuesto = unsub;
  _unsubs.push(unsub);
}

function _presRenderizar(partidas, mes) {
  const totalPres  = partidas.reduce((s, p) => s + (p.presupuesto || 0), 0);
  const totalReal  = partidas.reduce((s, p) => s + (p.real || 0), 0);
  const variacion  = totalReal - totalPres;
  const pct        = totalPres > 0 ? (totalReal / totalPres * 100) : 0;

  const kpis = el('pres-kpis');
  if (kpis) kpis.innerHTML = [
    ['Presupuesto', '$'+fmt(totalPres), '#3b82f6'],
    ['Real', '$'+fmt(totalReal), '#10b981'],
    ['Variación', (variacion >= 0 ? '+' : '') + '$'+fmt(variacion), variacion <= 0 ? '#10b981' : '#ef4444'],
    ['Ejecución', pct.toFixed(1)+'%', pct > 100 ? '#ef4444' : pct > 80 ? '#f59e0b' : '#3b82f6'],
  ].map(([l, v, color]) => `<div class="card" style="text-align:center;border-top:3px solid ${color}">
    <div style="font-size:11px;color:var(--text-muted)">${l}</div>
    <div style="font-size:18px;font-weight:700;color:${color}">${v}</div>
  </div>`).join('');

  const wrap = el('pres-tabla-wrap');
  if (wrap) {
    if (!partidas.length) { wrap.innerHTML = '<p class="empty">Sin partidas presupuestales</p>'; }
    else wrap.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <b>Presupuesto vs Real — ${mes}</b>
      </div>
      <table class="tbl" style="font-size:12px">
        <thead><tr><th>Categoría</th><th>Centro Costo</th><th>Presupuesto</th><th>Real</th><th>Var %</th><th></th></tr></thead>
        <tbody>${partidas.map(p => {
          const varPct = p.presupuesto > 0 ? ((p.real||0) - p.presupuesto) / p.presupuesto * 100 : 0;
          const barW   = Math.min(100, p.presupuesto > 0 ? (p.real||0)/p.presupuesto*100 : 0);
          const barColor = barW > 100 ? '#ef4444' : barW > 80 ? '#f59e0b' : '#3b82f6';
          return `<tr>
            <td>${p.categoria}</td>
            <td>${p.centroCosto || '—'}</td>
            <td class="num">$${fmt(p.presupuesto)}</td>
            <td class="num">
              <div>$${fmt(p.real||0)}</div>
              <div style="height:4px;background:var(--border);border-radius:2px;margin-top:2px">
                <div style="width:${barW}%;height:4px;background:${barColor};border-radius:2px"></div>
              </div>
            </td>
            <td class="num" style="color:${varPct>0?'#ef4444':'#10b981'}">${varPct > 0 ? '+' : ''}${varPct.toFixed(1)}%</td>
            <td>
              <button class="btn-icon" onclick="window._presEditP('${p.id}')">✏️</button>
              <button class="btn-icon" onclick="window._presDelP('${p.id}')">🗑️</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
    window._presEditP = (id) => _presModal(partidas.find(p => p.id === id));
    window._presDelP  = async (id) => { if (confirm('¿Eliminar partida?')) await deleteDoc(doc(db, 'presupuestos', id)); };
  }

  // Tensión de liquidez
  const liq = el('pres-liquidez');
  if (liq) {
    const tension = pct > 100 ? 'CRÍTICA' : pct > 90 ? 'ALTA' : pct > 75 ? 'MODERADA' : 'NORMAL';
    const color   = tension === 'CRÍTICA' ? '#ef4444' : tension === 'ALTA' ? '#f59e0b' : tension === 'MODERADA' ? '#3b82f6' : '#10b981';
    liq.innerHTML = `
      <div style="text-align:center;padding:16px">
        <div style="font-size:40px;margin-bottom:8px">${tension==='CRÍTICA'?'🔴':tension==='ALTA'?'🟡':tension==='MODERADA'?'🔵':'🟢'}</div>
        <div style="font-size:20px;font-weight:700;color:${color}">${tension}</div>
        <div style="font-size:13px;color:var(--text-muted);margin-top:4px">Ejecución ${pct.toFixed(1)}% del presupuesto</div>
        ${pct > 90 ? `<div style="margin-top:8px;padding:8px;background:${color}20;border-radius:6px;font-size:12px;color:${color}">
          ⚠️ ${pct > 100 ? 'Presupuesto superado. Revisar gastos urgente.' : 'Cerca del límite presupuestal.'}
        </div>` : ''}
      </div>
      <div style="margin-top:8px">
        <b style="font-size:12px">Proyección al cierre de mes</b>
        ${partidas.slice(0,5).map(p => {
          const diaMes = new Date().getDate();
          const diasTotales = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate();
          const proyeccion = p.presupuesto > 0 ? (p.real||0) / diaMes * diasTotales : 0;
          const ok = proyeccion <= p.presupuesto;
          return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid var(--border)">
            <span>${p.categoria}</span>
            <span style="color:${ok?'#10b981':'#ef4444'}">$${fmt(proyeccion)}</span>
          </div>`;
        }).join('')}
      </div>`;
  }
}

function _presModal(partida) {
  const mes = el('pres-mes')?.value || hoy().slice(0,7);
  const html = `
    <div class="modal-overlay" id="modal-pres">
      <div class="modal" style="width:400px">
        <h3>${partida ? 'Editar' : 'Nueva'} Partida Presupuestal</h3>
        <label>Mes</label>
        <input type="month" id="pm-mes" class="input" value="${partida?.mes || mes}">
        <label>Categoría</label>
        <input id="pm-cat" class="input" placeholder="Ej: Nómina, Marketing..." value="${partida?.categoria||''}">
        <label>Centro de Costo</label>
        <input id="pm-cc" class="input" placeholder="Opcional" value="${partida?.centroCosto||''}">
        <label>Presupuesto ($)</label>
        <input type="number" id="pm-pres" class="input" value="${partida?.presupuesto||''}">
        <label>Real acumulado ($)</label>
        <input type="number" id="pm-real" class="input" value="${partida?.real||''}">
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn-primary" onclick="window._presGuardar('${partida?.id||''}')">Guardar</button>
          <button class="btn-secondary" onclick="document.getElementById('modal-pres').remove()">Cancelar</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  window._presGuardar = async (id) => {
    const data = {
      mes:         el('pm-mes').value,
      categoria:   el('pm-cat').value.trim(),
      centroCosto: el('pm-cc').value.trim(),
      presupuesto: parseFloat(el('pm-pres').value) || 0,
      real:        parseFloat(el('pm-real').value) || 0,
    };
    if (!data.categoria) return alert('Categoría requerida');
    if (id) await updateDoc(doc(db, 'presupuestos', id), data);
    else await addDoc(collection(db, 'presupuestos'), { ...data, creadoEn: serverTimestamp() });
    el('modal-pres').remove();
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB CENTROS DE COSTO
// ═══════════════════════════════════════════════════════════════════════════════
function _montarCentros() {
  const c = el('fin-content');
  c.innerHTML = `
    <div style="display:grid;grid-template-columns:300px 1fr;gap:16px">
      <!-- Catálogo de CCs -->
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <b>Centros de Costo</b>
          <button class="btn-sm btn-primary" onclick="window._ccNuevo()">+ CC</button>
        </div>
        <div id="cc-lista">Cargando…</div>
      </div>
      <!-- P&L por CC -->
      <div class="card">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
          <b>P&L por Centro de Costo</b>
          <input type="month" id="cc-mes" class="input" style="flex:1" value="${hoy().slice(0,7)}"
            onchange="window._ccCargarPL()">
        </div>
        <div id="cc-pl-contenido">Selecciona un período.</div>
      </div>
    </div>
    <!-- Imputar movimiento -->
    <div class="card" style="margin-top:16px">
      <b>Imputar Movimiento a Centro de Costo</b>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:8px">
        <div><label>Centro de Costo</label><select id="imp-cc" class="input" style="width:100%"><option value="">Seleccionar…</option></select></div>
        <div><label>Tipo</label>
          <select id="imp-tipo" class="input">
            <option value="INGRESO">Ingreso</option>
            <option value="GASTO">Gasto</option>
          </select>
        </div>
        <div><label>Concepto</label><input id="imp-concepto" class="input" placeholder="Descripción"></div>
        <div><label>Monto</label><input type="number" id="imp-monto" class="input" placeholder="0.00"></div>
        <div><label>Fecha</label><input type="date" id="imp-fecha" class="input" value="${hoy()}"></div>
      </div>
      <button class="btn-primary" style="margin-top:8px" onclick="window._ccImputar()">Registrar</button>
    </div>`;

  _ccCargarLista();
  _ccCargarPL();
  window._ccNuevo    = () => _ccModal(null);
  window._ccCargarPL = () => _ccCargarPL();
  window._ccImputar  = () => _ccImputar();
}

function _ccCargarLista() {
  const q = query(collection(db, 'centros_costo'), orderBy('codigo'));
  const unsub = onSnapshot(q, snap => {
    const ccs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const lista = el('cc-lista');
    if (lista) {
      if (!ccs.length) { lista.innerHTML = '<p class="empty">Sin centros registrados</p>'; }
      else lista.innerHTML = ccs.map(cc => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
          <div>
            <div style="font-size:12px;font-weight:600">${cc.codigo} — ${cc.nombre}</div>
            <div style="font-size:11px;color:var(--text-muted)">${cc.tipo || ''}</div>
          </div>
          <div>
            <button class="btn-icon" onclick="window._ccEdit('${cc.id}')">✏️</button>
            <button class="btn-icon" onclick="window._ccDel('${cc.id}','${cc.nombre}')">🗑️</button>
          </div>
        </div>`).join('');
    }
    // Poblar selector de imputación
    const sel = el('imp-cc');
    if (sel) sel.innerHTML = '<option value="">Seleccionar…</option>' +
      ccs.map(cc => `<option value="${cc.id}">${cc.codigo} — ${cc.nombre}</option>`).join('');

    window._ccEdit = (id) => _ccModal(ccs.find(c => c.id === id));
    window._ccDel  = async (id, nombre) => {
      if (!confirm(`¿Eliminar CC "${nombre}"?`)) return;
      await deleteDoc(doc(db, 'centros_costo', id));
    };
  });
  _unsubs.push(unsub);
}

async function _ccCargarPL() {
  const mes = el('cc-mes')?.value || hoy().slice(0,7);
  const div = el('cc-pl-contenido');
  if (!div) return;
  div.innerHTML = '<div class="loading">Calculando…</div>';

  const inicio = new Date(mes + '-01');
  const fin    = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0, 23, 59, 59);

  const [snapCCs, snapMovs] = await Promise.all([
    getDocs(query(collection(db, 'centros_costo'), orderBy('codigo'))),
    getDocs(query(collection(db, 'movimientos_cc'),
      where('fecha', '>=', Timestamp.fromDate(inicio)),
      where('fecha', '<=', Timestamp.fromDate(fin)))),
  ]);

  const ccs  = snapCCs.docs.map(d => ({ id: d.id, ...d.data() }));
  const movs = snapMovs.docs.map(d => d.data());

  const pl = {};
  ccs.forEach(cc => { pl[cc.id] = { ingresos: 0, gastos: 0, nombre: cc.nombre, codigo: cc.codigo }; });
  movs.forEach(m => {
    if (!pl[m.centroId]) return;
    if (m.tipo === 'INGRESO') pl[m.centroId].ingresos += m.monto || 0;
    else pl[m.centroId].gastos += m.monto || 0;
  });

  const rows = Object.values(pl);
  if (!rows.length || movs.length === 0) {
    div.innerHTML = '<p class="empty">Sin movimientos en el período</p>';
    return;
  }

  div.innerHTML = `<table class="tbl" style="font-size:12px">
    <thead>
      <tr>
        <th>Código</th><th>Centro de Costo</th>
        <th class="num">Ingresos</th><th class="num">Gastos</th>
        <th class="num">Utilidad</th><th class="num">Margen</th>
      </tr>
    </thead>
    <tbody>${rows.map(r => {
      const util   = r.ingresos - r.gastos;
      const margen = r.ingresos > 0 ? util / r.ingresos * 100 : 0;
      return `<tr>
        <td><code>${r.codigo}</code></td>
        <td>${r.nombre}</td>
        <td class="num" style="color:#10b981">$${fmt(r.ingresos)}</td>
        <td class="num" style="color:#ef4444">$${fmt(r.gastos)}</td>
        <td class="num" style="color:${util>=0?'#10b981':'#ef4444'};font-weight:700">$${fmt(util)}</td>
        <td class="num" style="color:${margen>=0?'#10b981':'#ef4444'}">${margen.toFixed(1)}%</td>
      </tr>`;
    }).join('')}
    <tr style="background:var(--surface-2);font-weight:700">
      <td colspan="2">TOTAL</td>
      <td class="num" style="color:#10b981">$${fmt(rows.reduce((s,r)=>s+r.ingresos,0))}</td>
      <td class="num" style="color:#ef4444">$${fmt(rows.reduce((s,r)=>s+r.gastos,0))}</td>
      <td class="num">$${fmt(rows.reduce((s,r)=>s+(r.ingresos-r.gastos),0))}</td>
      <td></td>
    </tr>
    </tbody>
  </table>`;
}

async function _ccImputar() {
  const ccId     = el('imp-cc')?.value;
  const tipo     = el('imp-tipo')?.value;
  const concepto = el('imp-concepto')?.value.trim();
  const monto    = parseFloat(el('imp-monto')?.value) || 0;
  const fecha    = el('imp-fecha')?.value;

  if (!ccId || !monto || !concepto) return alert('Centro, concepto y monto son requeridos');

  await addDoc(collection(db, 'movimientos_cc'), {
    centroId: ccId, tipo, concepto, monto,
    fecha: Timestamp.fromDate(new Date(fecha)),
    usuario: Sesion.uid || '',
    creadoEn: serverTimestamp(),
  });

  el('imp-concepto').value = '';
  el('imp-monto').value = '';
}

function _ccModal(cc) {
  const TIPOS_CC = ['ZONA', 'RUTA', 'INGENIERO', 'PRODUCTO', 'PROYECTO', 'OTRO'];
  const html = `
    <div class="modal-overlay" id="modal-cc">
      <div class="modal" style="width:380px">
        <h3>${cc ? 'Editar' : 'Nuevo'} Centro de Costo</h3>
        <label>Código</label>
        <input id="cc-codigo" class="input" placeholder="CC-01" value="${cc?.codigo||''}">
        <label>Nombre</label>
        <input id="cc-nombre" class="input" placeholder="Zona Norte" value="${cc?.nombre||''}">
        <label>Tipo</label>
        <select id="cc-tipo" class="input">
          ${TIPOS_CC.map(t => `<option value="${t}"${cc?.tipo===t?' selected':''}>${t}</option>`).join('')}
        </select>
        <label>Descripción</label>
        <input id="cc-desc" class="input" placeholder="Opcional" value="${cc?.descripcion||''}">
        <label>Responsable</label>
        <input id="cc-resp" class="input" placeholder="Nombre o ID" value="${cc?.responsable||''}">
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn-primary" onclick="window._ccGuardar('${cc?.id||''}')">Guardar</button>
          <button class="btn-secondary" onclick="document.getElementById('modal-cc').remove()">Cancelar</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  window._ccGuardar = async (id) => {
    const data = {
      codigo:      el('cc-codigo').value.trim(),
      nombre:      el('cc-nombre').value.trim(),
      tipo:        el('cc-tipo').value,
      descripcion: el('cc-desc').value.trim(),
      responsable: el('cc-resp').value.trim(),
    };
    if (!data.codigo || !data.nombre) return alert('Código y nombre requeridos');
    if (id) await updateDoc(doc(db, 'centros_costo', id), data);
    else await addDoc(collection(db, 'centros_costo'), { ...data, creadoEn: serverTimestamp() });
    el('modal-cc').remove();
  };
}
