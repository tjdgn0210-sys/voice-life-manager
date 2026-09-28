import type { Event } from '../../domain/event/event';
import type { EventRepository } from '../../domain/event/event-repository';
import type { ApplicationDatabase } from '../database';

interface EventRow {
  id: string;
  title: string;
  time_kind: string;
  start_at: string | null;
  fuzzy_time: string | null;
  end_at: string | null;
  timezone: string;
  location: string | null;
  status: Event['status'];
  source_action_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function fromRow(row: EventRow): Event {
  const fields = {
    id: row.id,
    title: row.title,
    endAt: row.end_at,
    timezone: row.timezone,
    location: row.location,
    status: row.status,
    sourceActionId: row.source_action_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
  if (row.time_kind === 'EXACT' && typeof row.start_at === 'string' && row.fuzzy_time === null) {
    return { ...fields, kind: 'EXACT', startAt: row.start_at, fuzzyTime: null };
  }
  if (row.time_kind === 'FUZZY' && row.start_at === null && typeof row.fuzzy_time === 'string' && row.fuzzy_time.trim()) {
    return { ...fields, kind: 'FUZZY', startAt: null, fuzzyTime: row.fuzzy_time };
  }
  throw new Error(`Invalid persisted Event time shape: ${row.id}`);
}

/** UPCOMING is an explicit stored status; no clock-based lifecycle transitions. Fuzzy events sort last. */
export function createSqliteEventRepository(database: ApplicationDatabase): EventRepository {
  return {
    async create(entity) {
      await database.runAsync(
        'INSERT INTO events (id, title, time_kind, start_at, fuzzy_time, end_at, timezone, location, status, source_action_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        entity.id, entity.title, entity.kind, entity.startAt, entity.fuzzyTime, entity.endAt, entity.timezone, entity.location, entity.status, entity.sourceActionId, entity.createdAt, entity.updatedAt, entity.deletedAt,
      );
    },
    async findById(id) {
      const row = await database.getFirstAsync<EventRow>(
        'SELECT id, title, time_kind, start_at, fuzzy_time, end_at, timezone, location, status, source_action_id, created_at, updated_at, deleted_at FROM events WHERE id = ? AND deleted_at IS NULL', id,
      );
      return row ? fromRow(row) : null;
    },
    async listUpcoming() {
      const rows = await database.getAllAsync<EventRow>(
        "SELECT id, title, time_kind, start_at, fuzzy_time, end_at, timezone, location, status, source_action_id, created_at, updated_at, deleted_at FROM events WHERE deleted_at IS NULL AND status = 'UPCOMING' ORDER BY start_at IS NULL, start_at ASC, id ASC",
      );
      return rows.map(fromRow);
    },
    async update(entity) {
      const result = await database.runAsync(
        'UPDATE events SET title = ?, time_kind = ?, start_at = ?, fuzzy_time = ?, end_at = ?, timezone = ?, location = ?, status = ?, source_action_id = ?, updated_at = ?, deleted_at = ? WHERE id = ? AND deleted_at IS NULL',
        entity.title, entity.kind, entity.startAt, entity.fuzzyTime, entity.endAt, entity.timezone, entity.location, entity.status, entity.sourceActionId, entity.updatedAt, entity.deletedAt, entity.id,
      );
      return result.changes > 0;
    },
    async softDelete(id, deletedAt) {
      const result = await database.runAsync(
        'UPDATE events SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
        deletedAt, deletedAt, id,
      );
      return result.changes > 0;
    },
  };
}
