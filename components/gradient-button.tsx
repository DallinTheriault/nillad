import { ComponentPropsWithoutRef } from "react";

// Hollow pill with the periwinkle->red diagonal gradient stroke (60-70deg).
// Variant "fill" inverts to a filled gradient bg.

export function GradientButton({
  children,
  variant = "stroke",
  className = "",
  ...rest
}: ComponentPropsWithoutRef<"button"> & {
  variant?: "stroke" | "fill";
}) {
  const base =
    variant === "fill"
      ? "gradient-fill px-5 py-2 font-semibold tracking-wide"
      : "gradient-pill px-5 py-2 font-medium tracking-wide";
  return (
    <button {...rest} className={`${base} ${className}`}>
      {children}
    </button>
  );
}
