import "server-only";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

/**
 * Driver sessions: after a successful tenant-scoped phone match we issue a
 * signed, httpOnly cookie. No SMS/OTP (spec §2). 24h lifetime matches the
 * draft-resume window (spec §10).
 */
export const DRIVER_COOKIE = "tc_driver";
const TTL_SECONDS = 24 * 60 * 60;

export interface DriverSession {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  driverId: string;
  driverName: string;
  issuedAt: number;
  expiresAt: number;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(env().DRIVER_SESSION_SECRET);
}

export async function signDriverSession(input: Omit<DriverSession, "issuedAt" | "expiresAt">): Promise<{ token: string; session: DriverSession }> {
  const now = Math.floor(Date.now() / 1000);
  const session: DriverSession = { ...input, issuedAt: now, expiresAt: now + TTL_SECONDS };
  const token = await new SignJWT({
    tid: session.tenantId,
    ts: session.tenantSlug,
    tn: session.tenantName,
    did: session.driverId,
    dn: session.driverName,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.driverId)
    .setAudience("driver")
    .setIssuedAt(now)
    .setExpirationTime(session.expiresAt)
    .sign(secret());
  return { token, session };
}

export async function verifyDriverToken(token: string | undefined | null): Promise<DriverSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: "driver" });
    return {
      tenantId: String(payload.tid),
      tenantSlug: String(payload.ts),
      tenantName: String(payload.tn),
      driverId: String(payload.did),
      driverName: String(payload.dn),
      issuedAt: Number(payload.iat),
      expiresAt: Number(payload.exp),
    };
  } catch {
    return null;
  }
}

export function setDriverCookie(res: NextResponse, token: string) {
  res.cookies.set({
    name: DRIVER_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: env().NODE_ENV === "production",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export function clearDriverCookie(res: NextResponse) {
  res.cookies.set({ name: DRIVER_COOKIE, value: "", path: "/", maxAge: 0 });
}

/** For route handlers. */
export async function driverSessionFromRequest(req: NextRequest): Promise<DriverSession | null> {
  return verifyDriverToken(req.cookies.get(DRIVER_COOKIE)?.value);
}

/** For server components. */
export async function getDriverSession(): Promise<DriverSession | null> {
  const store = await cookies();
  return verifyDriverToken(store.get(DRIVER_COOKIE)?.value);
}
