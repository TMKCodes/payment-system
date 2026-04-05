import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "HTN Payment Gateway",
        short_name: "HTN Gateway",
        description: "Installable Hoosat payment gateway for mobile payment collection.",
        start_url: "/",
        display: "standalone",
        background_color: "#f5f7f6",
        theme_color: "#0f766e",
        orientation: "portrait",
        icons: [
            {
                src: "/icon.svg",
                sizes: "192x192",
                type: "image/svg+xml",
            },
            {
                src: "/icon.svg",
                sizes: "512x512",
                type: "image/svg+xml",
            },
            {
                src: "/apple-icon.svg",
                sizes: "180x180",
                type: "image/svg+xml",
            },
        ],
    };
}