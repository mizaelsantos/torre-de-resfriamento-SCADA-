/*
 * TORRE DE RESFRIAMENTO — Arduino Uno  |  Firmware v2 (supervisório 3D)
 *
 * Mantém os pinos e a lógica do sketch original:
 *   A0  : potenciômetro (temperatura simulada 0–100 °C)
 *   D3  : PWM da ventoinha (módulo MOSFET IRF520)
 *   D7  : LED vermelho  -> DESLIGADO
 *   D6  : LED amarelo   -> NORMAL
 *   D5  : LED verde     -> MÁXIMA
 *   LCD 16x2: RS=8 E=9 D4=10 D5=11 D6=12 D7=13
 *
 * Histerese (igual ao original):
 *   DESLIGADO -> NORMAL  quando T >= 20,0 °C
 *   NORMAL    -> DESLIGADO quando T < 18,0 °C
 *   NORMAL    -> MÁXIMA  quando T >= 35,0 °C
 *   MÁXIMA    -> NORMAL  quando T <= 33,0 °C
 *   NORMAL: PWM proporcional 20 °C = 70 %  ...  35 °C = 100 %
 *
 * NOVO: modos de operação comandados pelo supervisório (USB, 115200 8N1)
 *   LOCAL  (0): temperatura vem do potenciômetro (como antes)
 *   REMOTO (1): temperatura definida no supervisório (o potenciômetro é ignorado)
 *   MANUAL (2): % da ventoinha definido direto no supervisório
 *
 * Comandos recebidos (uma linha por comando, terminando em \n):
 *   L        -> volta ao modo LOCAL
 *   R25.5    -> modo REMOTO com temperatura 25,5 °C (0 a 100)
 *   M80      -> modo MANUAL com ventoinha a 80 % (0 a 100)
 *   P        -> "ping" (mantém a conexão viva)
 *
 * SEGURANÇA: se ficar 5 s sem receber nada do supervisório nos modos
 * REMOTO ou MANUAL (cabo solto, PC travado, programa fechado), o Arduino
 * volta sozinho para o modo LOCAL (potenciômetro).
 *
 * Telemetria enviada a cada 250 ms (sem texto extra, para não confundir o PC):
 *   $D,temp,pwm%,pwm,rpm,estado,modo,tempPot
 *   ex.: $D,25.0,79,201,2364,1,1,18.3
 * Ao ligar envia:  $I,TORRE3D,2
 * RPM é ESTIMADO (0–3000 proporcional ao PWM); não há sensor de rotação.
 */

#include <LiquidCrystal.h>

// LCD: RS, E, D4, D5, D6, D7
LiquidCrystal lcd(8, 9, 10, 11, 12, 13);

// Entradas
const byte POT_TEMP = A0;

// LEDs
const byte LED_VERMELHO = 7;
const byte LED_AMARELO  = 6;
const byte LED_VERDE    = 5;

// PWM da ventoinha
const byte PWM_FAN = 3;

// Estados da torre
enum Estado { DESLIGADO = 0, NORMAL = 1, MAXIMA = 2 };
Estado estado = DESLIGADO;      // estado da histerese (pela temperatura)
Estado estadoSaida = DESLIGADO; // estado real da saída (LEDs, LCD, supervisório)

// Modos de operação
enum Modo { MODO_LOCAL = 0, MODO_REMOTO = 1, MODO_MANUAL = 2 };
Modo modo = MODO_LOCAL;

// Limites de temperatura (°C)
const float TEMP_LIGA       = 20.0;
const float TEMP_DESLIGA    = 18.0;
const float TEMP_MAXIMA     = 35.0;
const float TEMP_SAI_MAXIMA = 33.0;

// Tempos
const unsigned long PERIODO_MS  = 250;   // ciclo de controle/telemetria
const unsigned long WATCHDOG_MS = 5000;  // sem comando -> volta para LOCAL

// Variáveis de processo
float temperatura    = 0.0;  // temperatura usada pelo controle
float temperaturaPot = 0.0;  // leitura do potenciômetro
float tempRemota     = 25.0; // setpoint vindo do supervisório
int   manualPct      = 0;    // % manual vindo do supervisório

int pwmValor      = 0;
int pwmPercentual = 0;
int rpmMotor      = 0;

unsigned long ultimoCiclo   = 0;
unsigned long ultimoComando = 0;

// Buffer de recepção serial
char rxBuf[16];
byte rxLen = 0;

// ------------------------------------------------------------------
void processaComando(const char *cmd)
{
  ultimoComando = millis();
  switch (cmd[0])
  {
    case 'L': case 'l':
      modo = MODO_LOCAL;
      break;

    case 'R': case 'r':
    {
      float t = atof(cmd + 1);
      if (t < 0.0)  t = 0.0;
      if (t > 100.0) t = 100.0;
      tempRemota = t;
      modo = MODO_REMOTO;
      break;
    }

    case 'M': case 'm':
    {
      int p = atoi(cmd + 1);
      manualPct = constrain(p, 0, 100);
      modo = MODO_MANUAL;
      break;
    }

    case 'P': case 'p':
    default:
      break; // só renova o watchdog
  }
}

void leSerial()
{
  while (Serial.available() > 0)
  {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r')
    {
      if (rxLen > 0)
      {
        rxBuf[rxLen] = '\0';
        processaComando(rxBuf);
        rxLen = 0;
      }
    }
    else if (rxLen < sizeof(rxBuf) - 1)
    {
      rxBuf[rxLen++] = c;
    }
    else
    {
      rxLen = 0; // linha longa demais: descarta
    }
  }
}

void atualizaHisterese()
{
  switch (estado)
  {
    case DESLIGADO:
      if (temperatura >= TEMP_LIGA) estado = NORMAL;
      break;
    case NORMAL:
      if (temperatura < TEMP_DESLIGA)       estado = DESLIGADO;
      else if (temperatura >= TEMP_MAXIMA)  estado = MAXIMA;
      break;
    case MAXIMA:
      if (temperatura <= TEMP_SAI_MAXIMA)   estado = NORMAL;
      break;
  }
}

void acendeLeds(int e) // int: evita erro de protótipo automático da IDE
{
  digitalWrite(LED_VERMELHO, e == DESLIGADO ? HIGH : LOW);
  digitalWrite(LED_AMARELO,  e == NORMAL    ? HIGH : LOW);
  digitalWrite(LED_VERDE,    e == MAXIMA    ? HIGH : LOW);
}

void atualizaLcd()
{
  // Linha 1: "T: 25.0°C REMOTO"
  lcd.setCursor(0, 0);
  lcd.print("T:");
  // "T: 25.0°C REMOTO" (16 colunas, até 100.0 °C)
  if (temperatura < 100.0) lcd.print(' ');
  if (temperatura < 10.0)  lcd.print(' ');
  lcd.print(temperatura, 1);
  lcd.print((char)223);
  lcd.print("C ");
  if (modo == MODO_LOCAL)       lcd.print("LOCAL ");
  else if (modo == MODO_REMOTO) lcd.print("REMOTO");
  else                          lcd.print("MANUAL");

  // Linha 2: "PWM: 70% NORMAL "
  lcd.setCursor(0, 1);
  lcd.print("PWM:");
  if (pwmPercentual < 100) lcd.print(' ');
  if (pwmPercentual < 10)  lcd.print(' ');
  lcd.print(pwmPercentual);
  lcd.print("% ");
  if (estadoSaida == DESLIGADO)   lcd.print("DESLIG.");
  else if (estadoSaida == NORMAL) lcd.print("NORMAL ");
  else                       lcd.print("MAXIMA ");
}

void enviaTelemetria()
{
  Serial.print("$D,");
  Serial.print(temperatura, 1);   Serial.print(",");
  Serial.print(pwmPercentual);    Serial.print(",");
  Serial.print(pwmValor);         Serial.print(",");
  Serial.print(rpmMotor);         Serial.print(",");
  Serial.print((int)estadoSaida); Serial.print(",");
  Serial.print((int)modo);        Serial.print(",");
  Serial.print(temperaturaPot, 1);
  Serial.print("\n");
}

// ------------------------------------------------------------------
void setup()
{
  Serial.begin(115200);

  pinMode(LED_VERMELHO, OUTPUT);
  pinMode(LED_AMARELO, OUTPUT);
  pinMode(LED_VERDE, OUTPUT);
  pinMode(PWM_FAN, OUTPUT);
  analogWrite(PWM_FAN, 0);

  lcd.begin(16, 2);
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Torre SCADA 3D");
  lcd.setCursor(0, 1);
  lcd.print("Inicializando");
  delay(1500);
  lcd.clear();

  Serial.print("$I,TORRE3D,2\n");
  ultimoCiclo = millis();
}

void loop()
{
  leSerial();

  unsigned long agora = millis();
  if (agora - ultimoCiclo < PERIODO_MS) return;
  ultimoCiclo = agora;

  // Watchdog de comunicação
  if (modo != MODO_LOCAL && (agora - ultimoComando) > WATCHDOG_MS)
  {
    modo = MODO_LOCAL;
  }

  // ---------------- Leitura do potenciômetro ----------------
  int leitura = analogRead(POT_TEMP);
  temperaturaPot = ((float)leitura / 1023.0) * 100.0;
  temperaturaPot = round(temperaturaPot * 10.0) / 10.0;

  // Temperatura usada pelo controle
  if (modo == MODO_REMOTO) temperatura = round(tempRemota * 10.0) / 10.0;
  else                     temperatura = temperaturaPot;

  // ---------------- Histerese (sempre roda) ----------------
  atualizaHisterese();

  // ---------------- Controle do PWM ----------------
  if (modo == MODO_MANUAL)
  {
    pwmValor = map(manualPct, 0, 100, 0, 255);
    // no manual os LEDs mostram a saída real; a histerese continua rodando à parte
    estadoSaida = (pwmValor == 0) ? DESLIGADO : (pwmValor >= 255 ? MAXIMA : NORMAL);
  }
  else
  {
    if (estado == DESLIGADO)
    {
      pwmValor = 0;
    }
    else if (estado == NORMAL)
    {
      // 20 °C = 70 %   |   35 °C = 100 %
      pwmValor = map((int)(temperatura * 10), 200, 350, 178, 255);
      pwmValor = constrain(pwmValor, 178, 255);
    }
    else
    {
      pwmValor = 255;
    }
    estadoSaida = estado;
  }

  acendeLeds(estadoSaida);
  analogWrite(PWM_FAN, pwmValor);

  pwmPercentual = map(pwmValor, 0, 255, 0, 100);
  rpmMotor      = map(pwmValor, 0, 255, 0, 3000);

  atualizaLcd();
  enviaTelemetria();
}
