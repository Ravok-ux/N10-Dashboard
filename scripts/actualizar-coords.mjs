// actualizar-coords.mjs
// Lee coords-clientes.json y actualiza las ubicaciones en Firestore
// con lat/lng reales + direccion de texto.
//
// Uso: node scripts/actualizar-coords.mjs sa.json

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore }        from "firebase-admin/firestore";
import { readFileSync }        from "fs";
import { createRequire }       from "module";

const require     = createRequire(import.meta.url);
const saPath      = process.argv[2];
if (!saPath) { console.error("Pasa el service account como argumento"); process.exit(1); }
const sa          = require(saPath.includes(":") || saPath.startsWith("/") ? saPath : `../${saPath}`);

initializeApp({ credential: cert(sa), projectId: "n10-erp" });
const db = getFirestore();

// Datos extraídos del Excel
const COORDS = JSON.parse(readFileSync(new URL("./coords-clientes.json", import.meta.url), "utf8"));

async function main() {
  console.log(`\n📡  Procesando ${COORDS.length} clientes...\n`);
  let ok = 0, skipped = 0, errors = 0;

  for (const row of COORDS) {
    const lat  = parseFloat(row.lat);
    const lng  = parseFloat(row.lng);
    const tipo = (row.tipo || "otro").toLowerCase();
    const dir  = [row.calle, row.numExt].filter(Boolean).join(" ").trim() ||
                 [row.localidad, row.municipio].filter(Boolean).join(", ");

    if (!row.nombre || isNaN(lat) || isNaN(lng)) {
      console.warn(`  ⚠  Saltando fila incompleta: ${row.nombre}`);
      skipped++;
      continue;
    }

    // Buscar el cliente por nombre (normalizado)
    const norm = n => n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").trim();
    const snap = await db.collection("clientes").orderBy("nombre").get();
    const clienteDoc = snap.docs.find(d => norm(d.data().nombre || "") === norm(row.nombre));

    if (!clienteDoc) {
      console.warn(`  ❌  Cliente no encontrado en Firestore: "${row.nombre}"`);
      errors++;
      continue;
    }

    // Buscar ubicación existente con el mismo tipo
    const ubicSnap = await clienteDoc.ref.collection("ubicaciones")
      .where("tipo", "==", tipo).limit(1).get();

    if (!ubicSnap.empty) {
      // Actualizar coordenadas en la ubicación existente
      await ubicSnap.docs[0].ref.update({ lat, lng, direccion: dir });
      console.log(`  ✅  ${row.nombre} → ${tipo} (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
      ok++;
    } else {
      // No hay ubicación de ese tipo → buscar cualquier ubicación (la migración pudo crear una con tipo diferente)
      const allSnap = await clienteDoc.ref.collection("ubicaciones").limit(1).get();
      if (!allSnap.empty) {
        await allSnap.docs[0].ref.update({ lat, lng, tipo, direccion: dir });
        console.log(`  🔄  ${row.nombre} → tipo actualizado a "${tipo}" (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
        ok++;
      } else {
        console.warn(`  ⚠  ${row.nombre} no tiene ubicaciones creadas — saltando`);
        skipped++;
      }
    }
  }

  console.log(`\n── Resumen ──────────────────────────────────────`);
  console.log(`  ✅ Actualizados: ${ok}`);
  console.log(`  ⚠  Saltados:    ${skipped}`);
  console.log(`  ❌ Errores:     ${errors}`);
  console.log(`\n🎉  Listo.`);
}

main().catch(e => { console.error("❌ Error:", e); process.exit(1); });
