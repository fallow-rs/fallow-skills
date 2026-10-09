import type { Icon } from "@modelcontextprotocol/sdk/types.js";
import { CATEGORY_COLORS, CATEGORY_GLYPHS } from "../shared/categories.ts";
import type { CategoryId } from "../shared/contracts.ts";

/* The F mark of the Fallow logo, three leaf strokes. */
const MARK_PATH =
  "M9990 9649c-41-10-147-29-235-41-160-22-161-22-2055-28-1685-6-1906-8-1995-23-531-86-976-282-1344-593-103-87-268-253-347-349-185-227-358-552-449-845-77-251-84-328-85-935-1-286-1-524 0-530 1-5 14 31 29 80 36 119 112 307 171 425 250 499 602 860 1065 1093 280 141 506 211 870 268 47 8 523 14 1445 19 1230 6 1384 9 1460 24 218 43 352 86 515 167 376 186 605 452 951 1100 52 97 94 179 94 183 0 8 1 8-90-15zM8488 7584c-229-45-282-47-1603-54-1095-6-1272-9-1355-23-310-53-533-123-785-247-473-231-838-591-1060-1045-100-204-170-427-194-620-12-93-21-1235-10-1235 3 0 13 28 23 63 9 34 42 125 73 202 200 505 505 904 882 1153 216 143 417 232 666 297 256 67 261 67 1115 75 738 6 780 7 886 28 519 101 872 352 1166 829 89 143 308 563 308 589 0 7-43 2-112-12zM5345 5475c-335-45-612-150-915-350-538-356-913-998-955-1639l-8-109 154 6c346 15 624 83 914 227 241 119 401 237 600 441 246 253 430 547 578 924 46 116 125 373 151 488l6 27-212-1c-117-1-258-7-313-14z";

const mark = (fill: string): string =>
  `<svg x="1" y="1" width="18" height="18" viewBox="273.96 198.32 806.79 806.79"><g transform="translate(0,1254) scale(0.1,-0.1)" fill="${fill}"><path d="${MARK_PATH}"/></g></svg>`;

const dataUri = (svg: string): string => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/** Monochrome 20 x 20 sidebar icon. `currentColor` follows the host theme. */
const SIDEBAR_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">${mark("currentColor")}</svg>`;

/** Server icon: the mark on an ink tile, as in the brand logo. */
const SERVER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 20 20"><rect width="20" height="20" rx="4" fill="#1c1b1c"/>${mark("#f4f1ea")}</svg>`;

const icon = (svg: string): Icon => ({
  src: dataUri(svg),
  mimeType: "image/svg+xml",
  sizes: ["any"],
});

export const SIDEBAR_ICON = icon(SIDEBAR_ICON_SVG);
export const SERVER_ICON = icon(SERVER_ICON_SVG);

const glyphTile = (color: string, path: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 20 20"><rect width="20" height="20" rx="4.5" fill="${color}"/><g transform="translate(4 4) scale(0.6)"><path d="${path}" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;

/** A 128 x 128 tile per category, for form thumbnails and composer chips. */
export const categoryThumbnail = (category: CategoryId): Icon => ({
  src: dataUri(glyphTile(CATEGORY_COLORS[category], CATEGORY_GLYPHS[category])),
  mimeType: "image/svg+xml",
  sizes: ["128x128"],
});

const QUICK_ACTION_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5v8.5a2.5 2.5 0 1 0 2.5 2.5V9.5a3 3 0 0 1 3-3h2M13.5 4l2.5 2.5-2.5 2.5"/></svg>`;

/** Branch glyph for the "Audit this branch" quick action. */
export const AUDIT_ICON = icon(QUICK_ACTION_SVG);
