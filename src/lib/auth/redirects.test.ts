import { describe, expect, it } from "vitest";
import { authFallbackTarget, canonicalHost, resolveAppOrigin, safeNextPath } from "./redirects";

describe("safeNextPath", () => {
  it("accepts same-origin absolute paths", () => {
    expect(safeNextPath("/admin/reports?x=1")).toBe("/admin/reports?x=1");
  });
  it("rejects open redirects and auth endpoints", () => {
    expect(safeNextPath("//evil.com/x")).toBe("/admin");
    expect(safeNextPath("/\\evil.com")).toBe("/admin");
    expect(safeNextPath("https://evil.com")).toBe("/admin");
    expect(safeNextPath("/x?u=https://evil.com")).toBe("/admin");
    expect(safeNextPath("/auth/callback")).toBe("/admin");
    expect(safeNextPath("/admin/login")).toBe("/admin");
    expect(safeNextPath(null)).toBe("/admin");
    expect(safeNextPath("relative")).toBe("/admin");
  });
});

describe("resolveAppOrigin / canonicalHost", () => {
  it("uses the project production URL for production deployments regardless of the request host", () => {
    const i = { vercelEnv: "production", productionUrl: "tire-check-staging.vercel.app", requestHost: "tire-check-staging-team.vercel.app" };
    expect(resolveAppOrigin(i)).toBe("https://tire-check-staging.vercel.app");
    expect(canonicalHost(i)).toBe("tire-check-staging.vercel.app");
  });
  it("uses the request host for previews and local development", () => {
    expect(resolveAppOrigin({ vercelEnv: "preview", productionUrl: "x.vercel.app", requestHost: "pr-1.vercel.app", requestProto: "https" })).toBe("https://pr-1.vercel.app");
    expect(resolveAppOrigin({ requestHost: "localhost:3000" })).toBe("http://localhost:3000");
    expect(canonicalHost({ vercelEnv: "preview", productionUrl: "x.vercel.app" })).toBeNull();
  });
  it("prefers an explicit NEXT_PUBLIC_APP_URL", () => {
    expect(resolveAppOrigin({ configuredUrl: "https://tires.example.com/", vercelEnv: "production", productionUrl: "x.vercel.app" })).toBe("https://tires.example.com");
    expect(canonicalHost({ configuredUrl: "https://tires.example.com" })).toBe("tires.example.com");
  });
});

describe("authFallbackTarget", () => {
  it("routes a Site-URL fallback with a PKCE code into the callback on the same origin", () => {
    const t = authFallbackTarget(new URL("https://app.test/?code=abc"));
    expect(t).toBe("https://app.test/auth/callback?code=abc&next=%2Fadmin");
  });
  it("keeps the admin path as the destination and forwards GoTrue errors", () => {
    expect(authFallbackTarget(new URL("https://app.test/admin/reports?error_code=otp_expired&error_description=Link+expired"))).toBe(
      "https://app.test/auth/callback?error_code=otp_expired&error_description=Link+expired&next=%2Fadmin%2Freports",
    );
  });
  it("ignores unrelated requests", () => {
    expect(authFallbackTarget(new URL("https://app.test/"))).toBeNull();
    expect(authFallbackTarget(new URL("https://app.test/t/jgg?code=1"))).toBeNull();
    expect(authFallbackTarget(new URL("https://app.test/auth/callback?code=1"))).toBeNull();
    expect(authFallbackTarget(new URL("https://app.test/api/health?code=1"))).toBeNull();
  });
});
