import { useMutation, useQuery } from "@tanstack/react-query";

const API_BASE = "/api/v1";
const TOKEN_KEY = "worky-token";

export type ProfessionalStatus = "pending_review" | "enabled" | "paused" | "rejected";
export type ServiceRequestStatus = "new" | "under_review" | "assigned" | "completed" | "cancelled";

export type AdminUser = {
  id: number;
  nombre: string;
  email: string;
  telefono?: string | null;
  rol: string;
};

export type AdminOverview = {
  householdCount: number;
  professionalCount: number;
  pendingProfessionalCount: number;
  enabledProfessionalCount: number;
  openRequestCount: number;
  newRequestCount: number;
};

export type AdminHousehold = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  zone: string;
  active: boolean;
  createdAt: string;
};

export type AdminProfessional = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  zone: string;
  categoryId: string | null;
  categoryName: string;
  description: string;
  status: ProfessionalStatus;
  verified: boolean;
  adminNote: null;
  documentCount: number;
  pendingDocumentCount: number;
  createdAt: string;
};

export type AdminServiceRequest = {
  id: string;
  title: string;
  description: string;
  householdId: string;
  householdName: string;
  professionalId: string | null;
  professionalName: string | null;
  categoryId: string | null;
  categoryName: string;
  zone: string;
  status: ServiceRequestStatus;
  adminNote: null;
  price: string;
  createdAt: string;
};

export type WorkCategory = {
  id: string;
  name: string;
  description: string;
  category: string;
  active: boolean;
  createdAt: string;
};

export type VerificationDocument = {
  id: string;
  professionalId: string;
  type: string;
  name: string;
  objectPath: string;
  contentType: string;
  status: "pending_verification" | "verified" | "rejected";
  createdAt: string;
};

export class AdminApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
  }
}

export function getWorkyToken() {
  return typeof window === "undefined" ? null : window.localStorage.getItem(TOKEN_KEY);
}

export function setWorkyToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearWorkyToken() {
  if (typeof window !== "undefined") window.localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, headers: suppliedHeaders, ...init } = options;
  const headers = new Headers(suppliedHeaders);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = auth ? getWorkyToken() : null;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  if (!response.ok) {
    if (auth && response.status === 401) {
      clearWorkyToken();
      window.dispatchEvent(new Event("worky:session-expired"));
    }
    throw new AdminApiError(
      response.status,
      payload?.error || payload?.message || "No se pudo completar la operación.",
    );
  }
  return payload as T;
}

export async function loginWorkyAdmin(email: string, password: string) {
  return request<{ token: string; usuario: AdminUser }>("/auth/login", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ email, password }),
  });
}

export function getCurrentWorkyUser() {
  return request<AdminUser>("/auth/me");
}

export function logoutWorkySession() {
  if (getWorkyToken()) {
    void request<void>("/auth/logout", { method: "POST" }).catch(() => undefined);
  }
  clearWorkyToken();
}

export const getGetAdminOverviewQueryKey = () => ["admin", "overview"] as const;
export const getListAdminProfessionalsQueryKey = () => ["admin", "professionals"] as const;
export const getListAdminHouseholdsQueryKey = () => ["admin", "households"] as const;
export const getListAdminServiceRequestsQueryKey = () => ["admin", "service-requests"] as const;
export const getListAdminCategoriesQueryKey = () => ["admin", "categories"] as const;

function paramsToQuery(params?: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function useGetAdminOverview() {
  return useQuery({
    queryKey: getGetAdminOverviewQueryKey(),
    queryFn: () => request<AdminOverview>("/admin/overview"),
  });
}

export function useListAdminProfessionals(params?: { search?: string; status?: ProfessionalStatus }) {
  return useQuery({
    queryKey: [...getListAdminProfessionalsQueryKey(), params || {}],
    queryFn: () => request<AdminProfessional[]>(`/admin/professionals${paramsToQuery(params)}`),
  });
}

export function useListAdminHouseholds(params?: { search?: string }) {
  return useQuery({
    queryKey: [...getListAdminHouseholdsQueryKey(), params || {}],
    queryFn: () => request<AdminHousehold[]>(`/admin/households${paramsToQuery(params)}`),
  });
}

export function useUpdateAdminHousehold() {
  return useMutation({
    mutationFn: ({ householdId, active }: { householdId: string; active: boolean }) =>
      request<{ id: string; active: boolean }>(`/admin/households/${encodeURIComponent(householdId)}`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      }),
  });
}

export function useListAdminServiceRequests(params?: { search?: string; status?: ServiceRequestStatus }) {
  return useQuery({
    queryKey: [...getListAdminServiceRequestsQueryKey(), params || {}],
    queryFn: () => request<AdminServiceRequest[]>(`/admin/service-requests${paramsToQuery(params)}`),
  });
}

export function useListAdminCategories() {
  return useQuery({
    queryKey: getListAdminCategoriesQueryKey(),
    queryFn: () => request<WorkCategory[]>("/admin/categories"),
  });
}

export function useCreateAdminCategory() {
  return useMutation({
    mutationFn: (data: { category: string; specialty: string; active: boolean }) =>
      request<WorkCategory>("/admin/categories", { method: "POST", body: JSON.stringify(data) }),
  });
}

export function useUpdateAdminCategory() {
  return useMutation({
    mutationFn: ({ categoryId, data }: {
      categoryId: string;
      data: Partial<{ category: string; specialty: string; active: boolean }>;
    }) => request<WorkCategory>(`/admin/categories/${encodeURIComponent(categoryId)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  });
}

export function useDeleteAdminCategory() {
  return useMutation({
    mutationFn: ({ categoryId }: { categoryId: string }) =>
      request<void>(`/admin/categories/${encodeURIComponent(categoryId)}`, { method: "DELETE" }),
  });
}

export function useUpdateAdminProfessional() {
  return useMutation({
    mutationFn: ({ professionalId, data }: {
      professionalId: string;
      data: Partial<{ status: "enabled" | "paused" }>;
    }) => request<AdminProfessional>(`/admin/professionals/${encodeURIComponent(professionalId)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  });
}

export function useUpdateAdminServiceRequest() {
  return useMutation({
    mutationFn: ({ requestId, data }: {
      requestId: string;
      data: Partial<{ status: ServiceRequestStatus; professionalId: string | null }>;
    }) => request<AdminServiceRequest>(`/admin/service-requests/${encodeURIComponent(requestId)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  });
}

export function useListAdminProfessionalDocuments(professionalId: string | null) {
  return useQuery({
    queryKey: ["admin", "verification-documents", professionalId],
    enabled: Boolean(professionalId),
    queryFn: () => request<VerificationDocument[]>(
      `/admin/professionals/${encodeURIComponent(professionalId!)}/verification-documents`,
    ),
  });
}

export function useReviewAdminVerificationDocument() {
  return useMutation({
    mutationFn: ({ documentId, status, reason }: {
      documentId: string;
      status: "verified" | "rejected";
      reason: string;
    }) => request(`/admin/verificaciones/${encodeURIComponent(documentId)}`, {
      method: "PATCH",
      body: JSON.stringify({ estado: status, motivo: reason }),
    }),
  });
}

export async function openVerificationDocument(objectPath: string) {
  const token = getWorkyToken();
  if (!token) throw new AdminApiError(401, "La sesión venció. Volvé a iniciar sesión.");
  const tab = window.open("about:blank", "_blank");
  if (tab) tab.opener = null;
  const encodedPath = objectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const path = encodedPath.startsWith("/") ? encodedPath : `/${encodedPath}`;
  try {
    const response = await fetch(`${API_BASE}/storage/objects${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      tab?.close();
      if (response.status === 401) {
        clearWorkyToken();
        window.dispatchEvent(new Event("worky:session-expired"));
      }
      throw new AdminApiError(response.status, "No se pudo abrir el documento privado.");
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    if (tab) tab.location.href = objectUrl;
    else throw new AdminApiError(0, "El navegador bloqueó la nueva pestaña para abrir el documento.");
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    tab?.close();
    throw error;
  }
}
