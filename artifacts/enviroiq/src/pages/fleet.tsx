import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListVehicles, useCreateVehicle, useDeleteVehicle, CreateVehicleRequestFuelType, CreateVehicleRequestGpsProvider } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Car, Plus, Trash2, Loader2, Navigation, Server } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";

const vehicleSchema = z.object({
  name: z.string().min(1, "Name is required"),
  registration: z.string().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  fuelType: z.enum(["petrol", "diesel", "electric", "hybrid", "lpg", "hydrogen", "other"]),
  gpsProvider: z.enum(["navman", "blackhawk", "generic", "none"]),
  gpsDeviceId: z.string().optional(),
});

export default function Fleet() {
  const { session } = useAuth();
  const orgId = session?.organisationId;
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data: vehicles, isLoading } = useListVehicles(orgId!, { query: { enabled: !!orgId } });
  const createVehicle = useCreateVehicle();
  const deleteVehicle = useDeleteVehicle();

  const form = useForm<z.infer<typeof vehicleSchema>>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: {
      name: "",
      fuelType: "diesel",
      gpsProvider: "none",
    }
  });

  const onSubmit = async (data: z.infer<typeof vehicleSchema>) => {
    try {
      await createVehicle.mutateAsync({
        orgId: orgId!,
        data: {
          ...data,
          fuelType: data.fuelType as CreateVehicleRequestFuelType,
          gpsProvider: data.gpsProvider as CreateVehicleRequestGpsProvider,
        },
      });
      toast({ title: "Vehicle added" });
      setIsDialogOpen(false);
      form.reset();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not add vehicle";
      toast({ variant: "destructive", title: "Error", description: message });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this vehicle?")) return;
    try {
      await deleteVehicle.mutateAsync({ orgId: orgId!, vehicleId: id });
      toast({ title: "Vehicle removed" });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Could not remove vehicle";
      toast({ variant: "destructive", title: "Error", description: message });
    }
  };

  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Fleet Management</h1>
          <p className="text-muted-foreground mt-1">Manage vehicles and GPS integrations.</p>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="hover-elevate active-elevate-2 shadow-lg shadow-primary/20">
              <Plus className="w-4 h-4 mr-2" /> Add Vehicle
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Register New Vehicle</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem><FormLabel>Internal Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="registration" render={({ field }) => (
                    <FormItem><FormLabel>Registration Plate</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="fuelType" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fuel Type</FormLabel>
                      <FormControl>
                        <select 
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                          {...field}
                        >
                          <option value="diesel">Diesel</option>
                          <option value="petrol">Petrol</option>
                          <option value="electric">Electric</option>
                          <option value="hybrid">Hybrid</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="gpsProvider" render={({ field }) => (
                    <FormItem>
                      <FormLabel>GPS Provider</FormLabel>
                      <FormControl>
                        <select 
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                          {...field}
                        >
                          <option value="none">None</option>
                          <option value="navman">Navman</option>
                          <option value="blackhawk">Blackhawk</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="gpsDeviceId" render={({ field }) => (
                    <FormItem><FormLabel>Device ID (if applicable)</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
                <Button type="submit" className="w-full mt-4" disabled={createVehicle.isPending}>
                  {createVehicle.isPending ? "Saving..." : "Save Vehicle"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Webhook Info Card */}
      <Card className="p-6 bg-secondary/10 border-primary/20">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-primary/10 rounded-xl mt-1"><Server className="w-6 h-6 text-primary" /></div>
          <div className="flex-1">
            <h3 className="font-semibold text-lg">GPS Webhook Integration</h3>
            <p className="text-muted-foreground text-sm mt-1 mb-4">Configure your fleet provider to push data to these endpoints.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3 bg-background rounded-lg border border-border">
                <p className="text-xs text-muted-foreground mb-1 uppercase font-semibold">Navman Endpoint</p>
                <code className="text-xs text-primary font-mono">{window.location.origin}/api/webhooks/fleet/navman</code>
              </div>
              <div className="p-3 bg-background rounded-lg border border-border">
                <p className="text-xs text-muted-foreground mb-1 uppercase font-semibold">Blackhawk Endpoint</p>
                <code className="text-xs text-primary font-mono">{window.location.origin}/api/webhooks/fleet/blackhawk</code>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card className="border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/30 text-muted-foreground uppercase text-xs font-semibold">
              <tr>
                <th className="px-6 py-4">Vehicle Info</th>
                <th className="px-6 py-4">Fuel</th>
                <th className="px-6 py-4">GPS Integration</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {vehicles?.items.map((vehicle) => (
                <tr key={vehicle.id} className="hover:bg-secondary/20 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-secondary rounded-lg"><Car className="w-4 h-4 text-muted-foreground" /></div>
                      <div>
                        <div className="font-medium text-foreground">{vehicle.name}</div>
                        <div className="text-xs text-muted-foreground">{vehicle.registration || "No Reg"} • {vehicle.make}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 capitalize"><span className="px-2.5 py-1 bg-secondary rounded-full text-xs">{vehicle.fuelType}</span></td>
                  <td className="px-6 py-4">
                    {vehicle.gpsProvider !== 'none' ? (
                      <div className="flex items-center text-xs text-emerald-400 gap-1"><Navigation className="w-3 h-3" /> {vehicle.gpsProvider}</div>
                    ) : <span className="text-xs text-muted-foreground">None</span>}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs ${vehicle.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-destructive/10 text-destructive'}`}>
                      {vehicle.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(vehicle.id)} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
              {(!vehicles?.items || vehicles.items.length === 0) && (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">No vehicles registered. Add your first vehicle above.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
