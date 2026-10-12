import { eq, sql } from "drizzle-orm";
import { createDb } from "../db";
import { competitionSettings, competitionUsage } from "../db/schema";

export async function checkAndReserveQuota(
  db: ReturnType<typeof createDb>,
  sizeBytes: number
): Promise<{ ok: boolean; error?: string }> {
  const settings = await db
    .select()
    .from(competitionSettings)
    .where(eq(competitionSettings.id, 1))
    .get();

  if (!settings) {
    return { ok: false, error: "Competition settings not initialized." };
  }

  const usage = await db
    .select()
    .from(competitionUsage)
    .where(eq(competitionUsage.id, 1))
    .get();

  if (!usage) {
    return { ok: false, error: "Competition usage not initialized." };
  }

  const totalAfter = usage.usedBytes + usage.reservedBytes + sizeBytes;

  if (totalAfter > settings.maxStorageBytes) {
    return {
      ok: false,
      error: "Storage quota exceeded. Please try again later.",
    };
  }

  await db
    .update(competitionUsage)
    .set({
      reservedBytes: usage.reservedBytes + sizeBytes,
    })
    .where(eq(competitionUsage.id, 1));

  return { ok: true };
}

export async function convertReservationToUsed(
  db: ReturnType<typeof createDb>,
  sizeBytes: number
): Promise<void> {
  await db
    .update(competitionUsage)
    .set({
      usedBytes: sql`used_bytes + ${sizeBytes}`,
      reservedBytes: sql`reserved_bytes - ${sizeBytes}`,
    })
    .where(eq(competitionUsage.id, 1));
}

export async function releaseReservation(
  db: ReturnType<typeof createDb>,
  sizeBytes: number
): Promise<void> {
  await db
    .update(competitionUsage)
    .set({
      reservedBytes: sql`MAX(0, reserved_bytes - ${sizeBytes})`,
    })
    .where(eq(competitionUsage.id, 1));
}