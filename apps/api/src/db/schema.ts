import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const competitionSettings = sqliteTable("competition_settings", {
  id: integer("id").primaryKey(),
  isOpen: integer("is_open").notNull().default(1),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  maxStorageBytes: integer("max_storage_bytes").notNull().default(8000000000),
  maxPhotoSizeBytes: integer("max_photo_size_bytes").notNull().default(26214400),
  maxVideoSizeBytes: integer("max_video_size_bytes").notNull().default(524288000),
});

export const competitionUsage = sqliteTable("competition_usage", {
  id: integer("id").primaryKey(),
  usedBytes: integer("used_bytes").notNull().default(0),
  reservedBytes: integer("reserved_bytes").notNull().default(0),
});

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  participantName: text("participant_name").notNull(),
  grade: integer("grade").notNull(),
  section: text("section").notNull(),
  rollNo: text("roll_no").notNull(),
  category: text("category").notNull(),
  status: text("status").notNull().default("draft"),
  receiptTokenHash: text("receipt_token_hash").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id").notNull(),
  category: text("category").notNull(),
  r2Key: text("r2_key").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadStatus: text("upload_status").notNull().default("pending"),
  multipartUploadId: text("multipart_upload_id"),
  createdAt: text("created_at").notNull(),
});

export const uploadReservations = sqliteTable("upload_reservations", {
  id: text("id").primaryKey(),
  fileId: text("file_id").notNull(),
  reservedBytes: integer("reserved_bytes").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});