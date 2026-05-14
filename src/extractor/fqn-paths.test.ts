import { describe, expect, test } from 'bun:test';
import { fqnToZipRelPaths } from './fqn-paths.js';

describe('fqnToZipRelPaths', () => {
  test('maps top-level class in default package', () => {
    const r = fqnToZipRelPaths('Foo');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sourceRelPath).toBe('Foo.java');
      expect(r.classRelPath).toBe('Foo.class');
    }
  });

  test('maps nested package', () => {
    const r = fqnToZipRelPaths('com.example.MyClass');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sourceRelPath).toBe('com/example/MyClass.java');
      expect(r.classRelPath).toBe('com/example/MyClass.class');
    }
  });

  test('maps inner class with $ in simple name', () => {
    const r = fqnToZipRelPaths('com.example.Outer$Inner');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sourceRelPath).toBe('com/example/Outer$Inner.java');
      expect(r.classRelPath).toBe('com/example/Outer$Inner.class');
    }
  });

  test('rejects empty', () => {
    const r = fqnToZipRelPaths('');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('INVALID_FQN');
    }
  });

  test('rejects trailing dot', () => {
    const r = fqnToZipRelPaths('com.example.');
    expect(r.ok).toBe(false);
  });

  test('rejects segment starting with digit', () => {
    const r = fqnToZipRelPaths('com.1bad.Name');
    expect(r.ok).toBe(false);
  });
});
