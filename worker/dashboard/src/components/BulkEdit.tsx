import { useContext, useId, useState, type FormEvent, type ReactNode } from "react";
import { SpacesContext } from "@/components/DocBits";
import { DurationInput, Field, Hint } from "@/components/Settings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { plural } from "@/lib/format";

/**
 * Sets a project, an expiry or a space on many docs at once. A field left empty keeps each doc's own value.
 * `onSave` gets the changes for /docs/bulk and resolves true once they are saved. `children` sit above the fields, for a warning.
 */
export function BulkEdit(props: { open: boolean; onOpenChange: (open: boolean) => void; count: number; onSave: (body: Record<string, unknown>) => Promise<boolean>; children?: ReactNode }) {
  const id = useId();
  const spaces = useContext(SpacesContext) ?? [];
  const [project, setProject] = useState("");
  const [clearProject, setClearProject] = useState(false);
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState("d");
  const [space, setSpace] = useState("*"); // "*": each doc keeps its space
  const [saving, setSaving] = useState(false);

  const body: Record<string, unknown> = {};
  if (clearProject) body.project = null;
  else if (project.trim()) body.project = project.trim();
  if (amount !== "") body.expires = Number(amount) === 0 ? null : `${amount}${unit}`;
  if (space !== "*") body.space = space;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    if (await props.onSave(body)) {
      setProject("");
      setClearProject(false);
      setAmount("");
      setSpace("*");
    }
    setSaving(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form noValidate onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Change {plural(props.count, "doc")}</DialogTitle>
            <DialogDescription>Every selected doc gets what you fill in. Empty fields leave each doc as it is.</DialogDescription>
          </DialogHeader>
          {props.children}
          <Field label="Project" htmlFor={`${id}project`}>
            <Input id={`${id}project`} value={project} onChange={(e) => setProject(e.target.value)} disabled={clearProject} maxLength={64} placeholder="Keep each doc's project" autoComplete="off" />
            <Label className="font-normal">
              <Switch checked={clearProject} onCheckedChange={setClearProject} />
              Remove them from their projects
            </Label>
          </Field>
          <Field label="Expires" htmlFor={`${id}expires`}>
            <DurationInput id={`${id}expires`} amount={amount} unit={unit} onAmount={setAmount} onUnit={setUnit} placeholder="Keep each doc's expiry" describedBy={`${id}expires-hint`} />
            <Hint id={`${id}expires-hint`}>From now. 0 means never.</Hint>
          </Field>
          {/* Only worth a field once there are two spaces to move between. */}
          {spaces.length > 1 && (
            <Field label="Space" htmlFor={`${id}space`}>
              <Select value={space} onValueChange={setSpace}>
                <SelectTrigger id={`${id}space`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  <SelectItem value="*">Keep each doc's space</SelectItem>
                  {spaces.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !Object.keys(body).length}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
