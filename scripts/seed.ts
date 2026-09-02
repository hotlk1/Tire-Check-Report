/**
 * Seeds platform data. Safe to run repeatedly.
 *   npx tsx scripts/seed.ts [DATABASE_URL] [--dev]
 *
 * Always: initial tenants (JGG, ZSP, Atom) + system threshold version 1
 *         (taken from src/lib/tires/thresholds.ts so code and DB agree).
 * --dev:  sample drivers and assets for local development ONLY.
 */
import postgres from "postgres";
import { DEFAULT_THRESHOLDS } from "../src/lib/tires/thresholds";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--")) ?? process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
const dev = args.includes("--dev");
if (!url) {
  console.error("Usage: tsx scripts/seed.ts <DATABASE_URL> [--dev]");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

const TENANTS = [
  { slug: "jgg", name: "JGG" },
  { slug: "zsp", name: "ZSP" },
  { slug: "atom", name: "Atom" },
];

async function main() {
  await sql.begin(async (tx) => {
    // Seeding runs as the migration role (bypasses RLS); mark actor for clarity.
    await tx`select set_config('app.actor', 'super_admin', true)`;

    for (const t of TENANTS) {
      await tx`insert into tenants (slug, name) values (${t.slug}, ${t.name}) on conflict (slug) do nothing`;
    }

    const existing = await tx`select id from threshold_versions where tenant_id is null and version = 1`;
    if (existing.length === 0) {
      await tx`insert into threshold_versions (tenant_id, version, config, note)
               values (null, 1, ${tx.json(DEFAULT_THRESHOLDS as unknown as postgres.JSONValue)}, 'System default (spec §6/§7)')`;
      console.log("seeded system threshold version 1");
    }

    if (dev) {
      const tenants = await tx<{ id: string; slug: string }[]>`select id, slug from tenants`;
      for (const t of tenants) {
        const drivers = [
          { name: "Alex Driver", phone: "5550000001" },
          { name: "Maria Popescu", phone: "5550000002" },
          { name: "Inactive Person", phone: "5550000009", status: "inactive" },
        ];
        for (const d of drivers) {
          await tx`insert into drivers (tenant_id, full_name, phone, status)
                   values (${t.id}, ${d.name}, ${d.phone}, ${(d.status ?? "active") as "active" | "inactive"})
                   on conflict (tenant_id, phone) do nothing`;
        }
        const prefix = t.slug.toUpperCase();
        const trucks = ["101", "102", "103", "215", "220"].map((n) => `${prefix}-T${n}`);
        const trailers = ["5301", "5302", "5310", "5344"].map((n) => `${prefix}-TR${n}`);
        for (const u of trucks) {
          await tx`insert into assets (tenant_id, type, unit_number, make, model, year, source)
                   values (${t.id}, 'truck', ${u}, 'Freightliner', 'Cascadia', 2022, 'manual')
                   on conflict (tenant_id, type, unit_number) do nothing`;
        }
        for (const u of trailers) {
          await tx`insert into assets (tenant_id, type, unit_number, make, model, year, source)
                   values (${t.id}, 'trailer', ${u}, 'Utility', '3000R', 2021, 'manual')
                   on conflict (tenant_id, type, unit_number) do nothing`;
        }
      }
      console.log("seeded DEV drivers (phone 5550000001 / 5550000002) and assets for every tenant");
    }
  });
  console.log("seed complete");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
