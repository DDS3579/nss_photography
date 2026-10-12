"use client";

import { useState, useEffect, useRef } from "react";
import Uppy from "@uppy/core";
import Dashboard from "@uppy/dashboard";
import XHRUpload from "@uppy/xhr-upload";
import "@uppy/core/css/style.css";
import "@uppy/dashboard/css/style.css";

import {
  createSubmission,
  initiateUpload,
  completeUpload,
} from "@/lib/api";
import { useAppStore } from "@/lib/store";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8787";

const SECTIONS_11 = Array.from({ length: 18 }, (_, i) => `D${i + 1}`);
const SECTIONS_12 = Array.from({ length: 18 }, (_, i) => `M${i + 1}`);

export default function Home() {
  const [name, setName] = useState("");
  const [grade, setGrade] = useState<11 | 12>(11);
  const [section, setSection] = useState("D1");
  const [rollNo, setRollNo] = useState("");

  const uppyRef = useRef<Uppy | null>(null);
  const dashboardRef = useRef<HTMLDivElement>(null);

  const {
    status,
    progress,
    receiptToken,
    errorMessage,
    setStatus,
    setProgress,
    setSubmissionData,
    setFileId,
    setError,
    reset,
  } = useAppStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!uppyRef.current) return;
    const files = uppyRef.current.getFiles();
    if (files.length === 0) {
      setError("Please select a photo or video.");
      return;
    }

    const file = files[0];
    if (file.size === null) {
      setError("Could not determine the selected file size.");
      return;
    }
    const category = file.type.startsWith("video/") ? "video" : "photo";

    try {
      reset();
      setStatus("creating");

      // 1. Create Submission
      const { submissionId, receiptToken } = await createSubmission({
        name,
        grade,
        section,
        rollNo,
        category,
      });

      // Save receipt token to localStorage as per architecture
      localStorage.setItem("receiptToken", receiptToken);
      localStorage.setItem("submissionId", submissionId);
      setSubmissionData(submissionId, receiptToken);

      // 2. Initiate Upload
      setStatus("uploading");
      const { fileId } = await initiateUpload({
        submissionId,
        receiptToken,
        category,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      setFileId(fileId);

      // 3. Configure Uppy to upload to the specific Worker endpoint
      const xhrUpload = uppyRef.current.getPlugin("XHRUpload");
      if (!xhrUpload) {
        throw new Error("The file uploader is unavailable.");
      }
      xhrUpload.setOptions({
        endpoint: `${API_BASE}/api/uploads/${fileId}`,
        method: "PUT",
        formData: false,
        headers: { "Content-Type": file.type },
      });

      // 4. Start Uppy Upload
      const result = await uppyRef.current.upload();

      if (result?.successful?.length) {
        setStatus("completing");
        // 5. Complete Upload
        await completeUpload(submissionId, receiptToken, fileId);
        setStatus("success");
      } else {
        throw new Error("Upload failed.");
      }
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Submission failed.");
    }
  };

  // Initialize Uppy
  useEffect(() => {
    if (!dashboardRef.current) return;

    const uppy = new Uppy({
      autoProceed: false,
      allowMultipleUploadBatches: false,
      restrictions: {
        maxNumberOfFiles: 1,
        allowedFileTypes: ["image/*", "video/*"],
      },
    })
      .use(XHRUpload, {
        endpoint: API_BASE,
        method: "PUT",
        formData: false,
      })
      .use(Dashboard, {
        target: dashboardRef.current,
        inline: true,
        proudlyDisplayPoweredByUppy: false,
        height: 200,
      })
      .on("file-added", (file) => {
        const isVideo = file.type.startsWith("video/");
        const maxSize = isVideo ? 500 * 1024 * 1024 : 25 * 1024 * 1024;
        if (file.size !== null && file.size > maxSize) {
          setError(`File too large. Max size is ${isVideo ? "500MB" : "25MB"}.`);
          uppy.removeFile(file.id);
        }
      })
      .on("upload-progress", (file, progress) => {
        if (progress.percentage) {
          setProgress(progress.percentage);
        }
      });

    uppyRef.current = uppy;

    return () => {
      uppy.destroy();
    };
  }, [setError, setProgress]);

  if (status === "success") {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-green-600 mb-4">
            Submission Successful!
          </h1>
          <p className="text-gray-600 mb-6">
            Your entry has been recorded. Please save your Receipt Token to check your status later.
          </p>
          <div className="bg-gray-100 p-4 rounded mb-6 break-all">
            <p className="text-xs text-gray-500 mb-1">Receipt Token:</p>
            <p className="font-mono text-sm font-bold">{receiptToken}</p>
          </div>
          <button
            onClick={reset}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
          >
            Submit Another Entry
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow-md">
        <h1 className="text-3xl font-bold text-center mb-2">
          Photography Contest
        </h1>
        <p className="text-center text-gray-500 mb-8">
          Grade 11 & 12 Submission Portal
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Full Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your full name"
            />
          </div>

          {/* Grade & Section */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Grade
              </label>
              <select
                value={grade}
                onChange={(e) => {
                  const nextGrade = Number(e.target.value) as 11 | 12;
                  setGrade(nextGrade);
                  setSection(nextGrade === 11 ? "D1" : "M1");
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value={11}>Grade 11</option>
                <option value={12}>Grade 12</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Section
              </label>
              <select
                value={section}
                onChange={(e) => setSection(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {(grade === 11 ? SECTIONS_11 : SECTIONS_12).map((sec) => (
                  <option key={sec} value={sec}>
                    {sec}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Roll No */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Roll Number
            </label>
            <input
              type="text"
              required
              value={rollNo}
              onChange={(e) => setRollNo(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your roll number"
            />
          </div>

          {/* Uppy Dashboard */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Upload Photo or Video
            </label>
            <div ref={dashboardRef} />
            <p className="text-xs text-gray-500 mt-2">
              Max size: 25MB for images, 500MB for videos.
            </p>
          </div>

          {/* Progress Bar */}
          {status === "uploading" && (
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              ></div>
              <p className="text-center text-sm text-gray-600 mt-1">
                Uploading... {Math.round(progress)}%
              </p>
            </div>
          )}

          {/* Error Message */}
          {status === "error" && errorMessage && (
            <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">
              {errorMessage}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={
              status === "creating" ||
              status === "uploading" ||
              status === "completing"
            }
            className="w-full bg-blue-600 text-white py-3 rounded-md font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {status === "creating" && "Creating Submission..."}
            {status === "uploading" && "Uploading File..."}
            {status === "completing" && "Finalizing..."}
            {(status === "idle" || status === "error") && "Submit Entry"}
          </button>
        </form>
      </div>
    </main>
  );
}