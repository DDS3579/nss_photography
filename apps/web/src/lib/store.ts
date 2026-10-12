import { create } from "zustand";

type UploadStatus = "idle" | "creating" | "uploading" | "completing" | "success" | "error";

interface AppState {
  status: UploadStatus;
  progress: number;
  submissionId: string | null;
  receiptToken: string | null;
  fileId: string | null;
  errorMessage: string | null;

  setStatus: (status: UploadStatus) => void;
  setProgress: (progress: number) => void;
  setSubmissionData: (submissionId: string, receiptToken: string) => void;
  setFileId: (fileId: string) => void;
  setError: (message: string) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  status: "idle",
  progress: 0,
  submissionId: null,
  receiptToken: null,
  fileId: null,
  errorMessage: null,

  setStatus: (status) => set({ status }),
  setProgress: (progress) => set({ progress }),
  setSubmissionData: (submissionId, receiptToken) =>
    set({ submissionId, receiptToken }),
  setFileId: (fileId) => set({ fileId }),
  setError: (message) => set({ status: "error", errorMessage: message }),
  reset: () =>
    set({
      status: "idle",
      progress: 0,
      submissionId: null,
      receiptToken: null,
      fileId: null,
      errorMessage: null,
    }),
}));