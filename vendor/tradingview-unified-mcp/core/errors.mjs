export class ToolError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.details = details;
  }
}

export function invariant(condition, code, message, details) {
  if (!condition) throw new ToolError(code, message, details);
}

export function checkAbort(signal) {
  if (signal?.aborted) throw new ToolError('CANCELLED', 'Operation cancelled. Reconcile any submitted write before retrying.');
}
