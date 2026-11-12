"use client";
import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/offline";

export default function ServiceWorker() {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return null;
}
