import type { CategoryId } from "./contracts.ts";

export const CATEGORY_ORDER: readonly CategoryId[] = [
  "dead-code",
  "dependencies",
  "duplication",
  "complexity",
  "architecture",
  "frameworks",
  "hygiene",
];

export const CATEGORY_TITLES: Record<CategoryId, string> = {
  "dead-code": "Dead code",
  dependencies: "Dependencies",
  duplication: "Duplication",
  complexity: "Complexity",
  architecture: "Architecture",
  frameworks: "Frameworks",
  hygiene: "Hygiene",
};

export const emptyCategoryCounts = (): Record<CategoryId, number> => ({
  "dead-code": 0,
  dependencies: 0,
  duplication: 0,
  complexity: 0,
  architecture: 0,
  frameworks: 0,
  hygiene: 0,
});

/** One hue per category, readable on light and dark backgrounds. */
export const CATEGORY_COLORS: Record<CategoryId, string> = {
  "dead-code": "#e5484d",
  dependencies: "#f76b15",
  duplication: "#8e4ec6",
  complexity: "#0090ff",
  architecture: "#12a594",
  frameworks: "#d6409f",
  hygiene: "#8d8d86",
};

/** 20 x 20 stroke glyphs, drawn with `currentColor`. Shared by the app and the form thumbnails. */
export const CATEGORY_GLYPHS: Record<CategoryId, string> = {
  "dead-code": "M5 15c0-5.5 4-9.5 10-10-.5 6-4.5 10-10 10Zm0 0 5-5",
  dependencies: "M10 2.8 16.5 6.4v7.2L10 17.2 3.5 13.6V6.4L10 2.8Zm0 7.2 6.5-3.6M10 10 3.5 6.4M10 10v7.2",
  duplication: "M7 7h9v9H7zM4 13V4h9",
  complexity: "M5 3.5v13M5 8c0 3 10 2 10 5.5M5 12.5c3 0 4-1 4-4.5M15 13.5v3",
  architecture: "M6.5 5.5a5 5 0 0 1 8 1.5M13.5 14.5a5 5 0 0 1-8-1.5M14.5 3.5v3.5H11M5.5 16.5V13H9",
  frameworks: "m7 6-4 4 4 4m6-8 4 4-4 4",
  hygiene: "M10 3v3m0 8v3m7-7h-3M6 10H3m11.5-4.5-2 2m-5 5-2 2m9 0-2-2m-5-5-2-2",
};
