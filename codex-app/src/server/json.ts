/** Narrow helpers for fallow JSON output. Fallow output is a system boundary, so nothing is trusted. */

export type Json = Record<string, unknown>;

export const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const record = (value: unknown): Json => (isRecord(value) ? value : {});

export const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const string = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const boolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;
