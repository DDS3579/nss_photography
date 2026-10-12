import { Hono } from "hono";
import { cors } from "hono/cors";
import { eq, and } from "drizzle-orm";

import {
  CreateSubmissionSchema,
  InitiateUploadSchema,
  CompleteUploadSchema,
  AbortUploadSchema,
  HealthResponseSchema,
} from "@competition-portal/types";

import { createDb } from "./db";
import {
  competitionSettings,
  submissions,
  files,
  uploadReservations,
} from "./db/schema";
import { generateRandomToken, sha256Hex } from "./lib/crypto";
import { verifyTurnstile } from "./lib/turnstile";
import { verifyReceiptToken } from "./lib/receipt";
import {
  checkAndReserveQuota,
  convertReservationToUsed,
  releaseReservation,
} from "./lib/quota";
import { buildR2Key } from "./lib/r2";

type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-Turnstile-Token"],
  })
);

function parseSqliteUtc(value: string): Date {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  return new Date(normalized.endsWith("Z") ? normalized : `${normalized}Z`);
}

// ─── Health ──────────────────────────────────────────────

app.get("/", (c) => c.text("competition api"));

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
  return c.json(HealthResponseSchema.parse(body));
});

// ─── Competition Settings ────────────────────────────────

app.get("/api/competition", async (c) => {
  const db = createDb(c.env.DB);

  const settings = await db
    .select()
    .from(competitionSettings)
    .where(eq(competitionSettings.id, 1))
    .get();

  if (!settings) {
    return c.json(
      { success: false, error: "Competition settings are not initialized." },
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

// ─── Create Submission ──────────────────────────────────

app.post("/api/submissions", async (c) => {
  const turnstileOk = await verifyTurnstile(
    c.req.header("x-turnstile-token")
  );
  if (!turnstileOk) {
    return c.json({ success: false, error: "Turnstile verification failed." }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body." }, 400);
  }

  const parsed = CreateSubmissionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Invalid submission payload." },
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
    return c.json({ success: false, error: "Competition settings are not initialized." }, 500);
  }
  if (!settings.isOpen) {
    return c.json({ success: false, error: "Competition is closed." }, 403);
  }

  const now = new Date();
  if (now < parseSqliteUtc(settings.startDate) || now > parseSqliteUtc(settings.endDate)) {
    return c.json({ success: false, error: "Competition is not active." }, 403);
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
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("UNIQUE constraint failed")) {
      return c.json(
        { success: false, error: "A submission already exists for this grade, section, and roll number." },
        409
      );
    }
    throw error;
  }

  return c.json(
    { success: true, data: { submissionId, receiptToken, status: "draft" } },
    201
  );
});

// ─── Initiate Upload ─────────────────────────────────────

app.post("/api/uploads/initiate", async (c) => {
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body." }, 400);
  }

  const parsed = InitiateUploadSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Invalid upload payload." },
      400
    );
  }

  const db = createDb(c.env.DB);

  // Verify receipt token
  const receipt = await verifyReceiptToken(db, parsed.data.submissionId, parsed.data.receiptToken);
  if (!receipt.valid) {
    return c.json({ success: false, error: receipt.error }, 401);
  }

  // Get submission
  const submission = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, parsed.data.submissionId))
    .get();

  if (!submission) {
    return c.json({ success: false, error: "Submission not found." }, 404);
  }

  if (submission.status !== "draft") {
    return c.json(
      { success: false, error: `Submission is already in '${submission.status}' status.` },
      409
    );
  }

  // Validate category matches submission
  if (submission.category !== parsed.data.category) {
    return c.json(
      { success: false, error: "Upload category does not match submission category." },
      400
    );
  }

  // Check size limits
  const settings = await db
    .select()
    .from(competitionSettings)
    .where(eq(competitionSettings.id, 1))
    .get();

  if (!settings) {
    return c.json({ success: false, error: "Settings not initialized." }, 500);
  }

  const maxSize =
    parsed.data.category === "photo"
      ? settings.maxPhotoSizeBytes
      : settings.maxVideoSizeBytes;

  if (parsed.data.sizeBytes > maxSize) {
    return c.json(
      {
        success: false,
        error: `File size exceeds the ${parsed.data.category} limit of ${maxSize} bytes.`,
      },
      400
    );
  }

  // Validate MIME type
  const mime = parsed.data.mimeType.toLowerCase();
  if (parsed.data.category === "photo" && !mime.startsWith("image/")) {
    return c.json({ success: false, error: "Photo must have an image MIME type." }, 400);
  }
  if (parsed.data.category === "video" && !mime.startsWith("video/")) {
    return c.json({ success: false, error: "Video must have a video MIME type." }, 400);
  }

  // Check and reserve quota
  const quota = await checkAndReserveQuota(db, parsed.data.sizeBytes);
  if (!quota.ok) {
    return c.json({ success: false, error: quota.error }, 503);
  }

  // Create file record
  const fileId = crypto.randomUUID();
  const r2Key = buildR2Key(
    submission.grade,
    submission.section,
    submission.rollNo,
    fileId,
    parsed.data.filename
  );
  const nowIso = new Date().toISOString();

  await db.insert(files).values({
    id: fileId,
    submissionId: submission.id,
    category: parsed.data.category,
    r2Key,
    filename: parsed.data.filename,
    mimeType: parsed.data.mimeType,
    sizeBytes: parsed.data.sizeBytes,
    uploadStatus: "pending",
    createdAt: nowIso,
  });

  // Create reservation
  const reservationId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  await db.insert(uploadReservations).values({
    id: reservationId,
    fileId,
    reservedBytes: parsed.data.sizeBytes,
    expiresAt,
    createdAt: nowIso,
  });

  // Update submission status
  await db
    .update(submissions)
    .set({ status: "uploading", updatedAt: nowIso })
    .where(eq(submissions.id, submission.id));

  // Build upload URL (Worker-proxied for now)
  const uploadUrl = `/api/uploads/${fileId}`;

  return c.json(
    {
      success: true,
      data: {
        fileId,
        uploadUrl,
        expiresAt,
      },
    },
    201
  );
});

// ─── Upload File (Worker-proxied to R2) ──────────────────

app.put("/api/uploads/:fileId", async (c) => {
  const fileId = c.req.param("fileId");
  const db = createDb(c.env.DB);

  const file = await db
    .select()
    .from(files)
    .where(eq(files.id, fileId))
    .get();

  if (!file) {
    return c.json({ success: false, error: "File not found." }, 404);
  }

  if (file.uploadStatus !== "pending") {
    return c.json(
      { success: false, error: `File is already in '${file.uploadStatus}' status.` },
      409
    );
  }

  const body = c.req.raw.body;
  if (!body) {
    return c.json({ success: false, error: "No file body provided." }, 400);
  }

  // Upload to R2
  await c.env.BUCKET.put(file.r2Key, body, {
    httpMetadata: {
      contentType: file.mimeType,
    },
  });

  // Update file status
  const nowIso = new Date().toISOString();
  await db
    .update(files)
    .set({ uploadStatus: "completed" })
    .where(eq(files.id, fileId));

  return c.json({ success: true, data: { fileId, status: "completed" } });
});

// ─── Complete Upload ─────────────────────────────────────

app.post("/api/uploads/complete", async (c) => {
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body." }, 400);
  }

  const parsed = CompleteUploadSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Invalid payload." },
      400
    );
  }

  const db = createDb(c.env.DB);

  // Verify receipt
  const receipt = await verifyReceiptToken(db, parsed.data.submissionId, parsed.data.receiptToken);
  if (!receipt.valid) {
    return c.json({ success: false, error: receipt.error }, 401);
  }

  // Get file
  const file = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.id, parsed.data.fileId),
        eq(files.submissionId, parsed.data.submissionId)
      )
    )
    .get();

  if (!file) {
    return c.json({ success: false, error: "File not found." }, 404);
  }

  if (file.uploadStatus !== "completed") {
    return c.json(
      { success: false, error: "File upload is not completed yet." },
      409
    );
  }

  // Verify file exists in R2
  const r2Object = await c.env.BUCKET.get(file.r2Key);
  if (!r2Object) {
    return c.json(
      { success: false, error: "File not found in storage." },
      500
    );
  }

  // Convert reservation to used quota
  await convertReservationToUsed(db, file.sizeBytes);

  // Delete reservation
  const reservation = await db
    .select()
    .from(uploadReservations)
    .where(eq(uploadReservations.fileId, file.id))
    .get();

  if (reservation) {
    await db
      .delete(uploadReservations)
      .where(eq(uploadReservations.id, reservation.id));
  }

  // Mark submission as completed
  const nowIso = new Date().toISOString();
  await db
    .update(submissions)
    .set({ status: "completed", updatedAt: nowIso })
    .where(eq(submissions.id, parsed.data.submissionId));

  return c.json({
    success: true,
    data: {
      submissionId: parsed.data.submissionId,
      status: "completed",
    },
  });
});

// ─── Abort Upload ────────────────────────────────────────

app.post("/api/uploads/abort", async (c) => {
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body." }, 400);
  }

  const parsed = AbortUploadSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Invalid payload." },
      400
    );
  }

  const db = createDb(c.env.DB);

  // Verify receipt
  const receipt = await verifyReceiptToken(db, parsed.data.submissionId, parsed.data.receiptToken);
  if (!receipt.valid) {
    return c.json({ success: false, error: receipt.error }, 401);
  }

  // Get file
  const file = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.id, parsed.data.fileId),
        eq(files.submissionId, parsed.data.submissionId)
      )
    )
    .get();

  if (!file) {
    return c.json({ success: false, error: "File not found." }, 404);
  }

  // Delete from R2 if it exists
  await c.env.BUCKET.delete(file.r2Key);

  // Release reservation
  const reservation = await db
    .select()
    .from(uploadReservations)
    .where(eq(uploadReservations.fileId, file.id))
    .get();

  if (reservation) {
    await releaseReservation(db, reservation.reservedBytes);
    await db
      .delete(uploadReservations)
      .where(eq(uploadReservations.id, reservation.id));
  }

  // Mark file as aborted
  await db
    .update(files)
    .set({ uploadStatus: "aborted" })
    .where(eq(files.id, file.id));

  // Revert submission to draft
  const nowIso = new Date().toISOString();
  await db
    .update(submissions)
    .set({ status: "draft", updatedAt: nowIso })
    .where(eq(submissions.id, parsed.data.submissionId));

  return c.json({
    success: true,
    data: {
      fileId: parsed.data.fileId,
      status: "aborted",
    },
  });
});

// ─── Error Handlers ──────────────────────────────────────

app.notFound((c) => {
  return c.json({ success: false, error: "Route not found." }, 404);
});

app.onError((error, c) => {
  console.error(error);
  return c.json({ success: false, error: "Internal server error." }, 500);
});

export default app;