/**
 * Zero-dependency CLI argument parser.
 * Supports:
 *   - subcommands: `ag-doctor models list`
 *   - options:     --json, --verbose, --yes, --auto, -f, -n 10
 *   - positionals: anything not starting with `-`
 */
export interface ParsedArgs {
  command: string[];
  options: Record<string, string | boolean>;
  positional: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { command: [], options: {}, positional: [] };
  let inOptions = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (inOptions && a === '--') {
      inOptions = false;
      continue;
    }
    if (inOptions && a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        out.options[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          out.options[key] = next;
          i++;
        } else {
          out.options[key] = true;
        }
      }
      continue;
    }
    if (inOptions && a.startsWith('-') && a.length > 1) {
      // short flags (potentially combined like -nf)
      const flags = a.slice(1);
      for (let j = 0; j < flags.length; j++) {
        const f = flags[j];
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-') && j === flags.length - 1) {
          out.options[f] = next;
          i++;
        } else {
          out.options[f] = true;
        }
      }
      continue;
    }
    out.positional.push(a);
  }
  // First positional(s) form the subcommand
  out.command = out.positional.slice();
  out.positional = [];
  return out;
}

export function help(usage: string, description?: string): string {
  let s = usage;
  if (description) s = description + '\n\n' + s;
  return s;
}
