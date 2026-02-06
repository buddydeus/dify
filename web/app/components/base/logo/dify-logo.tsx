"use client";
import useTheme from "@/hooks/use-theme";
import { cn } from "@/utils/classnames";
import { basePath } from "@/utils/var";
import type { FC } from "react";

export type LogoStyle = "default" | "monochromeWhite";

export const logoPathMap: Record<LogoStyle, string> = {
  default: "/logo/logo.jpg",
  monochromeWhite: "/logo/logo.jpg",
};

export type LogoSize = "large" | "medium" | "small";

export const logoSizeMap: Record<LogoSize, string> = {
  large: "w-16 h-7",
  medium: "w-12 h-[22px]",
  small: "w-9 h-4",
};

type DifyLogoProps = {
  style?: LogoStyle;
  size?: LogoSize;
  className?: string;
};

const DifyLogo: FC<DifyLogoProps> = ({
  style = "default",
  size = "medium",
  className,
}) => {
  const { theme } = useTheme();
  const themedStyle =
    theme === "dark" && style === "default" ? "monochromeWhite" : style;

  return (
    <>
      {/* 原 Dify 字样: alt="Dify logo" */}
      <img
        src={`${basePath}${logoPathMap[themedStyle]}`}
        className={cn("block object-contain", logoSizeMap[size], className)}
        alt="logo"
      />
    </>
  );
};

export default DifyLogo;
