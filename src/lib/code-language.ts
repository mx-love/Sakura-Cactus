const LANGUAGE_LABELS: Record<string, string> = {
  js: 'JavaScript', javascript: 'JavaScript', jsx: 'JSX',
  ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', shell: 'Shell',
  py: 'Python', python: 'Python', rb: 'Ruby', ruby: 'Ruby',
  yml: 'YAML', yaml: 'YAML', md: 'Markdown', markdown: 'Markdown',
  html: 'HTML', xml: 'XML', css: 'CSS', scss: 'SCSS',
  json: 'JSON', jsonc: 'JSONC', sql: 'SQL',
  cs: 'C#', csharp: 'C#', cpp: 'C++', 'c++': 'C++', c: 'C',
  rs: 'Rust', rust: 'Rust', go: 'Go', java: 'Java',
  ps1: 'PowerShell', powershell: 'PowerShell',
  text: 'Plain text', txt: 'Plain text', plaintext: 'Plain text'
};

export function getCodeLanguageLabel(classNames: Iterable<string>): string | null {
  for (const className of classNames) {
    if (!className.startsWith('language-')) continue;
    const language = className.slice('language-'.length).trim();
    const key = language.toLowerCase();
    if (language) return Object.hasOwn(LANGUAGE_LABELS, key) ? LANGUAGE_LABELS[key] : language;
  }
  return null;
}
