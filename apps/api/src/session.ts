import { createHmac, timingSafeEqual } from "node:crypto";

export const STAFF_COOKIE = "sid_staff";
export const CLIENT_COOKIE = "sid_client";
export const STAFF_TTL_SEC = 12 * 3600;
export const CLIENT_TTL_SEC = 30 * 24 * 3600;

export type StaffRole = "owner" | "admin" | "master";

/**
 * Две независимые сессии под разными cookie: вход сотрудника никогда не даёт прав клиента
 * и наоборот. Подпись HMAC не позволяет подделать роль или клинику.
 */
export interface StaffSession {
  kind: "staff";
  salonId: string;
  userId: string;
  role: StaffRole;
  masterId: string | null;
  name: string;
  exp: number; // секунды Unix
}
export interface ClientSession {
  kind: "client";
  salonId: string;
  clientId: string;
  name: string;
  exp: number;
}
export type Session = StaffSession | ClientSession;

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");
const mac = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest();

export function signSession(session: Session, secret: string): string {
  const body = b64(JSON.stringify(session));
  return `${body}.${b64(mac(body, secret))}`;
}

export function verifySession(token: string | undefined, secret: string, now: Date): Session | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = mac(body, secret);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Session;
    return session.exp * 1000 > now.getTime() ? session : null;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function setCookie(name: string, value: string, maxAgeSec: number, secure: boolean): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
}
export const clearCookie = (name: string, secure: boolean) => setCookie(name, "", 0, secure);
