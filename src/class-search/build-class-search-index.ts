import type { ResolvedArtifact, ResolvedConfiguration, ResolvedModule } from '../resolvers/resolution-output.js';
import { isExternalJarArtifact } from '../extractor/class-source-types.js';
import { listFqnsFromJarClassEntries } from './jar-class-fqns.js';
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
): ClassSearchIndexEntry {
  const simple = simpleNameOf(fqn);
  const searchText = `${fqn}\n${simple}`.toLowerCase();
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
        entries.push(
          makeEntry(fqn, a, module.name, configuration.name, 'external', a.jarPath, null, null),
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
        entries.push(
          makeEntry(fqn, a, module.name, configuration.name, 'interproject', null, root, a.interproject.moduleName),
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
  };

  return {
    ok: true,
    file: { meta, entries },
  };
}
