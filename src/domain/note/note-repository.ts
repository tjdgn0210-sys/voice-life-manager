import type { EntityId, ISODateTime } from '../common/primitives';
import type { Note } from './note';

/** Normal reads exclude soft-deleted rows. Writes accept full validated entities.
 * update preserves id/createdAt and never restores a deleted row.
 * update/softDelete return false when no live row matches; database errors propagate.
 * softDelete sets both deletedAt and updatedAt to the supplied timestamp.
 */
export interface NoteRepository {
  create(entity: Note): Promise<void>;
  findById(id: EntityId): Promise<Note | null>;
  listRecent(limit: number): Promise<Note[]>;
  update(entity: Note): Promise<boolean>;
  softDelete(id: EntityId, deletedAt: ISODateTime): Promise<boolean>;
}
