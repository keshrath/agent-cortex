import { describe, it, expect } from 'vitest';
import {
  requireString,
  optionalString,
  optionalNumber,
  optionalBoolean,
  requireEnum,
  optionalEnum,
  validateFilename,
  ValidationError,
} from '../src/validate.js';

describe('requireString', () => {
  it('returns trimmed string for valid input', () => {
    expect(requireString({ key: '  hello  ' }, 'key')).toBe('hello');
  });

  it('throws for missing key', () => {
    expect(() => requireString({}, 'key')).toThrow(ValidationError);
  });

  it('throws for null value', () => {
    expect(() => requireString({ key: null }, 'key')).toThrow(ValidationError);
  });

  it('throws for empty string', () => {
    expect(() => requireString({ key: '' }, 'key')).toThrow(ValidationError);
  });

  it('throws for whitespace-only string', () => {
    expect(() => requireString({ key: '   ' }, 'key')).toThrow(ValidationError);
  });

  it('throws for non-string value', () => {
    expect(() => requireString({ key: 42 }, 'key')).toThrow(ValidationError);
  });
});

describe('optionalString', () => {
  it('returns string when present', () => {
    expect(optionalString({ key: 'value' }, 'key')).toBe('value');
  });

  it('returns undefined for missing key', () => {
    expect(optionalString({}, 'key')).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(optionalString({ key: null }, 'key')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(optionalString({ key: '' }, 'key')).toBeUndefined();
  });

  it('throws for non-string value', () => {
    expect(() => optionalString({ key: 123 }, 'key')).toThrow(ValidationError);
  });
});

describe('optionalNumber', () => {
  it('returns number when present', () => {
    expect(optionalNumber({ key: 42 }, 'key')).toBe(42);
  });

  it('returns undefined for missing key', () => {
    expect(optionalNumber({}, 'key')).toBeUndefined();
  });

  it('returns default value when key is missing', () => {
    expect(optionalNumber({}, 'key', { defaultValue: 10 })).toBe(10);
  });

  it('converts string to number', () => {
    expect(optionalNumber({ key: '42' }, 'key')).toBe(42);
  });

  it('throws for NaN', () => {
    expect(() => optionalNumber({ key: 'abc' }, 'key')).toThrow(ValidationError);
  });

  it('throws when below minimum', () => {
    expect(() => optionalNumber({ key: 0 }, 'key', { min: 1 })).toThrow(ValidationError);
  });

  it('throws when above maximum', () => {
    expect(() => optionalNumber({ key: 1000 }, 'key', { max: 500 })).toThrow(ValidationError);
  });

  it('accepts value at min boundary', () => {
    expect(optionalNumber({ key: 1 }, 'key', { min: 1 })).toBe(1);
  });

  it('accepts value at max boundary', () => {
    expect(optionalNumber({ key: 500 }, 'key', { max: 500 })).toBe(500);
  });
});

describe('optionalBoolean', () => {
  it('returns boolean when present', () => {
    expect(optionalBoolean({ key: true }, 'key')).toBe(true);
    expect(optionalBoolean({ key: false }, 'key')).toBe(false);
  });

  it('returns default value for missing key', () => {
    expect(optionalBoolean({}, 'key', true)).toBe(true);
    expect(optionalBoolean({}, 'key', false)).toBe(false);
  });

  it('defaults to false when no default provided', () => {
    expect(optionalBoolean({}, 'key')).toBe(false);
  });

  it('parses string "true"', () => {
    expect(optionalBoolean({ key: 'true' }, 'key')).toBe(true);
  });

  it('parses string "false"', () => {
    expect(optionalBoolean({ key: 'false' }, 'key')).toBe(false);
  });

  it('throws for non-boolean string', () => {
    expect(() => optionalBoolean({ key: 'yes' }, 'key')).toThrow(ValidationError);
  });
});

describe('requireEnum', () => {
  const ALLOWED = ['a', 'b', 'c'] as const;

  it('returns value when it matches allowed list', () => {
    expect(requireEnum({ key: 'a' }, 'key', ALLOWED)).toBe('a');
  });

  it('throws for value not in allowed list', () => {
    expect(() => requireEnum({ key: 'z' }, 'key', ALLOWED)).toThrow(ValidationError);
  });

  it('throws for missing key', () => {
    expect(() => requireEnum({}, 'key', ALLOWED)).toThrow(ValidationError);
  });
});

describe('optionalEnum', () => {
  const ALLOWED = ['x', 'y', 'z'] as const;

  it('returns value when it matches', () => {
    expect(optionalEnum({ key: 'x' }, 'key', ALLOWED)).toBe('x');
  });

  it('returns undefined when key is missing', () => {
    expect(optionalEnum({}, 'key', ALLOWED)).toBeUndefined();
  });

  it('returns default when key is missing', () => {
    expect(optionalEnum({}, 'key', ALLOWED, 'y')).toBe('y');
  });

  it('throws for invalid value', () => {
    expect(() => optionalEnum({ key: 'invalid' }, 'key', ALLOWED)).toThrow(ValidationError);
  });
});

describe('validateFilename', () => {
  it('accepts valid filenames', () => {
    expect(validateFilename('my-file.md')).toBe('my-file.md');
    expect(validateFilename('test_file')).toBe('test_file');
  });

  it('rejects filenames with forward slash', () => {
    expect(() => validateFilename('path/to/file')).toThrow(ValidationError);
  });

  it('rejects filenames with backslash', () => {
    expect(() => validateFilename('path\\to\\file')).toThrow(ValidationError);
  });

  it('rejects filenames with colon', () => {
    expect(() => validateFilename('C:file')).toThrow(ValidationError);
  });

  it('rejects dot-dot traversal', () => {
    expect(() => validateFilename('..')).toThrow(ValidationError);
    expect(() => validateFilename('..evil')).toThrow(ValidationError);
  });

  it('rejects filenames longer than 255 chars', () => {
    expect(() => validateFilename('a'.repeat(256))).toThrow(ValidationError);
  });

  it('accepts filename at exactly 255 chars', () => {
    expect(validateFilename('a'.repeat(255))).toBe('a'.repeat(255));
  });

  it('accepts single dot filename', () => {
    expect(() => validateFilename('.')).toThrow(ValidationError);
  });
});

describe('ValidationError', () => {
  it('has correct name property', () => {
    const err = new ValidationError('test');
    expect(err.name).toBe('ValidationError');
    expect(err.message).toBe('test');
    expect(err instanceof Error).toBe(true);
  });
});
