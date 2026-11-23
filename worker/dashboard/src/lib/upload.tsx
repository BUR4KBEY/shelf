import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { api, errorText, nameOf, type PushResult } from "./api";
import { plural } from "./format";

export type Item = { path: string; file: File };
/** One entry per doc or version to make. */
export type Upload = { items: Item[]; title?: string };
/** Where files go: a new doc, or a new version of `ref`. */
export type Target = { ref?: string; message?: () => string };

const PROGRESS = "upload";
let busy = false;

function progress(text: string, done: number, total: number) {
  toast.loading(text, { id: PROGRESS, duration: Infinity, description: <Progress value={total ? (done / total) * 100 : 0} aria-label={text} className="mt-1.5" /> });
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const visible = (path: string) => !path.split("/").some((s) => s.startsWith("."));

/** Hash, push, upload whatever the server is missing, push again. */
async function push(items: Item[], opts: { ref?: string; title?: string; message?: string }) {
  const blobs = new Map<string, File>();
  const files: { path: string; sha256: string }[] = [];
  for (const [i, { path, file }] of items.entries()) {
    progress(`Hashing ${plural(items.length, "file")}…`, i, items.length);
    const sha256 = hex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
    blobs.set(sha256, file);
    files.push({ path, sha256 });
  }
  const request = { method: "POST", json: { files, ...opts } };
  let res = await api<PushResult>("/push", request);
  if (res.missing) {
    const missing = res.missing.filter((sha) => blobs.has(sha));
    for (const [i, sha] of missing.entries()) {
      progress(`Uploading ${i + 1} of ${missing.length}…`, i, missing.length);
      await api(`/blobs/${sha}`, { method: "PUT", body: blobs.get(sha) });
    }
    progress("Finishing…", 1, 1);
    res = await api<PushResult>("/push", request);
    if (res.missing) throw new Error("The server is still missing files. Try again.");
  }
  return res;
}

export async function runUploads(target: Target, uploads: Upload[]): Promise<void> {
  if (busy) return void toast.error("An upload is already running.");
  if (!uploads.some((u) => u.items.length)) return void toast.error("Nothing to upload. Dotfiles are skipped.");
  busy = true;
  const { ref } = target;
  const message = target.message?.();
  try {
    for (const { items, title } of uploads) {
      const res = await push(items, ref ? { ref, ...(message && { message }) } : { ...(title && { title }) });
      if (!res.created) toast.info(`No changes: identical to v${res.version}, so no new version was made.`);
      else toast.success(ref ? `Uploaded v${res.version} of ${nameOf(res)}` : `Uploaded ${nameOf(res)}`);
    }
  } catch (e) {
    toast.error(errorText(e));
  } finally {
    busy = false;
    toast.dismiss(PROGRESS);
  }
}

export function fromInput(input: HTMLInputElement): Upload[] {
  const files = [...(input.files ?? [])];
  const folder = input.webkitdirectory;
  input.value = "";
  if (!folder) return files.map((file) => ({ items: [{ path: file.name, file }] }));
  if (!files.length) return [];
  // webkitRelativePath is "folder/sub/a.html"; paths are relative to the folder.
  const rel = (f: File) => f.webkitRelativePath.split("/").slice(1).join("/") || f.name;
  const items = files.map((file) => ({ path: rel(file), file })).filter((x) => visible(x.path));
  return [{ items, title: files[0].webkitRelativePath.split("/")[0] || undefined }];
}

function children(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  // readEntries returns results in batches, so call it until it comes back empty.
  const next = (): Promise<FileSystemEntry[]> =>
    new Promise<FileSystemEntry[]>((ok, no) => reader.readEntries(ok, no)).then((batch) => (batch.length ? (all.push(...batch), next()) : all));
  return next();
}
async function walk(entry: FileSystemEntry, prefix: string, out: Item[]): Promise<void> {
  if (entry.name.startsWith(".")) return;
  if (entry.isFile) out.push({ path: prefix + entry.name, file: await new Promise<File>((ok, no) => (entry as FileSystemFileEntry).file(ok, no)) });
  else for (const child of await children(entry as FileSystemDirectoryEntry)) await walk(child, `${prefix}${entry.name}/`, out);
}

/** Call synchronously from the drop handler: the DataTransfer is emptied once the handler returns. */
export function fromDrop(dt: DataTransfer, separateFiles: boolean): Promise<Upload[]> {
  const entries = [...dt.items].filter((i) => i.kind === "file").map((i) => i.webkitGetAsEntry?.()).filter((e) => e != null);
  // No entry API (or a drop that isn't from the file system): plain files still work, folders don't.
  const plain = [...dt.files].map((file) => ({ items: [{ path: file.name, file }] }));
  return (async () => {
    if (!entries.length) return plain;
    const items: Item[] = [];
    if (entries.length === 1 && entries[0].isDirectory) {
      for (const child of await children(entries[0] as FileSystemDirectoryEntry)) await walk(child, "", items);
      return [{ items, title: entries[0].name }];
    }
    for (const entry of entries) await walk(entry, "", items);
    // Several loose files dropped on the list become one doc each; anything else is one folder.
    return separateFiles && entries.every((e) => e.isFile) ? items.map((x) => ({ items: [x] })) : [{ items }];
  })();
}
