import "server-only";
import { env } from "@/lib/env";
import type { PhotoAnalysisProvider } from "./types";

export type { PhotoAnalysisProvider, PhotoAnalysisRequest, PhotoAnalysisResult } from "./types";

/**
 * Provider registry. Phase 1 ships the contract and the endpoint; the vision
 * provider is wired in Phase 3. With no provider configured the endpoint
 * reports `available: false` and the UI simply shows no suggestion.
 */
export function photoAnalysisProvider(): PhotoAnalysisProvider | null {
  if (!env().ANTHROPIC_API_KEY) return null;
  return null; // Phase 3: return new AnthropicVisionProvider(env().ANTHROPIC_API_KEY)
}
