import { Compass } from "lucide-react";
import { CenteredPage, LinkButton, StatusIcon } from "@/components/ui";

export default function NotFound() {
  return (
    <CenteredPage>
      <StatusIcon><Compass /></StatusIcon>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">This link doesn&apos;t go anywhere. It may be old or mistyped.</p>
      <LinkButton href="/" className="mt-5 w-full">Go to the app</LinkButton>
    </CenteredPage>
  );
}
