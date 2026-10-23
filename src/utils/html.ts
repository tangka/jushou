export function compactListWhitespace(html: string): string {
  return html
    .replace(/<(ul|ol)([^>]*)>\s+(?=<li\b)/giu, (_match, tag: string, attrs: string) => `<${tag}${attrs}>`)
    .replace(/<\/li>\s+(?=<li\b)/giu, '</li>')
    .replace(/<\/li>\s+(?=<\/(?:ul|ol)>)/giu, '</li>');
}
