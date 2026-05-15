import { describe, expect, test } from 'bun:test';
import {
  buildJavapDeclaredAnnotationsIndex,
  lookupMethodDeclaredAnnotations,
  parseJavapMemberRuntimeVisibleAnnotations,
  parseJavapOuterClassRuntimeVisibleAnnotations,
} from './javap-runtime-visible-annotations.js';

const javapDeprecatedTrailer = `SourceFile: "Deprecated.java"
RuntimeVisibleAnnotations:
  0: #17()
    java.lang.annotation.Documented
  1: #18(#19=e#20.#21)
    java.lang.annotation.Retention(
      value=Ljava/lang/annotation/RetentionPolicy;.RUNTIME
    )
NestMembers:
  foo
`;

describe('parseJavapOuterClassRuntimeVisibleAnnotations', () => {
  test('parses trailer attributes after SourceFile', () => {
    const full = `Compiled from "Deprecated.java"
public interface java.lang.Deprecated
Constant pool:
{
}
${javapDeprecatedTrailer}`;
    const ann = parseJavapOuterClassRuntimeVisibleAnnotations(full);
    expect(ann.length).toBe(2);
    expect(ann[0]!.summary).toContain('java.lang.annotation.Documented');
    expect(ann[1]!.summary).toContain('java.lang.annotation.Retention');
    expect(ann[1]!.summary).toContain('RUNTIME');
  });
});

describe('parseJavapMemberRuntimeVisibleAnnotations', () => {
  test('parses method-level RuntimeVisibleAnnotations', () => {
    const block = `
  public final void stop();
    descriptor: ()V
    flags: (0x0011) ACC_PUBLIC, ACC_FINAL
    Deprecated: true
    RuntimeVisibleAnnotations:
      0: #671(#672=s#673,#674=Z#574)
        java.lang.Deprecated(
          since="1.2"
          forRemoval=true
        )
    Code:
      stack=2, locals=1, args_size=1
`;
    const ann = parseJavapMemberRuntimeVisibleAnnotations(block);
    expect(ann.length).toBe(1);
    expect(ann[0]!.summary).toContain('java.lang.Deprecated');
    expect(ann[0]!.summary).toContain('since=');
  });
});

describe('buildJavapDeclaredAnnotationsIndex', () => {
  test('indexes class and method annotations', () => {
    const javapText = `Classfile thread.jar
Compiled from "Thread.java"
public class java.lang.Thread
Constant pool:
{
  public final void stop();
    descriptor: ()V
    RuntimeVisibleAnnotations:
      0: #1()
        java.lang.Deprecated
}
SourceFile: "Thread.java"
`;
    const ix = buildJavapDeclaredAnnotationsIndex(javapText);
    expect(ix.classAnnotations.length).toBe(0);
    expect(ix.methodsByJvmDescriptor['()V']?.length).toBe(1);
    expect(ix.methodsByJvmDescriptor['()V']![0]!.summary).toContain('Deprecated');
    const hit = lookupMethodDeclaredAnnotations(ix, '()V', 'public final void stop();');
    expect(hit?.length).toBe(1);
  });
});
