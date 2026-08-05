import { Response } from "express";

export type ApiMeta = Record<string, unknown>;

export function parsePagination(query: Record<string, unknown>, defaults = { page: 1, pageSize: 20, maxPageSize: 100 }) {
  const page = Math.max(1, Number(query.page) || defaults.page);
  const requestedPageSize = Math.max(1, Number(query.pageSize || query.limit) || defaults.pageSize);
  const pageSize = Math.min(defaults.maxPageSize, requestedPageSize);
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize
  };
}

export function sendOk<T>(res: Response, data: T, meta: ApiMeta = {}) {
  return res.json({
    success: true,
    data,
    meta
  });
}

export function sendPaginated<T>(
  res: Response,
  items: T[],
  total: number,
  page: number,
  pageSize: number,
  meta: ApiMeta = {}
) {
  return sendOk(res, items, {
    ...meta,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    }
  });
}
