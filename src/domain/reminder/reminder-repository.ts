import type { EntityId } from '../common/primitives';
import type { Reminder, ReminderTargetType } from './reminder';

/** Persists state only; never schedules OS notifications.
 * Target queries include all states, including cancellation, ordered by fireAt then id.
 * update preserves id/createdAt; false means not found, while database errors propagate.
 */
export interface ReminderRepository {
  create(entity: Reminder): Promise<void>;
  findById(id: EntityId): Promise<Reminder | null>;
  findByTarget(targetType: ReminderTargetType, targetId: EntityId): Promise<Reminder[]>;
  listScheduled(): Promise<Reminder[]>;
  update(entity: Reminder): Promise<boolean>;
}
