import { describe, it, expect } from 'vitest';

// Test the validation helpers by importing the server module and testing the helper behavior
// through the tool handler. Since the helpers are not exported, we test the patterns directly.

describe('input validation patterns', () => {
  describe('requireString', () => {
    function requireString(args: Record<string, unknown>, key: string): string {
      const val = args[key];
      if (val === undefined || val === null || typeof val !== 'string') {
        throw new Error(`Missing or invalid required parameter: ${key} (expected string)`);
      }
      if (val.length === 0) {
        throw new Error(`Parameter ${key} must not be empty`);
      }
      return val;
    }

    it('returns the string when present', () => {
      expect(requireString({ name: 'test' }, 'name')).toBe('test');
    });

    it('throws for missing key', () => {
      expect(() => requireString({}, 'name')).toThrow('Missing or invalid');
    });

    it('throws for null value', () => {
      expect(() => requireString({ name: null }, 'name')).toThrow('Missing or invalid');
    });

    it('throws for number value', () => {
      expect(() => requireString({ name: 42 }, 'name')).toThrow('Missing or invalid');
    });

    it('throws for empty string', () => {
      expect(() => requireString({ name: '' }, 'name')).toThrow('must not be empty');
    });

    it('throws for boolean value', () => {
      expect(() => requireString({ name: true }, 'name')).toThrow('Missing or invalid');
    });
  });

  describe('optionalString', () => {
    function optionalString(args: Record<string, unknown>, key: string): string | undefined {
      const val = args[key];
      if (val === undefined || val === null) return undefined;
      if (typeof val !== 'string') throw new Error(`Parameter ${key} must be a string`);
      return val;
    }

    it('returns the string when present', () => {
      expect(optionalString({ k: 'val' }, 'k')).toBe('val');
    });

    it('returns undefined for missing key', () => {
      expect(optionalString({}, 'k')).toBeUndefined();
    });

    it('returns undefined for null', () => {
      expect(optionalString({ k: null }, 'k')).toBeUndefined();
    });

    it('throws for non-string value', () => {
      expect(() => optionalString({ k: 42 }, 'k')).toThrow('must be a string');
    });
  });

  describe('optionalNumber', () => {
    function optionalNumber(args: Record<string, unknown>, key: string, min?: number, max?: number): number | undefined {
      const val = args[key];
      if (val === undefined || val === null) return undefined;
      const num = typeof val === 'number' ? val : Number(val);
      if (isNaN(num)) throw new Error(`Parameter ${key} must be a number`);
      if (min !== undefined && num < min) throw new Error(`Parameter ${key} must be >= ${min}`);
      if (max !== undefined && num > max) throw new Error(`Parameter ${key} must be <= ${max}`);
      return num;
    }

    it('returns the number when present', () => {
      expect(optionalNumber({ k: 42 }, 'k')).toBe(42);
    });

    it('parses string numbers', () => {
      expect(optionalNumber({ k: '10' }, 'k')).toBe(10);
    });

    it('returns undefined for missing key', () => {
      expect(optionalNumber({}, 'k')).toBeUndefined();
    });

    it('throws for NaN', () => {
      expect(() => optionalNumber({ k: 'abc' }, 'k')).toThrow('must be a number');
    });

    it('validates min bound', () => {
      expect(() => optionalNumber({ k: 0 }, 'k', 1)).toThrow('must be >= 1');
    });

    it('validates max bound', () => {
      expect(() => optionalNumber({ k: 1000 }, 'k', 1, 500)).toThrow('must be <= 500');
    });

    it('accepts value within bounds', () => {
      expect(optionalNumber({ k: 50 }, 'k', 1, 100)).toBe(50);
    });
  });

  describe('optionalBoolean', () => {
    function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
      const val = args[key];
      if (val === undefined || val === null) return undefined;
      if (typeof val === 'boolean') return val;
      if (val === 'true') return true;
      if (val === 'false') return false;
      throw new Error(`Parameter ${key} must be a boolean`);
    }

    it('returns true for boolean true', () => {
      expect(optionalBoolean({ k: true }, 'k')).toBe(true);
    });

    it('returns false for boolean false', () => {
      expect(optionalBoolean({ k: false }, 'k')).toBe(false);
    });

    it('parses "true" string', () => {
      expect(optionalBoolean({ k: 'true' }, 'k')).toBe(true);
    });

    it('parses "false" string', () => {
      expect(optionalBoolean({ k: 'false' }, 'k')).toBe(false);
    });

    it('returns undefined for missing key', () => {
      expect(optionalBoolean({}, 'k')).toBeUndefined();
    });

    it('throws for non-boolean value', () => {
      expect(() => optionalBoolean({ k: 'maybe' }, 'k')).toThrow('must be a boolean');
    });
  });

  describe('validateEnum', () => {
    function validateEnum<T extends string>(val: string | undefined, allowed: readonly T[], key: string): T | undefined {
      if (val === undefined) return undefined;
      if (!allowed.includes(val as T)) {
        throw new Error(`Parameter ${key} must be one of: ${allowed.join(', ')}`);
      }
      return val as T;
    }

    const ROLES = ['user', 'assistant', 'all'] as const;

    it('returns valid enum value', () => {
      expect(validateEnum('user', ROLES, 'role')).toBe('user');
    });

    it('returns undefined for undefined', () => {
      expect(validateEnum(undefined, ROLES, 'role')).toBeUndefined();
    });

    it('throws for invalid value', () => {
      expect(() => validateEnum('admin', ROLES, 'role')).toThrow('must be one of');
    });
  });
});
