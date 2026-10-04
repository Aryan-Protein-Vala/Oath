"use client";

import { useState, useRef, useEffect } from "react";
import {
  X,
  Upload,
  Camera,
  Link2,
  FileText,
  Loader2,
  CheckCircle,
  Image as ImageIcon,
} from "lucide-react";
import { submitProof, uploadProofFile } from "@/lib/data-hooks";
import { showToast } from "./Toast";
import type { Oath } from "@/lib/types";

interface ProofUploadModalProps {
  oath: Oath;
  onClose: () => void;
  onSuccess: () => void;
}

type ProofType = "photo" | "video" | "screenshot" | "link" | "text";

export default function ProofUploadModal({ oath, onClose, onSuccess }: ProofUploadModalProps) {
  const [proofType, setProofType] = useState<ProofType>("photo");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [textNote, setTextNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleFile = (f: File) => {
    setFile(f);
    if (f.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => setFilePreview(e.target?.result as string);
      reader.readAsDataURL(f);
    } else {
      setFilePreview(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleSubmit = async () => {
    setLoading(true);

    let proof_url: string | undefined;

    // Upload file if needed
    if ((proofType === "photo" || proofType === "video" || proofType === "screenshot") && file) {
      const url = await uploadProofFile(file, oath.id);
      if (!url) {
        showToast("File upload failed. Try again.", "error");
        setLoading(false);
        return;
      }
      proof_url = url;
    } else if (proofType === "link") {
      proof_url = linkUrl;
    }

    const { error } = await submitProof({
      oath_id: oath.id,
      proof_type: proofType,
      proof_url,
      proof_text: textNote || undefined,
    });

    if (error) {
      showToast(error, "error");
      setLoading(false);
      return;
    }

    setDone(true);
    showToast("Proof submitted! Entering review window.", "success");
    setTimeout(() => {
      onSuccess();
      onClose();
    }, 1800);
  };

  const canSubmit = (() => {
    if (proofType === "link") return /^https?:\/\/.+/i.test(linkUrl.trim());
    if (proofType === "text") return textNote.trim().length >= 10 && textNote.length <= 500;
    return file !== null;
  })();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="proof-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-4"
    >
      <div className="w-full max-w-md bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 fade-in shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_0px_rgba(255,255,255,0.05)] max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b-2 border-zinc-950 dark:border-zinc-800 shrink-0">
          <div className="min-w-0 flex-1 pr-2">
            <h3 id="proof-modal-title" className="text-sm font-black text-zinc-950 dark:text-zinc-100 tracking-tight">SUBMIT PROOF</h3>
            <p className="text-[10px] font-mono text-zinc-600 dark:text-zinc-500 mt-0.5 truncate">
              {oath.oath_statement}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close modal" className="w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-300 transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col items-center justify-center py-16 fade-in">
            <CheckCircle className="w-10 h-10 text-zinc-950 dark:text-zinc-300 mb-3" />
            <p className="text-sm font-bold text-zinc-950 dark:text-zinc-200">Proof submitted</p>
            <p className="text-[11px] font-mono text-zinc-600 mt-1">Sent for review</p>
          </div>
        ) : (
          <div className="p-4 sm:p-5 space-y-5 sm:space-y-6">
            {/* Proof Type Selector */}
            <div>
              <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.15em] mb-2 block">
                Proof Type
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 sm:gap-2">
                {(["photo", "screenshot", "video", "link", "text"] as ProofType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setProofType(t); setFile(null); setFilePreview(null); }}
                    className={`flex flex-col items-center justify-center gap-1 py-2.5 sm:py-2 border-2 text-[10px] sm:text-[9px] font-mono uppercase transition-all min-h-[44px] sm:min-h-0 ${
                      proofType === t
                        ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-200 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                        : "border-zinc-300 text-zinc-600 hover:border-zinc-950 hover:text-zinc-950 dark:border-zinc-800 dark:hover:border-zinc-700 bg-zinc-50 dark:bg-transparent"
                    }`}
                  >
                    {t === "photo" && <Camera className="w-3.5 h-3.5" />}
                    {t === "screenshot" && <ImageIcon className="w-3.5 h-3.5" />}
                    {t === "video" && <Upload className="w-3.5 h-3.5" />}
                    {t === "link" && <Link2 className="w-3.5 h-3.5" />}
                    {t === "text" && <FileText className="w-3.5 h-3.5" />}
                    <span className="truncate max-w-full px-1">{t}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* File Drop Zone */}
            {(proofType === "photo" || proofType === "screenshot" || proofType === "video") && (
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileRef.current?.click()}
                className={`relative border-2 border-dashed cursor-pointer transition-all ${
                  file ? "border-zinc-950 bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-900/40" : "border-zinc-300 dark:border-zinc-800 hover:border-zinc-500 bg-white dark:bg-transparent"
                }`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept={proofType === "video" ? "video/*" : "image/*"}
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />

                {filePreview ? (
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={filePreview} alt="Proof preview" className="w-full max-h-48 object-cover" />
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                      <p className="text-xs font-mono font-bold text-white">Click to change</p>
                    </div>
                  </div>
                ) : file ? (
                  <div className="flex items-center gap-3 px-4 py-6">
                    <Upload className="w-5 h-5 text-zinc-950 dark:text-zinc-500" />
                    <div>
                      <p className="text-sm text-zinc-950 dark:text-zinc-300 font-bold">{file.name}</p>
                      <p className="text-[10px] font-mono text-zinc-500">
                        {(file.size / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 gap-2">
                    <Upload className="w-6 h-6 text-zinc-400 dark:text-zinc-700" />
                    <p className="text-xs text-zinc-500 font-mono font-bold">Drop file or click to upload</p>
                  </div>
                )}
              </div>
            )}

            {/* Link Input */}
            {proofType === "link" && (
              <div className="fade-in">
                <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-500 uppercase tracking-[0.15em] mb-1.5 block">
                  URL
                </label>
                <input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3.5 py-3 text-base sm:text-sm border-2 border-zinc-950 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-950 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none transition-colors"
                />
              </div>
            )}

            {/* Text Note */}
            {proofType === "text" && (
              <div className="fade-in">
                <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-500 uppercase tracking-[0.15em] mb-1.5 block">
                  Description
                </label>
                <textarea
                  value={textNote}
                  onChange={(e) => setTextNote(e.target.value)}
                  maxLength={500}
                  placeholder="Describe exactly what you did and how you verified it..."
                  className="w-full px-3.5 py-3 text-base sm:text-sm border-2 border-zinc-950 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-950 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none transition-colors resize-none"
                  rows={4}
                />
                <p className="text-[10px] font-mono font-bold text-zinc-500 mt-1.5">{textNote.length}/500</p>
              </div>
            )}

            {/* Optional note for file types */}
            {(proofType === "photo" || proofType === "screenshot" || proofType === "video" || proofType === "link") && (
              <div>
                <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-500 uppercase tracking-[0.15em] mb-1.5 block">
                  Context (optional)
                </label>
                <textarea
                  value={textNote}
                  onChange={(e) => setTextNote(e.target.value)}
                  maxLength={500}
                  placeholder="Add any context for your verifier..."
                  className="w-full px-3.5 py-3 text-base sm:text-sm border-2 border-zinc-950 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-950 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none transition-colors resize-none"
                  rows={2}
                />
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || loading}
              className={`w-full flex items-center justify-center gap-2 py-4 text-sm font-black uppercase tracking-widest transition-all shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none ${
                !canSubmit || loading
                  ? "bg-zinc-300 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-600 cursor-not-allowed border-2 border-transparent"
                  : "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 border-2 border-zinc-950 dark:border-transparent"
              }`}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {loading ? "Uploading..." : "Submit Proof"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
