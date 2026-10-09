import type { CategoryId } from "../shared/contracts.ts";

/** Groups a config rule key into the categories that the dashboard uses. */
export const ruleCategory = (key: string): CategoryId => {
  if (/complex|crap/.test(key)) return "complexity";
  if (/cycle|circular|boundary|policy|private-type/.test(key)) return "architecture";
  if (/dependenc|catalog|override|unresolved-import/.test(key)) return "dependencies";
  if (
    /component|svelte|server-action|load-data|store|inject|client|directive|route|segment/.test(key)
  )
    return "frameworks";
  if (/^unused-(file|export|type|enum|class)/.test(key)) return "dead-code";
  if (/duplicat|clone/.test(key)) return "duplication";
  return "hygiene";
};
