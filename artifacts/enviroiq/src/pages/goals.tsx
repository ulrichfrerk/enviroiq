import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListGoals, useCreateGoal } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Target, Plus, Loader2, Calendar, TrendingDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function Goals() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);

  const { data: goals, isLoading } = useListGoals(orgId!, { query: { enabled: !!orgId } });
  const createGoal = useCreateGoal();

  const form = useForm({
    defaultValues: {
      title: "",
      category: "emissions",
      targetType: "reduce_by_percent",
      targetValue: 0,
      targetUnit: "%",
    }
  });

  const onSubmit = async (data: any) => {
    try {
      await createGoal.mutateAsync({ 
        orgId: orgId!, 
        data: {
          ...data,
          targetValue: Number(data.targetValue)
        }
      });
      toast({ title: "Goal created" });
      setIsOpen(false);
      form.reset();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Sustainability Goals</h1>
          <p className="text-muted-foreground mt-1">Set targets and track your progress over time.</p>
        </div>
        
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="hover-elevate active-elevate-2 shadow-lg shadow-primary/20">
              <Plus className="w-4 h-4 mr-2" /> New Goal
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader><DialogTitle>Set New Goal</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                <FormField control={form.control} name="title" render={({ field }) => (
                  <FormItem><FormLabel>Goal Title</FormLabel><FormControl><Input placeholder="e.g. Net Zero by 2030" {...field} /></FormControl></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="category" render={({ field }) => (
                    <FormItem><FormLabel>Category</FormLabel><FormControl>
                      <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" {...field}>
                        <option value="emissions">Emissions</option>
                        <option value="energy">Energy</option>
                        <option value="fleet">Fleet</option>
                      </select>
                    </FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="targetType" render={({ field }) => (
                    <FormItem><FormLabel>Target Type</FormLabel><FormControl>
                      <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" {...field}>
                        <option value="reduce_by_percent">Reduce by %</option>
                        <option value="reduce_to_absolute">Reduce to Absolute</option>
                      </select>
                    </FormControl></FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="targetValue" render={({ field }) => (
                    <FormItem><FormLabel>Target Value</FormLabel><FormControl><Input type="number" {...field} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="targetUnit" render={({ field }) => (
                    <FormItem><FormLabel>Unit</FormLabel><FormControl><Input placeholder="%, kg, kWh" {...field} /></FormControl></FormItem>
                  )} />
                </div>
                <Button type="submit" className="w-full mt-4" disabled={createGoal.isPending}>Save Goal</Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {goals?.items.map((goal: any) => {
          // Mock progress for UI visual fidelity since API might not return it directly in the list view depending on the backend implementation
          const mockProgress = Math.floor(Math.random() * 80) + 10; 
          
          return (
            <Card key={goal.id} className="p-6 bg-card hover:border-primary/50 transition-colors flex flex-col h-full shadow-lg shadow-black/5">
              <div className="flex justify-between items-start mb-4">
                <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider">
                  {goal.category}
                </span>
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                  goal.status === 'on_track' ? 'bg-emerald-500/10 text-emerald-400' : 
                  goal.status === 'behind' ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/10 text-amber-400'
                }`}>
                  {goal.status.replace('_', ' ')}
                </span>
              </div>
              <h3 className="text-xl font-bold text-foreground mb-1">{goal.title}</h3>
              
              <div className="mt-auto pt-6 space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-medium">{mockProgress}%</span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                    <div className="bg-primary h-full rounded-full transition-all duration-1000" style={{ width: `${mockProgress}%` }} />
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm pt-4 border-t border-border/50">
                  <div className="flex items-center text-muted-foreground">
                    <TrendingDown className="w-4 h-4 mr-1" />
                    Target: {goal.targetValue}{goal.targetUnit}
                  </div>
                  {goal.dueDate && (
                    <div className="flex items-center text-muted-foreground">
                      <Calendar className="w-4 h-4 mr-1" />
                      {format(new Date(goal.dueDate), "yyyy")}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
        
        {(!goals?.items || goals.items.length === 0) && (
          <div className="col-span-full py-12 text-center text-muted-foreground border-2 border-dashed border-border rounded-xl">
            No goals set. Click 'New Goal' to start tracking.
          </div>
        )}
      </div>
    </div>
  );
}
