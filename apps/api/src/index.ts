import { Hono } from "hono";
import { HealthResponseSchema } from "@competition-portal/types";

type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) => {
  return c.text("competition api");
});

app.get("/health", (c) => {
  const body = {
    ok: true,
    service: "api",
    time: new Date().toISOString(),
    bindings: {
      db: Boolean(c.env.DB),
      bucket: Boolean(c.env.BUCKET),
    },
  };

  const parsed = HealthResponseSchema.parse(body);

  return c.json(parsed);
});

export default app;