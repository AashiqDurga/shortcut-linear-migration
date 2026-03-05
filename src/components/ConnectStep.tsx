"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Props {
  onConnect: (shortcutToken: string, linearToken: string) => void;
}

export default function ConnectStep({ onConnect }: Props) {
  const [shortcutToken, setShortcutToken] = useState("");
  const [linearToken, setLinearToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [envConfig, setEnvConfig] = useState<{ shortcutConfigured: boolean; linearConfigured: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setEnvConfig)
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!shortcutToken.trim() || !linearToken.trim()) {
      setError("Both tokens are required.");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/shortcut", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: shortcutToken.trim(), method: "GET", path: "groups" }),
      });
      if (!res.ok) throw new Error(`Shortcut token rejected (${res.status})`);

      const linRes = await fetch("/api/linear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: linearToken.trim(), query: "{ viewer { id name } }" }),
      });
      const linData = await linRes.json();
      if (linData.errors?.length) throw new Error(linData.errors[0].message);
      if (!linData.data?.viewer) throw new Error("Linear token invalid");

      onConnect(shortcutToken.trim(), linearToken.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold">Connect your accounts</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Tokens are kept in browser memory only — never written to disk.
        </p>
      </div>

      {envConfig && (envConfig.shortcutConfigured || envConfig.linearConfigured) && (
        <div className="mb-5 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
          {envConfig.shortcutConfigured && envConfig.linearConfigured
            ? "Both tokens are set via environment variables. You should have been auto-redirected — refresh if you weren't."
            : `${envConfig.shortcutConfigured ? "Shortcut token" : "Linear API key"} is set via env var. Enter the missing one below.`}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Shortcut API Token</label>
          <Input
            type="password"
            value={shortcutToken}
            onChange={(e) => setShortcutToken(e.target.value)}
            placeholder="Enter your Shortcut API token"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Settings → API Tokens in your Shortcut workspace
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Linear API Key</label>
          <Input
            type="password"
            value={linearToken}
            onChange={(e) => setLinearToken(e.target.value)}
            placeholder="Enter your Linear API key"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Settings → API → Personal API keys in Linear
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Connecting…" : "Connect"}
        </Button>
      </form>
    </div>
  );
}
