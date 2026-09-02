/**
 * Tire catalog provider abstraction.
 *
 * The application owns a normalized catalog (tire_brands → tire_models →
 * tire_variants). External catalogs (Tirelibrary, TyreAPI, manufacturer APIs)
 * plug in behind this interface and are *synced into* those tables keyed by
 * (provider, provider_external_id); the rest of the app never talks to a
 * vendor directly. Only the manual provider exists today.
 */
export type TireApplication = "steer" | "drive" | "trailer" | "all_position";
export type CatalogStatus = "active" | "discontinued";

export interface CatalogBrand {
  externalId: string;
  name: string;
  country?: string | null;
  website?: string | null;
  status?: CatalogStatus;
}

export interface CatalogModel {
  externalId: string;
  brandExternalId: string;
  name: string;
  application: TireApplication;
  category?: string | null;
  status?: CatalogStatus;
}

export interface CatalogVariant {
  externalId: string;
  modelExternalId: string;
  size: string;
  partNumber?: string | null;
  application: TireApplication;
  loadRange?: string | null;
  plyRating?: number | null;
  loadIndexSingle?: number | null;
  loadIndexDual?: number | null;
  speedRating?: string | null;
  maxColdPsi?: number | null;
  originalTread32nds?: number | null;
  rimSize?: string | null;
  status?: CatalogStatus;
  attributes?: Record<string, unknown>;
}

export interface CatalogSyncBatch {
  brands: CatalogBrand[];
  models: CatalogModel[];
  variants: CatalogVariant[];
}

export interface TireCatalogProvider {
  /** Stable key stored in the `provider` columns. */
  readonly name: string;
  /** Human label for the Integrations screen. */
  readonly label: string;
  /** Whether this provider can push records into the local catalog. */
  readonly supportsSync: boolean;
  /**
   * Pull the provider's catalog (optionally incrementally). Implementations
   * stream batches so a large vendor catalog does not need to fit in memory.
   */
  sync?(opts: { since?: Date | null; credentials?: Record<string, string> }): AsyncIterable<CatalogSyncBatch>;
}

/** The built-in provider: rows maintained by admins in the app. Nothing to sync. */
export const manualCatalogProvider: TireCatalogProvider = {
  name: "manual",
  label: "Manual (in-app)",
  supportsSync: false,
};

const registry: Record<string, TireCatalogProvider> = { manual: manualCatalogProvider };

export function registerCatalogProvider(p: TireCatalogProvider) {
  registry[p.name] = p;
}

export function catalogProvider(name: string): TireCatalogProvider | null {
  return registry[name] ?? null;
}

export function listCatalogProviders(): TireCatalogProvider[] {
  return Object.values(registry);
}
