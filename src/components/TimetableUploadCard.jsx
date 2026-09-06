import { FileText, Image as ImageIcon, File, Trash2, Edit2, RefreshCw, Check, X, UploadCloud, FileUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext.jsx";
import {
  deleteTimetableDocument,
  renameTimetableDocument,
  reprocessTimetableDocuments,
  subscribeTimetableDocuments,
  uploadTimetableDocuments,
} from "../services/timetableService.js";

function getFileIcon(name, type) {
  if (type?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(name)) return ImageIcon;
  if (/\.pdf$/i.test(name)) return FileText;
  return File;
}

export function TimetableUploadCard({ timetableId }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [docs, setDocs] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [processing, setProcessing] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (!user?.uid) return;
    return subscribeTimetableDocuments(user.uid, setDocs);
  }, [user?.uid]);

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const allowed = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "image/png","image/jpeg","image/webp","image/gif","text/plain","text/csv",
    ];
    const filtered = files.filter(f => {
      const ok = allowed.includes(f.type) || /\.(pdf|docx|png|jpe?g|webp|gif|txt)$/i.test(f.name);
      if (!ok) setStatus(`Skipped ${f.name}: unsupported type`);
      return ok;
    });
    if (!filtered.length) return;
    setBusy(true);
    setStatus(t("timetable.upload_uploading") || "Uploading...");
    try {
      await uploadTimetableDocuments(user.uid, filtered, p => setStatus(`${t("timetable.upload_uploading") || "Uploading..."} ${p}%`));
      setStatus(t("timetable.upload_done") || "Upload complete");
      // Auto-process after upload (first upload generates, subsequent merges)
      setProcessing(true);
      setStatus(t("timetable.upload_processing") || "Extracting & building timetable...");
      const result = await reprocessTimetableDocuments(user.uid, timetableId);
      if (result?.extracted) {
        const count = (result.extracted.assessments?.length || 0) + (result.extracted.syllabus?.length || 0);
        setStatus(`${t("timetable.upload_extracted") || "Extracted"} ${result.extracted.assessments?.length || 0} assessments, ${result.extracted.syllabus?.length || 0} subjects`);
      } else {
        setStatus(t("timetable.upload_processed") || "Processed");
      }
    } catch (e) {
      setStatus(e.message || "Upload failed");
    } finally {
      setBusy(false);
      setProcessing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDrop = e => {
    e.preventDefault(); setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleDelete = async (doc) => {
    if (!confirm(`Delete ${doc.name}?`)) return;
    await deleteTimetableDocument(user.uid, doc.id, doc.publicId, doc.resourceType);
  };

  const startRename = doc => { setEditingId(doc.id); setEditName(doc.name); };
  const confirmRename = async doc => {
    if (!editName.trim() || editName===doc.name) { setEditingId(null); return; }
    await renameTimetableDocument(user.uid, doc.id, editName.trim());
    setEditingId(null);
  };

  const handleReplace = async (doc, fileList) => {
    const files = Array.from(fileList||[]);
    if (!files.length) return;
    await deleteTimetableDocument(user.uid, doc.id, doc.publicId, doc.resourceType);
    await handleFiles(files);
  };

  const handleReprocess = async () => {
    setProcessing(true);
    setStatus(t("timetable.upload_reprocessing") || "Reprocessing...");
    try {
      await reprocessTimetableDocuments(user.uid, timetableId);
      setStatus(t("timetable.upload_reprocessed") || "Reprocessed successfully");
    } catch(e) { setStatus(e.message); }
    finally { setProcessing(false); }
  };

  return (
    <section className="rounded-3xl border border-border bg-surface p-6 shadow-sm">
      <div className="flex items-center gap-3 mb-2">
        <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
          <FileUp size={20} />
        </div>
        <div>
          <h2 className="text-lg font-black tracking-tight text-text-primary">{t("timetable.upload_title") || "Timetable Setup"}</h2>
          <p className="text-xs text-text-secondary">{t("timetable.upload_subtitle") || "Upload documents to help AI build and continuously optimise your study plan."}</p>
        </div>
      </div>

      <label
        onDragOver={e=>{e.preventDefault(); setDragOver(true);}}
        onDragLeave={()=>setDragOver(false)}
        onDrop={onDrop}
        className={`mt-4 grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed bg-background p-8 text-center transition ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary"}`}
      >
        <UploadCloud size={28} className="text-primary" />
        <strong className="mt-2 text-text-primary">{t("timetable.upload_documents") || "Upload Documents"}</strong>
        <span className="mt-1 text-xs text-text-secondary">{t("timetable.upload_accepted") || "Accepted: PDF • DOCX • PNG • JPG • WEBP"}</span>
        <span className="mt-1 text-[11px] text-text-muted">{t("timetable.upload_hint2") || "Drag & drop or click to browse – multiple files supported"}</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv"
          className="hidden"
          onChange={e=>handleFiles(e.target.files)}
          disabled={busy||processing}
        />
      </label>

      {status ? (
        <p className={`mt-3 rounded-xl border px-3 py-2 text-xs font-bold ${status.includes("failed")||status.includes("error") ? "border-status-error/20 bg-status-error/10 text-status-error" : "border-primary/20 bg-primary/5 text-text-secondary"}`}>
          {busy||processing ? <RefreshCw size={12} className="inline animate-spin mr-1" /> : null}{status}
        </p>
      ) : null}

      <div className="mt-5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-black text-text-primary">{t("timetable.uploaded_documents") || "Uploaded Documents"}</h3>
          {docs.length>0 ? (
            <button onClick={handleReprocess} disabled={processing||busy} className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-bold text-text-secondary hover:border-primary disabled:opacity-50">
              <RefreshCw size={12} className={processing?"animate-spin": ""} /> {t("timetable.reprocess") || "Re-run AI processing"}
            </button>
          ) : null}
        </div>

        {docs.length===0 ? (
          <p className="text-sm italic text-text-muted">{t("timetable.no_documents") || "No documents yet – upload your assessment schedule or syllabus to get started."}</p>
        ) : (
          <ul className="space-y-2">
            {docs.map(doc=>{
              const Icon = getFileIcon(doc.name, doc.type);
              const isEditing = editingId===doc.id;
              return (
                <li key={doc.id} className="flex items-center gap-3 rounded-2xl border border-border bg-background p-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon size={14} /></span>
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <input value={editName} onChange={e=>setEditName(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-2 py-1 text-sm" autoFocus onKeyDown={e=>{if(e.key==="Enter") confirmRename(doc); if(e.key==="Escape") setEditingId(null);}} />
                    ) : (
                      <p className="truncate text-sm font-bold text-text-primary">{doc.name}</p>
                    )}
                    <p className="text-[11px] text-text-muted">
                      {(doc.size/1024).toFixed(1)} KB • {doc.processingStatus==="success" ? <span className="text-status-success font-bold inline-flex items-center gap-1"><Check size={10}/> {t("timetable.extracted_ok")||"extracted"}</span> : doc.processingStatus==="pending" ? t("timetable.pending")||"pending" : doc.processingStatus}
                      {doc.extraction?.assessments?.length ? ` • ${doc.extraction.assessments.length} assessments` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {isEditing ? (
                      <>
                        <button onClick={()=>confirmRename(doc)} className="rounded-lg bg-primary p-1.5 text-white"><Check size={12}/></button>
                        <button onClick={()=>setEditingId(null)} className="rounded-lg border border-border p-1.5"><X size={12}/></button>
                      </>
                    ) : (
                      <button onClick={()=>startRename(doc)} className="rounded-lg border border-border bg-surface p-1.5 text-text-muted hover:text-primary" title={t("timetable.rename")||"Rename"}><Edit2 size={12}/></button>
                    )}
                    <label className="cursor-pointer rounded-lg border border-border bg-surface p-1.5 text-text-muted hover:text-primary" title={t("timetable.replace")||"Replace"}>
                      <RefreshCw size={12} />
                      <input type="file" className="hidden" accept=".pdf,.docx,.png,.jpg,.jpeg,.webp" onChange={e=>handleReplace(doc, e.target.files)} />
                    </label>
                    <button onClick={()=>handleDelete(doc)} className="rounded-lg border border-border bg-surface p-1.5 text-text-muted hover:bg-status-error/10 hover:text-status-error" title={t("timetable.delete")||"Delete"}><Trash2 size={12}/></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-text-muted">
        {t("timetable.upload_persistence_note") || "Originals + extracted metadata are saved. Regeneration never requires re-upload; future uploads merge intelligently and preserve completed sessions."}
      </p>
    </section>
  );
}
