import { describe, expect, it } from "vitest";
import { generateSecret, otpauthUrl, totpCode, verifyTotp } from "./totp";

// Тестовый вектор RFC 6238: секрет «12345678901234567890», момент 59 с → 94287082 (8 цифр).
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("TOTP", () => {
  it("совпадает с тестовым вектором RFC 6238", () => {
    expect(totpCode(RFC_SECRET, 59_000, 8)).toBe("94287082");
    expect(totpCode(RFC_SECRET, 1111111109_000, 8)).toBe("07081804");
    expect(totpCode(RFC_SECRET, 59_000)).toBe("287082");
  });

  it("принимает код соседнего окна и отклоняет далёкий и неверный", () => {
    const t = 1_700_000_000_000;
    const code = totpCode(RFC_SECRET, t);
    expect(verifyTotp(RFC_SECRET, code, new Date(t))).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, new Date(t + 30_000))).toBe(true);
    expect(verifyTotp(RFC_SECRET, code, new Date(t + 120_000))).toBe(false);
    expect(verifyTotp(RFC_SECRET, "000000", new Date(t))).toBe(false);
    expect(verifyTotp(RFC_SECRET, "abc", new Date(t))).toBe(false);
  });

  it("генерирует секрет нужной длины и ссылку для приложения-аутентификатора", () => {
    expect(generateSecret()).toMatch(/^[A-Z2-7]{32}$/);
    const url = otpauthUrl(RFC_SECRET, "admin@sergek.ai", "Sergek.ai");
    expect(url).toBe(`otpauth://totp/Sergek.ai:admin%40sergek.ai?secret=${RFC_SECRET}&issuer=Sergek.ai`);
  });
});
