import { isAbsolute } from "node:path";

/**
 * `fallow://` resource URIs carry the project root as base64url, so a mention stays readable
 * after a server restart without a lookup table.
 */

export const projectKey = (root: string): string => Buffer.from(root, "utf8").toString("base64url");

export const rootFromKey = (key: string): string | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return null;
  const root = Buffer.from(key, "base64url").toString("utf8");
  return isAbsolute(root) ? root : null;
};

export const findingUri = (root: string, id: string): string =>
  `fallow://project/${projectKey(root)}/finding/${encodeURIComponent(id)}`;

export const ruleUri = (root: string, rule: string): string =>
  `fallow://project/${projectKey(root)}/rule/${encodeURIComponent(rule)}`;


export const FINDING_TEMPLATE = "fallow://project/{key}/finding/{id}";
export const RULE_TEMPLATE = "fallow://project/{key}/rule/{rule}";
export const REPORT_TEMPLATE = "fallow://project/{key}/report";
