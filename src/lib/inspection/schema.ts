import { z } from "zod";

/**
 * Wire format for submitting an inspection. Shared by the client (offline
 * outbox) and the server (validation). Photos are uploaded separately and
 * linked by clientPhotoId.
 */
export const damageSchema = z.enum(["none", "repairable", "non_repairable"]);
export const modeSchema = z.enum(["truck", "trailer", "truck_trailer"]);

export const aiSuggestionSchema = z.object({
    tread32: z.number().min(0).max(40).nullable().optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    defects: z.array(z.string()).optional(),
    quality: z.string().optional(),
    provider: z.string().optional(),
    accepted: z.boolean().optional(),
    photoId: z.string().optional(),
  });

export const tireSubmissionSchema = z.object({
  number: z.number().int().min(1).max(20),
  psi: z.number().min(0).max(200).nullable(),
  tread32: z.number().int().min(0).max(40).nullable(),
  damage: damageSchema,
  /** Design damage-type chip (air_loss, sidewall_cut, …). */
  damageType: z.string().max(40).nullable().optional(),
  tireMake: z.string().max(80).nullable().optional(),
  tireModel: z.string().max(80).nullable().optional(),
  tireSize: z.string().max(40).nullable().optional(),
  tireVariantId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  photoClientIds: z.array(z.string().uuid()).max(20).default([]),
  /** Spares only: explicit "No spare". */
  absent: z.boolean().optional().default(false),
  aiSuggestion: aiSuggestionSchema.nullable().optional(),
});

export const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().nullable().optional(),
  capturedAt: z.string().datetime({ offset: true }),
});

export const inspectionSubmissionSchema = z.object({
  clientDraftId: z.string().uuid(),
  mode: modeSchema,
  truckAssetId: z.string().uuid().nullable().optional(),
  trailerAssetId: z.string().uuid().nullable().optional(),
  odometer: z.number().min(0).max(9_999_999).nullable().optional(),
  hubometer: z.number().min(0).max(9_999_999).nullable().optional(),
  startedAt: z.string().datetime({ offset: true }).nullable().optional(),
  location: locationSchema.nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  tires: z.array(tireSubmissionSchema).max(20),
  client: z
    .object({ locale: z.string().max(8).optional(), userAgent: z.string().max(300).optional(), appVersion: z.string().max(40).optional() })
    .optional(),
});

export type TireSubmission = z.infer<typeof tireSubmissionSchema>;
export type InspectionSubmission = z.infer<typeof inspectionSubmissionSchema>;
export type InspectionLocation = z.infer<typeof locationSchema>;
