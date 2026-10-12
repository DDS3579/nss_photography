import { eq } from "drizzle-orm";
import { createDb } from "../db";
import { submissions } from "../db/schema";
import { sha256Hex } from "./crypto";

export async function verifyReceiptToken(
  db: ReturnType<typeof createDb>,
  submissionId: string,
  receiptToken: string
): Promise<{ valid: boolean; error?: string }> {
  const submission = await db
    .select()
    .from(submissions)
    .where(eq(submissions.id, submissionId))
    .get();

  if (!submission) {
    return { valid: false, error: "Submission not found." };
  }

  const tokenHash = await sha256Hex(receiptToken);

  if (tokenHash !== submission.receiptTokenHash) {
    return { valid: false, error: "Invalid receipt token." };
  }

  return { valid: true };
}