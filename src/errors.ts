/**
 * An expected, user-facing error (invalid move, missing token, unknown game).
 * The REST layer maps these to 400 responses and the MCP SDK turns thrown
 * errors into `isError: true` tool results.
 */
export class UserError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
