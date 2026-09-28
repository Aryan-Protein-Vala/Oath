import { ImageResponse } from "next/og";

export const runtime = "edge";

export const alt = "OATH — Stake Everything";
export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#ffffff",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "sans-serif",
          padding: "80px",
        }}
      >
        {/* Skull Icon */}
        <div style={{ display: "flex", marginBottom: "40px" }}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="200"
            height="200"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#dc2626"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="9" cy="12" r="1" />
            <circle cx="15" cy="12" r="1" />
            <path d="M8 20v2h8v-2" />
            <path d="m12.5 17-.5-1-.5 1h1z" />
            <path d="M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20" />
          </svg>
        </div>

        {/* Title */}
        <div
          style={{
            display: "flex",
            fontSize: "130px",
            fontWeight: 900,
            letterSpacing: "-0.08em",
            color: "#09090b",
            lineHeight: 1,
            marginBottom: "20px",
          }}
        >
          OATH
        </div>

        {/* Subtitle */}
        <div
          style={{
            display: "flex",
            fontSize: "36px",
            fontWeight: 700,
            letterSpacing: "0.2em",
            color: "#52525b", // zinc-600
            textTransform: "uppercase",
          }}
        >
          Stake everything.
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
