import type { EntityId, ISODateTime } from '../common/primitives';
import type { Task } from './task';

/** Normal reads exclude soft-deleted rows. Writes accept full validated entities.
 * update preserves id/createdAt and never restores a deleted row.
 * update/softDelete return false when no live row matches; database errors propagate.
 * softDelete sets both deletedAt and updatedAt to the supplied timestamp.
 */
export interface TaskRepository {
  create(entity: Task): Promise<void>;
  findById(id: EntityId): Promise<Task | null>;
  listActive(): Promise<Task[]>;
  update(entity: Task): Promise<boolean>;
  softDelete(id: EntityId, deletedAt: ISODateTime): Promise<boolean>;
}
