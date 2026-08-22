// ══════════════════════════════════════════════════════════════
// mapa-clientes.js — Mapa interactivo de clientes georeferenciados
// Leaflet + MarkerCluster + Leaflet.heat (sin API key requerida)
// ══════════════════════════════════════════════════════════════

import { db } from "./firebase-config.js";
import {
  collection, query, orderBy, getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Resuelve lat/lng para un cliente: primero en root, luego en subcollección ubicaciones
async function _resolverCoords(c) {
  const lat = Number(c.lat), lng = Number(c.lng);
  if (lat && lng && Math.abs(lat) > 0.001 && Math.abs(lng) > 0.001) return c;
  try {
    const snap = await getDocs(collection(db, "clientes", c._fsId, "ubicaciones"));
    const valid = snap.docs
      .map(d => d.data())
      .find(u => Number(u.lat) && Math.abs(Number(u.lat)) > 0.001 && Number(u.lng) && Math.abs(Number(u.lng)) > 0.001);
    if (valid) return { ...c, lat: Number(valid.lat), lng: Number(valid.lng), _ubicTipo: valid.tipo };
  } catch {}
  return c;
}

// ── Constantes de días (bitmask, igual que APK) ───────────────
const DIAS_BITS  = [1,2,4,8,16,32,64];
const DIAS_NAMES = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
function diasTexto(mask) {
  if (!mask) return "Sin día asignado";
  return DIAS_BITS.map((b,i) => (mask & b) ? DIAS_NAMES[i] : null)
    .filter(Boolean).join(" · ");
}

// ── Paleta de colores por ingeniero ──────────────────────────
const ING_COLORS = [
  "#2563EB","#16A34A","#DC2626","#7C3AED","#D97706",
  "#0E7490","#BE185D","#EA580C","#0284C7","#15803D",
  "#9333EA","#B45309","#0891B2","#E11D48","#7C3AED"
];
const _ingColorMap = {};
let _ingColorIdx = 0;
function colorDeIngeniero(alias) {
  if (!alias) return "#6B7280";
  if (!_ingColorMap[alias]) {
    _ingColorMap[alias] = ING_COLORS[_ingColorIdx % ING_COLORS.length];
    _ingColorIdx++;
  }
  return _ingColorMap[alias];
}

// ── Colores por estadoLegal ───────────────────────────────────
function colorEstado(e) {
  switch(e) {
    case "En juicio":       return "#DC2626";
    case "Promesa de pago": return "#EA580C";
    case "Acuerdo firmado": return "#1A237E";
    case "Irrecuperable":   return "#374151";
    default:                return null; // usa color del ingeniero
  }
}

// ── Estado del módulo ─────────────────────────────────────────
let _unsub     = null;
let _map       = null;
let _clientes  = [];
let _leafletOk = false;
let _ingSeleccionados = new Set(["TODOS"]);
let _filtroEstado = "todos";
let _calorActivo  = false;
let _calorCapa    = "urgencia";
let _heatLayer    = null;
let _clusterGroup = null;
let _allEntries   = [];

export const MapaClientesModule = {
  mount(container) {
    container.innerHTML = _htmlBase();
    _cargarLeaflet().then(() => _iniciar(container));
    return () => this.destroy();
  },
  destroy() {
    _unsub?.();
    _unsub = null;
    if (_map) { _map.remove(); _map = null; }
    _clientes = [];
    _allEntries = [];
    Object.keys(_ingColorMap).forEach(k => delete _ingColorMap[k]);
    _ingColorIdx = 0;
  }
};

// ── HTML base ─────────────────────────────────────────────────
function _htmlBase() {
  return `<div id="mc-root" style="position:relative;width:100%;height:100%;overflow:hidden">
    <div id="mc-map" style="width:100%;height:100%"></div>
    <div id="mc-spinner" style="position:absolute;inset:0;display:flex;flex-direction:column;
      align-items:center;justify-content:center;background:var(--surface);z-index:2000">
      <div style="font-size:36px;margin-bottom:12px">🗺️</div>
      <div style="font-size:13px;color:var(--text-sec)">Cargando mapa de clientes…</div>
    </div>
  </div>`;
}

// ── Cargar Leaflet dinámicamente ──────────────────────────────
async function _cargarLeaflet() {
  if (_leafletOk) return;
  const id = "mc-leaflet-styles";
  if (!document.getElementById(id)) {
    const links = [
      "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css",
      "https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/MarkerCluster.css",
      "https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css"
    ];
    links.forEach((href, i) => {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = href;
      if (i === 0) l.id = id;
      document.head.appendChild(l);
    });
  }
  const scripts = [
    ["mc-leaflet-js",  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"],
    ["mc-cluster-js",  "https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"],
    ["mc-heat-js",     "https://cdn.jsdelivr.net/npm/leaflet.heat@0.2.0/dist/leaflet-heat.js"]
  ];
  for (const [sid, src] of scripts) {
    if (!document.getElementById(sid)) {
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.id = sid; s.src = src;
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
  }
  _leafletOk = true;
}

// ── Inicializar mapa y datos ──────────────────────────────────
async function _iniciar(container) {
  const mapDiv = container.querySelector("#mc-map");
  if (!mapDiv) return;

  _map = L.map(mapDiv, { zoomControl: true }).setView([20.5, -100.0], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 19
  }).addTo(_map);

  _clusterGroup = L.markerClusterGroup({ maxClusterRadius: 50 });
  _map.addLayer(_clusterGroup);

  _inyectarCSS();
  await _cargarClientes(container);

  const spinner = container.querySelector("#mc-spinner");
  if (spinner) spinner.remove();
}

// ── Cargar clientes desde Firestore ──────────────────────────
async function _cargarClientes(container) {
  _unsub?.();
  try {
    const snap = await getDocs(query(collection(db, "clientes"), orderBy("nombre")));
    const base = snap.docs.map(d => ({ _fsId: d.id, ...d.data() }));

    // Enriquecer con coords de subcollección para los que no tienen lat/lng en root
    const enriquecidos = await Promise.all(base.map(_resolverCoords));

    _clientes = enriquecidos.filter(c => {
      const lat = Number(c.lat), lng = Number(c.lng);
      return lat && lng && Math.abs(lat) > 0.001 && Math.abs(lng) > 0.001;
    });
  } catch(err) {
    console.error("[MapaClientes]", err);
  }
  _construirUI(container);
  _renderMarcadores();
}

// ── Construir panel de controles ──────────────────────────────
function _construirUI(container) {
  // Evitar reconstruir si ya existe
  if (container.querySelector("#mc-panel")) return;

  // Ingenieros únicos
  const ingenieros = [...new Set(_clientes.map(c => c.ingeniero).filter(Boolean))].sort();

  // Panel flotante superior
  const panel = document.createElement("div");
  panel.id = "mc-panel";
  panel.innerHTML = `
    <div id="mc-panel-hdr">
      <span style="font-size:9px;font-weight:800;letter-spacing:.08em;color:#9CA3AF;text-transform:uppercase">Clientes en mapa</span>
      <span id="mc-contador" style="font-size:11px;font-weight:700;color:#E5E7EB">…</span>
      <span id="mc-min-btn" title="Minimizar">&#8722;</span>
    </div>
    <div id="mc-panel-body">
      <div class="mc-section-title">👷 Ingenieros</div>
      <div id="mc-ing-chips" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px">
        <div class="mc-chip mc-chip-ing mc-chip-todos activo" data-ing="TODOS">Todos</div>
        ${ingenieros.map(a => {
          const c = colorDeIngeniero(a);
          return `<div class="mc-chip mc-chip-ing" data-ing="${a}"
            style="border-color:${c};color:${c}">${a}</div>`;
        }).join("")}
      </div>

      <div class="mc-section-title" style="margin-top:8px">📋 Estado legal</div>
      <div id="mc-estado-chips" style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px">
        ${[["todos","Todos","#9CA3AF"],["En gestión","En gestión","#16A34A"],
           ["Promesa de pago","Promesa","#EA580C"],["En juicio","En juicio","#DC2626"],
           ["Acuerdo firmado","Acuerdo","#1A237E"],["Irrecuperable","Irrec.","#374151"]]
          .map(([v,l,c]) => `<div class="mc-chip mc-chip-estado ${v==="todos"?"activo":""}"
            data-estado="${v}" style="border-color:${c};color:${c}">${l}</div>`).join("")}
      </div>

      <div class="mc-section-title" style="margin-top:8px">🔥 Mapa de calor</div>
      <div style="display:flex;gap:5px;flex-wrap:wrap">
        <div class="mc-chip mc-chip-calor ${_calorActivo?"activo":""}" id="mc-btn-calor"
          style="border-color:#BE185D;color:#BE185D">
          &#9632; Calor
        </div>
        ${_calorActivo ? `
          <div id="mc-heat-chips" style="display:flex;gap:5px;flex-wrap:wrap">
            ${[["urgencia","Urgencia visita","#B71C1C"],["morosidad","Morosidad","#4A148C"],
               ["cobranza","Cobranza","#1B5E20"],["saldo","Saldo pendiente","#E65100"]]
              .map(([v,l,c]) => `<div class="mc-chip mc-chip-heat ${v===_calorCapa?"activo":""}"
                data-heat="${v}" style="border-color:${c};color:${c}">${l}</div>`).join("")}
          </div>` : ""}
      </div>
    </div>`;
  container.querySelector("#mc-root").appendChild(panel);

  // Buscador
  const buscador = document.createElement("div");
  buscador.id = "mc-buscador";
  buscador.innerHTML = `
    <span style="font-size:14px">🔍</span>
    <input id="mc-search-input" type="search" placeholder="Buscar cliente, zona…"
      autocomplete="off" autocorrect="off" spellcheck="false"/>
    <div id="mc-search-results"></div>`;
  container.querySelector("#mc-root").appendChild(buscador);

  // Leyenda
  const leyenda = document.createElement("div");
  leyenda.id = "mc-leyenda";
  leyenda.innerHTML = `<div id="mc-leyenda-items"></div>`;
  container.querySelector("#mc-root").appendChild(leyenda);

  _bindPanelEvents(container);
  _actualizarLeyenda();
}

// ── Eventos del panel ─────────────────────────────────────────
function _bindPanelEvents(container) {
  // Minimizar panel
  container.querySelector("#mc-min-btn")?.addEventListener("click", () => {
    const body = container.querySelector("#mc-panel-body");
    const btn  = container.querySelector("#mc-min-btn");
    const min  = body.classList.toggle("hidden");
    btn.innerHTML = min ? "&#43;" : "&#8722;";
  });

  // Chips de ingeniero
  container.querySelector("#mc-ing-chips")?.addEventListener("click", e => {
    const chip = e.target.closest(".mc-chip-ing");
    if (!chip) return;
    const ing = chip.dataset.ing;
    if (ing === "TODOS") {
      _ingSeleccionados = new Set(["TODOS"]);
      container.querySelectorAll(".mc-chip-ing").forEach(c => c.classList.remove("activo"));
      chip.classList.add("activo");
    } else {
      container.querySelector(".mc-chip-ing[data-ing='TODOS']")?.classList.remove("activo");
      _ingSeleccionados.delete("TODOS");
      chip.classList.toggle("activo");
      if (chip.classList.contains("activo")) {
        _ingSeleccionados.add(ing);
      } else {
        _ingSeleccionados.delete(ing);
        if (_ingSeleccionados.size === 0) {
          _ingSeleccionados = new Set(["TODOS"]);
          container.querySelector(".mc-chip-ing[data-ing='TODOS']")?.classList.add("activo");
        }
      }
    }
    _renderMarcadores();
    _actualizarLeyenda();
  });

  // Chips de estado
  container.querySelector("#mc-estado-chips")?.addEventListener("click", e => {
    const chip = e.target.closest(".mc-chip-estado");
    if (!chip) return;
    container.querySelectorAll(".mc-chip-estado").forEach(c => c.classList.remove("activo"));
    chip.classList.add("activo");
    _filtroEstado = chip.dataset.estado;
    _renderMarcadores();
  });

  // Toggle calor
  container.querySelector("#mc-btn-calor")?.addEventListener("click", e => {
    _calorActivo = !_calorActivo;
    e.currentTarget.classList.toggle("activo", _calorActivo);
    if (_calorActivo) {
      _mostrarCalor(_calorCapa);
      _clusterGroup.remove();
    } else {
      if (_heatLayer) { _map.removeLayer(_heatLayer); _heatLayer = null; }
      _clusterGroup.addTo(_map);
      container.querySelector("#mc-heat-chips")?.remove();
    }
    _actualizarLeyenda();
  });

  // Chips de heat
  container.addEventListener("click", e => {
    const chip = e.target.closest(".mc-chip-heat");
    if (!chip) return;
    container.querySelectorAll(".mc-chip-heat").forEach(c => c.classList.remove("activo"));
    chip.classList.add("activo");
    _calorCapa = chip.dataset.heat;
    _mostrarCalor(_calorCapa);
    _actualizarLeyenda();
  });

  // Buscador
  let _timer = null;
  container.querySelector("#mc-search-input")?.addEventListener("input", e => {
    clearTimeout(_timer);
    const q = e.target.value.trim();
    const res = container.querySelector("#mc-search-results");
    if (!res) return;
    if (q.length < 2) { res.innerHTML = ""; res.style.display = "none"; return; }
    _timer = setTimeout(() => {
      const matches = _allEntries.filter(en => {
        const c = en.data;
        return [c.nombre, c.zona, c.municipio, c.ingeniero].some(
          f => f && f.toLowerCase().includes(q.toLowerCase())
        );
      }).slice(0, 8);
      if (!matches.length) { res.innerHTML = `<div class="mc-sr-item" style="color:#9CA3AF">Sin resultados</div>`; }
      else res.innerHTML = matches.map(en => {
        const c = en.data;
        const sub = [c.zona, c.municipio, c.ingeniero].filter(Boolean).join(" · ");
        return `<div class="mc-sr-item" data-idx="${en.idx}">${_hl(c.nombre||"",q)}
          ${sub ? `<div class="mc-sr-sub">${_hl(sub,q)}</div>` : ""}</div>`;
      }).join("");
      res.style.display = "flex";
      res.querySelectorAll(".mc-sr-item[data-idx]").forEach(item => {
        item.addEventListener("click", () => {
          const en = _allEntries[+item.dataset.idx];
          if (!en) return;
          _map.setView([en.data.lat, en.data.lng], 16);
          _clusterGroup.zoomToShowLayer(en.marker, () => en.marker.openPopup());
          res.style.display = "none";
          container.querySelector("#mc-search-input").value = "";
        });
      });
    }, 300);
  });
}

// ── Render de marcadores ──────────────────────────────────────
function _renderMarcadores() {
  _clusterGroup.clearLayers();
  _allEntries = [];
  const ahora = Date.now();
  const hoyInicio = new Date(); hoyInicio.setHours(0,0,0,0);

  const visible = _clientes.filter(c => {
    if (!_ingSeleccionados.has("TODOS") && !_ingSeleccionados.has(c.ingeniero)) return false;
    if (_filtroEstado !== "todos" && c.estadoLegal !== _filtroEstado) return false;
    return true;
  });

  visible.forEach((c, idx) => {
    const lat = Number(c.lat), lng = Number(c.lng);
    const ingColor = colorDeIngeniero(c.ingeniero);
    const estColor = colorEstado(c.estadoLegal);
    const color    = estColor || ingColor;

    const fuv  = c.fechaUltimaVisita || 0;
    const visitadoHoy = fuv >= hoyInicio.getTime();
    const dias = fuv > 0 ? Math.floor((ahora - fuv) / 86400000) : -1;

    const icon = L.divIcon({
      className: "",
      html: `<div style="
        width:14px;height:14px;border-radius:50%;background:${color};
        border:2.5px solid rgba(255,255,255,0.8);
        ${visitadoHoy ? `box-shadow:0 0 0 3px ${color}66;` : ""}
        transition:transform .15s">
      </div>`,
      iconSize: [14,14], iconAnchor: [7,7], popupAnchor: [0,-20]
    });

    const marker = L.marker([lat, lng], { icon });
    marker.bindPopup(_popupHtml(c, color, dias, visitadoHoy), { maxWidth: 260 });

    // Tooltip hover
    const saldoFmt = (c.saldo ?? 0) > 0
      ? `$${Number(c.saldo).toLocaleString("es-MX",{minimumFractionDigits:2})}`
      : "Sin adeudo";
    marker.bindTooltip(`
      <div style="font-size:12px;font-weight:700;color:#F9FAFB;margin-bottom:2px">${c.nombre||"—"}</div>
      <div style="font-size:10px;color:#9CA3AF;margin-bottom:1px">${c.ingeniero||"—"}</div>
      <div style="font-size:10px;font-weight:600;color:${(c.saldo??0)>0?"#FCA5A5":"#86EFAC"}">${saldoFmt}</div>
      <div style="font-size:10px;color:#6B7280;margin-top:1px">${diasTexto(c.diasVisita)}</div>
    `, { sticky: true, offset: [10,0] });

    const entry = { marker, data: c, idx };
    _allEntries.push(entry);
    _clusterGroup.addLayer(marker);
  });

  // Actualizar contador
  const ctr = document.querySelector("#mc-contador");
  if (ctr) ctr.textContent = `${visible.length} cliente${visible.length !== 1 ? "s" : ""}`;

  if (visible.length > 0 && _filtroEstado !== "todos") {
    try { _map.fitBounds(_clusterGroup.getBounds(), { padding: [50,50], maxZoom:13 }); } catch(_){}
  }
}

// ── Popup HTML ────────────────────────────────────────────────
function _popupHtml(c, color, dias, visitadoHoy) {
  const fmt = v => v ? `$${Number(v).toLocaleString("es-MX",{minimumFractionDigits:2})}` : "—";
  const diasStr = dias < 0 ? "Sin visitas" : dias === 0 ? "✅ Visitado hoy" : `${dias} días sin visitar`;
  const diasColor = dias < 0 ? "#9CA3AF" : dias === 0 ? "#16A34A" : dias > 14 ? "#DC2626" : "#D97706";

  return `<div style="min-width:220px;font-family:system-ui,sans-serif;background:var(--surface,#1F2937);border-radius:12px;overflow:hidden">
    <div style="background:${color};padding:12px 16px 10px">
      <div style="font-size:13px;font-weight:800;color:#fff;margin-bottom:2px">${_esc(c.nombre||"—")}</div>
      <div style="font-size:9px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.07em">${_esc(c.estadoLegal||"Sin estado")}</div>
    </div>
    <div style="padding:12px 16px;background:rgba(17,24,39,0.95)">
      ${c.ingeniero ? `<div style="font-size:11px;color:#9CA3AF;margin-bottom:6px">👷 <span style="color:#E5E7EB">${_esc(c.ingeniero)}</span></div>` : ""}
      ${(c.zona||c.municipio) ? `<div style="font-size:11px;color:#9CA3AF;margin-bottom:6px">📍 <span style="color:#D1D5DB">${_esc([c.zona,c.municipio].filter(Boolean).join(" · "))}</span></div>` : ""}
      <div style="font-size:11px;font-weight:700;color:${diasColor};background:${diasColor}22;padding:3px 10px;border-radius:9px;display:inline-block;margin-bottom:8px">${diasStr}</div>
      ${c.diasVisita ? `<div style="font-size:10px;color:#6B7280;margin-bottom:6px">📅 ${diasTexto(c.diasVisita)}</div>` : ""}
      <div style="font-size:12px;margin-bottom:4px">
        <span style="color:#6B7280;font-size:10px">Adeudo </span>
        <span style="font-weight:800;color:${(c.saldo??0)>0?"#FCA5A5":"#86EFAC"}">${fmt(c.saldo)}</span>
      </div>
      <div style="font-size:9px;color:#374151;font-family:monospace;margin-top:6px">${_esc(c._fsId||"")}</div>
    </div>
  </div>`;
}

// ── Mapa de calor ─────────────────────────────────────────────
const _heatCfg = {
  urgencia:  { grad:{0.05:"#FFECB3",0.4:"#FF6F00",1.0:"#B71C1C"}, r:40, b:25 },
  morosidad: { grad:{0.05:"#E8EAF6",0.4:"#7986CB",1.0:"#4A148C"}, r:40, b:25 },
  cobranza:  { grad:{0.05:"#C8E6C9",0.4:"#66BB6A",1.0:"#1B5E20"}, r:40, b:25 },
  saldo:     { grad:{0.05:"#FEF3C7",0.4:"#F59E0B",1.0:"#EA580C"}, r:40, b:25 }
};

function _heatPeso(c, capa) {
  const ahora = Date.now();
  switch (capa) {
    case "urgencia": {
      const fuv = c.fechaUltimaVisita || 0;
      const dias = fuv > 0 ? (ahora - fuv) / 86400000 : 30;
      return Math.min(dias, 30) / 30;
    }
    case "morosidad":
      return c.estadoLegal === "Irrecuperable" ? 1.0
           : c.estadoLegal === "En juicio" ? 0.8
           : c.estadoLegal === "Promesa de pago" ? 0.4 : 0.1;
    case "cobranza": {
      const hoyInicio = new Date(); hoyInicio.setHours(0,0,0,0);
      return (c.fechaUltimaVisita||0) >= hoyInicio.getTime() ? 0.9 : 0.05;
    }
    case "saldo": {
      const s = Number(c.saldo) || 0;
      return Math.min(s / 50000, 1.0);
    }
    default: return 0.1;
  }
}

function _mostrarCalor(capa) {
  if (_heatLayer) { _map.removeLayer(_heatLayer); _heatLayer = null; }
  const points = _clientes
    .filter(c => Number(c.lat) && Number(c.lng))
    .map(c => [Number(c.lat), Number(c.lng), _heatPeso(c, capa)]);
  const cfg = _heatCfg[capa];
  _heatLayer = L.heatLayer(points, {
    radius: cfg.r, blur: cfg.b, maxZoom: 17, gradient: cfg.grad
  }).addTo(_map);
}

// ── Leyenda ───────────────────────────────────────────────────
function _actualizarLeyenda() {
  const el = document.querySelector("#mc-leyenda-items");
  if (!el) return;

  if (_calorActivo) {
    const legTextos = {
      urgencia:  ["Sin urgencia","Alta urgencia"],
      morosidad: ["Bajo riesgo","Alta morosidad"],
      cobranza:  ["Sin cobros","Muy activa"],
      saldo:     ["Sin saldo","Saldo alto"]
    };
    const gradColors = {
      urgencia:  ["#FFECB3","#FF6F00","#B71C1C"],
      morosidad: ["#E8EAF6","#7986CB","#4A148C"],
      cobranza:  ["#C8E6C9","#66BB6A","#1B5E20"],
      saldo:     ["#FEF3C7","#F59E0B","#EA580C"]
    };
    const [min, max] = legTextos[_calorCapa] || ["Min","Max"];
    const colors = gradColors[_calorCapa] || [];
    el.innerHTML = `<div style="font-size:10px;font-weight:700;color:#9CA3AF;
        text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">
        🔥 Calor: ${_calorCapa}
      </div>
      <div style="height:8px;width:100px;border-radius:4px;margin-bottom:4px;
        background:linear-gradient(to right,${colors.join(",")})"></div>
      <div style="display:flex;justify-content:space-between;font-size:9px;
        color:#9CA3AF;width:100px">${min}<span>${max}</span></div>`;
    return;
  }

  if (_ingSeleccionados.has("TODOS")) {
    const ings = [...new Set(_clientes.map(c => c.ingeniero).filter(Boolean))].sort();
    el.innerHTML = `<div style="font-size:10px;font-weight:700;color:#9CA3AF;
        text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Ingenieros</div>` +
      ings.map(a => `<div style="display:flex;align-items:center;gap:5px;font-size:11px;
          color:var(--text-primary);margin-bottom:3px">
          <span style="width:10px;height:10px;border-radius:50%;background:${colorDeIngeniero(a)};flex-shrink:0"></span>
          ${_esc(a)}
        </div>`).join("");
  } else {
    el.innerHTML = [..._ingSeleccionados].map(a => `<div style="display:flex;align-items:center;
        gap:5px;font-size:11px;color:var(--text-primary);margin-bottom:3px">
        <span style="width:10px;height:10px;border-radius:50%;background:${colorDeIngeniero(a)};flex-shrink:0"></span>
        ${_esc(a)}
      </div>`).join("");
  }
}

// ── CSS del módulo ────────────────────────────────────────────
function _inyectarCSS() {
  if (document.getElementById("mc-styles")) return;
  const s = document.createElement("style");
  s.id = "mc-styles";
  s.textContent = `
    #mc-panel {
      position:absolute;top:12px;left:12px;z-index:1000;
      background:rgba(17,24,39,0.92);backdrop-filter:blur(8px);
      border:1px solid rgba(255,255,255,.12);border-radius:14px;
      padding:10px 12px;min-width:200px;max-width:260px;
      box-shadow:0 8px 32px rgba(0,0,0,.4);
    }
    #mc-panel-hdr {
      display:flex;align-items:center;justify-content:space-between;gap:6px;
      margin-bottom:8px;
    }
    #mc-min-btn {
      font-size:16px;color:#9CA3AF;cursor:pointer;user-select:none;line-height:1;
      flex-shrink:0;padding:0 2px;
    }
    #mc-panel-body.hidden { display:none; }
    .mc-section-title {
      font-size:9px;font-weight:800;letter-spacing:.06em;
      color:#6B7280;text-transform:uppercase;margin-bottom:5px;
    }
    .mc-chip {
      padding:4px 10px;border-radius:20px;font-size:10px;font-weight:700;
      border:1.5px solid;background:transparent;cursor:pointer;
      transition:all .15s;user-select:none;white-space:nowrap;
    }
    .mc-chip.activo { color:#fff !important; }
    .mc-chip-ing.activo    { background:currentColor; }
    .mc-chip-ing.mc-chip-todos { border-color:rgba(255,255,255,0.35); color:rgba(255,255,255,0.7); }
    .mc-chip-ing.mc-chip-todos.activo { background:rgba(255,255,255,0.18) !important; border-color:rgba(255,255,255,0.6) !important; color:#fff !important; }
    .mc-chip-estado.activo { background:currentColor; }
    .mc-chip-calor.activo  { background:#BE185D; border-color:#BE185D; color:#fff !important; }
    .mc-chip-heat.activo   { color:#fff !important; background:currentColor; }

    #mc-buscador {
      position:absolute;top:12px;right:12px;z-index:1000;
      background:rgba(17,24,39,0.92);backdrop-filter:blur(8px);
      border:1px solid rgba(255,255,255,.12);border-radius:22px;
      padding:7px 12px;display:flex;flex-direction:column;gap:0;
      box-shadow:0 4px 16px rgba(0,0,0,.3);min-width:180px;
    }
    #mc-buscador > span { color:#9CA3AF; }
    #mc-search-input {
      border:none;outline:none;background:transparent;
      color:#E5E7EB;font-size:13px;width:180px;
    }
    #mc-search-input::placeholder { color:#6B7280; }
    #mc-search-results {
      display:none;flex-direction:column;border-top:1px solid rgba(255,255,255,.08);
      margin-top:6px;padding-top:4px;max-height:200px;overflow-y:auto;
    }
    .mc-sr-item {
      padding:6px 4px;font-size:12px;color:#E5E7EB;cursor:pointer;
      border-bottom:0.5px solid rgba(255,255,255,.06);line-height:1.35;
    }
    .mc-sr-item:hover { background:rgba(255,255,255,.06); }
    .mc-sr-sub { font-size:10px;color:#9CA3AF;margin-top:1px; }
    .mc-hl { color:#4ADE80;font-weight:700; }

    #mc-leyenda {
      position:absolute;bottom:28px;left:12px;z-index:1000;
      background:rgba(17,24,39,0.92);backdrop-filter:blur(8px);
      border:1px solid rgba(255,255,255,.12);border-radius:12px;
      padding:10px 14px;font-family:system-ui,sans-serif;
      box-shadow:0 4px 20px rgba(0,0,0,.4);max-width:200px;min-width:140px;
    }
    #mc-leyenda-items > div { color:#E5E7EB !important; }
    #mc-contador { margin-left:auto; font-variant-numeric:tabular-nums; }

    /* Leaflet popup dark override */
    .leaflet-popup-content-wrapper {
      background:transparent !important;border:none !important;
      border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.5);padding:0 !important;overflow:hidden;
    }
    .leaflet-popup-content { margin:0 !important; width:auto !important; }
    .leaflet-popup-tip-container { display:none; }
    .leaflet-popup-close-button { color:rgba(255,255,255,.6) !important;top:10px !important;right:10px !important;font-size:16px !important;z-index:10; }
    .leaflet-tooltip {
      background:rgba(17,24,39,0.95) !important;border:1px solid rgba(255,255,255,.1) !important;
      border-radius:8px !important;box-shadow:0 4px 12px rgba(0,0,0,.3) !important;
      padding:8px 10px !important;color:#fff !important;
    }
    .leaflet-tooltip-top::before { border-top-color:rgba(17,24,39,0.95) !important; }
  `;
  document.head.appendChild(s);
}

// ── Helpers ───────────────────────────────────────────────────
function _esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function _hl(text, q) {
  if (!q) return _esc(text);
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return _esc(text);
  return _esc(text.slice(0,idx))
    + `<span class="mc-hl">${_esc(text.slice(idx, idx+q.length))}</span>`
    + _esc(text.slice(idx+q.length));
}
