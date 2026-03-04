"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Eye, EyeOff, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useSettings } from "@/store/settings";
import { api, type HealthResponse, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type TestResult =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "success"; data: HealthResponse }
  | { state: "error"; message: string };

export default function SettingsPage() {
  const { serverUrl, apiKey, setServerUrl, setApiKey } = useSettings();
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>({ state: "idle" });

  // Debounced save for server URL
  const urlTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [localUrl, setLocalUrl] = useState(serverUrl);

  useEffect(() => {
    setLocalUrl(serverUrl);
  }, [serverUrl]);

  const handleUrlChange = useCallback(
    (value: string) => {
      setLocalUrl(value);
      clearTimeout(urlTimer.current);
      urlTimer.current = setTimeout(() => setServerUrl(value), 500);
    },
    [setServerUrl]
  );

  // Debounced save for API key
  const keyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [localKey, setLocalKey] = useState(apiKey);

  useEffect(() => {
    setLocalKey(apiKey);
  }, [apiKey]);

  const handleKeyChange = useCallback(
    (value: string) => {
      setLocalKey(value);
      clearTimeout(keyTimer.current);
      keyTimer.current = setTimeout(() => setApiKey(value), 500);
    },
    [setApiKey]
  );

  const testConnection = useCallback(async () => {
    setTestResult({ state: "testing" });
    try {
      const data = await api.health.check();
      setTestResult({ state: "success", data });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : "Unknown error";
      setTestResult({ state: "error", message });
    }
  }, []);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure your Nexora server connection.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Server Connection</CardTitle>
          <CardDescription>
            Enter the URL and API key for your nexora-kit instance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="server-url">Server URL</Label>
            <Input
              id="server-url"
              type="url"
              placeholder="http://localhost:3000"
              value={localUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="api-key">API Key</Label>
            <div className="relative">
              <Input
                id="api-key"
                type={showKey ? "text" : "password"}
                placeholder="Enter your API key"
                value={localKey}
                onChange={(e) => handleKeyChange(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={testConnection}
              disabled={testResult.state === "testing" || !localUrl}
            >
              {testResult.state === "testing" && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Test Connection
            </Button>

            {testResult.state === "success" && (
              <div className="flex items-center gap-1.5 text-sm text-emerald-600">
                <CheckCircle2 className="size-4" />
                <span>
                  {testResult.data.status} &mdash;{" "}
                  {testResult.data.plugins.enabled}/
                  {testResult.data.plugins.total} plugins
                </span>
              </div>
            )}

            {testResult.state === "error" && (
              <div className="flex items-center gap-1.5 text-sm text-red-600">
                <XCircle className="size-4" />
                <span>{testResult.message}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
