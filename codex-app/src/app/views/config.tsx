import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { CATEGORY_ORDER, CATEGORY_TITLES } from "../../shared/categories.ts";
import type { ConfigPreview } from "../../shared/contracts.ts";
import {
  Button,
  CategoryGlyph,
  EmptyState,
  FallowMark,
  Icon,
  LoadingStatus,
} from "../components/ui.tsx";
import type { Host } from "../host.ts";
import { ruleCategory } from "../config-rules.ts";
import { readOpenedFile, watchOpenedFile, type OpenedFile } from "../opened-file.ts";

type Severity = "off" | "warn" | "error";
const SEVERITIES: readonly Severity[] = ["off", "warn", "error"];

interface SchemaRule {
  key: string;
  description: string;
  default: string;
}

interface ConfigSchema {
  rules: SchemaRule[];
  fields?: Record<string, string | null>;
  error?: string;
}

type ListField = "entry" | "ignorePatterns" | "ignoreDependencies";
const LIST_FIELDS: Array<{ key: ListField; title: string; placeholder: string }> = [
  { key: "entry", title: "Entry points", placeholder: "src/main.ts or scripts/*.ts" },
  { key: "ignorePatterns", title: "Ignored files", placeholder: "**/generated/**" },
  { key: "ignoreDependencies", title: "Ignored dependencies", placeholder: "@types/node" },
];

/**
 * New keys go to the top of their object (after `$schema`). jsonc-parser appends at the end by
 * default, which puts the new key between the last value and its trailing comment.
 */
const FORMATTING = {
  formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
  getInsertionIndex: (properties: string[]): number => (properties[0] === "$schema" ? 1 : 0),
};

const humanize = (key: string): string => {
  const text = key.replace(/-/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const parseConfig = (text: string): { value: Record<string, unknown>; error: string | null } => {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  const first = errors[0];
  if (first !== undefined) {
    return { value: {}, error: `${printParseErrorCode(first.error)} at offset ${first.offset}` };
  }
  return {
    value:
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {},
    error: null,
  };
};

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : [];

const edit = (text: string, path: Array<string | number>, value: unknown): string =>
  applyEdits(text, modify(text, path, value, FORMATTING));

type FileRef = { name: string; resourceUri: string };

export const ConfigEditor = ({ host, file }: { host: Host; file: FileRef }): JSX.Element => {
  const [saved, setSaved] = useState<OpenedFile | null>(null);
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [schema, setSchema] = useState<ConfigSchema | null>(null);
  const [tab, setTab] = useState<"rules" | "files" | "source">("rules");
  const [filter, setFilter] = useState("");
  const [preview, setPreview] = useState<ConfigPreview | null>(null);
  const [busy, setBusy] = useState<"save" | "preview" | null>(null);
  const [notice, setNotice] = useState<{ tone: "info" | "warn" | "error"; text: string } | null>(
    null,
  );
  const [external, setExternal] = useState(false);
  const dirtyRef = useRef(false);

  const resources = host.openai.resources;
  const dirty = saved !== null && draft !== saved.text;
  dirtyRef.current = dirty;

  const load = async (): Promise<void> => {
    const outcome = await readOpenedFile(host, file.resourceUri);
    if (!outcome.ok) {
      setLoadError(outcome.error);
      return;
    }
    setSaved(outcome.file);
    setDraft(outcome.file.text);
    setExternal(false);
    setLoadError(null);
  };

  useEffect(() => {
    void load();
    void host
      .callData<ConfigSchema>("fallow_app_config_schema")
      .then(setSchema)
      .catch(() => setSchema({ rules: [] }));
    return watchOpenedFile(host, file.resourceUri, async () => {
      if (dirtyRef.current) setExternal(true);
      else await load();
    });
  }, [file.resourceUri]);

  const parsed = useMemo(() => parseConfig(draft), [draft]);
  const savedParsed = useMemo(() => parseConfig(saved?.text ?? ""), [saved]);
  const rules = (parsed.value["rules"] ?? {}) as Record<string, unknown>;
  const savedRules = (savedParsed.value["rules"] ?? {}) as Record<string, unknown>;

  const update = (path: Array<string | number>, value: unknown): void => {
    if (parsed.error !== null) return;
    setDraft((current) => edit(current, path, value));
    setPreview(null);
  };

  const save = async (force = false): Promise<void> => {
    if (resources === undefined || saved === null) return;
    setBusy("save");
    try {
      const result = await resources.write(file.resourceUri, {
        text: draft,
        ...(force || saved.etag === undefined ? {} : { ifMatch: saved.etag }),
      });
      if (result.outcome === "saved") {
        setSaved({ ...saved, text: draft, etag: result.etag });
        setExternal(false);
        setNotice({ tone: "info", text: "Saved." });
      } else if (result.outcome === "conflict") {
        setExternal(true);
        setNotice({
          tone: "warn",
          text: "The file changed on disk since you opened it. Reload it, or keep your version.",
        });
      } else if (result.outcome === "too-large") {
        setNotice({
          tone: "error",
          text: `The file is larger than the ${result.maxBytes} byte limit.`,
        });
      }
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "The file could not be saved.",
      });
    } finally {
      setBusy(null);
    }
  };

  const runPreview = async (): Promise<void> => {
    setBusy("preview");
    setPreview(null);
    try {
      setPreview(await host.callData<ConfigPreview>("fallow_app_preview_config", { text: draft }));
    } catch (error) {
      setPreview({
        ok: false,
        before: null,
        after: null,
        error: error instanceof Error ? error.message : "Failed.",
        byCategory: [],
      });
    } finally {
      setBusy(null);
    }
  };

  if (loadError !== null) {
    return (
      <div class="f-config">
        <EmptyState icon="alert" title={`Cannot open ${file.name}`}>
          {loadError}
        </EmptyState>
      </div>
    );
  }
  if (saved === null) {
    return (
      <div class="f-loading">
        <LoadingStatus label="Opening the config file" />
      </div>
    );
  }

  const changedRules = Object.keys({ ...rules, ...savedRules }).filter(
    (key) => rules[key] !== savedRules[key],
  ).length;
  const terms = filter
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  const visibleRules = (schema?.rules ?? []).filter((rule) =>
    terms.every((term) => `${rule.key} ${rule.description}`.toLowerCase().includes(term)),
  );
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    rules: visibleRules.filter((rule) => ruleCategory(rule.key) === category),
  })).filter((group) => group.rules.length > 0);

  return (
    <div class="f-config">
      <header class="f-topbar">
        <div class="f-topbar-title">
          <FallowMark />
          <div class="f-title-text">
            <h1>{file.name}</h1>
            <p class="f-subtle">
              {!saved.writable
                ? "Read only"
                : dirty
                  ? `Unsaved changes${changedRules > 0 ? ` · ${changedRules} ${changedRules === 1 ? "rule" : "rules"}` : ""}`
                  : "Saved"}
            </p>
          </div>
        </div>
        <div class="f-topbar-actions">
          <Button
            size="sm"
            icon="sparkle"
            busy={busy === "preview"}
            disabled={parsed.error !== null}
            onClick={() => void runPreview()}
          >
            Preview impact
          </Button>
          <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => setDraft(saved.text)}>
            Revert
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="save"
            busy={busy === "save"}
            disabled={!dirty || !saved.writable || parsed.error !== null}
            onClick={() => void save()}
          >
            Save
          </Button>
        </div>
      </header>

      {external ? (
        <div class="f-banner f-banner-warn" role="status">
          <Icon name="alert" size={14} />
          <span>{file.name} changed on disk.</span>
          <Button size="sm" onClick={() => void load()}>
            Reload
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!saved.writable}
            onClick={() => void save(true)}
          >
            Keep mine
          </Button>
        </div>
      ) : null}
      {notice === null ? null : (
        <div class={`f-banner f-banner-${notice.tone}`} role="status">
          <Icon name={notice.tone === "info" ? "check" : "alert"} size={14} />
          <span>{notice.text}</span>
          <Button
            size="sm"
            variant="ghost"
            icon="close"
            title="Dismiss"
            onClick={() => setNotice(null)}
          />
        </div>
      )}
      {parsed.error === null ? null : (
        <div class="f-banner f-banner-error" role="alert">
          <Icon name="alert" size={14} />
          <span>The file is not valid JSON: {parsed.error}. Fix it in the Source tab.</span>
        </div>
      )}

      {preview === null ? null : (
        <PreviewPanel preview={preview} onClose={() => setPreview(null)} />
      )}

      <div class="f-tabs" role="tablist" aria-label="Config sections">
        {(["rules", "files", "source"] as const).map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`f-tab-${name}`}
            aria-selected={tab === name}
            aria-controls="f-panel"
            class="cursor-interaction"
            onClick={() => setTab(name)}
          >
            {name === "rules" ? "Rules" : name === "files" ? "Files and dependencies" : "Source"}
          </button>
        ))}
      </div>

      <div class="f-main" role="tabpanel" id="f-panel" aria-labelledby={`f-tab-${tab}`}>
        {tab === "rules" ? (
          <div class="f-rules">
            <label class="f-search">
              <Icon name="search" size={14} />
              <input
                class="form-control"
                type="search"
                placeholder="Search rules"
                aria-label="Search rules"
                value={filter}
                onInput={(event) => setFilter(event.currentTarget.value)}
              />
            </label>
            {schema === null ? (
              <LoadingStatus label="Loading the rules" />
            ) : schema.rules.length === 0 ? (
              <EmptyState icon="info" title="Rule list unavailable">
                {schema.error ?? "Update fallow to edit rules here."}
              </EmptyState>
            ) : (
              grouped.map((group) => (
                <section key={group.category} class="f-rule-group">
                  <h2>
                    <CategoryGlyph category={group.category} size={12} />
                    {CATEGORY_TITLES[group.category]}
                  </h2>
                  <ul>
                    {group.rules.map((rule) => {
                      const value = (
                        typeof rules[rule.key] === "string" ? rules[rule.key] : rule.default
                      ) as Severity;
                      const changed = rules[rule.key] !== savedRules[rule.key];
                      return (
                        <li key={rule.key} class={`f-rule ${changed ? "f-changed" : ""}`}>
                          <div class="f-rule-text">
                            <span class="f-rule-name">
                              {humanize(rule.key)}
                              {rules[rule.key] === undefined ? (
                                <span class="f-subtle"> · default</span>
                              ) : null}
                            </span>
                            <span class="f-rule-description" title={rule.description}>
                              {rule.description}
                            </span>
                          </div>
                          <div
                            class="f-segmented f-severity"
                            role="group"
                            aria-label={`Severity of ${humanize(rule.key).toLowerCase()}`}
                          >
                            {SEVERITIES.map((severity) => (
                              <button
                                key={severity}
                                type="button"
                                aria-pressed={value === severity}
                                class={`cursor-interaction f-sev-${severity}`}
                                disabled={!saved.writable || parsed.error !== null}
                                onClick={() =>
                                  update(
                                    ["rules", rule.key],
                                    severity === rule.default ? undefined : severity,
                                  )
                                }
                              >
                                {severity === "off"
                                  ? "Off"
                                  : severity === "warn"
                                    ? "Warn"
                                    : "Error"}
                              </button>
                            ))}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </div>
        ) : tab === "files" ? (
          <div class="f-files">
            <section class="f-card">
              <label class="form-check f-toggle">
                <input
                  type="checkbox"
                  class="form-check-input"
                  checked={parsed.value["production"] === true}
                  disabled={!saved.writable || typeof parsed.value["production"] === "object"}
                  onChange={(event) =>
                    update(["production"], event.currentTarget.checked ? true : undefined)
                  }
                />
                <span class="form-check-label">
                  Production mode
                  <span class="f-subtle">
                    {typeof parsed.value["production"] === "object"
                      ? " Configured per analysis in the source."
                      : " Analyze production code only."}
                  </span>
                </span>
              </label>
            </section>
            {LIST_FIELDS.map((field) => (
              <ListEditor
                key={field.key}
                title={field.title}
                description={schema?.fields?.[field.key] ?? null}
                placeholder={field.placeholder}
                values={stringList(parsed.value[field.key])}
                disabled={!saved.writable || parsed.error !== null}
                onChange={(values) => update([field.key], values.length === 0 ? undefined : values)}
              />
            ))}
          </div>
        ) : (
          <div class="f-source">
            <textarea
              class="form-control f-source-text"
              spellcheck={false}
              value={draft}
              readOnly={!saved.writable}
              aria-label={`Source of ${file.name}`}
              onInput={(event) => {
                setDraft(event.currentTarget.value);
                setPreview(null);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

const ListEditor = ({
  title,
  description,
  placeholder,
  values,
  disabled,
  onChange,
}: {
  title: string;
  description: string | null;
  placeholder: string;
  values: string[];
  disabled: boolean;
  onChange: (values: string[]) => void;
}): JSX.Element => {
  const [input, setInput] = useState("");
  const add = (): void => {
    const value = input.trim();
    if (value.length === 0 || values.includes(value)) return;
    onChange([...values, value]);
    setInput("");
  };
  return (
    <section class="f-card f-list-editor">
      <header class="f-card-header">
        <h2>{title}</h2>
        <span class="f-count">{values.length}</span>
      </header>
      {description === null ? null : <p class="f-subtle f-clamp">{description.split("\n")[0]}</p>}
      <ul class="f-tokens">
        {values.map((value) => (
          <li key={value} class="f-token">
            <code>{value}</code>
            <button
              type="button"
              class="f-token-remove cursor-interaction"
              aria-label={`Remove ${value}`}
              disabled={disabled}
              onClick={() => onChange(values.filter((item) => item !== value))}
            >
              <Icon name="close" size={12} />
            </button>
          </li>
        ))}
      </ul>
      <form
        class="f-token-form"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <input
          class="form-control"
          value={input}
          placeholder={placeholder}
          aria-label={`Add to ${title.toLowerCase()}`}
          disabled={disabled}
          onInput={(event) => setInput(event.currentTarget.value)}
        />
        <Button
          size="sm"
          icon="plus"
          type="submit"
          disabled={disabled || input.trim().length === 0}
        >
          Add
        </Button>
      </form>
    </section>
  );
};

const PreviewPanel = ({
  preview,
  onClose,
}: {
  preview: ConfigPreview;
  onClose: () => void;
}): JSX.Element => {
  if (!preview.ok || preview.before === null || preview.after === null) {
    return (
      <div class="f-banner f-banner-error" role="alert">
        <Icon name="alert" size={14} />
        <span>The preview failed: {preview.error}</span>
        <Button size="sm" variant="ghost" icon="close" title="Dismiss" onClick={onClose} />
      </div>
    );
  }
  const delta = preview.after - preview.before;
  const max = Math.max(1, ...preview.byCategory.flatMap((row) => [row.before, row.after]));
  return (
    <section class="f-card f-preview" aria-label="Impact preview">
      <header class="f-card-header">
        <h2>
          {preview.before} → {preview.after} findings
          <span class={`f-delta ${delta < 0 ? "f-delta-down" : delta > 0 ? "f-delta-up" : ""}`}>
            {delta === 0 ? "no change" : delta > 0 ? `+${delta}` : `${delta}`}
          </span>
        </h2>
        <Button
          size="sm"
          variant="ghost"
          icon="close"
          title="Close the preview"
          onClick={onClose}
        />
      </header>
      <ul class="f-preview-rows">
        {preview.byCategory.map((row) => (
          <li key={row.category}>
            <span class="f-preview-label">{CATEGORY_TITLES[row.category]}</span>
            <span class="f-preview-bars">
              <span class="f-bar f-bar-before" style={{ width: `${(row.before / max) * 100}%` }} />
              <span class="f-bar f-bar-after" style={{ width: `${(row.after / max) * 100}%` }} />
            </span>
            <span class="f-preview-numbers">
              {row.before} → {row.after}
            </span>
          </li>
        ))}
      </ul>
      <p class="f-subtle">
        The preview ran fallow twice: with the saved file and with this draft. Nothing was saved.
      </p>
    </section>
  );
};
