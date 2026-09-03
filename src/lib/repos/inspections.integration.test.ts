import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Database-backed checks of the submission rules (runs against the local
 * dev database when DATABASE_URL is available; skipped otherwise). CI
 * provisions the database with `npm run db:setup:local`.
 */
function loadEnv() {
  if (process.env.DATABASE_URL) return;
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
loadEnv();
const DB = process.env.DATABASE_URL;
/** Superuser connection to the SAME database as DATABASE_URL (PG_SUPER_URL may point at the maintenance db). */
const SUPER = (() => {
  if (!DB) return undefined;
  try {
    const target = new URL(DB);
    const su = new URL(process.env.PG_SUPER_URL ?? DB.replace(/\/\/[^@]+@/, "//postgres@"));
    su.pathname = target.pathname;
    return su.toString();
  } catch {
    return undefined;
  }
})();

describe.skipIf(!DB)("inspection submission rules (database)", () => {
  let sql: postgres.Sql;
  let tenantId: string;
  let driverId: string;
  let truckId: string;
  let trailerId: string;
  const uuid = () => crypto.randomUUID();

  beforeAll(async () => {
    process.env.LOCAL_STORAGE_DIR ??= ".data/test-storage";
    sql = postgres(SUPER!, { max: 1, onnotice: () => {} });
    const [t] = await sql<{ id: string }[]>`select id from tenants where slug = 'jgg'`;
    tenantId = t.id;
    const [d] = await sql<{ id: string }[]>`select id from drivers where tenant_id = ${tenantId} and phone = '5550000001'`;
    driverId = d.id;
    const [tr] = await sql<{ id: string }[]>`select id from assets where tenant_id = ${tenantId} and type = 'truck' and unit_number = 'JGG-T101'`;
    truckId = tr.id;
    const [tl] = await sql<{ id: string }[]>`select id from assets where tenant_id = ${tenantId} and type = 'trailer' and unit_number = 'JGG-TR5301'`;
    trailerId = tl.id;
  });
  afterAll(async () => {
    await sql?.end();
  });

  const scope = () => ({ actor: "driver" as const, tenantId, driverId });
  const meta = { driverName: "Test", ip: null };
  interface TireInput { key: string; number: number; psi: number | null; tread32: number | null; damage: "none" | "repairable" | "non_repairable"; photoClientIds: string[]; absent: boolean; tireMake?: string; tireModel?: string; tireSize?: string }
  const truckTires = (opts: { tire3?: Partial<TireInput> } = {}): TireInput[] => {
    const keys = ["steer:L", "steer:R", "drive-1:LO", "drive-1:LI", "drive-1:RI", "drive-1:RO", "drive-2:LO", "drive-2:LI", "drive-2:RI", "drive-2:RO"];
    return keys.map((k, i) => ({ key: `truck/${k}`, number: i + 1, psi: i < 2 ? 108 : 102, tread32: 12, damage: "none" as const, photoClientIds: [] as string[], absent: false, ...(i === 2 ? opts.tire3 : {}) }));
  };
  const submission = (tires: TireInput[], extra: Record<string, unknown> = {}) => ({
    schemaVersion: 2 as const,
    clientDraftId: uuid(),
    components: [{ slot: "truck" as const, kind: "truck" as const, assetId: truckId, configurationId: null, extraSpares: 0 }],
    odometer: 120000,
    tires,
    ...extra,
  });

  it("a direct API submission cannot skip a policy-required photo", async () => {
    const { createInspection, SubmissionRejected } = await import("./inspections");
    // Red tread on tire 3, no photo claimed → rejected with the exact reason.
    await expect(createInspection(scope(), submission(truckTires({ tire3: { tread32: 2 } })), meta)).rejects.toMatchObject({ code: "not_ready" });
    try {
      await createInspection(scope(), submission(truckTires({ tire3: { tread32: 2 } })), meta);
    } catch (e) {
      expect(e).toBeInstanceOf(SubmissionRejected);
      expect((e as InstanceType<typeof SubmissionRejected>).issues).toContainEqual({ kind: "photo_required", tire: 3 });
    }
    // Claiming a photo id without uploading it does not complete the inspection: it stays pending until the photo arrives.
    const photoId = uuid();
    const r = await createInspection(scope(), submission(truckTires({ tire3: { tread32: 2, photoClientIds: [photoId] } })), meta);
    expect(r.created).toBe(true);
    expect(r.requiredPhotosMissing).toBe(1);
    const [row] = await sql<{ status: string; required_photos_missing: number; completed_at: string | null }[]>`select status, required_photos_missing, completed_at from inspections where id = ${r.inspectionId}`;
    expect(row).toMatchObject({ status: "pending_photos", required_photos_missing: 1, completed_at: null });
    const { addPhoto } = await import("./inspections");
    const res = await addPhoto(scope(), { inspectionId: r.inspectionId, tireNumber: 3, clientPhotoId: photoId, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), contentType: "image/jpeg" });
    expect(res.requiredPhotosMissing).toBe(0);
    const [after] = await sql<{ status: string; completed_at: string | null }[]>`select status, completed_at from inspections where id = ${r.inspectionId}`;
    expect(after.status).toBe("submitted");
    expect(after.completed_at).not.toBeNull();
  });

  it("odometer, missing readings and unknown positions are rejected server side", async () => {
    const { createInspection } = await import("./inspections");
    await expect(createInspection(scope(), submission(truckTires(), { odometer: null }), meta)).rejects.toMatchObject({ code: "not_ready", issues: [{ kind: "odometer_required", slot: "truck" }] });
    await expect(createInspection(scope(), submission(truckTires().slice(0, 9)), meta)).rejects.toMatchObject({ code: "not_ready", issues: [{ kind: "tire_incomplete", tire: 10, missing: ["psi", "tread"] }] });
    await expect(createInspection(scope(), submission([...truckTires(), { key: "trailer/axle-1:LO", number: 11, psi: 100, tread32: 10, damage: "none", photoClientIds: [], absent: false }]), meta)).rejects.toMatchObject({ code: "validation" });
    // Spares are optional: an untouched spare never blocks; a touched one is validated.
    const ok = await createInspection(scope(), submission(truckTires()), meta);
    expect(ok.created).toBe(true);
    await expect(createInspection(scope(), submission([...truckTires(), { key: "truck/spare-1", number: 11, psi: null, tread32: null, damage: "repairable", photoClientIds: [], absent: false }]), meta)).rejects.toMatchObject({ code: "not_ready" });
  });

  it("tenant photo-policy override changes what the server requires", async () => {
    const { createInspection } = await import("./inspections");
    const { publishThresholdVersion } = await import("./admin/thresholds");
    const { DEFAULT_THRESHOLDS } = await import("@/lib/tires/thresholds");
    const [admin] = await sql<{ id: string }[]>`select id from users where email = 'admin@dev.local'`;
    // Tenant override: drive tires need a photo under 8/32 instead of the system default 5/32.
    const stricter = { ...DEFAULT_THRESHOLDS, photoPolicy: { ...DEFAULT_THRESHOLDS.photoPolicy, treadBelow32: { ...DEFAULT_THRESHOLDS.photoPolicy.treadBelow32, drive: 8 } } };
    await publishThresholdVersion({ actor: "admin", tenantId, userId: admin.id }, stricter, "test: photo under 8/32 on drives", "test");
    try {
      // 7/32 on a drive tire now requires a photo…
      await expect(createInspection(scope(), submission(truckTires({ tire3: { tread32: 7 } })), meta)).rejects.toMatchObject({ code: "not_ready" });
      // …while 9/32 passes.
      const r = await createInspection(scope(), submission(truckTires({ tire3: { tread32: 9 } })), meta);
      expect(r.requiredPhotosMissing).toBe(0);
      // Statutory floor: a tenant cannot publish a steer red limit below 4/32.
      const illegal = structuredClone(DEFAULT_THRESHOLDS);
      illegal.tread32.steer.redMax = 3;
      await expect(publishThresholdVersion({ actor: "admin", tenantId, userId: admin.id }, illegal, "illegal", "test")).rejects.toThrow(/statutory/);
    } finally {
      await publishThresholdVersion({ actor: "admin", tenantId, userId: admin.id }, DEFAULT_THRESHOLDS, "test: restore defaults", "test");
    }
  });

  it("physical tires carry forward, get replaced, and admins can move them with history", async () => {
    const { createInspection } = await import("./inspections");
    const { mountTire, setTireState } = await import("./tire-assets");
    const [trailerCheck] = await sql<{ id: string }[]>`select id from assets where id = ${trailerId}`;
    expect(trailerCheck).toBeTruthy();
    const tires = truckTires().map((t, i) => (i === 0 ? { ...t, tireMake: "Michelin", tireModel: "X Line", tireSize: "295/75R22.5" } : t));
    const first = await createInspection(scope(), submission(tires), meta);
    const [e1] = await sql<{ tire_asset_id: string | null }[]>`select tire_asset_id from tire_entries where inspection_id = ${first.inspectionId} and tire_number = 1`;
    expect(e1.tire_asset_id).toBeTruthy();
    const [ta] = await sql<{ state: string; current_asset_id: string; current_position_key: string; code: string }[]>`select state, current_asset_id, current_position_key, code from tire_assets where id = ${e1.tire_asset_id}`;
    expect(ta).toMatchObject({ state: "mounted", current_asset_id: truckId, current_position_key: "steer:L" });
    expect(ta.code).toMatch(/^T\d{6}$/);

    // Next inspection without any make/model input: the same physical tire is carried forward.
    const second = await createInspection(scope(), submission(truckTires()), meta);
    const [e2] = await sql<{ tire_asset_id: string | null }[]>`select tire_asset_id from tire_entries where inspection_id = ${second.inspectionId} and tire_number = 1`;
    expect(e2.tire_asset_id).toBe(e1.tire_asset_id);

    // A different tire reported at the position: the old one is unmounted, a new one mounted, history kept.
    const replaced = truckTires().map((t, i) => (i === 0 ? { ...t, tireMake: "Bridgestone", tireModel: "R284", tireSize: "295/75R22.5" } : t));
    const third = await createInspection(scope(), submission(replaced), meta);
    const [e3] = await sql<{ tire_asset_id: string | null }[]>`select tire_asset_id from tire_entries where inspection_id = ${third.inspectionId} and tire_number = 1`;
    expect(e3.tire_asset_id).not.toBe(e1.tire_asset_id);
    const [old] = await sql<{ state: string; current_asset_id: string | null }[]>`select state, current_asset_id from tire_assets where id = ${e1.tire_asset_id}`;
    expect(old).toMatchObject({ state: "unassigned", current_asset_id: null });
    const events = await sql<{ event_type: string }[]>`select event_type::text as event_type from tire_mount_events where tire_asset_id = ${e1.tire_asset_id} order by id`;
    expect(events.map((e) => e.event_type)).toEqual(["mount", "inspected", "inspected", "replace"]);

    // A driver may instead say the mounted tire's information was wrong: same tire, corrected data, history kept.
    const corrected = truckTires().map((t, i) => (i === 0 ? { ...t, tireMake: "Bridgestone", tireModel: "R284 Ecopia", tireSize: "295/75R22.5", tireAssetId: e3.tire_asset_id, identityAction: "correct" as const } : t));
    const fourth = await createInspection(scope(), submission(corrected), meta);
    const [e4] = await sql<{ tire_asset_id: string | null }[]>`select tire_asset_id from tire_entries where inspection_id = ${fourth.inspectionId} and tire_number = 1`;
    expect(e4.tire_asset_id).toBe(e3.tire_asset_id);
    const [fixed] = await sql<{ model: string | null; state: string }[]>`select model, state from tire_assets where id = ${e3.tire_asset_id}`;
    expect(fixed).toMatchObject({ model: "R284 Ecopia", state: "mounted" });
    const corrEvents = await sql<{ event_type: string }[]>`select event_type::text as event_type from tire_mount_events where tire_asset_id = ${e3.tire_asset_id} order by id`;
    expect(corrEvents.map((e) => e.event_type)).toEqual(["mount", "inspected", "correction", "inspected"]);

    // Admin moves the old tire to the trailer, then into storage with a named location, then marks it disposed; every step is history.
    const [admin] = await sql<{ id: string }[]>`select id from users where email = 'admin@dev.local'`;
    const adminScope = { actor: "admin" as const, tenantId, userId: admin.id };
    await mountTire(adminScope, { tireId: e1.tire_asset_id!, assetId: trailerId, positionKey: "axle-1:LO", isSpare: false }, "Admin");
    const [moved] = await sql<{ state: string; current_asset_id: string | null; current_position_key: string | null }[]>`select state, current_asset_id, current_position_key from tire_assets where id = ${e1.tire_asset_id}`;
    expect(moved).toMatchObject({ state: "mounted", current_asset_id: trailerId, current_position_key: "axle-1:LO" });
    await setTireState(adminScope, { tireId: e1.tire_asset_id!, state: "storage", storageLocation: "Chicago Yard" }, "Admin");
    const [stored] = await sql<{ state: string; storage_location: string | null; current_asset_id: string | null }[]>`select state, storage_location, current_asset_id from tire_assets where id = ${e1.tire_asset_id}`;
    expect(stored).toMatchObject({ state: "storage", storage_location: "Chicago Yard", current_asset_id: null });
    await setTireState(adminScope, { tireId: e1.tire_asset_id!, state: "disposed", note: "worn out" }, "Admin");
    const all = await sql<{ event_type: string; to_state: string | null }[]>`select event_type::text as event_type, to_state::text as to_state from tire_mount_events where tire_asset_id = ${e1.tire_asset_id} order by id`;
    // mount (first seen) · inspected ×2 · replace (driver) · mount on trailer (from unassigned) · unmount → storage · status → disposed
    expect(all.map((e) => e.event_type)).toEqual(["mount", "inspected", "inspected", "replace", "mount", "unmount", "status"]);
    expect(all.at(-1)).toMatchObject({ event_type: "status", to_state: "disposed" });
  });

  it("existing (legacy) inspections still load with the fixed 20-position layout", async () => {
    const { loadReport } = await import("./inspections");
    const [tv] = await sql<{ id: string }[]>`select id from threshold_versions where tenant_id is null and version = 1`;
    const [legacy] = await sql<{ id: string }[]>`insert into inspections (tenant_id, driver_id, mode, truck_asset_id, odometer, threshold_version_id, client_draft_id, status)
      values (${tenantId}, ${driverId}, 'truck', ${truckId}, 1000, ${tv.id}, ${uuid()}, 'submitted') returning id`;
    const legacyRows: [number, string, string][] = [[1, "L", "truck-steer"], [2, "R", "truck-steer"], [3, "LO", "truck-drive-1"], [4, "LI", "truck-drive-1"], [5, "RI", "truck-drive-1"], [6, "RO", "truck-drive-1"], [7, "LO", "truck-drive-2"], [8, "LI", "truck-drive-2"], [9, "RI", "truck-drive-2"], [10, "RO", "truck-drive-2"], [19, "SP", "truck-spare"]];
    for (const [n, code, axle] of legacyRows) {
      await sql`insert into tire_entries (tenant_id, inspection_id, asset_id, tire_number, position_code, axle_key, psi, tread_32nds, absent, psi_status, tread_status, overall_status)
        values (${tenantId}, ${legacy.id}, ${truckId}, ${n}, ${code}, ${axle}, ${n === 19 ? null : 100}, ${n === 19 ? null : 10}, ${n === 19}, 'green', 'green', 'green')`;
    }
    const report = await loadReport({ actor: "admin", tenantId }, legacy.id);
    expect(report).not.toBeNull();
    expect(report!.layout.positions.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 19]);
    expect(report!.layout.components[0]).toMatchObject({ slot: "truck", assetId: truckId, unitNumber: "JGG-T101", configVersion: null });
    expect(report!.tires.find((t) => t.tire_number === 19)?.absent).toBe(true);
    expect(report!.tires).toHaveLength(11);
  });
});
