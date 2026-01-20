/**
 * Analyzes TypeScript imports to find files that are actually used in code
 * even if they don't appear in block configurations.
 *
 * This prevents false positives where files are marked as "unused"
 * but are actually imported in TypeScript code.
 */

import { walk } from "https://deno.land/std@0.208.0/fs/walk.ts";
import { join, relative } from "https://deno.land/std@0.208.0/path/mod.ts";

interface ImportAnalysis {
  importedFiles: Set<string>; // Absolute paths to imported files
  importCount: number;
  filesAnalyzed: number;
}

/**
 * Finds all TypeScript files that are imported in the codebase
 */
export async function analyzeImports(projectRoot: string): Promise<ImportAnalysis> {
  const importedFiles = new Set<string>();
  let filesAnalyzed = 0;
  let importCount = 0;

  // Regex to match: from "path/to/file" or from 'path/to/file'
  const importRegex = /(?:from\s+["']([^"']+)["']|import\s+["']([^"']+)["'])/g;

  try {
    // Walk through all TypeScript files
    for await (const entry of walk(projectRoot, {
      exts: [".ts", ".tsx"],
      skip: [
        /node_modules/,
        /\.deco/,
        /_fresh/,
        /scripts\/validate-blocks/,
        /\.git/,
      ],
    })) {
      if (!entry.isFile) continue;

      filesAnalyzed++;

      try {
        const content = await Deno.readTextFile(entry.path);
        let match;

        while ((match = importRegex.exec(content)) !== null) {
          const importPath = match[1] || match[2];
          if (!importPath) continue;

          // Skip external imports and relative node_modules
          if (importPath.startsWith(".") || importPath.startsWith("http")) {
            continue;
          }

          // Convert import paths to file paths
          // e.g., "site/loaders/search/intelligentSearchEvents.ts" -> absolute path
          if (importPath.startsWith("site/")) {
            const filePath = importPath.replace("site/", "");
            const absolutePath = join(projectRoot, filePath);

            // Also check without .ts extension (TypeScript adds it automatically)
            importedFiles.add(absolutePath);
            if (!absolutePath.endsWith(".ts") && !absolutePath.endsWith(".tsx")) {
              importedFiles.add(absolutePath + ".ts");
              importedFiles.add(absolutePath + ".tsx");
            }

            importCount++;
          }
        }
      } catch (e) {
        // Ignore read errors
        console.debug(`Failed to analyze imports in ${entry.path}:`, e.message);
      }
    }
  } catch (e) {
    console.debug("Error during import analysis:", e.message);
  }

  return {
    importedFiles,
    importCount,
    filesAnalyzed,
  };
}

/**
 * Checks if a file is imported anywhere in the codebase
 */
export function isFileImported(
  filePath: string,
  importedFiles: Set<string>,
): boolean {
  // Normalize the file path
  const normalized = filePath.replace(/\\/g, "/");

  // Check direct match
  if (importedFiles.has(filePath)) return true;
  if (importedFiles.has(normalized)) return true;

  // Check without extension
  const withoutExt = normalized.replace(/\.(tsx?|jsx?)$/, "");
  if (importedFiles.has(withoutExt)) return true;

  // Check all possible extensions
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    if (importedFiles.has(withoutExt + ext)) return true;
  }

  // Check if any import path matches this file
  for (const imported of importedFiles) {
    if (imported.endsWith(normalized) || normalized.endsWith(imported.replace(/\.(tsx?|jsx?)$/, ""))) {
      return true;
    }
  }

  return false;
}

/**
 * Filters out files that are imported in code from the "unused" list
 */
export function filterImportedFiles(
  candidateFiles: string[],
  importedFiles: Set<string>,
  projectRoot: string,
): { unused: string[]; imported: string[] } {
  const unused: string[] = [];
  const imported: string[] = [];

  for (const file of candidateFiles) {
    if (isFileImported(file, importedFiles)) {
      imported.push(file);
    } else {
      unused.push(file);
    }
  }

  return { unused, imported };
}

/**
 * Generates a report of import findings
 */
export function reportImportAnalysis(
  analysis: ImportAnalysis,
  projectRoot: string,
  importedFilesList?: string[],
): void {
  console.log("\n📊 Import Analysis Results:");
  console.log(`   Files analyzed: ${analysis.filesAnalyzed}`);
  console.log(`   Imports found: ${analysis.importCount}`);
  console.log(`   Unique files imported: ${analysis.importedFiles.size}`);

  if (importedFilesList && importedFilesList.length > 0) {
    console.log("\n📌 Files that are imported (should NOT be deleted):");
    for (const file of importedFilesList.slice(0, 10)) {
      const relPath = relative(projectRoot, file);
      console.log(`   - ${relPath}`);
    }
    if (importedFilesList.length > 10) {
      console.log(`   ... and ${importedFilesList.length - 10} more`);
    }
  }
}
