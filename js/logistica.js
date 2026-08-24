// ══════════════════════════════════════════════════════════════
// logistica.js — Visitas programadas por frecuencia
// Modelo: ingeniero lleva stock en su auto y visita clientes según
//         frecuencia (SEMANAL / QUINCENAL / MENSUAL / BIMESTRAL)
// Panel web: calendario de visitas por día / ingeniero
// APK: lista "mis clientes hoy" calculada desde este módulo
// Colecciones: clientes (campo frecuenciaVisita + ultimaVisita)
//              visitas_programadas
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import { Sesion } from "./auth.js";
import { esc } from "./app.js";
import {
  collection, doc, query, where, orderBy, limit,
  onSnapshot, addDoc, updateDoc, getDocs, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const fmtFecha = ts => ts
  ? new Date(typeof ts === "number" ? ts : ts.toMillis?.() ?? ts)
      .toLocaleDateString("es-MX", { day:"2-digit", month:"short", year:"numeric" })
  : "—";
const fmtHora  = ts => ts
  ? new Date(typeof ts === "number" ? ts : ts.toMillis?.() ?? ts)
      .toLocaleTimeString("es-MX", { hour:"2-digit", minute:"2-digit" })
  : "—";

const FRECUENCIA_DIAS = { SEMANAL:7, QUINCENAL:15, MENSUAL:30, BIMESTRAL:60 };
const FREQ_LABEL      = { SEMANAL:"Semanal",QUINCENAL:"Quincenal",MENSUAL:"Mensual",BIMESTRAL:"Bimestral" };
const STATUS_BADGE = {
  PENDIENTE: `<span class="badge badge-amber">PENDIENTE</span>`,
  COMPLETADA:`<span class="badge" style="background:#DCFCE7;color:#15803D">COMPLETADA</span>`,
  OMITIDA:   `<span class="badge badge-gray">OMITIDA</span>`,
};

let _unsubs     = [];
let _ingenieros = [];

export const LogisticaModule = {
  mount(container) {
    container.innerHTML = `
    <div class="mod-wrap">
      <div class="mod-topbar">
        <h2 class="mod-title">🚗 Logística de visitas</h2>
        <div class="mod-actions">
          <button class="btn-outline" id="log-gen-semana-btn">📅 Generar semana</button>
          <button class="btn-primary" id="log-gen-btn">⚡ Generar visitas del día</button>
        </div>
      </div>

      <!-- Tabs vista -->
      <div style="display:flex;gap:0;margin-bottom:16px;border-bottom:2px solid var(--border)">
        <button class="log-tab active" data-tab="dia" style="padding:8px 20px;background:none;border:none;cursor:pointer;font-weight:700;font-size:13px;border-bottom:2px solid var(--primary);margin-bottom:-2px;color:var(--primary)">📋 Día</button>
        <button class="log-tab" data-tab="semana" style="padding:8px 20px;background:none;border:none;cursor:pointer;font-size:13px;color:var(--text-sec)">📅 Semana</button>
        <button class="log-tab" data-tab="atrasados" style="padding:8px 20px;background:none;border:none;cursor:pointer;font-size:13px;color:var(--text-sec)">⚠️ Atrasados</button>
      </div>

      <!-- Vista día -->
      <div id="log-tab-dia">

      <!-- Filtros -->
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
        <select class="sel-sm" id="log-filtro-ing">
          <option value="">Todos los ingenieros</option>
        </select>
        <select class="sel-sm" id="log-filtro-status">
          <option value="">Todos los estados</option>
          <option value="PENDIENTE">Pendiente</option>
          <option value="COMPLETADA">Completada</option>
          <option value="OMITIDA">Omitida</option>
        </select>
        <input type="date" class="sel-sm" id="log-fecha" value="${new Date().toISOString().slice(0,10)}">
        <button class="btn-outline" id="log-buscar-btn">Buscar</button>
      </div>

      <!-- KPIs -->
      <div class="kpi-row" style="margin-bottom:16px">
        <div class="kpi-card" style="border-left-color:#D97706">
          <div class="kpi-icon">📋</div><div class="kpi-val" id="log-kpi-total">–</div>
          <div class="kpi-label">Visitas del día</div>
        </div>
        <div class="kpi-card" style="border-left-color:#16A34A">
          <div class="kpi-icon">✅</div><div class="kpi-val" id="log-kpi-comp">–</div>
          <div class="kpi-label">Completadas</div>
        </div>
        <div class="kpi-card" style="border-left-color:#DC2626">
          <div class="kpi-icon">⏳</div><div class="kpi-val" id="log-kpi-pend">–</div>
          <div class="kpi-label">Pendientes</div>
        </div>
        <div class="kpi-card" style="border-left-color:#1D4ED8">
          <div class="kpi-icon">📊</div><div class="kpi-val" id="log-kpi-pct">–</div>
          <div class="kpi-label">% cumplimiento</div>
        </div>
      </div>

      <!-- Tabla de visitas -->
      <div style="overflow-x:auto">
        <table class="data-table">
          <thead><tr>
            <th>INGENIERO</th><th>CLIENTE</th><th>FRECUENCIA</th>
            <th>ÚLT. VISITA</th><th>STATUS</th><th>CHECK-IN</th>
            <th>NOTAS</th><th>ACCIONES</th>
          </tr></thead>
          <tbody id="log-body">
            <tr><td colspan="8" style="padding:24px;text-align:center;color:var(--text-sec)">
              Selecciona una fecha y presiona Buscar</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Sección clientes por frecuencia -->
      <div style="margin-top:32px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <h3 style="font-size:15px;font-weight:700;margin:0">📋 Clientes y frecuencias asignadas</h3>
          <div style="display:flex;gap:8px">
            <select class="sel-sm" id="log-clientes-ing">
              <option value="">Todos los ingenieros</option>
            </select>
            <select class="sel-sm" id="log-clientes-frec">
              <option value="">Todas las frecuencias</option>
              <option value="SEMANAL">Semanal</option>
              <option value="QUINCENAL">Quincenal</option>
              <option value="MENSUAL">Mensual</option>
              <option value="BIMESTRAL">Bimestral</option>
            </select>
          </div>
        </div>
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead><tr>
              <th>CLIENTE</th><th>INGENIERO</th><th>FRECUENCIA</th>
              <th>ÚLTIMA VISITA</th><th>PRÓXIMA VISITA</th><th>DÍAS RESTANTES</th>
            </tr></thead>
            <tbody id="log-clientes-body">
              <tr><td colspan="6" style="padding:24px;text-align:center;color:var(--text-sec)">Cargando…</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div><!-- /log-tab-dia -->

      <!-- Vista semana -->
      <div id="log-tab-semana" style="display:none">
        <div id="log-semana-grid"></div>
      </div>

      <!-- Vista atrasados -->
      <div id="log-tab-atrasados" style="display:none">
        <div id="log-atrasados-content"></div>
      </div>

    </div>`;

    _cargarIngenieros().then(() => {
      _escucharVisitas();
      _escucharClientes();
    });
    _bindUI();
    return () => this.destroy();
  },
  destroy() { _unsubs.forEach(u => u?.()); _unsubs = []; }
};

async function _cargarIngenieros() {
  const snap = await getDocs(query(collection(db,"usuarios"), where("activo","==",true), orderBy("alias")));
  _ingenieros = snap.docs
    .filter(d => ["INGENIERO","RECUPERADOR"].includes(d.data().rol))
    .map(d => ({ uid: d.id, ...d.data() }));
  const opts = _ingenieros.map(u => `<option value="${esc(u.uid)}">${esc(u.alias||u.uid)}</option>`).join("");
  ["log-filtro-ing","log-clientes-ing"].forEach(id => {
    document.getElementById(id)?.insertAdjacentHTML("beforeend", opts);
  });
}

function _bindUI() {
  document.getElementById("log-buscar-btn")?.addEventListener("click", _escucharVisitas);
  document.getElementById("log-filtro-ing")?.addEventListener("change", _escucharVisitas);
  document.getElementById("log-filtro-status")?.addEventListener("change", _escucharVisitas);
  document.getElementById("log-clientes-ing")?.addEventListener("change", _escucharClientes);
  document.getElementById("log-clientes-frec")?.addEventListener("change", _escucharClientes);
  document.getElementById("log-gen-btn")?.addEventListener("click", _generarVisitasDelDia);
  document.getElementById("log-gen-semana-btn")?.addEventListener("click", _generarVisitasSemana);

  // Tabs
  document.querySelectorAll(".log-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".log-tab").forEach(b => {
        b.classList.remove("active");
        b.style.borderBottom = "none";
        b.style.color = "var(--text-sec)";
        b.style.fontWeight = "400";
      });
      btn.classList.add("active");
      btn.style.borderBottom = "2px solid var(--primary)";
      btn.style.color = "var(--primary)";
      btn.style.fontWeight = "700";
      const tab = btn.dataset.tab;
      document.getElementById("log-tab-dia").style.display       = tab === "dia"       ? "" : "none";
      document.getElementById("log-tab-semana").style.display    = tab === "semana"    ? "" : "none";
      document.getElementById("log-tab-atrasados").style.display = tab === "atrasados" ? "" : "none";
      if (tab === "semana")    _cargarVistaSemana();
      if (tab === "atrasados") _cargarAtrasados();
    });
  });
}

// ── Visitas programadas ───────────────────────────────────────
function _escucharVisitas() {
  _unsubs.filter(u => u._tag === "visitas").forEach(u => u?.());
  _unsubs = _unsubs.filter(u => u._tag !== "visitas");

  const fecha  = document.getElementById("log-fecha")?.value || new Date().toISOString().slice(0,10);
  const ingId  = document.getElementById("log-filtro-ing")?.value || "";
  const status = document.getElementById("log-filtro-status")?.value || "";

  const [y,m,d] = fecha.split("-").map(Number);
  const desdeTs = new Date(y,m-1,d,0,0,0).getTime();
  const hastaTs = new Date(y,m-1,d,23,59,59).getTime();

  let constraints = [
    where("fechaTs",">=",desdeTs), where("fechaTs","<=",hastaTs),
    orderBy("fechaTs","asc"), limit(500)
  ];
  if (ingId)  constraints = [where("ingenieroId","==",ingId), ...constraints];
  if (status) constraints = [where("status","==",status), ...constraints];
  const q = query(collection(db,"visitas_programadas"), ...constraints);

  const tbody = document.getElementById("log-body");
  if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="padding:24px;text-align:center">Cargando…</td></tr>`;

  const unsub = onSnapshot(q, snap => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderVisitas(rows);
  }, err => console.error("[Logistica]", err));
  unsub._tag = "visitas";
  _unsubs.push(unsub);
}

function _renderVisitas(rows) {
  const total = rows.length;
  const comp  = rows.filter(r => r.status === "COMPLETADA").length;
  const pend  = rows.filter(r => r.status === "PENDIENTE").length;
  const pct   = total > 0 ? Math.round(comp/total*100) : 0;

  const el = id => document.getElementById(id);
  if(el("log-kpi-total")) el("log-kpi-total").textContent = total;
  if(el("log-kpi-comp"))  el("log-kpi-comp").textContent  = comp;
  if(el("log-kpi-pend"))  el("log-kpi-pend").textContent  = pend;
  if(el("log-kpi-pct"))   el("log-kpi-pct").textContent   = pct + "%";

  const tbody = document.getElementById("log-body");
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:32px;text-align:center;color:var(--text-sec)">
      Sin visitas programadas para esta fecha</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const isPend = r.status === "PENDIENTE";
    return `<tr>
      <td style="font-weight:600">${esc(r.ingenieroAlias||"–")}</td>
      <td>
        <div style="font-weight:700">${esc(r.clienteNombre||"–")}</div>
        <div style="font-size:11px;color:var(--text-sec)">${esc(r.clienteDireccion||"")}</div>
      </td>
      <td><span class="badge badge-gray" style="font-size:10px">${esc(FREQ_LABEL[r.frecuencia]||r.frecuencia||"–")}</span></td>
      <td style="font-size:11px;color:var(--text-sec)">${fmtFecha(r.ultimaVisita)}</td>
      <td>${STATUS_BADGE[r.status] || `<span class="badge badge-gray">${esc(r.status)}</span>`}</td>
      <td style="font-size:11px;color:var(--text-sec)">${r.checkInTs ? fmtHora(r.checkInTs) : "–"}</td>
      <td style="font-size:11px;max-width:160px;color:var(--text-sec)">${esc(r.notas||"")}</td>
      <td style="white-space:nowrap">
        ${isPend ? `
          <button class="btn-sm btn-green" data-id="${r.id}" data-act="comp">✓ Completar</button>
          <button class="btn-sm btn-outline" data-id="${r.id}" data-act="omit" style="margin-left:4px">Omitir</button>
        ` : "–"}
      </td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll("[data-act]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { id, act } = btn.dataset;
      if (act === "comp") {
        const notas = await window.promptModal({ title: "Completar visita", label: "Notas de la visita (opcional)", placeholder: "Notas…" });
        if (notas === null) return;
        await updateDoc(doc(db,"visitas_programadas",id), {
          status: "COMPLETADA", notas: notas||"",
          checkInTs: Date.now(), completadaEn: Date.now()
        });
        // Actualizar ultimaVisita en el cliente
        const row = rows.find(r => r.id === id);
        if (row?.clienteId) {
          await updateDoc(doc(db,"clientes",row.clienteId), { ultimaVisita: Date.now() });
        }
        window.toast?.("Visita completada","success");
      } else {
        await updateDoc(doc(db,"visitas_programadas",id), { status:"OMITIDA" });
        window.toast?.("Visita omitida","info");
      }
    });
  });
}

// ── Clientes con frecuencia ───────────────────────────────────
let _clientesUnsub = null;

function _escucharClientes() {
  _clientesUnsub?.(); _clientesUnsub = null;
  const ingId = document.getElementById("log-clientes-ing")?.value || "";
  const frec  = document.getElementById("log-clientes-frec")?.value || "";

  let constraints = [where("activo","==",true), orderBy("nombre"), limit(500)];
  if (ingId) constraints = [where("ingenieroId","==",ingId), ...constraints];
  if (frec)  constraints = [where("frecuenciaVisita","==",frec), ...constraints];
  const q = query(collection(db,"clientes"), ...constraints);

  const tbody = document.getElementById("log-clientes-body");
  _clientesUnsub = onSnapshot(q, snap => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(r => r.frecuenciaVisita); // solo clientes con frecuencia asignada
    _renderClientesFrecuencia(rows);
  }, err => console.error("[Logistica-Clientes]", err));
  _unsubs.push(_clientesUnsub);
}

function _renderClientesFrecuencia(rows) {
  const tbody = document.getElementById("log-clientes-body");
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:32px;text-align:center;color:var(--text-sec)">
      Sin clientes con frecuencia asignada</td></tr>`;
    return;
  }
  const ahora = Date.now();
  tbody.innerHTML = rows.map(r => {
    const dias   = FRECUENCIA_DIAS[r.frecuenciaVisita] || 30;
    const ultima = r.ultimaVisita || 0;
    const proxTs = ultima + dias * 86400000;
    const faltan = Math.ceil((proxTs - ahora) / 86400000);
    const atrasado = faltan < 0;
    const hoy      = faltan === 0;
    const colorDias = atrasado ? "#DC2626" : hoy ? "#D97706" : faltan <= 2 ? "#D97706" : "#16A34A";

    return `<tr>
      <td style="font-weight:700">${esc(r.nombre||"–")}</td>
      <td style="font-size:12px">${esc(r.ingenieroAlias||"Sin asignar")}</td>
      <td><span class="badge badge-gray" style="font-size:10px">${esc(FREQ_LABEL[r.frecuenciaVisita]||r.frecuenciaVisita)}</span></td>
      <td style="font-size:11px;color:var(--text-sec)">${ultima ? fmtFecha(ultima) : "Nunca"}</td>
      <td style="font-size:11px">${fmtFecha(proxTs)}</td>
      <td style="font-weight:700;color:${colorDias}">
        ${atrasado ? `⚠️ ${Math.abs(faltan)} días atrasado` : hoy ? "📍 HOY" : `${faltan} días`}
      </td>
    </tr>`;
  }).join("");
}

// ── Generar visitas del día ───────────────────────────────────
async function _generarVisitasDelDia() {
  const fecha    = document.getElementById("log-fecha")?.value || new Date().toISOString().slice(0,10);
  const [y,m,d]  = fecha.split("-").map(Number);
  const fechaTs   = new Date(y,m-1,d,0,0,0).getTime();
  const fechaFinTs= new Date(y,m-1,d,23,59,59).getTime();
  const ahora     = Date.now();

  if (!await window.modal({ title: "Generar visitas", message: `¿Generar visitas programadas para el ${fecha}? Solo se crearán clientes cuya próxima visita cae en esa fecha.`, confirmLabel: "Generar" })) return;

  const btn = document.getElementById("log-gen-btn");
  btn.disabled = true; btn.textContent = "Generando…";

  try {
    const snap = await getDocs(query(
      collection(db,"clientes"),
      where("activo","==",true),
      limit(500)
    ));
    const clientes = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.frecuenciaVisita);

    // Verificar visitas ya existentes ese día
    const existSnap = await getDocs(query(
      collection(db,"visitas_programadas"),
      where("fechaTs",">=",fechaTs),
      where("fechaTs","<=",fechaFinTs)
    ));
    const yaExisten = new Set(existSnap.docs.map(d => d.data().clienteId));

    const batch = [];
    for (const c of clientes) {
      if (yaExisten.has(c.id)) continue;
      const dias   = FRECUENCIA_DIAS[c.frecuenciaVisita] || 30;
      const ultima = c.ultimaVisita || 0;
      const proxTs = ultima + dias * 86400000;
      // Incluir si la próxima visita cae dentro del día seleccionado o está atrasada y el día es hoy/futuro
      const proxFecha = new Date(proxTs).toISOString().slice(0,10);
      if (proxFecha !== fecha) continue;

      batch.push(addDoc(collection(db,"visitas_programadas"), {
        clienteId:       c.id,
        clienteNombre:   c.nombre || "",
        clienteDireccion:c.direccion || "",
        ingenieroId:     c.ingenieroId || null,
        ingenieroAlias:  c.ingenieroAlias || null,
        frecuencia:      c.frecuenciaVisita,
        fecha,
        fechaTs,
        ultimaVisita:    c.ultimaVisita || null,
        status:          "PENDIENTE",
        generadoEn:      ahora,
        _ts:             ahora
      }));
    }

    if (!batch.length) {
      window.toast?.("No hay visitas que generar para esa fecha","info");
    } else {
      await Promise.all(batch);
      window.toast?.(`${batch.length} visitas generadas para ${fecha}`,"success");
    }
    _escucharVisitas();
  } catch(e) { window.toast?.(e.message,"error"); }
  finally { btn.disabled = false; btn.textContent = "⚡ Generar visitas del día"; }
}

// ══════════════════════════════════════════════════════════════
// VISTA SEMANAL
// ══════════════════════════════════════════════════════════════

// Devuelve [lunes, martes, … domingo] de la semana que contiene `fecha`
function _diasSemana(fecha = new Date()) {
  const d = new Date(fecha); d.setHours(0,0,0,0);
  const dow = (d.getDay() + 6) % 7; // 0=lun … 6=dom
  const lunes = new Date(d); lunes.setDate(d.getDate() - dow);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(lunes); x.setDate(lunes.getDate() + i);
    return x;
  });
}

const _DIA_LABEL = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];

async function _cargarVistaSemana() {
  const wrap = document.getElementById("log-semana-grid");
  if (!wrap) return;
  wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-sec)">Cargando semana…</div>`;

  try {
    const dias   = _diasSemana();
    const desde  = dias[0].getTime();
    const hasta  = dias[6].getTime() + 86_399_999;

    const snap = await getDocs(query(
      collection(db,"visitas_programadas"),
      where("fechaTs",">=",desde), where("fechaTs","<=",hasta),
      orderBy("fechaTs","asc"), limit(2000)
    ));
    const visitas = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Agrupar por día (iso) y por status
    const porDia = {}; // "yyyy-mm-dd" → { total, comp, pend, omit, ings: Set }
    visitas.forEach(v => {
      const k = v.fecha || new Date(v.fechaTs).toISOString().slice(0,10);
      if (!porDia[k]) porDia[k] = { total:0, comp:0, pend:0, omit:0, ings: new Set() };
      porDia[k].total++;
      if (v.status === "COMPLETADA") porDia[k].comp++;
      else if (v.status === "OMITIDA") porDia[k].omit++;
      else porDia[k].pend++;
      if (v.ingenieroAlias) porDia[k].ings.add(v.ingenieroAlias);
    });

    // Semana de navegación
    const semanaLabel = `${dias[0].toLocaleDateString("es-MX",{day:"numeric",month:"short"})} – ${dias[6].toLocaleDateString("es-MX",{day:"numeric",month:"short",year:"numeric"})}`;
    const hoyIso = new Date().toISOString().slice(0,10);

    wrap.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <span style="font-size:13px;font-weight:700">Semana: ${semanaLabel}</span>
        <button class="btn-outline" id="log-sem-prev" style="font-size:12px;padding:4px 12px">‹ Anterior</button>
        <button class="btn-outline" id="log-sem-hoy" style="font-size:12px;padding:4px 12px">Hoy</button>
        <button class="btn-outline" id="log-sem-next" style="font-size:12px;padding:4px 12px">Siguiente ›</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px">
        ${dias.map((dia, i) => {
          const iso  = dia.toISOString().slice(0,10);
          const data = porDia[iso] || { total:0, comp:0, pend:0, omit:0, ings: new Set() };
          const esHoy = iso === hoyIso;
          const pct  = data.total ? Math.round(data.comp / data.total * 100) : null;
          const barW = pct ?? 0;
          const ings = [...data.ings].slice(0,3).join(", ") + (data.ings.size > 3 ? ` +${data.ings.size-3}` : "");
          return `
            <div data-fecha="${esc(iso)}" class="log-sem-dia"
              style="border:1px solid ${esHoy ? "var(--primary)" : "var(--border)"};
                     border-radius:10px;padding:10px 8px;cursor:pointer;
                     background:${esHoy ? "var(--primary-light,#EFF6FF)" : "var(--card-bg,#fff)"};
                     transition:box-shadow .15s"
              onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,.12)'"
              onmouseout="this.style.boxShadow='none'">
              <div style="font-size:11px;font-weight:700;color:${esHoy?"var(--primary)":"var(--text-sec)"};text-transform:uppercase;letter-spacing:.04em">${_DIA_LABEL[i]}</div>
              <div style="font-size:20px;font-weight:800;margin:2px 0;color:${esHoy?"var(--primary)":"var(--text-primary)"}">${dia.getDate()}</div>
              ${data.total ? `
                <div style="font-size:11px;color:var(--text-sec);margin-bottom:4px">${data.total} visita${data.total!==1?"s":""}</div>
                <div style="height:4px;border-radius:2px;background:var(--border);margin-bottom:4px;overflow:hidden">
                  <div style="height:100%;width:${barW}%;background:#16A34A;border-radius:2px;transition:width .3s"></div>
                </div>
                <div style="font-size:10px;display:flex;gap:4px;flex-wrap:wrap">
                  ${data.comp ? `<span style="color:#16A34A">✓${data.comp}</span>` : ""}
                  ${data.pend ? `<span style="color:#D97706">⏳${data.pend}</span>` : ""}
                  ${data.omit ? `<span style="color:#9CA3AF">–${data.omit}</span>` : ""}
                </div>
                ${ings ? `<div style="font-size:9px;color:var(--text-sec);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ings)}</div>` : ""}
              ` : `<div style="font-size:11px;color:var(--text-sec)">Sin visitas</div>`}
            </div>`;
        }).join("")}
      </div>

      <!-- Detalle del día seleccionado -->
      <div id="log-sem-detalle" style="margin-top:20px"></div>`;

    // Click en día → muestra tabla de ese día
    wrap.querySelectorAll(".log-sem-dia").forEach(card => {
      card.addEventListener("click", () => {
        const fecha = card.dataset.fecha;
        document.getElementById("log-fecha").value = fecha;
        document.querySelector(".log-tab[data-tab='dia']").click();
        _escucharVisitas();
      });
    });

    // Navegación semana anterior / siguiente / hoy
    let _semRef = dias[0];
    wrap.querySelector("#log-sem-prev")?.addEventListener("click", () => {
      _semRef = new Date(_semRef); _semRef.setDate(_semRef.getDate() - 7);
      _cargarVistaSemanaDesde(_semRef);
    });
    wrap.querySelector("#log-sem-next")?.addEventListener("click", () => {
      _semRef = new Date(_semRef); _semRef.setDate(_semRef.getDate() + 7);
      _cargarVistaSemanaDesde(_semRef);
    });
    wrap.querySelector("#log-sem-hoy")?.addEventListener("click", () => {
      _semRef = new Date(); _cargarVistaSemanaDesde(_semRef);
    });

  } catch(e) {
    wrap.innerHTML = `<div style="padding:16px;color:#DC2626">${esc(e.message)}</div>`;
    console.error("[Logistica-Semana]", e);
  }
}

// Re-renderiza la semana a partir de un Date de referencia
async function _cargarVistaSemanaDesde(ref) {
  // Actualizamos el input de fecha al lunes de la semana y recargamos
  const dias  = _diasSemana(ref);
  document.getElementById("log-fecha").value = dias[0].toISOString().slice(0,10);
  await _cargarVistaSemana();
}

// ══════════════════════════════════════════════════════════════
// CLIENTES ATRASADOS
// ══════════════════════════════════════════════════════════════

async function _cargarAtrasados() {
  const wrap = document.getElementById("log-atrasados-content");
  if (!wrap) return;
  wrap.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-sec)">Calculando clientes atrasados…</div>`;

  try {
    const ahora = Date.now();
    const snap  = await getDocs(query(
      collection(db,"clientes"),
      where("activo","==",true),
      limit(600)
    ));
    const todos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.frecuenciaVisita);

    const atrasados = todos
      .map(c => {
        const dias   = FRECUENCIA_DIAS[c.frecuenciaVisita] || 30;
        const ultima = c.ultimaVisita || 0;
        const proxTs = ultima + dias * 86_400_000;
        const retraso = Math.floor((ahora - proxTs) / 86_400_000);
        return { ...c, dias, proxTs, retraso };
      })
      .filter(c => c.retraso > 0)
      .sort((a, b) => b.retraso - a.retraso);

    if (!atrasados.length) {
      wrap.innerHTML = `
        <div style="padding:48px;text-align:center;color:var(--text-sec)">
          <div style="font-size:32px;margin-bottom:8px">✅</div>
          <div style="font-weight:700;font-size:15px">Ningún cliente atrasado</div>
          <div style="font-size:12px;margin-top:4px">Todos los clientes tienen sus visitas al día</div>
        </div>`;
      return;
    }

    const criticos = atrasados.filter(c => c.retraso > c.dias);       // más de un período
    const normales  = atrasados.filter(c => c.retraso <= c.dias);

    const color = r => r > 30 ? "#DC2626" : r > 14 ? "#D97706" : "#F59E0B";

    const renderFila = c => `
      <tr>
        <td style="font-weight:700">${esc(c.nombre||"–")}</td>
        <td style="font-size:12px">${esc(c.ingenieroAlias||"Sin asignar")}</td>
        <td><span class="badge badge-gray" style="font-size:10px">${esc(FREQ_LABEL[c.frecuenciaVisita]||c.frecuenciaVisita)}</span></td>
        <td style="font-size:11px;color:var(--text-sec)">${c.ultimaVisita ? fmtFecha(c.ultimaVisita) : "Nunca"}</td>
        <td style="font-weight:800;color:${color(c.retraso)}">⚠️ ${c.retraso} día${c.retraso!==1?"s":""}</td>
      </tr>`;

    wrap.innerHTML = `
      <!-- KPIs atrasados -->
      <div class="kpi-row" style="margin-bottom:20px">
        <div class="kpi-card" style="border-left-color:#DC2626">
          <div class="kpi-icon">🚨</div>
          <div class="kpi-val">${criticos.length}</div>
          <div class="kpi-label">Críticos (más de un período)</div>
        </div>
        <div class="kpi-card" style="border-left-color:#D97706">
          <div class="kpi-icon">⚠️</div>
          <div class="kpi-val">${normales.length}</div>
          <div class="kpi-label">Levemente atrasados</div>
        </div>
        <div class="kpi-card" style="border-left-color:#6B7280">
          <div class="kpi-icon">👥</div>
          <div class="kpi-val">${atrasados.length}</div>
          <div class="kpi-label">Total atrasados</div>
        </div>
      </div>

      ${criticos.length ? `
        <h3 style="font-size:13px;font-weight:700;color:#DC2626;margin-bottom:8px">🚨 Críticos — más de un período sin visita</h3>
        <div style="overflow-x:auto;margin-bottom:24px">
          <table class="data-table">
            <thead><tr><th>CLIENTE</th><th>INGENIERO</th><th>FRECUENCIA</th><th>ÚLTIMA VISITA</th><th>RETRASO</th></tr></thead>
            <tbody>${criticos.map(renderFila).join("")}</tbody>
          </table>
        </div>` : ""}

      ${normales.length ? `
        <h3 style="font-size:13px;font-weight:700;color:#D97706;margin-bottom:8px">⚠️ Pendientes de visita</h3>
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead><tr><th>CLIENTE</th><th>INGENIERO</th><th>FRECUENCIA</th><th>ÚLTIMA VISITA</th><th>RETRASO</th></tr></thead>
            <tbody>${normales.map(renderFila).join("")}</tbody>
          </table>
        </div>` : ""}`;

  } catch(e) {
    wrap.innerHTML = `<div style="padding:16px;color:#DC2626">${esc(e.message)}</div>`;
    console.error("[Logistica-Atrasados]", e);
  }
}

// ══════════════════════════════════════════════════════════════
// GENERADOR INTELIGENTE DE SEMANA
// Genera visitas para toda la semana actual:
// - Clientes cuya próxima visita cae dentro de Lun-Dom
// - Clientes atrasados (proxTs < hoy): se asignan al día de hoy o al primer día futuro disponible
// ══════════════════════════════════════════════════════════════

async function _generarVisitasSemana() {
  const dias   = _diasSemana();
  const lunes  = dias[0];
  const domingo= dias[6];
  const semLabel = `${lunes.toLocaleDateString("es-MX",{day:"numeric",month:"short"})} – ${domingo.toLocaleDateString("es-MX",{day:"numeric",month:"short",year:"numeric"})}`;

  if (!await window.modal({
    title: "Generar visitas de la semana",
    message: `¿Generar visitas programadas para ${semLabel}?\n\nIncluye clientes cuya próxima visita cae esta semana y clientes con retraso.`,
    confirmLabel: "Generar"
  })) return;

  const btn = document.getElementById("log-gen-semana-btn");
  btn.disabled = true; btn.textContent = "Generando…";

  try {
    const ahora    = Date.now();
    const desdeTs  = lunes.getTime();
    const hastaTs  = domingo.getTime() + 86_399_999;
    const hoyIso   = new Date().toISOString().slice(0,10);

    // Clientes con frecuencia
    const cliSnap = await getDocs(query(
      collection(db,"clientes"), where("activo","==",true), limit(600)
    ));
    const clientes = cliSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.frecuenciaVisita);

    // Visitas ya existentes esta semana (para deduplicar)
    const existSnap = await getDocs(query(
      collection(db,"visitas_programadas"),
      where("fechaTs",">=",desdeTs), where("fechaTs","<=",hastaTs)
    ));
    const yaExisten = new Set(existSnap.docs.map(d => d.data().clienteId));

    const pendientes = [];  // { cliente, fecha, fechaTs }

    for (const c of clientes) {
      if (yaExisten.has(c.id)) continue;

      const diasFrec = FRECUENCIA_DIAS[c.frecuenciaVisita] || 30;
      const ultima   = c.ultimaVisita || 0;
      const proxTs   = ultima + diasFrec * 86_400_000;
      const proxIso  = new Date(proxTs).toISOString().slice(0,10);

      let fechaAsignar = null;
      let fechaTsAsignar = null;

      if (proxTs >= desdeTs && proxTs <= hastaTs) {
        // Próxima visita cae dentro de la semana — asignar en esa fecha exacta
        fechaAsignar   = proxIso;
        fechaTsAsignar = new Date(proxTs).setHours(0,0,0,0);
      } else if (proxTs < desdeTs) {
        // Atrasado — asignar al día de hoy si cae en la semana, si no al lunes
        const refDia = ahora >= desdeTs && ahora <= hastaTs ? hoyIso : lunes.toISOString().slice(0,10);
        fechaAsignar   = refDia;
        const [y,m,d]  = refDia.split("-").map(Number);
        fechaTsAsignar = new Date(y,m-1,d,0,0,0).getTime();
      }

      if (!fechaAsignar) continue;

      pendientes.push(addDoc(collection(db,"visitas_programadas"), {
        clienteId:        c.id,
        clienteNombre:    c.nombre || "",
        clienteDireccion: c.direccion || "",
        ingenieroId:      c.ingenieroId || null,
        ingenieroAlias:   c.ingenieroAlias || null,
        frecuencia:       c.frecuenciaVisita,
        fecha:            fechaAsignar,
        fechaTs:          fechaTsAsignar,
        ultimaVisita:     c.ultimaVisita || null,
        status:           "PENDIENTE",
        generadoEn:       ahora,
        _ts:              ahora
      }));
    }

    if (!pendientes.length) {
      window.toast?.("No hay visitas nuevas que generar esta semana", "info");
    } else {
      await Promise.all(pendientes);
      window.toast?.(`✅ ${pendientes.length} visita${pendientes.length!==1?"s":""} generadas para ${semLabel}`, "success");
    }
    _cargarVistaSemana();
  } catch(e) {
    window.toast?.(e.message, "error");
    console.error("[GenerarSemana]", e);
  } finally {
    btn.disabled = false; btn.textContent = "📅 Generar semana";
  }
}
