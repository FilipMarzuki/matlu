// globals.d.ts — minimal ambient declarations so the prototype typechecks
// under strict mode without pulling in @types/node (the brief wants zero deps).
// We only use a sliver of Node's globals; declare exactly that sliver.

declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

declare const process: {
  argv: string[];
};

// Minimal slices of the Node modules persist.ts uses, so the prototype
// typechecks without pulling in @types/node.
declare module "node:fs" {
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void;
  export function writeFileSync(path: string, data: string): void;
  export function readFileSync(path: string, encoding: "utf8"): string;
}
declare module "node:path" {
  export function join(...parts: string[]): string;
}
