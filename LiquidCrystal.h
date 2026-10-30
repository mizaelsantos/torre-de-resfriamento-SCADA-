#pragma once
#include <string>
struct LiquidCrystal {
  std::string row[2]; int r = 0, c = 0;
  LiquidCrystal(int, int, int, int, int, int) {}
  void begin(int, int) {}
  void clear() { row[0] = row[1] = std::string(16, ' '); }
  void setCursor(int col, int line) { c = col; r = line; if (row[r].size() < 16) row[r].resize(16, ' '); }
  void put(const std::string &s) { for (char ch : s) { if (c < 40) { if ((int)row[r].size() <= c) row[r].resize(c + 1, ' '); row[r][c++] = ch; } } }
  void print(const char *s) { put(s); }
  void print(char ch) { put(std::string(1, ch)); }
  void print(int v) { put(std::to_string(v)); }
  void print(float v, int p) { char b[32]; snprintf(b, sizeof b, "%.*f", p, v); put(b); }
};
