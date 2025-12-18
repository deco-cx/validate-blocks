# Deco Section Validator

A TypeScript validator for Deco CMS section configurations. This tool validates
JSON configuration files in `.deco/blocks/` against their corresponding
TypeScript section definitions.

## Overview

The validator performs three main checks:

1. **Property Validation**: Verifies that JSON configurations match the expected
   TypeScript prop types
2. **Unresolved ResolveTypes**: Identifies `__resolveType` values that cannot be
   resolved to actual section files
3. **Unused Saved Blocks**: Finds saved blocks that are defined but never
   referenced

## Architecture

The codebase is organized into the following modules:

### `types.ts`

Defines all TypeScript interfaces used throughout the application:

- `Property`: Represents a TypeScript property with name, type, and optional
  flag
- `ValidationError`: Contains validation error information
- `ValidationResult`: Result of validating a JSON file
- `SectionInJson`: Represents a section found in JSON configuration

### `type-parser.ts`

Handles parsing and extraction of TypeScript type information:

- **`removeComments()`**: Strips JSDoc and line comments from TypeScript code
- **`extractObjectLiteralProperties()`**: Extracts properties from TypeScript
  object literal types
- **`findTypeImports()`**: Finds type imports in TypeScript files
- **`resolveImportPath()`**: Resolves relative import paths to absolute file
  paths
- **`findTypeDefinition()`**: Finds interface or type definitions by name
- **`mergeProperties()`**: Merges two property lists, with the second overriding
  the first
- **`resolveType()`**: Resolves a type expression (object literal, intersection,
  or named type) to its properties
- **`getExportDefaultFunctionProps()`**: Extracts props type from
  `export default function` declarations

### `section-finder.ts`

Finds sections within JSON configuration files:

- **`shouldIgnore()`**: Determines if a resolveType should be ignored (not from
  current app)
- **`findSectionsInJson()`**: Recursively traverses JSON to find all sections
  with `__resolveType`

### `block-manager.ts`

Manages saved blocks and section file resolution:

- **`isSavedBlock()`**: Checks if a resolveType refers to a saved block
- **`isAppSection()`**: Checks if a resolveType refers to a section in the
  current app
- **`blockNameToFileName()`**: Converts block name to URL-encoded filename
- **`fileNameToBlockName()`**: Converts filename back to block name
- **`resolveTypeToPath()`**: Converts resolveType to possible file paths
- **`getSavedBlockContent()`**: Reads content of a saved block JSON file
- **`getSectionContent()`**: Reads content of a section TypeScript file

### `validator.ts`

Core validation logic:

- **`isNumericIndex()`**: Checks if a property name is a numeric index (array
  serialization artifact)
- **`isPrimitiveType()`**: Checks if a type is primitive (doesn't need recursive
  validation)
- **`validateProps()`**: Recursively validates JSON properties against expected
  TypeScript properties
- **`validateJsonFile()`**: Main validation function that processes a JSON file
  and all its sections

### `main.ts`

Entry point that orchestrates the validation process:

1. Finds all JSON files in `.deco/blocks/`
2. Validates each file
3. Tracks used saved blocks
4. Identifies unused saved blocks (excluding `pages-*`, `Preview`, and
   `redirect-*` files)
5. Reports all errors, unresolved resolveTypes, and unused blocks

## How It Works

### 1. Finding Sections

The validator recursively traverses JSON files looking for objects with
`__resolveType` properties. When found:

- If the resolveType is from another app (starts with `website/`), it's ignored
  but nested sections are still searched
- If it's a saved block (no `/` or `.` in certain patterns), it's processed
  recursively
- If it's a section from the current app (starts with `site/`), it's validated

### 2. Type Extraction

For each section, the validator:

1. Reads the TypeScript file based on the resolveType
2. Finds the `export default function` declaration
3. Extracts the props type from the function signature
4. Resolves the type (handles object literals, intersections, and named types)
5. If the type is imported, follows the import chain

### 3. Property Validation

For each property in the JSON:

1. Checks if required properties are present
2. Checks for unexpected properties
3. For non-primitive types, recursively validates nested objects
4. Ignores numeric indices in arrays (serialization artifacts)

### 4. Saved Block Tracking

- When a saved block is referenced, it's added to the `usedSavedBlocks` set
- After processing all files, compares used blocks against available blocks
- Blocks in `pages-*`, `Preview`, and `redirect-*` files are excluded from the
  unused list

## Usage

```bash
deno run --allow-read main.ts
```

The script will:

- Validate all JSON files in `.deco/blocks/`
- Report validation errors
- List unresolved resolveTypes
- List unused saved blocks

## Error Messages

- **Missing required property**: A required property is missing from the JSON
- **Unexpected property**: A property exists in JSON but not in the TypeScript
  definition
- **Section not found**: A resolveType cannot be resolved to a file
- **Saved block not found**: A saved block reference points to a non-existent
  file
- **Circular reference detected**: A saved block references itself (directly or
  indirectly)
- **Saved block should not have extra properties**: A saved block reference has
  properties beyond `__resolveType`
