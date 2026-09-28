import type { EntityId, ISODateTime } from '../common/primitives';

export type TaskStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED';

export interface Task {
  id: EntityId;
  title: string;
  dueAt: ISODateTime | null;
  status: TaskStatus;
  completedAt: ISODateTime | null;
  sourceActionId: EntityId;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt: ISODateTime | null;
}
