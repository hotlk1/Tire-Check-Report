/**
 * AI photo analysis contract (spec §9). Assistive only: results are shown as
 * suggestions the driver can accept or ignore and never overwrite a reading.
 * Designed to grow into DOT date reading / tire age alerts / defect detection.
 */
export interface PhotoAnalysisRequest {
  bytes: Uint8Array;
  contentType: string;
  context?: { tireNumber?: number; positionClass?: string };
}

export interface PhotoAnalysisResult {
  provider: string;
  /** Estimated remaining tread depth in 32nds of an inch, if visible. */
  tread32: number | null;
  /** 0–1 */
  confidence: number | null;
  /** Free-form defect labels, e.g. "sidewall cut", "irregular wear". */
  defects: string[];
  /** "good" | "blurry" | "dark" | "too_far" | "partial" */
  quality: string;
  /** Future: DOT code / manufacture week+year */
  dot?: { code: string | null; manufacturedWeek: number | null; manufacturedYear: number | null } | null;
  notes?: string | null;
  raw?: unknown;
}

export interface PhotoAnalysisProvider {
  readonly name: string;
  analyze(req: PhotoAnalysisRequest): Promise<PhotoAnalysisResult>;
}
