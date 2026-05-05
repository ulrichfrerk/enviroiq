import { Link } from "wouter";

export function Footer() {
  return (
    <footer className="border-t border-border bg-muted/50 pt-20 pb-10">
      <div className="container mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
          <div className="col-span-1 md:col-span-2">
            <Link href="/" className="flex items-center gap-2.5 mb-3">
              <img src="/mark-dark.svg" alt="" className="h-9 w-9 shrink-0" />
              <span className="text-xl font-bold tracking-tight text-foreground">
                Enviro<span className="text-primary">IQ</span>
              </span>
            </Link>
            <p className="text-xs font-semibold tracking-widest text-primary uppercase mb-4">Real Time ESG Intelligence</p>
            <p className="text-muted-foreground max-w-sm text-sm">
              From retrospective reporting to live operational control — full E+S+G coverage for New Zealand organisations.
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
            <h4 className="font-semibold mb-6 text-foreground">Trust & Legal</h4>
            <ul className="space-y-4">
              <li><Link href="/trust" className="text-muted-foreground hover:text-primary transition-colors">Trust & Compliance</Link></li>
              <li><Link href="/trust#data-trust-model" className="text-muted-foreground hover:text-primary transition-colors">Data Trust Model</Link></li>
              <li><Link href="/terms" className="text-muted-foreground hover:text-primary transition-colors">Terms & Conditions</Link></li>
              <li><Link href="/license" className="text-muted-foreground hover:text-primary transition-colors">Software Licence</Link></li>
              <li><a href="mailto:contact@frerkencompanies.com?subject=Security%20Pack" className="text-muted-foreground hover:text-primary transition-colors">Security Pack</a></li>
              <li><a href="mailto:contact@frerkencompanies.com" className="text-muted-foreground hover:text-primary transition-colors">Contact</a></li>
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-border flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-muted-foreground text-sm">
            © {new Date().getFullYear()} Frerken Companies Limited, trading as EnviroIQ. All rights reserved.
          </p>
          <div className="flex gap-6">
            <Link href="/terms" className="text-muted-foreground hover:text-primary text-sm transition-colors">Terms & Conditions</Link>
            <Link href="/license" className="text-muted-foreground hover:text-primary text-sm transition-colors">Software Licence</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
