import nx from "@nx/eslint-plugin";
import prettier from "eslint-config-prettier";

/**
 * Module boundaries (CLAUDE.md §4). Every project carries two tags in its
 * package.json `nx.tags`:
 *
 *   type:*  — the layer. Lower layers never import higher ones.
 *     app → feature → ui → data-access → contract → domain → util
 *
 *   scope:* — who owns it.
 *     staff / portal       app-specific code
 *     shared               usable by everyone
 *     clinic, laboratory…  a clinical domain: it may use its own scope and
 *                          `shared`, and reach another domain ONLY through
 *                          that domain's `type:contract` library.
 *                          (e.g. Clinic → Laboratory Order contract → Laboratory)
 *
 * Adding a domain library: tag it `scope:<domain>` + a `type:*`, and add the
 * scope to DOMAIN_SCOPES below.
 */
const DOMAIN_SCOPES = [
  "patient",
  "clinic",
  "laboratory",
  "dental",
  "telemedicine",
  "care-plan",
  "billing",
  "interoperability",
  "notification",
  "audit",
  "documents",
];

const LAYERS = {
  "type:app": ["type:feature", "type:ui", "type:data-access", "type:contract", "type:domain", "type:util"],
  "type:feature": ["type:feature", "type:ui", "type:data-access", "type:contract", "type:domain", "type:util"],
  "type:ui": ["type:ui", "type:contract", "type:domain", "type:util"],
  "type:data-access": ["type:data-access", "type:contract", "type:domain", "type:util"],
  "type:contract": ["type:contract", "type:domain", "type:util"],
  "type:domain": ["type:domain", "type:util"],
  "type:util": ["type:util"],
};

export const depConstraints = [
  ...Object.entries(LAYERS).map(([sourceTag, onlyDependOnLibsWithTags]) => ({ sourceTag, onlyDependOnLibsWithTags })),
  { sourceTag: "scope:shared", onlyDependOnLibsWithTags: ["scope:shared"] },
  { sourceTag: "scope:staff", onlyDependOnLibsWithTags: ["scope:staff", "scope:shared", ...DOMAIN_SCOPES.map((s) => `scope:${s}`)] },
  { sourceTag: "scope:portal", onlyDependOnLibsWithTags: ["scope:portal", "scope:shared", ...DOMAIN_SCOPES.map((s) => `scope:${s}`)] },
  ...DOMAIN_SCOPES.map((s) => ({ sourceTag: `scope:${s}`, onlyDependOnLibsWithTags: [`scope:${s}`, "scope:shared", "type:contract"] })),
];

export default [
  {
    ignores: ["**/dist", "**/.next", "**/out", "**/storybook-static", "**/.nx", "**/node_modules", "**/next-env.d.ts"],
  },
  ...nx.configs["flat/base"],
  ...nx.configs["flat/typescript"],
  ...nx.configs["flat/javascript"],
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"],
    rules: {
      "@nx/enforce-module-boundaries": [
        "error",
        {
          enforceBuildableLibDependency: true,
          checkDynamicDependenciesExceptions: [],
          allow: [],
          // A project with no matching tag may not depend on anything, so every project must be tagged.
          depConstraints,
        },
      ],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Project eslint configs extend the root config by relative path; that is tooling, not a project dependency.
    files: ["**/eslint.config.mjs"],
    rules: { "@nx/enforce-module-boundaries": "off" },
  },
  prettier,
];
