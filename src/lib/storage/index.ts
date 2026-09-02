import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Photo/file storage behind a small interface so the app does not depend on
 * Supabase Storage specifically.
 *
 *  - SupabaseStorageProvider: production (private bucket, signed URLs).
 *  - LocalDiskStorageProvider: DEVELOPMENT ONLY fallback when Supabase is not
 *    configured. Files live under LOCAL_STORAGE_DIR and are served by
 *    /api/files with an HMAC-signed URL. Never use in production.
 */
export interface StorageProvider {
  readonly name: "supabase" | "local";
  put(objectPath: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(objectPath: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  signedUrl(objectPath: string, expiresInSeconds: number): Promise<string>;
}

class SupabaseStorageProvider implements StorageProvider {
  readonly name = "supabase" as const;
  private client;
  private bucket: string;
  constructor(url: string, serviceKey: string, bucket: string) {
    this.client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    this.bucket = bucket;
  }
  async put(objectPath: string, bytes: Uint8Array, contentType: string) {
    const { error } = await this.client.storage.from(this.bucket).upload(objectPath, bytes, { contentType, upsert: true });
    if (error) throw new Error(`storage upload failed: ${error.message}`);
  }
  async get(objectPath: string) {
    const { data, error } = await this.client.storage.from(this.bucket).download(objectPath);
    if (error || !data) return null;
    return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || "application/octet-stream" };
  }
  async signedUrl(objectPath: string, expiresInSeconds: number) {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(objectPath, expiresInSeconds);
    if (error || !data) throw new Error(`signed url failed: ${error?.message}`);
    return data.signedUrl;
  }
}

function sign(objectPath: string, exp: number): string {
  return createHmac("sha256", env().DRIVER_SESSION_SECRET).update(`${objectPath}:${exp}`).digest("hex");
}

export function verifyLocalSignature(objectPath: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const expected = sign(objectPath, exp);
  if (expected.length !== sig.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

class LocalDiskStorageProvider implements StorageProvider {
  readonly name = "local" as const;
  private root: string;
  constructor(root: string) {
    // Development-only provider; the dynamic path is intentional.
    this.root = path.resolve(/*turbopackIgnore: true*/ process.cwd(), root);
  }
  private resolve(objectPath: string) {
    const full = path.resolve(this.root, objectPath);
    if (!full.startsWith(this.root + path.sep)) throw new Error("invalid object path");
    return full;
  }
  async put(objectPath: string, bytes: Uint8Array, contentType: string) {
    const full = this.resolve(objectPath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
    await writeFile(`${full}.meta.json`, JSON.stringify({ contentType }));
  }
  async get(objectPath: string) {
    try {
      const full = this.resolve(objectPath);
      const bytes = await readFile(full);
      let contentType = "application/octet-stream";
      try {
        contentType = JSON.parse(await readFile(`${full}.meta.json`, "utf8")).contentType ?? contentType;
      } catch {
        /* no meta */
      }
      return { bytes: new Uint8Array(bytes), contentType };
    } catch {
      return null;
    }
  }
  async signedUrl(objectPath: string, expiresInSeconds: number) {
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return `/api/files/${objectPath}?exp=${exp}&sig=${sign(objectPath, exp)}`;
  }
}

let provider: StorageProvider | null = null;

export function storage(): StorageProvider {
  if (provider) return provider;
  const e = env();
  if (e.NEXT_PUBLIC_SUPABASE_URL && e.SUPABASE_SECRET_KEY) {
    provider = new SupabaseStorageProvider(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SECRET_KEY, e.SUPABASE_STORAGE_BUCKET);
  } else {
    if (e.NODE_ENV === "production") throw new Error("Supabase Storage is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY)");
    console.warn(`[storage] DEV MODE: Supabase Storage not configured – using local disk at ${e.LOCAL_STORAGE_DIR}`);
    provider = new LocalDiskStorageProvider(e.LOCAL_STORAGE_DIR);
  }
  return provider;
}
