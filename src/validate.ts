/**
 * Input validation helpers for MCP tool arguments.
 */

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function requireString(args: Record<string, unknown>, key: string): string {
  const val = args[key];
  if (typeof val !== 'string' || val.trim().length === 0) {
    throw new ValidationError(`"${key}" is required and must be a non-empty string`);
  }
  return val.trim();
}

export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const val = args[key];
  if (val === undefined || val === null) return undefined;
  if (typeof val !== 'string') {
    throw new ValidationError(`"${key}" must be a string`);
  }
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function optionalNumber(
  args: Record<string, unknown>,
  key: string,
  opts: { min?: number; max?: number; defaultValue?: number } = {},
): number | undefined {
  const val = args[key];
  if (val === undefined || val === null) return opts.defaultValue;
  const num = typeof val === 'number' ? val : Number(val);
  if (isNaN(num)) {
    throw new ValidationError(`"${key}" must be a number`);
  }
  if (opts.min !== undefined && num < opts.min) {
    throw new ValidationError(`"${key}" must be >= ${opts.min}`);
  }
  if (opts.max !== undefined && num > opts.max) {
    throw new ValidationError(`"${key}" must be <= ${opts.max}`);
  }
  return num;
}

export function optionalBoolean(
  args: Record<string, unknown>,
  key: string,
  defaultValue?: boolean,
): boolean {
  const val = args[key];
  if (val === undefined || val === null) return defaultValue ?? false;
  if (typeof val === 'boolean') return val;
  if (val === 'true') return true;
  if (val === 'false') return false;
  throw new ValidationError(`"${key}" must be a boolean`);
}

export function requireEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const val = requireString(args, key);
  if (!allowed.includes(val as T)) {
    throw new ValidationError(`"${key}" must be one of: ${allowed.join(', ')}. Got: "${val}"`);
  }
  return val as T;
}

export function optionalEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  defaultValue?: T,
): T | undefined {
  const val = optionalString(args, key);
  if (val === undefined) return defaultValue;
  if (!allowed.includes(val as T)) {
    throw new ValidationError(`"${key}" must be one of: ${allowed.join(', ')}. Got: "${val}"`);
  }
  return val as T;
}

/**
 * Validate a filename: no path separators, no special traversal chars.
 */
export function validateFilename(name: string): string {
  if (/[/\\:]/.test(name)) {
    throw new ValidationError('Filename must not contain path separators');
  }
  if (name === '.' || name === '..' || name.startsWith('..')) {
    throw new ValidationError('Invalid filename');
  }
  if (name.length > 255) {
    throw new ValidationError('Filename too long (max 255 chars)');
  }
  return name;
}
