import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq } from "drizzle-orm";

import {
  CreateSubmissionSchema,
  HealthResponseSchema,
} from "@competition-portal/types";

import { createDb } from "./db";
import { competitionSettings, submissions } from "./db/schema";
import { generateRandomToken, sha256Hex } from "./lib/crypto";
import { verifyTurnstile } from "./lib/turnstile";

type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-Turnstile-Token"],
  })
);

function parseSqliteUtc(value: string): Date {
  const normalized = value.includes("T")
    ? value
    : value.replace(" ", "T");

  return new Date(normalized.endsWith("Z") ? normalized : `${normalized}Z`);
}

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

app.get("/api/competition", async (c) => {
  const db = createDb(c.env.DB);

  const settings = await db
    .select()
    .from(competitionSettings)
    .where(eq(competitionSettings.id, 1))
    .get();

  if (!settings) {
    return c.json(
      {
        success: false,
        error: "Competition settings are not initialized.",
      },
      500
    );
  }

  return c.json({
    success: true,
    data: {
      isOpen: Boolean(settings.isOpen),
      startDate: parseSqliteUtc(settings.startDate).toISOString(),
      endDate: parseSqliteUtc(settings.endDate).toISOString(),
      maxStorageBytes: settings.maxStorageBytes,
      maxPhotoSizeBytes: settings.maxPhotoSizeBytes,
      maxVideoSizeBytes: settings.maxVideoSizeBytes,
    },
  });
});

app.post("/api/submissions", async (c) => {
  const turnstileToken = c.req.header("x-turnstile-token");

  const turnstileOk = await verifyTurnstile(turnstileToken);

  if (!turnstileOk) {
    return c.json(
      {
        success: false,
        error: "Turnstile verification failed.",
      },
      400
    );
  }

  let rawBody: unknown;

  try {
    rawBody = await c.req.json();
  } catch {
    return c.json(
      {
        success: false,
        error: "Invalid JSON body.",
      },
      400
    );
  }

  const parsed = CreateSubmissionSchema.safeParse(rawBody);

  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid submission payload.";

    return c.json(
      {
        success: false,
        error: message,
      },
      400
    );
  }

  const db = createDb(c.env.DB);

  const settings = await db
    .select()
    .from(competitionSettings)
    .where(eq(competitionSettings.id, 1))
    .get();

  if (!settings) {
    return c.json(
      {
        success: false,
        error: "Competition settings are not initialized.",
      },
      500
    );
  }

  if (!settings.isOpen) {
    return c.json(
      {
        success: false,
        error: "Competition is closed.",
      },
      403
    );
  }

  const now = new Date();
  const startDate = parseSqliteUtc(settings.startDate);
  const endDate = parseSqliteUtc(settings.endDate);

  if (now < startDate || now > endDate) {
    return c.json(
      {
        success: false,
        error: "Competition is not active.",
      },
      403
    );
  }

  const submissionId = crypto.randomUUID();
  const receiptToken = generateRandomToken();
  const receiptTokenHash = await sha256Hex(receiptToken);
  const nowIso = now.toISOString();

  try {
    await db.insert(submissions).values({
      id: submissionId,
      participantName: parsed.data.name,
      grade: parsed.data.grade,
      section: parsed.data.section,
      rollNo: parsed.data.rollNo,
      category: parsed.data.category,
      status: "draft",
      receiptTokenHash,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  } catch (error) {
    // D1 puts the constraint text on the cause chain, not the outer error.
    let message = error instanceof Error ? error.message : String(error);

    for (let cause = (error as { cause?: unknown } | null)?.cause;
      cause;
      cause = (cause as { cause?: unknown }).cause) {
      message += `\n${cause instanceof Error ? cause.message : String(cause)}`;
    }

    if (message.includes("UNIQUE constraint failed")) {
      return c.json(
        {
          success: false,
          error:
            "A submission already exists for this grade, section, and roll number.",
        },
        409
      );
    }

    throw error;
  }

  return c.json(
    {
      success: true,
      data: {
        submissionId,
        receiptToken,
        status: "draft",
      },
    },
    201
  );
});

app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: "Route not found.",
    },
    404
  );
});

app.onError((error, c) => {
  console.error(error);

  return c.json(
    {
      success: false,
      error: "Internal server error.",
    },
    500
  );
});

export default app;
