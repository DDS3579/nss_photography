import { z } from "zod";

export const BindingsStatusSchema = z.object({
  db: z.boolean(),
  bucket: z.boolean(),
});

export type BindingsStatus = z.infer<typeof BindingsStatusSchema>;

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.string(),
  time: z.string(),
  bindings: BindingsStatusSchema,
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.string(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;