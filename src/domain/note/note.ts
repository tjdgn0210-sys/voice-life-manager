import type { EntityId, InputMethod, ISODateTime } from '../common/primitives';

/** MVP fallback record; no dedicated Notes tab is required. */
export interface Note {
  id: EntityId;
  content: string;
  tags: string[];
  inputMethod: InputMethod;
  rawInput: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt: ISODateTime | null;
}
