"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Drawer } from "vaul";
import { X } from "lucide-react";
import { Button } from "@/components/ui";

type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onBack?: () => void;
  footer?: ReactNode;
  /** Set when this sheet is opened from inside another sheet (vaul `NestedRoot`). */
  nested?: boolean;
  /** Fires once the close animation has finished. */
  onClosed?: () => void;
  children: ReactNode;
};

/** Bottom sheet (vaul drawer) at every breakpoint. Escape, the overlay and a swipe close only the top sheet. */
export function Sheet({ open, onOpenChange, title, onBack, footer, nested, onClosed, children }: SheetProps) {
  const Root = nested ? Drawer.NestedRoot : Drawer.Root;
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<Element | null>(null);
  // The drawer's own state. vaul only runs its open/close side effects (scaling the parent of a nested
  // sheet, scroll locking, `onAnimationEnd`) for changes it makes itself, so a change of `open` from the
  // caller is routed through the drawer's own trigger and close button rather than set directly.
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    if (open && !drawerOpen) {
      if (triggerRef.current) triggerRef.current.click();
      else setDrawerOpen(true);
    } else if (!open && drawerOpen) {
      if (closeRef.current) closeRef.current.click();
      else setDrawerOpen(false);
    }
  }, [open, drawerOpen]);

  return (
    <Root
      open={drawerOpen}
      onOpenChange={(o) => { setDrawerOpen(o); if (o !== open) onOpenChange(o); }}
      onAnimationEnd={(o) => !o && onClosed?.()}
    >
      {/* Opened from code only (see above); the button the user tapped keeps focus. */}
      <Drawer.Trigger ref={triggerRef} tabIndex={-1} aria-hidden className="sr-only" />
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-slate-950/50" />
        <Drawer.Content
          ref={contentRef}
          aria-modal="true"
          aria-describedby={undefined}
          // Move focus into the sheet without focusing a field (that would pop the phone keyboard).
          onOpenAutoFocus={() => {
            returnFocus.current = document.activeElement;
            contentRef.current?.focus({ preventScroll: true });
          }}
          // Radix only refocuses a Drawer.Trigger; these sheets have none, so return focus to the opener.
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const el = returnFocus.current;
            returnFocus.current = null;
            if (el instanceof HTMLElement && el.isConnected) el.focus({ preventScroll: true });
          }}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl border border-line bg-surface outline-none"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <Drawer.Handle className="mt-2 mb-1 bg-line" />
          <div className="flex items-center gap-2 p-4 pt-1 pb-2">
            {onBack && <Button size="sm" variant="ghost" onClick={onBack}>Back</Button>}
            <Drawer.Title className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</Drawer.Title>
            <Drawer.Close ref={closeRef} className="flex size-11 items-center justify-center rounded-xl hover:bg-surface-2" aria-label="Close">
              <X className="size-5" />
            </Drawer.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-2">{children}</div>
          {footer && <div className="border-t border-line p-3">{footer}</div>}
        </Drawer.Content>
      </Drawer.Portal>
    </Root>
  );
}

/** Open/close state for a `Sheet` that shows one item. `item` stays set through the exit animation. */
export function useSheet<T>() {
  const [state, setState] = useState<{ item: T | null; open: boolean }>({ item: null, open: false });
  return {
    item: state.item,
    open: state.open,
    show: (item: T) => setState({ item, open: true }),
    close: () => setState((s) => ({ ...s, open: false })),
    bind: {
      open: state.open,
      onOpenChange: (open: boolean) => setState((s) => ({ ...s, open })),
      onClosed: () => setState((s) => (s.open ? s : { ...s, item: null })),
    },
  };
}
