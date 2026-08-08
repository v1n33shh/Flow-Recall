import { useState, useEffect } from "react";
import { Capacitor } from "@capacitor/core";

export function useIsNative<T extends boolean | null>(initial: T = false as T) {
  const [isNative, setIsNative] = useState<boolean | null>(initial);
  
  useEffect(() => {
    let mounted = true;
    // Delaying by one microtask or macrotask avoids the React 19 "Calling setState synchronously within an effect" warning
    // while still updating immediately after hydration.
    Promise.resolve().then(() => {
      if (mounted) {
        setIsNative(Capacitor.isNativePlatform());
      }
    });
    return () => { mounted = false; };
  }, []);
  
  return isNative as T extends null ? (boolean | null) : boolean;
}
