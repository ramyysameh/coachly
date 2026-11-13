"use client";
import { useMemo, useRef, useState } from "react";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync, must } from "@/lib/useAsync";
import { Button, Card, Empty, ErrorBox, Field, Input, Segmented, Select, Skeleton } from "@/components/ui";
import { errMsg, fmtDate, localDate } from "@/lib/utils";

export type Pose = "front" | "side" | "back";
const POSES: Pose[] = ["front", "side", "back"];
const POSE_LABEL: Record<Pose, string> = { front: "Front", side: "Side", back: "Back" };
type Photo = { id: string; taken_on: string; pose: Pose; storage_path: string; url: string | null };
const BUCKET = "progress-photos";

/** Shrink a phone photo before upload: longest side 1600 px, JPEG. Falls back to the original. */
async function downscale(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}

/**
 * Dated front / side / back photos in a private bucket. Only the client and their coach can
 * open them (short-lived signed URLs). The client uploads; the coach views and compares.
 */
export default function ProgressPhotos({ clientId, canUpload }: { clientId: string; canUpload: boolean }) {
  const supabase = createClient();
  const { data, loading, error, reload } = useAsync(async (): Promise<Photo[]> => {
    const rows = must(await supabase.from("progress_photos").select("id, taken_on, pose, storage_path").eq("client_id", clientId)
      .order("taken_on", { ascending: false })) as Omit<Photo, "url">[];
    if (!rows.length) return [];
    const signed = await supabase.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.storage_path), 3600);
    const urls = new Map<string | null, string>((signed.data ?? []).map((s: { path: string | null; signedUrl: string }) => [s.path, s.signedUrl]));
    return rows.map((r) => ({ ...r, url: urls.get(r.storage_path) ?? null }));
  }, [clientId]);

  const dates = useMemo(() => [...new Set((data ?? []).map((p) => p.taken_on))], [data]);

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        <Camera className="mt-0.5 size-5 text-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Progress photos</h2>
          <p className="text-xs text-muted">Front, side and back, dated. Private: only {canUpload ? "you and your coach" : "you and your client"} can see them.</p>
        </div>
      </div>
      {canUpload && <UploadForm clientId={clientId} existing={data ?? []} onDone={() => reload({ silent: true })} />}
      {loading ? (
        <Skeleton className="h-48" />
      ) : error || !data ? (
        <ErrorBox message={error ?? "Couldn't load photos"} onRetry={reload} />
      ) : data.length === 0 ? (
        <Empty icon={<ImagePlus className="size-8" />} title="No progress photos yet">
          {canUpload ? "Add front, side and back photos every few weeks to see change you can't weigh." : "Your client hasn't added any progress photos yet."}
        </Empty>
      ) : (
        <>
          {dates.length >= 2 && <Compare photos={data} dates={dates} />}
          <Gallery photos={data} dates={dates} canDelete={canUpload} onDeleted={() => reload({ silent: true })} />
        </>
      )}
    </Card>
  );
}

function UploadForm({ clientId, existing, onDone }: { clientId: string; existing: Photo[]; onDone: () => void }) {
  const supabase = createClient();
  const today = localDate();
  const [date, setDate] = useState(today);
  const [pose, setPose] = useState<Pose>("front");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    if (!file.type.startsWith("image/")) return setMsg({ ok: false, text: "Choose a photo (JPEG, PNG or WebP)." });
    if (!date || date > today) return setMsg({ ok: false, text: "Pick a date that isn't in the future." });
    setBusy(true);
    setMsg(null);
    const blob = await downscale(file);
    if (blob.size > 5 * 1024 * 1024) { setBusy(false); return setMsg({ ok: false, text: "That photo is too large (max 5 MB)." }); }
    const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
    const path = `${clientId}/${date}-${pose}-${Date.now()}.${ext}`;
    const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || "image/jpeg" });
    if (up.error) { setBusy(false); return setMsg({ ok: false, text: errMsg(up.error) }); }
    const previous = existing.find((p) => p.taken_on === date && p.pose === pose);
    const { error } = await supabase.from("progress_photos").upsert(
      { client_id: clientId, taken_on: date, pose, storage_path: path },
      { onConflict: "client_id,taken_on,pose" },
    );
    if (error) {
      await supabase.storage.from(BUCKET).remove([path]);
      setBusy(false);
      return setMsg({ ok: false, text: errMsg(error) });
    }
    if (previous) await supabase.storage.from(BUCKET).remove([previous.storage_path]);
    setBusy(false);
    setMsg({ ok: true, text: `${POSE_LABEL[pose]} photo for ${fmtDate(date)} saved${previous ? " (replaced the old one)" : ""}.` });
    if (input.current) input.current.value = "";
    onDone();
  }

  return (
    <div className="space-y-2 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Date"><Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Pose">
          <Select value={pose} onChange={(e) => setPose(e.target.value as Pose)}>
            {POSES.map((p) => <option key={p} value={p}>{POSE_LABEL[p]}</option>)}
          </Select>
        </Field>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="progress-photo-file"
          aria-label="Progress photo file" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button type="button" variant="secondary" loading={busy} onClick={() => input.current?.click()}><ImagePlus className="size-4" /> Add photo</Button>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-brand-dark" : "text-danger"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </div>
  );
}

function PhotoBox({ photo, label }: { photo?: Photo; label: string }) {
  return (
    <figure className="min-w-0 space-y-1">
      <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl bg-surface-2 ring-1 ring-line">
        {photo?.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs from a private bucket
          <img src={photo.url} alt={label} className="size-full object-cover" />
        ) : (
          <span className="px-2 text-center text-xs text-muted">No photo</span>
        )}
      </div>
      <figcaption className="truncate text-center text-xs text-muted">{label}</figcaption>
    </figure>
  );
}

/** Side by side for any two dates, one pose at a time. */
function Compare({ photos, dates }: { photos: Photo[]; dates: string[] }) {
  const [pose, setPose] = useState<Pose>("front");
  const [before, setBefore] = useState(dates.at(-1)!);
  const [after, setAfter] = useState(dates[0]);
  const b = dates.includes(before) ? before : dates.at(-1)!;
  const a = dates.includes(after) ? after : dates[0];
  const find = (d: string) => photos.find((p) => p.taken_on === d && p.pose === pose);
  const opt = (d: string) => <option key={d} value={d}>{fmtDate(d, { month: "short", day: "numeric", year: "numeric" })}</option>;
  return (
    <section className="space-y-2 rounded-xl bg-surface-2/60 p-3" aria-label="Compare photos">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Before"><Select value={b} onChange={(e) => setBefore(e.target.value)}>{dates.map(opt)}</Select></Field>
        <Field label="After"><Select value={a} onChange={(e) => setAfter(e.target.value)}>{dates.map(opt)}</Select></Field>
        <div className="pb-1"><Segmented label="Pose" value={pose} onChange={setPose} options={POSES.map((p) => ({ value: p, label: POSE_LABEL[p] }))} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <PhotoBox photo={find(b)} label={`${POSE_LABEL[pose]} · ${fmtDate(b, { month: "short", day: "numeric", year: "numeric" })}`} />
        <PhotoBox photo={find(a)} label={`${POSE_LABEL[pose]} · ${fmtDate(a, { month: "short", day: "numeric", year: "numeric" })}`} />
      </div>
    </section>
  );
}

function Gallery({ photos, dates, canDelete, onDeleted }: { photos: Photo[]; dates: string[]; canDelete: boolean; onDeleted: () => void }) {
  const supabase = createClient();
  async function remove(p: Photo) {
    if (!confirm(`Delete the ${POSE_LABEL[p.pose].toLowerCase()} photo from ${fmtDate(p.taken_on)}? This can't be undone.`)) return;
    const { error } = await supabase.from("progress_photos").delete().eq("id", p.id);
    if (error) return alert(errMsg(error));
    await supabase.storage.from(BUCKET).remove([p.storage_path]);
    onDeleted();
  }
  return (
    <ul className="space-y-3" aria-label="Photos by date">
      {dates.map((d) => (
        <li key={d}>
          <p className="mb-1 text-sm font-semibold">{fmtDate(d, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</p>
          <div className="grid grid-cols-3 gap-2">
            {POSES.map((pose) => {
              const p = photos.find((x) => x.taken_on === d && x.pose === pose);
              return (
                <div key={pose} className="relative">
                  <PhotoBox photo={p} label={POSE_LABEL[pose]} />
                  {p && canDelete && (
                    <button onClick={() => remove(p)} aria-label={`Delete ${POSE_LABEL[pose]} photo from ${fmtDate(d)}`}
                      className="absolute top-1 right-1 flex size-9 items-center justify-center rounded-lg bg-surface/90 text-muted shadow-card hover:text-danger">
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </li>
      ))}
    </ul>
  );
}
