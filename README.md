# Validate Blocks

A Deno tool to validate that all occurrences of Sections, Loaders, and Actions 
(in deco.cx blocks and pages) have data structures compatible with their TypeScript types.

## Unused Detection Features

The tool detects several types of unused code:

| Type | Detection | Auto-Removal |
|------|-----------|--------------|
| **Unused Sections** | ✅ Detected | ✅ With `-rm-sections` |
| **Unused Loaders** | ✅ Detected | ❌ Manual only* |
| **Unused Actions** | ✅ Detected | ❌ Manual only* |
| **Unused Properties** | ✅ With `-unused` | ✅ With `-rm-vars` |

*Loaders and actions are not auto-removed because they may be imported dynamically or called programmatically.

### Smart Import Analysis

When using `-rm-sections`, the tool performs **import analysis** to avoid false positives:

1. Scans all TypeScript files in the project for import statements
2. Identifies files that are imported in code (e.g., `import { helper } from "site/sections/Utils/Helper.tsx"`)
3. Excludes imported files from the removal list, even if they don't appear in block configurations

This prevents accidentally deleting utility sections or helper files that are used programmatically.

## Anti-Pattern Detection

The tool automatically detects common anti-patterns in block configurations:

| Anti-Pattern | Description | Impact |
|--------------|-------------|--------|
| **Dead Code** | Variants with `never` matcher rule | Code that will never execute |
| **Lazy wrapping Multivariate** | `Lazy` section containing a `multivariate` inside | Performance issue - multivariate should wrap Lazy, not the other way around |

### Example Output

```
🚨 ANTI-PATTERNS DETECTED

💀 Dead Code (3 sections with 'never' rule):

   📄 pages-Home-287364.json: 2 dead code section(s)
   📄 pages-category-7493d4.json: 1 dead code section(s)

⚠️  Lazy wrapping Multivariate (1 instances):

   📄 pages-productpage-ce4850.json
      Path: sections[5].value
      Lazy wrapping multivariate is an anti-pattern. Multivariate should wrap Lazy, not the other way around.
```

Anti-pattern counts are included in the validation report when using `-report`.

## How to Run

### Run directly (recommended)

No installation needed - just run from any deco site directory:

```bash
# Validate all sections, loaders, and actions
deno run -A https://deco.cx/validate

# Generate a JSON report
deno run -A https://deco.cx/validate -report validation-report.json
```

### Add as a deno task (optional)

Add to your site's `deno.json` for convenience:

```json
{
  "tasks": {
    "validate-blocks": "deno run -A https://deco.cx/validate"
  }
}
```

Then run:

```bash
deno task validate-blocks
```

## Usage Examples

### Validate all sections, loaders, and actions:

```bash
deno run -A https://deco.cx/validate
```

### Validate a specific section:

```bash
deno run -A https://deco.cx/validate sections/Footer/Footer.tsx
```

You can use relative or absolute paths.

### Use custom blocks directory:

By default, the script searches for JSONs in `.deco/blocks`. You can specify another path:

```bash
deno run -A https://deco.cx/validate -blocks /full/path/to/jsons
```

This allows running the script in one project and validating blocks from another project.

### Available flags:

#### `-unused`

**By default**, the script **does not** show warnings for properties not defined in the types. Use this flag to include them:

```bash
deno run -A https://deco.cx/validate -unused
```

#### `-blocks <path>` or `-b <path>`

Specifies a custom path for the directory containing JSON blocks. Defaults to `.deco/blocks`:

```bash
deno run -A https://deco.cx/validate -blocks /full/path/to/jsons
```

#### `-rm-vars`

**⚠️ WARNING: Automatically modifies JSON files!**

Removes all properties that are not defined in the types:

```bash
deno run -A https://deco.cx/validate -rm-vars
```

The script:

1. Identifies properties in the JSON that don't exist in the `Props` interface
2. Removes these properties automatically
3. Saves the modified JSON file

**Example:**

If the JSON has:

```json
{
  "__resolveType": "site/sections/Footer/Footer.tsx",
  "title": "Footer",
  "teste": "unused value" // <- not in Props interface
}
```

After running `-rm-vars`, the JSON becomes:

```json
{
  "__resolveType": "site/sections/Footer/Footer.tsx",
  "title": "Footer"
}
```

#### `-rm-sections`

**⚠️ WARNING: Permanently deletes files!**

Removes all section files that are not referenced in any JSON:

```bash
deno run -A https://deco.cx/validate -rm-sections
```

The script:

1. Identifies sections/loaders that have no occurrences in JSONs
2. Lists the files that will be removed
3. Asks for confirmation (type `yes` to confirm)
4. Permanently deletes the files

**Example output:**

```
🗑️  Removing unused sections/loaders...

📋 15 file(s) will be removed:

  - sections/Category/CategoryGrid.tsx
  - sections/Institutional/NumbersWithImage.tsx
  - sections/Product/ProductShelf.tsx
  ...

⚠️  This action is irreversible!
Type 'yes' to confirm removal:
```

**Note:** This flag only works for full validation (without specifying a file),
it doesn't work when validating a specific section.

## What it does

The script:

1. **Iterates through all files** in `sections/`, `loaders/`, and `actions/`
2. **Generates the `__resolveType`** for each section/loader/action
3. **Searches for ALL occurrences** of that `__resolveType` in `.deco/blocks`
   (including inside pages)
4. **Extracts the Props interface** from the TypeScript file
5. **Deeply validates** each occurrence against the types
6. **Reports errors and warnings** with exact path in the JSON
7. **Detects unused files** that aren't referenced anywhere

## Features

### Intelligent Props Detection

- ✅ Follows **re-exports** (`export { default } from "./other-file"`)
- ✅ **Resolves Deno import aliases** from `deno.json` (`$store/`, `$home/`, `site/`, etc.)
- ✅ Extracts type from the **component parameter** exported as default
- ✅ Fallback to interface/type named **"Props"**
- ✅ Supports **type aliases** and **interfaces**
- ✅ Supports **utility types** (Omit, Pick, Partial)
- ✅ Supports **arrow function components** and **function declarations**

### Deep Validation

- ✅ Primitive types: `string`, `number`, `boolean`, `null`
- ✅ Arrays with element validation
- ✅ Nested objects recursively
- ✅ Optional properties (`?`)
- ✅ Union types (`string | number`)
- ✅ Special types: `ImageWidget`, `Product`, `RichText`, etc
- ✅ Respects `@ignore` annotation on properties
- ⚠️ **Detects extra properties** not defined in types (warnings)

### Protections

- ✅ Ignores blocks from external apps (vtex, commerce, shopify, etc)
- ✅ Ignores Theme blocks
- ✅ Protection against infinite recursion in circular types

### Anti-Pattern Detection

- ✅ Detects **dead code** (variants with `never` matcher)
- ✅ Detects **Lazy wrapping Multivariate** (should be inverted)
- ✅ Reports anti-patterns in summary and JSON report

### Severity System

- **✅ Valid** - Block is correct
- **⚠️ Warning** - Props not found OR extra properties not defined in types OR section is not being used (doesn't fail the build)
- **🚨 Anti-pattern** - Configuration issues that may cause performance problems or dead code
- **❌ Error** - Required properties missing or incorrect types (fails the build)

#### `-report [path]` or `-r [path]`

Generates a JSON report file with validation results:

```bash
# Default: creates validation-report.json
deno run -A https://deco.cx/validate -report

# Custom path
deno run -A https://deco.cx/validate -report my-report.json
```

The report includes:
- Summary with total counts (sections, errors, warnings, unused)
- Detailed list of sections with errors (including file, line, property, message)
- Detailed list of sections with warnings
- List of unused sections

**Example report structure:**

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "projectRoot": "/path/to/project",
  "summary": {
    "totalSections": 133,
    "totalOccurrences": 1606,
    "totalErrors": 15,
    "totalWarnings": 4,
    "sectionsWithErrors": 5,
    "sectionsWithWarnings": 10,
    "unusedSections": 8,
    "validSections": 110
  },
  "sectionsWithErrors": [...],
  "sectionsWithWarnings": [...],
  "unusedSections": [...]
}
```

## File Structure

```
validate-blocks/
├── main.ts              # Main entrypoint
├── deno.json            # Deno configuration and tasks
├── src/
│   ├── type-mapper.ts   # Maps __resolveType to paths
│   ├── ts-parser.ts     # TypeScript parser (extracts Props)
│   ├── validator.ts     # Recursive type validator
│   └── validate-blocks.ts # Orchestrator and reporting
├── tests/
│   ├── ts-parser_test.ts    # Tests for TypeScript parser
│   ├── validator_test.ts    # Tests for validator
│   ├── type-mapper_test.ts  # Tests for type mapper
│   └── fixtures/            # Test fixtures
└── README.md            # This documentation
```

## Running Tests

```bash
# Run all tests
deno test -A

# Run specific test file
deno test -A tests/validator_test.ts

# Run with verbose output
deno test -A --reporter=verbose
```

## Example Output

```
🔍 Validating sections and loaders...

✅ sections/Header/Header.tsx - 15 occurrence(s)
✅ sections/Footer/Footer.tsx - 1 occurrence(s)

⚠️  sections/Footer/Footer.tsx - 1 occurrence(s), 2 warning(s)

Footer.json

  - property not defined in types (can be removed) (.deco/blocks/Footer.json:265)
  - property not defined in types (can be removed) (.deco/blocks/Footer.json:273)

❌ sections/Category/CategoryGrid.tsx - 1 occurrence(s), 1 error(s)

Preview%20%2Fsections%2FCategory%2FCategoryGrid.tsx.json

  - "items": required property missing (.deco/blocks/Preview%20%2Fsections%2FCategory%2FCategoryGrid.tsx.json:2)

❌ sections/Sac/Stores.tsx - 2 occurrence(s), 2 error(s)

pages-Lojas-735837.json

  - expected array, received object (.deco/blocks/pages-Lojas-735837.json:57)
  - expected array, received object (.deco/blocks/pages-Lojas-735837.json:73)

═══════════════════════════════════════
📊 SUMMARY
═══════════════════════════════════════
Total sections/loaders/actions: 95
Total occurrences: 284
✅ No issues: 85
⚠️ With warnings: 3
⚠️ Unused: 3
❌ With errors: 4

⚠️  Unused sections:
  - sections/Example/Unused.tsx
  - sections/Test/OldComponent.tsx

❌ Sections with errors:
  - sections/Category/CategoryGrid.tsx (1 error(s))
```

**Note:** The script shows the path and line of the JSON file in clickable format
(ex: `.deco/blocks/pages-Lojas-735837.json:61`). In most modern terminals
(VSCode, Cursor, iTerm2), you can click directly on the link to
open the file at the exact line of the problem.

## Usage Examples

### Validate all sections

```bash
deno task validate-blocks
```

### Validate specific section during development

```bash
deno task validate-blocks sections/Header/Header.tsx
```

### Validate specific loader

```bash
deno task validate-blocks loaders/Product/categoryTabs.ts
```

### Show unused properties

```bash
# All sections with warnings for extra props
deno task validate-blocks -unused

# Specific section with warnings for extra props
deno task validate-blocks sections/Footer/Footer.tsx -unused
```

## Portability

All code is organized in the `src` folder to facilitate migration
to another repository.