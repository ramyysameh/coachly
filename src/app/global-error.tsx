"use client";

// Replaces the root layout when the layout itself fails, so it can't rely on global CSS.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  console.error(error);
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f6f8fa", color: "#0f172a" }}>
        <title>Coachly: something went wrong</title>
        <main role="alert" style={{ maxWidth: 420, margin: "0 auto", padding: "15vh 20px" }}>
          <h1 style={{ fontSize: 22 }}>Coachly hit a problem</h1>
          <p style={{ color: "#5b6b80" }}>Your data is safe. Please try again in a moment.</p>
          <button
            onClick={() => retry()}
            style={{ marginTop: 12, minHeight: 48, padding: "0 20px", borderRadius: 12, border: 0, background: "#0f766e", color: "white", fontWeight: 600, fontSize: 16 }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
