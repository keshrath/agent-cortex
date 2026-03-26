import { describe, it, expect } from 'vitest';
import { getConfig, getVersion } from '../src/types.js';

describe('getConfig', () => {
  it('returns a config object with memoryDir, claudeDir, and projectsDir', () => {
    const config = getConfig();
    expect(config).toHaveProperty('memoryDir');
    expect(config).toHaveProperty('claudeDir');
    expect(config).toHaveProperty('projectsDir');
    expect(typeof config.memoryDir).toBe('string');
    expect(typeof config.claudeDir).toBe('string');
    expect(typeof config.projectsDir).toBe('string');
  });

  it('projectsDir is under claudeDir', () => {
    const config = getConfig();
    expect(config.projectsDir).toContain(config.claudeDir);
  });
});

describe('getVersion', () => {
  it('returns a version string', () => {
    const version = getVersion();
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
  });

  it('returns a semver-like version', () => {
    const version = getVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('returns consistent value on repeated calls (cached)', () => {
    const v1 = getVersion();
    const v2 = getVersion();
    expect(v1).toBe(v2);
  });
});
