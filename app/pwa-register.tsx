"use client";

import { useEffect } from "react";

export default function PwaRegister() {
    useEffect(() => {
        if (process.env.NODE_ENV !== "production") {
            return;
        }

        if (!("serviceWorker" in navigator)) {
            return;
        }

        const isLocal =
            window.location.hostname === "localhost" ||
            window.location.hostname === "127.0.0.1";

        if (window.location.protocol !== "https:") {
            return;
        }

        void navigator.serviceWorker.register("/sw.js");
    }, []);

    return null;
}