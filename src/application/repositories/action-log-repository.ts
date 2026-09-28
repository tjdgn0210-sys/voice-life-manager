import type { ActionLog } from '../proposals/action-log';

/** Append-only evidence; no update, replacement, upsert or deletion API.
 * Recent evidence is ordered by createdAt descending, then id.
 * Malformed stored evidence rejects the read instead of inventing a valid ActionLog.
 */
export interface ActionLogRepository {
  append(log: ActionLog): Promise<void>;
  findRecent(limit: number): Promise<ActionLog[]>;
}
