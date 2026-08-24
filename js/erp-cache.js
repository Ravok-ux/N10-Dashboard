// erp-cache.js — Caché compartida de entidades para dropdowns en todos los módulos
import { db } from "./firebase-config.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let _clientes    = null;
let _ingenieros  = null;
let _proveedores = null;

export async function getClientes() {
  if (_clientes) return _clientes;
  try {
    const snap = await getDocs(collection(db, "clientes"));
    _clientes = snap.docs
      .map(d => ({ id: d.id, nombre: d.data().nombre || "", clienteId: d.data().clienteId || "", ingeniero: d.data().ingeniero || "" }))
      .filter(c => c.nombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  } catch { _clientes = []; }
  return _clientes;
}

export async function getIngenieros() {
  if (_ingenieros) return _ingenieros;
  try {
    const snap = await getDocs(query(collection(db, "usuarios"), where("rol", "in", ["INGENIERO","RECUPERADOR"])));
    _ingenieros = snap.docs
      .filter(d => d.data().activo !== false)
      .map(d => d.data().alias || d.id)
      .filter(Boolean).sort();
  } catch { _ingenieros = []; }
  return _ingenieros;
}

export async function getProveedores() {
  if (_proveedores) return _proveedores;
  try {
    const snap = await getDocs(query(collection(db, "proveedores"), where("activo", "==", true)));
    _proveedores = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
  } catch { _proveedores = []; }
  return _proveedores;
}

// Invalida el caché para forzar recarga
export function invalidarCache(tipo) {
  if (!tipo || tipo === "clientes")    _clientes    = null;
  if (!tipo || tipo === "ingenieros")  _ingenieros  = null;
  if (!tipo || tipo === "proveedores") _proveedores = null;
}

// Utilidad: renderiza un input de autocompletado reutilizable
// opts: { inputId, hiddenId, dropdownId, placeholder, labelKey, secondaryKey }
export function bindAutocomplete(lista, opts) {
  const input    = document.getElementById(opts.inputId);
  const hidden   = document.getElementById(opts.hiddenId);
  const dropdown = document.getElementById(opts.dropdownId);
  if (!input || !dropdown) return;

  const show = (items) => {
    if (!items.length) { dropdown.style.display = "none"; return; }
    dropdown.innerHTML = items.slice(0, 20).map(item => {
      const label = typeof item === "string" ? item : (item[opts.labelKey] || item.nombre || item);
      const sec   = typeof item === "string" ? "" : (item[opts.secondaryKey] || item.clienteId || "");
      const val   = typeof item === "string" ? item : (item[opts.valueKey] || label);
      return `<div data-val="${esc(val)}" data-label="${esc(label)}"
        style="padding:7px 10px;cursor:pointer;font-size:12px;color:var(--text-primary);
          border-bottom:1px solid var(--border)"
        onmousedown="event.preventDefault()"
        onclick="
          document.getElementById('${opts.inputId}').value='${esc(label)}';
          ${hidden ? `document.getElementById('${opts.hiddenId}').value='${esc(val)}';` : ""}
          document.getElementById('${opts.dropdownId}').style.display='none';
          ${opts.onSelect ? `(${opts.onSelect})(${JSON.stringify(item)})` : ""}
        ">
        <span style="font-weight:600">${esc(label)}</span>
        ${sec ? `<span style="color:#9CA3AF;font-size:10px;margin-left:6px">${esc(sec)}</span>` : ""}
      </div>`;
    }).join("");
    dropdown.style.display = "block";
  };

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (hidden) hidden.value = input.value.trim();
    if (!q) { dropdown.style.display = "none"; return; }
    const filtered = lista.filter(item => {
      const label = typeof item === "string" ? item : (item[opts.labelKey] || item.nombre || "");
      const sec   = typeof item === "string" ? "" : (item[opts.secondaryKey] || item.clienteId || "");
      return label.toLowerCase().includes(q) || sec.toLowerCase().includes(q);
    });
    show(filtered);
  });
  input.addEventListener("blur",  () => setTimeout(() => { dropdown.style.display = "none"; }, 150));
  input.addEventListener("focus", () => { if (input.value.trim()) input.dispatchEvent(new Event("input")); });
}

function esc(s) { return String(s ?? "").replace(/'/g, "\\'").replace(/"/g, "&quot;"); }
