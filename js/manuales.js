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
  { id: "todos",       label: "Todos"                },
  { id: "flujo",       label: "Diagramas de flujo"   },
  { id: "politica",    label: "Políticas operativas"  },
  { id: "proceso",     label: "Procedimientos"        },
  { id: "formato",     label: "Formatos y plantillas" },
  { id: "otro",        label: "Otros"                 },
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
      style="border-radius:20px;padding:6px 14px;font-size:13px;font-weight:500;
             cursor:pointer;border:1.5px solid var(--md-primary,#1B5E20);
             background:${_cat === cat.id ? "var(--md-primary,#1B5E20)" : "transparent"};
             color:${_cat === cat.id ? "#fff" : "var(--md-primary,#1B5E20)"}">
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
               border:1.5px solid #ccc;font-size:14px;margin-bottom:14px;background:#fff">
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
      <div id="man-tipo-hint" style="font-size:12px;color:#888;margin-bottom:6px"></div>
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

  // Hint dinámico según tipo
  const hint = overlay.querySelector("#man-tipo-hint");
  const actualizarHint = () => {
    const tipo = overlay.querySelector("input[name='man-tipo']:checked")?.value;
    hint.textContent = tipo === "mermaid"
      ? "Escribe código Mermaid (flowchart LR, sequenceDiagram, etc.)"
      : "Escribe texto plano o Markdown";
  };
  actualizarHint();
  overlay.querySelectorAll("input[name='man-tipo']").forEach(r => r.addEventListener("change", actualizarHint));

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
