// fusionar-gabriel.mjs
// 1. Fusiona los dos documentos de Gabriel Vázquez Salazar:
//    mueve la ubicación Vivero de CLI-00008 a CLI-00007 (con coords correctas)
//    y elimina el duplicado.
// 2. Renumera todos los clientes alfabéticamente CLI-00001…CLI-00028.
//
// Uso: node scripts/fusionar-gabriel.mjs sa.json

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const saPath  = process.argv[2];
if (!saPath) { console.error("Pasa el service account como argumento"); process.exit(1); }
const sa = require(saPath.includes(":") || saPath.startsWith("/") ? saPath : `../${saPath}`);
initializeApp({ credential: cert(sa), projectId: "n10-erp" });
const db = getFirestore();

// Coordenadas del Excel para los dos registros de Gabriel
const GABRIEL_COORDS = {
  invernadero: { lat: 18.972802, lng: -99.272635, direccion: "Ocuilan s/n" },
  vivero:      { lat: 18.972808, lng: -99.272696, direccion: "Ocuilan s/n" },
};

async function copiarSubcoleccion(srcRef, dstRef, nombre) {
  const snap = await srcRef.collection(nombre).get();
  for (const doc of snap.docs) {
    await dstRef.collection(nombre).doc(doc.id).set(doc.data());
  }
  return snap.size;
}

async function main() {
  // ── 1. Obtener todos los clientes ordenados por nombre ─────────────────
  const snap = await db.collection("clientes").orderBy("nombre").get();
  const docs  = snap.docs;
  console.log(`\n📋  ${docs.length} clientes en Firestore\n`);

  // ── 2. Encontrar los dos Gabriel ───────────────────────────────────────
  const gabrieles = docs.filter(d =>
    (d.data().nombre || "").toLowerCase().includes("gabriel vázquez salazar") ||
    (d.data().nombre || "").toLowerCase().includes("gabriel vazquez salazar")
  );
  if (gabrieles.length < 2) {
    console.log("ℹ  Solo hay un Gabriel Vázquez Salazar — no hay duplicado que fusionar.");
  } else {
    // Ordenar por clienteId ascendente → el menor (CLI-00007) es el que conservamos
    gabrieles.sort((a, b) =>
      (a.data().clienteId || "").localeCompare(b.data().clienteId || "")
    );
    const [keeper, dupe] = gabrieles;
    console.log(`🔗  Fusionando:`);
    console.log(`    KEEPER: ${keeper.data().clienteId} (${keeper.id})`);
    console.log(`    DUPE:   ${dupe.data().clienteId}   (${dupe.id})\n`);

    // 2a. Obtener ubicaciones del duplicado
    const ubicDupeSnap = await dupe.ref.collection("ubicaciones").get();
    console.log(`  ↳  Ubicaciones en duplicado: ${ubicDupeSnap.size}`);

    for (const ubicDoc of ubicDupeSnap.docs) {
      const ubicData = ubicDoc.data();
      const tipo = (ubicData.tipo || "").toLowerCase();

      // Corregir coordenadas con los datos del Excel
      const coords = GABRIEL_COORDS[tipo] || null;
      const newData = {
        ...ubicData,
        ...(coords ? { lat: coords.lat, lng: coords.lng, direccion: coords.direccion } : {}),
        fusionadoDe: dupe.id,
      };

      // Copiar al keeper
      const newRef = keeper.ref.collection("ubicaciones").doc();
      await newRef.set(newData);
      console.log(`  ✅  Ubicación "${tipo}" copiada al keeper con coords ${coords?.lat ?? 0}, ${coords?.lng ?? 0}`);

      // Copiar historial de esa ubicación
      const histSnap = await ubicDoc.ref.collection("historial").get();
      for (const h of histSnap.docs) {
        await newRef.collection("historial").doc(h.id).set(h.data());
      }
    }

    // 2b. Corregir también las coords de las ubicaciones ya en keeper (que pueden estar en 0,0)
    const ubicKeeperSnap = await keeper.ref.collection("ubicaciones").get();
    for (const ubicDoc of ubicKeeperSnap.docs) {
      const tipo = (ubicDoc.data().tipo || "").toLowerCase();
      const coords = GABRIEL_COORDS[tipo];
      if (coords && (ubicDoc.data().lat === 0 || ubicDoc.data().lat === undefined)) {
        await ubicDoc.ref.update({ lat: coords.lat, lng: coords.lng, direccion: coords.direccion });
        console.log(`  🔧  Coords corregidas en keeper: ${tipo} → (${coords.lat}, ${coords.lng})`);
      }
    }

    // 2c. Eliminar el duplicado
    await dupe.ref.delete();
    console.log(`\n  🗑  Documento duplicado eliminado: ${dupe.data().clienteId} (${dupe.id})\n`);
  }

  // ── 3. Renumerar todos los clientes alfabéticamente ────────────────────
  console.log("🔢  Renumerando clientes...\n");
  const snap2 = await db.collection("clientes").orderBy("nombre").get();
  const allDocs = snap2.docs;
  console.log(`    Total después de fusión: ${allDocs.length} clientes`);

  const batch = db.batch();
  allDocs.forEach((d, i) => {
    const nuevoId = "CLI-" + String(i + 1).padStart(5, "0");
    const actual  = d.data().clienteId || "(sin id)";
    batch.update(d.ref, { clienteId: nuevoId });
    console.log(`  ${actual.padEnd(10)} → ${nuevoId}  ${d.data().nombre}`);
  });
  await batch.commit();
  console.log("\n✅  Renumeración aplicada en Firestore.\n🎉  Listo.");
}

main().catch(e => { console.error("❌", e); process.exit(1); });
