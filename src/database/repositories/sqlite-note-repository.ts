import type { Note } from '../../domain/note/note';
import type { NoteRepository } from '../../domain/note/note-repository';
import type { ApplicationDatabase } from '../database';
import { assertQueryLimit } from './query-limit';

interface NoteRow {
  id: string;
  content: string;
  tags_json: string;
  input_method: Note['inputMethod'];
  raw_input: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Corrupt JSON or a non-string array falls back to []; the stored value is not rewritten. */
function readTags(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((tag): tag is string => typeof tag === 'string')
      ? parsed : [];
  } catch {
    return [];
  }
}

function fromRow(row: NoteRow): Note {
  return {
    id: row.id,
    content: row.content,
    tags: readTags(row.tags_json),
    inputMethod: row.input_method,
    rawInput: row.raw_input,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/** Recent notes use createdAt, not last edit time. */
export function createSqliteNoteRepository(database: ApplicationDatabase): NoteRepository {
  return {
    async create(entity) {
      await database.runAsync(
        'INSERT INTO notes (id, content, tags_json, input_method, raw_input, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        entity.id, entity.content, JSON.stringify(entity.tags), entity.inputMethod, entity.rawInput, entity.createdAt, entity.updatedAt, entity.deletedAt,
      );
    },
    async findById(id) {
      const row = await database.getFirstAsync<NoteRow>(
        'SELECT id, content, tags_json, input_method, raw_input, created_at, updated_at, deleted_at FROM notes WHERE id = ? AND deleted_at IS NULL', id,
      );
      return row ? fromRow(row) : null;
    },
    async listRecent(limit) {
      assertQueryLimit(limit);
      const rows = await database.getAllAsync<NoteRow>(
        "SELECT id, content, tags_json, input_method, raw_input, created_at, updated_at, deleted_at FROM notes WHERE deleted_at IS NULL ORDER BY created_at DESC, id ASC LIMIT ?", limit,
      );
      return rows.map(fromRow);
    },
    async update(entity) {
      const result = await database.runAsync(
        'UPDATE notes SET content = ?, tags_json = ?, input_method = ?, raw_input = ?, updated_at = ?, deleted_at = ? WHERE id = ? AND deleted_at IS NULL',
        entity.content, JSON.stringify(entity.tags), entity.inputMethod, entity.rawInput, entity.updatedAt, entity.deletedAt, entity.id,
      );
      return result.changes > 0;
    },
    async softDelete(id, deletedAt) {
      const result = await database.runAsync(
        'UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
        deletedAt, deletedAt, id,
      );
      return result.changes > 0;
    },
  };
}
