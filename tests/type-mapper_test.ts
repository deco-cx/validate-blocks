import { assertEquals } from "@std/assert";
import {
  resolveTypeToFile,
  filePathToResolveType,
  isSection,
  isLoader,
  isAction,
  getFileName,
} from "../src/type-mapper.ts";

// ============================================================================
// resolveTypeToFile TESTS
// ============================================================================

Deno.test("resolveTypeToFile - converts site/ prefix to absolute path", () => {
  const result = resolveTypeToFile(
    "site/sections/Header/Header.tsx",
    "/Users/test/project"
  );
  assertEquals(result, "/Users/test/project/sections/Header/Header.tsx");
});

Deno.test("resolveTypeToFile - handles path without site/ prefix", () => {
  const result = resolveTypeToFile(
    "sections/Footer/Footer.tsx",
    "/Users/test/project"
  );
  assertEquals(result, "/Users/test/project/sections/Footer/Footer.tsx");
});

Deno.test("resolveTypeToFile - handles loaders", () => {
  const result = resolveTypeToFile(
    "site/loaders/user.ts",
    "/Users/test/project"
  );
  assertEquals(result, "/Users/test/project/loaders/user.ts");
});

Deno.test("resolveTypeToFile - handles nested paths", () => {
  const result = resolveTypeToFile(
    "site/sections/Product/Details/Gallery.tsx",
    "/Users/test/project"
  );
  assertEquals(result, "/Users/test/project/sections/Product/Details/Gallery.tsx");
});

// ============================================================================
// filePathToResolveType TESTS
// ============================================================================

Deno.test("filePathToResolveType - converts absolute path to site/ prefix", () => {
  const result = filePathToResolveType(
    "/Users/test/project/sections/Header/Header.tsx",
    "/Users/test/project"
  );
  assertEquals(result, "site/sections/Header/Header.tsx");
});

Deno.test("filePathToResolveType - handles loaders", () => {
  const result = filePathToResolveType(
    "/Users/test/project/loaders/user.ts",
    "/Users/test/project"
  );
  assertEquals(result, "site/loaders/user.ts");
});

Deno.test("filePathToResolveType - handles nested paths", () => {
  const result = filePathToResolveType(
    "/Users/test/project/sections/Product/Details/Gallery.tsx",
    "/Users/test/project"
  );
  assertEquals(result, "site/sections/Product/Details/Gallery.tsx");
});

// ============================================================================
// isSection TESTS
// ============================================================================

Deno.test("isSection - returns true for section paths", () => {
  assertEquals(isSection("site/sections/Header.tsx"), true);
  assertEquals(isSection("site/sections/Footer/Footer.tsx"), true);
  assertEquals(isSection("/sections/Test.tsx"), true);
});

Deno.test("isSection - returns false for non-section paths", () => {
  assertEquals(isSection("site/loaders/user.ts"), false);
  assertEquals(isSection("site/components/Button.tsx"), false);
  assertEquals(isSection("site/islands/Cart.tsx"), false);
});

// ============================================================================
// isLoader TESTS
// ============================================================================

Deno.test("isLoader - returns true for loader paths", () => {
  assertEquals(isLoader("site/loaders/user.ts"), true);
  assertEquals(isLoader("site/loaders/product/list.ts"), true);
  assertEquals(isLoader("/loaders/test.ts"), true);
});

Deno.test("isLoader - returns false for non-loader paths", () => {
  assertEquals(isLoader("site/sections/Header.tsx"), false);
  assertEquals(isLoader("site/components/Button.tsx"), false);
  assertEquals(isLoader("site/islands/Cart.tsx"), false);
});

// ============================================================================
// isAction TESTS
// ============================================================================

Deno.test("isAction - returns true for action paths", () => {
  assertEquals(isAction("site/actions/addToCart.ts"), true);
  assertEquals(isAction("site/actions/checkout/submit.ts"), true);
  assertEquals(isAction("/actions/test.ts"), true);
});

Deno.test("isAction - returns false for non-action paths", () => {
  assertEquals(isAction("site/sections/Header.tsx"), false);
  assertEquals(isAction("site/loaders/user.ts"), false);
  assertEquals(isAction("site/components/Button.tsx"), false);
});

// ============================================================================
// getFileName TESTS
// ============================================================================

Deno.test("getFileName - extracts filename without extension (.tsx)", () => {
  const result = getFileName("site/sections/Header/Header.tsx");
  assertEquals(result, "Header");
});

Deno.test("getFileName - extracts filename without extension (.ts)", () => {
  const result = getFileName("site/loaders/user.ts");
  assertEquals(result, "user");
});

Deno.test("getFileName - extracts filename without extension (.jsx)", () => {
  const result = getFileName("site/sections/Button.jsx");
  assertEquals(result, "Button");
});

Deno.test("getFileName - extracts filename without extension (.js)", () => {
  const result = getFileName("site/utils/helper.js");
  assertEquals(result, "helper");
});

Deno.test("getFileName - handles deeply nested paths", () => {
  const result = getFileName("site/sections/Product/Details/Images/Gallery.tsx");
  assertEquals(result, "Gallery");
});
