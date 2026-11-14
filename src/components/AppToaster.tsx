import { Toaster } from "sonner";

export default function AppToaster() {
  return (
    <Toaster
      position="top-center"
      theme="system"
      mobileOffset={{ top: "calc(env(safe-area-inset-top) + 8px)" }}
      toastOptions={{
        classNames: {
          toast: "!rounded-2xl !border-line !bg-surface !text-ink !shadow-card",
          actionButton: "!bg-brand !text-brand-fg !rounded-lg !min-h-9 !px-3 !font-semibold",
        },
      }}
    />
  );
}
