import { runImportCommand } from "./commands/import";

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const repoRoot = process.cwd();

  if (command === undefined || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  switch (command) {
    case "import":
      await runImportCommand(repoRoot, args);
      return;
    default:
      throw new Error(`Unknown fetch-assets command: ${command}`);
  }
}

function printHelp(): void {
  console.log(`Usage:
  npm run fetch-assets -- --help
  npm run fetch-assets import -- --pack <path> --invoice <path> [options]

Commands:
  import    Register a paid asset pack, copy safe files, and update assets/MANIFEST.json

Run "npm run fetch-assets import -- --help" for import options.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`fetch-assets failed: ${message}`);
  process.exitCode = 1;
});
