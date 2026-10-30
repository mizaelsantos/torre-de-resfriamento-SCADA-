/* Teste da lógica do firmware no PC (sem placa).
 * g++ -std=c++11 -Itests/fake_arduino tests/test_firmware_native.cpp -o teste && ./teste
 * NÃO substitui a compilação na IDE Arduino nem o teste de bancada. */
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <deque>
#include <string>
#include <vector>
using byte = uint8_t;
#define A0 14
#define OUTPUT 1
#define HIGH 1
#define LOW 0
static unsigned long clock_ms = 0;
static int adc = 0, pwm_out = -1, led[16];
void pinMode(int, int) {}
int analogRead(int) { return adc; }
unsigned long millis() { return clock_ms; }
void delay(unsigned long ms) { clock_ms += ms; }
void analogWrite(int pin, int v) { if (pin == 3) pwm_out = v; }
void digitalWrite(int pin, int v) { led[pin] = v; }
long map(long x, long a, long b, long c, long d) { return (x - a) * (d - c) / (b - a) + c; }
template <class T> T constrain(T x, T a, T b) { return x < a ? a : (x > b ? b : x); }
struct FakeSerial {
  std::string out; std::deque<char> in; std::vector<std::string> lines;
  void begin(long) {}
  int available() { return (int)in.size(); }
  int read() { char c = in.front(); in.pop_front(); return c; }
  void emit() { size_t p; while ((p = out.find('\n')) != std::string::npos) { lines.push_back(out.substr(0, p)); out.erase(0, p + 1); } }
  void print(const char *s) { out += s; emit(); }
  void print(int v) { out += std::to_string(v); }
  void print(float v, int p) { char b[32]; snprintf(b, sizeof b, "%.*f", p, v); out += b; }
  void send(const std::string &s) { for (char c : s) in.push_back(c); }
} Serial;
#include "../arduino/torre_resfriamento/torre_resfriamento.ino"

struct Tel { float t; int pct, pwm, rpm, est, modo; float tpot; };
Tel cycle() {
  clock_ms += 250; size_t n = Serial.lines.size(); loop();
  assert(Serial.lines.size() == n + 1);
  Tel x; int k = sscanf(Serial.lines.back().c_str(), "$D,%f,%d,%d,%d,%d,%d,%f", &x.t, &x.pct, &x.pwm, &x.rpm, &x.est, &x.modo, &x.tpot);
  assert(k == 7); assert(x.pwm == pwm_out);
  assert(led[7] == (x.est == 0)); assert(led[6] == (x.est == 1)); assert(led[5] == (x.est == 2));
  return x;
}
int adcFor(float t) { return (int)lround(t / 100.0 * 1023.0); }
int main() {
  setup();
  assert(Serial.lines.back() == "$I,TORRE3D,2");
  // LOCAL: histerese original
  adc = adcFor(15); Tel a = cycle(); assert(a.modo == 0 && a.est == 0 && a.pwm == 0);
  adc = adcFor(20); a = cycle(); assert(a.est == 1 && a.pwm == 178 && a.pct == 69);
  adc = adcFor(19); a = cycle(); assert(a.est == 1);           // mantém ligado
  adc = adcFor(17.5); a = cycle(); assert(a.est == 0 && a.pwm == 0);
  adc = adcFor(36); a = cycle(); assert(a.est == 1); a = cycle(); assert(a.est == 2 && a.pwm == 255 && a.rpm == 3000);
  adc = adcFor(34); a = cycle(); assert(a.est == 2);           // histerese da máxima
  adc = adcFor(32); a = cycle(); assert(a.est == 1);
  printf("LCD: [%s] [%s]\n", lcd.row[0].c_str(), lcd.row[1].c_str());
  // REMOTO: supervisório manda a temperatura, potenciômetro ignorado
  adc = adcFor(10); cycle();
  Serial.send("R27.5\n"); a = cycle();
  assert(a.modo == 1 && fabs(a.t - 27.5) < 0.01 && fabs(a.tpot - 10.0) < 0.2 && a.est == 1);
  assert(a.pwm == map(275, 200, 350, 178, 255));
  printf("LCD: [%s] [%s]\n", lcd.row[0].c_str(), lcd.row[1].c_str());
  Serial.send("R99\n"); a = cycle(); assert(fabs(a.t - 99) < 0.01);
  Serial.send("R150\n"); a = cycle(); assert(fabs(a.t - 100) < 0.01); // limitado a 100
  // MANUAL
  Serial.send("M40\r\n"); a = cycle(); assert(a.modo == 2 && a.pwm == 102 && a.est == 1);
  Serial.send("M0\n"); a = cycle(); assert(a.pwm == 0 && a.est == 0);
  Serial.send("M100\n"); a = cycle(); assert(a.pwm == 255 && a.est == 2);
  // saindo do manual a 15 °C: desliga direto, sem passar por NORMAL
  { Serial.send("L\n"); adc = adcFor(15); Tel b = cycle(); assert(b.modo == 0 && b.pwm == 0 && b.est == 0); }
  adc = adcFor(10); Serial.send("M100\n"); a = cycle(); assert(a.pwm == 255 && a.est == 2);
  printf("LCD: [%s] [%s]\n", lcd.row[0].c_str(), lcd.row[1].c_str());
  // Watchdog: ping mantém, silêncio volta para LOCAL
  for (int i = 0; i < 30; i++) { if (i % 4 == 0) Serial.send("P\n"); a = cycle(); assert(a.modo == 2); }
  for (int i = 0; i < 25; i++) a = cycle();
  assert(a.modo == 0);
  // Volta LOCAL por comando + lixo na linha não trava
  Serial.send("R30\n"); cycle(); Serial.send("XXXXXXXXXXXXXXXXXXXXXXXXXXXXX\nL\n"); a = cycle(); assert(a.modo == 0);
  assert(lcd.row[0].size() == 16 && lcd.row[1].size() == 16);
  printf("OK: %zu quadros verificados\n", Serial.lines.size());
}
