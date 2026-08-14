/**
 * backup-firestore.js
 * Exporta todas las colecciones de Firestore a archivos JSON con timestamp.
 *
 * Requisitos:
 *   npm install firebase-admin    (solo una vez)
 *
 * Uso:
 *   node backup-firestore.js --key=ruta\serviceAccount.json [--out=ruta\backups]
 *
 * NUNCA subas serviceAccount.json al repositorio.
 * Agrégalo a .gitignore si no está ya.
 *
 * Colecciones exportadas (agrega aquí si añades nuevas en el futuro):
 */

const COLECCIONES = [
  "usuarios",
  "ubicaciones",
  "pedidos",
  "remisiones_credito",
  "abonos_remision",
  "ordenes_compra",
  "comision_config",
  "liquidacion_comision",
  "log_actividades",
  "comentarios_cliente",
  "historial_precios",
  "productos"
];

// ─────────────────────────────────────────────────────────────

const admin = require("firebase-admin");
const fs    = require("fs");
const path  = require("path");

// ── Parsear argumentos ────────────────────────────────────────
function arg(name) {
  const found = process.argv.find(a => a.startsWith(`--${name}=`));
  return found ? found.split("=").slice(1).join("=") : null;
}

const keyPath = arg("key");
const outBase = arg("out") || path.join(__dirname, "..", "backups");

if (!keyPath) {
  console.error("[backup] ERROR: Indica la ruta al archivo de cuenta de servicio:");
  console.error("  node backup-firestore.js --key=C:\\ruta\\serviceAccount.json");
  process.exit(1);
}
if (!fs.existsSync(keyPath)) {
  console.error(`[backup] ERROR: No se encontró el archivo: ${keyPath}`);
  process.exit(1);
}

// ── Inicializar Firebase Admin ────────────────────────────────
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── Carpeta de salida con timestamp ──────────────────────────
const ahora    = new Date();
const stamp    = ahora.toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir   = path.join(outBase, `backup_${stamp}`);
fs.mkdirSync(outDir, { recursive: true });

// ── Exportar colecciones ─────────────────────────────────────
async function exportarColeccion(nombre) {
  try {
    const snap = await db.collection(nombre).get();
    const docs = {};
    snap.forEach(d => { docs[d.id] = d.data(); });
    const rutaArchivo = path.join(outDir, `${nombre}.json`);
    fs.writeFileSync(rutaArchivo, JSON.stringify(docs, null, 2), "utf8");
    console.log(`  ✓ ${nombre}: ${snap.size} documentos → ${rutaArchivo}`);
    return snap.size;
  } catch (err) {
    console.error(`  ✗ ${nombre}: ${err.message}`);
    return 0;
  }
}

async function main() {
  console.log(`\n══════════════════════════════════════════`);
  console.log(`  BACKUP FIRESTORE — ${stamp}`);
  console.log(`  Destino: ${outDir}`);
  console.log(`══════════════════════════════════════════\n`);

  let totalDocs = 0;
  for (const col of COLECCIONES) {
    totalDocs += await exportarColeccion(col);
  }

  // ── Archivo de manifiesto ─────────────────────────────────
  const manifiesto = {
    fecha:        ahora.toISOString(),
    colecciones:  COLECCIONES,
    totalDocs,
    generadoPor:  serviceAccount.client_email,
    proyecto:     serviceAccount.project_id
  };
  fs.writeFileSync(
    path.join(outDir, "_manifiesto.json"),
    JSON.stringify(manifiesto, null, 2),
    "utf8"
  );

  // ── Checksum SHA-256 de cada archivo ─────────────────────
  const crypto = require("crypto");
  const checksums = {};
  for (const f of fs.readdirSync(outDir)) {
    const contenido = fs.readFileSync(path.join(outDir, f));
    checksums[f] = crypto.createHash("sha256").update(contenido).digest("hex");
  }
  fs.writeFileSync(
    path.join(outDir, "_checksums.sha256"),
    Object.entries(checksums).map(([f, h]) => `${h}  ${f}`).join("\n"),
    "utf8"
  );

  console.log(`\n══════════════════════════════════════════`);
  console.log(`  Total: ${totalDocs} documentos exportados`);
  console.log(`  Carpeta: ${outDir}`);
  console.log(`══════════════════════════════════════════\n`);

  process.exit(0);
}

main().catch(err => {
  console.error("[backup] Error fatal:", err.message);
  process.exit(1);
});
