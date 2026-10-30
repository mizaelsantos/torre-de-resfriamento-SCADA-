# Torre de Resfriamento: supervisório 3D

Supervisório com a torre de resfriamento em **3D (Three.js)**, ligado ao **Arduino Uno** pela USB.
O que você comanda na tela chega ao físico: ventoinha (PWM no D3), LEDs e LCD.

---

## 1. Rodar no PC (Windows)

1. Instale o **Python 3** (versão 3.8 ou mais nova) em https://www.python.org/downloads/
   e **marque "Add python.exe to PATH"** durante a instalação. Isso só precisa ser feito uma vez.
2. Descompacte esta pasta em qualquer lugar (ex.: Área de Trabalho).
3. Dê dois cliques em **`INICIAR.bat`**.
   Abre uma janela preta (o servidor) e o navegador já abre o supervisório.
   **Não feche a janela preta** enquanto estiver usando.
4. Use **Google Chrome** ou **Microsoft Edge** atualizados.

Não precisa de internet nem de `pip install`: o Three.js e a biblioteca serial já estão dentro da pasta.

> Linux/macOS: `./iniciar.sh` (ou `python3 servidor.py`).

## 2. Gravar o firmware no Arduino (uma vez)

1. Abra `arduino/torre_resfriamento/torre_resfriamento.ino` na **IDE Arduino**.
2. Placa: **Arduino Uno**. Porta: a COM do Arduino. Clique **Carregar**.
3. **Feche o Monitor Serial da IDE**, porque ele ocupa a porta e o supervisório não consegue abrir.

O firmware usa **115200 baud** (o sketch antigo usava 9600) e mantém os mesmos pinos e a mesma lógica:

| Arduino Uno | Ligação |
|---|---|
| A0 | Potenciômetro (temperatura simulada 0–100 °C) |
| D3 | PWM da ventoinha (módulo MOSFET IRF520) |
| D7 | LED vermelho (DESLIGADO) |
| D6 | LED amarelo (NORMAL) |
| D5 | LED verde (MÁXIMA) |
| D8, D9, D10, D11, D12, D13 | LCD 16x2: RS, E, D4, D5, D6, D7 |

## 3. Usando o supervisório

1. Em **Comunicação**, escolha a porta (a primeira da lista costuma ser o Arduino) e clique **Conectar**.
   Se a porta não aparecer, escolha **"Outra porta… (digitar)"** e digite, por exemplo, `COM5`.
   Sem placa, escolha **Simulador** para demonstrar.
2. O indicador no topo fica **verde (Online)** quando chegam dados do Arduino.
3. **Modo de operação:**
   - **Local**: a temperatura vem do potenciômetro, como no sketch original.
   - **Remoto**: você define a temperatura na tela (controle deslizante, botões − e +).
     O Arduino ignora o potenciômetro e aplica a histerese com esse valor.
   - **Manual**: você define direto o % da ventoinha (0 a 100 %).
   A temperatura comandada vai de 0 a 100 °C, com atalhos de 15, 25, 35 e 60 °C.
4. **Vista 3D:** arraste para girar, use a roda do mouse para zoom e o botão direito para mover.
   - **Raio-X**: deixa a carcaça transparente e mostra o enchimento (colmeia), o tubo de aspersão, as gotas e a bacia.
   - **Girar**: rotação automática (bom para apresentação).
   - **Cores**: troque a cor de cada parte da torre. Fica salvo neste navegador.
   - **Tela cheia**: só a torre, para projetar.
   - Os ventiladores giram conforme o PWM real, o cenário fica **avermelhado quando esquenta** e **azulado quando esfria**, e sai vapor quando a torre está quente.
5. **Leituras no topo**: temperatura (escala de 0 a 100 °C com as marcas de 20, 35 e 60 °C), ventoinha, rotação estimada, estado e modo.
   O painel **Arduino** mostra os 3 LEDs e o espelho do LCD 16x2. No raio-X da torre 3D aparecem o enchimento de celulose (colmeia laranja), a aspersão, o eliminador de gotas (lâminas em V logo abaixo dos ventiladores) e a bomba d'água interna. Os canos de água vão do branco ao vermelho conforme a temperatura sobe (de 22 °C a 50 °C).
6. **Tendência**: gráfico de temperatura e ventoinha (1, 5 ou 15 min), com as linhas de 20, 35 e 60 °C.
7. **Alarmes**: aparecem como notificação no canto da tela, com aviso sonoro e botão **Reconhecer**.
   O sino no topo mostra quantos alarmes estão ativos.
   - Temperatura alta: a partir de 35 °C (normaliza em 33 °C).
   - Temperatura crítica: a partir de 60 °C (normaliza em 57 °C).
   - Sem dados do Arduino: mais de 3 s sem leitura com a porta aberta.
8. **Tema claro e escuro**: botão de sol/lua no topo. A escolha fica salva no navegador.
9. **Exportar CSV**: telemetria e eventos, com `;` e vírgula decimal para abrir no Excel.

### Segurança
Se o supervisório for fechado, o PC travar ou o cabo soltar, o Arduino **volta sozinho para o modo Local
(potenciômetro) em 5 segundos**. Ao clicar **Desconectar**, o controle também volta ao potenciômetro.

## 4. Lógica do controle (igual ao seu código)

| Situação | Resultado |
|---|---|
| DESLIGADO e T ≥ 20 °C | liga → NORMAL |
| NORMAL e T < 18 °C | desliga → DESLIGADO |
| NORMAL e T ≥ 35 °C | → MÁXIMA (100 %) |
| MÁXIMA e T ≤ 33 °C | volta → NORMAL |
| NORMAL | PWM proporcional: 20 °C = 70 % … 35 °C = 100 % |

O RPM é **estimado** (0–3000, proporcional ao PWM). Não existe sensor de rotação na montagem.

## 5. Protocolo serial (115200 8N1)

Arduino → PC, a cada 250 ms:
```
$D,temperatura,pwm%,pwm(0-255),rpm,estado,modo,temp_potenciometro
$D,25.0,79,201,2364,1,1,18.3
```
estado: 0 = DESLIGADO, 1 = NORMAL, 2 = MÁXIMA · modo: 0 = LOCAL, 1 = REMOTO, 2 = MANUAL

PC → Arduino (uma linha cada):
```
L        volta para LOCAL (potenciômetro)
R25.5    REMOTO com 25,5 °C (0 a 100)
M80      MANUAL com ventoinha a 80 %
P        ping (mantém a conexão viva)
```

## 6. Problemas comuns

| Sintoma | Solução |
|---|---|
| "Python não encontrado" | Instale o Python marcando "Add python.exe to PATH" e abra o INICIAR.bat de novo. |
| "Acesso negado" / porta ocupada | Feche o Monitor Serial da IDE Arduino (ou outro programa usando a COM). |
| Conecta mas fica "Sem dados" | Grave o firmware **desta pasta** (115200). O sketch antigo (9600) não é compatível. |
| Arduino não aparece na lista | Clique ↻. Placas com chip CH340 podem precisar do driver CH340. Ou digite a COM em "Outra porta…". |
| Tela branca no lugar da torre | Atualize o Chrome/Edge e ative a aceleração de hardware (Configurações → Sistema). |
| Abrir de outro PC/celular | Use **INICIAR_EM_REDE.bat** e acesse o endereço mostrado na janela preta. Libere no Firewall se ele perguntar. |

## 7. Arquivos

```
TorreSCADA_3D/
├── INICIAR.bat              ← dois cliques para abrir
├── INICIAR_EM_REDE.bat      ← permite abrir de outro PC/celular
├── iniciar.sh               ← Linux/macOS
├── servidor.py              ← ponte navegador ↔ Arduino (USB) + simulador
├── arduino/torre_resfriamento/torre_resfriamento.ino   ← firmware v2
├── web/                     ← interface (HTML/CSS/JS), torre 3D, logos
│   ├── tower3d.js           ← modelo 3D e animações
│   ├── app.js               ← painel, comandos, gráfico, CSV
│   └── vendor/              ← Three.js r169 (MIT)
├── lib/serial/              ← pyserial 3.5 (BSD)
└── tests/                   ← testes do firmware e do servidor
```

Testes (opcional): `python -m unittest discover -s tests -v`.
Para o firmware, com g++: `g++ -std=c++11 -Itests/fake_arduino tests/test_firmware_native.cpp -o teste && ./teste`.

*Projeto didático. Não é equipamento certificado nem sistema de segurança industrial. Confira a fiação, a fonte
da ventoinha e o MOSFET (o IRF520 pode não chavear bem com 5 V no gate) com orientação técnica.*
