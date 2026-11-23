import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { FileUp, FolderUp, Upload as UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fromDrop, fromInput, runUploads, type Target, type Upload } from "@/lib/upload";

const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
const pickLabel = "cursor-pointer focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 max-sm:h-9 max-sm:flex-1";

/** The upload strip, plus a whole-page drop target while it is mounted. */
export function DropZone(props: { target: Target; text: ReactNode; overlay: string; onDone: () => void; children?: ReactNode }) {
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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-dashed border-input px-4 py-3">
      <p className="flex min-w-0 flex-[1_1_14rem] items-center gap-2.5 text-sm text-muted-foreground">
        <UploadIcon className="size-4 shrink-0" aria-hidden />
        <span>{props.text}</span>
      </p>
      <div className="flex gap-2 max-sm:w-full">
        <Button variant="outline" asChild className={pickLabel}>
          <label>
            <FileUp aria-hidden />
            Choose file
            <input type="file" className="sr-only" onChange={pick} />
          </label>
        </Button>
        {"webkitdirectory" in HTMLInputElement.prototype && (
          <Button variant="outline" asChild className={pickLabel}>
            <label>
              <FolderUp aria-hidden />
              Choose folder
              <input type="file" className="sr-only" onChange={pick} {...{ webkitdirectory: "" }} />
            </label>
          </Button>
        )}
      </div>
      {props.children}
      {dragging && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-background/85 p-6 backdrop-blur-sm">
          <div className="grid w-full max-w-lg justify-items-center gap-3 rounded-2xl border-2 border-dashed border-ring bg-card px-6 py-14 text-center font-medium">
            <UploadIcon className="size-7 text-muted-foreground" />
            {props.overlay}
          </div>
        </div>
      )}
    </div>
  );
}
