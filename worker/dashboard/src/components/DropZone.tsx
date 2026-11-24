import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { FileUp, FolderUp, Upload as UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fromDrop, fromInput, runUploads, type Target, type Upload } from "@/lib/upload";
import { cn } from "@/lib/utils";

const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
const pickLabel = "cursor-pointer focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 max-sm:flex-1";

/** The two upload buttons, plus a whole-page drop target while they are mounted. Only one may be on screen at a time. */
export function DropZone(props: { target: Target; overlay: string; onDone: () => void; className?: string }) {
  const latest = useRef(props);
  latest.current = props;
  const [dragging, setDragging] = useState(false);

  const run = async (uploads: Upload[] | Promise<Upload[]>) => {
    try {
      await runUploads(latest.current.target, await uploads);
    } catch {
      toast.error("Couldn't read the dropped files.");
    }
    latest.current.onDone();
  };

  useEffect(() => {
    let depth = 0;
    const end = () => {
      depth = 0;
      setDragging(false);
    };
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (hasFiles(e) && --depth <= 0) end();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      end();
      run(fromDrop(e.dataTransfer!, !latest.current.target.ref));
    };
    addEventListener("dragenter", enter);
    addEventListener("dragleave", leave);
    addEventListener("drop", drop);
    return () => {
      removeEventListener("dragenter", enter);
      removeEventListener("dragleave", leave);
      removeEventListener("drop", drop);
    };
  }, []);

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const uploads = fromInput(e.target);
    if (uploads.length) run(uploads);
  };

  return (
    <div className={cn("flex gap-2", props.className)}>
      <Button asChild className={pickLabel}>
        <label>
          <FileUp aria-hidden />
          Upload file
          <input type="file" className="sr-only" onChange={pick} />
        </label>
      </Button>
      {"webkitdirectory" in HTMLInputElement.prototype && (
        <Button variant="outline" asChild className={pickLabel}>
          <label>
            <FolderUp aria-hidden />
            Upload folder
            <input type="file" className="sr-only" onChange={pick} {...{ webkitdirectory: "" }} />
          </label>
        </Button>
      )}
      {dragging && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-background/85 p-6 backdrop-blur-sm">
          <div className="grid w-full max-w-lg justify-items-center gap-3 rounded-2xl border-2 border-dashed border-ring bg-card px-6 py-14 text-center text-lg font-semibold">
            <UploadIcon className="size-7 text-muted-foreground" />
            {props.overlay}
          </div>
        </div>
      )}
    </div>
  );
}
