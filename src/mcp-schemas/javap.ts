import * as z from 'zod';
import { artifactCoordinatesSchema } from './common.js';

export const javapParameterSchema = z.object({
  name: z.string().nullable(),
  typeDisplay: z.string(),
});

/** Full javap row or IDE-minimal row (source-first path omits bytecode-only fields). */
export const javapOverloadSchema = z.object({
  declarationLine: z.string(),
  javadoc: z.string().optional(),
  docsSource: z.literal('javadoc-jar').optional(),
  visibility: z.enum(['public', 'protected', 'package', 'private']),
  jvmDescriptor: z.string().optional(),
  genericSignature: z.string().nullable().optional(),
  returnTypeDisplay: z.string().nullable(),
  parameters: z.array(javapParameterSchema),
  thrownExceptions: z.array(z.string()),
  flagsLine: z.string().nullable().optional(),
});

export const classpathJarProvenanceSchema = z.object({
  kind: z.literal('classpathJar'),
  coordinates: artifactCoordinatesSchema,
  jarPath: z.string(),
});

export const interprojectBytecodeProvenanceSchema = z.object({
  kind: z.literal('interprojectBytecode'),
  coordinates: artifactCoordinatesSchema,
  moduleName: z.string(),
  moduleRoot: z.string(),
  classpathRoot: z.string(),
});

export const sourcesJarStructureProvenanceSchema = z.object({
  kind: z.literal('sourcesJar'),
  coordinates: artifactCoordinatesSchema,
  jarPath: z.string(),
});

export const interprojectSourceProvenanceSchema = z.object({
  kind: z.literal('interprojectSource'),
  coordinates: artifactCoordinatesSchema,
  moduleName: z.string(),
  moduleRoot: z.string(),
  absoluteSourcePath: z.string(),
  sourceRelativePath: z.string(),
});

export const classStructureProvenanceSchema = z.union([
  classpathJarProvenanceSchema,
  interprojectBytecodeProvenanceSchema,
  sourcesJarStructureProvenanceSchema,
  interprojectSourceProvenanceSchema,
]);
