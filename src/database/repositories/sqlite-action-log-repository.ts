import type { ActionType } from '../../domain/action/action-type';
import type { ActionLog } from '../../application/proposals/action-log';
import type { ActionLogRepository } from '../../application/repositories/action-log-repository';
import type { ApplicationDatabase } from '../database';
import { assertQueryLimit } from './query-limit';

interface ActionLogRow {
  id: string;
  raw_input: string;
  proposal_json: string;
  validation_result_json: string | null;
  execution_result_json: string | null;
  created_at: string;
}

const actionTypes = {
  CREATE_TRANSACTION: true, UPDATE_TRANSACTION: true, DELETE_TRANSACTION: true,
  CREATE_TASK: true, UPDATE_TASK: true, COMPLETE_TASK: true, DELETE_TASK: true,
  CREATE_EVENT: true, UPDATE_EVENT: true, COMPLETE_EVENT: true, DELETE_EVENT: true,
  CREATE_NOTE: true, UPDATE_NOTE: true, DELETE_NOTE: true,
  CREATE_REMINDER: true, UPDATE_REMINDER: true, CANCEL_REMINDER: true,
} satisfies Record<ActionType, true>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function corrupt(id: string, field: string): never {
  // Do not include personal evidence contents in diagnostics.
  throw new Error(`Invalid ActionLog evidence: ${id} (${field})`);
}

function parseObject(text: string, id: string, field: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return corrupt(id, field); }
  if (!isObject(value) || typeof value.actionId !== 'string') return corrupt(id, field);
  return value;
}

/** Check evidence envelopes, not proposal payload validity or business rules.
 * A corrupt row rejects the entire read; callers can expose a recoverable read error.
 * Never skip evidence, invent defaults, or silently cast a missing discriminator.
 */
function fromRow(row: ActionLogRow): ActionLog {
  const proposal = parseObject(row.proposal_json, row.id, 'proposal');
  if (typeof proposal.type !== 'string' || !Object.hasOwn(actionTypes, proposal.type)
    || typeof proposal.sourceInput !== 'string'
    || typeof proposal.inputMethod !== 'string'
    || !['MANUAL', 'VOICE', 'TEXT'].includes(proposal.inputMethod)
    || !isStringArray(proposal.dependsOnActionIds) || !isObject(proposal.payload)) {
    return corrupt(row.id, 'proposal');
  }
  const validation = row.validation_result_json === null ? null
    : parseObject(row.validation_result_json, row.id, 'validationResult');
  if (validation) {
    if (validation.actionId !== proposal.actionId) return corrupt(row.id, 'validationResult.actionId');
    switch (validation.status) {
      case 'VALID': break;
      case 'REQUIRES_CONFIRMATION':
        if (typeof validation.reason !== 'string') return corrupt(row.id, 'validationResult.reason');
        break;
      case 'INVALID':
        if (typeof validation.errorCode !== 'string' || typeof validation.errorMessage !== 'string') return corrupt(row.id, 'validationResult.error');
        break;
      case 'NEEDS_CLARIFICATION':
        if (!Array.isArray(validation.clarifications) || !validation.clarifications.length
          || !validation.clarifications.every(item => isObject(item)
            && item.actionId === proposal.actionId && typeof item.field === 'string'
            && typeof item.question === 'string' && (item.reason === 'MISSING' || item.reason === 'AMBIGUOUS'))) {
          return corrupt(row.id, 'validationResult.clarifications');
        }
        break;
      default: return corrupt(row.id, 'validationResult.status');
    }
  }
  const execution = row.execution_result_json === null ? null
    : parseObject(row.execution_result_json, row.id, 'executionResult');
  if (execution) {
    if (execution.actionId !== proposal.actionId
      || !(execution.affectedEntityId === null || typeof execution.affectedEntityId === 'string')) {
      return corrupt(row.id, 'executionResult');
    }
    switch (execution.status) {
      case 'SUCCESS': case 'PENDING_CLARIFICATION': case 'PENDING_CONFIRMATION': break;
      case 'FAILED':
        if (typeof execution.errorCode !== 'string' || typeof execution.errorMessage !== 'string') return corrupt(row.id, 'executionResult.error');
        break;
      case 'SKIPPED_DEPENDENCY':
        if (!isStringArray(execution.blockedByActionIds) || !execution.blockedByActionIds.length) return corrupt(row.id, 'executionResult.dependencies');
        break;
      default: return corrupt(row.id, 'executionResult.status');
    }
  }
  return {
    id: row.id, rawInput: row.raw_input,
    // Action-specific payloads remain the responsibility of the future Validator.
    proposal: proposal as unknown as ActionLog['proposal'],
    validationResult: validation as unknown as ActionLog['validationResult'],
    executionResult: execution as unknown as ActionLog['executionResult'],
    createdAt: row.created_at,
  };
}

function serialize(value: object): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'undefined' || typeof item === 'function' || typeof item === 'symbol'
      || typeof item === 'bigint' || (typeof item === 'number' && !Number.isFinite(item))) {
      throw new TypeError('ActionLog evidence must be JSON-serializable without data loss.');
    }
    return item;
  });
}

export function createSqliteActionLogRepository(database: ApplicationDatabase): ActionLogRepository {
  return {
    async append(log) {
      await database.runAsync(
        'INSERT INTO action_logs (id, raw_input, proposal_json, validation_result_json, execution_result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        log.id, log.rawInput, serialize(log.proposal),
        log.validationResult === null ? null : serialize(log.validationResult),
        log.executionResult === null ? null : serialize(log.executionResult), log.createdAt,
      );
    },
    async findRecent(limit) {
      assertQueryLimit(limit);
      const rows = await database.getAllAsync<ActionLogRow>(
        'SELECT id, raw_input, proposal_json, validation_result_json, execution_result_json, created_at FROM action_logs ORDER BY created_at DESC, id ASC LIMIT ?', limit,
      );
      return rows.map(fromRow);
    },
  };
}
