import { describe, expect, test } from 'bun:test';
import {
  applySourceExcerptWithInheritance,
  collectInheritedMethodBodies,
  type ResolveSupertypeFn,
  type SupertypeHeaderLike,
} from './inherited-method-excerpt.js';

type FakeSupertype = {
  source: string;
  superClass?: string | null;
  directInterfaces?: string[];
};

/** Builds a `ResolveSupertypeFn` over an in-memory FQN -> source/header map (no classpath access). */
function fakeHierarchyResolver(hierarchy: Record<string, FakeSupertype | undefined>): ResolveSupertypeFn {
  return async (fqn: string) => {
    const entry = hierarchy[fqn];
    if (!entry) {
      return { available: false };
    }
    return {
      available: true,
      source: entry.source,
      header: { superClass: entry.superClass ?? null, directInterfaces: entry.directInterfaces ?? [] },
    };
  };
}

const childSource = `
package q;

public class Child extends Parent {
  public void ownMethod() {
    System.out.println("own");
  }
}
`;

const parentSource = `
package q;

public class Parent {
  public void inheritedMethod() {
    System.out.println("parent");
  }
}
`;

const grandparentSource = `
package q;

public class Grandparent {
  public void deepMethod() {
    System.out.println("grandparent");
  }
}
`;

describe('collectInheritedMethodBodies', () => {
  test('finds a method body on the direct superclass', async () => {
    const resolver = fakeHierarchyResolver({ 'q.Parent': { source: parentSource } });
    const result = await collectInheritedMethodBodies({
      primaryHeader: { superClass: 'q.Parent', directInterfaces: [] },
      unmatchedMethodNames: ['inheritedMethod'],
      resolveSupertype: resolver,
    });
    expect(result.stillUnmatched).toEqual([]);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toEqual({
      methodName: 'inheritedMethod',
      declaringClass: 'q.Parent',
      body: expect.stringContaining('inheritedMethod'),
    });
  });

  test('walks two levels to a grandparent when the parent lacks the method', async () => {
    const resolver = fakeHierarchyResolver({
      'q.Parent': { source: parentSource, superClass: 'q.Grandparent' },
      'q.Grandparent': { source: grandparentSource },
    });
    const result = await collectInheritedMethodBodies({
      primaryHeader: { superClass: 'q.Parent', directInterfaces: [] },
      unmatchedMethodNames: ['deepMethod'],
      resolveSupertype: resolver,
    });
    expect(result.stillUnmatched).toEqual([]);
    expect(result.hits).toEqual([
      { methodName: 'deepMethod', declaringClass: 'q.Grandparent', body: expect.stringContaining('deepMethod') },
    ]);
  });

  test('walks interfaces as well as superclasses', async () => {
    const ifaceSource = `
package q;

public interface Face {
  default void faceMethod() {
    System.out.println("face");
  }
}
`;
    const resolver = fakeHierarchyResolver({ 'q.Face': { source: ifaceSource } });
    const result = await collectInheritedMethodBodies({
      primaryHeader: { superClass: null, directInterfaces: ['q.Face'] },
      unmatchedMethodNames: ['faceMethod'],
      resolveSupertype: resolver,
    });
    expect(result.hits.map((h) => h.declaringClass)).toEqual(['q.Face']);
  });

  test('skips supertypes without source but keeps walking through their header', async () => {
    const resolver: ResolveSupertypeFn = async (fqn: string) => {
      if (fqn === 'q.BytecodeOnlyParent') {
        // No source (e.g. JDK type or bytecode-only classpath owner) — header known via javap only.
        const header: SupertypeHeaderLike = { superClass: 'q.Grandparent', directInterfaces: [] };
        return { available: false, header };
      }
      if (fqn === 'q.Grandparent') {
        return { available: true, source: grandparentSource, header: { superClass: null, directInterfaces: [] } };
      }
      return { available: false };
    };
    const result = await collectInheritedMethodBodies({
      primaryHeader: { superClass: 'q.BytecodeOnlyParent', directInterfaces: [] },
      unmatchedMethodNames: ['deepMethod'],
      resolveSupertype: resolver,
    });
    expect(result.hits).toEqual([
      { methodName: 'deepMethod', declaringClass: 'q.Grandparent', body: expect.stringContaining('deepMethod') },
    ]);
  });

  test('respects the visit cap and reports it', async () => {
    // A long chain: A -> B -> C -> D -> ... none of them declare the method.
    const chainLength = 5;
    const hierarchy: Record<string, FakeSupertype> = {};
    for (let i = 0; i < chainLength; i++) {
      const name = `q.Level${i}`;
      const next = i + 1 < chainLength ? `q.Level${i + 1}` : null;
      hierarchy[name] = { source: `package q;\npublic class Level${i} {}\n`, superClass: next };
    }
    const resolver = fakeHierarchyResolver(hierarchy);
    const result = await collectInheritedMethodBodies({
      primaryHeader: { superClass: 'q.Level0', directInterfaces: [] },
      unmatchedMethodNames: ['neverFound'],
      resolveSupertype: resolver,
      maxVisits: 2,
    });
    expect(result.hits).toEqual([]);
    expect(result.stillUnmatched).toEqual(['neverFound']);
    expect(result.visitCapReached).toBe(true);
  });

  test('returns immediately when there is nothing unmatched', async () => {
    const resolver = fakeHierarchyResolver({});
    const result = await collectInheritedMethodBodies({
      primaryHeader: { superClass: 'q.Parent', directInterfaces: [] },
      unmatchedMethodNames: [],
      resolveSupertype: resolver,
    });
    expect(result).toEqual({ hits: [], stillUnmatched: [], visitCapReached: false });
  });
});

describe('applySourceExcerptWithInheritance', () => {
  test('includes the parent body and declaringClass when the primary CU lacks the method', async () => {
    const resolver = fakeHierarchyResolver({ 'q.Parent': { source: parentSource } });
    const result = await applySourceExcerptWithInheritance(
      childSource,
      'q.Child',
      true,
      { methodNames: ['ownMethod', 'inheritedMethod'] },
      resolver,
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !result.excerpt) {
      throw new Error('expected ok result with excerpt');
    }
    expect(result.excerpt.matchedMethodNames.sort()).toEqual(['inheritedMethod', 'ownMethod']);
    expect(result.excerpt.unmatchedMethodNames).toEqual([]);
    expect(result.excerpt.inheritedExcerpts).toEqual([{ methodName: 'inheritedMethod', declaringClass: 'q.Parent' }]);
    expect(result.source).toContain('ownMethod');
    expect(result.source).toContain('// declaringClass: q.Parent');
    expect(result.source).toContain('inheritedMethod');
  });

  test('succeeds via inheritance alone when the primary class matches nothing', async () => {
    const resolver = fakeHierarchyResolver({ 'q.Parent': { source: parentSource } });
    const result = await applySourceExcerptWithInheritance(
      childSource,
      'q.Child',
      true,
      { methodNames: ['inheritedMethod'] },
      resolver,
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !result.excerpt) {
      throw new Error('expected ok result with excerpt');
    }
    expect(result.excerpt.matchedMethodNames).toEqual(['inheritedMethod']);
    expect(result.excerpt.unmatchedMethodNames).toEqual([]);
    expect(result.excerpt.inheritedExcerpts).toEqual([{ methodName: 'inheritedMethod', declaringClass: 'q.Parent' }]);
    expect(result.source).toContain('// declaringClass: q.Parent');
    expect(result.source).toContain('inheritedMethod');
  });

  test('reports EXCERPT_NOT_FOUND mentioning the classpath walk when nothing matches anywhere', async () => {
    const resolver = fakeHierarchyResolver({ 'q.Parent': { source: parentSource } });
    const result = await applySourceExcerptWithInheritance(
      childSource,
      'q.Child',
      true,
      { methodNames: ['neverExists'] },
      resolver,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(result.error.code).toBe('EXCERPT_NOT_FOUND');
    expect(result.error.message).toContain('superclasses/interfaces on the classpath');
  });

  test('leaves remaining unmatched names when only some are found via inheritance', async () => {
    const resolver = fakeHierarchyResolver({ 'q.Parent': { source: parentSource } });
    const result = await applySourceExcerptWithInheritance(
      childSource,
      'q.Child',
      true,
      { methodNames: ['inheritedMethod', 'stillMissing'] },
      resolver,
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !result.excerpt) {
      throw new Error('expected ok result with excerpt');
    }
    expect(result.excerpt.matchedMethodNames).toEqual(['inheritedMethod']);
    expect(result.excerpt.unmatchedMethodNames).toEqual(['stillMissing']);
  });

  test('behaves like applySourceExcerpt when no resolver is provided', async () => {
    const result = await applySourceExcerptWithInheritance(
      childSource,
      'q.Child',
      true,
      { methodNames: ['ownMethod'] },
      undefined,
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !result.excerpt) {
      throw new Error('expected ok result with excerpt');
    }
    expect(result.excerpt.matchedMethodNames).toEqual(['ownMethod']);
    expect(result.excerpt.inheritedExcerpts).toBeUndefined();
  });

  test('does not attempt a walk for line-range-only requests', async () => {
    const resolver = fakeHierarchyResolver({ 'q.Parent': { source: parentSource } });
    const result = await applySourceExcerptWithInheritance(childSource, 'q.Child', true, { startLine: 2, endLine: 4 }, resolver);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.excerpt) {
      throw new Error('expected ok result with excerpt');
    }
    expect(result.excerpt.inheritedExcerpts).toBeUndefined();
  });
});
