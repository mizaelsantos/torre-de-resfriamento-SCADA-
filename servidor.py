"""
TORRE SCADA 3D — servidor local do supervisório.

Faz a ponte entre o navegador (interface 3D) e o Arduino pela porta USB.
Só depende do Python 3.8+ e do pacote pyserial.

    python servidor.py              -> abre http://localhost:8000 no navegador
    python servidor.py --porta 8080 -> usa outra porta HTTP
    python servidor.py --rede       -> permite abrir de outro PC/celular na mesma rede
"""

from __future__ import annotations

import argparse
import json
import math
import os
import queue
import random
import sys
import threading
import time
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# pyserial vai junto na pasta lib/ (não precisa de pip nem internet)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))

try:
    import serial
    from serial.tools import list_ports
except ImportError:  # pasta lib/ ausente
    serial = None
    list_ports = None

BASE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(BASE, "web")
BAUD = 115200
SIM_PORT = "SIMULADOR"

# Mesmos limites do firmware
TEMP_LIGA, TEMP_DESLIGA, TEMP_MAXIMA, TEMP_SAI_MAXIMA = 20.0, 18.0, 35.0, 33.0
WATCHDOG_S = 5.0


def arduino_map(x, a, b, c, d):
    return int((x - a) * (d - c) / (b - a) + c)


# ----------------------------------------------------------------------------
# Distribuição de eventos para os navegadores conectados (Server-Sent Events)
# ----------------------------------------------------------------------------
class Hub:
    def __init__(self):
        self._lock = threading.Lock()
        self._clients: list[queue.Queue] = []
        self.last_client_seen = 0.0

    def add(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=200)
        with self._lock:
            self._clients.append(q)
        return q

    def remove(self, q):
        with self._lock:
            if q in self._clients:
                self._clients.remove(q)
            self.last_client_seen = time.time()

    @property
    def count(self):
        with self._lock:
            return len(self._clients)

    def publish(self, kind: str, data: dict):
        msg = f"event: {kind}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        with self._lock:
            for q in self._clients:
                try:
                    q.put_nowait(msg)
                except queue.Full:
                    try:
                        q.get_nowait()
                        q.put_nowait(msg)
                    except queue.Empty:
                        pass


HUB = Hub()


def log(text: str, level: str = "info"):
    stamp = time.strftime("%H:%M:%S")
    print(f"[{stamp}] {text}")
    HUB.publish("log", {"t": time.time(), "text": text, "level": level})


# ----------------------------------------------------------------------------
# Simulador: reproduz o firmware para demonstrar sem a placa
# ----------------------------------------------------------------------------
class SimArduino:
    def __init__(self):
        self.pot = 22.0
        self.pot_manual = False
        self.estado = 0
        self.modo = 0
        self.temp_remota = 25.0
        self.manual_pct = 0
        self.last_cmd = time.time()
        self._t0 = time.time()

    def command(self, line: str):
        self.last_cmd = time.time()
        c = line[:1].upper()
        if c == "L":
            self.modo = 0
        elif c == "R":
            self.temp_remota = max(0.0, min(100.0, float(line[1:] or 0)))
            self.modo = 1
        elif c == "M":
            self.manual_pct = max(0, min(100, int(float(line[1:] or 0))))
            self.modo = 2

    def step(self) -> str:
        now = time.time()
        if self.modo != 0 and now - self.last_cmd > WATCHDOG_S:
            self.modo = 0
        if not self.pot_manual:  # "potenciômetro" girando devagar
            k = now - self._t0
            self.pot = 24 + 13 * math.sin(k / 22) + random.uniform(-0.1, 0.1)
        pot = round(max(0, min(100, self.pot)) * 10) / 10
        temp = round(self.temp_remota * 10) / 10 if self.modo == 1 else pot
        e = self.estado
        if e == 0 and temp >= TEMP_LIGA:
            e = 1
        elif e == 1 and temp < TEMP_DESLIGA:
            e = 0
        elif e == 1 and temp >= TEMP_MAXIMA:
            e = 2
        elif e == 2 and temp <= TEMP_SAI_MAXIMA:
            e = 1
        self.estado = e  # histerese segue a temperatura mesmo no manual
        if self.modo == 2:
            pwm = arduino_map(self.manual_pct, 0, 100, 0, 255)
            e = 0 if pwm == 0 else (2 if pwm >= 255 else 1)
        elif e == 0:
            pwm = 0
        elif e == 1:
            pwm = max(178, min(255, arduino_map(int(temp * 10), 200, 350, 178, 255)))
        else:
            pwm = 255
        pct = arduino_map(pwm, 0, 255, 0, 100)
        rpm = arduino_map(pwm, 0, 255, 0, 3000)
        return f"$D,{temp:.1f},{pct},{pwm},{rpm},{e},{self.modo},{pot:.1f}"


# ----------------------------------------------------------------------------
# Ligação com o Arduino (ou simulador)
# ----------------------------------------------------------------------------
class Link:
    def __init__(self):
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._tx: queue.Queue = queue.Queue()
        self.port: str | None = None
        self.connected = False
        self.error = ""
        self.desired = "L"          # comando que o supervisório quer manter
        self.last_rx = 0.0
        self.frames_ok = 0
        self.frames_bad = 0
        self.sim: SimArduino | None = None

    # ---- informações ----
    def status(self) -> dict:
        return {
            "connected": self.connected,
            "port": self.port,
            "simulated": self.port == SIM_PORT,
            "error": self.error,
            "desired": self.desired,
            "framesOk": self.frames_ok,
            "framesBad": self.frames_bad,
            "pyserial": serial is not None,
        }

    def publish_status(self):
        HUB.publish("status", self.status())

    # ---- controle ----
    def connect(self, port: str):
        self.disconnect(wait=True)
        self._stop.clear()
        self.port = port
        self.error = ""
        self.frames_ok = self.frames_bad = 0
        self.desired = "L"
        target = self._sim_worker if port == SIM_PORT else self._serial_worker
        self._thread = threading.Thread(target=target, daemon=True)
        self._thread.start()

    def disconnect(self, wait=False):
        t = self._thread
        if t and t.is_alive():
            self._stop.set()
            if wait:
                t.join(timeout=3)
        self._thread = None

    def send(self, cmd: str):
        cmd = cmd.strip()
        if cmd[:1].upper() in ("L", "R", "M"):
            self.desired = cmd
        self._tx.put(cmd)
        self.publish_status()

    # ---- recepção comum ----
    def _handle_line(self, line: str):
        line = line.strip()
        if not line:
            return
        if line.startswith("$I"):
            log(f"Arduino identificado: {line}", "ok")
            return
        if not line.startswith("$D,"):
            return  # texto livre (ex.: sketch antigo) é ignorado
        parts = line[3:].split(",")
        try:
            if len(parts) != 7:
                raise ValueError
            temp = float(parts[0])
            pct, pwm, rpm, est, modo = (int(p) for p in parts[1:6])
            pot = float(parts[6])
            if not (0 <= temp <= 100 and 0 <= pot <= 100 and 0 <= pwm <= 255 and est in (0, 1, 2) and modo in (0, 1, 2)):
                raise ValueError
        except ValueError:
            self.frames_bad += 1
            return
        self.frames_ok += 1
        self.last_rx = time.time()
        HUB.publish("tel", {
            "t": self.last_rx, "temp": temp, "pct": pct, "pwm": pwm, "rpm": rpm,
            "estado": est, "modo": modo, "pot": pot, "sim": self.port == SIM_PORT,
        })

    def _heartbeat_due(self, last_hb: float) -> bool:
        return time.time() - last_hb >= 1.0

    def _keepalive_cmd(self) -> str | None:
        # Só mantém REMOTO/MANUAL vivo enquanto alguém está com o supervisório aberto.
        # Fechou o navegador -> para de enviar -> Arduino volta para LOCAL em 5 s.
        if HUB.count == 0 and time.time() - HUB.last_client_seen > 3:
            return None
        return self.desired

    # ---- threads ----
    def _serial_worker(self):
        port = self.port
        try:
            if serial is None:
                raise RuntimeError("pyserial não instalado (rode: pip install pyserial)")
            with serial.Serial(port, BAUD, timeout=0.1, write_timeout=1) as ser:
                self.connected = True
                log(f"Porta {port} aberta. Aguardando o Arduino reiniciar...", "ok")
                self.publish_status()
                time.sleep(1.8)  # o Uno reinicia quando a porta abre
                ser.reset_input_buffer()
                buf = b""
                last_hb = 0.0
                warned = False
                while not self._stop.is_set():
                    while not self._tx.empty():
                        ser.write((self._tx.get_nowait() + "\n").encode("ascii"))
                        last_hb = time.time()
                    if self._heartbeat_due(last_hb):
                        cmd = self._keepalive_cmd()
                        if cmd:
                            ser.write((cmd + "\n").encode("ascii"))
                        last_hb = time.time()
                    chunk = ser.read(256)
                    if chunk:
                        buf += chunk
                        while b"\n" in buf:
                            raw, buf = buf.split(b"\n", 1)
                            self._handle_line(raw.decode("ascii", "replace"))
                        if len(buf) > 512:
                            buf = b""
                    silent = time.time() - max(self.last_rx, 1) > 4
                    if silent and not warned and self.frames_ok == 0 and self.frames_bad == 0:
                        log("Nenhum dado do Arduino. Confira se o firmware v2 (115200) foi gravado "
                            "e se o Monitor Serial da IDE está fechado.", "warn")
                        warned = True
        except Exception as exc:  # noqa: BLE001
            self.error = str(exc)
            log(f"Falha na porta {port}: {exc}", "error")
        finally:
            self.connected = False
            log(f"Desconectado de {port}.", "warn")
            self.publish_status()

    def _sim_worker(self):
        self.sim = SimArduino()
        self.connected = True
        log("Modo SIMULADOR ativo (dados sintéticos, sem Arduino).", "warn")
        self.publish_status()
        HUB.publish("log", {"t": time.time(), "text": "$I,TORRE3D,2 (simulado)", "level": "info"})
        last_hb = 0.0
        next_step = time.time()
        try:
            while not self._stop.is_set():
                while not self._tx.empty():
                    cmd = self._tx.get_nowait()
                    try:
                        self.sim.command(cmd)
                    except ValueError:
                        pass
                    last_hb = time.time()
                if self._heartbeat_due(last_hb):
                    cmd = self._keepalive_cmd()
                    if cmd:
                        self.sim.command(cmd)
                    last_hb = time.time()
                if time.time() >= next_step:
                    self._handle_line(self.sim.step())
                    next_step += 0.25
                time.sleep(0.02)
        finally:
            self.connected = False
            self.sim = None
            log("Simulador parado.", "warn")
            self.publish_status()


LINK = Link()


class Servidor(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        # Navegador fechou a aba/conexão: normal, não poluir a janela com traceback.
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, TimeoutError)):
            return
        super().handle_error(request, client_address)


def find_ports() -> list[dict]:
    ports = []
    if list_ports is not None:
        for p in list_ports.comports():
            desc = (p.description or "Porta serial").strip()
            sig = f"{desc} {p.manufacturer or ''} {p.hwid or ''}".lower()
            score = 10
            if p.vid in (0x2341, 0x2A03) or "arduino" in sig:
                score += 120
            if any(w in sig for w in ("ch340", "ch341", "cp210", "ftdi", "usb serial", "usb-serial")):
                score += 65
            ports.append({"device": p.device, "label": f"{p.device} — {desc}", "score": score})
    ports.sort(key=lambda x: (-x["score"], x["device"]))
    ports.append({"device": SIM_PORT, "label": "Simulador (sem Arduino)", "score": 0})
    return ports


# ----------------------------------------------------------------------------
# HTTP
# ----------------------------------------------------------------------------
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def log_message(self, *args):  # silencia o log de cada arquivo
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 10000:
            return {}
        try:
            return json.loads(self.rfile.read(n))
        except json.JSONDecodeError:
            return {}

    def do_GET(self):
        if self.path == "/api/ports":
            return self._json({"ports": find_ports()})
        if self.path == "/api/status":
            return self._json(LINK.status())
        if self.path == "/api/stream":
            return self._stream()
        return super().do_GET()

    def do_POST(self):
        data = self._body()
        if self.path == "/api/connect":
            port = str(data.get("port") or "").strip()
            if not port:
                return self._json({"ok": False, "error": "Escolha uma porta"}, 400)
            LINK.connect(port)
            return self._json({"ok": True})
        if self.path == "/api/disconnect":
            if LINK.connected and LINK.port != SIM_PORT:
                LINK.send("L")  # devolve o controle ao potenciômetro antes de soltar
                time.sleep(0.15)
            LINK.disconnect()
            return self._json({"ok": True})
        if self.path == "/api/command":
            mode = str(data.get("mode", "")).upper()
            try:
                if mode == "LOCAL":
                    cmd = "L"
                elif mode == "REMOTO":
                    v = float(data["value"])
                    if not 0 <= v <= 100:
                        raise ValueError
                    cmd = f"R{v:.1f}"
                elif mode == "MANUAL":
                    v = int(round(float(data["value"])))
                    if not 0 <= v <= 100:
                        raise ValueError
                    cmd = f"M{v}"
                else:
                    raise ValueError
            except (KeyError, ValueError, TypeError):
                return self._json({"ok": False, "error": "Comando inválido"}, 400)
            if not LINK.connected:
                return self._json({"ok": False, "error": "Não conectado"}, 409)
            LINK.send(cmd)
            return self._json({"ok": True, "sent": cmd})
        if self.path == "/api/simpot":
            if LINK.sim is not None:
                try:
                    LINK.sim.pot = max(0.0, min(100.0, float(data.get("value"))))
                    LINK.sim.pot_manual = bool(data.get("manual", True))
                except (TypeError, ValueError):
                    return self._json({"ok": False}, 400)
            return self._json({"ok": True})
        return self._json({"ok": False, "error": "Rota desconhecida"}, 404)

    def _stream(self):
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        q = HUB.add()
        try:
            first = f"event: status\ndata: {json.dumps(LINK.status())}\n\n"
            self.wfile.write(first.encode())
            self.wfile.flush()
            while True:
                try:
                    msg = q.get(timeout=10)
                except queue.Empty:
                    msg = ": ping\n\n"
                self.wfile.write(msg.encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass
        finally:
            HUB.remove(q)


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")  # console do Windows sem UTF-8
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description="Servidor do supervisório Torre SCADA 3D")
    ap.add_argument("--porta", type=int, default=8000, help="porta HTTP (padrão 8000)")
    ap.add_argument("--rede", action="store_true", help="aceitar acesso de outros PCs da rede")
    ap.add_argument("--sem-navegador", action="store_true", help="não abrir o navegador")
    args = ap.parse_args()

    host = "0.0.0.0" if args.rede else "127.0.0.1"
    server = None
    for port in range(args.porta, args.porta + 20):
        try:
            server = Servidor((host, port), Handler)
            break
        except OSError:
            continue
    if server is None:
        sys.exit("Nenhuma porta HTTP livre encontrada.")
    server.daemon_threads = True
    url = f"http://localhost:{server.server_port}"

    print("=" * 60)
    print("  TORRE SCADA 3D — Supervisório da Torre de Resfriamento")
    print(f"  Abra no navegador:  {url}")
    if args.rede:
        try:
            import socket
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sk:
                sk.connect(("10.255.255.255", 1))
                ip = sk.getsockname()[0]
            print(f"  Em outro PC/celular da rede:  http://{ip}:{server.server_port}")
        except OSError:
            pass
    if serial is None:
        print("  ATENÇÃO: pasta lib/ ausente -> só o Simulador funciona.")
    print("  Para encerrar, feche esta janela (ou Ctrl+C).")
    print("=" * 60)

    if not args.sem_navegador:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if LINK.connected and LINK.port != SIM_PORT:
            LINK.send("L")
            time.sleep(0.2)
        LINK.disconnect(wait=True)
        server.server_close()


if __name__ == "__main__":
    main()
