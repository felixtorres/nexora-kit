import { BarChart3 } from "lucide-react";

export default function UsagePage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <BarChart3 className="size-12 opacity-30" />
      <h2 className="text-xl font-medium">Usage Analytics</h2>
      <p className="text-sm">Usage analytics coming in Phase 5</p>
    </div>
  );
}
