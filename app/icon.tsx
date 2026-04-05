import { ImageResponse } from "next/og";

export const contentType = "image/png";
export const size = {
    width: 512,
    height: 512,
};

export default function Icon() {
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
                    fontSize: 196,
                    fontWeight: 700,
                    letterSpacing: -10,
                    borderRadius: 96,
                }}
            >
                HTN
            </div>
        ),
        size,
    );
}