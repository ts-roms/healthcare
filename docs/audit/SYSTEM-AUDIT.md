# Claude Prompt: Codebase Audit, Dead Code Detection & Duplicate Implementation Cleanup

## Role

Act as a **Senior Software Architect, Staff Engineer, and Code Quality Auditor**. Perform a comprehensive, evidence-based audit of the existing codebase to identify unused functions, imports, variables, packages, files, duplicate implementations, redundant logic, and unnecessary complexity.

Your goal is to improve maintainability, reduce technical debt, eliminate unnecessary code, and simplify the codebase while preserving all existing functionality and behavior.

**Do not refactor blindly. Audit first, verify every finding, and make changes only when supported by evidence.**

## Phase 1: Codebase Discovery and Architecture Analysis

Before making any changes:

1. Inspect the repository structure and identify:
   - Frontend and backend applications.
   - Modules, components, services, controllers, hooks, utilities, and shared libraries.
   - Entry points, routing, middleware, background jobs, scheduled tasks, and event handlers.
   - Configuration files, build scripts, test infrastructure, and package manifests.
2. Identify the language, frameworks, build tools, package managers, and existing architectural patterns.
3. Review the available linting, type-checking, testing, and build commands.
4. Inspect the Git working tree and preserve all existing user modifications.
5. Identify dynamically loaded modules, reflection, dependency injection, plugin registries, framework conventions, and other patterns that may make code appear unused.

Do not assume a function, file, or package is unused merely because it has no obvious direct references.

## Phase 2: Unused Code Audit

Identify and classify the following:

### A. Unused imports
- Imported functions, types, classes, constants, and modules that are never referenced.
- Imports that became redundant after previous refactoring.
- Duplicate imports from the same module.
- Imports that exist only for required side effects, ensuring these are preserved.

### B. Unused functions and methods
- Exported and non-exported functions with no verified callers.
- Unused class methods and service methods.
- Unused React hooks, custom hooks, callbacks, and event handlers.
- Unused utility functions and helper methods.
- Obsolete functions superseded by newer implementations.

### C. Unused variables and constants
- Unreferenced variables, constants, parameters, and state declarations.
- Unnecessary state and derived values that can be calculated directly.
- Dead assignments and values that are overwritten before being read.
- Unused types, interfaces, enums, schemas, and constants.

### D. Unused files and modules
- Source files with no verified importers or runtime references.
- Obsolete components, services, API clients, and utilities.
- Unused tests, fixtures, mock files, and outdated implementations.
- Orphaned modules that are no longer registered or exposed.

Check framework conventions and implicit entry points before recommending file deletion.

## Phase 3: Dependency and Package Audit

Inspect all relevant package manifests and lockfiles.

Identify:

1. Dependencies that are installed but not used by the application.
2. Development dependencies that are no longer required.
3. Packages duplicated across dependencies and development dependencies.
4. Packages that are direct dependencies but are only used transitively.
5. Dependencies that can potentially be replaced by existing native APIs or already-installed libraries.
6. Multiple packages providing substantially overlapping functionality.
7. Outdated or abandoned packages, where verifiable information is available.
8. Unnecessary dependencies that increase bundle size, installation time, security exposure, or maintenance overhead.
9. Unused workspace packages and redundant internal libraries.

For JavaScript and TypeScript projects, use the existing package manager and appropriate dependency-analysis tools when available.

Check scripts, configuration files, build tooling, code generation, testing, migrations, and CI workflows before removing any package.

**Important:** Do not remove transitive dependencies directly, regenerate the lockfile unnecessarily, or upgrade packages as part of this audit unless explicitly approved.

## Phase 4: Duplicate Implementation Detection

Find code that implements the same or substantially similar behavior in multiple places.

Audit for:

- Duplicate functions with different names but equivalent logic.
- Repeated validation and transformation logic.
- Duplicate API requests, service methods, and data-access implementations.
- Components with nearly identical markup and behavior.
- Repeated business rules across frontend and backend.
- Similar hooks, utilities, formatters, and helper functions.
- Duplicate schemas, types, interfaces, constants, and configuration values.
- Repeated permission checks and authorization logic.
- Redundant error-handling and retry implementations.
- Multiple implementations of the same calculation or workflow.
- Legacy implementations that coexist with their replacements.

For each potential duplicate:

1. Identify all affected files and functions.
2. Compare behavior, parameters, return values, side effects, and error handling.
3. Determine whether the duplication is intentional due to different business contexts.
4. Recommend a shared implementation only when it improves clarity and maintainability.
5. Preserve existing public interfaces unless a breaking change is explicitly approved.

Do not consolidate code simply because it looks similar. Avoid creating overly generic abstractions that make the system harder to understand.

## Phase 5: Dead Code and Redundant Logic

Inspect for:

- Unreachable branches and statements.
- Conditions that can never be true under valid inputs.
- Redundant conditionals and repeated checks.
- Unnecessary wrappers and forwarding functions.
- Deprecated code paths that are no longer used.
- Feature flags that are permanently disabled or obsolete.
- Duplicate API endpoints or routes.
- Redundant state management and unnecessary effects.
- Unused configuration properties and environment variables.
- Commented-out code that has no documented purpose.
- Repeated calculations that can safely be simplified.
- Redundant exception handling or logging.

Distinguish confirmed dead code from code that is conditionally executed or required by an external consumer.

Do not remove audit logs, security checks, compliance controls, permission enforcement, or business-critical safeguards simply because they appear redundant.

## Phase 6: Evidence and Risk Classification

Every finding must include:

- Finding ID.
- Category.
- File path and line number or symbol name.
- Relevant references or evidence.
- Reason the code appears unused, duplicated, or redundant.
- Confidence level: High, Medium, or Low.
- Risk level: Low, Medium, High, or Critical.
- Recommended action: Remove, Consolidate, Investigate, or Keep.
- Dependencies and potential side effects.
- Verification steps required before cleanup.

Use these classifications:

- **Confirmed:** Strong evidence supports removal or consolidation.
- **Probable:** Available static analysis suggests the code is unnecessary, but runtime verification is still required.
- **Needs investigation:** Dynamic usage, external consumers, framework conventions, or incomplete references prevent a safe conclusion.
- **Intentional:** Similarity or apparent inactivity is justified by architectural or business requirements.

Do not classify code as confirmed unused based solely on the absence of text-search matches.

## Phase 7: Generate the Audit Report

Before modifying source files, produce a structured report with the following sections:

### 1. Executive Summary
- Overall codebase health observations.
- Total findings by category.
- High-risk issues requiring investigation.
- Potential cleanup opportunities.
- Main limitations of the audit.

### 2. Unused Code Inventory
A table containing the file, symbol, category, evidence, confidence, risk, and recommended action.

### 3. Dependency Audit
A table listing each potentially unused or redundant package, its purpose, evidence of usage, removal risk, and recommendation.

### 4. Duplicate Implementation Inventory
A table identifying the duplicated implementations, their locations, behavioral differences, and proposed canonical implementation.

### 5. Dead Code and Redundant Logic
List obsolete branches, redundant conditions, unused configurations, and other simplification opportunities.

### 6. Prioritized Cleanup Plan
Group findings into:

- **Priority 1:** Safe, high-confidence cleanup.
- **Priority 2:** Duplicate logic consolidation.
- **Priority 3:** Dependency and architectural cleanup.
- **Priority 4:** Risky or uncertain items requiring manual review.

### 7. Validation Plan
Define the checks required to demonstrate that the cleanup has not introduced regressions.

Include a baseline comparison against the current codebase.

## Phase 8: Controlled Cleanup Implementation

After completing the audit report, proceed with the following rules:

1. Start with high-confidence, low-risk changes only.
2. Remove verified unused imports, variables, and local declarations.
3. Delete functions, files, and modules only after verifying that they have no required runtime or external consumers.
4. Consolidate duplicated implementations only after comparing behavior and identifying a canonical implementation.
5. Remove dependencies only after checking manifests, scripts, configurations, dynamic imports, and tooling requirements.
6. Preserve existing naming conventions, architecture, module boundaries, and coding standards.
7. Avoid unrelated refactoring, feature development, formatting changes across unrelated files, and package upgrades.
8. Keep changes small and logically grouped so they can be reviewed and reverted independently.
9. Do not modify environment secrets, production data, or deployment configuration unless specifically authorized.
10. Do not overwrite unrelated user changes or reset the Git working tree.

If the repository is too large to audit in one pass, divide it into logical modules and maintain a checklist of completed and pending areas.

## Phase 9: Automated Validation

After each cleanup group, run the relevant available checks:

- Linting.
- Type checking.
- Unit tests.
- Integration tests.
- Production build.
- Dependency consistency checks.
- Relevant end-to-end tests.
- Bundle-size comparison, where applicable.
- Import and export verification.
- Application startup and critical workflow checks, where practical.

Compare the results against the pre-cleanup baseline.

If a check fails:

1. Determine whether the failure existed before the cleanup.
2. Identify whether the cleanup introduced or exposed the failure.
3. Fix regressions caused by the cleanup.
4. Revert the affected change if a safe correction cannot be established.
5. Clearly document any pre-existing or unresolved failures.

Never claim that tests or builds passed unless they were actually executed and their results were observed.

## Phase 10: Final Audit and Change Summary

When finished, provide:

- Total findings discovered.
- Total findings resolved.
- Total findings deferred for investigation.
- Unused imports and variables removed.
- Functions, files, and modules removed.
- Duplicate implementations consolidated.
- Dependencies removed, if any.
- Files modified and deleted.
- Tests and validation commands executed.
- Before-and-after build or bundle metrics, if measured.
- Remaining risks and limitations.
- Recommended follow-up actions.

Clearly separate completed changes from recommendations that have not been implemented.

## Non-Negotiable Rules

- Audit before modifying.
- Evidence before deletion.
- Preserve existing behavior.
- Do not guess whether code is unused.
- Do not remove code solely to reduce line count.
- Do not over-engineer shared abstractions.
- Do not introduce new dependencies unless explicitly approved.
- Do not perform broad rewrites.
- Do not silently ignore failing tests.
- Do not claim verification without evidence.
- Preserve security, authorization, financial calculations, audit trails, and compliance-related behavior.
- Ask for approval before destructive or high-risk changes.

## Start Here

First, inspect the repository and determine the available analysis tools and validation commands.

Then perform the audit and present the initial findings report **without changing any files**.

After the report, proceed only with high-confidence, low-risk cleanup that is consistent with the rules above. Keep the changes reviewable and provide a complete final summary.

The objective is a cleaner, safer, more maintainable codebase—not merely fewer lines of code.