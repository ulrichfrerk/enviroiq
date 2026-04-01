import { Link } from "wouter";
import { Leaf } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-black pt-20 pb-10">
      <div className="container mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
          <div className="col-span-1 md:col-span-2">
            <Link href="/" className="flex items-center gap-2 mb-6">
              <div className="bg-primary/10 p-2 rounded-lg">
                <Leaf className="w-6 h-6 text-primary" />
              </div>
              <span className="font-bold text-xl tracking-tight">EnviroIQ</span>
            </Link>
            <p className="text-muted-foreground max-w-sm">
              Real time ESG intelligence. From retrospective reporting to live operational control.
            </p>
          </div>
          
          <div>
            <h4 className="font-semibold mb-6 text-foreground">Platform</h4>
            <ul className="space-y-4">
              <li><Link href="#features" className="text-muted-foreground hover:text-primary transition-colors">Features</Link></li>
              <li><Link href="#use-cases" className="text-muted-foreground hover:text-primary transition-colors">Use Cases</Link></li>
              <li><Link href="#how-it-works" className="text-muted-foreground hover:text-primary transition-colors">How it Works</Link></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-semibold mb-6 text-foreground">Company</h4>
            <ul className="space-y-4">
              <li><a href="mailto:hello@enviroiq.net" className="text-muted-foreground hover:text-primary transition-colors">Contact</a></li>
              <li><a href="mailto:hello@enviroiq.net" className="text-muted-foreground hover:text-primary transition-colors">Request Demo</a></li>
            </ul>
          </div>
        </div>
        
        <div className="pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-muted-foreground text-sm">
            © {new Date().getFullYear()} EnviroIQ. All rights reserved.
          </p>
          <div className="flex gap-6">
            <span className="text-muted-foreground text-sm">Privacy Policy</span>
            <span className="text-muted-foreground text-sm">Terms of Service</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
