import { Link } from "wouter";
import { Button } from "./ui/button";

export function Navbar() {
  return (
    <nav className="fixed top-0 w-full z-50 bg-background/90 backdrop-blur-md border-b border-border shadow-sm">
      <div className="container mx-auto px-6 h-20 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <img src="/mark-dark.svg" alt="" className="h-10 w-10 shrink-0" />
          <span className="text-xl font-bold tracking-tight text-foreground">
            Enviro<span className="text-primary">IQ</span>
          </span>
        </Link>
        
        <div className="hidden md:flex items-center gap-8">
          <a href="/#problem" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Problem</a>
          <a href="/#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</a>
          <a href="/#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">How It Works</a>
          <a href="/#use-cases" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Use Cases</a>
          <Link href="/trust" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Trust</Link>
          <a href="/#procurement" className="text-sm text-primary hover:text-primary/80 font-medium transition-colors">NZ Procurement</a>
        </div>

        <div className="flex items-center gap-4">
          <Button asChild variant="ghost" className="hidden sm:inline-flex text-muted-foreground hover:text-foreground">
            <a href="/app/login">Log In</a>
          </Button>
          <Button asChild variant="ghost" className="hidden sm:inline-flex">
            <a href="mailto:contact@frerkencompanies.com">Contact Sales</a>
          </Button>
          <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90 font-medium">
            <a href="mailto:contact@frerkencompanies.com">Request a Demo</a>
          </Button>
        </div>
      </div>
    </nav>
  );
}
