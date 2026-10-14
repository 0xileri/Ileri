import { auditEvents } from '../db/schema';
import type { Db } from '../db';

export interface AuditInput {
  action: string;
  actorId?: string | null;
  communityId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** Records a sensitive action. Call it inside the same transaction as the change. */
export async function audit(db: Db, input: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    action: input.action,
    actorId: input.actorId ?? null,
    communityId: input.communityId ?? null,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata: input.metadata ?? {},
    ip: input.ip ?? null,
  });
}
