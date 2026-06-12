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
