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
                src: "/icon?size=192",
                sizes: "192x192",
                type: "image/png",
            },
            {
                src: "/icon?size=512",
                sizes: "512x512",
                type: "image/png",
            },
            {
                src: "/apple-icon",
                sizes: "180x180",
                type: "image/png",
            },
        ],
    };
}