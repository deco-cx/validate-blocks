import { expandGlob } from "jsr:@std/fs";
import { ValidationError } from "./src/types.ts";
import { validateJsonFile } from "./src/validator.ts";
import {
  blockNameToFileName,
  fileNameToBlockName,
} from "./src/block-manager.ts";

function error(message: string) {
  console.error(message);
  Deno.exit(1);
}

if (!import.meta.main) {
  error("You should call this script using the CLI.");
}

async function main() {
  const hasDecoFolder = await Deno.stat(".deco").catch(() => false);
  if (!hasDecoFolder) {
    error("You should run this script from the root a Deco Site project.");
  }

  const allJsonEntries = await Array.fromAsync(
    expandGlob(".deco/blocks/**/*.json"),
  );

  console.log(`Validating ${allJsonEntries.length} JSON file(s)...\n`);

  const allErrors: ValidationError[] = [];
  const allUnresolvedResolveTypes: Array<{
    file: string;
    sectionPath: string;
    resolveType: string;
  }> = [];
  const allUsedSavedBlocks = new Set<string>();

  for (const entry of allJsonEntries) {
    const content = await Deno.readTextFile(entry.path);
    const result = await validateJsonFile(entry.path, content);
    allErrors.push(...result.errors);
    allUnresolvedResolveTypes.push(...result.unresolvedResolveTypes);
    result.usedSavedBlocks.forEach((block) => allUsedSavedBlocks.add(block));
  }

  const allSavedBlocks = new Set<string>();
  const encodedToBlockName = new Map<string, string>();

  for (const entry of allJsonEntries) {
    const fileName = entry.name.replace(".json", "");
    if (
      fileName.startsWith("pages-") ||
      fileName.includes("Preview") ||
      fileName.startsWith("redirect-")
    ) {
      continue;
    }
    try {
      const blockName = fileNameToBlockName(fileName);
      allSavedBlocks.add(blockName);
      encodedToBlockName.set(fileName, blockName);
    } catch {
      allSavedBlocks.add(fileName);
      encodedToBlockName.set(fileName, fileName);
    }
  }

  const usedButNotInList = Array.from(allUsedSavedBlocks).filter(
    (block) => !allSavedBlocks.has(block),
  );

  for (const usedBlock of usedButNotInList) {
    const encodedFileName = blockNameToFileName(usedBlock).replace(".json", "");

    const matchingEntry = allJsonEntries.find(
      (entry) => {
        const entryFileName = entry.name.replace(".json", "");
        return entryFileName === encodedFileName;
      },
    );

    if (matchingEntry) {
      const fileName = matchingEntry.name.replace(".json", "");
      if (
        !fileName.startsWith("pages-") &&
        !fileName.includes("Preview") &&
        !fileName.startsWith("redirect-")
      ) {
        allSavedBlocks.add(usedBlock);
      }
    } else {
      const expectedPath = `.deco/blocks/${blockNameToFileName(usedBlock)}`;
      try {
        await Deno.stat(expectedPath);
        const fileName = blockNameToFileName(usedBlock).replace(".json", "");
        if (
          !fileName.startsWith("pages-") &&
          !fileName.includes("Preview") &&
          !fileName.startsWith("redirect-")
        ) {
          allSavedBlocks.add(usedBlock);
        }
      } catch {
        continue;
      }
    }
  }

  const unusedSavedBlocks = Array.from(allSavedBlocks).filter(
    (block) => !allUsedSavedBlocks.has(block),
  );

  const hasErrors = allErrors.length > 0;
  const hasUnresolved = allUnresolvedResolveTypes.length > 0;
  const hasUnused = unusedSavedBlocks.length > 0;

  if (!hasErrors && !hasUnresolved && !hasUnused) {
    console.log("✅ All sections are configured correctly!");
    return;
  }

  if (hasErrors) {
    const totalIssues = allErrors.reduce((sum, e) => sum + e.errors.length, 0);
    console.log(
      `❌ Found ${allErrors.length} section(s) with error(s) (${totalIssues} issue(s) total):\n`,
    );

    const errorsByFile = new Map<string, ValidationError[]>();
    for (const error of allErrors) {
      const fileErrors = errorsByFile.get(error.file) || [];
      fileErrors.push(error);
      errorsByFile.set(error.file, fileErrors);
    }

    for (const [file, errors] of errorsByFile) {
      console.log(`📄 ${file}`);
      for (const error of errors) {
        console.log(`   └─ Section: ${error.resolveType}`);
        if (error.sectionPath) {
          console.log(`      Path: ${error.sectionPath}`);
        }
        for (const err of error.errors) {
          console.log(`      ⚠️  ${err}`);
        }
      }
      console.log();
    }
  }

  if (hasUnresolved) {
    console.log(
      `\n⚠️  Found ${allUnresolvedResolveTypes.length} unresolved resolveType(s):\n`,
    );

    const unresolvedByFile = new Map<
      string,
      Array<{ sectionPath: string; resolveType: string }>
    >();
    for (const unresolved of allUnresolvedResolveTypes) {
      const fileUnresolved = unresolvedByFile.get(unresolved.file) || [];
      fileUnresolved.push({
        sectionPath: unresolved.sectionPath,
        resolveType: unresolved.resolveType,
      });
      unresolvedByFile.set(unresolved.file, fileUnresolved);
    }

    for (const [file, unresolved] of unresolvedByFile) {
      console.log(`📄 ${file}`);
      for (const item of unresolved) {
        console.log(`   └─ ${item.resolveType}`);
        if (item.sectionPath) {
          console.log(`      Path: ${item.sectionPath}`);
        }
      }
      console.log();
    }
  }

  if (hasUnused) {
    console.log(
      `\n📦 Found ${unusedSavedBlocks.length} unused saved block(s):\n`,
    );
    for (const block of unusedSavedBlocks.sort()) {
      console.log(`   - ${block}`);
    }
    console.log();
  }
}

main();
