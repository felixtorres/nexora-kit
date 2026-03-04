import { Cpu } from "lucide-react";

export default function AgentsPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <Cpu className="size-12 opacity-30" />
      <h2 className="text-xl font-medium">Agents</h2>
      <p className="text-sm">Agent management coming in Phase 3</p>
    </div>
  );
}
