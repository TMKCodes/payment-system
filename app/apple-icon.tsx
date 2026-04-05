import { ImageResponse } from "next/og";

export const contentType = "image/png";
export const size = {
    width: 180,
    height: 180,
};

export default function AppleIcon() {
    return new ImageResponse(
        (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "linear-gradient(135deg, #0f766e 0%, #115e59 55%, #0b3b36 100%)",
                    color: "#f8fafc",
                    fontSize: 68,
                    fontWeight: 700,
                    letterSpacing: -4,
                    borderRadius: 36,
                }}
            >
                HTN
            </div>
        ),
        size,
    );
}