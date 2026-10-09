import { CATEGORY_ORDER } from "../shared/categories.ts";
import type { CategoryId } from "../shared/contracts.ts";

export type Tab = "overview" | "findings" | "insights";

export interface Route {
  tab: Tab;
  category: CategoryId | null;
  query: string;
  findingId: string | null;
}

/** Reads a deep link such as `/findings?category=dead-code&q=money` or `/finding/<id>`. */
export const parseRoute = (url: string | null): Route => {
  const fallback: Route = { tab: "overview", category: null, query: "", findingId: null };
  if (url === null) return fallback;
  let parsed: URL;
  try {
    parsed = new URL(url, "https://app.invalid");
  } catch {
    return fallback;
  }
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  const category = parsed.searchParams.get("category");
  const validCategory = CATEGORY_ORDER.includes(category as CategoryId)
    ? (category as CategoryId)
    : null;
  if (segments[0] === "finding" && segments[1] !== undefined) {
    return { ...fallback, tab: "findings", findingId: decodeURIComponent(segments[1]) };
  }
  if (segments[0] === "findings") {
    return {
      ...fallback,
      tab: "findings",
      category: validCategory,
      query: parsed.searchParams.get("q") ?? "",
    };
  }
  if (segments[0] === "insights") return { ...fallback, tab: "insights" };
  return fallback;
};
