import "server-only";
import { headers } from "next/headers";
import { resolveAppOrigin } from "./redirects";

/** Canonical origin for absolute URLs handed to third parties (magic links, QR codes). */
export async function appOrigin(): Promise<string> {
  const h = await headers();
  return resolveAppOrigin({
    vercelEnv: process.env.VERCEL_ENV,
    productionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    configuredUrl: process.env.NEXT_PUBLIC_APP_URL,
    requestHost: h.get("x-forwarded-host") ?? h.get("host"),
    requestProto: h.get("x-forwarded-proto"),
  });
}
