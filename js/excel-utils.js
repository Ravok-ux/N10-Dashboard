// ══════════════════════════════════════════════════════════════
// excel-utils.js — Utilidades de importación/exportación Excel
// Depende de window.XLSX (SheetJS cargado en index.html)
// ══════════════════════════════════════════════════════════════

import { Sesion } from "./auth.js";

// ── Permisos ──────────────────────────────────────────────────
export function puedeImportar() {
  return Sesion.esSuperAdmin() ||
    Sesion.rol === "ADMINISTRADOR" ||
    Sesion.rol === "SUPER_ADMIN";
}

// ── Estilos de celda ─────────────────────────────────────────
const _HDR_STYLE = {
  font:      { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill:      { patternType: "solid", fgColor: { rgb: "1B5E20" } },
  alignment: { horizontal: "center", vertical: "center", wrapText: false },
  border: {
    bottom: { style: "thin", color: { rgb: "4CAF50" } }
  }
};
const _ROW_ALT = {
  fill: { patternType: "solid", fgColor: { rgb: "F0FFF4" } }
};

// ── Exportar datos a Excel ────────────────────────────────────
/**
 * @param {Object[]} rows        - Array de objetos con los datos
 * @param {Object[]} cols        - [{ key, header, width?, fmt? }]
 * @param {string}   filename    - Nombre del archivo (sin .xlsx)
 * @param {string}   sheetName   - Nombre de la hoja
 */
export function exportarExcel(rows, cols, filename, sheetName = "Datos") {
  const XLSX = window.XLSX;
  if (!XLSX) { window.toast?.("SheetJS no disponible.", "error"); return; }

  const headers = cols.map(c => c.header);
  const aoa = [headers, ...rows.map(row =>
    cols.map(c => {
      const v = row[c.key] ?? "";
      if (c.fmt === "fecha" && v?.toDate) return v.toDate().toLocaleDateString("es-MX");
      if (c.fmt === "fecha" && v instanceof Date) return v.toLocaleDateString("es-MX");
      if (c.fmt === "moneda") return typeof v === "number" ? v : parseFloat(v) || 0;
      return v;
    })
  )];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Anchos de columna
  ws["!cols"] = cols.map(c => ({ wch: c.width ?? 18 }));

  // Autofilter en la fila de encabezados
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({
    s: { r: 0, c: 0 }, e: { r: 0, c: cols.length - 1 }
  })};

  // Estilos (requiere SheetJS Pro para xlsx-style; aquí usamos workaround básico)
  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let C = range.s.c; C <= range.e.c; C++) {
    const hdrCell = ws[XLSX.utils.encode_cell({ r: 0, c: C })];
    if (hdrCell) hdrCell.s = _HDR_STYLE;
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filename}_${_hoy()}.xlsx`);
  window.toast?.(`Excel exportado: ${filename}_${_hoy()}.xlsx`, "success");
}

// ── Descargar plantilla vacía ─────────────────────────────────
/**
 * @param {Object[]} cols       - [{ key, header, width?, ejemplo? }]
 * @param {string}   filename   - Nombre base
 * @param {string}   sheetName
 */
export function descargarPlantilla(cols, filename, sheetName = "Plantilla") {
  const XLSX = window.XLSX;
  if (!XLSX) { window.toast?.("SheetJS no disponible.", "error"); return; }

  const headers  = cols.map(c => c.header);
  const ejemplos = cols.map(c => c.ejemplo ?? "");
  const aoa = [headers, ejemplos];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = cols.map(c => ({ wch: c.width ?? 18 }));
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({
    s: { r: 0, c: 0 }, e: { r: 0, c: cols.length - 1 }
  })};

  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let C = range.s.c; C <= range.e.c; C++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c: C })];
    if (cell) cell.s = _HDR_STYLE;
    const ex = ws[XLSX.utils.encode_cell({ r: 1, c: C })];
    if (ex) ex.s = { font: { italic: true, color: { rgb: "6B7280" } } };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `PLANTILLA_${filename}.xlsx`);
  window.toast?.(`Plantilla descargada: PLANTILLA_${filename}.xlsx`, "success");
}

// ── Importar desde archivo Excel ──────────────────────────────
/**
 * Muestra un file picker, lee el Excel y devuelve los registros como array de objetos.
 * @param {Object[]} cols  - [{ key, header, required?, tipo? }]
 * @returns {Promise<Object[]>}
 */
export function importarExcel(cols) {
  return new Promise((resolve, reject) => {
    const XLSX = window.XLSX;
    if (!XLSX) { reject(new Error("SheetJS no disponible.")); return; }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls";
    input.style.display = "none";
    document.body.appendChild(input);

    input.onchange = e => {
      const file = e.target.files[0];
      document.body.removeChild(input);
      if (!file) { resolve([]); return; }

      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const wb   = XLSX.read(ev.target.result, { type: "array" });
          const ws   = wb.Sheets[wb.SheetNames[0]];
          const raw  = XLSX.utils.sheet_to_json(ws, { defval: "" });

          // Mapear encabezados del Excel → keys internos
          const headerMap = {}; // "Nombre del ingeniero" → "nombre"
          cols.forEach(c => { headerMap[c.header.toLowerCase().trim()] = c; });

          // Primera fila podría ser fila de ejemplo — detectar si tiene datos reales
          const registros = raw
            .filter((_, i) => i > 0 || !_esFilaEjemplo(raw[0], cols)) // saltar fila de ejemplo
            .map(rawRow => {
              const obj = {};
              Object.entries(rawRow).forEach(([hdr, val]) => {
                const colDef = headerMap[String(hdr).toLowerCase().trim()];
                if (!colDef) return;
                if (colDef.tipo === "booleano") {
                  obj[colDef.key] = ["si","sí","true","1","yes","activo"].includes(String(val).toLowerCase().trim());
                } else if (colDef.tipo === "numero") {
                  const n = parseFloat(val);
                  obj[colDef.key] = isNaN(n) ? null : n;
                } else {
                  obj[colDef.key] = String(val ?? "").trim();
                }
              });
              return obj;
            })
            .filter(r => cols.filter(c => c.required).every(c => r[c.key]));

          if (registros.length === 0) {
            window.toast?.("El archivo no tiene datos válidos o no coincide con la plantilla.", "error");
            resolve([]);
          } else {
            resolve(registros);
          }
        } catch (err) {
          window.toast?.("Error al leer el archivo. Usa la plantilla descargada.", "error");
          reject(err);
        }
      };
      reader.readAsArrayBuffer(file);
    };

    input.click();
  });
}

// ── UI: barra de herramientas import/export ───────────────────
/**
 * Genera el HTML de la barra con botones de importar/exportar.
 * moduleId: identificador para los onclick
 */
export function toolbarHTML(moduleId, { soloExport = false } = {}) {
  const esAdmin = puedeImportar();
  return `
  <div class="xl-toolbar" id="xl-toolbar-${moduleId}">
    <button class="xl-btn xl-btn-export" onclick="${moduleId}_xlExport()"
      title="Exportar todos los datos a Excel">
      ⬇ Exportar Excel
    </button>
    <button class="xl-btn xl-btn-tmpl" onclick="${moduleId}_xlPlantilla()"
      title="Descargar plantilla vacía con el formato correcto">
      📋 Plantilla
    </button>
    ${!soloExport && esAdmin ? `
    <button class="xl-btn xl-btn-import" onclick="${moduleId}_xlImport()"
      title="Importar registros desde Excel (actualiza existentes, agrega nuevos)">
      ⬆ Importar Excel
    </button>` : ""}
  </div>`;
}

// ── Plantilla de actualización de stock ──────────────────────
/**
 * Descarga plantilla con Código N10 y Nombre pre-rellenos listos para capturar stock.
 * @param {Array<{codigo:string,nombre:string}>} productos
 */
export function descargarPlantillaStock(productos) {
  const XLSX = window.XLSX;
  if (!XLSX) { window.toast?.("SheetJS no disponible.", "error"); return; }

  const cols = [
    { header: "Código N10", wch: 14 },
    { header: "Nombre",     wch: 36 },
    { header: "Stock Nuevo",wch: 14 },
  ];
  const aoa = [
    cols.map(c => c.header),
    ...productos.map(p => [p.codigo || "", p.nombre || "", 0]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = cols.map(c => ({ wch: c.wch }));
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({
    s: { r: 0, c: 0 }, e: { r: 0, c: cols.length - 1 }
  })};

  const range = XLSX.utils.decode_range(ws["!ref"]);
  for (let C = range.s.c; C <= range.e.c; C++) {
    const h = ws[XLSX.utils.encode_cell({ r: 0, c: C })];
    if (h) h.s = _HDR_STYLE;
  }
  // Highlight columna Stock Nuevo
  for (let R = 1; R <= range.e.r; R++) {
    const cell = ws[XLSX.utils.encode_cell({ r: R, c: 2 })];
    if (cell) cell.s = { fill: { patternType: "solid", fgColor: { rgb: "FFF9C4" } } };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Stock");
  XLSX.writeFile(wb, `Plantilla_Stock_${_hoy()}.xlsx`);
  window.toast?.("Plantilla de stock descargada.", "success");
}

/**
 * Muestra file picker, lee la plantilla de stock y devuelve [{codigo, stock}].
 * @returns {Promise<Array<{codigo:string,stock:number}>>}
 */
export function importarPlantillaStock() {
  return new Promise((resolve, reject) => {
    const XLSX = window.XLSX;
    if (!XLSX) { reject(new Error("SheetJS no disponible.")); return; }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls";
    input.style.display = "none";
    document.body.appendChild(input);

    input.onchange = e => {
      const file = e.target.files[0];
      document.body.removeChild(input);
      if (!file) { resolve([]); return; }

      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const wb  = XLSX.read(ev.target.result, { type: "array" });
          const ws  = wb.Sheets[wb.SheetNames[0]];
          const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });
          const resultados = raw
            .map(row => {
              // Soporta encabezados exactos o aproximados
              const codigo = String(row["Código N10"] || row["Codigo N10"] || row["codigo"] || "").trim();
              const stockRaw = row["Stock Nuevo"] ?? row["stock"] ?? row["Stock"] ?? "";
              const stock = parseFloat(stockRaw);
              return { codigo, stock: isNaN(stock) ? null : stock };
            })
            .filter(r => r.codigo && r.stock !== null);

          if (!resultados.length) {
            window.toast?.("No se encontraron datos válidos en el archivo.", "error");
            resolve([]);
          } else {
            resolve(resultados);
          }
        } catch(err) {
          window.toast?.("Error al leer el archivo. Usa la plantilla descargada.", "error");
          reject(err);
        }
      };
      reader.readAsArrayBuffer(file);
    };
    input.click();
  });
}

// ── Helpers ───────────────────────────────────────────────────
function _hoy() {
  return new Date().toISOString().slice(0, 10);
}

function _esFilaEjemplo(row, cols) {
  // La fila de ejemplo suele tener textos como "ej:", "(ejemplo)", etc.
  return Object.values(row).some(v =>
    /^(ej[:\.]|ejemplo|sample|e\.g\.)/i.test(String(v))
  );
}
