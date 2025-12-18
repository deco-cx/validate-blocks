import { expandGlob } from "jsr:@std/fs";
import {
  blockNameToFileName,
  fileNameToBlockName,
  getSavedBlockContent,
} from "./src/block-manager.ts";
import { ValidationError } from "./src/types.ts";
import { validateJsonFile } from "./src/validator.ts";

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

function colorize(text: string, color: string): string {
  return `${color}${text}${colors.reset}`;
}

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

  // Parse command line arguments for --blocks flag and --verbose flag
  const targetBlocks = new Set<string>();
  const targetFileNames = new Set<string>();
  const targetPaths = new Set<string>();
  const isVerbose = Deno.args.includes("-v") || Deno.args.includes("--verbose");

  const blocksIndex = Deno.args.indexOf("--blocks");
  if (blocksIndex !== -1 && blocksIndex + 1 < Deno.args.length) {
    const blocksArg = Deno.args[blocksIndex + 1];
    const blockNames = blocksArg.split(",").map((b) => b.trim()).filter((b) =>
      b
    );

    for (const blockArg of blockNames) {
      // Check if it's a full path
      const isPath = blockArg.includes("/") || blockArg.startsWith(".");

      if (isPath) {
        // It's a path, normalize it
        let normalizedPath = blockArg;
        if (!normalizedPath.endsWith(".json")) {
          normalizedPath += ".json";
        }

        // Store the normalized path for matching
        targetPaths.add(normalizedPath);

        // Also extract the filename for block name matching
        const pathWithoutPrefix = normalizedPath.replace(
          /^\.deco\/blocks\//,
          "",
        );
        const fileNameFromPath =
          pathWithoutPrefix.split("/").pop()?.replace(/\.json$/, "") || "";

        if (fileNameFromPath) {
          targetFileNames.add(fileNameFromPath);
          try {
            const blockName = fileNameToBlockName(fileNameFromPath);
            targetBlocks.add(blockName);
          } catch {
            targetBlocks.add(fileNameFromPath);
          }
        }
      } else {
        // It's a block name or file name
        const cleanArg = blockArg.replace(/\.json$/, "");

        // Try to resolve as block name first
        try {
          const fileName = blockNameToFileName(cleanArg);
          targetFileNames.add(fileName);
          targetBlocks.add(cleanArg);
        } catch {
          // If it fails, treat as file name
          targetFileNames.add(cleanArg);
          try {
            const blockName = fileNameToBlockName(cleanArg);
            targetBlocks.add(blockName);
          } catch {
            targetBlocks.add(cleanArg);
          }
        }
      }
    }

    if (targetBlocks.size > 0 || targetPaths.size > 0) {
      const displayNames = Array.from(targetBlocks).length > 0
        ? Array.from(targetBlocks).join(", ")
        : Array.from(targetPaths).join(", ");
      console.log(
        colorize(
          `🔍 Validating ${
            targetBlocks.size || targetPaths.size
          } block(s): ${displayNames}\n`,
          colors.cyan + colors.bold,
        ),
      );
    }
  }

  const allJsonEntries = await Array.fromAsync(
    expandGlob(".deco/blocks/**/*.json"),
  );

  // Filter entries if specific blocks were requested
  let jsonEntries = allJsonEntries;
  if (targetBlocks.size > 0 || targetPaths.size > 0) {
    jsonEntries = allJsonEntries.filter((entry) => {
      const entryFileName = entry.name.replace(".json", "");
      const entryBlockName = (() => {
        try {
          return fileNameToBlockName(entryFileName);
        } catch {
          return entryFileName;
        }
      })();

      // Check if this entry matches any of the target paths
      if (targetPaths.size > 0) {
        for (const targetPath of targetPaths) {
          // Normalize both paths for comparison (use forward slashes)
          const normalizedEntryPath = entry.path.replace(/\\/g, "/");
          let normalizedTargetPath = targetPath.replace(/\\/g, "/");

          // Remove leading ./ if present from target
          if (normalizedTargetPath.startsWith("./")) {
            normalizedTargetPath = normalizedTargetPath.slice(2);
          }

          // 1. Exact match
          if (normalizedEntryPath === normalizedTargetPath) {
            return true;
          }

          // 2. Entry path ends with target path
          if (normalizedEntryPath.endsWith(normalizedTargetPath)) {
            return true;
          }

          // 3. Both paths end with the same filename
          const targetFileName = normalizedTargetPath.split("/").pop();
          const entryFileName = normalizedEntryPath.split("/").pop();
          if (
            targetFileName && entryFileName && targetFileName === entryFileName
          ) {
            return true;
          }

          // 4. Entry path contains target path (for partial matches)
          if (normalizedEntryPath.includes(normalizedTargetPath)) {
            return true;
          }
        }
      }

      // Check if this entry matches any of the target blocks
      return targetFileNames.has(entryFileName) ||
        targetBlocks.has(entryBlockName) ||
        Array.from(targetFileNames).some((fn) => entry.path.includes(fn)) ||
        Array.from(targetBlocks).some((bn) => entry.path.includes(bn));
    });

    if (jsonEntries.length === 0) {
      const blocksList = targetBlocks.size > 0
        ? Array.from(targetBlocks).join(", ")
        : Array.from(targetPaths).join(", ");
      error(
        `No blocks found matching: ${blocksList}`,
      );
    }
  }

  console.log(
    colorize(
      `Validating ${jsonEntries.length} JSON file(s)...\n`,
      colors.cyan + colors.bold,
    ),
  );

  const allErrors: ValidationError[] = [];
  const allUnresolvedResolveTypes: Array<{
    file: string;
    sectionPath: string;
    resolveType: string;
  }> = [];
  const allUsedSavedBlocks = new Set<string>();

  // Validate only the filtered entries
  for (const entry of jsonEntries) {
    const content = await Deno.readTextFile(entry.path);
    const result = await validateJsonFile(entry.path, content);
    allErrors.push(...result.errors);
    allUnresolvedResolveTypes.push(...result.unresolvedResolveTypes);
    result.usedSavedBlocks.forEach((block) => allUsedSavedBlocks.add(block));
  }

  // Collect usage from ALL blocks (not just the filtered ones) to check if blocks are used
  // This is important when using --blocks flag to validate only specific blocks
  for (const entry of allJsonEntries) {
    const content = await Deno.readTextFile(entry.path);
    const result = await validateJsonFile(entry.path, content);
    result.usedSavedBlocks.forEach((block) => allUsedSavedBlocks.add(block));
  }

  // Determine which blocks to check for unused status
  const blocksToCheckForUnused = targetBlocks.size > 0 || targetPaths.size > 0
    ? targetBlocks // Only check the filtered blocks when --blocks is used
    : null; // Check all blocks when --blocks is not used

  const allSavedBlocks = new Set<string>();
  const encodedToBlockName = new Map<string, string>();

  // Collect saved blocks - either all or just the filtered ones
  const entriesToCheck = blocksToCheckForUnused ? jsonEntries : allJsonEntries;
  for (const entry of entriesToCheck) {
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

  // If checking all blocks, also add blocks that are used but not in the list
  if (!blocksToCheckForUnused) {
    const usedButNotInList = Array.from(allUsedSavedBlocks).filter(
      (block) => !allSavedBlocks.has(block),
    );

    for (const usedBlock of usedButNotInList) {
      const encodedFileName = blockNameToFileName(usedBlock).replace(
        ".json",
        "",
      );

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
  }

  const savedBlocks = Array.from(allSavedBlocks);
  const savedBlocksWithContent = await Promise.all(
    savedBlocks.map(async (block) => {
      return {
        name: block,
        content: JSON.parse(await getSavedBlockContent(block) || "{}"),
      };
    }),
  );
  const unusedSavedBlocks = savedBlocksWithContent
    .filter((block) =>
      !allUsedSavedBlocks.has(block.name) &&
      !block.content.__resolveType.startsWith("site/apps/")
    )
    .map((block) => {
      const [app, type] = block.content.__resolveType.split("/");
      return ({
        name: block.name,
        type,
        app,
      });
    });

  const hasErrors = allErrors.length > 0;
  const hasUnresolved = allUnresolvedResolveTypes.length > 0;
  const hasUnused = unusedSavedBlocks.length > 0;

  if (!hasErrors && !hasUnresolved && !hasUnused) {
    console.log(
      colorize("✅ All sections are configured correctly!", colors.green),
    );
    return;
  }

  if (hasErrors) {
    const totalIssues = allErrors.reduce((sum, e) => sum + e.errors.length, 0);

    // Group errors by resolveType + error messages (ignore path and file to group common errors)
    const errorGroups = new Map<string, {
      resolveType: string;
      errorMessages: Set<string>;
      locations: Array<
        { file: string; sectionPath: string; errorLine?: number }
      >;
    }>();

    for (const error of allErrors) {
      // Sort error messages to create consistent key
      const sortedErrors = [...error.errors].sort();
      const errorMessagesKey = sortedErrors.join("|||");
      // Create a unique key for this section with these specific error messages
      const key = `${error.resolveType}::${errorMessagesKey}`;

      if (!errorGroups.has(key)) {
        errorGroups.set(key, {
          resolveType: error.resolveType,
          errorMessages: new Set(error.errors),
          locations: [],
        });
      }

      const group = errorGroups.get(key)!;
      // Add this location (file + path) to the group
      group.locations.push({
        file: error.file,
        sectionPath: error.sectionPath || "",
        errorLine: error.errorLine,
      });
    }

    const uniqueErrorCount = errorGroups.size;
    console.log(
      colorize(
        `❌ Found ${uniqueErrorCount} unique error group(s) across ${allErrors.length} section(s) (${totalIssues} total error(s)):\n`,
        colors.red + colors.bold,
      ),
    );

    // Sort groups by resolveType for consistent output
    const sortedGroups = Array.from(errorGroups.values())
      .sort((a, b) => a.resolveType.localeCompare(b.resolveType));

    // Format file paths as clickable links (file:line format)
    const formatFilePath = (file: string, line?: number): string => {
      if (line !== undefined) {
        return `${file}:${line}`;
      }
      return file;
    };

    for (const group of sortedGroups) {
      console.log(
        `${colorize("📄", colors.cyan)} ${
          colorize("Section:", colors.cyan + colors.bold)
        } ${colorize(group.resolveType, colors.cyan)}`,
      );

      // Display all error messages for this section
      const errorMessages = Array.from(group.errorMessages).sort();
      for (const errorMsg of errorMessages) {
        console.log(
          `   ${colorize("⚠️", colors.yellow)}  ${
            colorize(errorMsg, colors.yellow)
          }`,
        );
      }

      // Display all locations (paths and files) where these errors occur
      // Sort locations by file, then by path
      const sortedLocations = group.locations.sort((a, b) => {
        if (a.file !== b.file) return a.file.localeCompare(b.file);
        return a.sectionPath.localeCompare(b.sectionPath);
      });

      const locationsToShow = isVerbose
        ? sortedLocations
        : sortedLocations.slice(0, 5);
      const remainingCount = isVerbose ? 0 : sortedLocations.length - 5;

      for (const location of locationsToShow) {
        if (location.sectionPath) {
          console.log(
            `   ${colorize("└─", colors.gray)} ${
              colorize("Path:", colors.gray)
            } ${colorize(location.sectionPath, colors.gray)}`,
          );
          console.log(
            `      ${colorize("└─", colors.gray)} ${
              colorize("File:", colors.blue)
            } ${
              colorize(
                formatFilePath(location.file, location.errorLine),
                colors.blue,
              )
            }`,
          );
        } else {
          console.log(
            `   ${colorize("└─", colors.gray)} ${
              colorize("File:", colors.blue)
            } ${
              colorize(
                formatFilePath(location.file, location.errorLine),
                colors.blue,
              )
            }`,
          );
        }
      }

      if (remainingCount > 0) {
        console.log(
          `   ${
            colorize(
              `... and ${remainingCount} more location(s) ...`,
              colors.gray,
            )
          }`,
        );
        console.log(
          `   ${
            colorize(
              `Run with "--verbose" or "-v" to see all locations`,
              colors.cyan,
            )
          }`,
        );
      }
      console.log();
    }
  }

  if (hasUnresolved) {
    console.log(
      `\n${
        colorize(
          `⚠️  Found ${allUnresolvedResolveTypes.length} unresolved resolveType(s):\n`,
          colors.yellow + colors.bold,
        )
      }`,
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
      console.log(
        `${colorize("📄", colors.cyan)} ${colorize(file, colors.blue)}`,
      );
      for (const item of unresolved) {
        console.log(
          `   ${colorize("└─", colors.gray)} ${
            colorize(item.resolveType, colors.yellow)
          }`,
        );
        if (item.sectionPath) {
          console.log(
            `      ${colorize("Path:", colors.gray)} ${
              colorize(item.sectionPath, colors.gray)
            }`,
          );
        }
      }
      console.log();
    }
  }

  if (hasUnused) {
    console.log(
      `\n${
        colorize(
          `📦 Found ${unusedSavedBlocks.length} unused saved block(s):\n`,
          colors.magenta + colors.bold,
        )
      }`,
    );
    // for (const block of unusedSavedBlocks.sort()) {
    //   console.log(`   - ${block}`);
    // }
    console.table(unusedSavedBlocks);
    console.log();
  }
}

main();
