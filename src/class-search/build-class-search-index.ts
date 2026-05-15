import fs from 'node:fs';
import type { ResolvedArtifact, ResolvedConfiguration, ResolvedModule } from '../resolvers/resolution-output.js';
import { isExternalJarArtifact } from '../extractor/class-source-types.js';
import { fqnToZipRelPaths } from '../extractor/fqn-paths.js';
import { readZipEntryUtf8 } from '../extractor/zip-entry.js';
import {
  buildJavaSourceSearchBlob,
  MAX_JAVA_SOURCE_BYTES_FOR_SEARCH,
} from './java-source-search-text.js';
import { listFqnsFromJarClassEntries } from './jar-class-fqns.js';
import { resolveInterprojectJavaAbsolutePath } from './interproject-java-path.js';
import { listFqnsFromInterprojectSources } from './interproject-source-fqns.js';
import {
  CLASS_SEARCH_INDEX_FORMAT_VERSION,
  type ClassSearchIndexEntry,
  type ClassSearchIndexFileV1,
} from './types.js';

export type BuildClassSearchIndexParams = {
  module: ResolvedModule;
  configuration: ResolvedConfiguration;
  includeTest: boolean;
  buildInputsDigest: string;
  resolutionFingerprint: string;
};

function simpleNameOf(fqn: string): string {
  const i = fqn.lastIndexOf('.');
  return i < 0 ? fqn : fqn.slice(i + 1);
}

function makeEntry(
  fqn: string,
  artifact: ResolvedArtifact,
  resolvedModuleName: string,
  configurationName: string,
  origin: ClassSearchIndexEntry['origin'],
  jarPath: string | null,
  moduleRoot: string | null,
  interprojectModuleName: string | null,
  sourceSearchBlob: string | null,
): ClassSearchIndexEntry {
  const simple = simpleNameOf(fqn);
  const base = `${fqn}\n${simple}`.toLowerCase();
  const searchText =
    sourceSearchBlob !== null && sourceSearchBlob.length > 0 ? `${base}\n${sourceSearchBlob}` : base;
  return {
    className: fqn,
    simpleName: simple,
    searchText,
    origin,
    group: artifact.group,
    name: artifact.name,
    version: artifact.version,
    resolvedModuleName,
    configurationName,
    jarPath,
    moduleRoot,
    interprojectModuleName,
  };
}

/**
 * Builds an in-memory index for one resolved module + configuration classpath.
 */
export function buildClassSearchIndex(
  params: BuildClassSearchIndexParams,
): { ok: true; file: ClassSearchIndexFileV1 } | { ok: false; message: string } {
  const { module, configuration, includeTest, buildInputsDigest, resolutionFingerprint } = params;
  const entries: ClassSearchIndexEntry[] = [];
  let skippedArtifacts = 0;
  let sourceEnrichedEntries = 0;

  for (const a of configuration.artifacts) {
    if (a.origin === 'local-file' || a.type === 'local-file') {
      skippedArtifacts += 1;
      continue;
    }

    if (isExternalJarArtifact(a)) {
      if (!a.jarPath) {
        skippedArtifacts += 1;
        continue;
      }
      const listed = listFqnsFromJarClassEntries(a.jarPath);
      if (!listed.ok) {
        skippedArtifacts += 1;
        continue;
      }
      for (const fqn of new Set(listed.fqns)) {
        let blob: string | null = null;
        if (a.sourcesJarPath !== null && a.sourcesJarPath.length > 0) {
          try {
            if (fs.existsSync(a.sourcesJarPath)) {
              const paths = fqnToZipRelPaths(fqn);
              if (paths.ok) {
                const z = readZipEntryUtf8(a.sourcesJarPath, paths.sourceRelPath);
                if (z.ok && z.text.length > 0) {
                  const b = buildJavaSourceSearchBlob(z.text, fqn);
                  if (b.length > 0) {
                    blob = b;
                  }
                }
              }
            }
          } catch {
            /* omit enrichment */
          }
        }
        if (blob !== null) {
          sourceEnrichedEntries += 1;
        }
        entries.push(
          makeEntry(fqn, a, module.name, configuration.name, 'external', a.jarPath, null, null, blob),
        );
      }
      continue;
    }

    if (a.origin === 'interproject' && a.interproject) {
      const root = a.interproject.modulePath;
      const listed = listFqnsFromInterprojectSources(root, includeTest);
      if (!listed.ok) {
        skippedArtifacts += 1;
        continue;
      }
      for (const fqn of new Set(listed.fqns)) {
        let blob: string | null = null;
        const abs = resolveInterprojectJavaAbsolutePath(root, fqn, includeTest);
        if (abs !== null) {
          try {
            const text = fs.readFileSync(abs, 'utf8');
            const b = buildJavaSourceSearchBlob(text, fqn);
            if (b.length > 0) {
              blob = b;
            }
          } catch {
            /* omit enrichment */
          }
        }
        if (blob !== null) {
          sourceEnrichedEntries += 1;
        }
        entries.push(
          makeEntry(
            fqn,
            a,
            module.name,
            configuration.name,
            'interproject',
            null,
            root,
            a.interproject.moduleName,
            blob,
          ),
        );
      }
      continue;
    }

    skippedArtifacts += 1;
  }

  const meta = {
    indexFormatVersion: CLASS_SEARCH_INDEX_FORMAT_VERSION,
    buildInputsDigest,
    resolutionFingerprint,
    moduleName: module.name,
    configurationName: configuration.name,
    includeTest,
    builtAt: new Date().toISOString(),
    entryCount: entries.length,
    skippedArtifacts,
    sourceEnrichedEntries,
    sourceEnrichmentBytesCap: MAX_JAVA_SOURCE_BYTES_FOR_SEARCH,
  };

  return {
    ok: true,
    file: { meta, entries },
  };
}
