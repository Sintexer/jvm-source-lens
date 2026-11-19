import * as z from 'zod';
import { artifactCoordinatesSchema, outcomeOnlySuccessSchema } from './common.js';
import { resolveDependenciesFailureSchema } from './resolution.js';

export const classSearchIndexMetaSchema = z.object({
  indexFormatVersion: z.literal(3),
  buildInputsDigest: z.string(),
  resolutionFingerprint: z.string(),
  moduleName: z.string(),
  configurationName: z.string(),
  includeTest: z.boolean(),
  builtAt: z.string(),
  entryCount: z.number(),
  skippedArtifacts: z.number(),
  sourceEnrichedEntries: z.number(),
  sourceEnrichmentBytesCap: z.number(),
});

export const searchClassesHitSchema = z
  .object({
    className: z.string(),
    libName: z.string(),
    simpleName: z.string().optional(),
    score: z.number().optional(),
    origin: z.enum(['external', 'interproject', 'local-file']).optional(),
    coordinates: artifactCoordinatesSchema.optional(),
    jarPath: z.string().nullable().optional(),
    moduleRoot: z.string().nullable().optional(),
    interprojectModuleName: z.string().nullable().optional(),
    moduleName: z.string().optional(),
    configurationName: z.string().optional(),
  })
  .passthrough();

export const mcpSearchClassesPayloadSchema = z.union([
  z.object({
    ok: z.literal(true),
    found: z.boolean(),
    querySucceeded: z.literal(true),
    ...outcomeOnlySuccessSchema,
    query: z.string(),
    limit: z.number(),
    totalMatches: z.number(),
    hitCount: z.number(),
    hits: z.array(searchClassesHitSchema),
    indexMeta: classSearchIndexMetaSchema.optional(),
  }),
  resolveDependenciesFailureSchema,
]);
