import { Shield } from "lucide-react";

export default function AuditPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <Shield className="size-12 opacity-30" />
      <h2 className="text-xl font-medium">Audit Log</h2>
      <p className="text-sm">Audit log viewer coming in Phase 5</p>
    </div>
  );
}
