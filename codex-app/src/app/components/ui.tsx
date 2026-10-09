import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";
import { CATEGORY_COLORS, CATEGORY_GLYPHS, CATEGORY_TITLES } from "../../shared/categories.ts";
import type { CategoryId, Level } from "../../shared/contracts.ts";

const ICONS = {
  refresh: "M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.2h-3.2",
  expand: "M11.5 3.5h5v5M8.5 16.5h-5v-5M16.5 3.5 11 9M3.5 16.5 9 11",
  file: "M11.5 3H6a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 6 17h8a1.5 1.5 0 0 0 1.5-1.5V7l-4-4Zm0 0v4h4",
  copy: "M7 7V4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5v7a1.5 1.5 0 0 1-1.5 1.5H13M4.5 7h7A1.5 1.5 0 0 1 13 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 15.5v-7A1.5 1.5 0 0 1 4.5 7Z",
  check: "m4.5 10.5 3.5 3.5 7.5-8",
  chevronRight: "m8 5 5 5-5 5",
  chevronLeft: "m12 5-5 5 5 5",
  chevronDown: "m5 8 5 5 5-5",
  search: "m16.5 16.5-3.6-3.6M14 9a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z",
  sparkle:
    "M10 2.5c.4 3.8 3.7 7.1 7.5 7.5-3.8.4-7.1 3.7-7.5 7.5-.4-3.8-3.7-7.1-7.5-7.5 3.8-.4 7.1-3.7 7.5-7.5Z",
  plus: "M10 4v12M4 10h12",
  close: "m5 5 10 10M15 5 5 15",
  branch: "M6 3.5v8.5a2.5 2.5 0 1 0 2.5 2.5V9.5a3 3 0 0 1 3-3h2M13.5 4l2.5 2.5-2.5 2.5",
  folder:
    "M3 5.5A1.5 1.5 0 0 1 4.5 4h3.3l1.7 2h6A1.5 1.5 0 0 1 17 7.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5v-9Z",
  alert:
    "M10 7v4m0 2.5v.5M8.7 3.3 2.6 14a1.5 1.5 0 0 0 1.3 2.2h12.2a1.5 1.5 0 0 0 1.3-2.2L11.3 3.3a1.5 1.5 0 0 0-2.6 0Z",
  info: "M10 9v5m0-7.5V7M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
  external: "M11 4h5v5M16 4l-7 7M14 11.5V15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3.5",
  newChat:
    "M4 15.5V5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5ZM10 6.5v4M8 8.5h4",
  attach:
    "m15.5 9.5-5.6 5.6a3.5 3.5 0 0 1-5-5L10.6 4a2.3 2.3 0 0 1 3.3 3.3l-5.6 5.6a1.2 1.2 0 0 1-1.7-1.7l5-5",
  save: "M5 3.5h8l3.5 3.5v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15V5A1.5 1.5 0 0 1 5 3.5ZM7 3.5v4h5v-4M6.5 16.5v-5h7v5",
  wand: "M4 16 13 7m1.5-3.5v2m0 4v2m-2-4h-2m6 0h-2M6 4v2M5 5h2",
  terminal:
    "m5 7 3 3-3 3m5 0h5M3.5 4h13A1.5 1.5 0 0 1 18 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 2 14.5v-9A1.5 1.5 0 0 1 3.5 4Z",
} as const;

export type IconName = keyof typeof ICONS;

export const Icon = ({ name, size = 16 }: { name: IconName; size?: number }): JSX.Element => (
  <svg
    class="f-icon"
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d={ICONS[name]} />
  </svg>
);

export const FallowMark = ({ size = 18 }: { size?: number }): JSX.Element => (
  <svg class="f-mark" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
    <rect width="20" height="20" rx="4.5" fill="currentColor" />
    <svg x="2" y="2" width="16" height="16" viewBox="273.96 198.32 806.79 806.79">
      <g transform="translate(0,1254) scale(0.1,-0.1)" fill="var(--f-mark-ink)">
        <path d="M9990 9649c-41-10-147-29-235-41-160-22-161-22-2055-28-1685-6-1906-8-1995-23-531-86-976-282-1344-593-103-87-268-253-347-349-185-227-358-552-449-845-77-251-84-328-85-935-1-286-1-524 0-530 1-5 14 31 29 80 36 119 112 307 171 425 250 499 602 860 1065 1093 280 141 506 211 870 268 47 8 523 14 1445 19 1230 6 1384 9 1460 24 218 43 352 86 515 167 376 186 605 452 951 1100 52 97 94 179 94 183 0 8 1 8-90-15zM8488 7584c-229-45-282-47-1603-54-1095-6-1272-9-1355-23-310-53-533-123-785-247-473-231-838-591-1060-1045-100-204-170-427-194-620-12-93-21-1235-10-1235 3 0 13 28 23 63 9 34 42 125 73 202 200 505 505 904 882 1153 216 143 417 232 666 297 256 67 261 67 1115 75 738 6 780 7 886 28 519 101 872 352 1166 829 89 143 308 563 308 589 0 7-43 2-112-12zM5345 5475c-335-45-612-150-915-350-538-356-913-998-955-1639l-8-109 154 6c346 15 624 83 914 227 241 119 401 237 600 441 246 253 430 547 578 924 46 116 125 373 151 488l6 27-212-1c-117-1-258-7-313-14z" />
      </g>
    </svg>
  </svg>
);

type ButtonProps = {
  children?: ComponentChildren;
  icon?: IconName;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  pressed?: boolean;
  busy?: boolean;
  type?: "button" | "submit";
};

export const Button = ({
  children,
  icon,
  variant = "secondary",
  size = "md",
  onClick,
  disabled,
  title,
  pressed,
  busy,
  type = "button",
}: ButtonProps): JSX.Element => (
  <button
    type={type}
    class={`btn cursor-interaction f-btn f-btn-${size} ${variant === "primary" ? "btn-primary" : variant === "ghost" ? "btn-ghost" : ""} ${children === undefined ? "f-btn-icon" : ""}`}
    onClick={onClick}
    disabled={disabled === true || busy === true}
    title={title}
    aria-label={children === undefined ? title : undefined}
    aria-pressed={pressed}
    aria-busy={busy}
  >
    {busy === true ? <Spinner /> : icon === undefined ? null : <Icon name={icon} />}
    {children}
  </button>
);

export const Spinner = ({ size = 14 }: { size?: number }): JSX.Element => (
  <svg class="f-spinner" width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
    <circle
      cx="10"
      cy="10"
      r="7.5"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      opacity="0.2"
    />
    <path
      d="M17.5 10a7.5 7.5 0 0 0-7.5-7.5"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    />
  </svg>
);

const LEVEL_LABEL: Record<Level, string> = { error: "Error", warn: "Warning", info: "Info" };

export const LevelDot = ({ level }: { level: Level }): JSX.Element => (
  <span
    class={`f-level f-level-${level}`}
    title={LEVEL_LABEL[level]}
    aria-label={LEVEL_LABEL[level]}
  />
);

export const CategoryGlyph = ({
  category,
  size = 16,
}: {
  category: CategoryId;
  size?: number;
}): JSX.Element => (
  <span
    class="f-glyph"
    style={{
      "--f-hue": CATEGORY_COLORS[category],
      width: `${size + 8}px`,
      height: `${size + 8}px`,
    }}
  >
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={CATEGORY_GLYPHS[category]} />
    </svg>
  </span>
);

export const CategoryLabel = ({ category }: { category: CategoryId }): JSX.Element => (
  <span class="f-category-label">
    <span class="f-swatch" style={{ background: CATEGORY_COLORS[category] }} />
    {CATEGORY_TITLES[category]}
  </span>
);

const GRADE_TONE: Record<string, string> = {
  A: "good",
  B: "good",
  C: "fair",
  D: "poor",
  F: "poor",
};

/** A ring that fills to the score, with the grade in the middle. */
export const ScoreRing = ({
  score,
  grade,
  size = 96,
}: {
  score: number;
  grade: string;
  size?: number;
}): JSX.Element => {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(100, score)) / 100;
  return (
    <div
      class={`f-ring f-tone-${GRADE_TONE[grade] ?? "fair"}`}
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        role="img"
        aria-label={`Health score ${score} of 100, grade ${grade}`}
      >
        <circle cx="50" cy="50" r={radius} class="f-ring-track" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          class="f-ring-value"
          stroke-dasharray={`${circumference * filled} ${circumference}`}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div class="f-ring-label">
        <span class="f-ring-grade">{grade}</span>
        <span class="f-ring-score">{Math.round(score)}</span>
      </div>
    </div>
  );
};

/** A stacked bar of findings per category, with a legend that filters. */
export const CategoryBar = ({
  counts,
  onSelect,
}: {
  counts: Array<{ category: CategoryId; count: number }>;
  onSelect?: (category: CategoryId) => void;
}): JSX.Element => {
  const total = counts.reduce((sum, entry) => sum + entry.count, 0);
  return (
    <div class="f-catbar">
      <div
        class="f-catbar-track"
        role="img"
        aria-label={counts
          .map((entry) => `${CATEGORY_TITLES[entry.category]} ${entry.count}`)
          .join(", ")}
      >
        {counts.map((entry) => (
          <span
            key={entry.category}
            style={{ flexGrow: entry.count, background: CATEGORY_COLORS[entry.category] }}
          />
        ))}
        {total === 0 ? <span class="f-catbar-empty" /> : null}
      </div>
      <div class="f-catbar-legend">
        {counts.map((entry) => (
          <button
            type="button"
            key={entry.category}
            class="f-legend-item cursor-interaction"
            onClick={onSelect === undefined ? undefined : () => onSelect(entry.category)}
            disabled={onSelect === undefined}
          >
            <span class="f-swatch" style={{ background: CATEGORY_COLORS[entry.category] }} />
            <span>{CATEGORY_TITLES[entry.category]}</span>
            <span class="f-legend-count">{entry.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Sandboxed frames can block the async clipboard API; a selected textarea still copies.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
};

export const CopyButton = ({ text, label }: { text: string; label?: string }): JSX.Element => {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={copied ? "check" : "copy"}
      title={copied ? "Copied" : `Copy ${label ?? "command"}`}
      onClick={() => {
        void copyText(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
    />
  );
};

export const CommandLine = ({ command }: { command: string }): JSX.Element => (
  <div class="f-command">
    <span class="f-command-prompt" aria-hidden="true">
      $
    </span>
    <code>{command}</code>
    <CopyButton text={command} />
  </div>
);

export const EmptyState = ({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children?: ComponentChildren;
}): JSX.Element => (
  <div class="f-empty">
    <span class="f-empty-icon">
      <Icon name={icon} size={20} />
    </span>
    <p class="f-empty-title">{title}</p>
    {children === undefined ? null : <div class="f-empty-body">{children}</div>}
  </div>
);

export const relativeTime = (iso: string, now: number = Date.now()): string => {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
};

export const formatNumber = (value: number | null): string =>
  value === null
    ? "–"
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);

/** A path that truncates its folder and keeps the file name and line visible. */
export const PathLabel = ({ path, line }: { path: string; line?: number | null }): JSX.Element => {
  const slash = path.lastIndexOf("/");
  const folder = slash === -1 ? "" : path.slice(0, slash + 1);
  const file = slash === -1 ? path : path.slice(slash + 1);
  return (
    <span class="f-path" title={line === undefined || line === null ? path : `${path}:${line}`}>
      {folder.length === 0 ? null : <span class="f-path-folder">{folder}</span>}
      <span class="f-path-file">
        {file}
        {line === undefined || line === null ? null : `:${line}`}
      </span>
    </span>
  );
};
