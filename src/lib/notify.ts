import { createElement } from "react";
import { Medal } from "lucide-react";
import { toast } from "sonner";

export const notify = {
  success(message: string, opts?: { description?: string }) {
    toast.success(message, opts);
  },
  error(message: string, opts?: { description?: string }) {
    toast.error(message, opts);
  },
  /** A personal record hit mid-workout. Stays a little longer than a normal toast. */
  pr(message: string, description: string) {
    toast(message, { description, duration: 5000, icon: createElement(Medal, { className: "size-5 text-brand", "aria-hidden": true }) });
  },
  undo(message: string, onUndo: () => void | Promise<void>) {
    toast(message, { duration: 6000, action: { label: "Undo", onClick: () => { void onUndo(); } } });
  },
};
