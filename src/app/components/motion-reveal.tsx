"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function MotionReveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    element.classList.add("motion-enabled");
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      element.classList.add("is-visible");
      observer.disconnect();
    }, { threshold: 0.14 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div ref={ref} className={`reveal-frame ${className}`}>{children}</div>;
}
