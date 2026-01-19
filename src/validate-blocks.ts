import { join, relative } from "https://deno.land/std@0.208.0/path/mod.ts";
import { walk } from "https://deno.land/std@0.208.0/fs/walk.ts";
import { filePathToResolveType } from "./type-mapper.ts";
import { extractPropsInterface, TypeSchema } from "./ts-parser.ts";
import { validateValue, ValidationError } from "./validator.ts";

interface SectionValidationResult {
  sectionFile: string; // Relative path for display
  sectionFilePath: string; // Absolute path for comparison
  resolveType: string;
  occurrences: OccurrenceValidation[];
  totalErrors: number;
  totalWarnings: number;
  unused?: boolean; // Flag to indicate section is not being used
}

interface OccurrenceValidation {
  jsonFile: string;
  jsonFilePath: string; // Full path to JSON file
  jsonPath: string; // Path within JSON (e.g. "sections[0]")
  jsonContent?: string; // JSON content for line lookup
  resolveTypeLine?: number; // Line where __resolveType is located
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

interface ValidationOptions {
  includeUnusedVars: boolean;
  removeUnusedVars: boolean;
  removeUnusedSections: boolean;
  blocksDir?: string; // Custom path for blocks folder
  reportFile?: string; // Path for report file
}

interface ValidationReport {
  timestamp: string;
  projectRoot: string;
  summary: {
    totalSections: number;
    totalOccurrences: number;
    totalErrors: number;
    totalWarnings: number;
    sectionsWithErrors: number;
    sectionsWithWarnings: number;
    unusedSections: number;
    validSections: number;
    antiPatterns: number;
  };
  sectionsWithErrors: Array<{
    file: string;
    resolveType: string;
    errors: Array<{
      jsonFile: string;
      line?: number;
      property: string;
      message: string;
    }>;
  }>;
  sectionsWithWarnings: Array<{
    file: string;
    resolveType: string;
    warnings: Array<{
      jsonFile: string;
      property: string;
      message: string;
    }>;
  }>;
  unusedSections: string[];
  antiPatterns: AntiPatternIssue[];
}

interface AntiPatternIssue {
  type: "dead-code" | "lazy-multivariate" | "nested-multivariate";
  jsonFile: string;
  jsonPath: string;
  message: string;
  line?: number;
}

/**
 * Main function that orchestrates the validation
 */
export default async function main() {
  const projectRoot = Deno.cwd();

  // Parse arguments
  const args = Deno.args;

  // Extract -blocks or -b value if present
  let customBlocksDir: string | undefined;
  const blocksDirIndex = args.findIndex((arg, idx) =>
    (arg === "-blocks" || arg === "-b") && args[idx + 1]
  );
  if (blocksDirIndex !== -1 && args[blocksDirIndex + 1]) {
    customBlocksDir = args[blocksDirIndex + 1];
  }

  // Extract -report or -r value if present
  let reportFile: string | undefined;
  const reportIndex = args.findIndex((arg, idx) =>
    (arg === "-report" || arg === "-r") && args[idx + 1]
  );
  if (reportIndex !== -1 && args[reportIndex + 1]) {
    reportFile = args[reportIndex + 1];
  } else if (args.includes("-report") || args.includes("-r")) {
    // If -report was passed without value, use default name
    reportFile = "validation-report.json";
  }

  const removeUnusedVars = args.includes("-rm-vars");

  const options: ValidationOptions = {
    // If removing, need to include warnings to detect them
    includeUnusedVars: args.includes("-unused") || removeUnusedVars,
    removeUnusedVars,
    removeUnusedSections: args.includes("-rm-sections"),
    blocksDir: customBlocksDir,
    reportFile,
  };

  if (customBlocksDir) {
    console.log(`📂 Using custom blocks folder: ${customBlocksDir}\n`);
  }

  if (options.removeUnusedVars) {
    console.log("🧹 Mode: Remove properties not defined in types\n");
  }
  if (options.removeUnusedSections) {
    console.log("🗑️  Mode: Remove unused sections\n");
  }
  if (options.reportFile) {
    console.log(`📄 Report will be saved to: ${options.reportFile}\n`);
  }

  // Remove flags from arguments (including -blocks/-b, -report/-r and their values)
  const fileArgs = args.filter((arg, idx) => {
    if (arg.startsWith("-")) return false;
    if (idx > 0 && (args[idx - 1] === "-blocks" || args[idx - 1] === "-b")) {
      return false;
    }
    if (idx > 0 && (args[idx - 1] === "-report" || args[idx - 1] === "-r")) {
      return false;
    }
    return true;
  });
  const targetFile = fileArgs.length > 0 ? fileArgs[0] : null;

  if (targetFile) {
    // Validate only a specific file
    console.log(`🔍 Validating ${targetFile}...\n`);
    const results = await validateSpecificFile(
      targetFile,
      projectRoot,
      options,
    );

    // Detect anti-patterns
    const blocksDir = options.blocksDir || join(projectRoot, ".deco", "blocks");
    const antiPatterns = await detectAntiPatterns(blocksDir);

    const hasErrors = reportResults(results, antiPatterns);

    // Generate report if requested
    if (options.reportFile) {
      await generateReport(results, projectRoot, options.reportFile, antiPatterns);
    }

    // Execute cleanups if requested
    if (options.removeUnusedVars) {
      await removeUnusedPropertiesFromJsons(results);
    }

    // Exit code
    Deno.exit(hasErrors ? 1 : 0);
  } else {
    // Validate all files
    console.log("🔍 Validating sections, loaders, and actions...\n");
    const results = await validateAllSections(projectRoot, options);
    const allSectionFiles = await getAllSectionFiles(projectRoot);
    const usedSections = getUsedSections(results);

    // Detect anti-patterns
    const blocksDir = options.blocksDir || join(projectRoot, ".deco", "blocks");
    const antiPatterns = await detectAntiPatterns(blocksDir);

    const hasErrors = reportResults(results, antiPatterns);

    // Generate report if requested
    if (options.reportFile) {
      await generateReport(results, projectRoot, options.reportFile, antiPatterns);
    }

    // Execute cleanups if requested
    if (options.removeUnusedVars) {
      await removeUnusedPropertiesFromJsons(results);
    }
    if (options.removeUnusedSections) {
      await removeUnusedSectionFiles(allSectionFiles, usedSections);
    }

    // Exit code
    Deno.exit(hasErrors ? 1 : 0);
  }
}

/**
 * Validates a specific file
 */
async function validateSpecificFile(
  targetFile: string,
  projectRoot: string,
  options: ValidationOptions,
): Promise<SectionValidationResult[]> {
  const results: SectionValidationResult[] = [];

  // Resolve absolute path
  let absolutePath: string;
  if (targetFile.startsWith("/")) {
    absolutePath = targetFile;
  } else {
    absolutePath = join(projectRoot, targetFile);
  }

  // Check if file exists
  try {
    await Deno.stat(absolutePath);
  } catch {
    console.error(`❌ File not found: ${targetFile}`);
    Deno.exit(1);
  }

  // Validate the file
  const result = await validateSection(absolutePath, projectRoot, options);
  if (result) {
    results.push(result);
  }

  return results;
}

/**
 * Validates all sections and loaders in the project
 */
async function validateAllSections(
  projectRoot: string,
  options: ValidationOptions,
): Promise<SectionValidationResult[]> {
  const results: SectionValidationResult[] = [];

  // Find all section and loader files
  const sectionFiles = await findAllSections(projectRoot);

  // For each section, find occurrences and validate
  for (const sectionFile of sectionFiles) {
    const result = await validateSection(sectionFile, projectRoot, options);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

/**
 * Finds all section, loader, and action files
 */
async function findAllSections(projectRoot: string): Promise<string[]> {
  const files: string[] = [];

  // Search in sections/
  const sectionsDir = join(projectRoot, "sections");
  try {
    for await (
      const entry of walk(sectionsDir, {
        exts: [".tsx", ".ts"],
        includeDirs: false,
      })
    ) {
      files.push(entry.path);
    }
  } catch {
    // Directory doesn't exist
  }

  // Search in loaders/
  const loadersDir = join(projectRoot, "loaders");
  try {
    for await (
      const entry of walk(loadersDir, {
        exts: [".ts"],
        includeDirs: false,
      })
    ) {
      files.push(entry.path);
    }
  } catch {
    // Directory doesn't exist
  }

  // Search in actions/
  const actionsDir = join(projectRoot, "actions");
  try {
    for await (
      const entry of walk(actionsDir, {
        exts: [".ts"],
        includeDirs: false,
      })
    ) {
      files.push(entry.path);
    }
  } catch {
    // Directory doesn't exist
  }

  return files;
}

/**
 * Validates a specific section/loader
 */
async function validateSection(
  sectionFile: string,
  projectRoot: string,
  options: ValidationOptions,
): Promise<SectionValidationResult | null> {
  try {
    // Generate __resolveType from file path
    const resolveType = filePathToResolveType(sectionFile, projectRoot);

    // Ignore Theme
    if (resolveType.includes("/Theme/Theme.tsx")) {
      return null;
    }

    // Ignore system loaders
    const systemLoaders = [
      "loaders/user.ts",
      "loaders/icons.ts",
      "loaders/wishlist.ts",
      "loaders/minicart.ts",
      "loaders/availableIcons.ts",
    ];

    if (systemLoaders.some((loader) => sectionFile.endsWith(loader))) {
      return null;
    }

    // Extract Props interface (pass projectRoot to resolve import map aliases)
    const propsSchema = await extractPropsInterface(sectionFile, projectRoot);

    // Find all occurrences of this resolveType in JSONs
    const blocksDir = options.blocksDir || join(projectRoot, ".deco", "blocks");
    const occurrences = await findOccurrencesInJsons(
      resolveType,
      blocksDir,
      propsSchema,
      options,
    );

    // If no occurrences, return with warning
    if (occurrences.length === 0) {
      return {
        sectionFile: relative(projectRoot, sectionFile),
        sectionFilePath: sectionFile,
        resolveType,
        occurrences: [],
        totalErrors: 0,
        totalWarnings: 1,
        unused: true, // Flag to indicate not being used
      };
    }

    // Count errors and warnings
    let totalErrors = 0;
    let totalWarnings = 0;

    for (const occ of occurrences) {
      totalErrors += occ.errors.length;
      totalWarnings += occ.warnings.length;
    }

    return {
      sectionFile: relative(projectRoot, sectionFile),
      sectionFilePath: sectionFile,
      resolveType,
      occurrences,
      totalErrors,
      totalWarnings,
      unused: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error processing ${sectionFile}:`, message);
    return null;
  }
}

/**
 * Recursively searches for occurrences of a __resolveType in all JSONs
 */
async function findOccurrencesInJsons(
  resolveType: string,
  blocksDir: string,
  propsSchema: TypeSchema | null,
  options: ValidationOptions,
): Promise<OccurrenceValidation[]> {
  const occurrences: OccurrenceValidation[] = [];

  try {
    for await (
      const entry of walk(blocksDir, {
        exts: [".json"],
        includeDirs: false,
      })
    ) {
      const jsonContent = await Deno.readTextFile(entry.path);
      const jsonData = JSON.parse(jsonContent);

      // Search recursively in JSON
      const found = findInObject(
        jsonData,
        resolveType,
        "",
        propsSchema,
        options,
      );

      for (let i = 0; i < found.length; i++) {
        const occurrence = found[i];
        // Find the line of __resolveType for this specific occurrence
        const resolveTypeLine = findResolveTypeLine(
          jsonContent,
          resolveType,
          i,
        );

        occurrences.push({
          jsonFile: entry.path.split("/").pop() || "unknown",
          jsonFilePath: entry.path,
          jsonPath: occurrence.path,
          jsonContent, // Pass content for line lookup later
          resolveTypeLine,
          valid: occurrence.valid,
          errors: occurrence.errors,
          warnings: occurrence.warnings,
        });
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return occurrences;
}

/**
 * Recursively searches an object for __resolveType and validates
 */
function findInObject(
  obj: unknown,
  targetResolveType: string,
  currentPath: string,
  propsSchema: TypeSchema | null,
  options: ValidationOptions,
): Array<
  {
    path: string;
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationError[];
  }
> {
  const results: Array<
    {
      path: string;
      valid: boolean;
      errors: ValidationError[];
      warnings: ValidationError[];
    }
  > = [];

  if (typeof obj !== "object" || obj === null) {
    return results;
  }

  // If found __resolveType, validate
  if (
    typeof obj === "object" &&
    obj !== null &&
    "__resolveType" in obj &&
    obj.__resolveType === targetResolveType
  ) {
    if (!propsSchema) {
      results.push({
        path: currentPath || "root",
        valid: true,
        errors: [],
        warnings: [{
          path: "Props",
          message: "Props interface not found in file",
          severity: "warning",
        }],
      });
    } else {
      const allIssues = validateValue(
        obj,
        propsSchema,
        "",
        !options.includeUnusedVars, // Invert: if NOT including, then ignore
      );
      const errors = allIssues.filter((issue) => issue.severity !== "warning");
      const warnings = allIssues.filter((issue) =>
        issue.severity === "warning"
      );

      results.push({
        path: currentPath || "root",
        valid: errors.length === 0,
        errors,
        warnings,
      });
    }
  }

  // Continue searching recursively
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      const newPath = currentPath ? `${currentPath}[${index}]` : `[${index}]`;
      results.push(
        ...findInObject(item, targetResolveType, newPath, propsSchema, options),
      );
    });
  } else {
    for (const [key, value] of Object.entries(obj)) {
      const newPath = currentPath ? `${currentPath}.${key}` : key;
      results.push(
        ...findInObject(
          value,
          targetResolveType,
          newPath,
          propsSchema,
          options,
        ),
      );
    }
  }

  return results;
}

/**
 * Finds the line number where __resolveType appears
 * occurrenceIndex allows finding the N-th occurrence
 */
function findResolveTypeLine(
  content: string,
  resolveType: string,
  occurrenceIndex: number,
): number {
  const searchPattern = `"__resolveType": "${resolveType}"`;
  const lines = content.split("\n");
  let foundCount = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(searchPattern)) {
      if (foundCount === occurrenceIndex) {
        return i + 1;
      }
      foundCount++;
    }
  }

  return 0;
}

/**
 * Detects anti-patterns in JSON block files
 */
async function detectAntiPatterns(blocksDir: string): Promise<AntiPatternIssue[]> {
  const issues: AntiPatternIssue[] = [];

  try {
    for await (
      const entry of walk(blocksDir, {
        exts: [".json"],
        includeDirs: false,
      })
    ) {
      const jsonContent = await Deno.readTextFile(entry.path);
      const jsonData = JSON.parse(jsonContent);
      const jsonFileName = entry.path.split("/").pop() || "unknown";

      // Scan the JSON recursively for anti-patterns
      scanForAntiPatterns(jsonData, "", jsonFileName, jsonContent, issues);
    }
  } catch {
    // Directory doesn't exist
  }

  return issues;
}

/**
 * Recursively scans an object for anti-patterns
 */
function scanForAntiPatterns(
  obj: unknown,
  currentPath: string,
  jsonFile: string,
  jsonContent: string,
  issues: AntiPatternIssue[],
): void {
  if (typeof obj !== "object" || obj === null) {
    return;
  }

  const resolveType = (obj as Record<string, unknown>).__resolveType;

  // Check for multivariate/flags sections
  if (
    typeof resolveType === "string" &&
    (resolveType.includes("multivariate") || resolveType.includes("flags"))
  ) {
    const variants = (obj as Record<string, unknown>).variants;
    if (Array.isArray(variants)) {
      for (let i = 0; i < variants.length; i++) {
        const variant = variants[i] as Record<string, unknown>;
        const rule = variant.rule as Record<string, unknown>;
        const value = variant.value;

        // Check for 'never' matcher (dead code)
        if (
          rule &&
          typeof rule.__resolveType === "string" &&
          rule.__resolveType.toLowerCase().includes("never")
        ) {
          const line = findPatternLine(jsonContent, "never", currentPath);
          issues.push({
            type: "dead-code",
            jsonFile,
            jsonPath: `${currentPath}.variants[${i}]`,
            message: `Variant with 'never' rule is dead code and will never execute`,
            line,
          });
        }

        // Check for Lazy wrapping multivariate (anti-pattern)
        if (
          value &&
          typeof value === "object" &&
          typeof (value as Record<string, unknown>).__resolveType === "string"
        ) {
          const valueResolveType = (value as Record<string, unknown>)
            .__resolveType as string;

          if (valueResolveType.includes("Lazy")) {
            const section = (value as Record<string, unknown>).section;
            if (
              section &&
              typeof section === "object" &&
              typeof (section as Record<string, unknown>).__resolveType ===
                "string"
            ) {
              const sectionResolveType = (section as Record<string, unknown>)
                .__resolveType as string;
              if (
                sectionResolveType.includes("multivariate") ||
                sectionResolveType.includes("flags")
              ) {
                const line = findPatternLine(jsonContent, "Lazy", currentPath);
                issues.push({
                  type: "lazy-multivariate",
                  jsonFile,
                  jsonPath: `${currentPath}.variants[${i}].value`,
                  message: `Lazy wrapping multivariate is an anti-pattern. Multivariate should wrap Lazy, not the other way around.`,
                  line,
                });
              }
            }
          }
        }
      }
    }
  }

  // Continue scanning recursively
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      const newPath = currentPath ? `${currentPath}[${index}]` : `[${index}]`;
      scanForAntiPatterns(item, newPath, jsonFile, jsonContent, issues);
    });
  } else {
    for (const [key, value] of Object.entries(obj)) {
      if (key === "__resolveType") continue;
      const newPath = currentPath ? `${currentPath}.${key}` : key;
      scanForAntiPatterns(value, newPath, jsonFile, jsonContent, issues);
    }
  }
}

/**
 * Finds the line number for a pattern in JSON content
 */
function findPatternLine(
  content: string,
  pattern: string,
  _contextPath: string,
): number | undefined {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(pattern)) {
      return i + 1;
    }
  }
  return undefined;
}

/**
 * Finds the line number where a specific property appears in the JSON
 * For missing properties in arrays, tries to find the parent array line
 */
function findPropertyLine(
  content: string,
  propertyPath: string,
  occurrenceIndex: number,
): number | null {
  // If it's a property inside an array (e.g. "awards[0].title")
  // and the property is missing, search for the parent array
  if (propertyPath.includes("[")) {
    const parts = propertyPath.split(".");

    // Try first to find the specific property
    const lastPart = parts[parts.length - 1];
    const cleanProperty = lastPart.replace(/\[\d+\]/, "");

    if (cleanProperty) {
      const searchPattern = `"${cleanProperty}"`;
      const lines = content.split("\n");
      let foundCount = 0;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(searchPattern)) {
          if (foundCount === occurrenceIndex) {
            return i + 1;
          }
          foundCount++;
        }
      }
    }

    // If not found, search for parent array (e.g. "awards" from "awards[0].title")
    const arrayPart = parts.find((p) => p.includes("["));
    if (arrayPart) {
      const arrayName = arrayPart.split("[")[0];
      const searchPattern = `"${arrayName}"`;
      const lines = content.split("\n");
      let foundCount = 0;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(searchPattern)) {
          if (foundCount === occurrenceIndex) {
            return i + 1;
          }
          foundCount++;
        }
      }
    }

    return null;
  }

  // For simple properties
  const parts = propertyPath.split(".");
  const lastPart = parts[parts.length - 1];
  const cleanProperty = lastPart.replace(/\[\d+\]/, "");

  if (!cleanProperty) return null;

  const searchPattern = `"${cleanProperty}"`;
  const lines = content.split("\n");
  let foundCount = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(searchPattern)) {
      if (foundCount === occurrenceIndex) {
        return i + 1;
      }
      foundCount++;
    }
  }

  return null;
}

/**
 * Reports validation results
 * @returns true if there are errors
 */
function reportResults(
  results: SectionValidationResult[],
  antiPatterns: AntiPatternIssue[] = [],
): boolean {
  let totalOccurrences = 0;
  let totalErrors = 0;
  let totalWarnings = 0;
  const sectionsWithErrors: SectionValidationResult[] = [];
  const sectionsWithWarnings: SectionValidationResult[] = [];
  const unusedSections: SectionValidationResult[] = [];

  for (const result of results) {
    totalOccurrences += result.occurrences.length;
    totalErrors += result.totalErrors;

    // Count warnings only if not unused
    if (!result.unused) {
      totalWarnings += result.totalWarnings;
    }

    // Ignore Theme and special sections (Component, Session)
    const isSpecialSection = result.sectionFile.includes("sections/Theme/") ||
      result.sectionFile.endsWith("sections/Component.tsx") ||
      result.sectionFile.endsWith("sections/Session.tsx");

    if (result.unused && !isSpecialSection) {
      unusedSections.push(result);
      console.log(
        `⚠️  ${result.sectionFile} - not used in any JSON`,
      );
    } else if (result.totalErrors > 0) {
      sectionsWithErrors.push(result);
      console.log(
        `\n❌ ${result.sectionFile} - ${result.occurrences.length} occurrence(s), ${result.totalErrors} error(s)\n`,
      );

      // Group by JSON file
      const groupedByFile = new Map<string, typeof result.occurrences>();
      for (const occ of result.occurrences) {
        if (occ.errors.length > 0) {
          if (!groupedByFile.has(occ.jsonFile)) {
            groupedByFile.set(occ.jsonFile, []);
          }
          groupedByFile.get(occ.jsonFile)!.push(occ);
        }
      }

      // Show grouped by file
      for (const [jsonFile, occs] of groupedByFile) {
        console.log(`     📄 \x1b[1m${jsonFile}\x1b[0m\n`);

        // Iterate through occurrences and their errors
        for (let occIndex = 0; occIndex < occs.length; occIndex++) {
          const occ = occs[occIndex];

          for (const error of occ.errors) {
            // For missing properties, always use the __resolveType line
            // For other errors (wrong type, etc), try to find the specific line
            const lineNum = occ.resolveTypeLine ?? null;

            const lineInfo = lineNum ? ` (${occ.jsonFilePath}:${lineNum})` : "";

            // Always show which property has the problem
            const propertyName = error.path.replace(/^root\./, "");
            let message = error.message;

            if (error.message.includes("required property missing")) {
              message = `"${propertyName}": ${error.message}`;
            } else if (propertyName) {
              // For other errors (wrong type, etc), show: "prop": message
              message = `"${propertyName}": ${error.message}`;
            }

            console.log(`       - ${message}${lineInfo}`);
          }
        }
      }
    } else if (result.totalWarnings > 0) {
      sectionsWithWarnings.push(result);
      console.log(
        `\n⚠️  ${result.sectionFile} - ${result.occurrences.length} occurrence(s), ${result.totalWarnings} warning(s)\n`,
      );

      // Group by JSON file
      const groupedByFile = new Map<string, typeof result.occurrences>();
      for (const occ of result.occurrences) {
        if (occ.warnings.length > 0) {
          if (!groupedByFile.has(occ.jsonFile)) {
            groupedByFile.set(occ.jsonFile, []);
          }
          groupedByFile.get(occ.jsonFile)!.push(occ);
        }
      }

      // Show grouped by file
      for (const [jsonFile, occs] of groupedByFile) {
        console.log(`     📄 \x1b[1m${jsonFile}\x1b[0m\n`);

        // Count occurrences of same property to find correct line
        const propertyOccurrences = new Map<string, number>();

        for (const occ of occs) {
          for (const warning of occ.warnings) {
            const occIndex = propertyOccurrences.get(warning.path) || 0;
            const lineNum = occ.jsonContent
              ? findPropertyLine(occ.jsonContent, warning.path, occIndex)
              : null;
            const lineInfo = lineNum ? ` (${occ.jsonFilePath}:${lineNum})` : "";

            // Always show which property has the problem
            const propertyName = warning.path.replace(/^root\./, "");
            const message = propertyName
              ? `"${propertyName}": ${warning.message}`
              : warning.message;

            console.log(`       - ${message}${lineInfo}`);

            // Increment counter for next occurrence of this property
            propertyOccurrences.set(warning.path, occIndex + 1);
          }
        }
        console.log();
      }
    }
  }

  // Report anti-patterns
  if (antiPatterns.length > 0) {
    console.log("\n🚨 ANTI-PATTERNS DETECTED\n");

    // Group by type
    const deadCode = antiPatterns.filter((p) => p.type === "dead-code");
    const lazyMultivariate = antiPatterns.filter(
      (p) => p.type === "lazy-multivariate",
    );
    const nestedMultivariate = antiPatterns.filter(
      (p) => p.type === "nested-multivariate",
    );

    if (deadCode.length > 0) {
      console.log(`💀 Dead Code (${deadCode.length} sections with 'never' rule):\n`);
      // Group by file
      const byFile = new Map<string, AntiPatternIssue[]>();
      for (const issue of deadCode) {
        if (!byFile.has(issue.jsonFile)) {
          byFile.set(issue.jsonFile, []);
        }
        byFile.get(issue.jsonFile)!.push(issue);
      }
      for (const [file, issues] of byFile) {
        console.log(`   📄 ${file}: ${issues.length} dead code section(s)`);
      }
      console.log();
    }

    if (lazyMultivariate.length > 0) {
      console.log(
        `⚠️  Lazy wrapping Multivariate (${lazyMultivariate.length} instances):\n`,
      );
      for (const issue of lazyMultivariate) {
        console.log(`   📄 ${issue.jsonFile}`);
        console.log(`      Path: ${issue.jsonPath}`);
        console.log(`      ${issue.message}\n`);
      }
    }

    if (nestedMultivariate.length > 0) {
      console.log(
        `⚠️  Nested Multivariate (${nestedMultivariate.length} instances):\n`,
      );
      for (const issue of nestedMultivariate) {
        console.log(`   📄 ${issue.jsonFile}`);
        console.log(`      Path: ${issue.jsonPath}`);
        console.log(`      ${issue.message}\n`);
      }
    }
  }

  // Summary
  console.log("\n═══════════════════════════════════════");
  console.log("📊 SUMMARY");
  console.log("═══════════════════════════════════════");
  console.log(`Total sections/loaders/actions: ${results.length}`);
  console.log(`Total occurrences: ${totalOccurrences}`);
  console.log(
    `✅ No issues: ${
      results.length - sectionsWithErrors.length - sectionsWithWarnings.length -
      unusedSections.length
    }`,
  );
  console.log(`⚠️  With warnings: ${sectionsWithWarnings.length}`);
  console.log(`⚠️  Unused: ${unusedSections.length}`);
  console.log(`❌ With errors: ${sectionsWithErrors.length}`);
  if (antiPatterns.length > 0) {
    console.log(`🚨 Anti-patterns: ${antiPatterns.length}`);
  }

  if (unusedSections.length > 0) {
    console.log("\n⚠️  Unused sections:");
    for (const section of unusedSections) {
      console.log(`  - ${section.sectionFile}`);
    }
  }

  if (sectionsWithErrors.length > 0) {
    console.log("\n❌ Sections with errors:");
    for (const section of sectionsWithErrors) {
      console.log(
        `  - ${section.sectionFile} (${section.totalErrors} error(s))`,
      );
    }
  }

  return sectionsWithErrors.length > 0;
}

/**
 * Generates a JSON report file with validation results
 */
async function generateReport(
  results: SectionValidationResult[],
  projectRoot: string,
  reportPath: string,
  antiPatterns: AntiPatternIssue[] = [],
): Promise<void> {
  let totalOccurrences = 0;
  let totalErrors = 0;
  let totalWarnings = 0;
  const sectionsWithErrorsList: SectionValidationResult[] = [];
  const sectionsWithWarningsList: SectionValidationResult[] = [];
  const unusedSectionsList: string[] = [];

  for (const result of results) {
    totalOccurrences += result.occurrences.length;
    totalErrors += result.totalErrors;

    if (!result.unused) {
      totalWarnings += result.totalWarnings;
    }

    const isSpecialSection = result.sectionFile.includes("sections/Theme/") ||
      result.sectionFile.endsWith("sections/Component.tsx") ||
      result.sectionFile.endsWith("sections/Session.tsx");

    if (result.unused && !isSpecialSection) {
      unusedSectionsList.push(result.sectionFile);
    } else if (result.totalErrors > 0) {
      sectionsWithErrorsList.push(result);
    } else if (result.totalWarnings > 0) {
      sectionsWithWarningsList.push(result);
    }
  }

  const report: ValidationReport = {
    timestamp: new Date().toISOString(),
    projectRoot,
    summary: {
      totalSections: results.length,
      totalOccurrences,
      totalErrors,
      totalWarnings,
      sectionsWithErrors: sectionsWithErrorsList.length,
      sectionsWithWarnings: sectionsWithWarningsList.length,
      unusedSections: unusedSectionsList.length,
      validSections: results.length - sectionsWithErrorsList.length -
        sectionsWithWarningsList.length - unusedSectionsList.length,
      antiPatterns: antiPatterns.length,
    },
    sectionsWithErrors: sectionsWithErrorsList.map((result) => ({
      file: result.sectionFile,
      resolveType: result.resolveType,
      errors: result.occurrences.flatMap((occ) =>
        occ.errors.map((err) => ({
          jsonFile: occ.jsonFile,
          line: occ.resolveTypeLine,
          property: err.path.replace(/^root\./, ""),
          message: err.message,
        }))
      ),
    })),
    sectionsWithWarnings: sectionsWithWarningsList.map((result) => ({
      file: result.sectionFile,
      resolveType: result.resolveType,
      warnings: result.occurrences.flatMap((occ) =>
        occ.warnings.map((warn) => ({
          jsonFile: occ.jsonFile,
          property: warn.path.replace(/^root\./, ""),
          message: warn.message,
        }))
      ),
    })),
    unusedSections: unusedSectionsList,
    antiPatterns,
  };

  // Resolve report path
  const absoluteReportPath = reportPath.startsWith("/")
    ? reportPath
    : join(projectRoot, reportPath);

  await Deno.writeTextFile(
    absoluteReportPath,
    JSON.stringify(report, null, 2) + "\n",
  );

  console.log(`\n📄 Report saved to: ${absoluteReportPath}`);
}

/**
 * Returns all section/loader/action files in the project
 */
async function getAllSectionFiles(projectRoot: string): Promise<string[]> {
  const files: string[] = [];
  const sectionsDir = join(projectRoot, "sections");
  const loadersDir = join(projectRoot, "loaders");
  const actionsDir = join(projectRoot, "actions");

  try {
    for await (const entry of walk(sectionsDir, { exts: [".tsx", ".ts"] })) {
      if (entry.isFile) files.push(entry.path);
    }
  } catch {
    // Directory doesn't exist
  }

  try {
    for await (const entry of walk(loadersDir, { exts: [".tsx", ".ts"] })) {
      if (entry.isFile) files.push(entry.path);
    }
  } catch {
    // Directory doesn't exist
  }

  try {
    for await (const entry of walk(actionsDir, { exts: [".tsx", ".ts"] })) {
      if (entry.isFile) files.push(entry.path);
    }
  } catch {
    // Directory doesn't exist
  }

  return files;
}

/**
 * Returns the set of sections that are being used
 */
function getUsedSections(results: SectionValidationResult[]): Set<string> {
  const used = new Set<string>();
  for (const result of results) {
    if (result.occurrences.length > 0) {
      used.add(result.sectionFilePath); // Use absolute path
    }
  }
  return used;
}

/**
 * Removes properties not defined in types from JSON files
 */
async function removeUnusedPropertiesFromJsons(
  validationResults: SectionValidationResult[],
): Promise<void> {
  console.log("\n🧹 Removing properties not defined in types...\n");

  let totalRemoved = 0;
  const modifiedFiles = new Map<string, Record<string, unknown>>();

  for (const result of validationResults) {
    for (const occ of result.occurrences) {
      const unusedWarnings = occ.warnings.filter((w) =>
        w.message.includes("property not defined in type")
      );

      if (unusedWarnings.length === 0) continue;

      const jsonPath = occ.jsonFilePath;

      // Read JSON if not already read
      if (!modifiedFiles.has(jsonPath)) {
        const content = await Deno.readTextFile(jsonPath);
        modifiedFiles.set(jsonPath, JSON.parse(content));
      }

      const jsonData = modifiedFiles.get(jsonPath);
      if (!jsonData) continue;

      // Remove each unused property
      for (const warning of unusedWarnings) {
        const propertyPath = warning.path.replace(/^root\./, "");
        if (
          removePropertyFromJson(jsonData, result.resolveType, propertyPath)
        ) {
          totalRemoved++;
        }
      }
    }
  }

  // Save all modified JSONs
  for (const [jsonPath, jsonData] of modifiedFiles) {
    await Deno.writeTextFile(
      jsonPath,
      JSON.stringify(jsonData, null, 2) + "\n",
    );
  }

  console.log(
    `\n✅ ${totalRemoved} property(s) removed from ${modifiedFiles.size} file(s)\n`,
  );
}

/**
 * Removes a specific property from a JSON, searching by __resolveType
 */
function removePropertyFromJson(
  obj: Record<string, unknown>,
  targetResolveType: string,
  propertyPath: string,
): boolean {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  // If found correct __resolveType, remove property by navigating path
  if (obj.__resolveType === targetResolveType) {
    return removePropertyByPath(obj, propertyPath);
  }

  // Search recursively
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (typeof item === "object" && item !== null) {
        if (
          removePropertyFromJson(
            item as Record<string, unknown>,
            targetResolveType,
            propertyPath,
          )
        ) {
          return true;
        }
      }
    }
  } else {
    for (const value of Object.values(obj)) {
      if (typeof value === "object" && value !== null) {
        if (
          removePropertyFromJson(
            value as Record<string, unknown>,
            targetResolveType,
            propertyPath,
          )
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Removes a property by navigating the path (e.g. "images[0].desktop")
 */
function removePropertyByPath(
  obj: Record<string, unknown>,
  path: string,
): boolean {
  // Parse path to navigate correctly
  // E.g. "images[0].desktop" -> ["images", "0", "desktop"]
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");

  let current: unknown = obj;

  // Navigate to the second-to-last level
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];

    if (typeof current !== "object" || current === null) {
      return false;
    }

    if (Array.isArray(current)) {
      const index = parseInt(part, 10);
      if (isNaN(index) || index >= current.length) {
        return false;
      }
      current = current[index];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }

  // Remove the final property
  const lastPart = parts[parts.length - 1];

  if (typeof current !== "object" || current === null) {
    return false;
  }

  if (Array.isArray(current)) {
    const index = parseInt(lastPart, 10);
    if (!isNaN(index) && index < current.length) {
      current.splice(index, 1);
      return true;
    }
  } else {
    const obj = current as Record<string, unknown>;
    if (lastPart in obj) {
      delete obj[lastPart];
      return true;
    }
  }

  return false;
}

/**
 * Removes section files that are not being used
 * (Loaders and actions are ignored as they may be imported or called programmatically)
 */
async function removeUnusedSectionFiles(
  allSectionFiles: string[],
  usedSections: Set<string>,
): Promise<void> {
  console.log("\n🗑️  Removing unused sections...\n");

  // Filter only unused sections (not loaders, actions, Theme, Component or Session)
  const toRemove = allSectionFiles.filter((file) => {
    const isSpecialSection = file.includes("/sections/Theme/") ||
      file.endsWith("/sections/Component.tsx") ||
      file.endsWith("/sections/Session.tsx");
    
    const isLoaderOrAction = file.includes("/loaders/") || file.includes("/actions/");

    return !usedSections.has(file) &&
      file.includes("/sections/") &&
      !isSpecialSection &&
      !isLoaderOrAction;
  });

  if (toRemove.length === 0) {
    console.log("✅ No unused sections found\n");
    return;
  }

  const projectRoot = Deno.cwd();

  console.log(`📋 ${toRemove.length} file(s) will be removed:\n`);
  for (const file of toRemove) {
    const relativePath = relative(projectRoot, file);
    console.log(`  - ${relativePath}`);
  }

  // Confirm removal
  console.log("\n⚠️  This action is irreversible!");
  console.log("Type 'yes' to confirm removal:");

  const buf = new Uint8Array(1024);
  const n = await Deno.stdin.read(buf);
  const confirmation = new TextDecoder().decode(buf.subarray(0, n ?? 0)).trim();

  if (confirmation.toLowerCase() === "yes") {
    let removed = 0;
    for (const file of toRemove) {
      try {
        await Deno.remove(file);
        removed++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`❌ Error removing ${file}: ${message}`);
      }
    }
    console.log(`\n✅ ${removed} file(s) removed\n`);
  } else {
    console.log("\n❌ Removal cancelled\n");
  }
}

// Entry point when run directly
if (import.meta.main) {
  main();
}
