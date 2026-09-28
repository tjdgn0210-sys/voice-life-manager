import type { ActionType } from '../../domain/action/action-type';
import type { EntityId, ISODateTime } from '../../domain/common/primitives';

/** JSON-only data; producers must reject non-finite numbers. No Dates or class instances. */
export type ReversalValue =
  | string
  | number
  | boolean
  | null
  | ReversalValue[]
  | { [key: string]: ReversalValue };

export interface UndoRecord {
  undoId: EntityId;
  actionId: EntityId;
  actionType: ActionType;
  affectedEntityId: EntityId;
  /** Explicit deadline; manual expense composition currently supplies a 60-second window. */
  reversibleUntil: ISODateTime;
  /** Action-specific inverse data, e.g. prior values of only changed fields.
   * For creation, the action type and affectedEntityId may suffice (empty object).
   * Include only necessary restoration/conflict data and reminder scheduling changes;
   * do not routinely copy complete before/after entities.
   * The future Undo engine must validate this payload against actionType.
   */
  reversalData: { [key: string]: ReversalValue };
  /** Empty when none; IDs alone do not replace required reminder restoration data. */
  affectedReminderIds: EntityId[];
  createdAt: ISODateTime;
}
