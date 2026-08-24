// ══════════════════════════════════════════════════════════════
// manuales.js — Módulo de Manuales y Políticas Operativas
// ══════════════════════════════════════════════════════════════

import { db, app } from "./firebase-config.js";
import { Sesion }  from "./auth.js";
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const _storage = getStorage(app);

const CATEGORIAS = [
  { id: "todos",       label: "Todos",                color: "var(--green-dark)" },
  { id: "flujo",       label: "Diagramas de flujo",   color: "#2563EB" },
  { id: "politica",    label: "Políticas operativas",  color: "#7C3AED" },
  { id: "proceso",     label: "Procedimientos",        color: "#D97706" },
  { id: "formato",     label: "Formatos y plantillas", color: "#0E7490" },
  { id: "otro",        label: "Otros",                 color: "#6B7280" },
];

const _e = s => s.replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#x27;' }[c]));

let _cat    = "todos";
let _manuales = [];
let _mermaid  = null;

async function _loadMermaid() {
  if (_mermaid) return _mermaid;
  const mod = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
  _mermaid = mod.default;
  _mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });
  return _mermaid;
}

function _esAdmin() {
  return ["SUPER_ADMIN","GERENTE","GERENTE_ZONA","ADMINISTRADOR"].includes(Sesion.rol);
}

// ── Módulo principal ──────────────────────────────────────────
export const ManualesModule = {
  _container: null,

  mount(container) {
    this._container = container;
    _renderShell(container);
    _cargarManuales();
  },

  destroy() {
    this._container = null;
  },
};

function _renderShell(c) {
  c.innerHTML = `
    <div style="max-width:900px;margin:0 auto;padding:16px 12px 80px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:8px;flex-wrap:wrap">
        <h2 style="margin:0;font-size:20px;font-weight:700">Manuales y Políticas</h2>
        ${_esAdmin() ? `<button id="btn-nuevo-manual"
          style="background:var(--md-primary,#1B5E20);color:#fff;border:none;border-radius:8px;
                 padding:8px 18px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap">
          + Nuevo manual
        </button>` : ""}
      </div>

      <!-- Chips de categoría -->
      <div id="man-chips" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px"></div>

      <!-- Grid de tarjetas -->
      <div id="man-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px">
        <p style="color:gray;grid-column:1/-1">Cargando...</p>
      </div>
    </div>`;

  _renderChips(c.querySelector("#man-chips"));

  if (_esAdmin()) {
    c.querySelector("#btn-nuevo-manual").addEventListener("click", () => _abrirEditor(null));
  }
}

function _renderChips(el) {
  el.innerHTML = CATEGORIAS.map(cat => `
    <button data-cat="${cat.id}"
      style="border-radius:20px;padding:5px 14px;font-size:12px;font-weight:700;
             cursor:pointer;border:1.5px solid ${cat.color};transition:.12s;
             background:${_cat === cat.id ? cat.color : "transparent"};
             color:${_cat === cat.id ? "#fff" : cat.color}">
      ${_e(cat.label)}
    </button>`).join("");

  el.querySelectorAll("button[data-cat]").forEach(btn => {
    btn.addEventListener("click", () => {
      _cat = btn.dataset.cat;
      _renderChips(el);
      _renderGrid();
    });
  });
}

async function _cargarManuales() {
  try {
    const snap = await getDocs(query(collection(db, "manuales"), orderBy("orden"), orderBy("fechaCreacion", "desc")));
    _manuales = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _renderGrid();
  } catch(err) {
    const grid = document.getElementById("man-grid");
    if (grid) grid.innerHTML = `<p style="color:red;grid-column:1/-1">Error al cargar: ${_e(err.message)}</p>`;
  }
}

function _renderGrid() {
  const grid = document.getElementById("man-grid");
  if (!grid) return;

  const lista = _cat === "todos"
    ? _manuales
    : _manuales.filter(m => m.categoria === _cat);

  if (!lista.length) {
    grid.innerHTML = `<p style="color:gray;grid-column:1/-1">No hay manuales en esta categoría.</p>`;
    return;
  }

  const catLabel = id => CATEGORIAS.find(c => c.id === id)?.label ?? id;

  grid.innerHTML = lista.map(m => `
    <div class="man-card" data-id="${_e(m.id)}"
      style="border-radius:12px;border:1.5px solid #e0e0e0;background:var(--surface,#fff);
             padding:16px;cursor:pointer;transition:box-shadow .15s;
             display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
                     color:var(--md-primary,#1B5E20);background:rgba(27,94,32,.1);
                     border-radius:4px;padding:2px 6px;white-space:nowrap">
          ${_e(catLabel(m.categoria))}
        </span>
        ${m.tipo === "mermaid" ? '<span style="font-size:11px;color:#888">📊 Diagrama</span>' : '<span style="font-size:11px;color:#888">📝 Texto</span>'}
      </div>
      <h3 style="margin:4px 0 0;font-size:15px;font-weight:700;line-height:1.3">${_e(m.titulo)}</h3>
      ${m.descripcion ? `<p style="margin:0;font-size:13px;color:#555;line-height:1.4">${_e(m.descripcion)}</p>` : ""}
      ${m.imagenUrl ? `<img src="${_e(m.imagenUrl)}" style="width:100%;border-radius:6px;max-height:120px;object-fit:cover;margin-top:4px" loading="lazy">` : ""}
      ${_esAdmin() ? `
        <div class="man-acciones" style="display:flex;gap:6px;margin-top:8px" onclick="event.stopPropagation()">
          <button data-edit="${_e(m.id)}"
            style="flex:1;border:1.5px solid #aaa;border-radius:6px;background:transparent;
                   padding:5px;font-size:12px;cursor:pointer;font-weight:600">Editar</button>
          <button data-del="${_e(m.id)}"
            style="border:1.5px solid #e53935;border-radius:6px;background:transparent;
                   padding:5px 10px;font-size:12px;cursor:pointer;color:#e53935;font-weight:600">✕</button>
        </div>` : ""}
    </div>`).join("");

  grid.querySelectorAll(".man-card").forEach(card => {
    const id = card.dataset.id;
    const m  = _manuales.find(x => x.id === id);
    card.addEventListener("click", e => {
      if (e.target.closest(".man-acciones")) return;
      _abrirLector(m);
    });

    card.querySelector("[data-edit]")?.addEventListener("click", e => {
      e.stopPropagation();
      _abrirEditor(m);
    });

    card.querySelector("[data-del]")?.addEventListener("click", e => {
      e.stopPropagation();
      _confirmarEliminar(m);
    });
  });
}

// ── Lector modal ──────────────────────────────────────────────
async function _abrirLector(m) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px";

  const catLabel = CATEGORIAS.find(c => c.id === m.categoria)?.label ?? m.categoria;

  overlay.innerHTML = `
    <div style="background:var(--md-surface,#fff);border-radius:16px;max-width:780px;width:100%;
                max-height:90vh;overflow-y:auto;padding:28px 24px 24px;position:relative">
      <button id="man-cerrar"
        style="position:absolute;top:14px;right:14px;border:none;background:transparent;
               font-size:22px;cursor:pointer;color:#666;line-height:1">✕</button>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
                     color:var(--md-primary,#1B5E20);background:rgba(27,94,32,.1);
                     border-radius:4px;padding:2px 8px">${_e(catLabel)}</span>
      </div>
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:800">${_e(m.titulo)}</h2>
      ${m.descripcion ? `<p style="margin:0 0 16px;color:#555;font-size:14px">${_e(m.descripcion)}</p>` : ""}
      <div id="man-contenido" style="overflow-x:auto"></div>
      ${m.imagenUrl ? `<img src="${_e(m.imagenUrl)}" style="width:100%;border-radius:10px;margin-top:16px" loading="lazy">` : ""}
    </div>`;

  document.body.appendChild(overlay);
  overlay.querySelector("#man-cerrar").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });

  const contenedorContenido = overlay.querySelector("#man-contenido");

  if (m.tipo === "mermaid" && m.contenido) {
    try {
      const mermaid = await _loadMermaid();
      const id = "mermaid-" + Date.now();
      contenedorContenido.innerHTML = `<pre class="mermaid" id="${id}" style="text-align:center">${_e(m.contenido)}</pre>`;
      await mermaid.run({ nodes: [contenedorContenido.querySelector(`#${id}`)] });
    } catch(err) {
      contenedorContenido.innerHTML = `<pre style="background:#f5f5f5;padding:12px;border-radius:8px;overflow-x:auto;font-size:13px">${_e(m.contenido)}</pre>
        <p style="color:red;font-size:12px">Error al renderizar diagrama: ${_e(err.message)}</p>`;
    }
  } else if (m.contenido) {
    contenedorContenido.innerHTML = `<div style="white-space:pre-wrap;font-size:14px;line-height:1.6;background:#f9f9f9;
      border-radius:8px;padding:14px">${_e(m.contenido)}</div>`;
  }
}

// ── Editor modal ──────────────────────────────────────────────
function _abrirEditor(m) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px";

  const opsCat = CATEGORIAS.filter(c => c.id !== "todos").map(c =>
    `<option value="${c.id}" ${m?.categoria === c.id ? "selected" : ""}>${_e(c.label)}</option>`).join("");

  overlay.innerHTML = `
    <div style="background:var(--md-surface,#fff);border-radius:16px;max-width:700px;width:100%;
                max-height:92vh;overflow-y:auto;padding:28px 24px 24px;position:relative">
      <button id="man-ed-cerrar"
        style="position:absolute;top:14px;right:14px;border:none;background:transparent;
               font-size:22px;cursor:pointer;color:#666;line-height:1">✕</button>
      <h3 style="margin:0 0 20px;font-size:18px;font-weight:800">${m ? "Editar manual" : "Nuevo manual"}</h3>

      <label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px">Título *</label>
      <input id="man-titulo" value="${_e(m?.titulo ?? "")}"
        style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;
               border:1.5px solid #ccc;font-size:14px;margin-bottom:14px">

      <label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px">Categoría *</label>
      <select id="man-cat"
        style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;
               border:1.5px solid #ccc;font-size:14px;margin-bottom:14px;background:var(--surface)">
        ${opsCat}
      </select>

      <label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px">Descripción corta</label>
      <input id="man-desc" value="${_e(m?.descripcion ?? "")}"
        style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;
               border:1.5px solid #ccc;font-size:14px;margin-bottom:14px">

      <label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px">Tipo de contenido</label>
      <div style="display:flex;gap:16px;margin-bottom:14px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px">
          <input type="radio" name="man-tipo" value="texto" ${(!m || m.tipo === "texto") ? "checked" : ""}> Texto / Markdown
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px">
          <input type="radio" name="man-tipo" value="mermaid" ${m?.tipo === "mermaid" ? "checked" : ""}> Diagrama Mermaid
        </label>
      </div>

      <label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px">Contenido</label>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;gap:6px">
        <div id="man-tipo-hint" style="font-size:12px;color:#888"></div>
        <button id="btn-asistente-mermaid" type="button"
          style="font-size:12px;font-weight:600;padding:5px 12px;border-radius:6px;cursor:pointer;
                 background:rgba(27,94,32,.1);color:var(--md-primary,#1B5E20);border:1.5px solid var(--md-primary,#1B5E20);
                 display:none;white-space:nowrap">
          🧩 Asistente visual
        </button>
      </div>
      <textarea id="man-contenido" rows="10"
        style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;
               border:1.5px solid #ccc;font-size:13px;font-family:monospace;resize:vertical;
               margin-bottom:14px">${_e(m?.contenido ?? "")}</textarea>

      <label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px">Imagen adjunta (opcional)</label>
      ${m?.imagenUrl ? `<img src="${_e(m.imagenUrl)}" style="max-width:200px;border-radius:8px;display:block;margin-bottom:8px">` : ""}
      <input id="man-imagen" type="file" accept="image/jpeg,image/png,image/webp"
        style="margin-bottom:6px;font-size:13px">
      <p style="margin:0 0 20px;font-size:11px;color:#888">JPG / PNG / WEBP · Máx 5 MB</p>

      <label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px">Orden (número)</label>
      <input id="man-orden" type="number" value="${m?.orden ?? 99}"
        style="width:80px;padding:8px 10px;border-radius:8px;border:1.5px solid #ccc;
               font-size:14px;margin-bottom:20px">

      <div id="man-ed-error" style="color:red;font-size:13px;margin-bottom:10px;display:none"></div>
      <button id="man-ed-guardar"
        style="width:100%;background:var(--md-primary,#1B5E20);color:#fff;border:none;
               border-radius:8px;padding:12px;font-size:15px;font-weight:700;cursor:pointer">
        ${m ? "Guardar cambios" : "Crear manual"}
      </button>
    </div>`;

  document.body.appendChild(overlay);

  const cerrar = () => overlay.remove();
  overlay.querySelector("#man-ed-cerrar").addEventListener("click", cerrar);
  overlay.addEventListener("click", e => { if (e.target === overlay) cerrar(); });

  // Hint dinámico según tipo + mostrar/ocultar botón asistente
  const hint    = overlay.querySelector("#man-tipo-hint");
  const btnAsis = overlay.querySelector("#btn-asistente-mermaid");
  const actualizarHint = () => {
    const tipo = overlay.querySelector("input[name='man-tipo']:checked")?.value;
    if (tipo === "mermaid") {
      hint.textContent = "Escribe código Mermaid (flowchart LR, sequenceDiagram, etc.)";
      btnAsis.style.display = "";
    } else {
      hint.textContent = "Escribe texto plano o Markdown";
      btnAsis.style.display = "none";
    }
  };
  actualizarHint();
  overlay.querySelectorAll("input[name='man-tipo']").forEach(r => r.addEventListener("change", actualizarHint));

  btnAsis.addEventListener("click", () => {
    const ta = overlay.querySelector("#man-contenido");
    _abrirAsistenteMermaid(ta);
  });

  overlay.querySelector("#man-ed-guardar").addEventListener("click", () => _guardar(m, overlay, cerrar));
}

async function _guardar(m, overlay, cerrar) {
  const titulo    = overlay.querySelector("#man-titulo").value.trim();
  const cat       = overlay.querySelector("#man-cat").value;
  const desc      = overlay.querySelector("#man-desc").value.trim();
  const tipo      = overlay.querySelector("input[name='man-tipo']:checked")?.value ?? "texto";
  const contenido = overlay.querySelector("#man-contenido").value.trim();
  const orden     = parseInt(overlay.querySelector("#man-orden").value) || 99;
  const fileInput = overlay.querySelector("#man-imagen");
  const archivo   = fileInput.files[0] ?? null;

  const errEl = overlay.querySelector("#man-ed-error");
  const btnG  = overlay.querySelector("#man-ed-guardar");

  if (!titulo) { errEl.textContent = "El título es obligatorio."; errEl.style.display = ""; return; }
  errEl.style.display = "none";
  btnG.disabled = true;
  btnG.textContent = "Guardando...";

  try {
    let imagenUrl = m?.imagenUrl ?? null;

    if (archivo) {
      if (archivo.size > 5 * 1024 * 1024) throw new Error("La imagen no debe superar 5 MB.");
      const docId = m?.id ?? ("tmp_" + Date.now());
      const sref  = storageRef(_storage, `manuales/${docId}/${archivo.name}`);
      const snap  = await uploadBytes(sref, archivo, { contentType: archivo.type });
      imagenUrl   = await getDownloadURL(snap.ref);
    }

    const data = {
      titulo, categoria: cat, descripcion: desc, tipo, contenido,
      imagenUrl, orden, actualizadoPor: Sesion.alias,
      fechaActualizacion: serverTimestamp(),
    };

    if (m) {
      await updateDoc(doc(db, "manuales", m.id), data);
    } else {
      data.creadoPor    = Sesion.alias;
      data.fechaCreacion = serverTimestamp();
      await addDoc(collection(db, "manuales"), data);
    }

    cerrar();
    await _cargarManuales();
  } catch(err) {
    errEl.textContent = err.message;
    errEl.style.display = "";
    btnG.disabled = false;
    btnG.textContent = m ? "Guardar cambios" : "Crear manual";
  }
}

// ── Asistente visual Mermaid ──────────────────────────────────
function _abrirAsistenteMermaid(targetTextarea) {
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1100;display:flex;align-items:center;justify-content:center;padding:16px";

  ov.innerHTML = `
    <div style="background:var(--md-surface,#fff);border-radius:16px;max-width:620px;width:100%;
                max-height:92vh;overflow-y:auto;padding:26px 22px 22px;position:relative">
      <button id="asis-cerrar"
        style="position:absolute;top:12px;right:14px;border:none;background:transparent;
               font-size:22px;cursor:pointer;color:#666;line-height:1">✕</button>
      <h3 style="margin:0 0 4px;font-size:17px;font-weight:800">🧩 Asistente Mermaid</h3>
      <p style="margin:0 0 16px;font-size:13px;color:#666">Construye tu diagrama paso a paso sin saber código.</p>

      <!-- Tipo de diagrama -->
      <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px">Tipo de diagrama</label>
      <div id="asis-tipos" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px">
        ${[
          { id:"flowchart", icon:"🔀", label:"Flujo de proceso" },
          { id:"sequence",  icon:"🔄", label:"Secuencia / pasos" },
          { id:"pie",       icon:"🥧", label:"Distribución (pie)" },
          { id:"gantt",     icon:"📅", label:"Cronograma (Gantt)" },
        ].map(t => `
          <button data-tipo="${t.id}"
            style="border:1.5px solid #ccc;border-radius:8px;padding:8px 14px;cursor:pointer;
                   background:transparent;font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px">
            ${t.icon} ${t.label}
          </button>`).join("")}
      </div>

      <!-- Zona de construcción (se reemplaza según tipo) -->
      <div id="asis-zona"></div>

      <!-- Preview -->
      <details style="margin-top:14px">
        <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--md-primary,#1B5E20);margin-bottom:6px">
          👁 Ver código generado
        </summary>
        <pre id="asis-preview" style="background:#f4f4f4;border-radius:8px;padding:10px;font-size:12px;
             overflow-x:auto;white-space:pre-wrap;margin:6px 0 0"></pre>
      </details>

      <div style="display:flex;gap:10px;margin-top:18px">
        <button id="asis-insertar"
          style="flex:1;background:var(--md-primary,#1B5E20);color:#fff;border:none;border-radius:8px;
                 padding:12px;font-size:14px;font-weight:700;cursor:pointer">
          ✅ Insertar en el editor
        </button>
      </div>
    </div>`;

  document.body.appendChild(ov);
  ov.querySelector("#asis-cerrar").addEventListener("click", () => ov.remove());
  ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });

  let tipoActual = "flowchart";
  let generarCodigo = () => "";

  const zona    = ov.querySelector("#asis-zona");
  const preview = ov.querySelector("#asis-preview");

  const actualizarPreview = () => {
    preview.textContent = generarCodigo();
  };

  // ── Render según tipo ──
  function renderFlowchart() {
    zona.innerHTML = `
      <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px">Dirección</label>
      <select id="fc-dir" style="padding:8px;border-radius:6px;border:1.5px solid #ccc;margin-bottom:14px;font-size:13px">
        <option value="LR">Izquierda → Derecha</option>
        <option value="TD">Arriba → Abajo</option>
        <option value="RL">Derecha → Izquierda</option>
      </select>

      <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px">Pasos / nodos</label>
      <div id="fc-nodos" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px"></div>
      <button id="fc-agregar" type="button"
        style="font-size:13px;padding:6px 14px;border-radius:6px;border:1.5px dashed #aaa;
               background:transparent;cursor:pointer;color:#555">+ Agregar paso</button>

      <div style="margin-top:14px">
        <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px">Conexiones</label>
        <div id="fc-conexiones" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px"></div>
        <button id="fc-add-conexion" type="button"
          style="font-size:13px;padding:6px 14px;border-radius:6px;border:1.5px dashed #aaa;
                 background:transparent;cursor:pointer;color:#555">+ Agregar conexión</button>
      </div>`;

    let nodos = [
      { id:"A", texto:"Inicio", forma:"stadium" },
      { id:"B", texto:"Paso 1", forma:"rect" },
      { id:"C", texto:"Fin",    forma:"stadium" },
    ];
    let conexiones = [
      { de:"A", a:"B", etiqueta:"" },
      { de:"B", a:"C", etiqueta:"" },
    ];

    const FORMAS = [
      { v:"rect",     l:"Rectángulo [ ]" },
      { v:"stadium",  l:"Cápsula ([ ])" },
      { v:"diamond",  l:"Rombo { }" },
      { v:"cylinder", l:"Cilindro [( )]" },
      { v:"circle",   l:"Círculo (( ))" },
    ];

    const nodoSintaxis = n => {
      const t = _e(n.texto).replace(/"/g,"'");
      if (n.forma === "stadium")  return `${n.id}(["${t}"])`;
      if (n.forma === "diamond")  return `${n.id}{"${t}"}`;
      if (n.forma === "cylinder") return `${n.id}[("${t}")]`;
      if (n.forma === "circle")   return `${n.id}(("${t}"))`;
      return `${n.id}["${t}"]`;
    };

    const renderNodos = () => {
      const cont = zona.querySelector("#fc-nodos");
      cont.innerHTML = nodos.map((n, i) => `
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <input value="${_e(n.id)}" data-ni="${i}" data-campo="id" maxlength="4"
            style="width:48px;padding:6px 8px;border-radius:6px;border:1.5px solid #ccc;font-size:13px;font-family:monospace">
          <input value="${_e(n.texto)}" data-ni="${i}" data-campo="texto" placeholder="Texto del nodo"
            style="flex:1;min-width:120px;padding:6px 8px;border-radius:6px;border:1.5px solid #ccc;font-size:13px">
          <select data-ni="${i}" data-campo="forma"
            style="padding:6px 8px;border-radius:6px;border:1.5px solid #ccc;font-size:12px">
            ${FORMAS.map(f => `<option value="${f.v}" ${n.forma === f.v ? "selected":""}>${f.l}</option>`).join("")}
          </select>
          <button data-ni-del="${i}" type="button"
            style="border:none;background:transparent;cursor:pointer;color:#e53935;font-size:16px;padding:0 4px">✕</button>
        </div>`).join("");

      cont.querySelectorAll("input[data-ni],select[data-ni]").forEach(el => {
        el.addEventListener("input", () => {
          const i = +el.dataset.ni;
          nodos[i][el.dataset.campo] = el.value;
          actualizarPreview();
        });
      });
      cont.querySelectorAll("[data-ni-del]").forEach(btn => {
        btn.addEventListener("click", () => {
          nodos.splice(+btn.dataset.niDel, 1);
          renderNodos(); actualizarPreview();
        });
      });
    };

    const renderConexiones = () => {
      const cont = zona.querySelector("#fc-conexiones");
      cont.innerHTML = conexiones.map((c, i) => `
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <input value="${_e(c.de)}" data-ci="${i}" data-campo="de" placeholder="De"
            style="width:56px;padding:6px 8px;border-radius:6px;border:1.5px solid #ccc;font-size:13px;font-family:monospace">
          <span style="color:#888;font-size:13px">→</span>
          <input value="${_e(c.a)}" data-ci="${i}" data-campo="a" placeholder="A"
            style="width:56px;padding:6px 8px;border-radius:6px;border:1.5px solid #ccc;font-size:13px;font-family:monospace">
          <input value="${_e(c.etiqueta)}" data-ci="${i}" data-campo="etiqueta" placeholder="Etiqueta (opcional)"
            style="flex:1;min-width:100px;padding:6px 8px;border-radius:6px;border:1.5px solid #ccc;font-size:13px">
          <button data-ci-del="${i}" type="button"
            style="border:none;background:transparent;cursor:pointer;color:#e53935;font-size:16px;padding:0 4px">✕</button>
        </div>`).join("");

      cont.querySelectorAll("input[data-ci]").forEach(el => {
        el.addEventListener("input", () => {
          const i = +el.dataset.ci;
          conexiones[i][el.dataset.campo] = el.value;
          actualizarPreview();
        });
      });
      cont.querySelectorAll("[data-ci-del]").forEach(btn => {
        btn.addEventListener("click", () => {
          conexiones.splice(+btn.dataset.ciDel, 1);
          renderConexiones(); actualizarPreview();
        });
      });
    };

    zona.querySelector("#fc-agregar").addEventListener("click", () => {
      const letra = String.fromCharCode(65 + nodos.length % 26);
      nodos.push({ id: letra + (nodos.length > 25 ? Math.floor(nodos.length/26) : ""), texto:"Nuevo paso", forma:"rect" });
      renderNodos(); actualizarPreview();
    });
    zona.querySelector("#fc-add-conexion").addEventListener("click", () => {
      conexiones.push({ de:"", a:"", etiqueta:"" });
      renderConexiones(); actualizarPreview();
    });
    zona.querySelector("#fc-dir").addEventListener("change", actualizarPreview);

    renderNodos();
    renderConexiones();

    generarCodigo = () => {
      const dir = zona.querySelector("#fc-dir")?.value ?? "LR";
      const lines = [`flowchart ${dir}`];
      nodos.forEach(n => lines.push("    " + nodoSintaxis(n)));
      conexiones.forEach(c => {
        if (!c.de || !c.a) return;
        lines.push(c.etiqueta
          ? `    ${c.de} -- ${c.etiqueta} --> ${c.a}`
          : `    ${c.de} --> ${c.a}`);
      });
      return lines.join("\n");
    };
    actualizarPreview();
  }

  function renderSequence() {
    zona.innerHTML = `
      <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px">Pasos de la secuencia</label>
      <div id="seq-pasos" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px"></div>
      <button id="seq-agregar" type="button"
        style="font-size:13px;padding:6px 14px;border-radius:6px;border:1.5px dashed #aaa;
               background:transparent;cursor:pointer;color:#555">+ Agregar paso</button>`;

    let pasos = [
      { de:"Usuario", a:"Sistema", msg:"Envía solicitud", tipo:"->>" },
      { de:"Sistema", a:"Usuario", msg:"Retorna respuesta", tipo:"-->>" },
    ];
    const TIPOS = [
      { v:"->>",  l:"Sólida →" },
      { v:"-->>", l:"Punteada -->" },
      { v:"->",   l:"Sin punta →" },
      { v:"-->" ,  l:"Punteada sin punta" },
    ];

    const renderPasos = () => {
      const cont = zona.querySelector("#seq-pasos");
      cont.innerHTML = pasos.map((p, i) => `
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <input value="${_e(p.de)}" data-pi="${i}" data-campo="de" placeholder="De"
            style="width:90px;padding:6px 8px;border-radius:6px;border:1.5px solid #ccc;font-size:13px">
          <select data-pi="${i}" data-campo="tipo"
            style="padding:6px 6px;border-radius:6px;border:1.5px solid #ccc;font-size:12px">
            ${TIPOS.map(t => `<option value="${t.v}" ${p.tipo===t.v?"selected":""}>${t.l}</option>`).join("")}
          </select>
          <input value="${_e(p.a)}" data-pi="${i}" data-campo="a" placeholder="A"
            style="width:90px;padding:6px 8px;border-radius:6px;border:1.5px solid #ccc;font-size:13px">
          <input value="${_e(p.msg)}" data-pi="${i}" data-campo="msg" placeholder="Mensaje"
            style="flex:1;min-width:120px;padding:6px 8px;border-radius:6px;border:1.5px solid #ccc;font-size:13px">
          <button data-pi-del="${i}" type="button"
            style="border:none;background:transparent;cursor:pointer;color:#e53935;font-size:16px;padding:0 4px">✕</button>
        </div>`).join("");

      cont.querySelectorAll("input[data-pi],select[data-pi]").forEach(el => {
        el.addEventListener("input", () => {
          pasos[+el.dataset.pi][el.dataset.campo] = el.value;
          actualizarPreview();
        });
      });
      cont.querySelectorAll("[data-pi-del]").forEach(btn => {
        btn.addEventListener("click", () => {
          pasos.splice(+btn.dataset.piDel, 1);
          renderPasos(); actualizarPreview();
        });
      });
    };

    zona.querySelector("#seq-agregar").addEventListener("click", () => {
      pasos.push({ de:"A", a:"B", msg:"Mensaje", tipo:"->>" });
      renderPasos(); actualizarPreview();
    });
    renderPasos();

    generarCodigo = () => {
      const lines = ["sequenceDiagram"];
      pasos.forEach(p => lines.push(`    ${p.de}${p.tipo}${p.a}: ${p.msg}`));
      return lines.join("\n");
    };
    actualizarPreview();
  }

  function renderPie() {
    zona.innerHTML = `
      <label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px">Título</label>
      <input id="pie-titulo" placeholder="Distribución de..." value="Distribución"
        style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;border:1.5px solid #ccc;font-size:13px;margin-bottom:12px">
      <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px">Secciones</label>
      <div id="pie-secciones" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px"></div>
      <button id="pie-agregar" type="button"
        style="font-size:13px;padding:6px 14px;border-radius:6px;border:1.5px dashed #aaa;
               background:transparent;cursor:pointer;color:#555">+ Agregar sección</button>`;

    let secs = [
      { label:"Sección A", valor:40 },
      { label:"Sección B", valor:35 },
      { label:"Sección C", valor:25 },
    ];

    const renderSecs = () => {
      const cont = zona.querySelector("#pie-secciones");
      cont.innerHTML = secs.map((s, i) => `
        <div style="display:flex;gap:6px;align-items:center">
          <input value="${_e(s.label)}" data-si="${i}" data-campo="label" placeholder="Nombre"
            style="flex:1;padding:6px 8px;border-radius:6px;border:1.5px solid #ccc;font-size:13px">
          <input type="number" value="${s.valor}" data-si="${i}" data-campo="valor" placeholder="%"
            style="width:70px;padding:6px 8px;border-radius:6px;border:1.5px solid #ccc;font-size:13px">
          <button data-si-del="${i}" type="button"
            style="border:none;background:transparent;cursor:pointer;color:#e53935;font-size:16px;padding:0 4px">✕</button>
        </div>`).join("");
      cont.querySelectorAll("input[data-si]").forEach(el => {
        el.addEventListener("input", () => {
          secs[+el.dataset.si][el.dataset.campo] = el.dataset.campo === "valor" ? +el.value : el.value;
          actualizarPreview();
        });
      });
      cont.querySelectorAll("[data-si-del]").forEach(btn => {
        btn.addEventListener("click", () => {
          secs.splice(+btn.dataset.siDel, 1);
          renderSecs(); actualizarPreview();
        });
      });
    };

    zona.querySelector("#pie-titulo").addEventListener("input", actualizarPreview);
    zona.querySelector("#pie-agregar").addEventListener("click", () => {
      secs.push({ label:"Nueva sección", valor:10 });
      renderSecs(); actualizarPreview();
    });
    renderSecs();

    generarCodigo = () => {
      const titulo = zona.querySelector("#pie-titulo")?.value ?? "Distribución";
      const lines = [`pie title ${titulo}`];
      secs.forEach(s => lines.push(`    "${s.label}" : ${s.valor}`));
      return lines.join("\n");
    };
    actualizarPreview();
  }

  function renderGantt() {
    zona.innerHTML = `
      <label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px">Título del proyecto</label>
      <input id="gantt-titulo" value="Proyecto"
        style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:6px;border:1.5px solid #ccc;font-size:13px;margin-bottom:12px">
      <label style="display:block;font-size:13px;font-weight:600;margin-bottom:6px">Tareas</label>
      <div id="gantt-tareas" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px"></div>
      <button id="gantt-agregar" type="button"
        style="font-size:13px;padding:6px 14px;border-radius:6px;border:1.5px dashed #aaa;
               background:transparent;cursor:pointer;color:#555">+ Agregar tarea</button>`;

    let tareas = [
      { nombre:"Planeación", inicio:"2026-01-01", duracion:"7d", estado:"done" },
      { nombre:"Ejecución",  inicio:"2026-01-08", duracion:"14d", estado:"active" },
      { nombre:"Cierre",     inicio:"2026-01-22", duracion:"5d", estado:"" },
    ];
    const ESTADOS = [
      { v:"",       l:"Normal" },
      { v:"done",   l:"Completada" },
      { v:"active", l:"En curso" },
      { v:"crit",   l:"Crítica" },
    ];

    const renderTareas = () => {
      const cont = zona.querySelector("#gantt-tareas");
      cont.innerHTML = tareas.map((t, i) => `
        <div style="display:grid;grid-template-columns:1fr 120px 80px auto auto;gap:6px;align-items:center">
          <input value="${_e(t.nombre)}" data-ti="${i}" data-campo="nombre" placeholder="Nombre"
            style="padding:6px 8px;border-radius:6px;border:1.5px solid #ccc;font-size:13px">
          <input value="${_e(t.inicio)}" data-ti="${i}" data-campo="inicio" placeholder="YYYY-MM-DD"
            style="padding:6px 8px;border-radius:6px;border:1.5px solid #ccc;font-size:12px">
          <input value="${_e(t.duracion)}" data-ti="${i}" data-campo="duracion" placeholder="7d"
            style="padding:6px 8px;border-radius:6px;border:1.5px solid #ccc;font-size:13px">
          <select data-ti="${i}" data-campo="estado"
            style="padding:6px 4px;border-radius:6px;border:1.5px solid #ccc;font-size:12px">
            ${ESTADOS.map(e => `<option value="${e.v}" ${t.estado===e.v?"selected":""}>${e.l}</option>`).join("")}
          </select>
          <button data-ti-del="${i}" type="button"
            style="border:none;background:transparent;cursor:pointer;color:#e53935;font-size:16px;padding:0 4px">✕</button>
        </div>`).join("");

      cont.querySelectorAll("input[data-ti],select[data-ti]").forEach(el => {
        el.addEventListener("input", () => {
          tareas[+el.dataset.ti][el.dataset.campo] = el.value;
          actualizarPreview();
        });
      });
      cont.querySelectorAll("[data-ti-del]").forEach(btn => {
        btn.addEventListener("click", () => {
          tareas.splice(+btn.dataset.tiDel, 1);
          renderTareas(); actualizarPreview();
        });
      });
    };

    zona.querySelector("#gantt-titulo").addEventListener("input", actualizarPreview);
    zona.querySelector("#gantt-agregar").addEventListener("click", () => {
      tareas.push({ nombre:"Nueva tarea", inicio:"2026-02-01", duracion:"7d", estado:"" });
      renderTareas(); actualizarPreview();
    });
    renderTareas();

    generarCodigo = () => {
      const titulo = zona.querySelector("#gantt-titulo")?.value ?? "Proyecto";
      const lines = [
        `gantt`,
        `    title ${titulo}`,
        `    dateFormat YYYY-MM-DD`,
        `    section Actividades`,
      ];
      tareas.forEach(t => {
        const estado = t.estado ? t.estado + ", " : "";
        lines.push(`    ${t.nombre} : ${estado}${t.inicio}, ${t.duracion}`);
      });
      return lines.join("\n");
    };
    actualizarPreview();
  }

  // Selección de tipo
  const renderTipo = (tipo) => {
    tipoActual = tipo;
    ov.querySelectorAll("[data-tipo]").forEach(btn => {
      btn.style.background  = btn.dataset.tipo === tipo ? "rgba(27,94,32,.12)" : "transparent";
      btn.style.borderColor = btn.dataset.tipo === tipo ? "var(--md-primary,#1B5E20)" : "#ccc";
      btn.style.color       = btn.dataset.tipo === tipo ? "var(--md-primary,#1B5E20)" : "inherit";
    });
    if (tipo === "flowchart") renderFlowchart();
    else if (tipo === "sequence") renderSequence();
    else if (tipo === "pie") renderPie();
    else if (tipo === "gantt") renderGantt();
  };

  ov.querySelectorAll("[data-tipo]").forEach(btn => {
    btn.addEventListener("click", () => renderTipo(btn.dataset.tipo));
  });

  renderTipo("flowchart");

  ov.querySelector("#asis-insertar").addEventListener("click", () => {
    const codigo = generarCodigo();
    if (targetTextarea) {
      targetTextarea.value = codigo;
      targetTextarea.dispatchEvent(new Event("input"));
    }
    ov.remove();
  });
}

async function _confirmarEliminar(m) {
  if (!confirm(`¿Eliminar "${m.titulo}"? Esta acción no se puede deshacer.`)) return;
  try {
    await deleteDoc(doc(db, "manuales", m.id));
    if (m.imagenUrl) {
      try {
        const sref = storageRef(_storage, `manuales/${m.id}`);
        await deleteObject(sref);
      } catch (_) { /* puede no haber imagen en storage */ }
    }
    await _cargarManuales();
  } catch(err) {
    alert("Error al eliminar: " + err.message);
  }
}
