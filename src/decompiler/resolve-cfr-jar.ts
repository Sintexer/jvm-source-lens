import { getBundledResource } from '../bundled-resources.js';

/** Bundled CFR JAR path (P0: no env override; see ROADMAP P2). */
export function resolveCfrJarPath(): string {
  return getBundledResource('cfr.jar');
}
