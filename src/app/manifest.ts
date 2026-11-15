import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Coachly: training & nutrition coaching",
    short_name: "Coachly",
    description: "Log workouts and meals, and chat with your coach.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#060607",
    theme_color: "#060607",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
