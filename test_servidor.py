"""python -m unittest discover -s tests -v   (na pasta do supervisório)"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import servidor  # noqa: E402


class SimuladorTests(unittest.TestCase):
    """O simulador precisa se comportar igual ao firmware."""

    def frame(self, sim):
        p = sim.step()[3:].split(",")
        return float(p[0]), int(p[1]), int(p[2]), int(p[4]), int(p[5])

    def test_histerese_local(self):
        s = servidor.SimArduino()
        s.pot_manual = True
        for pot, est, pwm in [(15, 0, 0), (20, 1, 178), (19, 1, 178), (17.5, 0, 0), (36, 1, 255), (36, 2, 255),
                              (34, 2, 255), (32, 1, 239)]:
            s.pot = pot
            t, pct, p, e, modo = self.frame(s)
            self.assertEqual((e, p, modo), (est, pwm, 0), f"pot={pot}")

    def test_remoto_e_manual(self):
        s = servidor.SimArduino()
        s.pot_manual, s.pot = True, 10
        s.command("R27.5")
        t, pct, pwm, e, modo = self.frame(s)
        self.assertEqual((t, modo, e, pwm), (27.5, 1, 1, 216))
        s.command("M40")
        t, pct, pwm, e, modo = self.frame(s)
        self.assertEqual((modo, pwm, e), (2, 102, 1))
        s.command("M0")
        self.assertEqual(self.frame(s)[3], 0)
        s.command("L")
        self.assertEqual(self.frame(s)[4], 0)

    def test_watchdog(self):
        s = servidor.SimArduino()
        s.command("M80")
        s.last_cmd -= 6
        self.assertEqual(self.frame(s)[4], 0)


class ProtocoloTests(unittest.TestCase):
    def test_quadros(self):
        link = servidor.Link()
        link._handle_line("$D,25.0,79,201,2364,1,1,18.3")
        self.assertEqual((link.frames_ok, link.frames_bad), (1, 0))
        for bad in ["$D,25.0,79,201", "$D,a,b,c,d,e,f,g", "$D,120,0,0,0,0,0,0", "$D,25,0,300,0,0,0,0",
                    "$D,25,0,0,0,5,0,0"]:
            link._handle_line(bad)
        self.assertEqual(link.frames_bad, 5)
        link._handle_line("Temperatura: 25.0 | PWM: 79%")  # texto do sketch antigo: ignorado
        self.assertEqual((link.frames_ok, link.frames_bad), (1, 5))

    def test_pyserial_embutido(self):
        self.assertIsNotNone(servidor.serial)
        self.assertIn("lib", servidor.serial.__file__)


if __name__ == "__main__":
    unittest.main()
