import { Link } from "wouter";
import { Button } from "./ui/button";

export function Navbar() {
  return (
    <nav className="fixed top-0 w-full z-50 bg-background/90 backdrop-blur-md border-b border-border shadow-sm">
      <div className="container mx-auto px-6 h-20 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <img src="/favicon.svg" alt="EnviroIQ icon" className="h-10 w-10" />
          <span className="font-bold text-2xl tracking-tight">
            Enviro<span className="text-primary">IQ</span>
          </span>
        </Link>
        
        <div className="hidden md:flex items-center gap-8">
          <Link href="#problem" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Problem</Link>
          <Link href="#solution" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Solution</Link>
          <Link href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</Link>
          <Link href="#use-cases" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Use Cases</Link>
          <Link href="#procurement" className="text-sm text-emerald-600 hover:text-emerald-700 font-medium transition-colors">NZ Procurement</Link>
        </div>

        <div className="flex items-center gap-4">
          <Button asChild variant="ghost" className="hidden sm:inline-flex text-muted-foreground hover:text-foreground">
            <a href="/app/login">Log In</a>
          </Button>
          <Button asChild variant="ghost" className="hidden sm:inline-flex">
            <a href="mailto:hello@enviroiq.net">Contact Sales</a>
          </Button>
          <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90 font-medium">
            <a href="mailto:hello@enviroiq.net">Request a Demo</a>
          </Button>
        </div>
      </div>
    </nav>
  );
}
