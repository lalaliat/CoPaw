import { request } from "../request";
import { getApiUrl } from "../config";
import type {
  RoutineFireResponse,
  RoutineMutationResponse,
  RoutineRun,
  RoutineSpec,
  RoutineView,
} from "../types";

export const routineApi = {
  listRoutines: () => request<RoutineView[]>("/routines"),

  createRoutine: (spec: RoutineSpec) =>
    request<RoutineMutationResponse>("/routines", {
      method: "POST",
      body: JSON.stringify(spec),
    }),

  updateRoutine: (routineId: string, spec: RoutineSpec) =>
    request<RoutineMutationResponse>(
      `/routines/${encodeURIComponent(routineId)}`,
      { method: "PUT", body: JSON.stringify(spec) },
    ),

  deleteRoutine: (routineId: string) =>
    request<void>(`/routines/${encodeURIComponent(routineId)}`, {
      method: "DELETE",
    }),

  enableRoutine: (routineId: string) =>
    request<RoutineView>(`/routines/${encodeURIComponent(routineId)}/enable`, {
      method: "POST",
    }),

  pauseRoutine: (routineId: string) =>
    request<RoutineView>(`/routines/${encodeURIComponent(routineId)}/pause`, {
      method: "POST",
    }),

  runRoutine: (routineId: string) =>
    request<RoutineRun>(`/routines/${encodeURIComponent(routineId)}/run`, {
      method: "POST",
    }),

  listRoutineRuns: (routineId: string) =>
    request<RoutineRun[]>(`/routines/${encodeURIComponent(routineId)}/runs`),

  rotateRoutineToken: (routineId: string) =>
    request<RoutineMutationResponse>(
      `/routines/${encodeURIComponent(routineId)}/api-token`,
      { method: "POST" },
    ),

  fireRoutine: async (
    firePath: string,
    token: string,
    text = "Routine API test",
  ): Promise<RoutineFireResponse> => {
    const response = await fetch(getApiUrl(firePath), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  },
};
