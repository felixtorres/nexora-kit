import { Bot } from "lucide-react";

export default function BotsPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <Bot className="size-12 opacity-30" />
      <h2 className="text-xl font-medium">Bots</h2>
      <p className="text-sm">Bot management coming in Phase 3</p>
    </div>
  );
}
