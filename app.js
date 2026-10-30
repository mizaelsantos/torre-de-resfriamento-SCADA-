// Supervisório — liga a interface ao servidor local (que fala com o Arduino).
import { createTower, DEFAULT_COLORS } from "./tower3d.js";

const $ = (id) => document.getElementById(id);
const ESTADOS = ["Desligado", "Normal", "Máxima"];
const MODOS = ["LOCAL", "REMOTO", "MANUAL"];
const MODO_NOME = { LOCAL: "Local", REMOTO: "Remoto", MANUAL: "Manual" };
const MAX_SAMPLES = 100000;
const T_ALTA = 35, T_ALTA_SAI = 33, T_CRITICA = 60, T_CRITICA_SAI = 57;

const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt1 = (v) => (v == null || Number.isNaN(Number(v)) ? "--,-" : nf1.format(Number(v)));
const hora = (t = Date.now() / 1000) => new Date(t * 1000).toLocaleTimeString("pt-BR");

// ------------------------------------------------------------------ 3D
let tower = null;
try {
  tower = createTower($("scene3d"));
  window.torre3d = tower; // acesso pelo console (F12)
} catch (err) {
  $("scene3d").innerHTML = `<p style="padding:32px">Não foi possível iniciar o 3D (WebGL): ${err.message}.<br>
    Atualize o Google Chrome ou o Microsoft Edge e ative a aceleração de hardware.</p>`;
  console.error(err);
}

// ------------------------------------------------------------------ tema
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  tower?.setTheme(t);
  readChartColors();
}
$("btnTheme").onclick = () => {
  const t = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  try { localStorage.setItem("torre3d.tema", t); } catch { /* sem storage */ }
  applyTheme(t);
};

// ------------------------------------------------------------------ estado
const st = {
  status: { connected: false, port: null, simulated: false },
  last: null,
  samples: [],
  dragging: { temp: false, fan: false },
  lastStateKey: null,
  lastInput: 0,
  uiMode: "LOCAL",
  uiModeAt: 0,
};

async function api(path, body) {
  const opt = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch(path, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

// ------------------------------------------------------------------ registro de eventos
function addLog(text, level = "info", t = Date.now() / 1000) {
  const log = $("log");
  log.querySelector(".empty")?.remove();
  const li = document.createElement("li");
  li.className = level;
  const tm = document.createElement("time");
  tm.textContent = hora(t);
  const sp = document.createElement("span");
  sp.textContent = text;
  li.append(tm, sp);
  log.prepend(li);
  while (log.children.length > 400) log.lastChild.remove();
}
function emptyLog() { $("log").innerHTML = '<li class="empty">Nenhum evento ainda. Conecte o Arduino para começar.</li>'; }
emptyLog();

setInterval(() => ($("clock").textContent = hora()), 500);

// ------------------------------------------------------------------ notificações e alarmes
const ICON = { alarm: "i-alert", warn: "i-alert", ok: "i-check", info: "i-info" };
function toast({ kind = "info", title, msg = "", sticky = false, actions = [] }) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.setAttribute("role", kind === "alarm" ? "alert" : "status");
  el.innerHTML = `<svg><use href="#${ICON[kind]}"/></svg><div><b></b><p></p><div class="acts"></div></div>
    <button class="icon-btn sm x" aria-label="Fechar"><svg><use href="#i-x"/></svg></button>`;
  el.querySelector("b").textContent = title;
  el.querySelector("p").textContent = msg;
  const acts = el.querySelector(".acts");
  if (!actions.length) acts.remove();
  actions.forEach((a) => {
    const b = document.createElement("button");
    b.className = "btn sm " + (a.primary ? "primary" : "ghost");
    b.textContent = a.label;
    b.onclick = a.onClick;
    acts.append(b);
  });
  el.close = () => { el.classList.add("out"); setTimeout(() => el.remove(), 200); };
  el.querySelector(".x").onclick = () => el.close();
  $("toasts").prepend(el);
  while ($("toasts").children.length > 5) $("toasts").lastChild.remove();
  if (!sticky) setTimeout(() => el.isConnected && el.close(), 6000);
  return el;
}

let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.28].forEach((d) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + d);
      g.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + d + 0.2);
      o.connect(g).connect(audioCtx.destination);
      o.start(audioCtx.currentTime + d);
      o.stop(audioCtx.currentTime + d + 0.22);
    });
  } catch { /* sem áudio */ }
}

const alarms = {}; // id -> { title, active, ack, el }
function raiseAlarm(id, title, msg) {
  const a = alarms[id] || (alarms[id] = {});
  if (a.active) return;
  Object.assign(a, { title, active: true, ack: false });
  a.el?.close();
  a.el = toast({ kind: "alarm", title, msg, sticky: true,
    actions: [{ label: "Reconhecer", primary: true, onClick: () => ackAlarm(id) }] });
  a.el.classList.add("unack");
  addLog(`Alarme: ${title}. ${msg}`, "alarm");
  beep();
  renderBell();
}
function ackAlarm(id) {
  const a = alarms[id];
  if (!a || a.ack) return;
  a.ack = true;
  a.el?.classList.remove("unack");
  a.el?.querySelector(".acts")?.remove();
  addLog(`Alarme reconhecido: ${a.title}`, "info");
  if (!a.active) a.el?.close();
  renderBell();
}
function clearAlarm(id, okTitle, okMsg) {
  const a = alarms[id];
  if (!a || !a.active) return;
  a.active = false;
  a.el?.close();
  a.el = null;
  addLog(`${okTitle}. ${okMsg}`, "ok");
  toast({ kind: "ok", title: okTitle, msg: okMsg });
  renderBell();
}
function renderBell() {
  const n = Object.values(alarms).filter((a) => a.active && !a.ack).length;
  const act = Object.values(alarms).filter((a) => a.active).length;
  $("bellCount").hidden = act === 0;
  $("bellCount").textContent = act;
  $("btnBell").classList.toggle("ringing", n > 0);
  $("btnBell").title = act ? `${act} alarme(s) ativo(s)` : "Sem alarmes ativos";
}
$("btnBell").onclick = () => {
  const ids = Object.keys(alarms).filter((k) => alarms[k].active && !alarms[k].ack);
  if (ids.length) ids.forEach(ackAlarm);
  else toast({ kind: "info", title: "Sem alarmes ativos", msg: "Nenhuma condição anormal no momento." });
};

// ------------------------------------------------------------------ portas / conexão
async function scanPorts() {
  const sel = $("portSelect");
  const prev = sel.value;
  try {
    const { ports } = await api("/api/ports");
    sel.innerHTML = "";
    ports.forEach((p) => {
      const o = document.createElement("option");
      o.value = p.device;
      o.textContent = p.label;
      sel.append(o);
    });
    const other = document.createElement("option");
    other.value = "__OUTRA__";
    other.textContent = "Outra porta (digitar)";
    sel.append(other);
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
    $("manualPortRow").hidden = sel.value !== "__OUTRA__";
    const real = ports.filter((p) => p.device !== "SIMULADOR").length;
    if (!st.status.connected) {
      $("linkInfo").textContent = real
        ? `${real} porta(s) encontrada(s). A primeira é a mais provável de ser o Arduino.`
        : "Nenhuma porta USB encontrada. Conecte o Arduino e clique em procurar, ou use o Simulador.";
    }
  } catch {
    $("linkInfo").textContent = "O servidor local não respondeu. Abra o INICIAR.bat de novo.";
  }
}
$("btnScan").onclick = scanPorts;
$("portSelect").onchange = () => {
  $("manualPortRow").hidden = $("portSelect").value !== "__OUTRA__";
  if (!$("manualPortRow").hidden) $("manualPort").focus();
};
const chosenPort = () => ($("portSelect").value === "__OUTRA__" ? $("manualPort").value.trim() : $("portSelect").value);

$("btnConnect").onclick = async () => {
  const btn = $("btnConnect");
  btn.disabled = true;
  try {
    if (st.status.connected) await api("/api/disconnect", {});
    else await api("/api/connect", { port: chosenPort() });
  } catch (e) {
    toast({ kind: "warn", title: "Não foi possível conectar", msg: e.message });
    addLog(`Erro: ${e.message}`, "error");
  } finally {
    setTimeout(() => (btn.disabled = false), 600);
  }
};

function renderStatus() {
  const s = st.status;
  const age = st.last ? Date.now() / 1000 - st.last.t : Infinity;
  const fresh = s.connected && age < 3;
  const pill = $("linkPill");
  pill.className = "pill " + (!s.connected ? "off" : !fresh ? "warn" : s.simulated ? "sim" : "on");
  pill.querySelector("span").textContent = !s.connected ? "Desconectado" : !fresh ? "Sem dados" : s.simulated ? "Simulador" : `Online em ${s.port}`;
  const btn = $("btnConnect");
  btn.textContent = s.connected ? "Desconectar" : "Conectar";
  btn.className = "btn block " + (s.connected ? "danger" : "primary");
  $("portSelect").disabled = s.connected;
  $("manualPort").disabled = s.connected;
  $("noLink").classList.toggle("hide", fresh);
  $("ctlSim").hidden = !(s.connected && s.simulated);
  if (s.connected) {
    $("linkInfo").textContent = fresh
      ? `Recebendo dados de ${s.simulated ? "simulador" : s.port}: ${s.framesOk} leituras${s.framesBad ? `, ${s.framesBad} descartadas` : ""}.`
      : "Porta aberta, aguardando dados. Confira se o firmware desta pasta está gravado no Arduino.";
    $("hwMeta").textContent = s.simulated ? "Simulador" : s.port;
  } else {
    $("hwMeta").textContent = "Desconectado";
  }
  document.querySelectorAll("#modeSeg button, #spTemp, #spFan, [data-step], [data-fan], [data-temp]")
    .forEach((el) => (el.disabled = !s.connected));

  // alarme de comunicação
  if (s.connected && st.last && age > 3) raiseAlarm("com", "Sem dados do Arduino", `Nenhuma leitura há ${Math.round(age)} s. Verifique o cabo USB.`);
  if (fresh) clearAlarm("com", "Comunicação restabelecida", "O Arduino voltou a enviar dados.");
}
setInterval(renderStatus, 1000);

// ------------------------------------------------------------------ modo e comandos
function showPane(mode) {
  st.uiMode = mode;
  document.querySelectorAll(".pane[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== mode));
}
let sendTimer = null, pendingCmd = null;
function sendCommand(mode, value, immediate = false) {
  st.lastInput = Date.now();
  pendingCmd = { mode, value };
  document.querySelectorAll("#modeSeg button").forEach((b) => b.classList.toggle("pending", b.dataset.mode === mode));
  if (sendTimer && !immediate) return;
  const flush = async () => {
    sendTimer = null;
    const cmd = pendingCmd;
    pendingCmd = null;
    if (!cmd) return;
    try {
      const r = await api("/api/command", cmd);
      addLog(`Comando enviado: ${r.sent} (${describeCmd(cmd)})`, "cmd");
    } catch (e) {
      addLog(`Comando não enviado: ${e.message}`, "error");
      toast({ kind: "warn", title: "Comando não enviado", msg: e.message });
    }
  };
  if (immediate) { clearTimeout(sendTimer); flush(); } else sendTimer = setTimeout(flush, 180);
}
function describeCmd(c) {
  if (c.mode === "LOCAL") return "controle pelo potenciômetro";
  if (c.mode === "REMOTO") return `temperatura ${fmt1(c.value)} °C`;
  return `ventoinha ${c.value}%`;
}

document.querySelectorAll("#modeSeg button").forEach((b) => {
  b.onclick = () => {
    const m = b.dataset.mode;
    showPane(m);
    st.uiModeAt = Date.now();
    if (m === "LOCAL") sendCommand("LOCAL", null, true);
    if (m === "REMOTO") sendCommand("REMOTO", Number($("spTemp").value), true);
    if (m === "MANUAL") sendCommand("MANUAL", Number($("spFan").value), true);
  };
});
const spTemp = $("spTemp"), spFan = $("spFan");
spTemp.oninput = () => { $("spTempVal").textContent = fmt1(spTemp.value); sendCommand("REMOTO", Number(spTemp.value)); };
spFan.oninput = () => { $("spFanVal").textContent = spFan.value; sendCommand("MANUAL", Number(spFan.value)); };
for (const [el, key] of [[spTemp, "temp"], [spFan, "fan"]]) {
  el.addEventListener("pointerdown", () => (st.dragging[key] = true));
  window.addEventListener("pointerup", () => (st.dragging[key] = false));
}
document.querySelectorAll("[data-step]").forEach((b) => {
  b.onclick = () => {
    const el = b.dataset.target === "temp" ? spTemp : spFan;
    el.value = Math.min(Number(el.max), Math.max(Number(el.min), Number(el.value) + Number(b.dataset.step)));
    el.oninput();
  };
});
document.querySelectorAll("[data-fan]").forEach((b) => {
  b.onclick = () => { spFan.value = b.dataset.fan; $("spFanVal").textContent = spFan.value; sendCommand("MANUAL", Number(spFan.value), true); };
});
document.querySelectorAll("[data-temp]").forEach((b) => {
  b.onclick = () => { spTemp.value = b.dataset.temp; $("spTempVal").textContent = fmt1(spTemp.value); sendCommand("REMOTO", Number(spTemp.value), true); };
});

$("simPot").oninput = () => {
  $("simAuto").checked = false;
  $("simPotVal").textContent = fmt1($("simPot").value);
  api("/api/simpot", { value: Number($("simPot").value), manual: true }).catch(() => {});
};
$("simAuto").onchange = () => api("/api/simpot", { value: Number($("simPot").value), manual: !$("simAuto").checked }).catch(() => {});

// ------------------------------------------------------------------ telemetria
function lcdText(d) {
  const t = d.temp.toFixed(1).padStart(5, " ");
  const modo = ["LOCAL ", "REMOTO", "MANUAL"][d.modo];
  const pct = String(d.pct).padStart(3, " ");
  const est = ["DESLIG.", "NORMAL ", "MAXIMA "][d.estado];
  return `T:${t}°C ${modo}\nPWM:${pct}% ${est}`;
}

function onTelemetry(d) {
  st.last = d;
  st.samples.push(d);
  if (st.samples.length > MAX_SAMPLES) st.samples.splice(0, st.samples.length - MAX_SAMPLES);
  tower?.update({ temp: d.temp, pct: d.pct, estado: d.estado, online: true });

  // leituras principais
  $("kTemp").textContent = fmt1(d.temp);
  const bar = $("kTempBar");
  bar.style.width = `${Math.min(100, d.temp)}%`;
  bar.className = "tbar-fill" + (d.temp >= T_ALTA ? " hot" : d.temp < 20 ? " cool" : "");
  $("kPct").textContent = d.pct;
  $("kPctBar").style.width = `${d.pct}%`;
  $("kPwm").textContent = d.pwm;
  $("kRpm").textContent = d.rpm.toLocaleString("pt-BR");
  $("kRpmBar").style.width = `${(d.rpm / 3000) * 100}%`;
  $("kDot").className = `sdot s${d.estado}`;
  $("kState").textContent = ESTADOS[d.estado];
  $("kStateSub").textContent = d.modo === 2 ? "Ventoinha definida no manual"
    : d.estado === 0 ? "Liga quando chegar a 20 °C" : d.estado === 1 ? "Desliga abaixo de 18 °C" : "Volta ao normal em 33 °C";
  const modo = MODOS[d.modo];
  $("kMode").textContent = MODO_NOME[modo];
  $("kModeSub").textContent = d.modo === 0 ? "Temperatura pelo potenciômetro" : d.modo === 1 ? "Temperatura pelo supervisório" : "Ventoinha pelo supervisório";
  $("potVal").textContent = fmt1(d.pot);

  $("ledR").classList.toggle("on", d.estado === 0);
  $("ledA").classList.toggle("on", d.estado === 1);
  $("ledG").classList.toggle("on", d.estado === 2);
  $("lcd").textContent = lcdText(d);

  // seletor de modo acompanha o Arduino
  document.querySelectorAll("#modeSeg button").forEach((b) => {
    const on = b.dataset.mode === modo;
    b.classList.toggle("active", on);
    b.setAttribute("aria-checked", on);
    if (on) b.classList.remove("pending");
  });
  if (Date.now() - st.uiModeAt > 2500 && st.uiMode !== modo) showPane(modo);

  const quiet = !pendingCmd && Date.now() - st.lastInput > 1500;
  if (quiet && !st.dragging.temp) { spTemp.value = d.temp; $("spTempVal").textContent = fmt1(d.temp); }
  if (quiet && !st.dragging.fan) { spFan.value = d.pct; $("spFanVal").textContent = d.pct; }
  if (d.sim && $("simAuto").checked) { $("simPot").value = d.pot; $("simPotVal").textContent = fmt1(d.pot); }

  // eventos de mudança
  const key = `${d.estado}|${d.modo}`;
  if (st.lastStateKey !== null && key !== st.lastStateKey) {
    const [pe, pm] = st.lastStateKey.split("|").map(Number);
    if (pe !== d.estado) {
      addLog(`Torre: ${ESTADOS[pe]} para ${ESTADOS[d.estado]} (${fmt1(d.temp)} °C, ventoinha ${d.pct}%)`, d.estado === 0 ? "warn" : "ok", d.t);
    }
    if (pm !== d.modo) {
      addLog(`Modo do Arduino: ${MODO_NOME[MODOS[pm]]} para ${MODO_NOME[modo]}`, "info", d.t);
      if (d.modo === 0 && Date.now() - st.lastInput > 4000) {
        toast({ kind: "warn", title: "Controle voltou para o potenciômetro", msg: "O Arduino ficou 5 s sem comandos do supervisório." });
      }
    }
  }
  st.lastStateKey = key;

  // alarmes de temperatura
  if (d.temp >= T_CRITICA) raiseAlarm("crit", "Temperatura crítica", `${fmt1(d.temp)} °C, acima do limite de ${T_CRITICA} °C.`);
  else if (d.temp <= T_CRITICA_SAI) clearAlarm("crit", "Temperatura crítica normalizada", `${fmt1(d.temp)} °C.`);
  if (d.temp >= T_ALTA) raiseAlarm("alta", "Temperatura alta", `${fmt1(d.temp)} °C, acima de ${T_ALTA} °C. Ventoinha em ${d.pct}%.`);
  else if (d.temp <= T_ALTA_SAI) clearAlarm("alta", "Temperatura normalizada", `${fmt1(d.temp)} °C, abaixo de ${T_ALTA_SAI} °C.`);
}

// ------------------------------------------------------------------ tempo real (SSE)
function openStream() {
  const es = new EventSource("/api/stream");
  es.addEventListener("tel", (e) => onTelemetry(JSON.parse(e.data)));
  es.addEventListener("status", (e) => {
    const s = JSON.parse(e.data);
    const was = st.status.connected;
    st.status = s;
    if (!was && s.connected) toast({ kind: "ok", title: "Conectado", msg: s.simulated ? "Simulador ativo, dados sintéticos." : `Porta ${s.port} aberta.` });
    if (was && !s.connected) {
      tower?.update({ online: false });
      st.lastStateKey = null;
      st.last = null;
      clearAlarm("com", "Desconectado", "A porta foi fechada.");
      scanPorts();
    }
    if (s.error && !s.connected) toast({ kind: "warn", title: "Falha na porta", msg: s.error });
    renderStatus();
  });
  es.addEventListener("log", (e) => { const m = JSON.parse(e.data); addLog(m.text, m.level, m.t); });
  es.onerror = () => {
    st.status = { connected: false };
    renderStatus();
    $("linkInfo").textContent = "Sem contato com o servidor local. Feche e abra o INICIAR.bat novamente.";
  };
}

// ------------------------------------------------------------------ gráfico
const chart = $("chart");
let CC = {};
function readChartColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  CC = { grid: v("--chart-grid"), ink: v("--ink-3"), temp: v("--c-temp"), pwm: v("--c-pwm"), warn: v("--warn"), alarm: v("--alarm"), ok: v("--ok") };
}
function drawChart() {
  const dpr = window.devicePixelRatio || 1;
  const w = chart.clientWidth, h = chart.clientHeight;
  if (!w) return;
  if (chart.width !== Math.round(w * dpr) || chart.height !== Math.round(h * dpr)) { chart.width = Math.round(w * dpr); chart.height = Math.round(h * dpr); }
  const g = chart.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const L = 34, R = 10, T = 8, B = 20, pw = w - L - R, ph = h - T - B;
  const win = Number($("trendWin").value);
  const now = Date.now() / 1000;
  const x = (t) => L + ((t - (now - win)) / win) * pw;
  const y = (v) => T + ph - (Math.max(0, Math.min(100, v)) / 100) * ph;

  g.font = "11px Bahnschrift, Segoe UI, sans-serif";
  g.lineWidth = 1;
  g.fillStyle = CC.ink;
  g.textAlign = "right";
  for (let v = 0; v <= 100; v += 20) {
    g.strokeStyle = CC.grid;
    g.beginPath(); g.moveTo(L, y(v) + 0.5); g.lineTo(L + pw, y(v) + 0.5); g.stroke();
    g.fillText(v, L - 6, y(v) + 4);
  }
  g.setLineDash([4, 4]);
  [[20, CC.warn], [35, CC.alarm], [60, CC.alarm]].forEach(([v, c]) => {
    g.strokeStyle = c; g.globalAlpha = 0.55;
    g.beginPath(); g.moveTo(L, y(v) + 0.5); g.lineTo(L + pw, y(v) + 0.5); g.stroke();
  });
  g.setLineDash([]); g.globalAlpha = 1;
  g.textAlign = "center";
  const unit = win >= 300 ? 60 : 1, suf = win >= 300 ? " min" : " s";
  for (let s = 0; s <= win; s += win / 5) {
    g.fillText(s === win ? "agora" : `-${Math.round((win - s) / unit)}${suf}`, Math.min(Math.max(x(now - win + s), L + 12), L + pw - 14), h - 5);
  }
  const pts = st.samples;
  let i0 = Math.max(0, pts.length - 1);
  while (i0 > 0 && pts[i0 - 1].t >= now - win) i0--;
  const line = (sel, color, width) => {
    g.strokeStyle = color; g.lineWidth = width; g.lineJoin = "round"; g.beginPath();
    let started = false;
    for (let i = i0; i < pts.length; i++) {
      const p = pts[i];
      if (p.t < now - win) continue;
      const px = x(p.t), py = y(sel(p));
      if (!started) { g.moveTo(px, py); started = true; } else g.lineTo(px, py);
    }
    g.stroke();
  };
  line((p) => p.pct, CC.pwm, 1.6);
  line((p) => p.temp, CC.temp, 2.2);
}
setInterval(drawChart, 250);
window.addEventListener("resize", drawChart);

// ------------------------------------------------------------------ CSV
$("btnCsv").onclick = () => {
  if (!st.samples.length) { toast({ kind: "info", title: "Nada para exportar", msg: "Conecte o Arduino para registrar leituras." }); return; }
  const n = (v) => String(v).replace(".", ",");
  const rows = ["data_hora;temperatura_C;potenciometro_C;ventoinha_pct;pwm_0_255;rpm_estimado;estado;modo;fonte"];
  for (const s of st.samples) {
    rows.push([new Date(s.t * 1000).toLocaleString("pt-BR"), n(s.temp), n(s.pot), s.pct, s.pwm, s.rpm,
      ESTADOS[s.estado], MODO_NOME[MODOS[s.modo]], s.sim ? "SIMULADOR" : "ARDUINO"].join(";"));
  }
  const ev = ["", "EVENTOS", ...[...$("log").querySelectorAll("li:not(.empty)")].reverse()
    .map((li) => `${li.querySelector("time").textContent};${li.querySelector("span").textContent.replace(/;/g, ",")}`)];
  const blob = new Blob(["﻿" + rows.concat(ev).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `torre_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast({ kind: "ok", title: "CSV exportado", msg: `${st.samples.length} leituras salvas em Downloads.` });
};
$("btnClearLog").onclick = emptyLog;

// ------------------------------------------------------------------ ferramentas da vista 3D
const toggle = (btn, fn) => {
  btn.onclick = () => {
    const on = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", on);
    fn(on);
  };
};
toggle($("btnRotate"), (on) => tower?.setAutoRotate(on));
toggle($("btnXray"), (on) => tower?.setXray(on));
$("btnView").onclick = () => tower?.resetView();
$("btnFull").onclick = () => {
  const el = document.querySelector(".stage-panel");
  if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.();
};

const COLOR_KEY = "torre3d.cores.v4";
const loadColors = () => { try { return JSON.parse(localStorage.getItem(COLOR_KEY)) || {}; } catch { return {}; } };
const saveColors = (c) => { try { localStorage.setItem(COLOR_KEY, JSON.stringify(c)); } catch { /* sem storage */ } };
function buildColorPanel() {
  const saved = loadColors();
  const list = $("cpList");
  list.innerHTML = "";
  for (const [key, def] of Object.entries(DEFAULT_COLORS)) {
    const val = saved[key] || def.value;
    tower?.setColor(key, val);
    const row = document.createElement("label");
    row.className = "cp-item";
    const sp = document.createElement("span");
    sp.textContent = def.label;
    const inp = document.createElement("input");
    inp.type = "color";
    inp.value = val;
    inp.oninput = () => { tower?.setColor(key, inp.value); const c = loadColors(); c[key] = inp.value; saveColors(c); };
    row.append(sp, inp);
    list.append(row);
  }
}
const setColorsOpen = (open) => { $("colorPanel").hidden = !open; $("btnColors").setAttribute("aria-pressed", open); };
$("btnColors").onclick = () => setColorsOpen($("colorPanel").hidden);
$("cpClose").onclick = () => setColorsOpen(false);
$("cpReset").onclick = () => { saveColors({}); buildColorPanel(); };
buildColorPanel();

// ------------------------------------------------------------------ início
applyTheme(document.documentElement.getAttribute("data-theme") || "light");
showPane("LOCAL");
scanPorts();
openStream();
renderStatus();
