import type { EntityId, ISODateTime, Timezone } from '../common/primitives';

export type ReminderTargetType = 'TASK' | 'EVENT';
/** MVP delivery intent, not a guarantee of precision or delivery. */
export type ReminderDeliveryMode = 'LOCAL';

/** Cancellation requires evidence of when it happened; other states are not cancelled. */
export type ReminderState =
  | { status: 'REQUESTED' | 'PERMISSION_BLOCKED' | 'SCHEDULED'; cancelledAt: null }
  | { status: 'CANCELLED'; cancelledAt: ISODateTime };

export type ReminderStatus = ReminderState['status'];

interface ReminderFields {
  id: EntityId;
  targetType: ReminderTargetType;
  targetId: EntityId;
  /** Resolved UTC time required in every persisted state, including SCHEDULED. */
  fireAt: ISODateTime;
  timezone: Timezone;
  /** Signed minutes from Event.startAt or Task.dueAt: -60 means one hour before. */
  relativeOffsetMinutes: number | null;
  deliveryMode: ReminderDeliveryMode;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Unresolved targets/times stay proposals or pending actions, never persisted reminders.
 * Validator must verify target existence, exact target time for relative reminders,
 * offset/fireAt consistency, valid timestamps, and scheduling capability.
 * SCHEDULED may only be recorded after successful scheduling; it does not prove delivery.
 */
export type Reminder = ReminderFields & ReminderState;
