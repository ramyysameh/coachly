"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAsync } from "@/lib/useAsync";
import { Button, Card, CenteredPage, ErrorBox, LinkButton, Spinner } from "@/components/ui";
import { errMsg } from "@/lib/utils";

type Invite = { coach_name: string; expires_at: string; status: "valid" | "expired" | "used" | "revoked" };

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const supabase = createClient();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, loading, error: loadError } = useAsync(async () => {
    const [{ data: inv, error }, { data: claims }] = await Promise.all([
      supabase.rpc("get_invitation", { p_token: token }),
      supabase.auth.getClaims(),
    ]);
    if (error) throw error;
    const uid = claims?.claims?.sub;
    let role: string | null = null;
    if (uid) {
      const { data: p } = await supabase.from("profiles").select("role").eq("id", uid).single();
      role = p?.role ?? null;
    }
    return { invite: ((inv as Invite[]) ?? [])[0] ?? null, role };
  }, [token]);

  async function accept() {
    setAccepting(true);
    setError(null);
    const { error } = await supabase.rpc("accept_invitation", { p_token: token });
    if (error) {
      setAccepting(false);
      return setError(errMsg(error));
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <CenteredPage card={false}>
      {loading ? (
        <Spinner />
      ) : loadError ? (
        <ErrorBox message={loadError} />
      ) : !data?.invite ? (
        <ErrorBox message="This invitation link isn't valid. Ask your coach for a new one." />
      ) : data.invite.status !== "valid" ? (
        <Card>
          <p className="font-semibold">This invitation can&apos;t be used</p>
          <p className="mt-1 text-sm text-muted">
            {data.invite.status === "expired" && "The link has expired. "}
            {data.invite.status === "used" && "The link has already been used. "}
            {data.invite.status === "revoked" && "Your coach revoked this link. "}
            Ask {data.invite.coach_name} for a new invite.
          </p>
          {data.role && <LinkButton href="/" variant="secondary" className="mt-4 w-full">Go to app</LinkButton>}
        </Card>
      ) : (
        <Card className="space-y-4">
          <UserCheck className="size-10 text-brand" aria-hidden />
          <div>
            <h1 className="text-xl font-semibold">{data.invite.coach_name} invited you</h1>
            <p className="mt-1 text-sm text-muted">
              Accept to connect with your coach. They&apos;ll be able to assign training plans, set nutrition targets, review your logs and message you.
            </p>
            <p className="mt-2 text-xs text-muted">Link expires {new Date(data.invite.expires_at).toLocaleString()}.</p>
          </div>
          {error && <ErrorBox message={error} />}
          {data.role === "client" && (
            <Button onClick={accept} loading={accepting} className="w-full" size="lg">Accept invitation</Button>
          )}
          {data.role === "coach" && (
            <ErrorBox message="You're signed in as a coach. Log out and use a client account to accept this invitation." />
          )}
          {!data.role && (
            <div className="space-y-2">
              <LinkButton href={`/signup?invite=${token}`} className="w-full">Create client account</LinkButton>
              <LinkButton href={`/login?next=/invite/${token}`} variant="secondary" className="w-full">I already have an account</LinkButton>
            </div>
          )}
        </Card>
      )}
    </CenteredPage>
  );
}
