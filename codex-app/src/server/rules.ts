import type { CategoryId } from "../shared/contracts.ts";

export interface RuleInfo {
  /** Kebab-case id that `fallow explain` accepts. */
  rule: string;
  /** Singular title for one finding. */
  title: string;
  category: CategoryId;
}

/**
 * Maps each array key of the fallow `check` (and audit `dead_code`) section to its rule.
 * Fallow adds keys over time; `ruleForKey` derives an entry for a key that is not listed.
 */
const CHECK_RULES: Record<string, RuleInfo> = {
  unused_files: { rule: "unused-file", title: "Unused file", category: "dead-code" },
  unused_exports: { rule: "unused-export", title: "Unused export", category: "dead-code" },
  unused_types: { rule: "unused-type", title: "Unused type", category: "dead-code" },
  unused_enum_members: {
    rule: "unused-enum-member",
    title: "Unused enum member",
    category: "dead-code",
  },
  unused_class_members: {
    rule: "unused-class-member",
    title: "Unused class member",
    category: "dead-code",
  },
  private_type_leaks: {
    rule: "private-type-leak",
    title: "Private type leak",
    category: "architecture",
  },
  deprecated_exports_in_use: {
    rule: "deprecated-export-in-use",
    title: "Deprecated export in use",
    category: "hygiene",
  },
  unused_dependencies: {
    rule: "unused-dependency",
    title: "Unused dependency",
    category: "dependencies",
  },
  unused_dev_dependencies: {
    rule: "unused-dev-dependency",
    title: "Unused dev dependency",
    category: "dependencies",
  },
  unused_optional_dependencies: {
    rule: "unused-optional-dependency",
    title: "Unused optional dependency",
    category: "dependencies",
  },
  unlisted_dependencies: {
    rule: "unlisted-dependency",
    title: "Unlisted dependency",
    category: "dependencies",
  },
  unresolved_imports: {
    rule: "unresolved-import",
    title: "Unresolved import",
    category: "dependencies",
  },
  type_only_dependencies: {
    rule: "type-only-dependency",
    title: "Type-only dependency",
    category: "dependencies",
  },
  test_only_dependencies: {
    rule: "test-only-dependency",
    title: "Test-only dependency",
    category: "dependencies",
  },
  dev_dependencies_in_production: {
    rule: "dev-dependency-in-production",
    title: "Dev dependency in production",
    category: "dependencies",
  },
  unused_catalog_entries: {
    rule: "unused-catalog-entry",
    title: "Unused catalog entry",
    category: "dependencies",
  },
  empty_catalog_groups: {
    rule: "empty-catalog-group",
    title: "Empty catalog group",
    category: "dependencies",
  },
  unresolved_catalog_references: {
    rule: "unresolved-catalog-reference",
    title: "Unresolved catalog reference",
    category: "dependencies",
  },
  unused_dependency_overrides: {
    rule: "unused-dependency-override",
    title: "Unused dependency override",
    category: "dependencies",
  },
  misconfigured_dependency_overrides: {
    rule: "misconfigured-dependency-override",
    title: "Misconfigured dependency override",
    category: "dependencies",
  },
  circular_dependencies: {
    rule: "circular-dependency",
    title: "Circular dependency",
    category: "architecture",
  },
  re_export_cycles: { rule: "re-export-cycle", title: "Re-export cycle", category: "architecture" },
  package_cycles: { rule: "package-cycle", title: "Package cycle", category: "architecture" },
  boundary_violations: {
    rule: "boundary-violation",
    title: "Boundary violation",
    category: "architecture",
  },
  boundary_coverage_violations: {
    rule: "boundary-coverage-violation",
    title: "Boundary coverage gap",
    category: "architecture",
  },
  boundary_call_violations: {
    rule: "boundary-call-violation",
    title: "Boundary call violation",
    category: "architecture",
  },
  policy_violations: {
    rule: "policy-violation",
    title: "Policy violation",
    category: "architecture",
  },
  duplicate_exports: { rule: "duplicate-export", title: "Duplicate export", category: "hygiene" },
  stale_suppressions: {
    rule: "stale-suppression",
    title: "Stale suppression",
    category: "hygiene",
  },
  unused_store_members: {
    rule: "unused-store-member",
    title: "Unused store member",
    category: "frameworks",
  },
  unprovided_injects: {
    rule: "unprovided-inject",
    title: "Unprovided inject",
    category: "frameworks",
  },
  unrendered_components: {
    rule: "unrendered-component",
    title: "Unrendered component",
    category: "frameworks",
  },
  unused_component_props: {
    rule: "unused-component-prop",
    title: "Unused component prop",
    category: "frameworks",
  },
  unused_component_emits: {
    rule: "unused-component-emit",
    title: "Unused component emit",
    category: "frameworks",
  },
  unused_component_inputs: {
    rule: "unused-component-input",
    title: "Unused component input",
    category: "frameworks",
  },
  unused_component_outputs: {
    rule: "unused-component-output",
    title: "Unused component output",
    category: "frameworks",
  },
  unused_svelte_events: {
    rule: "unused-svelte-event",
    title: "Unused Svelte event",
    category: "frameworks",
  },
  unused_server_actions: {
    rule: "unused-server-action",
    title: "Unused server action",
    category: "frameworks",
  },
  unused_load_data_keys: {
    rule: "unused-load-data-key",
    title: "Unused load data key",
    category: "frameworks",
  },
  invalid_client_exports: {
    rule: "invalid-client-export",
    title: "Invalid client export",
    category: "frameworks",
  },
  mixed_client_server_barrels: {
    rule: "mixed-client-server-barrel",
    title: "Mixed client and server barrel",
    category: "frameworks",
  },
  misplaced_directives: {
    rule: "misplaced-directive",
    title: "Misplaced directive",
    category: "frameworks",
  },
  route_collisions: { rule: "route-collision", title: "Route collision", category: "frameworks" },
  dynamic_segment_name_conflicts: {
    rule: "dynamic-segment-name-conflict",
    title: "Dynamic segment name conflict",
    category: "frameworks",
  },
};

const singular = (word: string): string => {
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ses")) return word.slice(0, -2);
  return word.endsWith("s") ? word.slice(0, -1) : word;
};

/** Returns the rule of a `check` array key, derived when fallow added a key this table does not know. */
export const ruleForKey = (key: string): RuleInfo => {
  const known = CHECK_RULES[key];
  if (known !== undefined) return known;
  const words = key.split("_").filter((word) => word.length > 0);
  const last = words.pop() ?? key;
  const rule = [...words, singular(last)].join("-");
  const title = rule.replace(/-/g, " ");
  return { rule, title: title.charAt(0).toUpperCase() + title.slice(1), category: "hygiene" };
};

export const DUPLICATION_RULE: RuleInfo = {
  rule: "code-duplication",
  title: "Duplicated code",
  category: "duplication",
};

/** Maps the `exceeded` field of a health finding to its rule. */
export const complexityRule = (exceeded: string): RuleInfo => {
  if (exceeded === "crap")
    return { rule: "high-crap-score", title: "High CRAP score", category: "complexity" };
  if (exceeded === "cyclomatic") {
    return {
      rule: "high-cyclomatic-complexity",
      title: "High cyclomatic complexity",
      category: "complexity",
    };
  }
  if (exceeded === "cognitive") {
    return {
      rule: "high-cognitive-complexity",
      title: "High cognitive complexity",
      category: "complexity",
    };
  }
  return { rule: "complexity", title: "Complex function", category: "complexity" };
};
