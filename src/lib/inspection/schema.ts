import { z } from "zod";

/**
 * Wire format for submitting an inspection (schema 2: equipment components +
 * readings keyed by layout position). Shared by the client (offline outbox)
 * and the server (validation). Photos are uploaded separately and linked by
 * clientPhotoId.
 */
export const damageSchema = z.enum(["none", "repairable", "non_repairable"]);
export const componentSlotSchema = z.enum(["truck", "jeep", "trailer", "dolly", "booster", "trailer2"]);
export const componentKindSchema = z.enum(["truck", "trailer", "jeep", "dolly", "booster"]);

export const aiSuggestionSchema = z.object({
  tread32: z.number().min(0).max(40).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  defects: z.array(z.string()).optional(),
  quality: z.string().optional(),
  provider: z.string().optional(),
  accepted: z.boolean().optional(),
  photoId: z.string().optional(),
});

/** `slot/axleKey:ABBR` for wheels, `slot/spareKey` for spares. */
export const positionKeySchema = z.string().regex(/^[a-z0-9]+\/[a-z0-9-]{1,40}(:[A-Z]{1,2})?$/);

export const tireSubmissionSchema = z.object({
  key: positionKeySchema,
  number: z.number().int().min(1).max(200),
  psi: z.number().min(0).max(200).nullable(),
  tread32: z.number().int().min(0).max(40).nullable(),
  damage: damageSchema,
  /** Design damage-type chip (air_loss, sidewall_cut, …). */
  damageType: z.string().max(40).nullable().optional(),
  tireMake: z.string().max(80).nullable().optional(),
  tireModel: z.string().max(80).nullable().optional(),
  tireSize: z.string().max(40).nullable().optional(),
  tireVariantId: z.string().uuid().nullable().optional(),
  /** Physical tire the driver saw pre-filled for this position (kept when readings match a mounted tire). */
  tireAssetId: z.string().uuid().nullable().optional(),
  /** When brand/model/size differ from the mounted tire: the driver's answer to "is this a different physical tire?". */
  identityAction: z.enum(["replace", "correct"]).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  photoClientIds: z.array(z.string().uuid()).max(20).default([]),
  /** Legacy "No spare" flag; spares are optional now but old clients may still send it. */
  absent: z.boolean().optional().default(false),
  aiSuggestion: aiSuggestionSchema.nullable().optional(),
});

export const componentSubmissionSchema = z.object({
  slot: componentSlotSchema,
  kind: componentKindSchema,
  assetId: z.string().uuid(),
  /** Configuration version the client rendered; the server re-resolves and rejects a stale layout. */
  configurationId: z.string().uuid().nullable().optional(),
  /** Spare slots the driver added for this inspection beyond the configured ones. */
  extraSpares: z.number().int().min(0).max(6).optional().default(0),
});

export const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().nullable().optional(),
  capturedAt: z.string().datetime({ offset: true }),
});

export const inspectionSubmissionSchema = z.object({
  schemaVersion: z.literal(2),
  clientDraftId: z.string().uuid(),
  components: z.array(componentSubmissionSchema).min(1).max(6),
  odometer: z.number().min(0).max(9_999_999).nullable().optional(),
  hubometer: z.number().min(0).max(9_999_999).nullable().optional(),
  startedAt: z.string().datetime({ offset: true }).nullable().optional(),
  location: locationSchema.nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  tires: z.array(tireSubmissionSchema).max(200),
  client: z
    .object({ locale: z.string().max(8).optional(), userAgent: z.string().max(300).optional(), appVersion: z.string().max(40).optional() })
    .optional(),
});

export type TireSubmission = z.infer<typeof tireSubmissionSchema>;
export type ComponentSubmission = z.infer<typeof componentSubmissionSchema>;
export type InspectionSubmission = z.infer<typeof inspectionSubmissionSchema>;
export type InspectionLocation = z.infer<typeof locationSchema>;
