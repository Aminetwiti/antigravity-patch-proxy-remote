/**
 * Interactive prompts — y/N confirmation, free-text input.
 * Reads from /dev/tty when available so it works under piped stdin.
 */
import readline from 'readline';
import fs from 'fs';

function getReader(): readline.Interface {
  // Prefer /dev/tty for interactive use even when stdin is piped
  const input = process.stdin.isTTY
    ? process.stdin
    : fs.existsSync('/dev/tty')
      ? fs.createReadStream('/dev/tty')
      : process.stdin;
  return readline.createInterface({ input, output: process.stdout });
}

export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = getReader();
    const suffix = defaultYes ? ' [Y/n] ' : ' [y/N] ';
    rl.question(question + suffix, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === '') resolve(defaultYes);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

export async function ask(question: string, defaultValue = ''): Promise<string> {
  return new Promise((resolve) => {
    const rl = getReader();
    const suffix = defaultValue ? ` [${defaultValue}] ` : ' ';
    rl.question(question + suffix, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  }
  );
}

export async function askSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = getReader();
    // Hide input by muting output
    const muted = (rl as unknown as { stdout: NodeJS.WritableStream & { write: (s: string) => boolean } });
    const origWrite = muted.stdout.write.bind(muted.stdout);
    muted.stdout.write = ((s: string) => {
      if (s.includes(question)) return origWrite(s);
      return origWrite('*'.repeat(s.length));
    }) as typeof muted.stdout.write;
    rl.question(question + ' ', (answer) => {
      muted.stdout.write = origWrite;
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}
