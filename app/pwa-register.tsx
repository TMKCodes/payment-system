"use client";

import { useEffect } from "react";

export default function PwaRegister() {
    useEffect(() => {
        if (!("serviceWorker" in navigator)) {
            return;
        }

        const isLocal =
            window.location.hostname === "localhost" ||
            window.location.hostname === "127.0.0.1";

        if (!isLocal && window.location.protocol !== "https:") {
            return;
        }

        void navigator.serviceWorker.register("/sw.js");
    }, []);

    return null;
}