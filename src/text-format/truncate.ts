export function truncatePlainText(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen - 1)}…`;
}

export function firstJavadocParagraph(javadoc: string | null | undefined): string | null {
  if (javadoc == null || javadoc.trim().length === 0) {
    return null;
  }
  const para = javadoc.split(/\n\s*\n/)[0]?.trim() ?? javadoc.trim();
  return truncatePlainText(para.replace(/\s+/g, ' '), 400);
}

export function compactJavadoc(row: { javadoc?: string | null; docsSource?: 'javadoc-jar' }): string {
  if (!row.docsSource) return '';
  const summary = firstJavadocParagraph(row.javadoc);
  return summary ? `\n    ${summary} (${row.docsSource})` : '';
}
