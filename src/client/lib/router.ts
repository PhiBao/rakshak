import { useEffect, useState } from "react";

export interface Route {
  path: string;
  parts: string[];
}

function parse(): Route {
  const path = window.location.pathname;
  return { path, parts: path.split("/").filter(Boolean) };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("popstate", onChange);
    const originalPush = history.pushState.bind(history);
    history.pushState = (...args: Parameters<typeof originalPush>) => {
      originalPush(...args);
      onChange();
    };
    return () => {
      window.removeEventListener("popstate", onChange);
      history.pushState = originalPush;
    };
  }, []);
  return route;
}

export function navigate(path: string): void {
  history.pushState(null, "", path);
}

export function newSessionId(): string {
  return `demo-${Math.random().toString(36).slice(2, 7)}-${Date.now().toString(36).slice(-4)}`;
}
