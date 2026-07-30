"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createForm16Upload, recordFailedForm16Upload } from "./actions";

const inputClass = "rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const labelClass = "flex flex-col gap-1 text-sm text-zinc-700 dark:text-zinc-300";

type UploadPhase = "idle" | "uploading" | "needs-password" | "error" | "no-text-layer";

/**
 * Handles the FULL password flow `parseForm16Pdf()` (via
 * `POST /api/form16/upload`) can return, not just the success case:
 * `needs-password` / `wrong-password` prompt for a password and retry
 * (re-posting the same in-memory `File`); `no-text-layer` points the user
 * at manual entry (`/form16/manual`) instead of retrying forever;
 * `failed` shows the error and allows retry. Only on `success` does this
 * persist anything (`createForm16Upload`), then navigates to the mandatory
 * review screen.
 */
export function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pan, setPan] = useState("");
  const [dob, setDob] = useState("");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [wrongPasswordAttempts, setWrongPasswordAttempts] = useState(0);

  async function upload(withPassword?: string) {
    if (!file) {
      setMessage("Choose a Form 16 PDF first.");
      return;
    }
    setPhase("uploading");
    setMessage(null);

    const formData = new FormData();
    formData.append("file", file);
    if (pan) formData.append("pan", pan);
    if (dob) formData.append("dob", dob);
    if (withPassword) formData.append("password", withPassword);

    const response = await fetch("/api/form16/upload", { method: "POST", body: formData });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setPhase("error");
      setMessage(body.error ?? `Upload failed (${response.status})`);
      return;
    }

    const body = await response.json();
    const { fileHash, blobUrl, parseResult } = body as {
      fileHash: string;
      blobUrl: string;
      parseResult:
        | { status: "success"; partA: unknown; partB: unknown }
        | { status: "needs-password" }
        | { status: "wrong-password"; attempted: string[] }
        | { status: "no-text-layer"; message: string }
        | { status: "failed"; message: string };
    };

    switch (parseResult.status) {
      case "success": {
        const result = await createForm16Upload({
          fileHash,
          blobUrl,
          partA: parseResult.partA as never,
          partB: parseResult.partB as never,
        });
        if (!result.ok || !result.data) {
          setPhase("error");
          setMessage(result.error ?? "Failed to save the parsed Form 16.");
          return;
        }
        router.push(`/form16/review/${result.data.uploadId}`);
        return;
      }
      case "needs-password":
        setPhase("needs-password");
        setMessage("This PDF is password-protected. Enter the password (often PAN in caps + date of birth as DDMMYYYY).");
        return;
      case "wrong-password":
        setWrongPasswordAttempts((n) => n + 1);
        setPhase("needs-password");
        setMessage("That password didn't work. Try again.");
        return;
      case "no-text-layer":
        setPhase("no-text-layer");
        setMessage(parseResult.message);
        await recordFailedForm16Upload(fileHash, blobUrl);
        return;
      case "failed":
        setPhase("error");
        setMessage(parseResult.message);
        await recordFailedForm16Upload(fileHash, blobUrl);
        return;
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Upload a Form 16 PDF</h2>

      <label className={labelClass}>
        Form 16 PDF
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPhase("idle");
            setMessage(null);
          }}
          className={inputClass}
        />
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          PAN (used to auto-derive the PDF password)
          <input value={pan} onChange={(e) => setPan(e.target.value)} placeholder="ABCDE1234F" className={inputClass} />
        </label>
        <label className={labelClass}>
          Date of birth (same purpose)
          <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className={inputClass} />
        </label>
      </div>

      {phase === "needs-password" && (
        <label className={labelClass}>
          PDF password{wrongPasswordAttempts > 0 ? ` (attempt ${wrongPasswordAttempts + 1})` : ""}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </label>
      )}

      {message && (
        <p className={`text-sm ${phase === "error" ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
          {message}
          {phase === "no-text-layer" && (
            <>
              {" "}
              <a href="/form16/manual" className="font-medium underline">
                Enter salary details manually instead
              </a>
              .
            </>
          )}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={phase === "uploading" || !file}
          onClick={() => upload(phase === "needs-password" ? password : undefined)}
          className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {phase === "uploading" ? "Uploading…" : phase === "needs-password" ? "Retry with password" : "Upload & parse"}
        </button>
      </div>
    </div>
  );
}
