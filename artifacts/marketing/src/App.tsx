import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Trust from "@/pages/trust";
import Terms from "@/pages/terms";
import License from "@/pages/license";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/trust" component={Trust} />
      <Route path="/terms" component={Terms} />
      <Route path="/license" component={License} />
      <Route component={NotFound} />
    </Switch>
  );
}

interface AppProps {
  /** Pre-render-time URL pathname. Only used during SSR/prerender. */
  ssrPath?: string;
}

function App({ ssrPath }: AppProps = {}) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={base} ssrPath={ssrPath}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
