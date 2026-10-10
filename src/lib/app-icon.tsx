import { ImageResponse } from "next/og";

// Значок приложения: белая ёлка на зелёном фоне
export function appIcon(size: number) {
  const unit = size / 100;
  const tier = (width: number, height: number) => ({
    width: 0,
    height: 0,
    borderLeft: `${width * unit}px solid transparent`,
    borderRight: `${width * unit}px solid transparent`,
    borderBottom: `${height * unit}px solid #ffffff`,
  });
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#047857",
        }}
      >
        <div style={tier(16, 20)} />
        <div style={{ ...tier(24, 22), marginTop: -8 * unit }} />
        <div style={{ ...tier(32, 24), marginTop: -8 * unit }} />
        <div style={{ width: 8 * unit, height: 10 * unit, background: "#ffffff" }} />
      </div>
    ),
    { width: size, height: size },
  );
}
