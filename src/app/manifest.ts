import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Stone 旅藏",
    short_name: "旅藏",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7f2",
    theme_color: "#24584c",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
