export function extractJsonFromText(text: string): any | null {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {}

  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const candidate = extractBalancedJson(text, open, close);
    if (candidate) {
      try {
        return JSON.parse(candidate);
      } catch {}
    }
  }

  return null;
}

function extractBalancedJson(
  text: string,
  open: string,
  close: string,
): string | null {
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const start = text.indexOf(open, searchFrom);
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;
    let balanced = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];

      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === open) depth++;
      else if (ch === close) depth--;

      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          balanced = true;
          break;
        }
      }
    }

    searchFrom = balanced ? start + 1 : text.length;
  }

  return null;
}

export function isValidJSON(jsonString: string): boolean {
  try {
    JSON.parse(jsonString);
    return true; // Parsing succeeded, it's valid JSON
  } catch {
    return false; // Parsing failed, it's not valid JSON
  }
}

export function safeParseJSON<T>(jsonString: string, defaultValue: T): T {
  try {
    return JSON.parse(jsonString) as T; // Attempt to parse and cast to type T
  } catch {
    return defaultValue; // Return defaultValue if parsing fails
  }
}

export function stringifyJSON(
  jsonObject: any,
  prettyPrint: boolean = false,
): string | null {
  try {
    if (prettyPrint) {
      return JSON.stringify(jsonObject, null, 2); // Pretty print with indentation of 2 spaces
    } else {
      return JSON.stringify(jsonObject);
    }
  } catch {
    return null; // Return null if stringification fails
  }
}
