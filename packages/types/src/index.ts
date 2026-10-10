import { z } from "zod";

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

export const GRADE_11_SECTIONS = Array.from(
  { length: 18 },
  (_, index) => `D${index + 1}`
) as [string, ...string[]];

export const GRADE_12_SECTIONS = Array.from(
  { length: 18 },
  (_, index) => `M${index + 1}`
) as [string, ...string[]];

export const Grade11SectionSchema = z.enum(GRADE_11_SECTIONS);
export const Grade12SectionSchema = z.enum(GRADE_12_SECTIONS);

export const GradeSchema = z.union([z.literal(11), z.literal(12)]);
export type Grade = z.infer<typeof GradeSchema>;

export const CategorySchema = z.enum(["photo", "video"]);
export type Category = z.infer<typeof CategorySchema>;

export const SubmissionStatusSchema = z.enum([
  "draft",
  "uploading",
  "completed",
  "rejected",
]);
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;

export const FileUploadStatusSchema = z.enum([
  "pending",
  "completed",
  "aborted",
]);
export type FileUploadStatus = z.infer<typeof FileUploadStatusSchema>;

const baseSubmissionFields = {
  name: z.string().trim().min(1),
  rollNo: z.string().trim().min(1),
  category: CategorySchema,
};

export const CreateSubmissionSchema = z.discriminatedUnion("grade", [
  z.object({
    grade: z.literal(11),
    section: Grade11SectionSchema,
    ...baseSubmissionFields,
  }),
  z.object({
    grade: z.literal(12),
    section: Grade12SectionSchema,
    ...baseSubmissionFields,
  }),
]);

export type CreateSubmission = z.infer<typeof CreateSubmissionSchema>;

export const CreateUploadSchema = z
  .object({
    category: CategorySchema,
    filename: z.string().trim().min(1),
    mimeType: z.string().trim().min(1),
    sizeBytes: z.number().int().positive(),
  })
  .superRefine((value, ctx) => {
    const mimeType = value.mimeType.toLowerCase();

    if (value.category === "photo") {
      if (!mimeType.startsWith("image/")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mimeType"],
          message: "Photo upload must have an image MIME type.",
        });
      }

      if (value.sizeBytes > MAX_PHOTO_BYTES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sizeBytes"],
          message: "Photo size must be 25 MB or less.",
        });
      }
    }

    if (value.category === "video") {
      if (!mimeType.startsWith("video/")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mimeType"],
          message: "Video upload must have a video MIME type.",
        });
      }

      if (value.sizeBytes > MAX_VIDEO_BYTES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sizeBytes"],
          message: "Video size must be 500 MB or less.",
        });
      }
    }
  });

export type CreateUpload = z.infer<typeof CreateUploadSchema>;

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