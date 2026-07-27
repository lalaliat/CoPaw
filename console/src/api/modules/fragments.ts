import { request } from "../request";

export interface FragmentSpec {
  id: string;
  surface: string;
  gist: string;
  topics: string[];
  stance: "insight" | "question" | "analogy" | "todo" | "reference";
  spark: string;
  source_text: string;
  source_session_id?: string;
  source_seq?: number;
  generation: number;
  created_at: string;
  updated_at: string;
}

export interface FragmentCreate {
  source_text: string;
  source_session_id?: string;
  source_seq?: number;
  surface?: string;
  gist?: string;
  topics?: string[];
  stance?: string;
  spark?: string;
  generation?: number;
}

export interface FragmentUpdate {
  surface?: string;
  gist?: string;
  topics?: string[];
  stance?: string;
  spark?: string;
}

export interface CollideRequest {
  fragment_ids: string[];
  mode: "analytical" | "creative";
}

const agentPrefix = (agentId: string) => `/agents/${agentId}`;

export const fragmentsApi = {
  listFragments: (
    agentId: string,
    params?: {
      topics?: string;
      stance?: string;
      sort_by?: string;
      sort_order?: string;
    },
  ) => {
    const query = new URLSearchParams();
    if (params?.topics) query.set("topics", params.topics);
    if (params?.stance) query.set("stance", params.stance);
    if (params?.sort_by) query.set("sort_by", params.sort_by);
    if (params?.sort_order) query.set("sort_order", params.sort_order);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return request<FragmentSpec[]>(
      `${agentPrefix(agentId)}/fragments${suffix}`,
    );
  },

  getFragment: (agentId: string, fragmentId: string) =>
    request<FragmentSpec>(
      `${agentPrefix(agentId)}/fragments/${encodeURIComponent(fragmentId)}`,
    ),

  createFragment: (agentId: string, body: FragmentCreate) =>
    request<FragmentSpec>(`${agentPrefix(agentId)}/fragments`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateFragment: (agentId: string, fragmentId: string, body: FragmentUpdate) =>
    request<FragmentSpec>(
      `${agentPrefix(agentId)}/fragments/${encodeURIComponent(fragmentId)}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    ),

  deleteFragment: (agentId: string, fragmentId: string) =>
    request<{ deleted: boolean }>(
      `${agentPrefix(agentId)}/fragments/${encodeURIComponent(fragmentId)}`,
      { method: "DELETE" },
    ),

  batchDeleteFragments: (agentId: string, fragmentIds: string[]) =>
    request<{ deleted: number }>(
      `${agentPrefix(agentId)}/fragments/batch-delete`,
      {
        method: "POST",
        body: JSON.stringify(fragmentIds),
      },
    ),

  getAllTopics: (agentId: string) =>
    request<string[]>(`${agentPrefix(agentId)}/fragments/topics`),

  regenerateMeta: (agentId: string, fragmentId: string) =>
    request<FragmentSpec>(
      `${agentPrefix(agentId)}/fragments/regenerate-meta/${encodeURIComponent(
        fragmentId,
      )}`,
      { method: "POST" },
    ),
};
