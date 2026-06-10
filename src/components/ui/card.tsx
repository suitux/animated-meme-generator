import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-3xl border-4 border-white/70 bg-white/85 backdrop-blur-md shadow-2xl shadow-black/20",
        className
      )}
      {...props}
    />
  );
}
