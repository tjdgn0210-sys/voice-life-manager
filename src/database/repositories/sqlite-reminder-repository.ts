import type { Reminder } from '../../domain/reminder/reminder';
import type { ReminderRepository } from '../../domain/reminder/reminder-repository';
import type { ApplicationDatabase } from '../database';

interface ReminderRow {
  id: string;
  target_type: Reminder['targetType'];
  target_id: string;
  fire_at: string | null;
  timezone: string;
  relative_offset_minutes: number | null;
  status: string;
  delivery_mode: Reminder['deliveryMode'];
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
}

function fromRow(row: ReminderRow): Reminder {
  const fields = {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    timezone: row.timezone,
    relativeOffsetMinutes: row.relative_offset_minutes,
    deliveryMode: row.delivery_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (typeof row.fire_at !== 'string') throw new Error(`Unresolved persisted Reminder: ${row.id}`);
  if (row.status === 'CANCELLED' && typeof row.cancelled_at === 'string') {
    return { ...fields, fireAt: row.fire_at, status: 'CANCELLED', cancelledAt: row.cancelled_at };
  }
  if ((row.status === 'REQUESTED' || row.status === 'PERMISSION_BLOCKED' || row.status === 'SCHEDULED') && row.cancelled_at === null) {
    return { ...fields, fireAt: row.fire_at, status: row.status, cancelledAt: null };
  }
  throw new Error(`Invalid persisted Reminder state: ${row.id}`);
}

/** Scheduled/target queries sort by fireAt; no OS side effects. */
export function createSqliteReminderRepository(database: ApplicationDatabase): ReminderRepository {
  return {
    async create(entity) {
      await database.runAsync(
        'INSERT INTO reminders (id, target_type, target_id, fire_at, timezone, relative_offset_minutes, status, delivery_mode, created_at, updated_at, cancelled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        entity.id, entity.targetType, entity.targetId, entity.fireAt, entity.timezone, entity.relativeOffsetMinutes, entity.status, entity.deliveryMode, entity.createdAt, entity.updatedAt, entity.cancelledAt,
      );
    },
    async findById(id) {
      const row = await database.getFirstAsync<ReminderRow>(
        'SELECT id, target_type, target_id, fire_at, timezone, relative_offset_minutes, status, delivery_mode, created_at, updated_at, cancelled_at FROM reminders WHERE id = ?', id,
      );
      return row ? fromRow(row) : null;
    },
    async listScheduled() {
      const rows = await database.getAllAsync<ReminderRow>(
        "SELECT id, target_type, target_id, fire_at, timezone, relative_offset_minutes, status, delivery_mode, created_at, updated_at, cancelled_at FROM reminders WHERE status = 'SCHEDULED' ORDER BY fire_at ASC, id ASC",
      );
      return rows.map(fromRow);
    },
    async findByTarget(targetType, targetId) {
      const rows = await database.getAllAsync<ReminderRow>(
        'SELECT id, target_type, target_id, fire_at, timezone, relative_offset_minutes, status, delivery_mode, created_at, updated_at, cancelled_at FROM reminders WHERE target_type = ? AND target_id = ? ORDER BY fire_at ASC, id ASC', targetType, targetId,
      );
      return rows.map(fromRow);
    },
    async update(entity) {
      const result = await database.runAsync(
        'UPDATE reminders SET target_type = ?, target_id = ?, fire_at = ?, timezone = ?, relative_offset_minutes = ?, status = ?, delivery_mode = ?, updated_at = ?, cancelled_at = ? WHERE id = ?',
        entity.targetType, entity.targetId, entity.fireAt, entity.timezone, entity.relativeOffsetMinutes, entity.status, entity.deliveryMode, entity.updatedAt, entity.cancelledAt, entity.id,
      );
      return result.changes > 0;
    },
  };
}
