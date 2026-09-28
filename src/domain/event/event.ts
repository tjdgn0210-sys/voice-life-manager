import type { EntityId, ISODateTime, Timezone } from '../common/primitives';

/** Elapsed time makes an event PAST, never automatically COMPLETED. */
export type EventStatus = 'UPCOMING' | 'PAST' | 'COMPLETED' | 'CANCELLED';

/** Validator checks timestamp validity and non-empty fuzzy text before persistence. */
export type EventTime =
  | { kind: 'EXACT'; startAt: ISODateTime; fuzzyTime: null }
  | { kind: 'FUZZY'; startAt: null; fuzzyTime: string };

interface EventFields {
  id: EntityId;
  title: string;
  endAt: ISODateTime | null;
  timezone: Timezone;
  location: string | null;
  status: EventStatus;
  sourceActionId: EntityId;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt: ISODateTime | null;
}

/** Exactly one time mode; unresolved input remains an ActionProposal.
 * Validator checks endAt ordering and exact-time requirements for linked reminders.
 */
export type Event = EventFields & EventTime;
