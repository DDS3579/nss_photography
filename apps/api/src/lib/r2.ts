export function buildR2Key(
  grade: number,
  section: string,
  rollNo: string,
  fileId: string,
  filename: string
): string {
  const ext = filename.includes(".")
    ? filename.split(".").pop()
    : "bin";

  return `entries/grade-${grade}/section-${section}/roll-${rollNo}/${fileId}.${ext}`;
}