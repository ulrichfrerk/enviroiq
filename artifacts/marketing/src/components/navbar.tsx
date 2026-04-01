import { Link } from "wouter";
import { Leaf } from "lucide-react";
import { Button } from "./ui/button";

export function Navbar() {
  return (
    <nav className="fixed top-0 w-full z-50 bg-background/90 backdrop-blur-md border-b border-border shadow-sm">
      <div className="container mx-auto px-6 h-20 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="bg-primary/10 p-2 rounded-lg group-hover:bg-primary/20 transition-colors">
            <Leaf className="w-6 h-6 text-primary" />
          </div>
          <span className="font-bold text-xl tracking-tight">EnviroIQ</span>
        </Link>
        
        <div className="hidden md:flex items-center gap-8">
          <Link href="#problem" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Problem</Link>
          <Link href="#solution" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Solution</Link>
          <Link href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</Link>
          <Link href="#use-cases" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Use Cases</Link>
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
