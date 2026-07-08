"use client";

import { LockKeyhole } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    setLoading(false);
    if (!response.ok) {
      setError("账号或密码不正确");
      return;
    }

    const body = await response.json().catch(() => null);
    router.replace(body?.mustChangePassword ? "/setup-password" : searchParams.get("next") || "/");
    router.refresh();
  }

  return (
    <main className="min-h-screen px-5 py-10 flex items-center justify-center">
      <form onSubmit={submit} className="panel w-full max-w-sm p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-md bg-slate-900 text-white">
            <LockKeyhole size={20} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">MC Server Monitor</h1>
            <p className="text-sm text-slate-500">管理员登录</p>
          </div>
        </div>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-slate-600">账号</span>
          <input
            value={username}
            onChange={event => setUsername(event.target.value)}
            autoComplete="username"
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 outline-none focus:border-blue-600"
            required
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-slate-600">密码</span>
          <input
            value={password}
            onChange={event => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
            className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 outline-none focus:border-blue-600"
            required
          />
        </label>

        {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}

        <button
          disabled={loading}
          className="h-10 w-full rounded-md bg-slate-900 px-4 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "登录中" : "登录"}
        </button>
      </form>
    </main>
  );
}
