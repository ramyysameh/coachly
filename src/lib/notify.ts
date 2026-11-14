import { toast } from "sonner";

export const notify = {
  success(message: string, opts?: { description?: string }) {
    toast.success(message, opts);
  },
  error(message: string, opts?: { description?: string }) {
    toast.error(message, opts);
  },
  undo(message: string, onUndo: () => void | Promise<void>) {
    toast(message, { duration: 6000, action: { label: "Undo", onClick: () => { void onUndo(); } } });
  },
};
