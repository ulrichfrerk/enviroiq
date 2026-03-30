import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListReports, useGenerateReport } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Download, Loader2, Plus, Calendar as CalIcon } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { format, subMonths } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function Reports() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);

  const { data: reports, isLoading, refetch } = useListReports(orgId!, undefined, { query: { enabled: !!orgId } });
  const generate = useGenerateReport();

  const [reportType, setReportType] = useState("board_summary");
  const [title, setTitle] = useState("Q1 ESG Board Summary");

  const handleGenerate = async () => {
    try {
      await generate.mutateAsync({
        orgId: orgId!,
        data: {
          title,
          reportType: reportType as any,
          periodStart: subMonths(new Date(), 3).toISOString(), // Mock dates for demo
          periodEnd: new Date().toISOString(),
        }
      });
      toast({ title: "Report generation started" });
      setIsOpen(false);
      refetch();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 print:hidden">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Board Reporting</h1>
          <p className="text-muted-foreground mt-1">Generate professional ESG summaries for stakeholders.</p>
        </div>
        
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="hover-elevate active-elevate-2 shadow-lg shadow-primary/20">
              <Plus className="w-4 h-4 mr-2" /> Generate Report
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader><DialogTitle>Generate New Report</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Report Title</label>
                <input 
                  type="text" 
                  value={title} 
                  onChange={e => setTitle(e.target.value)} 
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Report Type</label>
                <select 
                  value={reportType} 
                  onChange={e => setReportType(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="board_summary">Board Summary (1-Pager)</option>
                  <option value="full_esg">Full ESG Detailed Report</option>
                  <option value="fleet_only">Fleet Emissions Only</option>
                </select>
              </div>
              <Button className="w-full mt-2" onClick={handleGenerate} disabled={generate.isPending}>
                {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Generate PDF
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 gap-4 print:hidden">
        {reports?.items.map((report) => (
          <Card key={report.id} className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4 bg-secondary/10 border-border/50 hover:bg-secondary/20 transition-colors">
            <div className="flex items-center gap-4 w-full sm:w-auto">
              <div className="p-3 bg-card rounded-lg border border-border shrink-0"><FileText className="w-6 h-6 text-primary" /></div>
              <div>
                <h4 className="font-semibold text-foreground">{report.title}</h4>
                <div className="flex items-center text-xs text-muted-foreground mt-1 gap-3">
                  <span className="flex items-center"><CalIcon className="w-3 h-3 mr-1" /> {format(new Date(report.createdAt), "MMM d, yyyy")}</span>
                  <span className="uppercase tracking-wider">{report.reportType.replace('_', ' ')}</span>
                  <span className={`px-2 py-0.5 rounded-full ${report.status === 'ready' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                    {report.status}
                  </span>
                </div>
              </div>
            </div>
            <div className="w-full sm:w-auto flex justify-end">
              <Button variant="outline" size="sm" onClick={handlePrint} disabled={report.status !== 'ready'}>
                <Download className="w-4 h-4 mr-2" /> Download
              </Button>
            </div>
          </Card>
        ))}
        {(!reports?.items || reports.items.length === 0) && (
          <div className="py-12 text-center text-muted-foreground border-2 border-dashed border-border rounded-xl">
            No reports generated yet.
          </div>
        )}
      </div>

      {/* Mock Print Layout - Visible only when printing or when a report is selected (simplified for demo) */}
      <div className="hidden print:block p-8 bg-white text-black min-h-[100vh]">
        <div className="border-b-2 border-green-600 pb-6 mb-8 flex justify-between items-end">
          <div>
            <h1 className="text-4xl font-bold text-gray-900">ESG Board Summary</h1>
            <p className="text-xl text-gray-600 mt-2">{session?.organisationName} • {format(new Date(), "MMMM yyyy")}</p>
          </div>
          <div className="text-right">
            <p className="font-bold text-green-600 text-2xl">EnviroIQ</p>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-8 mb-8">
          <div className="bg-gray-50 p-6 rounded-lg border border-gray-200">
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Total CO2e Emissions</p>
            <p className="text-4xl font-bold text-gray-900 mt-2">1,245 <span className="text-xl font-normal text-gray-500">kg</span></p>
            <p className="text-green-600 font-medium mt-2 flex items-center">↓ 12% vs last quarter</p>
          </div>
          <div className="bg-gray-50 p-6 rounded-lg border border-gray-200">
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Sustainability Score</p>
            <p className="text-4xl font-bold text-gray-900 mt-2">85<span className="text-xl font-normal text-gray-500">/100</span></p>
            <p className="text-green-600 font-medium mt-2 flex items-center">↑ Top 15% in industry</p>
          </div>
        </div>

        <h3 className="text-xl font-bold text-gray-900 border-b border-gray-200 pb-2 mb-4">Highlights & Commentary</h3>
        <ul className="list-disc pl-5 space-y-2 text-gray-700 mb-8">
          <li>Successfully integrated 100% of fleet vehicles into active monitoring.</li>
          <li>Identified 15% reduction opportunity in idle times across delivery routes.</li>
          <li>Transitioned headquarters to renewable energy provider, reducing Scope 2 emissions.</li>
        </ul>
      </div>
    </div>
  );
}
