import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import type { OpenAIResourceWriteResult } from "@openai/mcp-extensions/app";
import type { JSX } from "preact";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type StateUpdater,
} from "preact/hooks";
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

type Setter<T> = Dispatch<StateUpdater<T>>;
type ConfigTab = "rules" | "files" | "source";
type ConfigNoticeValue = { tone: "info" | "warn" | "error"; text: string };
type ParsedConfig = ReturnType<typeof parseConfig>;
interface ConfigState {
  saved: OpenedFile | null;
  draft: string;
  loadError: string | null;
  schema: ConfigSchema | null;
  tab: ConfigTab;
  setTab: Setter<ConfigTab>;
  filter: string;
  setFilter: Setter<string>;
  preview: ConfigPreview | null;
  setPreview: Setter<ConfigPreview | null>;
  busy: "save" | "preview" | null;
  notice: ConfigNoticeValue | null;
  setNotice: Setter<ConfigNoticeValue | null>;
  external: boolean;
  dirty: boolean;
  parsed: ParsedConfig;
  rules: Record<string, unknown>;
  savedRules: Record<string, unknown>;
  setDraft: Setter<string>;
  load: () => Promise<void>;
  update: (path: Array<string | number>, value: unknown) => void;
  save: (force?: boolean) => Promise<void>;
  runPreview: () => Promise<void>;
}
type LoadedConfigState = ConfigState & { saved: OpenedFile };
type ConfigPanelProps = { file: FileRef; state: LoadedConfigState };
const CONFIG_TAB_LABELS: Record<ConfigTab, string> = {
  rules: "Rules",
  files: "Files and dependencies",
  source: "Source",
};
const SEVERITY_LABELS: Record<Severity, string> = { off: "Off", warn: "Warn", error: "Error" };
const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;
const savedText = (saved: OpenedFile | null): string => saved?.text ?? "";
const configRules = (value: Record<string, unknown>): Record<string, unknown> =>
  (value["rules"] ?? {}) as Record<string, unknown>;
const writeCondition = (force: boolean, saved: OpenedFile): { ifMatch?: string } =>
  force || saved.etag === undefined ? {} : { ifMatch: saved.etag };
const applySaveResult = (
  result: OpenAIResourceWriteResult,
  saved: OpenedFile,
  draft: string,
  setSaved: Setter<OpenedFile | null>,
  setExternal: Setter<boolean>,
  setNotice: Setter<ConfigNoticeValue | null>,
): void => {
  const outcomes = new Map<OpenAIResourceWriteResult["outcome"], () => void>([
    [
      "saved",
      (): void => {
        if (result.outcome !== "saved") return;
        setSaved({ ...saved, text: draft, etag: result.etag });
        setExternal(false);
        setNotice({ tone: "info", text: "Saved." });
      },
    ],
    [
      "conflict",
      (): void => {
        setExternal(true);
        setNotice({
          tone: "warn",
          text: "The file changed on disk since you opened it. Reload it, or keep your version.",
        });
      },
    ],
    [
      "too-large",
      (): void => {
        if (result.outcome !== "too-large") return;
        setNotice({
          tone: "error",
          text: `The file is larger than the ${result.maxBytes} byte limit.`,
        });
      },
    ],
  ]);
  outcomes.get(result.outcome)?.();
};
const configStatus = (writable: boolean, dirty: boolean, changedRules: number): string => {
  if (!writable) return "Read only";
  if (!dirty) return "Saved";
  return `Unsaved changes${changedRuleText(changedRules)}`;
};
const changedRuleText = (changedRules: number): string => {
  if (changedRules === 0) return "";
  return ` · ${changedRules} ${changedRules === 1 ? "rule" : "rules"}`;
};
const groupedRules = (
  schema: ConfigSchema,
  filter: string,
): Array<{ category: (typeof CATEGORY_ORDER)[number]; rules: SchemaRule[] }> => {
  const terms = filter
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  const visibleRules = schema.rules.filter((rule) =>
    terms.every((term) => `${rule.key} ${rule.description}`.toLowerCase().includes(term)),
  );
  return CATEGORY_ORDER.map((category) => ({
    category,
    rules: visibleRules.filter((rule) => ruleCategory(rule.key) === category),
  })).filter((group) => group.rules.length > 0);
};

const useConfigEditor = (host: Host, file: FileRef): ConfigState => {
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
  const savedParsed = useMemo(() => parseConfig(savedText(saved)), [saved]);
  const rules = configRules(parsed.value);
  const savedRules = configRules(savedParsed.value);

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
        ...writeCondition(force, saved),
      });
      applySaveResult(result, saved, draft, setSaved, setExternal, setNotice);
    } catch (error) {
      setNotice({
        tone: "error",
        text: errorText(error, "The file could not be saved."),
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
        error: errorText(error, "Failed."),
        byCategory: [],
      });
    } finally {
      setBusy(null);
    }
  };

  return {
    saved,
    draft,
    loadError,
    schema,
    tab,
    setTab,
    filter,
    setFilter,
    preview,
    setPreview,
    busy,
    notice,
    setNotice,
    external,
    dirty,
    parsed,
    rules,
    savedRules,
    setDraft,
    load,
    update,
    save,
    runPreview,
  };
};

export const ConfigEditor = ({ host, file }: { host: Host; file: FileRef }): JSX.Element => {
  const state = useConfigEditor(host, file);
  const { loadError, saved } = state;
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

  return <ConfigContent file={file} state={{ ...state, saved }} />;
};

const ConfigContent = ({ file, state }: ConfigPanelProps): JSX.Element => {
  const { tab } = state;
  const Panel = CONFIG_PANELS[tab];
  return (
    <div class="f-config">
      <ConfigHeader file={file} state={state} />
      <ConfigBanners file={file} state={state} />
      <ConfigPreviewPanel state={state} />
      <ConfigTabs file={file} state={state} />
      <div class="f-main" role="tabpanel" id="f-panel" aria-labelledby={`f-tab-${tab}`}>
        <Panel file={file} state={state} />
      </div>
    </div>
  );
};

const ConfigHeader = ({ file, state }: ConfigPanelProps): JSX.Element => {
  const { saved, dirty, rules, savedRules, busy, parsed, runPreview, setDraft, save } = state;
  const changedRules = Object.keys({ ...rules, ...savedRules }).filter(
    (key) => rules[key] !== savedRules[key],
  ).length;
  return (
    <header class="f-topbar">
      <div class="f-topbar-title">
        <FallowMark />
        <div class="f-title-text">
          <h1>{file.name}</h1>
          <p class="f-subtle">{configStatus(saved.writable, dirty, changedRules)}</p>
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
  );
};
const ConfigBanners = ({ file, state }: ConfigPanelProps): JSX.Element => {
  const { external, saved, load, save, notice, setNotice, parsed } = state;
  return (
    <>
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
      <ConfigNotice notice={notice} onDismiss={() => setNotice(null)} />
      {parsed.error === null ? null : (
        <div class="f-banner f-banner-error" role="alert">
          <Icon name="alert" size={14} />
          <span>The file is not valid JSON: {parsed.error}. Fix it in the Source tab.</span>
        </div>
      )}
    </>
  );
};
const ConfigNotice = ({
  notice,
  onDismiss,
}: {
  notice: ConfigNoticeValue | null;
  onDismiss: () => void;
}): JSX.Element | null => {
  if (notice === null) return null;
  return (
    <div class={`f-banner f-banner-${notice.tone}`} role="status">
      <Icon name={notice.tone === "info" ? "check" : "alert"} size={14} />
      <span>{notice.text}</span>
      <Button size="sm" variant="ghost" icon="close" title="Dismiss" onClick={onDismiss} />
    </div>
  );
};
const ConfigPreviewPanel = ({ state }: { state: LoadedConfigState }): JSX.Element | null => {
  const { preview, setPreview } = state;
  if (preview === null) return null;
  return <PreviewPanel preview={preview} onClose={() => setPreview(null)} />;
};
const ConfigTabs = ({ state }: ConfigPanelProps): JSX.Element => {
  const { tab, setTab } = state;
  return (
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
          {CONFIG_TAB_LABELS[name]}
        </button>
      ))}
    </div>
  );
};
const ConfigRulesPanel = ({ state }: ConfigPanelProps): JSX.Element => {
  const { filter, setFilter } = state;
  return (
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
      <RuleGroups state={state} />
    </div>
  );
};
const RuleGroups = ({ state }: { state: LoadedConfigState }): JSX.Element => {
  const { schema, filter } = state;
  if (schema === null) return <LoadingStatus label="Loading the rules" />;
  if (schema.rules.length === 0)
    return (
      <EmptyState icon="info" title="Rule list unavailable">
        {schema.error ?? "Update fallow to edit rules here."}
      </EmptyState>
    );
  const grouped = groupedRules(schema, filter);
  return (
    <>
      {grouped.map((group) => (
        <section key={group.category} class="f-rule-group">
          <h2>
            <CategoryGlyph category={group.category} size={12} />
            {CATEGORY_TITLES[group.category]}
          </h2>
          <ul>
            {group.rules.map((rule) => (
              <RuleRow key={rule.key} rule={rule} state={state} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
};
const RuleRow = ({ rule, state }: { rule: SchemaRule; state: LoadedConfigState }): JSX.Element => {
  const { rules, savedRules } = state;
  const value = (typeof rules[rule.key] === "string" ? rules[rule.key] : rule.default) as Severity;
  const changed = rules[rule.key] !== savedRules[rule.key];
  return (
    <li key={rule.key} class={`f-rule ${changed ? "f-changed" : ""}`}>
      <div class="f-rule-text">
        <span class="f-rule-name">
          {humanize(rule.key)}
          {rules[rule.key] === undefined ? <span class="f-subtle"> · default</span> : null}
        </span>
        <span class="f-rule-description" title={rule.description}>
          {rule.description}
        </span>
      </div>
      <RuleSeverity rule={rule} value={value} state={state} />
    </li>
  );
};
const RuleSeverity = ({
  rule,
  value,
  state,
}: {
  rule: SchemaRule;
  value: Severity;
  state: LoadedConfigState;
}): JSX.Element => {
  const { saved, parsed, update } = state;
  return (
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
            update(["rules", rule.key], severity === rule.default ? undefined : severity)
          }
        >
          {SEVERITY_LABELS[severity]}
        </button>
      ))}
    </div>
  );
};
const ConfigFilesPanel = ({ state }: ConfigPanelProps): JSX.Element => {
  const { schema, parsed, saved, update } = state;
  return (
    <div class="f-files">
      <ProductionMode state={state} />
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
  );
};
const ProductionMode = ({ state }: { state: LoadedConfigState }): JSX.Element => {
  const { saved, parsed, update } = state;
  return (
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
  );
};
const ConfigSourcePanel = ({ file, state }: ConfigPanelProps): JSX.Element => {
  const { saved, draft, setDraft, setPreview } = state;
  return (
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
  );
};
const CONFIG_PANELS: Record<ConfigTab, (props: ConfigPanelProps) => JSX.Element> = {
  rules: ConfigRulesPanel,
  files: ConfigFilesPanel,
  source: ConfigSourcePanel,
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
