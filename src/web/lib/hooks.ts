import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, ApiError } from "./api.ts";

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Shared create/update form logic. `path` is the collection path, e.g.
 * "/systems"; pass `id` to update instead of create.
 */
export function useEntityForm<T extends Record<string, unknown>>(opts: {
  path: string;
  id?: string;
  initial: T;
  detailPath: (id: string) => string;
}) {
  const [values, setValues] = useState<T>(opts.initial);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: (v: T) =>
      opts.id ? api.put<{ id: string }>(`${opts.path}/${opts.id}`, v) : api.post<{ id: string }>(opts.path, v),
    onSuccess: async (row) => {
      await qc.invalidateQueries();
      navigate({ to: opts.detailPath(row.id) });
    },
  });
  const fieldErrors = mutation.error instanceof ApiError ? (mutation.error.fields ?? {}) : {};
  const set = <K extends keyof T>(key: K, value: T[K]) => setValues((prev) => ({ ...prev, [key]: value }));
  return {
    values,
    setValues,
    set,
    submit: (e: React.FormEvent) => {
      e.preventDefault();
      mutation.mutate(values);
    },
    saving: mutation.isPending,
    error: mutation.error && Object.keys(fieldErrors).length === 0 ? mutation.error : null,
    fieldErrors: fieldErrors as Record<string, string>,
  };
}

export function useDelete(path: string, after: string) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api.del(path),
    onSuccess: async () => {
      await qc.invalidateQueries();
      navigate({ to: after });
    },
  });
}
