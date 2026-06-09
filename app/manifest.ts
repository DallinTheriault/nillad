import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nillad",
    short_name: "Nillad",
    description: "Your assistant — messages, contacts, activities, reminders.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/nillad-tile.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/nillad-tile.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
