import { z } from 'zod';

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  /** True when at least one more page exists. Avoids an expensive COUNT(*). */
  hasMore: boolean;
}

export function pageOffset(query: PageQuery): number {
  return (query.page - 1) * query.pageSize;
}

/** Callers fetch `pageSize + 1` rows; this trims the probe row and sets `hasMore`. */
export function toPage<T>(rows: T[], query: PageQuery): Page<T> {
  const hasMore = rows.length > query.pageSize;
  return { items: hasMore ? rows.slice(0, query.pageSize) : rows, page: query.page, pageSize: query.pageSize, hasMore };
}
