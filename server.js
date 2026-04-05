const http = require("http");
const { WebSocketServer } = require("ws");
const { randomBytes } = require("crypto");

const PORT = process.env.PORT || 3000;

// Base de datos en memoria: token -> { nombre, montoMinimo, clients: Set }
const streamers = new Map();

// --- Utilidades ---
function generarToken() {
  return randomBytes(12).toString("hex");
}

function htmlResponse(res, html) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function jsonResponse(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(JSON.stringify(data));
}

function leerBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("JSON inválido")); }
    });
  });
}

function estilosBase() {
  return `
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:system-ui,sans-serif;background:#f7f7f8;color:#111;min-height:100vh}
      .wrap{max-width:680px;margin:0 auto;padding:32px 20px}
      h1{font-size:22px;font-weight:600;color:#8B2FC9;margin-bottom:4px}
      h2{font-size:16px;font-weight:600;margin:28px 0 12px}
      p.sub{font-size:13px;color:#666;margin-bottom:24px}
      .card{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:20px;margin-bottom:16px}
      label{display:block;font-size:13px;font-weight:500;color:#444;margin-bottom:6px}
      input[type=text],input[type=number]{width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;outline:none}
      input:focus{border-color:#8B2FC9;box-shadow:0 0 0 3px rgba(139,47,201,0.1)}
      .row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
      .row input{flex:1;min-width:140px}
      button{background:#8B2FC9;color:#fff;border:none;padding:9px 18px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;white-space:nowrap}
      button:hover{background:#7a28b5}
      button.sec{background:#fff;color:#8B2FC9;border:1px solid #8B2FC9}
      button.sec:hover{background:#f5eeff}
      .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:500}
      .on{background:#d4edda;color:#155724}
      .off{background:#f8d7da;color:#721c24}
      .token{font-family:monospace;background:#f0f0f0;padding:3px 8px;border-radius:6px;font-size:12px;word-break:break-all;display:block;margin-top:6px;line-height:1.7}
      .msg{font-size:13px;color:#2e7d32;margin-top:10px;min-height:20px}
      .err{color:#c0392b}
      table{width:100%;border-collapse:collapse}
      td,th{padding:10px 8px;text-align:left;font-size:13px;border-bottom:1px solid #f0f0f0}
      th{font-weight:600;color:#555;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
      tr:last-child td{border-bottom:none}
      .empty{color:#999;text-align:center;padding:20px}
      a{color:#8B2FC9;text-decoration:none}
      a:hover{text-decoration:underline}
    </style>`;
}

// ── Panel admin ────────────────────────────────────────────────────────────────
function panelAdmin(adminKey) {
  const lista = [...streamers.entries()].map(([token, s]) => ({
    nombre: s.nombre, token, clientes: s.clients.size, minimo: s.montoMinimo
  }));

  return `<!DOCTYPE html><html lang="es"><head>${estilosBase()}
  <title>Yape OBS — Admin</title></head><body>
  <div class="wrap">
    <h1>🎬 Yape → OBS</h1>
    <p class="sub">Panel de administración · Admin key: <code>${adminKey}</code></p>

    <div class="card">
      <h2 style="margin-top:0">Agregar streamer</h2>
      <div class="row">
        <div style="flex:1;min-width:140px">
          <label>Nombre</label>
          <input id="nombre" type="text" placeholder="Ej: GamerPeru" />
        </div>
        <div style="width:160px">
          <label>Monto mínimo (S/)</label>
          <input id="minimo" type="number" min="0" step="0.5" value="1" />
        </div>
        <button onclick="crear()">Crear</button>
      </div>
      <div class="msg" id="msg"></div>
    </div>

    <h2>Streamers (${lista.length})</h2>
    <div class="card" style="padding:0;overflow:hidden">
      <table>
        <tr><th>Nombre</th><th>Mínimo</th><th>OBS</th><th>Panel</th><th>Probar</th></tr>
        ${lista.length === 0 ? `<tr><td colspan="5" class="empty">Sin streamers aún</td></tr>` : ""}
        ${lista.map(s => `
        <tr>
          <td><b>${s.nombre}</b></td>
          <td>S/ ${parseFloat(s.minimo).toFixed(2)}</td>
          <td><span class="badge ${s.clientes > 0 ? "on" : "off"}">${s.clientes > 0 ? "● conectado" : "desconectado"}</span></td>
          <td><a href="/panel/${s.token}">ver panel ↗</a></td>
          <td><button class="sec" onclick="probar('${s.token}',${s.minimo})">Probar</button></td>
        </tr>`).join("")}
      </table>
    </div>
  </div>

  <script>
  const ADMIN = "${adminKey}";
  async function crear() {
    const nombre = document.getElementById("nombre").value.trim();
    const minimo = parseFloat(document.getElementById("minimo").value) || 0;
    if (!nombre) return alert("Escribe un nombre");
    const r = await fetch("/admin/crear", {
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":ADMIN},
      body: JSON.stringify({ nombre, montoMinimo: minimo })
    });
    const d = await r.json();
    if (d.error) {
      document.getElementById("msg").className="msg err";
      document.getElementById("msg").textContent = d.error;
      return;
    }
    document.getElementById("msg").textContent = "✅ Creado. Token: " + d.token;
    setTimeout(() => location.reload(), 2000);
  }
  async function probar(token, minimo) {
    const monto = (parseFloat(minimo) + 5).toFixed(2);
    await fetch("/yape/"+token, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ nombre:"TestUser", monto, descripcion:"¡Prueba de alerta!" })
    });
  }
  </script></body></html>`;
}

// ── Panel del streamer ─────────────────────────────────────────────────────────
function panelStreamer(token, streamer) {
  return `<!DOCTYPE html><html lang="es"><head>${estilosBase()}
  <title>Mi panel — ${streamer.nombre}</title></head><body>
  <div class="wrap">
    <h1>💜 Hola, ${streamer.nombre}</h1>
    <p class="sub">Panel de configuración de alertas Yape → OBS</p>

    <div class="card">
      <h2 style="margin-top:0">Monto mínimo para mostrar alerta</h2>
      <p style="font-size:13px;color:#666;margin-bottom:16px">
        Solo se mostrará la alerta si el Yape recibido es igual o mayor a este monto.
      </p>
      <div class="row">
        <div style="width:180px">
          <label>Monto mínimo (S/)</label>
          <input id="minimo" type="number" min="0" step="0.5" value="${streamer.montoMinimo}" />
        </div>
        <button onclick="guardar()">Guardar</button>
      </div>
      <div class="msg" id="msg"></div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">Conexión con OBS</h2>
      <p style="font-size:13px;color:#666;margin-bottom:8px">Estado: <span class="badge ${streamer.clients.size > 0 ? "on" : "off"}">${streamer.clients.size > 0 ? "● OBS conectado" : "OBS desconectado"}</span></p>
      <p style="font-size:13px;color:#666;margin-top:12px">URL para el Browser Source de OBS:</p>
      <code class="token" id="obsurl">cargando...</code>
    </div>

    <div class="card">
      <h2 style="margin-top:0">Probar alerta</h2>
      <div class="row">
        <div>
          <label>Nombre</label>
          <input id="nombre-prueba" type="text" value="TestUser" style="width:140px"/>
        </div>
        <div>
          <label>Monto (S/)</label>
          <input id="monto-prueba" type="number" min="0" step="1" value="${parseFloat(streamer.montoMinimo) + 5}" style="width:110px"/>
        </div>
        <button onclick="probar()">Enviar prueba</button>
      </div>
      <div class="msg" id="msg2"></div>
    </div>
  </div>

  <script>
  const TOKEN = "${token}";
  document.getElementById("obsurl").textContent =
    window.location.origin + "/alerta-obs.html?token=" + TOKEN;

  async function guardar() {
    const minimo = parseFloat(document.getElementById("minimo").value);
    if (isNaN(minimo) || minimo < 0) return alert("Monto inválido");
    const r = await fetch("/panel/${token}/config", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ montoMinimo: minimo })
    });
    const d = await r.json();
    const el = document.getElementById("msg");
    if (d.ok) { el.className="msg"; el.textContent = "✅ Guardado. Mínimo: S/ " + minimo.toFixed(2); }
    else { el.className="msg err"; el.textContent = "Error: " + d.error; }
  }

  async function probar() {
    const monto = document.getElementById("monto-prueba").value;
    const nombre = document.getElementById("nombre-prueba").value || "TestUser";
    const r = await fetch("/yape/"+TOKEN, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ nombre, monto, descripcion:"¡Prueba desde el panel!" })
    });
    const d = await r.json();
    const el = document.getElementById("msg2");
    if (d.filtrado) {
      el.className="msg err";
      el.textContent = "⚠ Filtrado: S/ " + parseFloat(monto).toFixed(2) + " es menor al mínimo de S/ " + parseFloat(d.minimo).toFixed(2);
    } else {
      el.className="msg";
      el.textContent = d.ok ? "✅ Alerta enviada a OBS" : "Error al enviar";
    }
  }
  </script></body></html>`;
}

// --- Servidor HTTP ---
const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  // Panel admin
  if (req.method === "GET" && url.pathname === "/") {
    const adminKey = process.env.ADMIN_KEY || "admin123";
    return htmlResponse(res, panelAdmin(adminKey));
  }

  // Crear streamer
  if (req.method === "POST" && url.pathname === "/admin/crear") {
    const adminKey = process.env.ADMIN_KEY || "admin123";
    if (req.headers["authorization"] !== adminKey)
      return jsonResponse(res, 403, { error: "No autorizado" });
    try {
      const { nombre, montoMinimo } = await leerBody(req);
      if (!nombre) return jsonResponse(res, 400, { error: "Falta nombre" });
      const token = generarToken();
      streamers.set(token, { nombre, montoMinimo: parseFloat(montoMinimo) || 0, clients: new Set() });
      console.log(`👤 Streamer: ${nombre} mínimo S/${montoMinimo} [${token}]`);
      jsonResponse(res, 200, { ok: true, token, nombre });
    } catch (e) { jsonResponse(res, 400, { error: e.message }); }
    return;
  }

  // Panel del streamer
  const matchPanel = url.pathname.match(/^\/panel\/([a-f0-9]{24})$/);
  if (req.method === "GET" && matchPanel) {
    const streamer = streamers.get(matchPanel[1]);
    if (!streamer) return jsonResponse(res, 404, { error: "Token no existe" });
    return htmlResponse(res, panelStreamer(matchPanel[1], streamer));
  }

  // Guardar config
  const matchConfig = url.pathname.match(/^\/panel\/([a-f0-9]{24})\/config$/);
  if (req.method === "POST" && matchConfig) {
    const streamer = streamers.get(matchConfig[1]);
    if (!streamer) return jsonResponse(res, 404, { error: "Token no existe" });
    try {
      const { montoMinimo } = await leerBody(req);
      streamer.montoMinimo = parseFloat(montoMinimo) || 0;
      console.log(`⚙ Config ${streamer.nombre}: mínimo S/${streamer.montoMinimo}`);
      jsonResponse(res, 200, { ok: true, montoMinimo: streamer.montoMinimo });
    } catch (e) { jsonResponse(res, 400, { error: e.message }); }
    return;
  }

  // Recibir Yape desde MacroDroid
  const matchYape = url.pathname.match(/^\/yape\/([a-f0-9]{24})$/);
  if (req.method === "POST" && matchYape) {
    const token = matchYape[1];
    const streamer = streamers.get(token);
    if (!streamer) return jsonResponse(res, 404, { error: "Token no existe" });
    try {
      const data = await leerBody(req);

      // Parsear notificación de Yape
      // Formato real: "Juan Cha* te envió un pago por S/ 2. El cód. de seguridad es: 737"
      let nombreFinal = data.nombre || "Alguien";
      let montoFinal  = parseFloat(data.monto) || 0;

      const textoCompleto = data.nombre || data.monto || "";
      if (textoCompleto.includes("te envió un pago por S/")) {
        const matchNombre = textoCompleto.match(/^(.+?)\s+te envió/);
        const matchMonto  = textoCompleto.match(/S\/\s*([\d]+(?:[.,]\d+)?)/);
        if (matchNombre) nombreFinal = matchNombre[1].trim();
        if (matchMonto)  montoFinal  = parseFloat(matchMonto[1].replace(",", "."));
      }

      const monto = montoFinal;

      // Filtro de monto mínimo
      if (monto < streamer.montoMinimo) {
        console.log(`⏭ Filtrado ${streamer.nombre}: S/${monto} < mínimo S/${streamer.montoMinimo}`);
        return jsonResponse(res, 200, { ok: true, filtrado: true, minimo: streamer.montoMinimo });
      }

      const mensaje = {
        nombre: nombreFinal,
        monto: monto.toFixed(2),
        descripcion: data.descripcion || "",
        timestamp: Date.now(),
      };
      console.log(`💜 Yape ${streamer.nombre}: S/${mensaje.monto} de ${mensaje.nombre}`);
      const payload = JSON.stringify(mensaje);
      for (const client of streamer.clients) {
        if (client.readyState === 1) client.send(payload);
      }
      jsonResponse(res, 200, { ok: true, filtrado: false, enviado: streamer.clients.size });
    } catch (e) { jsonResponse(res, 400, { error: e.message }); }
    return;
  }

  // Servir alerta-obs.html
  if (req.method === "GET" && url.pathname === "/alerta-obs.html") {
    const fs = require("fs");
    const path = require("path");
    const file = path.join(__dirname, "alerta-obs.html");
    if (fs.existsSync(file)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(file));
    } else {
      jsonResponse(res, 404, { error: "alerta-obs.html no encontrado" });
    }
    return;
  }

  jsonResponse(res, 404, { error: "Ruta no encontrada" });
});

// --- WebSocket ---
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const match = url.pathname.match(/^\/obs\/([a-f0-9]{24})$/);
  if (!match) { ws.close(4001, "Token inválido"); return; }
  const token = match[1];
  const streamer = streamers.get(token);
  if (!streamer) { ws.close(4004, "Token no existe"); return; }
  streamer.clients.add(ws);
  console.log(`🎬 OBS conectado: ${streamer.nombre} (${streamer.clients.size} total)`);
  ws.on("close", () => {
    streamer.clients.delete(ws);
    console.log(`🔌 OBS desconectado: ${streamer.nombre}`);
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Puerto ${PORT}`);
  console.log(`🔑 Admin key: ${process.env.ADMIN_KEY || "admin123"}`);
  console.log(`📋 Panel: http://localhost:${PORT}/\n`);
});
