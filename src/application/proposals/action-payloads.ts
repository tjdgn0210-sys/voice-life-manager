import type { CurrencyCode, EntityId, ISODateTime, Timezone } from '../../domain/common/primitives';
import type { EventStatus } from '../../domain/event/event';
import type { ReminderDeliveryMode, ReminderTargetType } from '../../domain/reminder/reminder';
import type { TaskStatus } from '../../domain/task/task';
import type { TransactionType } from '../../domain/transaction/transaction';

/** Null required values mean unresolved input, not permission to persist an invalid entity. */
export interface CreateTransactionPayload {
  transactionType: TransactionType | null;
  amount: number | null;
  currencyCode: CurrencyCode | null;
  category: string | null;
  memo: string | null;
  occurredAt: ISODateTime | null;
}

export interface CreateTaskPayload {
  title: string | null;
  dueAt: ISODateTime | null;
}

export interface CreateEventPayload {
  title: string | null;
  startAt: ISODateTime | null;
  endAt: ISODateTime | null;
  timezone: Timezone | null;
  fuzzyTime: string | null;
  location: string | null;
}

export interface CreateNotePayload {
  content: string | null;
  tags: string[];
}

export type ReminderTargetReference =
  | { kind: 'ENTITY'; targetType: ReminderTargetType; targetId: EntityId }
  | { kind: 'ACTION'; targetType: ReminderTargetType; actionId: EntityId };

export interface CreateReminderPayload {
  /** ACTION references must also appear in dependsOnActionIds. */
  target: ReminderTargetReference | null;
  fireAt: ISODateTime | null;
  timezone: Timezone | null;
  /** Signed offset from Event.startAt or Task.dueAt; requires a resolvable target time. */
  relativeOffsetMinutes: number | null;
  deliveryMode: ReminderDeliveryMode;
}

/** Omitted patch fields are unchanged; null explicitly clears or requests clarification.
 * Validators must reject empty patches and null for required persisted fields.
 * JSON producers must omit unchanged keys rather than write undefined.
 */
export interface UpdatePayload<T> {
  targetId: EntityId | null;
  changes: Partial<T>;
}

/** Null means the target still needs clarification; never infer a bulk deletion. */
export interface TargetPayload {
  targetId: EntityId | null;
}

export interface CompletePayload extends TargetPayload {
  completedAt: ISODateTime | null;
}

export interface ActionPayloadMap {
  CREATE_TRANSACTION: CreateTransactionPayload;
  UPDATE_TRANSACTION: UpdatePayload<CreateTransactionPayload>;
  DELETE_TRANSACTION: TargetPayload;
  CREATE_TASK: CreateTaskPayload;
  UPDATE_TASK: UpdatePayload<CreateTaskPayload & { status: TaskStatus; completedAt: ISODateTime | null }>;
  COMPLETE_TASK: CompletePayload;
  DELETE_TASK: TargetPayload;
  CREATE_EVENT: CreateEventPayload;
  UPDATE_EVENT: UpdatePayload<CreateEventPayload & { status: EventStatus }>;
  COMPLETE_EVENT: TargetPayload;
  DELETE_EVENT: TargetPayload;
  CREATE_NOTE: CreateNotePayload;
  UPDATE_NOTE: UpdatePayload<CreateNotePayload>;
  DELETE_NOTE: TargetPayload;
  CREATE_REMINDER: CreateReminderPayload;
  UPDATE_REMINDER: UpdatePayload<CreateReminderPayload>;
  CANCEL_REMINDER: TargetPayload;
}
