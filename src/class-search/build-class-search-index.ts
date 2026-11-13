import fs from 'node:fs';
import type { ResolvedArtifact, ResolvedConfiguration, ResolvedModule } from '../resolvers/resolution-output.js';
import { isClasspathBinaryJarArtifact, isExternalJarArtifact } from '../extractor/class-source-types.js';
import { fqnToZipRelPaths } from '../extractor/fqn-paths.js';
import { readZipEntryUtf8 } from '../extractor/zip-entry.js';
import {
  buildJavaSourceSearchBlob,
  MAX_JAVA_SOURCE_BYTES_FOR_SEARCH,
} from './java-source-search-text.js';
import { listFqnsFromJarClassEntries } from './jar-class-fqns.js';
import { statKeyForJar, type JarFqnCacheFileV1 } from './jar-fqn-cache.js';
import {
  listFqnsFromInterprojectSources,
  type ListedInterprojectSource,
} from './interproject-source-fqns.js';
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
  /** Optional sidecar cache: updated when listing JAR FQNs; reused when mtime+size unchanged. */
  jarFqnCache?: JarFqnCacheFileV1;
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

  const appendSourceFiles = (
    files: readonly ListedInterprojectSource[],
    artifact: ResolvedArtifact,
    moduleRoot: string,
    interprojectModuleName: string,
  ): void => {
    const seen = new Set<string>();
    for (const file of files) {
      if (seen.has(file.fqn)) {
        continue;
      }
      seen.add(file.fqn);
      let blob: string | null = null;
      try {
        const text = fs.readFileSync(file.absolutePath, 'utf8');
        const b = buildJavaSourceSearchBlob(text, file.fqn);
        if (b.length > 0) {
          blob = b;
        }
      } catch {
        /* omit enrichment */
      }
      if (blob !== null) {
        sourceEnrichedEntries += 1;
      }
      entries.push(
        makeEntry(
          file.fqn,
          artifact,
          module.name,
          configuration.name,
          'interproject',
          null,
          moduleRoot,
          interprojectModuleName,
          blob,
        ),
      );
    }
  };

  const localListed = listFqnsFromInterprojectSources(module.path, includeTest);
  if (localListed.ok) {
    appendSourceFiles(
      localListed.files,
      {
        group: 'project',
        name: module.name,
        version: null,
        type: 'project',
        jarPath: null,
        sourcesJarPath: null,
        origin: 'interproject',
        direct: true,
        interproject: { moduleName: module.name, modulePath: module.path },
      },
      module.path,
      module.name,
    );
  }

  for (const a of configuration.artifacts) {
    if (isClasspathBinaryJarArtifact(a)) {
      if (!a.jarPath) {
        skippedArtifacts += 1;
        continue;
      }
      const jarPath = a.jarPath;
      const cache = params.jarFqnCache;
      const sk = statKeyForJar(jarPath);
      const cached = sk !== null && cache !== undefined ? cache.jars[jarPath] : undefined;
      let fqns: string[];
      if (cached !== undefined && cached.statKey === sk) {
        fqns = cached.fqns;
      } else {
        const listed = listFqnsFromJarClassEntries(jarPath);
        if (!listed.ok) {
          skippedArtifacts += 1;
          continue;
        }
        fqns = [...new Set(listed.fqns)];
        if (cache !== undefined && sk !== null) {
          cache.jars[jarPath] = { statKey: sk, fqns };
        }
      }
      const originTag: ClassSearchIndexEntry['origin'] = isExternalJarArtifact(a) ? 'external' : 'local-file';
      for (const fqn of fqns) {
        let blob: string | null = null;
        const sj = a.sourcesJarPath ?? null;
        if (sj !== null && sj.length > 0) {
          try {
            if (fs.existsSync(sj)) {
              const paths = fqnToZipRelPaths(fqn);
              if (paths.ok) {
                const z = readZipEntryUtf8(sj, paths.sourceRelPath);
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
          makeEntry(fqn, a, module.name, configuration.name, originTag, a.jarPath, null, null, blob),
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
      appendSourceFiles(listed.files, a, root, a.interproject.moduleName);
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
