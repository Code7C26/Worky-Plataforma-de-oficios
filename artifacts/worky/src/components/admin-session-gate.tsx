import { useEffect, useState, type ReactNode } from "react";

type Props = {
  loadUser: () => Promise<{ rol: string } | null>;
  panel: ReactNode;
  activation: ReactNode;
};

// Only the authenticated server response grants access, never a stored UI role.
export function AdminSessionGate({ loadUser, panel, activation }: Props) {
  const [access, setAccess] = useState<"checking" | "admin" | "non-admin" | "error">("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setAccess("checking");
    void loadUser().then((user) => {
      if (active) setAccess(user ? (user.rol === "admin" ? "admin" : "non-admin") : "error");
    }).catch(() => {
      if (active) setAccess("error");
    });
    return () => { active = false; };
  }, [loadUser, attempt]);

  if (access === "admin") return panel;
  if (access === "non-admin") return activation;
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] p-6">
      <div className="text-center">
        <p role={access === "error" ? "alert" : "status"}>
          {access === "error"
            ? "No pudimos comprobar los permisos de tu sesión."
            : "Comprobando permisos de tu sesión…"}
        </p>
        {access === "error" && <button type="button" className="mt-4 rounded-xl bg-[#243b49] px-4 py-3 font-bold text-white" onClick={() => setAttempt((value) => value + 1)}>Volver a comprobar</button>}
      </div>
    </main>
  );
}
