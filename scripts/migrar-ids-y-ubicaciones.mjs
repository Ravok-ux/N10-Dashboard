// migrar-ids-y-ubicaciones.mjs
// Asigna CLI-XXXXX a los 29 clientes existentes (orden alfabético)
// y crea una ubicación por cliente basada en su segmento + dirección geocodificada.
//
// Uso:  node scripts/migrar-ids-y-ubicaciones.mjs
// Req:  firebase-admin instalado  +  GOOGLE_APPLICATION_CREDENTIALS apuntando a la
//       service account de n10-erp  O  autenticación de gcloud con:
//       firebase login --reauth      (usa Application Default Credentials del CLI)

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// ── Config ────────────────────────────────────────────────────────────
const PROJECT_ID      = "n10-erp";
const GMAPS_KEY       = "AIzaSyCZS7tBcukVcQ5EPQdHGbEZky7LwHG0AS0";
const ID_PREFIX       = "CLI-";
const CREADO_POR      = "migración-panel-web";

// ── Init Firebase Admin ───────────────────────────────────────────────
// Opción A: variable de entorno GOOGLE_APPLICATION_CREDENTIALS apuntando a
//           un service account JSON descargado de Firebase Console →
//           Project Settings → Service Accounts → Generate new private key
// Opción B: pasar la ruta como argumento:
//           node scripts/migrar-ids-y-ubicaciones.mjs ruta/service-account.json
const saPath = process.argv[2] || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!saPath) {
  console.error("❌  Credenciales no encontradas.");
  console.error("    Descarga el Service Account desde:");
  console.error("    Firebase Console → Project Settings → Service Accounts → Generate new private key");
  console.error("    Luego ejecuta:");
  console.error("    node scripts/migrar-ids-y-ubicaciones.mjs ruta/service-account.json");
  process.exit(1);
}
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const serviceAccount = require(saPath.startsWith("/") || saPath.includes(":") ? saPath : `../${saPath}`);
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore();

// ── Geocodificar con Google Maps ──────────────────────────────────────
async function geocodificar(texto) {
  if (!texto || texto.trim().length < 4) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(texto)}&key=${GMAPS_KEY}`;
  try {
    const res  = await fetch(url);
    const json = await res.json();
    if (json.status === "OK" && json.results?.length) {
      const loc = json.results[0].geometry.location;
      return { lat: loc.lat, lng: loc.lng, formattedAddress: json.results[0].formatted_address };
    }
    console.warn("  Geocoding sin resultado:", json.status, texto);
    return null;
  } catch (e) {
    console.warn("  Geocoding error:", e.message);
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  const snap = await db.collection("clientes").orderBy("nombre").get();
  const docs = snap.docs;
  console.log(`\n📋  ${docs.length} clientes encontrados — asignando IDs y ubicaciones...\n`);

  const batch = db.batch();
  let counter = 0;
  const resultados = [];

  for (const doc of docs) {
    counter++;
    const data    = doc.data();
    const clienteId = ID_PREFIX + String(counter).padStart(5, "0");

    // ── 1. Asignar clienteId si no tiene ──────────────────────────
    if (!data.clienteId) {
      batch.update(doc.ref, { clienteId });
      console.log(`  ✅ ${clienteId}  →  ${data.nombre}`);
    } else {
      console.log(`  ⏭  ${data.clienteId} ya existía → ${data.nombre}`);
    }

    // ── 2. Crear ubicación si tiene segmento y no tiene ubicaciones ──
    const segmento = (data.segmento || "").trim();
    if (!segmento) {
      resultados.push({ nombre: data.nombre, clienteId, ubic: "sin segmento — omitida" });
      continue;
    }

    // Revisar si ya tiene ubicaciones
    const ubicSnap = await doc.ref.collection("ubicaciones").limit(1).get();
    if (!ubicSnap.empty) {
      resultados.push({ nombre: data.nombre, clienteId, ubic: "ya tiene ubicaciones — omitida" });
      continue;
    }

    // Construir texto de búsqueda: dirección + ciudad
    const textoBusqueda = [data.direccion, data.ciudad, "México"]
      .filter(Boolean).join(", ");

    console.log(`  🗺  Geocodificando "${textoBusqueda}" para ${data.nombre}...`);
    const geo = await geocodificar(textoBusqueda);

    const ubicData = {
      tipo:      segmento.toLowerCase(),   // vivero, invernadero, domicilio, etc.
      lat:       geo?.lat  ?? 0,
      lng:       geo?.lng  ?? 0,
      direccion: data.direccion || "",
      creadoPor: CREADO_POR,
      creadoEn:  FieldValue.serverTimestamp(),
    };

    if (geo?.formattedAddress) {
      ubicData.direccionGeocoded = geo.formattedAddress;
    }

    // Crear la ubicación
    const ubicRef = doc.ref.collection("ubicaciones").doc();
    batch.set(ubicRef, ubicData);

    // Crear entrada en historial
    const histRef = ubicRef.collection("historial").doc();
    batch.set(histRef, {
      quien:   CREADO_POR,
      rol:     "MIGRACIÓN",
      "cuándo": FieldValue.serverTimestamp(),
      accion:  "creado por migración automática",
    });

    const coordStr = geo ? `(${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)})` : "(sin coords)";
    resultados.push({ nombre: data.nombre, clienteId, ubic: `${segmento} ${coordStr}` });
  }

  console.log("\n⏳  Aplicando batch a Firestore...");
  await batch.commit();
  console.log("✅  Batch commit OK\n");

  console.log("── Resumen ──────────────────────────────────────────────────");
  resultados.forEach(r => console.log(`  ${r.clienteId}  ${r.nombre.padEnd(30)}  ${r.ubic}`));
  console.log("\n🎉  Migración completada.");
}

main().catch(e => { console.error("❌ Error:", e); process.exit(1); });
