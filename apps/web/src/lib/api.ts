const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8787";

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || "An unknown error occurred.");
  }
  return data.data;
}

export interface SubmissionPayload {
  name: string;
  grade: 11 | 12;
  section: string;
  rollNo: string;
  category: "photo" | "video";
}

export interface InitiateUploadPayload {
  submissionId: string;
  receiptToken: string;
  category: "photo" | "video";
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export async function createSubmission(payload: SubmissionPayload) {
  const res = await fetch(`${API_BASE}/api/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<{ submissionId: string; receiptToken: string }>(res);
}

export async function initiateUpload(payload: InitiateUploadPayload) {
  const res = await fetch(`${API_BASE}/api/uploads/initiate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<{ fileId: string; uploadUrl: string }>(res);
}

export async function completeUpload(
  submissionId: string,
  receiptToken: string,
  fileId: string
) {
  const res = await fetch(`${API_BASE}/api/uploads/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ submissionId, receiptToken, fileId }),
  });
  return handleResponse<{ status: string }>(res);
}