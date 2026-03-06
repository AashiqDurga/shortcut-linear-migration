"use client";

import { useEffect, useState } from "react";
import { shortcutRequest, linearRequest } from "@/lib/api";
import { TEAMS_QUERY } from "@/lib/linear";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ShortcutGroup } from "@/lib/shortcut";
import type { LinearTeam } from "@/lib/linear";

interface Props {
  shortcutToken: string;
  linearToken: string;
  onSelect: (group: ShortcutGroup) => void;
  onSelectForFix: (group: ShortcutGroup) => void;
  onBack: () => void;
}

export default function SelectTeamStep({ shortcutToken, linearToken, onSelect, onSelectForFix, onBack }: Props) {
  const [groups, setGroups] = useState<ShortcutGroup[]>([]);
  const [linearTeamNames, setLinearTeamNames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    Promise.all([
      shortcutRequest<ShortcutGroup[]>(shortcutToken, "GET", "groups"),
      linearRequest<{ teams: { nodes: LinearTeam[] } }>(linearToken, TEAMS_QUERY).catch(() => null),
    ])
      .then(([scGroups, linearData]) => {
        setGroups(scGroups);
        if (linearData) {
          setLinearTeamNames(new Set(linearData.teams.nodes.map((t) => t.name.toLowerCase())));
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [shortcutToken, linearToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="ml-3 text-sm text-muted-foreground">Loading teams…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold">Select a Shortcut team</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose which team&apos;s data to migrate. {groups.length} team{groups.length !== 1 ? "s" : ""} found.
        </p>
      </div>

      <Input
        placeholder="Search teams…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4"
        autoFocus
      />

      <div className="space-y-2 mb-6">
        {groups.filter((g) => g.name.toLowerCase().includes(search.toLowerCase())).map((group) => (
          <button
            key={group.id}
            onClick={() => onSelect(group)}
            className="w-full rounded-lg border bg-card px-4 py-4 text-left hover:border-primary/50 hover:bg-accent transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-medium group-hover:text-primary truncate">
                  {group.name}
                </div>
                {group.description && (
                  <div className="mt-0.5 text-sm text-muted-foreground line-clamp-1">
                    {group.description}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-4">
                <span className="text-xs text-muted-foreground">
                  {group.num_stories ?? "?"} stories
                </span>
                {linearTeamNames.has(group.name.toLowerCase()) && (
                  <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700 text-xs">
                    ✓ team in Linear
                  </Badge>
                )}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onSelectForFix(group); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onSelectForFix(group); } }}
                  className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2 px-1 cursor-pointer"
                >
                  Fix archived
                </span>
                <svg className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </button>
        ))}
      </div>

      <Button variant="ghost" size="sm" onClick={onBack}>
        ← Back
      </Button>
    </div>
  );
}
