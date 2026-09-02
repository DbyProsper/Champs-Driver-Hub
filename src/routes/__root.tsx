import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { CartProvider } from "@/lib/cart";
import { BranchProvider } from "@/lib/branch";
import { supabase } from "@/integrations/supabase/client";
import { Loader } from "@/components/Loader";
import { BrowserNotificationBridge } from "@/components/BrowserNotificationBridge";

const THEME_INIT_SCRIPT = `(function(){try{var k='champs-color-theme';var s=localStorage.getItem(k);var d=s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light'}catch(e){}})();`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl text-brand">404</h1>
        <h2 className="mt-2 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">The page you're looking for doesn't exist.</p>
        <Link to="/" className="mt-6 inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground hover:bg-brand-dark">
          Back to menu
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => { reportLovableError(error, { boundary: "tanstack_root_error_component" }); }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Something went wrong.</p>
        <div className="mt-6 flex justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground">Try again</button>
          <a href="/" className="rounded-md border px-4 py-2 text-sm font-medium">Home</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
      { name: "theme-color", content: "#E21B23" },
      { title: "Champs Chicken — Fried Chicken Since 1995 | Dikeni & Fort Beaufort" },
      { name: "description", content: "Order Champs Chicken online for pickup or delivery. Chicken, chips, burgers, fish, combos & shakes. Now serving Dikeni and Fort Beaufort." },
      { name: "author", content: "Champs Chicken" },
      { property: "og:title", content: "Champs Chicken — Fried Chicken Since 1995 | Dikeni & Fort Beaufort" },
      { property: "og:description", content: "Order Champs Chicken online for pickup or delivery. Chicken, chips, burgers, fish, combos & shakes. Now serving Dikeni and Fort Beaufort." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Champs Chicken — Fried Chicken Since 1995 | Dikeni & Fort Beaufort" },
      { name: "twitter:description", content: "Order Champs Chicken online for pickup or delivery. Chicken, chips, burgers, fish, combos & shakes. Now serving Dikeni and Fort Beaufort." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/74d2f8c6-7ced-4cf4-a77c-4f015efadaa3" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/74d2f8c6-7ced-4cf4-a77c-4f015efadaa3" },
    ],
    links: [
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/images/champs/champs-logo.png" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} /><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const routerStatus = useRouterState({ select: (state) => state.status });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [showLoader, setShowLoader] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        router.invalidate();
        if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient, router]);

  useEffect(() => {
    if (pathname === "/cart") {
      setShowLoader(false);
      return;
    }
    if (routerStatus === "pending") {
      setShowLoader(true);
      return;
    }
    const id = window.setTimeout(() => setShowLoader(false), 220);
    return () => window.clearTimeout(id);
  }, [pathname, routerStatus]);

  useEffect(() => {
    const ignoreBrokenWebVitalsReport = (event: ErrorEvent) => {
      const message = event.message || event.error?.message || "";
      const stack = event.error?.stack || "";
      if (message.includes("Cannot read properties of undefined (reading 'startTime')") && stack.includes("reportAllChanges")) {
        event.preventDefault();
      }
    };
    window.addEventListener("error", ignoreBrokenWebVitalsReport, true);
    return () => window.removeEventListener("error", ignoreBrokenWebVitalsReport, true);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BranchProvider>
        <CartProvider>
          <Loader visible={showLoader} />
          <BrowserNotificationBridge />
          <Outlet />
          <Toaster richColors position="top-center" />
        </CartProvider>
      </BranchProvider>
    </QueryClientProvider>
  );
}
