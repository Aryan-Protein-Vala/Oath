"use client";

import { useState, useRef } from "react";
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
    setTimeout(() => {
      onSuccess();
      onClose();
    }, 1800);
  };

  const canSubmit = (() => {
    if (proofType === "link") return linkUrl.trim().length > 5;
    if (proofType === "text") return textNote.trim().length > 10;
    return file !== null;
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-[#0a0a0f] border border-zinc-800 fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <h3 className="text-sm font-black text-zinc-100 tracking-tight">SUBMIT PROOF</h3>
            <p className="text-[10px] font-mono text-zinc-600 mt-0.5 truncate max-w-xs">
              {oath.oath_statement}
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col items-center justify-center py-16 fade-in">
            <CheckCircle className="w-10 h-10 text-zinc-300 mb-3" />
            <p className="text-sm font-bold text-zinc-200">Proof submitted</p>
            <p className="text-[11px] font-mono text-zinc-600 mt-1">Sent for review</p>
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Proof Type Selector */}
            <div>
              <label className="text-[10px] font-mono text-zinc-600 uppercase tracking-[0.15em] mb-2 block">
                Proof Type
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {(["photo", "screenshot", "video", "link", "text"] as ProofType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setProofType(t); setFile(null); setFilePreview(null); }}
                    className={`flex flex-col items-center gap-1 py-2 border text-[9px] font-mono uppercase transition-all ${
                      proofType === t
                        ? "border-zinc-500 bg-zinc-800/60 text-zinc-200"
                        : "border-zinc-800 text-zinc-600 hover:border-zinc-700"
                    }`}
                  >
                    {t === "photo" && <Camera className="w-3.5 h-3.5" />}
                    {t === "screenshot" && <ImageIcon className="w-3.5 h-3.5" />}
                    {t === "video" && <Upload className="w-3.5 h-3.5" />}
                    {t === "link" && <Link2 className="w-3.5 h-3.5" />}
                    {t === "text" && <FileText className="w-3.5 h-3.5" />}
                    {t}
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
                className={`relative border border-dashed cursor-pointer transition-all ${
                  file ? "border-zinc-600 bg-zinc-900/40" : "border-zinc-800 hover:border-zinc-700"
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
                      <p className="text-xs font-mono text-zinc-200">Click to change</p>
                    </div>
                  </div>
                ) : file ? (
                  <div className="flex items-center gap-3 px-4 py-6">
                    <Upload className="w-5 h-5 text-zinc-500" />
                    <div>
                      <p className="text-sm text-zinc-300 font-medium">{file.name}</p>
                      <p className="text-[10px] font-mono text-zinc-600">
                        {(file.size / 1024 / 1024).toFixed(1)} MB
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 gap-2">
                    <Upload className="w-6 h-6 text-zinc-700" />
                    <p className="text-xs text-zinc-600 font-mono">Drop file or click to upload</p>
                  </div>
                )}
              </div>
            )}

            {/* Link Input */}
            {proofType === "link" && (
              <div className="fade-in">
                <label className="text-[10px] font-mono text-zinc-600 uppercase tracking-[0.15em] mb-1.5 block">
                  URL
                </label>
                <input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3.5 py-2.5 text-sm border border-zinc-800 bg-zinc-950/50 focus:border-zinc-600 transition-colors"
                />
              </div>
            )}

            {/* Text Note */}
            {proofType === "text" && (
              <div className="fade-in">
                <label className="text-[10px] font-mono text-zinc-600 uppercase tracking-[0.15em] mb-1.5 block">
                  Description
                </label>
                <textarea
                  value={textNote}
                  onChange={(e) => setTextNote(e.target.value)}
                  placeholder="Describe exactly what you did and how you verified it..."
                  className="w-full px-3.5 py-2.5 text-sm border border-zinc-800 bg-zinc-950/50 focus:border-zinc-600 transition-colors resize-none"
                  rows={4}
                />
                <p className="text-[10px] font-mono text-zinc-700 mt-1">{textNote.length}/500</p>
              </div>
            )}

            {/* Optional note for file types */}
            {(proofType === "photo" || proofType === "screenshot" || proofType === "video" || proofType === "link") && (
              <div>
                <label className="text-[10px] font-mono text-zinc-600 uppercase tracking-[0.15em] mb-1.5 block">
                  Context (optional)
                </label>
                <textarea
                  value={textNote}
                  onChange={(e) => setTextNote(e.target.value)}
                  placeholder="Add any context for your verifier..."
                  className="w-full px-3.5 py-2 text-sm border border-zinc-800 bg-zinc-950/50 focus:border-zinc-600 transition-colors resize-none"
                  rows={2}
                />
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || loading}
              className={`w-full flex items-center justify-center gap-2 py-3 text-sm font-black uppercase tracking-tight transition-all ${
                !canSubmit || loading
                  ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                  : "bg-zinc-50 text-zinc-950 hover:bg-zinc-200"
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
