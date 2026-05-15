import { describe, expect, test } from 'bun:test';
import {
  countJvmParameters,
  declaringSimpleName,
  extractClassMemberSection,
  parseJavapClassHeader,
  parseJavapFields,
  parseJavapVerboseAllMethods,
  parseJavapVerboseMethods,
  skipJvmType,
} from './javap-parse.js';

/** Trimmed real `javap -private -verbose java.io.Closeable` output (JDK 21+). */
const javapCloseableVerbose = `Classfile jrt:/java.base/java/io/Closeable.class
  Last modified 15 Jan 2026; size 208 bytes
  SHA-256 checksum 3552964866c644efb3c9ede5c10946d6360fe92ac0eede7fc1a5243c3a2fa41
  Compiled from "Closeable.java"
public interface java.io.Closeable extends java.lang.AutoCloseable
  minor version: 0
  major version: 69
  flags: (0x0601) ACC_PUBLIC, ACC_INTERFACE, ACC_ABSTRACT
  this_class: #1                          // java/io/Closeable
  super_class: #3                         // java/lang/Object
  interfaces: 1, fields: 0, methods: 1, attributes: 1
Constant pool:
   #1 = Class              #2             // java/io/Closeable
   #2 = Utf8               java/io/Closeable
   #3 = Class              #4             // java/lang/Object
   #4 = Utf8               java/lang/Object
   #5 = Class              #6             // java/lang/AutoCloseable
   #6 = Utf8               java/lang/AutoCloseable
   #7 = Utf8               close
   #8 = Utf8               ()V
   #9 = Utf8               Exceptions
  #10 = Class              #11            // java/io/IOException
  #11 = Utf8               java/io/IOException
  #12 = Utf8               SourceFile
  #13 = Utf8               Closeable.java
{
  public abstract void close() throws java.io.IOException;
    descriptor: ()V
    flags: (0x0401) ACC_PUBLIC, ACC_ABSTRACT
    Exceptions:
      throws java.io.IOException
}
SourceFile: "Closeable.java"
`;

const javapSubstringMinimal = `Classfile /tmp/example.jar
Compiled from "String.java"
public final class java.lang.String
  minor version: 0
Constant pool:
    #1 = Utf8 foo
{
  public java.lang.String substring(int);
    descriptor: (I)Ljava/lang/String;
    flags: (0x0001) ACC_PUBLIC
    Code:
      stack=1, locals=2, args_size=2
      LocalVariableTable:
        Start  Length  Slot  Name   Signature
            0      10     0  this   Ljava/lang/String;
            0      10     1 beginIndex   I

  public java.lang.String substring(int, int);
    descriptor: (II)Ljava/lang/String;
    flags: (0x0001) ACC_PUBLIC
    Code:
      stack=1, locals=3, args_size=3
}
SourceFile: "String.java"
`;

describe('declaringSimpleName', () => {
  test('nested package', () => {
    expect(declaringSimpleName('java.lang.String')).toBe('String');
  });

  test('inner class', () => {
    expect(declaringSimpleName('com.foo.Outer$Inner')).toBe('Inner');
  });
});

describe('skipJvmType / countJvmParameters', () => {
  test('counts reference and primitive parameters', () => {
    expect(countJvmParameters('(Ljava/lang/String;I)V')).toBe(2);
    expect(countJvmParameters('()V')).toBe(0);
  });

  test('skipJvmType advances arrays', () => {
    expect(skipJvmType('([I[I)V', 1)).toBe(3);
  });
});

describe('extractClassMemberSection', () => {
  test('extracts inner section before closing brace + SourceFile', () => {
    const inner = extractClassMemberSection(javapCloseableVerbose);
    expect(inner).toContain('public abstract void close()');
    expect(inner).not.toContain('SourceFile:');
  });

  test('returns null when malformed', () => {
    expect(extractClassMemberSection('no pool here')).toBeNull();
  });
});

describe('parseJavapVerboseMethods', () => {
  test('finds close() with checked exception', () => {
    const o = parseJavapVerboseMethods(javapCloseableVerbose, 'close', 'java.io.Closeable');
    expect(o).toHaveLength(1);
    const m = o[0];
    expect(m).toBeDefined();
    expect(m!.jvmDescriptor).toBe('()V');
    expect(m!.thrownExceptions).toEqual(['java.io.IOException']);
    expect(m!.visibility).toBe('public');
  });

  test('returns empty when method name missing', () => {
    expect(parseJavapVerboseMethods(javapCloseableVerbose, 'missing', 'java.io.Closeable')).toHaveLength(0);
  });

  test('collects multiple overloads', () => {
    const o = parseJavapVerboseMethods(javapSubstringMinimal, 'substring', 'java.lang.String');
    expect(o).toHaveLength(2);
    expect(o.map((x) => x.jvmDescriptor).sort()).toEqual(['(I)Ljava/lang/String;', '(II)Ljava/lang/String;']);
    const oneArg = o.find((x) => x.jvmDescriptor === '(I)Ljava/lang/String;');
    expect(oneArg?.parameters[0]?.name).toBe('beginIndex');
  });

  test('<init> matches constructor declaration', () => {
    const javapCtor = `Classfile x.jar
Constant pool:
  #1 = Utf8 x
{
  public java.lang.String(java.lang.String);
    descriptor: (Ljava/lang/String;)V
    flags: (0x0001) ACC_PUBLIC
    Code:
      stack=0, locals=0, args_size=0
}
SourceFile: "String.java"
`;
    const o = parseJavapVerboseMethods(javapCtor, '<init>', 'java.lang.String');
    expect(o).toHaveLength(1);
    const ctor = o[0];
    expect(ctor).toBeDefined();
    expect(ctor!.jvmDescriptor).toBe('(Ljava/lang/String;)V');
  });
});

describe('parseJavapClassHeader', () => {
  test('parses interface extends', () => {
    const h = parseJavapClassHeader(javapCloseableVerbose);
    expect(h).not.toBeNull();
    expect(h!.kind).toBe('interface');
    expect(h!.superClass).toBeNull();
    expect(h!.directInterfaces).toEqual(['java.lang.AutoCloseable']);
    expect(h!.typeParameterNames).toEqual([]);
  });

  test('parses class extends/implements', () => {
    const text = `Classfile /tmp/x.jar
Compiled from "X.java"
public class com.foo.X extends com.foo.Base implements java.io.Serializable, java.lang.Cloneable
  minor version: 0
  flags: (0x0021) ACC_PUBLIC, ACC_SUPER
Constant pool:
    #1 = Utf8 foo
{
}
SourceFile: "X.java"
`;
    const h = parseJavapClassHeader(text);
    expect(h).not.toBeNull();
    expect(h!.kind).toBe('class');
    expect(h!.superClass).toBe('com.foo.Base');
    expect(h!.directInterfaces).toEqual(['java.io.Serializable', 'java.lang.Cloneable']);
  });
});

describe('parseJavapVerboseAllMethods', () => {
  test('collects every non-synthetic method', () => {
    const all = parseJavapVerboseAllMethods(javapSubstringMinimal, 'java.lang.String', { includeStatic: true });
    expect(all.length).toBeGreaterThanOrEqual(2);
    const subs = all.filter((m) => m.jvmMethodName === 'substring');
    expect(subs.map((x) => x.jvmDescriptor).sort()).toEqual(['(I)Ljava/lang/String;', '(II)Ljava/lang/String;']);
  });
});

describe('parseJavapFields', () => {
  test('parses field block', () => {
    const javapWithField = `Classfile /tmp/c.jar
Compiled from "C.java"
public class com.example.C
  minor version: 0
  flags: (0x0021) ACC_PUBLIC, ACC_SUPER
Constant pool:
   #1 = Utf8 FOO
{
  private static final int FOO;
    descriptor: I
    flags: (0x001a) ACC_PRIVATE, ACC_STATIC, ACC_FINAL

  public void run();
    descriptor: ()V
    flags: (0x0001) ACC_PUBLIC
}
SourceFile: "C.java"
`;
    const fields = parseJavapFields(javapWithField);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.declarationLine).toContain('FOO');
    expect(fields[0]!.visibility).toBe('private');
    expect(fields[0]!.jvmDescriptor).toBe('I');
  });
});