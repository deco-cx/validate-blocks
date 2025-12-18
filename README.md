# Section Checker

Script to validate that all occurrences of Sections and Loaders (in blocks and
pages) have data structures compatible with their TypeScript types.

## How to use

### Validate all sections and loaders:

```bash
deno task validate-blocks
```

### Validate a specific section:

```bash
deno task validate-blocks sections/Footer/Footer.tsx
```

or

```bash
deno task validate-blocks sections/Category/CategoryGrid.tsx
```

You can use relative or absolute paths.

### Use custom blocks directory:

By default, the script searches for JSONs in `.deco/blocks`. You can specify another path:

```bash
deno task validate-blocks -blocks /full/path/to/jsons
```

or

```bash
deno task validate-blocks sections/Footer/Footer.tsx -blocks /other/project/.deco/blocks
```

This allows running the script in one project and validating blocks from another project.

### Available flags:

#### `-unused`

**By default**, the script **does not** show warnings for properties not defined in the types. Use this flag to include them:

```bash
deno task validate-blocks -unused
```

or

```bash
deno task validate-blocks sections/Footer/Footer.tsx -unused
```

#### `-blocks <path>` or `-b <path>`

Specifies a custom path for the directory containing JSON blocks. Defaults to `.deco/blocks`:

```bash
deno task validate-blocks -blocks /full/path/to/jsons
```

or combined with other flags:

```bash
deno task validate-blocks sections/Footer/Footer.tsx -blocks /other/project/.deco/blocks -unused
```

#### `-rm-vars`

**⚠️ WARNING: Automatically modifies JSON files!**

Removes all properties that are not defined in the types:

```bash
deno task validate-blocks -rm-vars
```

or for a specific section:

```bash
deno task validate-blocks sections/Footer/Footer.tsx -rm-vars
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

Removes all section/loader files that are not referenced in any JSON:

```bash
deno task validate-blocks -rm-sections
```

The script:

1. Identifies sections/loaders that have no occurrences in JSONs
2. Lists the files that will be removed
3. Asks for confirmation (type `sim` to confirm)
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
Type 'sim' to confirm removal:
```

**Note:** This flag only works for full validation (without specifying a file),
it doesn't work when validating a specific section.

## What it does

The script:

1. **Iterates through all files** in `sections/` and `loaders/`
2. **Generates the `__resolveType`** for each section/loader
3. **Searches for ALL occurrences** of that `__resolveType` in `.deco/blocks`
   (including inside pages)
4. **Extracts the Props interface** from the TypeScript file
5. **Deeply validates** each occurrence against the types
6. **Reports errors and warnings** with exact path in the JSON

## Features

### Intelligent Props Detection

- ✅ Follows **re-exports** (`export { default } from "./other-file"`)
- ✅ Extracts type from the **component parameter** exported as default
- ✅ Fallback to interface/type named **"Props"**
- ✅ Supports **type aliases** and **interfaces**
- ✅ Supports **utility types** (Omit, Pick, Partial)

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

### Severity System

- **✅ Valid** - Block is correct
- **⚠️ Warning** - Props not found OR extra properties not defined in types OR section is not being used (doesn't fail the build)
- **❌ Error** - Required properties missing or incorrect types (fails the build)

## File Structure

```
validate-blocks/
├── main.ts              # Main entrypoint
├── src/
│   ├── type-mapper.ts   # Maps __resolveType to paths
│   ├── ts-parser.ts     # TypeScript parser (extracts Props)
│   ├── validator.ts     # Recursive type validator
│   └── validate-blocks.ts # Orchestrator and reporting
└── README.md            # This documentation
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
Total sections/loaders: 95
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