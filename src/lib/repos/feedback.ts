import "server-only";
import { withScope, type Scope } from "@/lib/db/client";

export interface FeedbackInput {
  rating: number;
  message: string | null;
  page: string | null;
  appVersion: string | null;
  userAgent: string | null;
  locale: string | null;
}

/** Stores driver feedback for later admin review (never blocks an inspection). */
export async function createDriverFeedback(scope: Scope & { actor: "driver"; tenantId: string; driverId: string }, input: FeedbackInput): Promise<{ id: string }> {
  return withScope(scope, async (tx) => {
    const [row] = await tx<{ id: string }[]>`insert into driver_feedback (tenant_id, driver_id, rating, message, page, app_version, user_agent, locale)
      values (${scope.tenantId}, ${scope.driverId}, ${input.rating}, ${input.message}, ${input.page}, ${input.appVersion}, ${input.userAgent}, ${input.locale}) returning id`;
    return { id: row.id };
  });
}
