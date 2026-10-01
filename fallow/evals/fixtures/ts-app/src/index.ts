import { formatTotal } from './format.js';
import { sum } from './math.js';

export const run = (values: readonly number[]): string => formatTotal(sum(values));
