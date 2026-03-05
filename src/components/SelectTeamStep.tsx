"use client";

import { useEffect, useState } from "react";
import { shortcutRequest } from "@/lib/api";
import type { ShortcutGroup } from "@/lib/shortcut";

interface Props {
  shortcutToken: string;
  onSelect: (group: ShortcutGroup) => void;
  onBack: () => void;
}

export default function SelectTeamStep({ shortcutToken, onSelect, onBack }: Props) {
  const [groups, setGroups] = useState<ShortcutGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    shortcutRequest<ShortcutGroup[]>(shortcutToken, "GET", "groups")
      .then((data) => setGroups(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [shortcutToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <span className="ml-3 text-sm text-gray-500">Loading teams…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-900">Select a Shortcut team</h2>
        <p className="mt-1 text-sm text-gray-500">
          Choose which team's data to migrate. {groups.length} team{groups.length !== 1 ? "s" : ""} found.
        </p>
      </div>

      <div className="space-y-2 mb-6">
        {groups.map((group) => (
          <button
            key={group.id}
            onClick={() => onSelect(group)}
            className="w-full rounded-lg border border-gray-200 bg-white px-4 py-4 text-left hover:border-blue-400 hover:bg-blue-50 transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-gray-900 group-hover:text-blue-700">
                  {group.name}
                </div>
                {group.description && (
                  <div className="mt-0.5 text-sm text-gray-400 line-clamp-1">
                    {group.description}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-400 shrink-0 ml-4">
                <span>{group.num_stories ?? "?"} stories</span>
                <svg className="h-4 w-4 text-gray-300 group-hover:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </button>
        ))}
      </div>

      <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700">
        ← Back
      </button>
    </div>
  );
}
