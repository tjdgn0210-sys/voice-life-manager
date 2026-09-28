import type { EntityId, ISODateTime } from '../common/primitives';
import type { Transaction } from './transaction';

/** Normal reads exclude soft-deleted rows. Writes accept full validated entities.
 * update preserves id/createdAt and never restores a deleted row.
 * update/softDelete return false when no live row matches; database errors propagate.
 * softDelete sets both deletedAt and updatedAt to the supplied timestamp.
 */
export interface TransactionRepository {
  create(entity: Transaction): Promise<void>;
  findById(id: EntityId): Promise<Transaction | null>;
  listRecent(limit: number): Promise<Transaction[]>;
  update(entity: Transaction): Promise<boolean>;
  softDelete(id: EntityId, deletedAt: ISODateTime): Promise<boolean>;
}
