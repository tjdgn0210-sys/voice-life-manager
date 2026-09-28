import type { EntityId, ISODateTime } from '../common/primitives';
import type { Event } from './event';

/** Normal reads exclude soft-deleted rows. Writes accept full validated entities.
 * update preserves id/createdAt and never restores a deleted row.
 * update/softDelete return false when no live row matches; database errors propagate.
 * softDelete sets both deletedAt and updatedAt to the supplied timestamp.
 */
export interface EventRepository {
  create(entity: Event): Promise<void>;
  findById(id: EntityId): Promise<Event | null>;
  listUpcoming(): Promise<Event[]>;
  update(entity: Event): Promise<boolean>;
  softDelete(id: EntityId, deletedAt: ISODateTime): Promise<boolean>;
}
