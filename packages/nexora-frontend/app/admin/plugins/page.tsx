import { Puzzle } from "lucide-react";

export default function PluginsPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <Puzzle className="size-12 opacity-30" />
      <h2 className="text-xl font-medium">Plugins</h2>
      <p className="text-sm">Plugin management coming in Phase 4</p>
    </div>
  );
}
