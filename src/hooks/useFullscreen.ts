import { useState, useEffect } from "react";

export function useFullscreen() {
  const isSupported =
    typeof document !== "undefined" &&
    typeof document.documentElement.requestFullscreen === "function";

  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isSupported) return;
    function onChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [isSupported]);

  function toggle() {
    if (!isSupported) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }

  return { isFullscreen, toggle, isSupported };
}
