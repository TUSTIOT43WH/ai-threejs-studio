/** Tolerate data-format notation, never execute code or reconstruct truncated geometry. */
export function parseModelingJson(content: string): unknown {
  let input = content.trim();
  // Some compatible reasoning endpoints include a completed thinking block in content.
  input = input.replace(/^<think>[\s\S]*?<\/think>\s*/i, '');
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\s*```$/i.exec(input);
  if (fence) input = fence[1]!.trim();

  let cleaned = '', quoted = false, escaped = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      cleaned += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; cleaned += char; continue; }
    if (char === '/' && input[i + 1] === '/') {
      while (i + 1 < input.length && input[i + 1] !== '\n') i++;
      cleaned += ' ';
      continue;
    }
    if (char === '/' && input[i + 1] === '*') {
      const end = input.indexOf('*/', i + 2);
      if (end === -1) throw new Error('Unclosed JSON comment');
      i = end + 1; cleaned += ' '; continue;
    }
    cleaned += char;
  }

  let normalized = '';
  quoted = false; escaped = false;
  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i]!;
    if (quoted) {
      normalized += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    if (char === ',') {
      let next = i + 1;
      while (/\s/.test(cleaned[next] ?? '') && next < cleaned.length) next++;
      if (cleaned[next] === '}' || cleaned[next] === ']') continue;
    }
    normalized += char;
  }
  return JSON.parse(normalized);
}
