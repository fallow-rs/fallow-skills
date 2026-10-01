export const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

export const average = (values: readonly number[]): number =>
  values.length === 0 ? 0 : sum(values) / values.length;
