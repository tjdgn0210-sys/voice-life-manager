import type { Task } from '../../domain/task/task';
import type { TaskRepository } from '../../domain/task/task-repository';
import type { ApplicationDatabase } from '../database';

interface TaskRow {
  id: string;
  title: string;
  due_at: string | null;
  status: Task['status'];
  completed_at: string | null;
  source_action_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function fromRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    dueAt: row.due_at,
    status: row.status,
    completedAt: row.completed_at,
    sourceActionId: row.source_action_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

/** Dated open tasks first, earliest dueAt first; undated tasks last. */
export function createSqliteTaskRepository(database: ApplicationDatabase): TaskRepository {
  return {
    async create(entity) {
      await database.runAsync(
        'INSERT INTO tasks (id, title, due_at, status, completed_at, source_action_id, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        entity.id, entity.title, entity.dueAt, entity.status, entity.completedAt, entity.sourceActionId, entity.createdAt, entity.updatedAt, entity.deletedAt,
      );
    },
    async findById(id) {
      const row = await database.getFirstAsync<TaskRow>(
        'SELECT id, title, due_at, status, completed_at, source_action_id, created_at, updated_at, deleted_at FROM tasks WHERE id = ? AND deleted_at IS NULL', id,
      );
      return row ? fromRow(row) : null;
    },
    async listActive() {
      const rows = await database.getAllAsync<TaskRow>(
        "SELECT id, title, due_at, status, completed_at, source_action_id, created_at, updated_at, deleted_at FROM tasks WHERE deleted_at IS NULL AND status = 'OPEN' ORDER BY due_at IS NULL, due_at ASC, id ASC",
      );
      return rows.map(fromRow);
    },
    async update(entity) {
      const result = await database.runAsync(
        'UPDATE tasks SET title = ?, due_at = ?, status = ?, completed_at = ?, source_action_id = ?, updated_at = ?, deleted_at = ? WHERE id = ? AND deleted_at IS NULL',
        entity.title, entity.dueAt, entity.status, entity.completedAt, entity.sourceActionId, entity.updatedAt, entity.deletedAt, entity.id,
      );
      return result.changes > 0;
    },
    async softDelete(id, deletedAt) {
      const result = await database.runAsync(
        'UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
        deletedAt, deletedAt, id,
      );
      return result.changes > 0;
    },
  };
}
